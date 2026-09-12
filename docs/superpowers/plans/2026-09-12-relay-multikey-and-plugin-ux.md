# 中转站多 key 轮询与插件编写引导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给中转站加「同 provider 多 apiKey 轮询 + 失败冷却」，并在面板内提供插件示例、一键生成示例插件、打开插件目录。

**Architecture:** `llm-config` 解析 `provider.options.apiKeys`；新增纯模块 `llm-keypool` 按 providerId 轮询并在错误时冷却；`llm-proxy` 每请求取 key、按上游状态冷却。另抽 `reveal.js` 共用 OS 打开目录；`relay-plugins` 提供起手模板与写文件；`llm-mount` 暴露 template/example/reveal 三接口；前端面板加示例区与按钮。

**Tech Stack:** Node ESM、`node:test`、Vue3+TS、i18n 中英对称。

**Spec:** `docs/superpowers/specs/2026-09-12-relay-plugins-cache-design.md`（§14–§16）

**约定:** 仓库根执行；`npm.cmd`；后端单测 `node --test "server/test/xxx.test.js"`；每 Task 一提交。

---

## 文件结构

- Create `server/llm-keypool.js`、`server/test/llm-keypool.test.js`。
- Create `server/reveal.js`（从 `http-api.js` 抽出）。
- Modify `server/llm-config.js`、`server/test/llm-config.test.js`。
- Modify `server/llm-proxy.js`、`server/test/llm-proxy.test.js`。
- Modify `server/http-api.js`（改 import）。
- Modify `server/relay-plugins.js`、`server/test/relay-plugins.test.js`。
- Modify `server/llm-mount.js`、`server/test/llm-mount.test.js`。
- Modify `web/src/useLlm.ts`、`web/src/components/ProxyView.vue`、`shared/i18n/{zh-CN,en}.js`。

---

### Task 1: 轮询与冷却 `server/llm-keypool.js`

**Files:**
- Create: `server/llm-keypool.js`
- Test: `server/test/llm-keypool.test.js`

- [ ] **Step 1: 写失败测试** — `server/test/llm-keypool.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyPool } from '../llm-keypool.js';

test('按 providerId 独立轮询并循环', () => {
  const pool = createKeyPool();
  assert.equal(pool.next('p', ['a', 'b']), 'a');
  assert.equal(pool.next('p', ['a', 'b']), 'b');
  assert.equal(pool.next('p', ['a', 'b']), 'a');
  assert.equal(pool.next('q', ['a', 'b']), 'a');
});

test('空池与空数组返回空串', () => {
  const pool = createKeyPool();
  assert.equal(pool.next('p', []), '');
  assert.equal(pool.next('p', undefined), '');
});

test('冷却中的 key 被跳过，到期恢复', () => {
  let t = 0;
  const pool = createKeyPool({ cooldownMs: 1000, now: () => t });
  assert.equal(pool.next('p', ['a', 'b']), 'a');
  pool.cool('p', 'a');
  assert.equal(pool.isCooling('p', 'a'), true);
  assert.equal(pool.next('p', ['a', 'b']), 'b');
  assert.equal(pool.next('p', ['a', 'b']), 'b');
  t = 1000;
  assert.equal(pool.isCooling('p', 'a'), false);
});

test('全部冷却时取最早到期', () => {
  let t = 0;
  const pool = createKeyPool({ cooldownMs: 1000, now: () => t });
  pool.cool('p', 'a', 1000);
  pool.cool('p', 'b', 5000);
  assert.equal(pool.next('p', ['a', 'b']), 'a');
});

test('自定义冷却时长与 clear', () => {
  let t = 0;
  const pool = createKeyPool({ now: () => t });
  pool.cool('p', 'a', 500);
  assert.equal(pool.isCooling('p', 'a'), true);
  t = 500;
  assert.equal(pool.isCooling('p', 'a'), false);
  pool.cool('p', 'a');
  pool.clear();
  assert.equal(pool.isCooling('p', 'a'), false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-keypool.test.js"`
Expected: FAIL（`Cannot find module '../llm-keypool.js'`）

- [ ] **Step 3: 实现** — `server/llm-keypool.js`

```js
export function createKeyPool({ cooldownMs = 30000, now = Date.now } = {}) {
  const idx = new Map();
  const cooling = new Map();

  function coolingFor(providerId) {
    let m = cooling.get(providerId);
    if (!m) { m = new Map(); cooling.set(providerId, m); }
    return m;
  }
  function prune(providerId) {
    const m = coolingFor(providerId);
    const t = now();
    for (const [key, until] of m) if (until <= t) m.delete(key);
    return m;
  }

  return {
    next(providerId, keys) {
      const list = (keys || []).filter(Boolean);
      if (!list.length) return '';
      const m = prune(providerId);
      const start = idx.get(providerId) || 0;
      for (let attempt = 0; attempt < list.length; attempt += 1) {
        const at = (start + attempt) % list.length;
        const key = list[at];
        if (!m.has(key)) {
          idx.set(providerId, (at + 1) % list.length);
          return key;
        }
      }
      let best = list[0];
      let bestUntil = Infinity;
      for (const key of list) {
        const until = m.get(key) || 0;
        if (until < bestUntil) { bestUntil = until; best = key; }
      }
      idx.set(providerId, (list.indexOf(best) + 1) % list.length);
      return best;
    },
    cool(providerId, key, ms = cooldownMs) {
      if (!key) return;
      coolingFor(providerId).set(key, now() + ms);
    },
    isCooling(providerId, key) {
      return prune(providerId).has(key);
    },
    clear() { idx.clear(); cooling.clear(); },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-keypool.test.js"`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```
git add server/llm-keypool.js server/test/llm-keypool.test.js
git commit -m "feat(server): 中转多 key 轮询与冷却池"
```

---

### Task 2: 解析 `apiKeys` `server/llm-config.js`

**Files:**
- Modify: `server/llm-config.js`
- Test: `server/test/llm-config.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/llm-config.test.js` 顶部 import 增加 `resolveApiKeys`：

```js
import { loadOpencodeProviders, resolveApiKey, resolveApiKeys, listProviders, getProvider, buildOpencodeConfig } from '../llm-config.js';
```

文件末尾追加：

```js
test('resolveApiKeys 解析 {env:} 并去空去重', () => {
  assert.deepEqual(resolveApiKeys(['{env:K1}', 'k2', '', 'k2', 42], { K1: 'x' }), ['x', 'k2']);
  assert.deepEqual(resolveApiKeys([], {}), []);
});

test('getProvider 解析 apiKeys 数组，apiKey 为首个', () => {
  const dir = dirWith({ provider: { corp: { options: { baseURL: 'https://gw/v1', apiKeys: ['A', 'B', 'A'] } } } });
  const p = getProvider('corp', { dir });
  assert.deepEqual(p.apiKeys, ['A', 'B']);
  assert.equal(p.apiKey, 'A');
});

test('无 apiKeys 时回退单个 apiKey', () => {
  const dir = dirWith({ provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'S' } } } });
  const p = getProvider('corp', { dir });
  assert.deepEqual(p.apiKeys, ['S']);
  assert.equal(p.apiKey, 'S');
});

test('apiKeys 全空时 hasKey=false、apiKeys 为空', () => {
  const dir = dirWith({ provider: { corp: { options: { baseURL: 'https://gw/v1', apiKeys: ['', '{env:MISSING}'] } } } });
  assert.equal(listProviders({ dir }).providers[0].hasKey, false);
  assert.deepEqual(getProvider('corp', { dir }).apiKeys, []);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-config.test.js"`
Expected: FAIL（`resolveApiKeys is not a function` / `apiKeys` undefined）

- [ ] **Step 3: 实现** — `server/llm-config.js`

把 `loadOpencodeProviders` 里 provider 组装那行改为：

```js
    const apiKeysRaw = Array.isArray(o.apiKeys) ? o.apiKeys : (o.apiKey ? [o.apiKey] : []);
    providers.push({ id, name: (p && p.name) || id, baseURL: o.baseURL || '', apiKeysRaw, models: Object.keys((p && p.models) || {}) });
```

在 `resolveApiKey` 之后新增：

```js
export function resolveApiKeys(rawList, env = process.env) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const raw of rawList) {
    const key = resolveApiKey(raw, env);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}
```

把 `listProviders` 的 map 改为：

```js
    providers: providers.map((p) => ({ id: p.id, name: p.name, baseURL: p.baseURL, hasKey: resolveApiKeys(p.apiKeysRaw).length > 0, models: p.models })),
```

把 `getProvider` 的返回改为：

```js
  const apiKeys = resolveApiKeys(p.apiKeysRaw);
  return { id: p.id, baseURL: p.baseURL, apiKey: apiKeys[0] || '', apiKeys, models: p.models };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-config.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/llm-config.js server/test/llm-config.test.js
git commit -m "feat(server): opencode provider 支持 apiKeys 多 key"
```

---

### Task 3: 代理接入多 key `server/llm-proxy.js`

**Files:**
- Modify: `server/llm-proxy.js`
- Test: `server/test/llm-proxy.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/llm-proxy.test.js` 末尾追加：

```js
test('多 apiKey 轮询：连续三次请求依次用 k1/k2/k1', async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push(req.headers.authorization);
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  const front = await startProxy({
    vault,
    getProvider: () => ({ baseURL, apiKey: 'k1', apiKeys: ['k1', 'k2'] }),
    isEnabled: () => true,
  });
  t.after(() => front.close());
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
  const url = `http://127.0.0.1:${front.address().port}/chat`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  await (await fetch(url, { method: 'POST', headers, body: '{"i":1}' })).text();
  await (await fetch(url, { method: 'POST', headers, body: '{"i":2}' })).text();
  await (await fetch(url, { method: 'POST', headers, body: '{"i":3}' })).text();
  assert.deepEqual(seen, ['Bearer k1', 'Bearer k2', 'Bearer k1']);
});

test('上游 429 后冷却该 key，下次跳过', async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    seen.push(auth);
    req.on('data', () => {});
    req.on('end', () => {
      if (auth === 'Bearer k1') { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end('{"e":"rate"}'); }
      else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); }
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  const front = await startProxy({
    vault,
    getProvider: () => ({ baseURL, apiKey: 'k1', apiKeys: ['k1', 'k2'] }),
    isEnabled: () => true,
  });
  t.after(() => front.close());
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
  const url = `http://127.0.0.1:${front.address().port}/chat`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  await (await fetch(url, { method: 'POST', headers, body: '{"i":1}' })).text();
  await (await fetch(url, { method: 'POST', headers, body: '{"i":2}' })).text();
  await (await fetch(url, { method: 'POST', headers, body: '{"i":3}' })).text();
  assert.deepEqual(seen, ['Bearer k1', 'Bearer k2', 'Bearer k2']);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-proxy.test.js"`
Expected: FAIL（三次请求都用 k1 / 429 后仍用 k1）

- [ ] **Step 3: 实现** — `server/llm-proxy.js`

顶部 import 增加：

```js
import { createKeyPool } from './llm-keypool.js';
```

`pipeUpstream` 增加 `onStatus` 参数：

```js
function pipeUpstream(res, target, method, headers, body, onStatus) {
  const preq = upstreamRequest(target, method, headers, (pres) => {
    const status = pres.statusCode || 502;
    onStatus?.(status);
    res.writeHead(status, pres.headers);
    pres.pipe(res);
  });
  preq.on('error', () => deny(res, 502, 'upstream error'));
  if (body && body.length) preq.end(body); else preq.end();
}
```

`bufferUpstream` 增加 `onStatus` 参数，并在两处调用：

```js
function bufferUpstream(res, target, method, headers, body, limit, onStatus) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const preq = upstreamRequest(target, method, headers, (pres) => {
      const status = pres.statusCode || 502;
      const chunks = [];
      let size = 0;
      let overflow = false;
      pres.on('data', (c) => {
        if (overflow) return;
        size += c.length;
        if (size > limit) {
          overflow = true;
          onStatus?.(status);
          res.writeHead(status, pres.headers);
          for (const chunk of chunks) res.write(chunk);
          res.write(c);
          pres.pipe(res);
          return;
        }
        chunks.push(c);
      });
      pres.on('end', () => {
        if (settled) return;
        settled = true;
        if (overflow) resolve({ streamed: true });
        else { onStatus?.(status); resolve({ status, headers: pres.headers, body: Buffer.concat(chunks) }); }
      });
      pres.on('error', (e) => {
        if (settled) return;
        settled = true;
        try { res.destroy(); } catch { /* ignore */ }
        reject(e);
      });
    });
    preq.on('error', () => {
      if (settled) return;
      settled = true;
      deny(res, 502, 'upstream error');
      reject(new Error('upstream-error'));
    });
    if (body && body.length) preq.end(body); else preq.end();
  });
}
```

`createProxyHandler` 签名与 key 选择改造：

```js
export function createProxyHandler({ vault, getProvider, isEnabled, cache = null, plugins = [], keyPool = createKeyPool(), logger = console }) {
```

把「解析出 provider … 构造 headers」这段改为：

```js
    const provider = getProvider(ctx.providerId);
    if (!provider || !provider.baseURL) return deny(res, 404, 'provider not found');

    let target;
    try { target = resolveTarget(provider.baseURL, ctx.path, ctx.query); } catch { return deny(res, 502, 'bad upstream'); }

    const keyList = (provider.apiKeys && provider.apiKeys.length) ? provider.apiKeys : (provider.apiKey ? [provider.apiKey] : []);
    const upstreamKey = keyPool.next(ctx.providerId, keyList);
    const coolIfError = (status) => {
      if (upstreamKey && (status === 401 || status === 403 || status === 429 || status >= 500)) keyPool.cool(ctx.providerId, upstreamKey);
    };
    const headers = injectUpstreamAuth(ctx.headers, upstreamKey);
    if (Buffer.isBuffer(ctx.body) && ctx.body.length) headers['content-length'] = String(ctx.body.length);

    if (isStreaming(ctx) || !activeCache) {
      return pipeUpstream(res, target, ctx.method, headers, ctx.body, coolIfError);
    }
```

把 `bufferUpstream` 调用改为传入 `coolIfError`：

```js
      out = await bufferUpstream(res, target, ctx.method, headers, ctx.body, RESPONSE_LIMIT, coolIfError);
```

> 说明：`injectUpstreamAuth(headers, '')` 会删除鉴权头（无 key 时与现状一致）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-proxy.test.js"`
Expected: PASS（原 9 + 新增 2 = 11 tests）

- [ ] **Step 5: 提交**

```
git add server/llm-proxy.js server/test/llm-proxy.test.js
git commit -m "feat(server): 中转代理多 key 轮询并失败冷却"
```

---

### Task 4: 抽出 OS reveal `server/reveal.js`

**Files:**
- Create: `server/reveal.js`
- Modify: `server/http-api.js`

- [ ] **Step 1: 新建** — `server/reveal.js`（内容来自原 `http-api.js:13-39`）

```js
import path from 'node:path';
import { spawn } from 'node:child_process';

// 在宿主机上用系统文件管理器展示目标（文件 → 定位选中；目录 → 打开）。
// Windows：直接 spawn explorer（/select 必须作为同一参数），不要用 cmd start（会回退到“文档”）。
export function revealInOs(abs, isDir) {
  if (process.platform === 'win32') {
    const arg = isDir ? abs : `/select,${abs}`;
    const p = spawn('explorer', [arg], { detached: true, stdio: 'ignore' });
    p.unref();
    setTimeout(() => {
      const focus = spawn('powershell.exe', [
        '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
        `$sh=New-Object -ComObject WScript.Shell; $w=Get-Process explorer | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -Last 1; if ($w) { [void]$sh.AppActivate($w.Id) }`,
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      focus.unref();
    }, 400);
    return true;
  }
  if (process.platform === 'darwin') {
    const p = spawn('open', isDir ? [abs] : ['-R', abs], { detached: true, stdio: 'ignore' });
    p.unref();
    return true;
  }
  if (process.platform === 'linux') {
    const p = spawn('xdg-open', [isDir ? abs : path.dirname(abs)], { detached: true, stdio: 'ignore' });
    p.unref();
    return true;
  }
  return false;
}
```

- [ ] **Step 2: 改 `server/http-api.js`**

新增 import：

```js
import { revealInOs } from './reveal.js';
```

删除原第 11–39 行的 `revealInOs` 函数定义（含上方两行注释）——`runScript` 及其后的代码保持不动。

- [ ] **Step 3: 回归验证（http-api 相关测试）**

Run: `node --test "server/test/http-api.test.js"`
Expected: PASS（与改动前一致；reveal 逻辑未变）

- [ ] **Step 4: 提交**

```
git add server/reveal.js server/http-api.js
git commit -m "refactor(server): 抽出 revealInOs 供中转站复用"
```

---

### Task 5: 起手模板与写文件 `server/relay-plugins.js`

**Files:**
- Modify: `server/relay-plugins.js`
- Test: `server/test/relay-plugins.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/relay-plugins.test.js` 顶部 import 增加 `EXAMPLE_PLUGIN, writeExamplePlugin`：

```js
import { loadPlugins, runRequestPlugins, runResponsePlugins, pluginCacheKeyOverride, seedPlugins, EXAMPLE_PLUGIN, writeExamplePlugin } from '../relay-plugins.js';
```

末尾追加：

```js
test('writeExamplePlugin 写入默认名、重名顺延、不覆盖', () => {
  const dir = path.join(tmpDir(), 'plugins');
  assert.equal(writeExamplePlugin(dir), 'my-plugin.mjs');
  assert.match(fs.readFileSync(path.join(dir, 'my-plugin.mjs'), 'utf8'), /name: 'my-plugin'/);
  assert.equal(writeExamplePlugin(dir), 'my-plugin-2.mjs');
  assert.equal(writeExamplePlugin(dir), 'my-plugin-3.mjs');
  assert.match(EXAMPLE_PLUGIN, /onRequest/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/relay-plugins.test.js"`
Expected: FAIL（`EXAMPLE_PLUGIN` / `writeExamplePlugin` 未导出）

- [ ] **Step 3: 实现** — `server/relay-plugins.js` 末尾追加：

```js
export const EXAMPLE_PLUGIN = `// DevFlow relay plugin (starter).
// Copy/edit this file, then click "Reload plugins" in the Relay panel.
export default {
  name: 'my-plugin',
  priority: 100,
  onRequest(ctx) {
    // Example: add a header on the way upstream.
    ctx.headers['x-relay-by'] = 'devflow';
  },
  // onCacheKey(ctx) {
  //   // return null to bypass cache, or { ttlMs: 60000 } to override TTL.
  //   return { ttlMs: 60000 };
  // },
  // onResponse(ctx) {
  //   // Runs for non-streaming responses only.
  // },
};
`;

export function writeExamplePlugin(dir, content = EXAMPLE_PLUGIN) {
  fs.mkdirSync(dir, { recursive: true });
  let name = 'my-plugin.mjs';
  let i = 2;
  while (fs.existsSync(path.join(dir, name))) { name = `my-plugin-${i}.mjs`; i += 1; }
  fs.writeFileSync(path.join(dir, name), content);
  return name;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/relay-plugins.test.js"`
Expected: PASS（原 7 + 新增 1 = 8 tests）

- [ ] **Step 5: 提交**

```
git add server/relay-plugins.js server/test/relay-plugins.test.js
git commit -m "feat(server): 插件起手模板与一键写入"
```

---

### Task 6: 接口 template/example/reveal `server/llm-mount.js`

**Files:**
- Modify: `server/llm-mount.js`
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/llm-mount.test.js` 顶部 import 增加 `fs`/`os`/`path` 已存在，保持；在末尾追加（并新增一个启动任意 mount 的 helper）：

```js
function startMount(mount) {
  const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://x'); mount(req, res, url); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('插件示例模板与一键生成（重名顺延）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpl-'));
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, pluginsDir: dir });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  const list = JSON.parse((await jget(server, '/api/llm-admin/plugins')).body);
  assert.match(list.template, /my-plugin/);
  const r1 = await jpost(server, '/api/llm-admin/plugins/example', {});
  assert.equal(r1.status, 200);
  assert.equal(JSON.parse(r1.body).file, 'my-plugin.mjs');
  assert.deepEqual(JSON.parse(r1.body).entries.map((e) => e.name), ['my-plugin']);
  const r2 = await jpost(server, '/api/llm-admin/plugins/example', {});
  assert.equal(JSON.parse(r2.body).file, 'my-plugin-2.mjs');
});

test('打开插件目录调用 reveal；无目录 400', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpl-'));
  const vault = tmpVault();
  vault.init('pw');
  const calls = [];
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, pluginsDir: dir, reveal: (abs, isDir) => { calls.push([abs, isDir]); return true; } });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  const r = await jpost(server, '/api/llm-admin/plugins/reveal', {});
  assert.equal(r.status, 200);
  assert.deepEqual(calls, [[dir, true]]);

  const mount2 = createLlmMount({ vault, host: '127.0.0.1', port: 1234, pluginsDir: null });
  await mount2.ready;
  const server2 = await startMount(mount2);
  t.after(() => server2.close());
  assert.equal((await jpost(server2, '/api/llm-admin/plugins/example', {})).status, 400);
  assert.equal((await jpost(server2, '/api/llm-admin/plugins/reveal', {})).status, 400);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: FAIL（`/plugins/example` 404 / `reveal` 未定义 / template 缺失）

- [ ] **Step 3: 实现** — `server/llm-mount.js`

顶部 import 增加：

```js
import fs from 'node:fs';
import { revealInOs } from './reveal.js';
import { EXAMPLE_PLUGIN, writeExamplePlugin } from './relay-plugins.js';
```

（`loadPlugins` 已从 `./relay-plugins.js` 导入，合并到同一行即可。）

`createLlmMount` 签名增加 `reveal`：

```js
export function createLlmMount({ vault, host, port, logger = console, pluginsDir = null, cache = createCache(), reveal = revealInOs } = {}) {
```

GET plugins 返回体加 `template`：

```js
      if (seg[0] === 'plugins' && !seg[1] && method === 'GET') return sendJson(res, 200, { entries, dir: pluginsDir, template: EXAMPLE_PLUGIN });
```

在 GET plugins 之后、vault 分支之前新增 reveal（免解锁）：

```js
      if (seg[0] === 'plugins' && seg[1] === 'reveal' && method === 'POST') {
        if (!pluginsDir) return sendJson(res, 400, { error: 'no-plugins-dir' });
        fs.mkdirSync(pluginsDir, { recursive: true });
        return reveal(pluginsDir, true) ? sendJson(res, 200, { ok: true }) : sendJson(res, 501, { error: 'unsupported' });
      }
```

在 `if (locked()) ...` 之后新增 example（需解锁）：

```js
      if (seg[0] === 'plugins' && seg[1] === 'example' && method === 'POST') {
        if (!pluginsDir) return sendJson(res, 400, { error: 'no-plugins-dir' });
        const file = writeExamplePlugin(pluginsDir);
        return sendJson(res, 200, { entries: await reloadPlugins(), file });
      }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS（原 5 + 新增 2 = 7 tests）

- [ ] **Step 5: 提交**

```
git add server/llm-mount.js server/test/llm-mount.test.js
git commit -m "feat(server): 插件示例/一键生成/打开目录接口"
```

---

### Task 7: 前端面板与 i18n

**Files:**
- Modify: `web/src/useLlm.ts`
- Modify: `web/src/components/ProxyView.vue`
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 改 `web/src/useLlm.ts`**

把 `plugins` 行替换为：

```ts
    plugins: () => json<{ entries: LlmPluginEntry[]; dir: string | null; template: string }>('/api/llm-admin/plugins'),
    createPluginExample: () => post<{ entries: LlmPluginEntry[]; file: string }>('/api/llm-admin/plugins/example', {}),
    revealPlugins: () => post<{ ok: boolean }>('/api/llm-admin/plugins/reveal', {}),
```

- [ ] **Step 2: 改 `ProxyView.vue` 的 script**

在 `const pluginDir = ref('');` 后追加：

```ts
const pluginTemplate = ref('');
const exampleCopied = ref(false);
let exampleTimer: ReturnType<typeof setTimeout> | null = null;
```

`refresh()` 里插件赋值处追加 `pluginTemplate.value = pl.template || '';`（即在 `pluginDir.value = pl.dir || '';` 之后）。

在 `const reloadPlugins = ...` 后追加：

```ts
const openPluginsDir = () => run(() => api.revealPlugins());
const createExample = () => run(() => api.createPluginExample());
async function copyExample() {
  if (!pluginTemplate.value) return;
  try {
    await navigator.clipboard.writeText(pluginTemplate.value);
    exampleCopied.value = true;
    if (exampleTimer) clearTimeout(exampleTimer);
    exampleTimer = setTimeout(() => { exampleCopied.value = false; }, 1500);
  } catch { /* ignore */ }
}
```

- [ ] **Step 3: 改 `ProxyView.vue` 模板**

把插件 `<section>` 整段替换为：

```html
    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.plugins.title') }}
        <span class="row">
          <button class="ghost" @click="reloadPlugins">{{ $t('llm.plugins.reload') }}</button>
          <button class="ghost" @click="createExample">{{ $t('llm.plugins.new') }}</button>
          <button class="ghost" @click="openPluginsDir">{{ $t('llm.plugins.open') }}</button>
        </span>
      </div>
      <div class="muted">{{ $t('llm.plugins.dir', { dir: pluginDir }) }}</div>
      <div class="muted">{{ $t('llm.plugins.hint') }}</div>
      <div v-if="!pluginList.length" class="muted">{{ $t('llm.plugins.empty') }}</div>
      <div v-for="p in pluginList" :key="p.file + '::' + p.name" class="prow">
        <b>{{ p.name || p.file }}</b>
        <span class="muted">{{ p.file }} · p{{ p.priority }}</span>
        <span v-if="p.error" class="warn">{{ $t('llm.plugins.error') }}</span>
      </div>
      <details class="ex">
        <summary>{{ $t('llm.plugins.example.title') }}
          <button class="ghost" @click.prevent="copyExample">{{ exampleCopied ? $t('llm.plugins.example.copied') : $t('llm.plugins.example.copy') }}</button>
        </summary>
        <pre class="cfg">{{ pluginTemplate }}</pre>
      </details>
    </section>
```

在 `<style scoped>` 末尾追加：

```css
.ex summary { cursor: pointer; color: var(--tx2); font-size: 12px; display: flex; gap: 8px; align-items: center; }
.ex .cfg { margin-top: 8px; }
```

- [ ] **Step 4: 加 i18n 词条**

`shared/i18n/zh-CN.js` 在 `'llm.plugins.error'` 之后插入：

```js
  'llm.plugins.new': '生成示例插件',
  'llm.plugins.open': '打开目录',
  'llm.plugins.example.title': '插件示例',
  'llm.plugins.example.copy': '复制',
  'llm.plugins.example.copied': '已复制',
```

`shared/i18n/en.js` 在 `'llm.plugins.error'` 之后插入：

```js
  'llm.plugins.new': 'New example plugin',
  'llm.plugins.open': 'Open folder',
  'llm.plugins.example.title': 'Plugin example',
  'llm.plugins.example.copy': 'Copy',
  'llm.plugins.example.copied': 'Copied',
```

- [ ] **Step 5: 类型检查 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 6: 提交**

```
git add web/src/useLlm.ts web/src/components/ProxyView.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 插件示例、一键生成与打开目录"
```

---

### Task 8: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1:** `npm.cmd run test:server` → 全绿。
- [ ] **Step 2:** `npm.cmd run test:web` → 全绿。
- [ ] **Step 3:** `npm.cmd run typecheck` → 无错误。
- [ ] **Step 4:** `npm.cmd run check:i18n` → 零命中。
- [ ] **Step 5:** `npm.cmd run build:web` → 构建成功。
- [ ] **Step 6: 人工验收（异步启动）**
  1. 后台启动 `node server/index.js`，面板 → 中转站 → 解锁。
  2. 点「生成示例插件」→ 列表出现 `my-plugin`；点「打开目录」→ 资源管理器定位到插件目录。
  3. 展开「插件示例」→ 显示模板，可复制。
  4. 在 opencode.json 给某 provider 配 `options.apiKeys: ["A","B"]` → 重启后端 → 连续请求该 provider，上游 `authorization` 交替 A/B；故意让 A 返回 429 → 后续请求跳过 A。
- [ ] **Step 7: 最终提交（如有微调）**

```
git status
git add <本次调整涉及的文件>
git commit -m "chore: 多 key 与插件引导验证收尾"
```

---

## 自查记录

- **Spec 覆盖**：§14 多 key→Task 1/2/3；§15 引导→Task 4/5/6/7；§16 测试→各 Task + Task 8。
- **占位符扫描**：无 TBD；每步含完整代码。
- **类型一致性**：`provider.apiKeys` 在 Task 2 定义、Task 3 消费；`createKeyPool().next/cool/isCooling/clear` 自 Task 1 起一致；`EXAMPLE_PLUGIN`/`writeExamplePlugin` 在 Task 5 定义、Task 6 消费；`plugins` 前端返回类型与 Task 6 的 `{ entries, dir, template }` 对齐。
- **默认行为**：无 `apiKeys` 回退 `apiKey`；无 key 时 `injectUpstreamAuth` 不注入鉴权头（与改动前一致）。
