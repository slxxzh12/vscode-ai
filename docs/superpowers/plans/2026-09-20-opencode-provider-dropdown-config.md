# 本机 opencode provider 下拉式配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「极简配置（本机）」卡从四家平铺改为「下拉添加 provider + 回显已配置 + 支持自定义 + 可移除」，并让服务端合并/校验支持自定义 provider 与删除。

**Architecture:** 前端把 `ProviderState` 统一成 `ConfiguredProvider`（`providersFromConfig` 读取 `opencode.json` 里全部 provider），顶部下拉新增预设/自定义，每卡可移除；保存提交 `{ providers, remove, model }`。服务端 `mergePresetProviders` 通用化为 `mergeConfiguredProviders`（预设用内置 baseURL，自定义用传入 baseURL，保留未知字段，按 `remove` 删除）；`validateSelections` 放宽未知 id 但要求合法 baseURL。

**Tech Stack:** Node ESM（`node --test`）、Vue 3 + Vite + TypeScript（vitest + vue-tsc）、共享 i18n 词条（`@devflow/shared/i18n`）。

参考设计：`docs/superpowers/specs/2026-09-20-opencode-provider-dropdown-config-design.md`。

---

## 文件结构

- Modify: `server/llm-provider-presets.js` — 校验放宽 + 通用合并 + 删除。
- Modify: `server/llm-mount.js` — POST 读取 `remove` 并调用新合并。
- Modify: `server/test/llm-provider-presets.test.js` — 更新/新增单测。
- Modify: `server/test/llm-mount.test.js` — 新增自定义 + 删除用例。
- Modify: `web/src/useLlm.ts` — `ProviderSelection` 增加 `name?/baseURL?`；`saveOpencodeConfig` 收 `remove`。
- Modify: `web/src/useLlm.test.ts` — 更新 payload 断言。
- Modify: `web/src/llmPresets.ts` — 统一 `ConfiguredProvider` + `providersFromConfig`/`addablePresets`/`buildProviders`/`modelOptions`。
- Modify: `web/src/llmPresets.test.ts` — 重写单测。
- Modify: `web/src/components/ModelSetupCard.vue` — 下拉 + 回显 + 自定义 + 移除。
- Create: `web/src/components/ModelSetupCard.test.ts` — 组件测试。
- Modify: `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — 新增 8 个词条。
- Modify: `README.md` — 更新「本机 provider 配置」说明。

---

### Task 1: 服务端 `validateSelections` 支持自定义 provider

**Files:**
- Modify: `server/llm-provider-presets.js`
- Test: `server/test/llm-provider-presets.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/llm-provider-presets.test.js` 里，把 `validateSelections` 的用例替换为：

```js
test('validateSelections 拒绝非法结构、放行自定义（需 baseURL）', () => {
  assert.throws(() => validateSelections('x'), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'nope', models: [] }]), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'deepseek', models: 'x' }]), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'deepseek', models: [], apiKey: 1 }]), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'bad id', baseURL: 'https://x/v1', models: [] }]), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'nope', baseURL: 'not-a-url', models: [] }]), (e) => e.code === 'bad-config');
  assert.doesNotThrow(() => validateSelections([{ id: 'deepseek', models: ['deepseek-v4-flash'] }]));
  assert.doesNotThrow(() => validateSelections([{ id: 'my-ai', baseURL: 'https://my.ai/v1', models: ['m'] }]));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/llm-provider-presets.test.js"`
Expected: FAIL —— `assert.throws(... 'bad id' ...)` 未抛错（旧实现只认预设，`nope` 会抛，但 `my-ai` 的 doesNotThrow 会失败）。

- [ ] **Step 3: 改实现**

在 `server/llm-provider-presets.js` 顶部 `import` 之后、`fail` 函数下方新增：

```js
const CUSTOM_ID_RE = /^[A-Za-z0-9._-]+$/;

function isHttpUrl(v) {
  if (typeof v !== 'string' || !v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}
```

把 `validateSelections` 整个替换为：

```js
export function validateSelections(value) {
  if (!Array.isArray(value)) fail('bad-config', 'providers must be an array');
  for (const sel of value) {
    if (!sel || typeof sel !== 'object' || Array.isArray(sel)) fail('bad-config', 'selection must be an object');
    if (typeof sel.id !== 'string' || !sel.id) fail('bad-config', 'selection.id required');
    if (!presetById(sel.id)) {
      if (!CUSTOM_ID_RE.test(sel.id)) fail('bad-config', `invalid provider id: ${sel.id}`);
      if (!isHttpUrl(sel.baseURL)) fail('bad-config', `provider ${sel.id} requires baseURL`);
    }
    if (sel.name !== undefined && typeof sel.name !== 'string') fail('bad-config', 'name must be a string');
    if (sel.baseURL !== undefined && typeof sel.baseURL !== 'string') fail('bad-config', 'baseURL must be a string');
    if (sel.apiKey !== undefined && typeof sel.apiKey !== 'string') fail('bad-config', 'apiKey must be a string');
    if (!Array.isArray(sel.models) || sel.models.some((m) => typeof m !== 'string')) {
      fail('bad-config', 'models must be a string array');
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/llm-provider-presets.test.js"`
Expected: PASS（该文件其余 `mergePresetProviders` 用例此时仍应通过）。

- [ ] **Step 5: 提交**

```bash
git add server/llm-provider-presets.js server/test/llm-provider-presets.test.js
git commit -m "feat(llm): validateSelections 支持自定义 provider（需合法 baseURL）"
```

---

### Task 2: 服务端通用合并 `mergeConfiguredProviders` + mount 接线（自定义 + 删除）

**Files:**
- Modify: `server/llm-provider-presets.js`
- Modify: `server/llm-mount.js`
- Test: `server/test/llm-provider-presets.test.js`
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 写失败测试（合并函数）**

在 `server/test/llm-provider-presets.test.js` 中：

1. 顶部 import 改为：

```js
import { validateSelections, mergeConfiguredProviders } from '../llm-provider-presets.js';
```

2. 把两个 `mergePresetProviders` 用例改成新签名与名称，并新增一个自定义/删除用例。把文件里 `test('mergePresetProviders：单 key...` 与 `test('mergePresetProviders：留空保留旧 key...` 两个 `test(...)` 块替换为：

```js
test('mergeConfiguredProviders：预设单 key、vision attachment、保留非预设/附加字段', () => {
  const current = {
    corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { a: {} } },
    deepseek: { options: { baseURL: 'old', apiKeys: ['A', 'B'] }, models: { 'deepseek-v4-flash': { name: 'Legacy' } } },
  };
  const { provider, skipped } = mergeConfiguredProviders({
    current,
    selections: [{ id: 'deepseek', apiKey: 'NEW', models: ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'] }],
  });
  assert.deepEqual(skipped, []);
  assert.deepEqual(Object.keys(provider).sort(), ['corp', 'deepseek']);
  assert.deepEqual(provider.corp, current.corp);
  assert.equal(provider.deepseek.options.baseURL, 'https://api.deepseek.com/v1');
  assert.equal(provider.deepseek.options.apiKey, 'NEW');
  assert.equal('apiKeys' in provider.deepseek.options, false);
  assert.equal(provider.deepseek.name, 'DeepSeek');
  assert.equal(provider.deepseek.models['deepseek-v4-flash'].name, 'Legacy');
  assert.equal(provider.deepseek.models['deepseek-v4-flash-vision-exp'].attachment, true);
  assert.equal('attachment' in provider.deepseek.models['deepseek-v4-flash'], false);
});

test('mergeConfiguredProviders：写入自定义 provider、按 remove 删除', () => {
  const current = {
    dead: { options: { baseURL: 'https://dead/v1', apiKey: 'D' }, models: { x: {} } },
    deepseek: { options: { apiKey: 'OLD' }, models: {} },
  };
  const { provider, skipped } = mergeConfiguredProviders({
    current,
    selections: [
      { id: 'deepseek', apiKey: '', models: ['deepseek-v4-flash'] },
      { id: 'my-ai', name: 'MyAI', baseURL: 'https://my.ai/v1', apiKey: 'MK', models: ['my-model', 'my-vl'] },
    ],
    remove: ['dead'],
  });
  assert.deepEqual(skipped, []);
  assert.deepEqual(Object.keys(provider).sort(), ['deepseek', 'my-ai']);
  assert.equal('dead' in provider, false);
  assert.equal(provider['my-ai'].name, 'MyAI');
  assert.equal(provider['my-ai'].options.baseURL, 'https://my.ai/v1');
  assert.equal(provider['my-ai'].options.apiKey, 'MK');
  assert.equal(provider['my-ai'].models['my-vl'].attachment, true);
  assert.equal(provider.deepseek.options.apiKey, 'OLD');
});

test('mergeConfiguredProviders：留空保留旧 key、无 key 记 skipped', () => {
  const current = { glm: { options: { baseURL: 'x', apiKey: 'OLD' }, models: {} } };
  const a = mergeConfiguredProviders({ current, selections: [{ id: 'glm', apiKey: '', models: ['glm-4.6'] }] });
  assert.equal(a.provider.glm.options.apiKey, 'OLD');
  assert.deepEqual(a.skipped, []);

  const b = mergeConfiguredProviders({ current: {}, selections: [{ id: 'qwen', apiKey: '', models: ['qwen3-max'] }] });
  assert.equal('qwen' in b.provider, false);
  assert.deepEqual(b.skipped, ['qwen']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/llm-provider-presets.test.js"`
Expected: FAIL —— `mergeConfiguredProviders` 未导出（`TypeError`/import 报错）。

- [ ] **Step 3: 实现 `mergeConfiguredProviders`**

在 `server/llm-provider-presets.js` 中，把现有 `export function mergePresetProviders(...)` 整个替换为：

```js
export function mergeConfiguredProviders({ current = {}, selections = [], remove = [], presets = LLM_PROVIDER_PRESETS } = {}) {
  const out = { ...current };
  for (const id of remove) if (typeof id === 'string' && id) delete out[id];
  const skipped = [];
  const presetMap = new Map(presets.map((p) => [p.id, p]));
  for (const sel of selections) {
    const preset = presetMap.get(sel.id);
    const existing = current[sel.id] && typeof current[sel.id] === 'object' && !Array.isArray(current[sel.id])
      ? current[sel.id]
      : {};
    const incoming = typeof sel.apiKey === 'string' ? sel.apiKey.trim() : '';
    const keys = incoming ? [incoming] : existingKeys(existing.options);
    if (!keys.length) { skipped.push(sel.id); continue; }

    const baseURL = preset ? preset.baseURL : sel.baseURL;
    const name = preset ? preset.name : (sel.name || sel.id);
    const opts = { ...(existing.options || {}), baseURL };
    delete opts.apiKey;
    delete opts.apiKeys;
    if (keys.length === 1) opts.apiKey = keys[0]; else opts.apiKeys = keys;

    const models = {};
    const seen = new Set();
    for (const raw of sel.models) {
      const id = String(raw).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const base = existing.models && existing.models[id] && typeof existing.models[id] === 'object'
        ? existing.models[id]
        : {};
      const entry = { ...base };
      if (isVisionModel(sel.id, id)) entry.attachment = true;
      models[id] = entry;
    }

    out[sel.id] = { ...existing, name, options: opts, models };
  }
  return { provider: out, skipped };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/llm-provider-presets.test.js"`
Expected: PASS。

- [ ] **Step 5: 接线 `llm-mount.js`**

把 `server/llm-mount.js:8` 的 import 改为：

```js
import { validateSelections, mergeConfiguredProviders } from './llm-provider-presets.js';
```

把 POST `/api/llm-admin/opencode` 分支（`server/llm-mount.js:157-169`）替换为：

```js
      if (seg[0] === 'opencode' && !seg[1] && method === 'POST') {
        const b = await readJson(req);
        const selections = Array.isArray(b.providers) ? b.providers : [];
        validateSelections(selections);
        const remove = Array.isArray(b.remove) ? b.remove : [];
        const current = readActiveConfig({ dir: opencodeDir }).config?.provider || {};
        const { provider, skipped } = mergeConfiguredProviders({ current, selections, remove });
        const saved = mergeAndWrite({
          dir: opencodeDir,
          provider,
          model: typeof b.model === 'string' ? b.model : '',
        });
        return sendJson(res, 200, { ok: true, path: saved.path, backups: saved.backups, config: saved.config, skipped });
      }
```

- [ ] **Step 6: 写失败测试（mount 自定义 + 删除 + 非法自定义 400）**

在 `server/test/llm-mount.test.js` 中，把 `test('opencode 配置 POST 非法体 400、坏文件 400' ...)` 内的两个断言之间补充一行（非法自定义缺 baseURL）：

```js
  assert.equal((await jpost(server, '/api/llm-admin/opencode', { providers: [{ id: 'nope', models: [] }], model: '' })).status, 400);
  assert.equal((await jpost(server, '/api/llm-admin/opencode', { providers: [{ id: 'my-ai', models: [] }], model: '' })).status, 400);
```

在该文件末尾新增（仿照已有 `opencode 配置 GET/POST` 用例的搭建方式）：

```js
test('opencode 配置 POST：写自定义 provider、按 remove 删除', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    provider: {
      corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { m1: {} } },
      dead: { options: { baseURL: 'https://dead/v1', apiKey: 'D' }, models: { x: {} } },
    },
    model: '',
  }));
  const vault = tmpVault();
  vault.init('pw');
  vault.lock();
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, opencodeDir: oc });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());

  const r = await jpost(server, '/api/llm-admin/opencode', {
    providers: [{ id: 'my-ai', name: 'MyAI', baseURL: 'https://my.ai/v1', apiKey: 'MK', models: ['my-model', 'my-vl'] }],
    remove: ['dead'],
    model: '',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).skipped, []);

  const saved = JSON.parse(fs.readFileSync(path.join(oc, 'opencode.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.provider).sort(), ['corp', 'my-ai']);
  assert.equal(saved.provider['my-ai'].name, 'MyAI');
  assert.equal(saved.provider['my-ai'].options.baseURL, 'https://my.ai/v1');
  assert.equal(saved.provider['my-ai'].options.apiKey, 'MK');
  assert.equal(saved.provider['my-ai'].models['my-vl'].attachment, true);
  assert.equal(saved.provider.corp.options.apiKey, 'K');
});
```

> 注：`tmpVault` / `startMount` / `jpost` / `jget` 等辅助在该文件上方已定义，直接复用。

- [ ] **Step 7: 运行 mount 测试**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS（含新用例与 400 断言）。

- [ ] **Step 8: 跑全部服务端测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS。

- [ ] **Step 9: 提交**

```bash
git add server/llm-provider-presets.js server/llm-mount.js server/test/llm-provider-presets.test.js server/test/llm-mount.test.js
git commit -m "feat(llm): mergeConfiguredProviders 支持自定义 provider 与移除"
```

---

### Task 3: 前端 `useLlm` 保存接口支持 `remove` 与自定义字段

**Files:**
- Modify: `web/src/useLlm.ts`
- Test: `web/src/useLlm.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/useLlm.test.ts` 中，把 `it('opencodeConfig 走 GET，saveOpencodeConfig 走 POST' ...)` 替换为：

```ts
  it('opencodeConfig 走 GET，saveOpencodeConfig 走 POST（含 remove）', async () => {
    const calls = stub(() => ({ body: { ok: true, config: { provider: {} } } }));
    await llm.opencodeConfig();
    expect(calls[0].url).toBe('/api/llm-admin/opencode');
    expect(calls[0].init?.method || 'GET').toBe('GET');
    const payload = {
      providers: [{ id: 'my-ai', name: 'MyAI', baseURL: 'https://my.ai/v1', apiKey: '', models: ['my-model'] }],
      remove: ['corp'],
      model: 'my-ai/my-model',
    };
    await llm.saveOpencodeConfig(payload);
    expect(calls[1].url).toBe('/api/llm-admin/opencode');
    expect(calls[1].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual(payload);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/useLlm.test.ts`
Expected: FAIL —— 类型/断言不符（`remove` 未透传、`name`/`baseURL` 未在类型中）。

- [ ] **Step 3: 改实现**

在 `web/src/useLlm.ts` 中，把：

```ts
export interface ProviderSelection { id: string; apiKey: string; models: string[] }
```

改为：

```ts
export interface ProviderSelection { id: string; name?: string; baseURL?: string; apiKey: string; models: string[] }
```

把 `saveOpencodeConfig` 改为：

```ts
    saveOpencodeConfig: (payload: { providers: ProviderSelection[]; remove: string[]; model: string }) =>
      post<{ ok: boolean; path: string; backups: string[]; config: unknown; skipped: string[] }>('/api/llm-admin/opencode', payload),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/useLlm.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/useLlm.ts web/src/useLlm.test.ts
git commit -m "feat(web): saveOpencodeConfig 支持 remove 与自定义 provider 字段"
```

---

### Task 4: 前端统一数据模型 `llmPresets.ts`

**Files:**
- Modify: `web/src/llmPresets.ts`
- Test: `web/src/llmPresets.test.ts`

- [ ] **Step 1: 写失败测试**

把 `web/src/llmPresets.test.ts` 整个替换为：

```ts
import { describe, it, expect } from 'vitest';
import { providersFromConfig, addablePresets, buildProviders, modelOptions, type ConfiguredProvider } from './llmPresets';

describe('llmPresets helpers', () => {
  it('providersFromConfig 回显预设与自定义 provider', () => {
    const list = providersFromConfig({
      provider: {
        deepseek: { options: { apiKey: 'K' }, models: { 'deepseek-v4-flash': {}, 'my-extra': {} } },
        corp: { name: 'Corp', options: { baseURL: 'https://gw/v1', apiKey: 'C' }, models: { a: {}, b: {} } },
      },
    });
    const ds = list.find((s) => s.id === 'deepseek')!;
    expect(ds.custom).toBe(false);
    expect(ds.name).toBe('DeepSeek');
    expect(ds.baseURL).toBe('https://api.deepseek.com/v1');
    expect(ds.hasKey).toBe(true);
    expect(ds.apiKey).toBe('');
    expect(ds.models).toEqual(['deepseek-v4-flash']);
    expect(ds.extraModels).toBe('my-extra');

    const corp = list.find((s) => s.id === 'corp')!;
    expect(corp.custom).toBe(true);
    expect(corp.name).toBe('Corp');
    expect(corp.baseURL).toBe('https://gw/v1');
    expect(corp.models).toEqual([]);
    expect(corp.extraModels).toBe('a, b');
  });

  it('providersFromConfig 空配置返回空数组（不再平铺预设）', () => {
    expect(providersFromConfig({ provider: {} })).toEqual([]);
    expect(providersFromConfig(null)).toEqual([]);
  });

  it('addablePresets 排除已配置', () => {
    const list = providersFromConfig({ provider: { deepseek: {} } });
    const ids = addablePresets(list).map((p) => p.id);
    expect(ids).not.toContain('deepseek');
    expect(ids).toContain('glm');
  });

  it('buildProviders 合并勾选与手填、去重去空', () => {
    const list: ConfiguredProvider[] = [
      { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', custom: false, hasKey: false, apiKey: 'NEW', models: ['deepseek-v4-flash'], extraModels: 'my-extra, , deepseek-v4-flash' },
    ];
    expect(buildProviders(list)).toEqual([
      { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', apiKey: 'NEW', models: ['deepseek-v4-flash', 'my-extra'] },
    ]);
  });

  it('modelOptions 汇总 provider/model', () => {
    const list: ConfiguredProvider[] = [
      { id: 'deepseek', name: 'DeepSeek', baseURL: '', custom: false, hasKey: false, apiKey: '', models: ['deepseek-v4-flash'], extraModels: '' },
      { id: 'corp', name: 'Corp', baseURL: '', custom: true, hasKey: false, apiKey: '', models: [], extraModels: 'glm-4.6' },
    ];
    expect(modelOptions(list)).toEqual(['deepseek/deepseek-v4-flash', 'corp/glm-4.6']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/llmPresets.test.ts`
Expected: FAIL —— 旧文件没有 `providersFromConfig`/`addablePresets`/`buildProviders` 导出。

- [ ] **Step 3: 改实现**

把 `web/src/llmPresets.ts` 整个替换为：

```ts
import { LLM_PROVIDER_PRESETS, type LlmProviderPreset } from '@devflow/shared/llm-presets';
import { apiKeysOf, type OpencodeConfigJson } from './opencodeConfig';
import type { ProviderSelection } from './useLlm';

export interface ConfiguredProvider {
  id: string;
  name: string;
  baseURL: string;
  custom: boolean;
  hasKey: boolean;
  apiKey: string;
  models: string[];
  extraModels: string;
}

export function providersFromConfig(
  config: OpencodeConfigJson | null,
  presets: LlmProviderPreset[] = LLM_PROVIDER_PRESETS,
): ConfiguredProvider[] {
  const prov = config?.provider || {};
  const presetMap = new Map(presets.map((p) => [p.id, p]));
  return Object.entries(prov).map(([id, p]) => {
    const preset = presetMap.get(id);
    const options = p?.options || {};
    const ids = Object.keys(p?.models || {});
    const presetIds = preset ? preset.models.map((m) => m.id) : [];
    const selected = preset ? ids.filter((m) => presetIds.includes(m)) : [];
    const extra = preset ? ids.filter((m) => !presetIds.includes(m)) : ids;
    return {
      id,
      name: (typeof p?.name === 'string' && p.name) || preset?.name || id,
      baseURL: (typeof options.baseURL === 'string' && options.baseURL) || preset?.baseURL || '',
      custom: !preset,
      hasKey: apiKeysOf(options).length > 0,
      apiKey: '',
      models: selected,
      extraModels: extra.join(', '),
    };
  });
}

export function addablePresets(
  list: ConfiguredProvider[],
  presets: LlmProviderPreset[] = LLM_PROVIDER_PRESETS,
): LlmProviderPreset[] {
  const ids = new Set(list.map((p) => p.id));
  return presets.filter((p) => !ids.has(p.id));
}

function splitIds(text: string): string[] {
  return text.split(',').map((t) => t.trim()).filter(Boolean);
}

export function buildProviders(list: ConfiguredProvider[]): ProviderSelection[] {
  const out: ProviderSelection[] = [];
  for (const s of list) {
    const models = [...new Set([...s.models.map((m) => m.trim()).filter(Boolean), ...splitIds(s.extraModels)])];
    out.push({ id: s.id.trim(), name: s.name.trim(), baseURL: s.baseURL.trim(), apiKey: s.apiKey.trim(), models });
  }
  return out;
}

export function modelOptions(list: ConfiguredProvider[]): string[] {
  const out: string[] = [];
  for (const s of list) {
    if (!s.id.trim()) continue;
    for (const m of new Set([...s.models.map((x) => x.trim()).filter(Boolean), ...splitIds(s.extraModels)])) {
      out.push(`${s.id}/${m}`);
    }
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/llmPresets.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/llmPresets.ts web/src/llmPresets.test.ts
git commit -m "feat(web): llmPresets 统一 ConfiguredProvider 与下拉/回显辅助"
```

---

### Task 5: i18n 新增词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 加中文词条**

在 `shared/i18n/zh-CN.js` 的 `'llm.setup.need_key'` 那一行下方插入：

```js
  'llm.setup.add': '添加 Provider',
  'llm.setup.custom': '其他（自定义）',
  'llm.setup.none': '暂无已配置的 provider',
  'llm.setup.remove': '移除',
  'llm.setup.name': '名称（可选）',
  'llm.setup.provider_id': 'Provider ID',
  'llm.setup.baseurl': 'Base URL',
  'llm.setup.custom_models': '模型名（逗号分隔）',
```

- [ ] **Step 2: 加英文词条**

在 `shared/i18n/en.js` 的 `'llm.setup.need_key'` 那一行下方插入：

```js
  'llm.setup.add': 'Add provider',
  'llm.setup.custom': 'Custom',
  'llm.setup.none': 'No providers configured',
  'llm.setup.remove': 'Remove',
  'llm.setup.name': 'Name (optional)',
  'llm.setup.provider_id': 'Provider ID',
  'llm.setup.baseurl': 'Base URL',
  'llm.setup.custom_models': 'Model IDs (comma separated)',
```

- [ ] **Step 3: 校验词条对称**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`（中英键集合对称、无硬编码中文）。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(llm): 新增 provider 下拉/自定义/移除词条"
```

---

### Task 6: 重写 `ModelSetupCard.vue`（下拉 + 回显 + 自定义 + 移除）

**Files:**
- Modify: `web/src/components/ModelSetupCard.vue`
- Create: `web/src/components/ModelSetupCard.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `web/src/components/ModelSetupCard.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import { locale } from '../i18n';
import ModelSetupCard from './ModelSetupCard.vue';

function mount() { return mountC(ModelSetupCard, {}); }

function cfg(provider: Record<string, unknown>) {
  return { path: 'x', exists: true, format: 'json', raw: '', config: { provider } };
}

beforeEach(() => { locale.value = 'zh-CN'; });
afterEach(() => { vi.unstubAllGlobals(); locale.value = 'zh-CN'; });

describe('ModelSetupCard', () => {
  it('回显已配置 provider（含自定义）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => cfg({
      deepseek: { options: { apiKey: 'K' }, models: { 'deepseek-v4-flash': {} } },
      corp: { name: 'Corp', options: { baseURL: 'https://gw/v1', apiKey: 'C' }, models: { a: {} } },
    }) })));
    const w = mount();
    await flushPromises();
    expect(w.findAll('.prov')).toHaveLength(2);
    expect(w.text()).toContain('deepseek');
    expect(w.text()).toContain('Corp');
  });

  it('空配置时不平铺预设', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => cfg({}) })));
    const w = mount();
    await flushPromises();
    expect(w.findAll('.prov')).toHaveLength(0);
    expect(w.text()).toContain('暂无已配置的 provider');
  });

  it('下拉添加自定义 provider 出现编辑框', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => cfg({}) })));
    const w = mount();
    await flushPromises();
    await w.find('[data-test="add"]').setValue('__custom__');
    await flushPromises();
    expect(w.findAll('.prov')).toHaveLength(1);
    expect(w.find('.prov input[placeholder="Provider ID"]').exists()).toBe(true);
    expect(w.find('.prov input[placeholder="Base URL"]').exists()).toBe(true);
  });

  it('移除已配置 provider 并在保存时提交 remove', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ ok: true, skipped: [] }) };
      return { ok: true, json: async () => cfg({ corp: { options: { baseURL: 'https://gw/v1', apiKey: 'C' }, models: { a: {} } } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const w = mount();
    await flushPromises();
    const rm = w.findAll('button').find((b) => b.text() === '移除')!;
    await rm.trigger('click');
    await flushPromises();
    const saveBtn = w.findAll('button').find((b) => b.text() === '保存')!;
    await saveBtn.trigger('click');
    await flushPromises();
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    const body = JSON.parse(String((post[1] as RequestInit).body));
    expect(body.remove).toEqual(['corp']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/components/ModelSetupCard.test.ts`
Expected: FAIL —— 旧组件没有下拉 `[data-test="add"]`、没有「移除」按钮、空配置仍平铺预设。

- [ ] **Step 3: 改实现**

把 `web/src/components/ModelSetupCard.vue` 整个替换为：

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useLlm } from '../useLlm';
import { LLM_PROVIDER_PRESETS, isVisionModel } from '@devflow/shared/llm-presets';
import type { OpencodeConfigFile } from '../opencodeConfig';
import { providersFromConfig, addablePresets, buildProviders, modelOptions, type ConfiguredProvider } from '../llmPresets';

const emit = defineEmits<{ (e: 'saved'): void }>();
const api = useLlm();
const file = ref<OpencodeConfigFile | null>(null);
const providers = ref<ConfiguredProvider[]>([]);
const originalIds = ref<Set<string>>(new Set());
const removed = ref<string[]>([]);
const model = ref('');
const err = ref('');
const saved = ref(false);
const skipped = ref<string[]>([]);

const presets = LLM_PROVIDER_PRESETS;
const options = computed(() => modelOptions(providers.value));
const invalid = computed(() => !!file.value && file.value.exists && file.value.config === null);
const addable = computed(() => addablePresets(providers.value, presets));
const isPreset = (id: string) => !!presets.find((p) => p.id === id);
const presetModels = (id: string) => presets.find((p) => p.id === id)?.models || [];

function applyFile(f: OpencodeConfigFile) {
  file.value = f;
  providers.value = providersFromConfig(f.config, presets);
  originalIds.value = new Set(providers.value.map((p) => p.id));
  removed.value = [];
  model.value = f.config && typeof f.config.model === 'string' ? f.config.model : '';
}
async function load() {
  err.value = '';
  saved.value = false;
  skipped.value = [];
  try { applyFile(await api.opencodeConfig()); } catch (e: any) { err.value = e?.message || String(e); }
}
onMounted(load);

function onAdd(e: Event) {
  const el = e.target as HTMLSelectElement;
  const v = el.value;
  el.value = '';
  if (!v) return;
  const preset = presets.find((p) => p.id === v);
  if (preset) {
    providers.value.push({ id: preset.id, name: preset.name, baseURL: preset.baseURL, custom: false, hasKey: false, apiKey: '', models: [], extraModels: '' });
  } else {
    providers.value.push({ id: '', name: '', baseURL: '', custom: true, hasKey: false, apiKey: '', models: [], extraModels: '' });
  }
}
function removeProvider(i: number) {
  const p = providers.value[i];
  if (originalIds.value.has(p.id)) removed.value.push(p.id);
  providers.value.splice(i, 1);
  if (p.id && model.value.startsWith(`${p.id}/`)) model.value = '';
}
function toggle(s: ConfiguredProvider, mid: string) {
  const i = s.models.indexOf(mid);
  if (i >= 0) s.models.splice(i, 1); else s.models.push(mid);
}
async function save() {
  err.value = '';
  try {
    const r = await api.saveOpencodeConfig({ providers: buildProviders(providers.value), remove: removed.value, model: model.value.trim() });
    skipped.value = r.skipped || [];
    await load();
    saved.value = true;
    emit('saved');
  } catch (e: any) { err.value = e?.message || String(e); }
}
</script>

<template>
  <section class="card">
    <div class="ch">{{ $t('llm.setup.title') }}
      <span class="row">
        <button class="ghost" @click="load">{{ $t('llm.setup.reload') }}</button>
        <button :disabled="invalid" @click="save">{{ saved ? $t('llm.setup.saved') : $t('llm.setup.save') }}</button>
      </span>
    </div>
    <div class="muted">{{ $t('llm.setup.file', { path: file?.path || '' }) }}</div>
    <div v-if="file && !file.exists" class="muted">{{ $t('llm.setup.missing') }}</div>
    <div v-if="invalid" class="warn">{{ $t('llm.setup.invalid') }}</div>
    <div v-if="file?.format === 'jsonc'" class="muted">{{ $t('llm.setup.jsonc_hint') }}</div>
    <div v-if="err" class="err">{{ err }}</div>
    <div v-for="id in skipped" :key="id" class="warn">{{ $t('llm.setup.need_key', { id }) }}</div>

    <div class="row">
      <span class="muted">{{ $t('llm.setup.default_model') }}</span>
      <select v-model="model">
        <option value="">{{ $t('llm.setup.model_none') }}</option>
        <option v-for="m in options" :key="m" :value="m">{{ m }}</option>
      </select>
      <input v-model="model" :placeholder="$t('llm.setup.model_manual')" />
    </div>

    <div class="row">
      <span class="muted">{{ $t('llm.setup.add') }}</span>
      <select data-test="add" @change="onAdd">
        <option value="">—</option>
        <option v-for="p in addable" :key="p.id" :value="p.id">{{ p.name }}</option>
        <option value="__custom__">{{ $t('llm.setup.custom') }}</option>
      </select>
    </div>
    <div v-if="!providers.length" class="muted">{{ $t('llm.setup.none') }}</div>

    <div v-for="(s, i) in providers" :key="i" class="prov">
      <div class="phead">
        <input v-if="s.custom" v-model="s.name" :placeholder="$t('llm.setup.name')" />
        <b v-else>{{ s.name }}</b>
        <span class="muted">{{ s.id }} · {{ s.baseURL }}</span>
        <button class="ghost rm" @click="removeProvider(i)">{{ $t('llm.setup.remove') }}</button>
      </div>
      <div v-if="s.custom" class="row">
        <input v-model="s.id" :placeholder="$t('llm.setup.provider_id')" />
        <input v-model="s.baseURL" :placeholder="$t('llm.setup.baseurl')" />
      </div>
      <div class="row">
        <input v-model="s.apiKey" type="password" :placeholder="s.hasKey ? $t('llm.setup.key_set') : $t('llm.setup.key')" />
      </div>
      <div v-if="isPreset(s.id)" class="models">
        <label v-for="m in presetModels(s.id)" :key="m.id" class="mchk">
          <input type="checkbox" :checked="s.models.includes(m.id)" @change="toggle(s, m.id)" />
          {{ m.id }}<span v-if="isVisionModel(s.id, m.id)" class="vtag">{{ $t('llm.setup.vision') }}</span>
        </label>
      </div>
      <div class="row">
        <input v-model="s.extraModels" :placeholder="isPreset(s.id) ? $t('llm.setup.manual') : $t('llm.setup.custom_models')" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.card { border: 1px solid var(--bd); border-radius: 8px; padding: 10px; background: var(--bg2); display: flex; flex-direction: column; gap: 8px; }
.ch { display: flex; align-items: center; justify-content: space-between; font-weight: 700; color: var(--tx1); }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.row input, .row select { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; }
button { background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; }
button.ghost { background: var(--bg5); color: var(--tx2); border-color: var(--bd); }
button:disabled { opacity: .5; cursor: default; }
.muted { color: var(--tx4); font-size: 12px; }
.warn { color: var(--warn); font-size: 12px; }
.err { color: var(--err); font-size: 12px; }
.prov { border: 1px solid var(--bd); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.phead { display: flex; gap: 8px; align-items: center; }
.phead input { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 6px; font-size: 12px; }
.phead .muted { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.phead .rm { margin-left: auto; }
.models { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 12px; }
.mchk { display: flex; gap: 4px; align-items: center; color: var(--tx2); cursor: pointer; }
.vtag { color: var(--ac2); border: 1px solid var(--ac2); border-radius: 8px; padding: 0 5px; font-size: 10px; }
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/components/ModelSetupCard.test.ts`
Expected: PASS（4 个用例全绿）。

- [ ] **Step 5: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add web/src/components/ModelSetupCard.vue web/src/components/ModelSetupCard.test.ts
git commit -m "feat(web): 极简配置改为下拉添加 + 回显已配置 + 自定义/移除"
```

---

### Task 7: README 更新 + 全量验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新 README 说明**

把 `README.md` 第 74 行的「本机 provider 配置」整条替换为：

```md
- **本机 provider 配置**：面板「极简配置（本机）」顶部下拉可「添加 Provider」——选中 `deepseek`/`glm`/`qwen`/`minimax` 会自动带出内置 baseURL 与常用模型清单，只需填一个上游 API key 并勾选模型；选「其他（自定义）」可手填 `Provider ID`/`Base URL`/模型名。卡片会回显本机 `~/.config/opencode/opencode.json` 里**全部**已配置 provider（含非预设），每张卡可「移除」。保存即写回该文件（多模态模型自动带 `attachment: true`；文件里 `plugin`/`skills`/`agent`/`mcp`/`command` 等其余字段原样保留）。
```

- [ ] **Step 2: 全量测试**

Run: `npm.cmd test`
Expected: server + web 全部 PASS。

- [ ] **Step 3: 类型 + i18n 校验**

Run: `npm.cmd run typecheck`
Expected: 无错误。

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 4: 构建前端**

Run: `npm.cmd run build:web`
Expected: 构建成功（`vue-tsc` 通过）。

- [ ] **Step 5: 敏感信息自查（提交规范要求）**

Run:

```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat-|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git ls-files env
```

Expected: 仅命中检测正则自身/占位符；`git ls-files env` 输出为空。

- [ ] **Step 6: 提交**

```bash
git add README.md
git commit -m "docs(readme): 说明 provider 下拉配置、自定义与移除"
```

- [ ] **Step 7: 人工验收**

启动 dev（`npm.cmd run dev`，端口 33333）→ 打开 LLM 中转站面板：
1. 卡片列出本机已有 provider（含自定义的），模型勾选与已有 key 状态正确。
2. 下拉选 `deepseek` → 出现预填 baseURL/模型清单的卡片。
3. 下拉选「其他（自定义）」→ 出现 `Provider ID`/`Base URL`/模型名输入框。
4. 点某卡「移除」→ 卡片消失；保存后 `~/.config/opencode/opencode.json` 中该 provider 被删除，其余字段（`plugin`/`skills`/`agent`/`mcp`/`command`）未被破坏。

---

## 自查记录

- **Spec 覆盖**：设计 §4（数据模型）→ Task 4；§5（交互/保存 payload）→ Task 6；§6（服务端）→ Task 1/2；§7（i18n）→ Task 5；§8（测试）→ 各任务；§9（文档）→ Task 7。
- **占位符扫描**：无 TBD/TODO；所有代码步骤给出完整代码。
- **类型一致性**：`ConfiguredProvider`（Task 4）与组件（Task 6）、`ProviderSelection`（Task 3）与服务端字段（Task 1/2）一一对应；`buildProviders` 返回 `ProviderSelection[]` 直接作为 `saveOpencodeConfig` 的 `providers`。
