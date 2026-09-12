# 平铺多 provider 勾选生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉 provider 下拉，平铺所有 provider 的模型供勾选；生成的 opencode.json 含多个 provider 条目（同一 token）；默认全选。

**Architecture:** `llm-config` 加 `buildOpencodeConfigMulti`；`llm-mount` 查询改用成对 `pid`/`model` 参数；前端平铺勾选并据此生成/下载。

**Tech Stack:** Node ESM、`node:test`、Vue3+TS、i18n 中英对称。

**Spec:** `docs/superpowers/specs/2026-09-12-relay-plugins-cache-design.md`（§20）

**约定:** 仓库根执行；`npm.cmd`；每 Task 一提交。

---

### Task 1: 多 provider 生成 `server/llm-config.js`

**Files:**
- Modify: `server/llm-config.js`
- Test: `server/test/llm-config.test.js`

- [ ] **Step 1: 追加失败测试** — `server/test/llm-config.test.js` 顶部 import 增加 `buildOpencodeConfigMulti`：

```js
import { loadOpencodeProviders, resolveApiKey, resolveApiKeys, listProviders, getProvider, buildOpencodeConfig, buildOpencodeConfigMulti } from '../llm-config.js';
```

末尾追加：

```js
test('buildOpencodeConfigMulti 生成多个 provider 条目', () => {
  const c = buildOpencodeConfigMulti({
    host: '192.168.1.5', port: 22222, token: 'JWT',
    providers: [
      { id: 'deepseek', baseURL: 'https://api.deepseek.com/v1', models: ['deepseek-chat'] },
      { id: 'glm', baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4', 'glm-4-flash'] },
    ],
  });
  assert.equal(c.provider['devflow-deepseek'].options.apiKey, 'JWT');
  assert.equal(c.provider['devflow-deepseek'].options.baseURL, 'http://192.168.1.5:22222/api/llm/deepseek/v1');
  assert.deepEqual(Object.keys(c.provider['devflow-glm'].models), ['glm-4', 'glm-4-flash']);
  assert.deepEqual(Object.keys(c.provider).sort(), ['devflow-deepseek', 'devflow-glm']);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-config.test.js"`
Expected: FAIL（`buildOpencodeConfigMulti` 未导出）

- [ ] **Step 3: 实现** — `server/llm-config.js` 末尾追加：

```js
export function buildOpencodeConfigMulti({ host, port, token, providers = [] }) {
  const provider = {};
  for (const p of providers) {
    if (!p || !p.id || !p.baseURL) continue;
    const one = buildOpencodeConfig({ host, port, providerId: p.id, baseURL: p.baseURL, token, models: p.models || [] });
    Object.assign(provider, one.provider);
  }
  return { $schema: 'https://opencode.ai/config.json', provider };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-config.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/llm-config.js server/test/llm-config.test.js
git commit -m "feat(server): 生成配置支持多 provider 条目"
```

---

### Task 2: 接口改用 pid/model 成对参数 `server/llm-mount.js`

**Files:**
- Modify: `server/llm-mount.js`
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 改测试**

`server/test/llm-mount.test.js` 中把 `opencode-config` 过滤用例改为 pid/model：

```js
test('opencode-config 支持 pid/model 过滤（多 provider）', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    provider: {
      corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { a: {}, b: {}, c: {} } },
      glm: { options: { baseURL: 'https://glm/v1', apiKey: 'G' }, models: { g1: {}, g2: {} } },
    },
  }));
  const prev = process.env.DEVFLOW_OPENCODE_CONFIG;
  process.env.DEVFLOW_OPENCODE_CONFIG = oc;
  t.after(() => { if (prev === undefined) delete process.env.DEVFLOW_OPENCODE_CONFIG; else process.env.DEVFLOW_OPENCODE_CONFIG = prev; });

  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  assert.equal((await jpost(server, '/api/llm-admin/secret', {})).status, 200);
  const tok = JSON.parse((await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 1 })).body).token;

  const filtered = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?token=${tok.id}&pid=corp&model=a&pid=corp&model=c`)).body);
  assert.deepEqual(Object.keys(JSON.parse(filtered.config).provider['devflow-corp'].models), ['a', 'c']);

  const all = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?token=${tok.id}&pid=corp`)).body);
  assert.deepEqual(Object.keys(JSON.parse(all.config).provider['devflow-corp'].models), ['a', 'b', 'c']);

  const manual = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?token=${tok.id}&pid=corp&model=x&model=y`)).body);
  assert.deepEqual(Object.keys(JSON.parse(manual.config).provider['devflow-corp'].models), ['x', 'y']);

  const multi = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?token=${tok.id}&pid=corp&model=a&pid=glm&model=g1`)).body);
  assert.deepEqual(Object.keys(JSON.parse(multi.config).provider).sort(), ['devflow-corp', 'devflow-glm']);
});
```

并把 bundle 用例请求改为：

```js
  const r = await getBuffer(server, `/api/llm-admin/opencode-bundle?token=${tok.id}&pid=corp&model=a`);
```

以及 404 用例：

```js
  assert.equal((await getBuffer(server, `/api/llm-admin/opencode-bundle?token=nope&pid=corp`)).status, 404);
  assert.equal((await getBuffer(server, `/api/llm-admin/opencode-bundle?token=${tok.id}&pid=nope&model=x`)).status, 404);
```

（删除原 `provider=`/`models=` 的旧用例。）

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: FAIL（新参数未支持）

- [ ] **Step 3: 实现** — `server/llm-mount.js`

import 增加 `buildOpencodeConfigMulti`：

```js
import { listProviders, getProvider, buildOpencodeConfig, buildOpencodeConfigMulti } from './llm-config.js';
```

在 `pickModels` 之后新增：

```js
function parseSelections(url) {
  const pids = url.searchParams.getAll('pid');
  const models = url.searchParams.getAll('model');
  const byPid = new Map();
  for (let i = 0; i < pids.length; i += 1) {
    const pid = pids[i];
    if (!pid) continue;
    if (!byPid.has(pid)) byPid.set(pid, []);
    const m = models[i];
    if (m) byPid.get(pid).push(m);
  }
  return byPid;
}

function selectionsToProviders(url) {
  const providers = [];
  for (const [pid, asked] of parseSelections(url)) {
    const p = getProvider(pid);
    if (!p || !p.baseURL) continue;
    providers.push({ id: pid, baseURL: p.baseURL, models: pickModels(p.models, asked) });
  }
  return providers;
}
```

把 `opencode-config` 分支替换为：

```js
      if (seg[0] === 'opencode-config' && method === 'GET') {
        const tokenId = url.searchParams.get('token') || '';
        const rec = vault.getData().tokens.find((t) => t.id === tokenId);
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const providers = selectionsToProviders(url);
        if (!providers.length) return sendJson(res, 404, { error: 'provider not found' });
        const config = JSON.stringify(buildOpencodeConfigMulti({ host, port, token: rec.jwt, providers }), null, 2);
        return sendJson(res, 200, { config });
      }
```

把 `opencode-bundle` 分支替换为：

```js
      if (seg[0] === 'opencode-bundle' && method === 'GET') {
        const tokenId = url.searchParams.get('token') || '';
        const rec = vault.getData().tokens.find((t) => t.id === tokenId);
        if (!rec) return sendJson(res, 404, { error: 'token not found' });
        const providers = selectionsToProviders(url);
        if (!providers.length) return sendJson(res, 404, { error: 'provider not found' });
        const config = JSON.stringify(buildOpencodeConfigMulti({ host, port, token: rec.jwt, providers }), null, 2);
        const zip = buildZip([
          { name: 'opencode.json', data: Buffer.from(config, 'utf8') },
          { name: 'Install.bat', data: Buffer.from(INSTALL_BAT, 'utf8') },
        ]);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="devflow-opencode.zip"',
          'Content-Length': zip.length,
        });
        return res.end(zip);
      }
```

> `buildOpencodeConfig` 单函数仍被 `buildOpencodeConfigMulti` 使用；`pickModels` 保留。

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/llm-mount.js server/test/llm-mount.test.js
git commit -m "feat(server): opencode 配置接口改用 pid/model 多 provider 参数"
```

---

### Task 3: 前端平铺勾选

**Files:**
- Modify: `web/src/useLlm.ts`
- Modify: `web/src/components/ProxyView.vue`

- [ ] **Step 1: 改 `useLlm.ts`**

把 `config` 替换为：

```ts
    config: (token: string, selections: { id: string; models: string[] }[]) => {
      const q = new URLSearchParams({ token });
      for (const sel of selections) for (const m of sel.models) { q.append('pid', sel.id); q.append('model', m); }
      return json<{ config: string }>(`/api/llm-admin/opencode-config?${q.toString()}`);
    },
```

- [ ] **Step 2: 改 `ProxyView.vue` script**

把 `expanded`/`rowProvider`/`rowModels`/`rowManual`/`providerById` 这一段替换为：

```ts
const expanded = ref<string | null>(null);
const rowKeys = ref<string[]>([]);
const rowManual = ref<Record<string, string>>({});
const providerById = (id: string) => st.value?.providers.find((p) => p.id === id) || null;
const allModelKeys = () => (st.value?.providers || []).flatMap((p) => p.models.map((m) => `${p.id}::${m}`));
function selectedProviders() {
  const out: { id: string; models: string[] }[] = [];
  for (const p of st.value?.providers || []) {
    if (p.models.length) {
      const models = p.models.filter((m) => rowKeys.value.includes(`${p.id}::${m}`));
      if (models.length) out.push({ id: p.id, models });
    } else {
      const manual = (rowManual.value[p.id] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (manual.length) out.push({ id: p.id, models: manual });
    }
  }
  return out;
}
```

`toggleToken` 改为：

```ts
function toggleToken(tk: LlmToken) {
  if (expanded.value === tk.id) { expanded.value = null; return; }
  expanded.value = tk.id;
  rowKeys.value = allModelKeys();
  rowManual.value = {};
  configText.value = '';
}
```

`genConfig`/`bundleUrl` 改为：

```ts
async function genConfig(tk: LlmToken) {
  await run(async () => {
    const r = await api.config(tk.id, selectedProviders());
    configText.value = r.config;
  });
}
function bundleUrl(tk: LlmToken) {
  const q = new URLSearchParams({ token: tk.id });
  for (const sel of selectedProviders()) for (const m of sel.models) { q.append('pid', sel.id); q.append('model', m); }
  return `/api/llm-admin/opencode-bundle?${q.toString()}`;
}
```

删除 `onProviderChange`。

- [ ] **Step 3: 改 `ProxyView.vue` 模板展开行**

把展开行内容（provider 下拉 + models 区 + manual 区）替换为：

```html
          <div class="row">
            <button @click="genConfig(tk)">{{ $t('llm.config.generate') }}</button>
            <button :disabled="!configText" @click="copyConfig">{{ copied ? $t('llm.config.copied') : $t('llm.config.copy') }}</button>
            <a class="dlbtn" :href="bundleUrl(tk)" download>{{ $t('llm.config.download') }}</a>
            <button class="ghost" @click="rowKeys = allModelKeys()">{{ $t('llm.config.all') }}</button>
            <button class="ghost" @click="rowKeys = []">{{ $t('llm.config.none') }}</button>
          </div>
          <div v-for="p in st?.providers || []" :key="p.id" class="pvgroup">
            <div class="pvname">
              {{ p.id }}
              <span v-if="!p.models.length" class="muted">·</span>
            </div>
            <div v-if="p.models.length" class="models">
              <label v-for="m in p.models" :key="m" class="mchk">
                <input type="checkbox" :value="p.id + '::' + m" v-model="rowKeys" /> {{ m }}
              </label>
            </div>
            <div v-else class="row">
              <input v-model="rowManual[p.id]" :placeholder="$t('llm.config.manual')" />
            </div>
          </div>
          <div class="muted">{{ $t('llm.config.download_hint') }}</div>
          <pre v-if="configText" class="cfg">{{ configText }}</pre>
```

- [ ] **Step 4: 加样式**

在 `<style scoped>` 末尾追加：

```css
.pvgroup { display: flex; flex-direction: column; gap: 4px; }
.pvname { color: var(--tx2); font-size: 12px; font-weight: 700; }
```

- [ ] **Step 5: 类型 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 6: 提交**

```
git add web/src/useLlm.ts web/src/components/ProxyView.vue
git commit -m "feat(web): 平铺多 provider 模型勾选生成配置"
```

---

### Task 4: 全量验证

- [ ] **Step 1:** `npm.cmd run test:server` → 全绿。
- [ ] **Step 2:** `npm.cmd run test:web` → 全绿。
- [ ] **Step 3:** `npm.cmd run typecheck` → 无错误。
- [ ] **Step 4:** `npm.cmd run check:i18n` → 零命中。
- [ ] **Step 5:** `npm.cmd run build:web` → 构建成功。
- [ ] **Step 6: 人工验收**：展开 token → 所有 provider 的模型平铺、默认全选；勾选 deepseek 与 glm 各一个 → 生成/下载的 `opencode.json` 含 `devflow-deepseek` 与 `devflow-glm` 两个条目。

---

## 自查记录

- **Spec 覆盖**：§20.1 → Task 1；§20.2 → Task 2；§20.3 → Task 3；§20.4 → Task 1/2/4。
- **占位符扫描**：无 TBD。
- **一致性**：前端 `pid`/`model` 成对追加与 `parseSelections` 按索引配对一致；`buildOpencodeConfigMulti` 的 provider 键 `devflow-<id>` 与单函数一致。
- **兼容**：旧 `provider=`/`models=` 参数移除，相关测试同步替换。
