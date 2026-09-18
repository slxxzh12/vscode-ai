# 本机 opencode provider 极简配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一张极简卡（每 provider 一个 apiKey + 勾选模型 + 手填补充）取代复杂编辑卡，给 deepseek/glm/qwen/minimax 写入本机 `opencode.json`，vision 模型自动带 `attachment: true`。

**Architecture:** 预设清单放 `shared/llm-presets.js`（前后端共用）；服务端新增纯函数 `server/llm-provider-presets.js` 把「勾选」合并成 provider 映射（保留非预设 provider 与已有字段），仍走既有 `mergeAndWrite` 备份原子写；前端新增 `web/src/llmPresets.ts` 做状态转换，组件 `ModelSetupCard.vue` 取代 `OpencodeConfigCard.vue`。远程 token 生成链路不动。

**Tech Stack:** Node ESM (`node --test`)、Vue 3 + Vite + TS (vitest + vue-tsc)、npm workspaces (`@devflow/shared` 子路径导出)。

**执行方式：** 本仓库 AGENTS.md 规定默认 **inline（本会话内执行）**，不用 subagent。

---

## File Structure

**Create**

- `shared/llm-presets.js` — 4 个内置 provider 预设 + `presetById` / `isVisionModel`。
- `shared/llm-presets.d.ts` — 上述类型与函数声明。
- `server/llm-provider-presets.js` — `validateSelections` / `mergePresetProviders` 纯函数。
- `server/test/llm-provider-presets.test.js` — 上述单测。
- `web/src/llmPresets.ts` — 配置 → 卡片状态、构建提交、默认模型选项。
- `web/src/llmPresets.test.ts` — 上述单测。
- `web/src/components/ModelSetupCard.vue` — 极简配置卡。

**Modify**

- `shared/package.json` — `exports` 增加 `./llm-presets`。
- `server/llm-mount.js` — `POST /api/llm-admin/opencode` 改为 `{ providers, model }`。
- `server/test/llm-mount.test.js` — 更新 opencode GET/POST 用例。
- `web/src/useLlm.ts` — `saveOpencodeConfig` 新 payload + `ProviderSelection` 类型。
- `web/src/useLlm.test.ts` — 同步。
- `web/src/opencodeConfig.ts` — 仅留类型与 `apiKeysOf`。
- `web/src/opencodeConfig.test.ts` — 同步裁剪。
- `web/src/components/ProxyView.vue` — 换用 `ModelSetupCard`。
- `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — 删 `llm.oc.*`，加 `llm.setup.*`。
- `README.md` — relay 节补本机配置说明。
- `docs/superpowers/specs/2026-09-18-relay-opencode-config-editor-design.md`、`docs/superpowers/plans/2026-09-18-relay-opencode-config-editor.md` — 顶部加被取代说明。

**Delete**

- `web/src/components/OpencodeConfigCard.vue`。

---

### Task 1: 共享预设清单 `shared/llm-presets.js`

**Files:**
- Create: `shared/llm-presets.js`
- Create: `shared/llm-presets.d.ts`
- Modify: `shared/package.json`
- Test: `server/test/llm-provider-presets.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/llm-provider-presets.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetById, isVisionModel } from '@devflow/shared/llm-presets';

test('presetById 命中四个内置 provider', () => {
  for (const id of ['deepseek', 'glm', 'qwen', 'minimax']) {
    const p = presetById(id);
    assert.ok(p, id);
    assert.equal(p.id, id);
    assert.ok(p.baseURL.startsWith('https://'));
    assert.ok(p.models.length > 0);
  }
  assert.equal(presetById('nope'), null);
});

test('isVisionModel：预设标记与模型名兜底', () => {
  assert.equal(isVisionModel('deepseek', 'deepseek-v4-flash-vision-exp'), true);
  assert.equal(isVisionModel('deepseek', 'deepseek-v4-flash'), false);
  assert.equal(isVisionModel('qwen', 'qwen-vl-max'), true);
  assert.equal(isVisionModel('glm', 'glm-4v-plus'), true);
  assert.equal(isVisionModel('custom', 'my-vl-model'), true);
  assert.equal(isVisionModel('custom', 'plain-text'), false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL，`Cannot find package '@devflow/shared/llm-presets'`（或模块未导出）。

- [ ] **Step 3: 创建 `shared/llm-presets.js`**

```js
export const LLM_PROVIDER_PRESETS = Object.freeze([
  Object.freeze({
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: Object.freeze([
      Object.freeze({ id: 'deepseek-v4-pro', vision: false }),
      Object.freeze({ id: 'deepseek-v4-flash', vision: false }),
      Object.freeze({ id: 'deepseek-v4-flash-vision-exp', vision: true }),
    ]),
  }),
  Object.freeze({
    id: 'glm',
    name: 'GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: Object.freeze([
      Object.freeze({ id: 'glm-4.6', vision: false }),
      Object.freeze({ id: 'glm-4.5-air', vision: false }),
      Object.freeze({ id: 'glm-4v-plus', vision: true }),
    ]),
  }),
  Object.freeze({
    id: 'qwen',
    name: 'Qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: Object.freeze([
      Object.freeze({ id: 'qwen3-max', vision: false }),
      Object.freeze({ id: 'qwen3-coder-plus', vision: false }),
      Object.freeze({ id: 'qwen-vl-max', vision: true }),
    ]),
  }),
  Object.freeze({
    id: 'minimax',
    name: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    models: Object.freeze([
      Object.freeze({ id: 'MiniMax-M2', vision: false }),
      Object.freeze({ id: 'MiniMax-Text-01', vision: false }),
      Object.freeze({ id: 'MiniMax-VL-01', vision: true }),
    ]),
  }),
]);

export function presetById(id) {
  return LLM_PROVIDER_PRESETS.find((p) => p.id === id) || null;
}

const VISION_RE = /vision|(^|[-_/])vl([-_/.]|$)|4v|omni/i;

export function isVisionModel(providerId, modelId) {
  const preset = presetById(providerId);
  const hit = preset && preset.models.find((m) => m.id === modelId);
  if (hit) return !!hit.vision;
  return typeof modelId === 'string' && VISION_RE.test(modelId);
}
```

- [ ] **Step 4: 创建 `shared/llm-presets.d.ts`**

```ts
export interface LlmPresetModel { id: string; vision: boolean }
export interface LlmProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  models: LlmPresetModel[];
}
export declare const LLM_PROVIDER_PRESETS: LlmProviderPreset[];
export declare function presetById(id: string): LlmProviderPreset | null;
export declare function isVisionModel(providerId: string, modelId: string): boolean;
```

- [ ] **Step 5: `shared/package.json` 增加导出**

在 `exports` 中 `"./git-filter"` 一行后加入：

```json
    "./llm-presets": { "types": "./llm-presets.d.ts", "default": "./llm-presets.js" },
```

- [ ] **Step 6: 运行确认通过**

Run: `npm.cmd run test:server`
Expected: PASS（新增两条用例通过）。

- [ ] **Step 7: 提交**

```bash
git add shared/llm-presets.js shared/llm-presets.d.ts shared/package.json server/test/llm-provider-presets.test.js
git commit -m "feat(shared): 内置 LLM provider 预设与多模态识别"
```

---

### Task 2: 服务端合并纯函数 `server/llm-provider-presets.js`

**Files:**
- Create: `server/llm-provider-presets.js`
- Test: `server/test/llm-provider-presets.test.js`（追加）

- [ ] **Step 1: 追加失败测试**

在 `server/test/llm-provider-presets.test.js` 顶部 import 增加：

```js
import { validateSelections, mergePresetProviders } from '../llm-provider-presets.js';
```

文件末尾追加：

```js
test('validateSelections 拒绝非法结构', () => {
  assert.throws(() => validateSelections('x'), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'nope', models: [] }]), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'deepseek', models: 'x' }]), (e) => e.code === 'bad-config');
  assert.throws(() => validateSelections([{ id: 'deepseek', models: [], apiKey: 1 }]), (e) => e.code === 'bad-config');
  assert.doesNotThrow(() => validateSelections([{ id: 'deepseek', models: ['deepseek-v4-flash'] }]));
});

test('mergePresetProviders：单 key、vision attachment、保留非预设 provider 与模型附加字段', () => {
  const current = {
    corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { a: {} } },
    deepseek: { options: { baseURL: 'old', apiKeys: ['A', 'B'] }, models: { 'deepseek-v4-flash': { name: 'Legacy' } } },
  };
  const { provider, skipped } = mergePresetProviders({
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

test('mergePresetProviders：留空保留旧 key、无 key 记 skipped', () => {
  const current = { glm: { options: { baseURL: 'x', apiKey: 'OLD' }, models: {} } };
  const a = mergePresetProviders({ current, selections: [{ id: 'glm', apiKey: '', models: ['glm-4.6'] }] });
  assert.equal(a.provider.glm.options.apiKey, 'OLD');
  assert.deepEqual(a.skipped, []);

  const b = mergePresetProviders({ current: {}, selections: [{ id: 'qwen', apiKey: '', models: ['qwen3-max'] }] });
  assert.equal('qwen' in b.provider, false);
  assert.deepEqual(b.skipped, ['qwen']);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL，`Cannot find module '../llm-provider-presets.js'`。

- [ ] **Step 3: 创建 `server/llm-provider-presets.js`**

```js
import { LLM_PROVIDER_PRESETS, presetById, isVisionModel } from '@devflow/shared/llm-presets';

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

export function validateSelections(value) {
  if (!Array.isArray(value)) fail('bad-config', 'providers must be an array');
  for (const sel of value) {
    if (!sel || typeof sel !== 'object' || Array.isArray(sel)) fail('bad-config', 'selection must be an object');
    if (typeof sel.id !== 'string' || !sel.id) fail('bad-config', 'selection.id required');
    if (!presetById(sel.id)) fail('bad-config', `unknown provider: ${sel.id}`);
    if (sel.apiKey !== undefined && typeof sel.apiKey !== 'string') fail('bad-config', 'apiKey must be a string');
    if (!Array.isArray(sel.models) || sel.models.some((m) => typeof m !== 'string')) {
      fail('bad-config', 'models must be a string array');
    }
  }
}

function existingKeys(options) {
  const o = options || {};
  const raw = Array.isArray(o.apiKeys) ? o.apiKeys : (typeof o.apiKey === 'string' && o.apiKey ? [o.apiKey] : []);
  const out = [];
  for (const k of raw) if (typeof k === 'string' && k && !out.includes(k)) out.push(k);
  return out;
}

export function mergePresetProviders({ current = {}, selections = [], presets = LLM_PROVIDER_PRESETS } = {}) {
  const out = { ...current };
  const skipped = [];
  const presetMap = new Map(presets.map((p) => [p.id, p]));
  for (const sel of selections) {
    const preset = presetMap.get(sel.id);
    if (!preset) continue;
    const existing = current[sel.id] && typeof current[sel.id] === 'object' && !Array.isArray(current[sel.id])
      ? current[sel.id]
      : {};
    const incoming = typeof sel.apiKey === 'string' ? sel.apiKey.trim() : '';
    const keys = incoming ? [incoming] : existingKeys(existing.options);
    if (!keys.length) { skipped.push(sel.id); continue; }

    const opts = { ...(existing.options || {}), baseURL: preset.baseURL };
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

    out[sel.id] = { ...existing, name: preset.name, options: opts, models };
  }
  return { provider: out, skipped };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd run test:server`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/llm-provider-presets.js server/test/llm-provider-presets.test.js
git commit -m "feat(server): 预设 provider 选择合并为 opencode provider 映射"
```

---

### Task 3: 路由改用 `{ providers, model }`

**Files:**
- Modify: `server/llm-mount.js:6`（import）、`server/llm-mount.js:156-164`（POST opencode）
- Test: `server/test/llm-mount.test.js:318-361`

- [ ] **Step 1: 改失败测试**

把 `server/test/llm-mount.test.js` 的 `opencode 配置 GET/POST：无需解锁，写盘且保留其余顶层键`（318-348 行）替换为：

```js
test('opencode 配置 GET/POST：预设选择写盘、保留其余顶层键与非预设 provider', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    agent: { a: {} },
    provider: {
      corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { m1: {} } },
      deepseek: { options: { baseURL: 'old', apiKey: 'OLD' }, models: { 'deepseek-v4-flash': { name: 'Legacy' } } },
    },
    model: 'corp/m1',
  }));
  const vault = tmpVault();
  vault.init('pw');
  vault.lock();
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, opencodeDir: oc });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());

  const g = await jget(server, '/api/llm-admin/opencode');
  assert.equal(g.status, 200);
  assert.equal(JSON.parse(g.body).config.provider.corp.options.apiKey, 'K');

  const r = await jpost(server, '/api/llm-admin/opencode', {
    providers: [
      { id: 'deepseek', apiKey: '', models: ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'] },
      { id: 'qwen', apiKey: '', models: ['qwen3-max'] },
    ],
    model: 'deepseek/deepseek-v4-flash',
  });
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.deepEqual(body.skipped, ['qwen']);

  const saved = JSON.parse(fs.readFileSync(path.join(oc, 'opencode.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.provider).sort(), ['corp', 'deepseek']);
  assert.equal(saved.provider.corp.options.apiKey, 'K');
  assert.equal(saved.provider.deepseek.options.baseURL, 'https://api.deepseek.com/v1');
  assert.equal(saved.provider.deepseek.options.apiKey, 'OLD');
  assert.equal(saved.provider.deepseek.models['deepseek-v4-flash'].name, 'Legacy');
  assert.equal(saved.provider.deepseek.models['deepseek-v4-flash-vision-exp'].attachment, true);
  assert.equal(saved.model, 'deepseek/deepseek-v4-flash');
  assert.deepEqual(saved.agent, { a: {} });
});
```

把 `opencode 配置 POST 非法体 400、坏文件 400`（350-361 行）替换为：

```js
test('opencode 配置 POST 非法体 400、坏文件 400', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), '{ broken');
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, opencodeDir: oc });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  assert.equal((await jpost(server, '/api/llm-admin/opencode', { providers: 'x', model: '' })).status, 400);
  assert.equal((await jpost(server, '/api/llm-admin/opencode', { providers: [{ id: 'nope', models: [] }], model: '' })).status, 400);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: FAIL（旧路由读不到 `providers`，断言不符）。

- [ ] **Step 3: 改 `server/llm-mount.js` import**

把第 7 行：

```js
import { readActiveConfig, mergeAndWrite } from './llm-opencode-config.js';
```

改为：

```js
import { readActiveConfig, mergeAndWrite } from './llm-opencode-config.js';
import { validateSelections, mergePresetProviders } from './llm-provider-presets.js';
```

- [ ] **Step 4: 改 `server/llm-mount.js` POST opencode**

把 156-164 行的 POST 分支：

```js
      if (seg[0] === 'opencode' && !seg[1] && method === 'POST') {
        const b = await readJson(req);
        const saved = mergeAndWrite({
          dir: opencodeDir,
          provider: b.provider || {},
          model: typeof b.model === 'string' ? b.model : '',
        });
        return sendJson(res, 200, { ok: true, path: saved.path, backups: saved.backups, config: saved.config });
      }
```

替换为：

```js
      if (seg[0] === 'opencode' && !seg[1] && method === 'POST') {
        const b = await readJson(req);
        const selections = Array.isArray(b.providers) ? b.providers : [];
        validateSelections(selections);
        const current = readActiveConfig({ dir: opencodeDir }).config?.provider || {};
        const { provider, skipped } = mergePresetProviders({ current, selections });
        const saved = mergeAndWrite({
          dir: opencodeDir,
          provider,
          model: typeof b.model === 'string' ? b.model : '',
        });
        return sendJson(res, 200, { ok: true, path: saved.path, backups: saved.backups, config: saved.config, skipped });
      }
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test "server/test/llm-mount.test.js"`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add server/llm-mount.js server/test/llm-mount.test.js
git commit -m "feat(server): opencode 配置接口改用预设 provider 选择"
```

---

### Task 4: 前端状态辅助 `web/src/llmPresets.ts`

**Files:**
- Create: `web/src/llmPresets.ts`
- Test: `web/src/llmPresets.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/llmPresets.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { stateFromConfig, buildSelections, modelOptions } from './llmPresets';

describe('llmPresets helpers', () => {
  it('stateFromConfig 标记 hasKey、勾选预设模型、非预设进 manual', () => {
    const states = stateFromConfig({
      provider: {
        deepseek: { options: { apiKey: 'K' }, models: { 'deepseek-v4-flash': {}, 'my-extra': {} } },
      },
    });
    const ds = states.find((s) => s.id === 'deepseek')!;
    expect(ds.hasKey).toBe(true);
    expect(ds.apiKey).toBe('');
    expect(ds.selected).toEqual(['deepseek-v4-flash']);
    expect(ds.manual).toBe('my-extra');
    const glm = states.find((s) => s.id === 'glm')!;
    expect(glm.hasKey).toBe(false);
    expect(glm.selected).toEqual([]);
    expect(glm.manual).toBe('');
  });

  it('buildSelections 合并勾选与手填、去重去空、无 key 无模型则跳过', () => {
    const states = stateFromConfig({ provider: {} });
    const ds = states.find((s) => s.id === 'deepseek')!;
    ds.apiKey = 'NEW';
    ds.selected = ['deepseek-v4-flash'];
    ds.manual = 'my-extra, , deepseek-v4-flash';
    const sel = buildSelections(states);
    expect(sel).toEqual([{ id: 'deepseek', apiKey: 'NEW', models: ['deepseek-v4-flash', 'my-extra'] }]);
  });

  it('modelOptions 汇总已选 provider/model', () => {
    const states = stateFromConfig({ provider: {} });
    states.find((s) => s.id === 'deepseek')!.selected = ['deepseek-v4-flash'];
    states.find((s) => s.id === 'glm')!.manual = 'glm-4.6';
    expect(modelOptions(states)).toEqual(['deepseek/deepseek-v4-flash', 'glm/glm-4.6']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web exec vitest run src/llmPresets.test.ts`
Expected: FAIL，找不到 `./llmPresets`。

- [ ] **Step 3: 创建 `web/src/llmPresets.ts`**

```ts
import { LLM_PROVIDER_PRESETS, type LlmProviderPreset } from '@devflow/shared/llm-presets';
import { apiKeysOf, type OpencodeConfigJson } from './opencodeConfig';

export interface ProviderState {
  id: string;
  name: string;
  baseURL: string;
  hasKey: boolean;
  apiKey: string;
  selected: string[];
  manual: string;
}

export function stateFromConfig(
  config: OpencodeConfigJson | null,
  presets: LlmProviderPreset[] = LLM_PROVIDER_PRESETS,
): ProviderState[] {
  const prov = config?.provider || {};
  return presets.map((p) => {
    const existing = prov[p.id];
    const hasKey = apiKeysOf(existing?.options).length > 0;
    const ids = Object.keys(existing?.models || {});
    const presetIds = p.models.map((m) => m.id);
    const selected = presetIds.filter((m) => ids.includes(m));
    const manual = ids.filter((m) => !presetIds.includes(m)).join(', ');
    return { id: p.id, name: p.name, baseURL: p.baseURL, hasKey, apiKey: '', selected, manual };
  });
}

export function buildSelections(states: ProviderState[]): { id: string; apiKey: string; models: string[] }[] {
  const out: { id: string; apiKey: string; models: string[] }[] = [];
  for (const s of states) {
    const manualIds = s.manual.split(',').map((t) => t.trim()).filter(Boolean);
    const models = [...new Set([...s.selected.map((m) => m.trim()).filter(Boolean), ...manualIds])];
    if (!s.apiKey.trim() && !s.hasKey && !models.length) continue;
    out.push({ id: s.id, apiKey: s.apiKey.trim(), models });
  }
  return out;
}

export function modelOptions(states: ProviderState[]): string[] {
  const out: string[] = [];
  for (const s of states) {
    const manualIds = s.manual.split(',').map((t) => t.trim()).filter(Boolean);
    for (const m of new Set([...s.selected.map((x) => x.trim()).filter(Boolean), ...manualIds])) {
      out.push(`${s.id}/${m}`);
    }
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web exec vitest run src/llmPresets.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/llmPresets.ts web/src/llmPresets.test.ts
git commit -m "feat(web): 极简配置卡状态辅助函数"
```

---

### Task 5: 极简卡组件 + useLlm + 接入 ProxyView

**Files:**
- Create: `web/src/components/ModelSetupCard.vue`
- Modify: `web/src/useLlm.ts:1,48-50`
- Modify: `web/src/useLlm.test.ts`（saveOpencodeConfig 断言）
- Modify: `web/src/components/ProxyView.vue:6,306`

- [ ] **Step 1: 改 `web/src/useLlm.ts`**

把第 1 行：

```ts
import type { OpencodeConfigFile, OpencodeProvider } from './opencodeConfig';
```

改为：

```ts
import type { OpencodeConfigFile } from './opencodeConfig';

export interface ProviderSelection { id: string; apiKey: string; models: string[] }
```

把第 49-50 行：

```ts
    saveOpencodeConfig: (payload: { provider: Record<string, OpencodeProvider>; model: string }) =>
      post<{ ok: boolean; path: string; backups: string[]; config: unknown }>('/api/llm-admin/opencode', payload),
```

改为：

```ts
    saveOpencodeConfig: (payload: { providers: ProviderSelection[]; model: string }) =>
      post<{ ok: boolean; path: string; backups: string[]; config: unknown; skipped: string[] }>('/api/llm-admin/opencode', payload),
```

- [ ] **Step 2: 改 `web/src/useLlm.test.ts`**

把：

```ts
    await llm.saveOpencodeConfig({ provider: { a: {} }, model: 'a/m' });
    expect(calls[1].url).toBe('/api/llm-admin/opencode');
```

改为：

```ts
    await llm.saveOpencodeConfig({ providers: [{ id: 'deepseek', apiKey: '', models: ['deepseek-v4-flash'] }], model: 'deepseek/deepseek-v4-flash' });
    expect(calls[1].url).toBe('/api/llm-admin/opencode');
    expect(JSON.parse(calls[1].init.body as string).providers[0].id).toBe('deepseek');
```

- [ ] **Step 3: 创建 `web/src/components/ModelSetupCard.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useLlm } from '../useLlm';
import { LLM_PROVIDER_PRESETS, isVisionModel } from '@devflow/shared/llm-presets';
import type { OpencodeConfigFile } from '../opencodeConfig';
import { stateFromConfig, buildSelections, modelOptions, type ProviderState } from '../llmPresets';
import { t } from '../i18n';

const emit = defineEmits<{ (e: 'saved'): void }>();
const api = useLlm();
const file = ref<OpencodeConfigFile | null>(null);
const states = ref<ProviderState[]>([]);
const model = ref('');
const err = ref('');
const saved = ref(false);
const skipped = ref<string[]>([]);

const presets = LLM_PROVIDER_PRESETS;
const options = computed(() => modelOptions(states.value));
const invalid = computed(() => !!file.value && file.value.exists && file.value.config === null);
const presetModels = (id: string) => presets.find((p) => p.id === id)?.models || [];

function applyFile(f: OpencodeConfigFile) {
  file.value = f;
  states.value = stateFromConfig(f.config);
  model.value = f.config && typeof f.config.model === 'string' ? f.config.model : '';
}
async function load() {
  err.value = '';
  saved.value = false;
  skipped.value = [];
  try { applyFile(await api.opencodeConfig()); } catch (e: any) { err.value = e?.message || String(e); }
}
onMounted(load);

function toggle(s: ProviderState, mid: string) {
  const i = s.selected.indexOf(mid);
  if (i >= 0) s.selected.splice(i, 1); else s.selected.push(mid);
}
async function save() {
  err.value = '';
  try {
    const r = await api.saveOpencodeConfig({ providers: buildSelections(states.value), model: model.value.trim() });
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

    <div v-for="s in states" :key="s.id" class="prov">
      <div class="phead"><b>{{ s.name }}</b><span class="muted">{{ s.id }} · {{ s.baseURL }}</span></div>
      <div class="row">
        <input v-model="s.apiKey" type="password" :placeholder="s.hasKey ? $t('llm.setup.key_set') : $t('llm.setup.key')" />
      </div>
      <div class="models">
        <label v-for="m in presetModels(s.id)" :key="m.id" class="mchk">
          <input type="checkbox" :checked="s.selected.includes(m.id)" @change="toggle(s, m.id)" />
          {{ m.id }}<span v-if="isVisionModel(s.id, m.id)" class="vtag">{{ $t('llm.setup.vision') }}</span>
        </label>
      </div>
      <div class="row">
        <input v-model="s.manual" :placeholder="$t('llm.setup.manual')" />
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
.phead { display: flex; gap: 8px; align-items: baseline; }
.phead .muted { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.models { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 12px; }
.mchk { display: flex; gap: 4px; align-items: center; color: var(--tx2); cursor: pointer; }
.vtag { color: var(--ac2); border: 1px solid var(--ac2); border-radius: 8px; padding: 0 5px; font-size: 10px; }
</style>
```

- [ ] **Step 4: 接入 `web/src/components/ProxyView.vue`**

第 6 行：

```ts
import OpencodeConfigCard from './OpencodeConfigCard.vue';
```

改为：

```ts
import ModelSetupCard from './ModelSetupCard.vue';
```

第 306 行：

```html
    <OpencodeConfigCard @saved="refresh" />
```

改为：

```html
    <ModelSetupCard @saved="refresh" />
```

- [ ] **Step 5: 运行确认通过**

Run: `npm.cmd --prefix web exec vitest run src/useLlm.test.ts src/llmPresets.test.ts` 然后 `npm.cmd run typecheck`
Expected: PASS + vue-tsc 无错误。

- [ ] **Step 6: 提交**

```bash
git add web/src/components/ModelSetupCard.vue web/src/useLlm.ts web/src/useLlm.test.ts web/src/components/ProxyView.vue
git commit -m "feat(web): 极简本机 provider 配置卡取代复杂编辑卡"
```

---

### Task 6: 删旧卡、裁剪 opencodeConfig、i18n

**Files:**
- Delete: `web/src/components/OpencodeConfigCard.vue`
- Modify: `web/src/opencodeConfig.ts`, `web/src/opencodeConfig.test.ts`
- Modify: `shared/i18n/zh-CN.js`, `shared/i18n/en.js`

- [ ] **Step 1: 删除旧卡**

Run: `Remove-Item -LiteralPath "web/src/components/OpencodeConfigCard.vue"`
Expected: 文件删除成功。

- [ ] **Step 2: 裁剪 `web/src/opencodeConfig.ts`**

整个文件替换为：

```ts
export type OpencodeModel = Record<string, unknown>;
export interface OpencodeProviderOptions {
  baseURL?: string;
  apiKey?: string;
  apiKeys?: string[];
  [k: string]: unknown;
}
export interface OpencodeProvider {
  name?: string;
  options?: OpencodeProviderOptions;
  models?: Record<string, OpencodeModel>;
  [k: string]: unknown;
}
export interface OpencodeConfigJson {
  $schema?: string;
  model?: string;
  provider?: Record<string, OpencodeProvider>;
  [k: string]: unknown;
}
export interface OpencodeConfigFile {
  path: string;
  exists: boolean;
  format: 'json' | 'jsonc' | null;
  raw: string;
  config: OpencodeConfigJson | null;
}

export function apiKeysOf(options: OpencodeProviderOptions | undefined): string[] {
  const o = options || {};
  const raw = Array.isArray(o.apiKeys) ? o.apiKeys : (typeof o.apiKey === 'string' && o.apiKey ? [o.apiKey] : []);
  const out: string[] = [];
  for (const k of raw) if (typeof k === 'string' && k && !out.includes(k)) out.push(k);
  return out;
}
```

- [ ] **Step 3: 裁剪 `web/src/opencodeConfig.test.ts`**

整个文件替换为：

```ts
import { describe, it, expect } from 'vitest';
import { apiKeysOf } from './opencodeConfig';

describe('opencodeConfig helpers', () => {
  it('apiKeysOf 兼容 apiKey/apiKeys 并去重去空', () => {
    expect(apiKeysOf({ apiKey: 'K' })).toEqual(['K']);
    expect(apiKeysOf({ apiKeys: ['A', 'B', 'A', ''] })).toEqual(['A', 'B']);
    expect(apiKeysOf(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 4: i18n 删旧增新（中英对称）**

在 `shared/i18n/zh-CN.js` 中删除全部 30 行 `'llm.oc.*'`，替换为：

```js
  'llm.setup.title': '极简配置（本机）',
  'llm.setup.reload': '重新读取',
  'llm.setup.file': '文件：{path}',
  'llm.setup.save': '保存',
  'llm.setup.saved': '已保存',
  'llm.setup.missing': '未找到 opencode.json，保存时会新建。',
  'llm.setup.invalid': '现有文件不是合法 JSON，无法保存。',
  'llm.setup.jsonc_hint': '当前是 .jsonc；保存会写入 opencode.json，原 .jsonc 备份为 .bak。',
  'llm.setup.default_model': '默认模型',
  'llm.setup.model_none': '（不设置）',
  'llm.setup.model_manual': '手填 provider/model',
  'llm.setup.key': 'API key',
  'llm.setup.key_set': '已配置（留空不修改）',
  'llm.setup.vision': '图像',
  'llm.setup.manual': '补充模型（逗号分隔）',
  'llm.setup.need_key': '{id} 未填 key，已跳过',
```

在 `shared/i18n/en.js` 中删除全部 30 行 `'llm.oc.*'`，替换为：

```js
  'llm.setup.title': 'Quick setup (local)',
  'llm.setup.reload': 'Reload',
  'llm.setup.file': 'File: {path}',
  'llm.setup.save': 'Save',
  'llm.setup.saved': 'Saved',
  'llm.setup.missing': 'opencode.json not found; it will be created on save.',
  'llm.setup.invalid': 'The existing file is not valid JSON; saving is disabled.',
  'llm.setup.jsonc_hint': 'Currently .jsonc; saving writes opencode.json and backs the original up as .bak.',
  'llm.setup.default_model': 'Default model',
  'llm.setup.model_none': '(none)',
  'llm.setup.model_manual': 'Custom provider/model',
  'llm.setup.key': 'API key',
  'llm.setup.key_set': 'Configured (leave blank to keep)',
  'llm.setup.vision': 'image',
  'llm.setup.manual': 'Extra models (comma separated)',
  'llm.setup.need_key': '{id} skipped: no API key',
```

- [ ] **Step 5: 运行确认通过**

Run: `npm.cmd run check:i18n` 然后 `npm.cmd --prefix web exec vitest run src/opencodeConfig.test.ts` 然后 `npm.cmd run typecheck`
Expected: i18n 零命中、vitest 通过、vue-tsc 无错误。

- [ ] **Step 6: 提交**

```bash
git add web/src/components/OpencodeConfigCard.vue web/src/opencodeConfig.ts web/src/opencodeConfig.test.ts shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "refactor(web): 删除旧 opencode 配置编辑卡并整理词条"
```

---

### Task 7: 文档更新

**Files:**
- Modify: `README.md`（relay 节）
- Modify: `docs/superpowers/specs/2026-09-18-relay-opencode-config-editor-design.md`（顶部状态行）
- Modify: `docs/superpowers/plans/2026-09-18-relay-opencode-config-editor.md`（顶部说明）

- [ ] **Step 1: README 补一段**

在 `README.md`「本机 LLM 中转站（relay）」节、`- **上游 baseURL**` 一行之后追加：

```markdown
- **本机 provider 配置**：面板「极简配置（本机）」给 `deepseek`/`glm`/`qwen`/`minimax` 各填一个上游 API key 并勾选模型，保存即写入本机 `~/.config/opencode/opencode.json`（内置 baseURL 与常用模型；多模态模型自动带 `attachment: true`）。文件里其余 provider 与 `plugin`/`skills`/`agent`/`mcp`/`command` 等字段原样保留。
```

- [ ] **Step 2: 旧设计文档加取代说明**

在 `docs/superpowers/specs/2026-09-18-relay-opencode-config-editor-design.md` 的 `状态：` 行后新增一行：

```markdown
取代：已被 `docs/superpowers/specs/2026-09-18-relay-opencode-simple-config-design.md` 取代（复杂行式编辑器改为极简配置卡）。
```

- [ ] **Step 3: 旧实现计划加取代说明**

在 `docs/superpowers/plans/2026-09-18-relay-opencode-config-editor.md` 标题后第一行新增：

```markdown
> 已被 `docs/superpowers/plans/2026-09-18-relay-opencode-simple-config.md` 取代（保留历史）。
```

- [ ] **Step 4: 全量验证**

Run: `npm.cmd test` 然后 `npm.cmd run typecheck` 然后 `npm.cmd run check:i18n` 然后 `npm.cmd run build:web`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add README.md docs/superpowers/specs/2026-09-18-relay-opencode-config-editor-design.md docs/superpowers/plans/2026-09-18-relay-opencode-config-editor.md
git commit -m "docs: 本机 provider 极简配置说明与旧文档取代标注"
```

---

## Self-Review

**Spec coverage**

| Spec 节 | 覆盖任务 |
|---|---|
| §4 预设数据 | Task 1 |
| §5 前端交互 | Task 4（状态）、Task 5（组件） |
| §6.1 mergePresetProviders | Task 2 |
| §6.2 路由 body | Task 3 |
| §6.3 mergeAndWrite 不动 | 未改动（Task 3 仅调用） |
| §7 多模态 attachment | Task 1（判定）+ Task 2（写入） |
| §8 i18n | Task 6 |
| §9 测试 | Task 1-6 各步 |
| §10 文档 | Task 7 |

无缺口。

**类型一致性**：`ProviderState`（Task 4）字段在 Task 5 组件中一致使用；`ProviderSelection`（Task 5 useLlm）与 `buildSelections` 返回值结构一致（`{ id, apiKey, models }`）；服务端 `mergePresetProviders` 返回 `{ provider, skipped }` 与 Task 3 路由解构一致；`isVisionModel(providerId, modelId)` 签名在 shared/后端/前端一致。

**占位符扫描**：无 TBD/TODO；每个改代码的步骤都给了完整代码。
