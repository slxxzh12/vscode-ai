# 中转站插件管线与响应缓存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给现有 LLM 中转站增加「用户目录 JS 转换插件管线」与「非流式响应内存缓存」，并种入示例插件与说明。

**Architecture:** `llm-proxy` 改为「读全请求体 → 跑 `onRequest` 插件 → 解析目标 → 流式直传 / 非流式缓冲 → 跑 `onResponse` → 命中即回放缓存」。插件由 `relay-plugins` 从 `<dataHome>/downloads/relay-plugins/*.mjs` 动态 `import` 并串行执行；缓存由 `llm-cache` 提供内存 LRU+TTL。仓库 `config/relay-plugins/` 作模板，首次启动 seed 到用户目录（只补缺失、不覆盖）。

**Tech Stack:** Node ESM、`node:http`/`node:https`、`node:crypto`、`node:test`；Vue3 + TS（前端）；i18n 中英对称。

**Spec:** `docs/superpowers/specs/2026-09-12-relay-plugins-cache-design.md`

**约定:**
- 所有命令在仓库根执行；PowerShell 用 `npm.cmd`，后端测试用 `node --test "server/test/xxx.test.js"`。
- 用户可见文案一律进 `shared/i18n/{zh-CN,en}.js`，提交前 `npm.cmd run check:i18n`。
- 每个 Task 结束提交一次。

---

## 文件结构

- Create `server/llm-cache.js` — 内存 LRU+TTL 缓存与规范化 key。
- Create `server/relay-plugins.js` — 插件加载、管线执行、示例种子。
- Create `server/test/llm-cache.test.js`、`server/test/relay-plugins.test.js`。
- Create `config/relay-plugins/README.md` + `config/relay-plugins/example-*.mjs.example`（5 个）。
- Modify `server/data-home.js` — 加 `relayPluginsDir()`。
- Modify `server/llm-proxy.js` — 缓冲 + 插件管线 + 缓存。
- Modify `server/llm-mount.js` — 构造 cache/plugins，加管理接口。
- Modify `server/index.js` — seed 模板 + 传 `pluginsDir`。
- Modify `server/test/data-home.test.js`、`server/test/llm-proxy.test.js`、`server/test/llm-mount.test.js`。
- Modify `web/src/useLlm.ts`、`web/src/components/ProxyView.vue`、`shared/i18n/{zh-CN,en}.js`。

---

### Task 1: 缓存模块 `server/llm-cache.js`

**Files:**
- Create: `server/llm-cache.js`
- Test: `server/test/llm-cache.test.js`

- [ ] **Step 1: 写失败测试** — `server/test/llm-cache.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache, cacheKey, normalizeBody } from '../llm-cache.js';

test('normalizeBody 字段顺序无关，非 JSON 退化为 base64', () => {
  assert.equal(normalizeBody(Buffer.from('{"a":1,"b":2}')), normalizeBody(Buffer.from('{ "b": 2, "a": 1 }')));
  assert.equal(normalizeBody(Buffer.from('hello')), Buffer.from('hello').toString('base64'));
});

test('cacheKey 同 provider 同 body（顺序无关）同 key，不同 provider 不同 key', () => {
  const a = cacheKey('p1', 'POST', Buffer.from('{"model":"m","messages":[]}'));
  const b = cacheKey('p1', 'POST', Buffer.from('{"messages":[],"model":"m"}'));
  const c = cacheKey('p2', 'POST', Buffer.from('{"messages":[],"model":"m"}'));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('set/get 命中，TTL 过期后 miss', () => {
  const cache = createCache({ ttlMs: 60000 });
  const v = { status: 200, headers: {}, body: Buffer.from('x') };
  cache.set('k', v);
  assert.deepEqual(cache.get('k'), v);
  const now = Date.now();
  cache.set('k2', v, 10);
  assert.equal(cache.get('k2', { now: now + 1000 }), undefined);
});

test('maxEntries 触发 LRU 淘汰', () => {
  const cache = createCache({ maxEntries: 2 });
  cache.set('a', { status: 200, headers: {}, body: Buffer.from('a') });
  cache.set('b', { status: 200, headers: {}, body: Buffer.from('b') });
  cache.get('a');
  cache.set('c', { status: 200, headers: {}, body: Buffer.from('c') });
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a'));
  assert.ok(cache.get('c'));
});

test('超过 maxBytes 不写入', () => {
  const cache = createCache({ maxBytes: 4 });
  assert.equal(cache.set('big', { status: 200, headers: {}, body: Buffer.from('12345') }), false);
  assert.equal(cache.get('big'), undefined);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-cache.test.js"`
Expected: FAIL（`Cannot find module '../llm-cache.js'`）

- [ ] **Step 3: 实现** — `server/llm-cache.js`

```js
import crypto from 'node:crypto';

export function normalizeBody(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body == null ? '' : String(body));
  const text = buf.toString('utf8');
  try {
    return JSON.stringify(sortDeep(JSON.parse(text)));
  } catch {
    return buf.toString('base64');
  }
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

export function cacheKey(providerId, method, body) {
  return crypto.createHash('sha256')
    .update(`${providerId}\n${String(method || 'GET').toUpperCase()}\n${normalizeBody(body)}`)
    .digest('hex');
}

function bodyBytes(value) {
  if (!value) return 0;
  if (Buffer.isBuffer(value.body)) return value.body.length;
  return Buffer.byteLength(String(value.body == null ? '' : value.body));
}

export function createCache({ ttlMs = 10 * 60 * 1000, maxEntries = 256, maxBytes = 64 * 1024 * 1024 } = {}) {
  const map = new Map();
  let bytes = 0;
  let seq = 0;
  const counters = { hits: 0, misses: 0 };

  function drop(key) {
    const entry = map.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    map.delete(key);
  }
  function evict() {
    while (map.size > maxEntries || bytes > maxBytes) {
      let oldestKey = null;
      let oldest = Infinity;
      for (const [k, e] of map) if (e.used < oldest) { oldest = e.used; oldestKey = k; }
      if (oldestKey === null) break;
      drop(oldestKey);
    }
  }

  return {
    keyFor: cacheKey,
    get(key, { now = Date.now() } = {}) {
      const entry = map.get(key);
      if (!entry) { counters.misses += 1; return undefined; }
      if (entry.expiresAt <= now) { drop(key); counters.misses += 1; return undefined; }
      entry.used = ++seq;
      counters.hits += 1;
      return entry.value;
    },
    set(key, value, ttl = ttlMs) {
      const size = bodyBytes(value);
      if (size > maxBytes) return false;
      drop(key);
      map.set(key, { value, expiresAt: Date.now() + ttl, bytes: size, used: ++seq });
      bytes += size;
      evict();
      return true;
    },
    clear() { map.clear(); bytes = 0; },
    stats() { return { entries: map.size, bytes, ...counters }; },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-cache.test.js"`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```
git add server/llm-cache.js server/test/llm-cache.test.js
git commit -m "feat(server): 中转响应缓存 llm-cache（内存 LRU+TTL）"
```

---

### Task 2: 插件加载与管线 `server/relay-plugins.js`

**Files:**
- Create: `server/relay-plugins.js`
- Test: `server/test/relay-plugins.test.js`

- [ ] **Step 1: 写失败测试** — `server/test/relay-plugins.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPlugins, runRequestPlugins, runResponsePlugins, pluginCacheKeyOverride, seedPlugins } from '../relay-plugins.js';

const noLog = { warn() {} };
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfp-')); }
function write(dir, file, code) { fs.writeFileSync(path.join(dir, file), code); }

test('loadPlugins 按 priority 排序并汇报加载失败', async () => {
  const dir = tmpDir();
  write(dir, 'b.mjs', 'export default { name: "b", priority: 200, onRequest: () => {} };');
  write(dir, 'a.mjs', 'export default { name: "a", priority: 10, onRequest: () => {} };');
  write(dir, 'bad.mjs', 'export default { notAPlugin: true };');
  const { plugins, entries } = await loadPlugins(dir);
  assert.deepEqual(plugins.map((p) => p.name), ['a', 'b']);
  assert.equal(entries.find((e) => e.file === 'bad.mjs').error, 'no-plugin-export');
});

test('目录不存在返回空集', async () => {
  const { plugins, entries } = await loadPlugins(path.join(tmpDir(), 'nope'));
  assert.deepEqual(plugins, []);
  assert.deepEqual(entries, []);
});

test('runRequestPlugins 支持 match 过滤与对象返回改写', async () => {
  const plugins = [
    { name: 'only-post', priority: 1, match: (c) => c.method === 'POST', onRequest: (c) => { c.headers['x-a'] = '1'; } },
    { name: 'rewrite', priority: 2, onRequest: () => ({ path: '/new', providerId: 'p2' }) },
  ];
  const ctx = { method: 'GET', path: '/old', providerId: 'p1', headers: {}, body: Buffer.from('') };
  await runRequestPlugins(plugins, ctx, noLog);
  assert.equal(ctx.headers['x-a'], undefined);
  assert.equal(ctx.path, '/new');
  assert.equal(ctx.providerId, 'p2');
});

test('onRequest 抛错默认抛出，failOpen 跳过', async () => {
  const boom = { name: 'boom', onRequest: () => { throw new Error('x'); } };
  await assert.rejects(runRequestPlugins([boom], { headers: {} }, noLog));
  const ctx = { headers: {}, path: '/x' };
  await runRequestPlugins([{ ...boom, failOpen: true }], ctx, noLog);
  assert.equal(ctx.path, '/x');
});

test('runResponsePlugins 改写响应', async () => {
  const p = { name: 'r', onResponse: () => ({ status: 201, body: Buffer.from('ok') }) };
  const ctx = { status: 200, headers: {}, body: Buffer.from('') };
  await runResponsePlugins([p], ctx, noLog);
  assert.equal(ctx.status, 201);
  assert.equal(ctx.body.toString(), 'ok');
});

test('pluginCacheKeyOverride 返回 null 绕过、对象覆盖', () => {
  assert.equal(pluginCacheKeyOverride([{ name: 'k', onCacheKey: () => null }], {}), null);
  assert.deepEqual(pluginCacheKeyOverride([{ name: 'k', onCacheKey: () => ({ key: 'K', ttlMs: 5 }) }], {}), { key: 'K', ttlMs: 5 });
});

test('seedPlugins 只补缺失、不覆盖', () => {
  const src = tmpDir();
  write(src, 'README.md', 'r');
  write(src, 'example-x.mjs.example', 'e');
  const dst = path.join(tmpDir(), 'plugins');
  const first = seedPlugins(dst, src).sort();
  assert.deepEqual(first, ['README.md', 'example-x.mjs.example']);
  write(dst, 'README.md', 'custom');
  assert.deepEqual(seedPlugins(dst, src), []);
  assert.equal(fs.readFileSync(path.join(dst, 'README.md'), 'utf8'), 'custom');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/relay-plugins.test.js"`
Expected: FAIL（`Cannot find module '../relay-plugins.js'`）

- [ ] **Step 3: 实现** — `server/relay-plugins.js`

```js
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function normalizeExport(mod) {
  const def = mod && mod.default !== undefined ? mod.default : mod;
  const list = Array.isArray(def) ? def : [def];
  return list.filter((p) => p && typeof p === 'object' && typeof p.name === 'string' && p.name);
}

export async function loadPlugins(dir) {
  const plugins = [];
  const entries = [];
  if (!dir || !fs.existsSync(dir)) return { plugins, entries };
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  } catch {
    return { plugins, entries };
  }
  const stamp = Date.now();
  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const mod = await import(`${pathToFileURL(full).href}?v=${stamp}`);
      const list = normalizeExport(mod);
      if (!list.length) {
        entries.push({ file, name: '', priority: 100, error: 'no-plugin-export' });
        continue;
      }
      for (const p of list) {
        const priority = Number.isFinite(p.priority) ? p.priority : 100;
        plugins.push({ ...p, priority, file });
        entries.push({ file, name: p.name, priority, error: null });
      }
    } catch (e) {
      entries.push({ file, name: '', priority: 100, error: String((e && e.message) || e) });
    }
  }
  plugins.sort((a, b) => a.priority - b.priority);
  return { plugins, entries };
}

function applies(plugin, ctx) {
  if (typeof plugin.match !== 'function') return true;
  try { return !!plugin.match(ctx); } catch { return false; }
}

async function runHook(hook, plugin, ctx, logger) {
  if (!applies(plugin, ctx) || typeof plugin[hook] !== 'function') return;
  try {
    const out = await plugin[hook](ctx);
    if (out && typeof out === 'object') Object.assign(ctx, out);
  } catch (e) {
    logger?.warn?.(`relay plugin ${plugin.name} ${hook} failed: ${(e && e.message) || e}`);
    if (!plugin.failOpen) {
      const err = new Error('plugin-error');
      err.pluginError = true;
      throw err;
    }
  }
}

export async function runRequestPlugins(plugins, ctx, logger = console) {
  for (const p of plugins) await runHook('onRequest', p, ctx, logger);
  return ctx;
}

export async function runResponsePlugins(plugins, ctx, logger = console) {
  for (const p of plugins) await runHook('onResponse', p, ctx, logger);
  return ctx;
}

export function pluginCacheKeyOverride(plugins, ctx, logger = console) {
  for (const p of plugins) {
    if (typeof p.onCacheKey !== 'function' || !applies(p, ctx)) continue;
    try {
      const out = p.onCacheKey(ctx);
      if (out === null) return null;
      if (out && typeof out === 'object') return out;
    } catch (e) {
      logger?.warn?.(`relay plugin ${p.name} onCacheKey failed: ${(e && e.message) || e}`);
      if (!p.failOpen) {
        const err = new Error('plugin-error');
        err.pluginError = true;
        throw err;
      }
    }
  }
  return undefined;
}

export function seedPlugins(destDir, templateDir) {
  if (!destDir || !templateDir || !fs.existsSync(templateDir)) return [];
  fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const name of fs.readdirSync(templateDir).sort()) {
    const src = path.join(templateDir, name);
    if (!fs.statSync(src).isFile()) continue;
    const dst = path.join(destDir, name);
    if (fs.existsSync(dst)) continue;
    fs.copyFileSync(src, dst);
    copied.push(name);
  }
  return copied;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/relay-plugins.test.js"`
Expected: PASS（7 tests）

- [ ] **Step 5: 提交**

```
git add server/relay-plugins.js server/test/relay-plugins.test.js
git commit -m "feat(server): 中转转换插件加载与管线"
```

---

### Task 3: 插件目录 `relayPluginsDir()`

**Files:**
- Modify: `server/data-home.js`（在 `downloadsDir()` 之后追加）
- Test: `server/test/data-home.test.js`

- [ ] **Step 1: 改测试** — `server/test/data-home.test.js` 全文替换为：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadsDir, relayPluginsDir } from '../data-home.js';

test('downloadsDir 指向 dataHome/downloads', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'df-data-'));
  const prev = process.env.DEVFLOW_DATA_HOME;
  process.env.DEVFLOW_DATA_HOME = data;
  try {
    assert.equal(downloadsDir(), path.join(data, 'downloads'));
    assert.equal(relayPluginsDir(), path.join(data, 'downloads', 'relay-plugins'));
  } finally {
    if (prev === undefined) delete process.env.DEVFLOW_DATA_HOME; else process.env.DEVFLOW_DATA_HOME = prev;
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/data-home.test.js"`
Expected: FAIL（`relayPluginsDir is not a function`）

- [ ] **Step 3: 实现** — `server/data-home.js` 在 `downloadsDir()` 函数后追加：

```js
// 中转站转换插件目录（<dataHome>/downloads/relay-plugins）；仅加载其下 *.mjs
export function relayPluginsDir() {
  return path.join(downloadsDir(), 'relay-plugins');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/data-home.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/data-home.js server/test/data-home.test.js
git commit -m "feat(server): 新增中转插件目录 relayPluginsDir"
```

---

### Task 4: 插件模板与示例 `config/relay-plugins/`

**Files:**
- Create: `config/relay-plugins/README.md`
- Create: `config/relay-plugins/example-header.mjs.example`
- Create: `config/relay-plugins/example-defaults.mjs.example`
- Create: `config/relay-plugins/example-sanitize.mjs.example`
- Create: `config/relay-plugins/example-route.mjs.example`
- Create: `config/relay-plugins/example-cache.mjs.example`

> 说明：`.md` 与 `.mjs.example` 都不被 `scripts/check-i18n.js` 扫描（它只看 `web/src`、`server` 下的 `.js|.ts|.vue`），也不被 loader 加载（只认 `*.mjs`）。

- [ ] **Step 1: 写 README** — `config/relay-plugins/README.md`

```markdown
# 中转站转换插件

把 `*.mjs` 文件放进本目录，然后在 devflow 面板「中转站 → 转换插件」点「重载插件」即生效，无需重启服务。
本目录首次生成时附带 `example-*.mjs.example`，把文件名末尾的 `.example` 去掉（改成 `*.mjs`）即启用。

## 插件长什么样

```js
export default {
  name: 'my-plugin',   // 必填，唯一
  priority: 100,       // 可选，默认 100；升序执行，小的先跑
  failOpen: false,     // 可选，默认 false（钩子抛错→请求 502）；true 则跳过本插件继续
  match: ({ providerId, method, path }) => true,   // 可选，不命中则本次不参与
  onRequest: (ctx) => { /* 改 url/header/body */ },
  onCacheKey: (ctx) => ({ key, ttlMs }) || null,   // 可选；null = 本次绕过缓存
  onResponse: (ctx) => { /* 仅非流式；改响应 */ },
};
```

## 钩子与执行时机

- `onRequest`：请求转发上游前。可改 `ctx.providerId`（跨上游路由）、`ctx.path`、`ctx.query`、`ctx.headers`、`ctx.body`。
- `onCacheKey`：非流式请求算缓存 key 时。返回 `null` 绕过缓存；返回 `{ key, ttlMs }` 可只覆盖其中一项。
- `onResponse`：**仅非流式**响应；`stream:true` 或 `Accept: text/event-stream` 的响应直接透传，不会调用。

钩子可 `async`。返回 `undefined` 表示就地修改 `ctx`；返回对象则对 `providerId`/`path`/`query`/`headers`/`body`/`status` 做局部覆盖。

## ctx 字段

- `providerId`：当前上游 id。
- `method` / `path` / `query`：请求方法、路径（`/api/llm/<pid>` 之后的部分）、查询串。
- `headers`：请求头对象（可直接改）。
- `body`：请求体 `Buffer`。
- `json`：请求体 JSON 解析结果（非 JSON 为 `undefined`）。
- `provider`：`{ id, name, baseURL, hasKey }`（不含上游 apiKey 明文）。
- `onResponse` 额外有 `status`、`headers`、`body`（响应）。

## 注意

- 改了 `json` 后要用 `ctx.body = Buffer.from(JSON.stringify(ctx.json))` 同步；`content-length` 由中转站按最终 `ctx.body` 重算。
- 插件运行在服务主进程，能力等同服务端（可读密钥库）。**只放你自己信任的插件。**
- 加载失败或语法错误会在面板插件列表显示错误，不影响服务运行。
```

- [ ] **Step 2: 协议兼容示例** — `config/relay-plugins/example-header.mjs.example`

```js
// 协议兼容：补上游需要的头、加自定义追踪头。改名去掉 .example 即启用。
export default {
  name: 'header-compat',
  priority: 100,
  onRequest(ctx) {
    if (!ctx.headers['anthropic-version']) ctx.headers['anthropic-version'] = '2023-06-01';
    ctx.headers['x-relay-by'] = 'devflow';
  },
};
```

- [ ] **Step 3: 请求增强示例** — `config/relay-plugins/example-defaults.mjs.example`

```js
// 请求增强：注入默认 temperature，并给 max_tokens 封顶。
export default {
  name: 'request-defaults',
  priority: 100,
  onRequest(ctx) {
    if (!ctx.json || typeof ctx.json !== 'object') return;
    if (ctx.json.temperature === undefined) ctx.json.temperature = 0.2;
    if (typeof ctx.json.max_tokens === 'number' && ctx.json.max_tokens > 4096) ctx.json.max_tokens = 4096;
    ctx.body = Buffer.from(JSON.stringify(ctx.json), 'utf8');
  },
};
```

- [ ] **Step 4: 脱敏示例** — `config/relay-plugins/example-sanitize.mjs.example`

```js
// 安全脱敏：删除不希望外发的字段。priority 小，先于其它插件执行。
export default {
  name: 'sanitize',
  priority: 10,
  onRequest(ctx) {
    if (!ctx.json || typeof ctx.json !== 'object') return;
    delete ctx.json.metadata;
    delete ctx.json.extra_headers;
    ctx.body = Buffer.from(JSON.stringify(ctx.json), 'utf8');
  },
};
```

- [ ] **Step 5: 路由示例** — `config/relay-plugins/example-route.mjs.example`

```js
// 按内容路由：body.model 以 "cheap-" 开头时改走另一个上游 provider（id 需在你的 opencode.json 中存在）。
export default {
  name: 'route-by-model',
  priority: 50,
  onRequest(ctx) {
    const model = ctx.json && ctx.json.model;
    if (typeof model === 'string' && model.startsWith('cheap-')) ctx.providerId = 'local';
  },
};
```

- [ ] **Step 6: 缓存策略示例** — `config/relay-plugins/example-cache.mjs.example`

```js
// 缓存策略：temperature>0 结果不确定，返回 null 绕过缓存；否则自定义 TTL。
export default {
  name: 'cache-policy',
  priority: 60,
  onCacheKey(ctx) {
    const temp = ctx.json && ctx.json.temperature;
    if (typeof temp === 'number' && temp > 0) return null;
    return { ttlMs: 60 * 1000 };
  },
};
```

- [ ] **Step 7: 提交**

```
git add config/relay-plugins
git commit -m "docs(config): 中转插件 README 与示例模板"
```

---

### Task 5: 代理改造 `server/llm-proxy.js`（缓冲 + 管线 + 缓存）

**Files:**
- Modify: `server/llm-proxy.js`（整文件替换）
- Test: `server/test/llm-proxy.test.js`（追加新用例）

- [ ] **Step 1: 追加失败测试** — 在 `server/test/llm-proxy.test.js` 顶部 import 增加：

```js
import { createCache } from '../llm-cache.js';
```

并在文件末尾追加：

```js
async function startProxy({ vault, getProvider, isEnabled, cache, plugins }) {
  const handler = createProxyHandler({ vault, getProvider, isEnabled, cache, plugins, logger: { warn() {} } });
  const front = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    handler(req, res, { providerId: 'corp', rest: u.pathname, query: u.search.replace(/^\?/, '') });
  });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  return front;
}

test('非流式同 body 二次请求命中缓存', async (t) => {
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    calls += 1;
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ n: calls, body: b })); });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  const front = await startProxy({ vault, getProvider: () => ({ baseURL, apiKey: 'UP' }), isEnabled: () => true, cache: createCache() });
  t.after(() => front.close());
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
  const url = `http://127.0.0.1:${front.address().port}/chat`;
  const opts = { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"model":"m"}' };
  const r1 = await fetch(url, opts);
  assert.equal(r1.headers.get('x-devflow-cache'), null);
  assert.equal((await r1.json()).n, 1);
  const r2 = await fetch(url, opts);
  assert.equal(r2.headers.get('x-devflow-cache'), 'HIT');
  assert.equal((await r2.json()).n, 1);
  assert.equal(calls, 1);
});

test('流式请求不缓冲、不缓存、不跑 onResponse', async (t) => {
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    calls += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: 1\n\n');
    res.end('data: 2\n\n');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  let onResp = 0;
  const plugins = [{ name: 'r', onResponse: () => { onResp += 1; } }];
  const front = await startProxy({ vault, getProvider: () => ({ baseURL, apiKey: 'UP' }), isEnabled: () => true, cache: createCache(), plugins });
  t.after(() => front.close());
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
  const url = `http://127.0.0.1:${front.address().port}/chat`;
  const opts = { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"stream":true}' };
  const r1 = await fetch(url, opts);
  assert.equal(r1.headers.get('x-devflow-cache'), null);
  await r1.text();
  const r2 = await fetch(url, opts);
  await r2.text();
  assert.equal(calls, 2);
  assert.equal(onResp, 0);
});

test('onCacheKey 返回 null 绕过缓存', async (t) => {
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    calls += 1;
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  const plugins = [{ name: 'k', onCacheKey: () => null }];
  const front = await startProxy({ vault, getProvider: () => ({ baseURL, apiKey: 'UP' }), isEnabled: () => true, cache: createCache(), plugins });
  t.after(() => front.close());
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
  const url = `http://127.0.0.1:${front.address().port}/chat`;
  const opts = { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"model":"m"}' };
  await (await fetch(url, opts)).text();
  const r2 = await fetch(url, opts);
  assert.equal(r2.headers.get('x-devflow-cache'), null);
  await r2.text();
  assert.equal(calls, 2);
});

test('onRequest 可改写 providerId 实现按内容路由', async (t) => {
  const hits = [];
  const mk = (name) => http.createServer((req, res) => {
    hits.push(name);
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ up: name })); });
  });
  const upA = mk('A');
  const upB = mk('B');
  await new Promise((r) => upA.listen(0, '127.0.0.1', r));
  await new Promise((r) => upB.listen(0, '127.0.0.1', r));
  t.after(() => { upA.close(); upB.close(); });
  const providers = {
    a: { baseURL: `http://127.0.0.1:${upA.address().port}/v1`, apiKey: 'A' },
    b: { baseURL: `http://127.0.0.1:${upB.address().port}/v1`, apiKey: 'B' },
  };
  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  const plugins = [{ name: 'route', onRequest: (c) => ({ providerId: c.json && c.json.model === 'b' ? 'b' : 'a' }) }];
  const handler = createProxyHandler({ vault, getProvider: (id) => providers[id], isEnabled: () => true, plugins, logger: { warn() {} } });
  const front = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); handler(req, res, { providerId: 'a', rest: u.pathname, query: '' }); });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  t.after(() => front.close());
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
  const url = `http://127.0.0.1:${front.address().port}/chat`;
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"model":"b"}' });
  assert.equal((await r.json()).up, 'B');
  assert.deepEqual(hits, ['B']);
});
```

- [ ] **Step 2: 运行确认新用例失败**

Run: `node --test "server/test/llm-proxy.test.js"`
Expected: FAIL（新用例：缓存/流式/路由行为尚不存在）

- [ ] **Step 3: 实现** — `server/llm-proxy.js` 整文件替换：

```js
import http from 'node:http';
import https from 'node:https';
import { verifyJwt } from './llm-jwt.js';
import { runRequestPlugins, runResponsePlugins, pluginCacheKeyOverride } from './relay-plugins.js';

const REQUEST_LIMIT = 32 * 1024 * 1024;
const RESPONSE_LIMIT = 64 * 1024 * 1024;

export function resolveTarget(baseURL, rest, query = '') {
  const u = new URL(baseURL);
  const basePath = u.pathname.replace(/\/+$/, '');
  let p = rest.startsWith('/') ? rest : '/' + rest;
  if (basePath && p !== basePath && !p.startsWith(basePath + '/')) p = basePath + p;
  const out = new URL(u.origin + p);
  out.search = query || '';
  return out;
}

export function extractToken(headers) {
  const auth = headers['authorization'] || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const k = headers['x-api-key'];
  return typeof k === 'string' ? k : '';
}

export function injectUpstreamAuth(headers, apiKey) {
  const out = { ...headers };
  delete out.host;
  delete out['content-length'];
  if (apiKey) { out.authorization = `Bearer ${apiKey}`; out['x-api-key'] = apiKey; }
  else { delete out.authorization; delete out['x-api-key']; }
  return out;
}

function deny(res, code, error) {
  if (res.headersSent) { try { res.destroy(); } catch { /* ignore */ } return; }
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error }));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        const e = new Error('body-too-large');
        e.code = 'body-too-large';
        reject(e);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function toJson(ctx) {
  if (ctx.json !== undefined) return ctx.json;
  if (!Buffer.isBuffer(ctx.body)) return undefined;
  try { return JSON.parse(ctx.body.toString('utf8')); } catch { return undefined; }
}

function isStreaming(ctx) {
  const json = toJson(ctx);
  if (json && json.stream === true) return true;
  return String(ctx.headers.accept || '').toLowerCase().includes('text/event-stream');
}

function upstreamRequest(target, method, headers, onResponse) {
  const mod = target.protocol === 'https:' ? https : http;
  return mod.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method,
    path: target.pathname + target.search,
    headers,
  }, onResponse);
}

function pipeUpstream(res, target, method, headers, body) {
  const preq = upstreamRequest(target, method, headers, (pres) => {
    res.writeHead(pres.statusCode || 502, pres.headers);
    pres.pipe(res);
  });
  preq.on('error', () => deny(res, 502, 'upstream error'));
  if (body && body.length) preq.end(body); else preq.end();
}

function bufferUpstream(res, target, method, headers, body, limit) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const preq = upstreamRequest(target, method, headers, (pres) => {
      const chunks = [];
      let size = 0;
      let overflow = false;
      pres.on('data', (c) => {
        if (overflow) return;
        size += c.length;
        if (size > limit) {
          overflow = true;
          res.writeHead(pres.statusCode || 502, pres.headers);
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
        else resolve({ status: pres.statusCode || 502, headers: pres.headers, body: Buffer.concat(chunks) });
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

export function createProxyHandler({ vault, getProvider, isEnabled, cache = null, plugins = [], logger = console }) {
  let activePlugins = plugins;
  let activeCache = cache;

  async function handle(req, res, { providerId, rest, query }) {
    if (!isEnabled()) return deny(res, 404, 'proxy disabled');
    let data;
    try { data = vault.getData(); } catch { return deny(res, 401, 'locked'); }
    if (!data.jwtSecret) return deny(res, 401, 'no secret');
    const token = extractToken(req.headers);
    if (!token) return deny(res, 401, 'no token');
    let payload;
    try { payload = verifyJwt(token, data.jwtSecret); } catch { return deny(res, 401, 'invalid token'); }
    const rec = (data.tokens || []).find((t) => t.jti === payload.jti && !t.revoked);
    if (!rec) return deny(res, 401, 'revoked');

    let body;
    try {
      body = await readBody(req, REQUEST_LIMIT);
    } catch (e) {
      return deny(res, e.code === 'body-too-large' ? 413 : 400, 'bad body');
    }

    const ctx = {
      providerId,
      method: req.method,
      path: rest,
      query,
      headers: { ...req.headers },
      body,
      json: undefined,
      provider: null,
    };
    try { ctx.json = JSON.parse(body.toString('utf8')); } catch { ctx.json = undefined; }
    const initial = getProvider(providerId);
    if (initial) ctx.provider = { id: providerId, name: initial.name, baseURL: initial.baseURL, hasKey: !!initial.apiKey };

    try {
      await runRequestPlugins(activePlugins, ctx, logger);
    } catch {
      return deny(res, 502, 'plugin error');
    }

    const provider = getProvider(ctx.providerId);
    if (!provider || !provider.baseURL) return deny(res, 404, 'provider not found');

    let target;
    try { target = resolveTarget(provider.baseURL, ctx.path, ctx.query); } catch { return deny(res, 502, 'bad upstream'); }

    const headers = injectUpstreamAuth(ctx.headers, provider.apiKey);
    if (Buffer.isBuffer(ctx.body) && ctx.body.length) headers['content-length'] = String(ctx.body.length);

    if (isStreaming(ctx) || !activeCache) {
      return pipeUpstream(res, target, ctx.method, headers, ctx.body);
    }

    let key = activeCache.keyFor(ctx.providerId, ctx.method, ctx.body);
    let ttl;
    try {
      const override = pluginCacheKeyOverride(activePlugins, ctx, logger);
      if (override === null) key = null;
      else if (override) {
        if (override.key) key = override.key;
        if (override.ttlMs) ttl = override.ttlMs;
      }
    } catch {
      return deny(res, 502, 'plugin error');
    }

    if (key) {
      const hit = activeCache.get(key);
      if (hit) {
        res.writeHead(hit.status, { ...hit.headers, 'x-devflow-cache': 'HIT' });
        return res.end(hit.body);
      }
    }

    let out;
    try {
      out = await bufferUpstream(res, target, ctx.method, headers, ctx.body, RESPONSE_LIMIT);
    } catch {
      return;
    }
    if (out.streamed) return;

    const rctx = { ...ctx, status: out.status, headers: { ...out.headers }, body: out.body };
    try {
      await runResponsePlugins(activePlugins, rctx, logger);
    } catch {
      return deny(res, 502, 'plugin error');
    }

    if (key && rctx.status === 200) {
      activeCache.set(key, { status: rctx.status, headers: rctx.headers, body: rctx.body }, ttl);
    }
    res.writeHead(rctx.status, rctx.headers);
    res.end(rctx.body);
  }

  handle.setPlugins = (next) => { activePlugins = next || []; };
  handle.setCache = (next) => { activeCache = next || null; };
  return handle;
}
```

- [ ] **Step 4: 运行确认全部通过**（含既有用例）

Run: `node --test "server/test/llm-proxy.test.js"`
Expected: PASS（原有 5 + 新增 4 = 9 tests）

- [ ] **Step 5: 提交**

```
git add server/llm-proxy.js server/test/llm-proxy.test.js
git commit -m "feat(server): 中转代理支持插件管线与响应缓存"
```

---

### Task 6: 挂载与插件管理接口 `server/llm-mount.js`

**Files:**
- Modify: `server/llm-mount.js`
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/llm-mount.test.js` 末尾追加：

```js
test('插件目录列表与重载接口', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpl-'));
  fs.writeFileSync(path.join(dir, 'p.mjs'), 'export default { name: "p", priority: 5 };');
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, pluginsDir: dir });
  await mount.ready;
  const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://x'); mount(req, res, url); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const list = JSON.parse((await jget(server, '/api/llm-admin/plugins')).body);
  assert.equal(list.dir, dir);
  assert.deepEqual(list.entries.map((e) => e.name), ['p']);
  const r = await jpost(server, '/api/llm-admin/plugins/reload', {});
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).entries.map((e) => e.name), ['p']);
});

test('未解锁时重载插件 423、列表仍可读', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpl-'));
  const vault = tmpVault();
  vault.init('pw');
  vault.lock();
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, pluginsDir: dir });
  await mount.ready;
  const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://x'); mount(req, res, url); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  assert.equal((await jget(server, '/api/llm-admin/plugins')).status, 200);
  assert.equal((await jpost(server, '/api/llm-admin/plugins/reload', {})).status, 423);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: FAIL（`/api/llm-admin/plugins` 返回 404 / `mount.ready` 未定义）

- [ ] **Step 3: 实现** — `server/llm-mount.js`：

在顶部 import 增加：

```js
import { createCache } from './llm-cache.js';
import { loadPlugins } from './relay-plugins.js';
```

把 `createLlmMount` 函数签名与开头替换为：

```js
export function createLlmMount({ vault, host, port, logger = console, pluginsDir = null, cache = createCache() } = {}) {
  let plugins = [];
  let entries = [];
  const proxy = createProxyHandler({
    vault,
    getProvider: (id) => getProvider(id),
    isEnabled: () => { try { return !!vault.getData().enabled; } catch { return false; } },
    cache,
    plugins,
    logger,
  });

  async function reloadPlugins() {
    if (!pluginsDir) { plugins = []; entries = []; proxy.setPlugins(plugins); return entries; }
    const loaded = await loadPlugins(pluginsDir);
    plugins = loaded.plugins;
    entries = loaded.entries;
    proxy.setPlugins(plugins);
    return entries;
  }

  async function mount(req, res, url) {
```

在 `if (seg[0] === 'status' && method === 'GET') { ... }` 之后、vault 相关分支之前插入：

```js
      if (seg[0] === 'plugins' && !seg[1] && method === 'GET') return sendJson(res, 200, { entries, dir: pluginsDir });
```

在 `if (locked()) return sendJson(res, 423, { error: 'locked' });` 之后插入：

```js
      if (seg[0] === 'plugins' && seg[1] === 'reload' && method === 'POST') return sendJson(res, 200, { entries: await reloadPlugins() });
```

把原来的 `return async function mount(req, res, url) { ... };` 结尾（`};`）改为挂载属性并返回：

```js
  mount.reloadPlugins = reloadPlugins;
  mount.ready = reloadPlugins().catch((e) => { logger?.warn?.('relay plugins load failed', e && e.message); return []; });
  return mount;
}
```

> 注意：原实现是 `export function createLlmMount(...) { return async function mount(...) {...}; }`。改造后 `mount` 改为函数声明，末尾统一 `return mount;`，其余 vault/token/config 分支代码保持不变。

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS（原有 3 + 新增 2 = 5 tests）

- [ ] **Step 5: 提交**

```
git add server/llm-mount.js server/test/llm-mount.test.js
git commit -m "feat(server): 中转站插件目录管理与重载接口"
```

---

### Task 7: 启动接线与模板种子 `server/index.js`

**Files:**
- Modify: `server/index.js`
- Modify: `server/data-home.js`（无需改，Task 3 已完成）
- 无独立单测；由 Task 9 全量回归覆盖

- [ ] **Step 1: 改 import**

`server/index.js:32` 的 data-home import 增加 `relayPluginsDir`：

```js
import { dataHome, instanceName, instanceSeedDir, instanceFpRoot, downloadsDir, relayPluginsDir } from './data-home.js';
```

在文件 import 区新增：

```js
import { seedPlugins } from './relay-plugins.js';
```

- [ ] **Step 2: 启动时 seed 并传目录**

把 `server/index.js:194-195`：

```js
  const llmVault = createVault({ file: path.join(downloadsDir(), 'llm.vault.json') });
  const llmMount = createLlmMount({ vault: llmVault, host: detectHost(), port, logger: log });
```

替换为：

```js
  const llmVault = createVault({ file: path.join(downloadsDir(), 'llm.vault.json') });
  seedPlugins(relayPluginsDir(), path.join(__dirname, '..', 'config', 'relay-plugins'));
  const llmMount = createLlmMount({ vault: llmVault, host: detectHost(), port, logger: log, pluginsDir: relayPluginsDir() });
```

- [ ] **Step 3: 冒烟验证（异步启动，勿阻塞）**

按 AGENTS.md 规范后台启动，等待日志后访问接口：

```powershell
$env:DEVFLOW_PORT='33333'
Start-Process -FilePath "node" -ArgumentList "server/index.js" -RedirectStandardOutput "$env:TEMP\df-dev.log" -RedirectStandardError "$env:TEMP\df-dev.err" -NoNewWindow
Start-Sleep -Seconds 3
Invoke-RestMethod http://127.0.0.1:33333/api/llm-admin/plugins | ConvertTo-Json -Depth 5
```

Expected: 返回 `{ entries: [...], dir: "...\\relay-plugins" }`，且 `dir` 目录下已生成 `README.md` 与 5 个 `example-*.mjs.example`。

- [ ] **Step 4: 提交**

```
git add server/index.js
git commit -m "feat(server): 启动时种子插件模板并接线插件目录"
```

---

### Task 8: 前端插件面板与 i18n

**Files:**
- Modify: `web/src/useLlm.ts`
- Modify: `web/src/components/ProxyView.vue`
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 改 `web/src/useLlm.ts`**

在接口定义区新增：

```ts
export interface LlmPluginEntry { file: string; name: string; priority: number; error: string | null; }
```

在 `useLlm()` 返回对象中、`config` 之前新增：

```ts
    plugins: () => json<{ entries: LlmPluginEntry[]; dir: string | null }>('/api/llm-admin/plugins'),
    reloadPlugins: () => post<{ entries: LlmPluginEntry[] }>('/api/llm-admin/plugins/reload', {}),
```

- [ ] **Step 2: 改 `web/src/components/ProxyView.vue` 的 script**

import 行改为：

```ts
import { useLlm, type LlmStatus, type LlmToken, type LlmPluginEntry } from '../useLlm';
```

在 `const tokens = ref<LlmToken[]>([]);` 后新增：

```ts
const pluginList = ref<LlmPluginEntry[]>([]);
const pluginDir = ref('');
```

`refresh()` 改为：

```ts
async function refresh() {
  try {
    st.value = await api.status();
    if (st.value.providers.length && !cfgProvider.value) cfgProvider.value = st.value.defaultProvider || st.value.providers[0].id;
    tokens.value = st.value.vault.unlocked ? (await api.tokens()).tokens : [];
    if (st.value.vault.unlocked) {
      const pl = await api.plugins();
      pluginList.value = pl.entries;
      pluginDir.value = pl.dir || '';
    } else {
      pluginList.value = [];
    }
  } catch (e: any) {
    err.value = t('llm.failed', { msg: e?.message || e });
  }
}
```

在 `const toggleEnabled = ...` 附近新增：

```ts
const reloadPlugins = () => run(() => api.reloadPlugins());
```

- [ ] **Step 3: 改 `ProxyView.vue` 模板**

在「中转开关」`<section>`（`llm.proxy.title`）之后、token `<section>` 之前插入：

```html
    <section v-if="st?.vault.unlocked" class="card">
      <div class="ch">{{ $t('llm.plugins.title') }}
        <button class="ghost" @click="reloadPlugins">{{ $t('llm.plugins.reload') }}</button>
      </div>
      <div class="muted">{{ $t('llm.plugins.dir', { dir: pluginDir }) }}</div>
      <div class="muted">{{ $t('llm.plugins.hint') }}</div>
      <div v-if="!pluginList.length" class="muted">{{ $t('llm.plugins.empty') }}</div>
      <div v-for="p in pluginList" :key="p.file + '::' + p.name" class="prow">
        <b>{{ p.name || p.file }}</b>
        <span class="muted">{{ p.file }} · p{{ p.priority }}</span>
        <span v-if="p.error" class="warn">{{ $t('llm.plugins.error') }}</span>
      </div>
    </section>
```

- [ ] **Step 4: 加 i18n 词条**

`shared/i18n/zh-CN.js` 在 `'llm.proxy.warn'` 之后插入：

```js
  'llm.plugins.title': '转换插件',
  'llm.plugins.dir': '目录：{dir}',
  'llm.plugins.hint': '把 .mjs 插件放进该目录后点「重载插件」即生效，无需重启；首次已生成 README.md 与 example-*.mjs.example，改名去掉 .example 即可启用。',
  'llm.plugins.reload': '重载插件',
  'llm.plugins.empty': '暂无插件',
  'llm.plugins.error': '加载失败',
```

`shared/i18n/en.js` 在 `'llm.proxy.warn'` 之后插入：

```js
  'llm.plugins.title': 'Transform plugins',
  'llm.plugins.dir': 'Directory: {dir}',
  'llm.plugins.hint': 'Drop .mjs plugins into this folder and click "Reload plugins" — no restart needed. A README.md and example-*.mjs.example files are seeded on first run; rename off .example to enable.',
  'llm.plugins.reload': 'Reload plugins',
  'llm.plugins.empty': 'No plugins',
  'llm.plugins.error': 'Load failed',
```

- [ ] **Step 5: 类型检查 + i18n 校验**

Run: `npm.cmd run typecheck`
Expected: 无错误。

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`

- [ ] **Step 6: 提交**

```
git add web/src/useLlm.ts web/src/components/ProxyView.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 中转站转换插件面板与词条"
```

---

### Task 9: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 后端测试**

Run: `npm.cmd run test:server`
Expected: 全绿（含新增 `llm-cache`、`relay-plugins` 及扩展的 `llm-proxy`/`llm-mount`/`data-home`）。

- [ ] **Step 2: 前端测试与类型**

Run: `npm.cmd run test:web`
Run: `npm.cmd run typecheck`
Expected: 全绿。

- [ ] **Step 3: i18n**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`

- [ ] **Step 4: 构建前端**

Run: `npm.cmd run build:web`
Expected: 构建成功，无类型错误。

- [ ] **Step 5: 人工验收（异步启动后端）**

1. 后台启动 `node server/index.js`（port 22222 或 `DEVFLOW_PORT=33333`）。
2. 面板 → 中转站 → 初始化/解锁密钥库 → 放一个改 header 的插件（把 `example-header.mjs.example` 改名为 `.mjs`）→ 点「重载插件」→ 列表出现 `header-compat`。
3. 生成 token，用 curl 连续两次请求一个非流式上游：第二次响应头带 `x-devflow-cache: HIT`；上游只被调用一次。
4. 发 `{"stream":true}` 请求：响应为 SSE，无 `x-devflow-cache`，上游被调用两次。
5. 放一个 `export default {`（语法错误）的文件 → 重载 → 列表显示 `加载失败/error`，服务不崩。

- [ ] **Step 6: 最终提交（如有验证期微调）**

```
git status
git add <本次调整涉及的文件>
git commit -m "chore: 中转插件与缓存验证收尾"
```

---

## 自查记录

- **Spec 覆盖**：§4 契约/加载→Task 2；§4 示例种子→Task 3/4/7；§5 代理流→Task 5；§6 缓存→Task 1；§7 管理接口→Task 6；§8 前端/i18n→Task 8；§10 安全边界（请求/响应上限、仅 200 缓存）→Task 5；§11 测试→各 Task + Task 9。
- **占位符扫描**：无 TBD/TODO；每个代码步骤给出完整代码。
- **类型一致性**：`loadPlugins`→`{plugins, entries}`；`entries` 条目 `{ file, name, priority, error }` 在前端 `LlmPluginEntry` 对称；`pluginCacheKeyOverride` 返回 `null | { key?, ttlMs? } | undefined`，Task 5 处理三者；`cache.keyFor/get/set` 签名自 Task 1 起一致。
- **已修**：`onCacheKey` 仅返回 `{ ttlMs }` 时也生效（Task 5 Step 3 的 `else if (override)` 分支）。
