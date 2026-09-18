# LLM 中转站内展示并编辑 opencode 配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「LLM 中转站」面板展示本机 opencode 配置文件全文，并对 provider / 默认 model 做完整的增删改，保存到 `~/.config/opencode/opencode.json`（原 `.jsonc` 备份）。

**Architecture:** 新增纯函数后端模块 `server/llm-opencode-config.js` 负责读、校验、合并、备份、原子写；`server/llm-mount.js` 增两条免密钥库门禁的 `/api/llm-admin/opencode` 路由。前端新增纯辅助模块 `web/src/opencodeConfig.ts`（行式编辑模型 ↔ 配置对象互转）与组件 `web/src/components/OpencodeConfigCard.vue`，嵌入既有 `ProxyView.vue`。

**Tech Stack:** Node ESM (`node:test`)、Vue 3 `<script setup>` + TypeScript、vitest、既有 i18n 词条机制。

**规范提醒（本仓库强制）：**
- Windows + PowerShell 5.1，一律用 `npm.cmd`。
- 新代码用户可见文案禁止中文，全部走 `$t` / `t()`；提交前跑 `npm.cmd run check:i18n`。
- 每次只 `git add` 本任务涉及文件，禁止 `git add -A`。
- 提交信息用 Conventional Commits + 中文描述。

---

### Task 1: 后端纯模块 `llm-opencode-config.js`

**Files:**
- Modify: `server/llm-config.js:9`（导出 `stripJsonc`）
- Create: `server/llm-opencode-config.js`
- Test: `server/test/llm-opencode-config.test.js`

- [ ] **Step 1: 导出 `stripJsonc`**

把 `server/llm-config.js` 第 9 行：

```js
function stripJsonc(text) {
```

改为：

```js
export function stripJsonc(text) {
```

- [ ] **Step 2: 写失败测试**

创建 `server/test/llm-opencode-config.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readActiveConfig, validateManaged, normalizeProviderKeys, mergeAndWrite } from '../llm-opencode-config.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfocc-')); }

test('readActiveConfig 读 opencode.json，缺文件返回空配置', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ model: 'a/m', provider: { a: { options: { baseURL: 'https://a/v1', apiKey: 'K' } } } }));
  const r = readActiveConfig({ dir });
  assert.equal(r.format, 'json');
  assert.equal(r.exists, true);
  assert.equal(r.config.model, 'a/m');
  assert.equal(r.config.provider.a.options.apiKey, 'K');
  assert.match(r.path, /opencode\.json$/);

  const empty = readActiveConfig({ dir: tmpDir() });
  assert.equal(empty.exists, false);
  assert.equal(empty.format, null);
  assert.deepEqual(empty.config, {});
});

test('readActiveConfig 读 .jsonc 去注释，坏文件 config=null', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opencode.jsonc'), '{ // note\n "provider": { "a": {} } }');
  const r = readActiveConfig({ dir });
  assert.equal(r.format, 'jsonc');
  assert.deepEqual(Object.keys(r.config.provider), ['a']);

  const bad = tmpDir();
  fs.writeFileSync(path.join(bad, 'opencode.json'), '{ not json');
  assert.equal(readActiveConfig({ dir: bad }).config, null);
});

test('normalizeProviderKeys：0 删、1 apiKey、N apiKeys 去重', () => {
  assert.deepEqual(normalizeProviderKeys({ options: { baseURL: 'x', apiKey: '' } }).options, { baseURL: 'x' });
  assert.deepEqual(normalizeProviderKeys({ options: { baseURL: 'x', apiKey: 'K' } }).options, { baseURL: 'x', apiKey: 'K' });
  assert.deepEqual(normalizeProviderKeys({ options: { apiKeys: ['A', 'B', 'A'] } }).options, { apiKeys: ['A', 'B'] });
  assert.equal(normalizeProviderKeys({}).options, undefined);
});

test('validateManaged 拒绝非法结构（bad-config）', () => {
  assert.throws(() => validateManaged({ provider: 'x', model: '' }), (e) => e.code === 'bad-config');
  assert.throws(() => validateManaged({ provider: { a: { models: { m: 1 } } }, model: '' }), (e) => e.code === 'bad-config');
  assert.throws(() => validateManaged({ provider: { a: { options: { apiKeys: 'K' } } }, model: '' }), (e) => e.code === 'bad-config');
  assert.throws(() => validateManaged({ provider: {}, model: 5 }), (e) => e.code === 'bad-config');
  assert.doesNotThrow(() => validateManaged({ provider: { a: { options: { baseURL: 'x', apiKeys: ['K'] }, models: { m: {} } } }, model: 'a/m' }));
});

test('mergeAndWrite 只替换 provider/model，保留其余顶层键并补 $schema', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ agent: { a: {} }, provider: { old: {} }, model: 'old/m', $schema: 'X' }));
  const r = mergeAndWrite({ dir, provider: { a: { options: { baseURL: 'https://a/v1', apiKey: 'K' }, models: { m1: {} } } }, model: 'a/m1', now: new Date('2026-09-18T10:20:30') });
  const saved = JSON.parse(fs.readFileSync(r.path, 'utf8'));
  assert.deepEqual(saved.agent, { a: {} });
  assert.equal(saved.$schema, 'X');
  assert.deepEqual(Object.keys(saved.provider), ['a']);
  assert.equal(saved.model, 'a/m1');
  assert.deepEqual(r.backups.map((b) => path.basename(b)), ['opencode.20260918-102030.bak']);
  assert.equal(fs.existsSync(path.join(dir, 'opencode.json.tmp')), false);
});

test('mergeAndWrite 转换 .jsonc：改名备份后写 opencode.json', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opencode.jsonc'), '{ "provider": { "a": {} } }');
  mergeAndWrite({ dir, provider: {}, model: '', now: new Date('2026-09-18T10:20:30') });
  assert.equal(fs.existsSync(path.join(dir, 'opencode.jsonc')), false);
  assert.equal(fs.existsSync(path.join(dir, 'opencode.jsonc.20260918-102030.bak')), true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'));
  assert.equal(saved.$schema, 'https://opencode.ai/config.json');
  assert.equal('model' in saved, false);
  assert.deepEqual(saved.provider, {});
});

test('mergeAndWrite 坏文件拒绝（bad-existing）', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{ broken');
  assert.throws(() => mergeAndWrite({ dir, provider: {}, model: '' }), (e) => e.code === 'bad-existing');
});

test('mergeAndWrite 无文件时新建', () => {
  const dir = tmpDir();
  const r = mergeAndWrite({ dir, provider: { a: { models: { m: {} } } }, model: 'a/m' });
  assert.equal(fs.existsSync(r.path), true);
  assert.deepEqual(r.backups, []);
  assert.equal(JSON.parse(fs.readFileSync(r.path, 'utf8')).model, 'a/m');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test server/test/llm-opencode-config.test.js`
Expected: FAIL，报 `Cannot find module '../llm-opencode-config.js'`。

- [ ] **Step 4: 写实现**

创建 `server/llm-opencode-config.js`：

```js
import fs from 'node:fs';
import path from 'node:path';
import { opencodeConfigDir, stripJsonc } from './llm-config.js';

const DEFAULT_SCHEMA = 'https://opencode.ai/config.json';

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readFile(dir) {
  for (const name of ['opencode.json', 'opencode.jsonc']) {
    const file = path.join(dir, name);
    try { return { file, name, raw: fs.readFileSync(file, 'utf8') }; } catch { /* next */ }
  }
  return null;
}

export function readActiveConfig({ dir = opencodeConfigDir() } = {}) {
  const hit = readFile(dir);
  if (!hit) return { path: path.join(dir, 'opencode.json'), format: null, exists: false, raw: '', config: {} };
  const format = hit.name.endsWith('.jsonc') ? 'jsonc' : 'json';
  let config = null;
  try {
    config = JSON.parse(hit.raw);
  } catch {
    if (format === 'jsonc') {
      try { config = JSON.parse(stripJsonc(hit.raw)); } catch { config = null; }
    }
  }
  return { path: hit.file, format, exists: true, raw: hit.raw, config };
}

export function validateManaged({ provider, model } = {}) {
  if (model !== undefined && typeof model !== 'string') fail('bad-config', 'model must be a string');
  if (provider === undefined) return;
  if (!isPlainObject(provider)) fail('bad-config', 'provider must be an object');
  for (const [id, p] of Object.entries(provider)) {
    if (!isPlainObject(p)) fail('bad-config', `provider.${id} must be an object`);
    if (p.options !== undefined) {
      if (!isPlainObject(p.options)) fail('bad-config', `provider.${id}.options must be an object`);
      const o = p.options;
      if (o.baseURL !== undefined && typeof o.baseURL !== 'string') fail('bad-config', `provider.${id}.options.baseURL must be a string`);
      if (o.apiKey !== undefined && typeof o.apiKey !== 'string') fail('bad-config', `provider.${id}.options.apiKey must be a string`);
      if (o.apiKeys !== undefined && (!Array.isArray(o.apiKeys) || o.apiKeys.some((k) => typeof k !== 'string'))) {
        fail('bad-config', `provider.${id}.options.apiKeys must be a string array`);
      }
    }
    if (p.models !== undefined) {
      if (!isPlainObject(p.models)) fail('bad-config', `provider.${id}.models must be an object`);
      for (const [mid, m] of Object.entries(p.models)) {
        if (!isPlainObject(m)) fail('bad-config', `provider.${id}.models.${mid} must be an object`);
      }
    }
  }
}

export function normalizeProviderKeys(provider) {
  const out = { ...provider };
  const o = { ...(out.options || {}) };
  const hadKeys = o.apiKey !== undefined || o.apiKeys !== undefined;
  const raw = Array.isArray(o.apiKeys) ? o.apiKeys : (typeof o.apiKey === 'string' ? [o.apiKey] : []);
  const keys = [];
  for (const k of raw) if (typeof k === 'string' && k && !keys.includes(k)) keys.push(k);
  delete o.apiKey;
  delete o.apiKeys;
  if (keys.length === 1) o.apiKey = keys[0];
  else if (keys.length > 1) o.apiKeys = keys;
  if (out.options !== undefined || hadKeys) {
    if (Object.keys(o).length) out.options = o; else delete out.options;
  }
  return out;
}

function stamp(now) {
  const d = now instanceof Date ? now : new Date(now);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

export function mergeAndWrite({ dir = opencodeConfigDir(), provider, model, now = new Date() } = {}) {
  if (provider === undefined || model === undefined) fail('bad-config', 'provider and model are required');
  validateManaged({ provider, model });
  const current = readActiveConfig({ dir });
  if (current.exists && current.config === null) fail('bad-existing', 'existing config is not valid JSON');
  fs.mkdirSync(dir, { recursive: true });

  const s = stamp(now);
  const backups = [];
  const jsonc = path.join(dir, 'opencode.jsonc');
  if (fs.existsSync(jsonc)) {
    const bak = path.join(dir, `opencode.jsonc.${s}.bak`);
    fs.renameSync(jsonc, bak);
    backups.push(bak);
  }
  const target = path.join(dir, 'opencode.json');
  if (fs.existsSync(target)) {
    const bak = path.join(dir, `opencode.${s}.bak`);
    fs.copyFileSync(target, bak);
    backups.push(bak);
  }

  const config = { ...(current.config || {}) };
  if (!config.$schema) config.$schema = DEFAULT_SCHEMA;
  config.provider = {};
  for (const [id, p] of Object.entries(provider)) config.provider[id] = normalizeProviderKeys(p);
  if (model) config.model = model; else delete config.model;

  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, target);
  } catch {
    try { fs.rmSync(target, { force: true }); } catch { /* ignore */ }
    fs.renameSync(tmp, target);
  }
  return { path: target, backups, config };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test server/test/llm-opencode-config.test.js`
Expected: PASS（8 tests）。

- [ ] **Step 6: 提交**

```bash
git add server/llm-config.js server/llm-opencode-config.js server/test/llm-opencode-config.test.js
git commit -m "feat(server): opencode 配置读写合并与备份模块"
```

---

### Task 2: `/api/llm-admin/opencode` HTTP 路由

**Files:**
- Modify: `server/llm-mount.js:6`（import）、`server/llm-mount.js:103`（签名）、`server/llm-mount.js:151`（插路由）、`server/llm-mount.js:255`（错误映射）
- Test: `server/test/llm-mount.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/llm-mount.test.js` 末尾追加：

```js
test('opencode 配置 GET/POST：无需解锁，写盘且保留其余顶层键', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    agent: { a: {} },
    provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { m1: {} } } },
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
  const gj = JSON.parse(g.body);
  assert.equal(gj.config.provider.corp.options.apiKey, 'K');
  assert.match(gj.raw, /corp/);

  const r = await jpost(server, '/api/llm-admin/opencode', {
    provider: { glm: { options: { baseURL: 'https://glm/v1', apiKey: 'G' }, models: { g1: {} } } },
    model: 'glm/g1',
  });
  assert.equal(r.status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(oc, 'opencode.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.provider), ['glm']);
  assert.equal(saved.model, 'glm/g1');
  assert.deepEqual(saved.agent, { a: {} });
});

test('opencode 配置 POST 非法体 400、坏文件 400', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), '{ broken');
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, opencodeDir: oc });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  assert.equal((await jpost(server, '/api/llm-admin/opencode', { provider: 'x', model: '' })).status, 400);
  assert.equal((await jpost(server, '/api/llm-admin/opencode', { provider: {}, model: '' })).status, 400);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/llm-mount.test.js`
Expected: 新增两条 FAIL（GET 返回 404 / POST 404）。

- [ ] **Step 3: 改 import 与签名**

`server/llm-mount.js` 第 6 行：

```js
import { listProviders, getProvider, buildOpencodeConfigMulti } from './llm-config.js';
```

改为：

```js
import { listProviders, getProvider, buildOpencodeConfigMulti, opencodeConfigDir } from './llm-config.js';
import { readActiveConfig, mergeAndWrite } from './llm-opencode-config.js';
```

第 103 行函数签名：

```js
export function createLlmMount({ vault, host, port, logger = console, pluginsDir = null, relayTestsDir = null, cache = createCache(), reveal = revealInOs } = {}) {
```

改为：

```js
export function createLlmMount({ vault, host, port, logger = console, pluginsDir = null, relayTestsDir = null, opencodeDir = opencodeConfigDir(), cache = createCache(), reveal = revealInOs } = {}) {
```

- [ ] **Step 4: 插入路由（在 `locked()` 之前）**

在 `server/llm-mount.js` 第 151 行后（`vault reset` 那行之后、`if (locked())` 之前）插入：

```js
      if (seg[0] === 'opencode' && !seg[1] && method === 'GET') {
        return sendJson(res, 200, readActiveConfig({ dir: opencodeDir }));
      }
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

- [ ] **Step 5: 错误映射**

在 `server/llm-mount.js` catch 块（约 255 行）中，`if (e.code === 'not-init') ...` 之后追加：

```js
      if (e.code === 'bad-config') return sendJson(res, 400, { error: 'bad-config' });
      if (e.code === 'bad-existing') return sendJson(res, 400, { error: 'bad-existing' });
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test server/test/llm-mount.test.js`
Expected: PASS（全部，含原有用例）。

- [ ] **Step 7: 提交**

```bash
git add server/llm-mount.js server/test/llm-mount.test.js
git commit -m "feat(server): 中转站 opencode 配置读写接口"
```

---

### Task 3: 前端纯辅助模块 `opencodeConfig.ts`

**Files:**
- Create: `web/src/opencodeConfig.ts`
- Test: `web/src/opencodeConfig.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/opencodeConfig.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  apiKeysOf, optionsExtra, modelExtra, parseJsonObject, composeOptions, composeModel,
  rowsFromProvider, providerFromRows, collectModelOptions,
} from './opencodeConfig';

describe('opencodeConfig helpers', () => {
  it('apiKeysOf 兼容 apiKey/apiKeys 并去重去空', () => {
    expect(apiKeysOf({ apiKey: 'K' })).toEqual(['K']);
    expect(apiKeysOf({ apiKeys: ['A', 'B', 'A', ''] })).toEqual(['A', 'B']);
    expect(apiKeysOf(undefined)).toEqual([]);
  });

  it('optionsExtra/modelExtra 去掉受管字段', () => {
    expect(optionsExtra({ baseURL: 'x', apiKey: 'k', headers: { h: '1' } })).toEqual({ headers: { h: '1' } });
    expect(modelExtra({ name: 'N', attachment: true })).toEqual({ attachment: true });
  });

  it('parseJsonObject 只接受对象', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonObject('[1]').ok).toBe(false);
    expect(parseJsonObject('nope').ok).toBe(false);
  });

  it('composeOptions 0/1/N key 形状', () => {
    expect(composeOptions('https://a/v1', [], { headers: { h: '1' } })).toEqual({ headers: { h: '1' }, baseURL: 'https://a/v1' });
    expect(composeOptions('https://a/v1', ['K'])).toEqual({ baseURL: 'https://a/v1', apiKey: 'K' });
    expect(composeOptions('https://a/v1', ['K', 'K2'])).toEqual({ baseURL: 'https://a/v1', apiKeys: ['K', 'K2'] });
  });

  it('composeModel 保留其余字段', () => {
    expect(composeModel('N', { attachment: true })).toEqual({ attachment: true, name: 'N' });
  });

  it('rowsFromProvider/providerFromRows 往返保留未知字段与 key 形状', () => {
    const src = {
      corp: {
        name: 'Corp', extra: 1,
        options: { baseURL: 'https://a/v1', apiKeys: ['A', 'B'], headers: { h: '1' } },
        models: { m1: { name: 'M1', attachment: true } },
      },
    };
    const rows = rowsFromProvider(src);
    expect(rows[0].keys).toEqual(['A', 'B']);
    expect(rows[0].extraOptions).toContain('headers');
    expect(rows[0].models[0].extra).toContain('attachment');

    const back = providerFromRows(rows);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value.corp.extra).toBe(1);
      expect((back.value.corp.options as any).apiKeys).toEqual(['A', 'B']);
      expect((back.value.corp.models as any).m1.attachment).toBe(true);
      expect((back.value.corp.models as any).m1.name).toBe('M1');
    }
  });

  it('providerFromRows 拒绝空/重复 ID 与坏 JSON', () => {
    const base = { id: 'a', name: '', baseURL: '', keys: [] as string[], extraOptions: '{}', models: [], rest: {} };
    expect(providerFromRows([{ ...base, id: '' }]).ok).toBe(false);
    expect(providerFromRows([base, { ...base }]).ok).toBe(false);
    expect(providerFromRows([{ ...base, extraOptions: 'nope' }]).ok).toBe(false);
  });

  it('collectModelOptions 排序拼接', () => {
    const rows = rowsFromProvider({ b: { models: { m2: {} } }, a: { models: { m1: {} } } });
    expect(collectModelOptions(rows)).toEqual(['a/m1', 'b/m2']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web exec vitest run src/opencodeConfig.test.ts`
Expected: FAIL，报找不到模块 `./opencodeConfig`。

- [ ] **Step 3: 写实现**

创建 `web/src/opencodeConfig.ts`：

```ts
export type JsonObject = Record<string, unknown>;
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

export interface ModelRow { id: string; name: string; extra: string }
export interface ProviderRow {
  id: string;
  name: string;
  baseURL: string;
  keys: string[];
  extraOptions: string;
  models: ModelRow[];
  rest: OpencodeProvider;
}

export function apiKeysOf(options: OpencodeProviderOptions | undefined): string[] {
  const o = options || {};
  const raw = Array.isArray(o.apiKeys) ? o.apiKeys : (typeof o.apiKey === 'string' && o.apiKey ? [o.apiKey] : []);
  const out: string[] = [];
  for (const k of raw) if (typeof k === 'string' && k && !out.includes(k)) out.push(k);
  return out;
}

export function optionsExtra(options: OpencodeProviderOptions | undefined): JsonObject {
  const o: JsonObject = { ...(options || {}) };
  delete o.baseURL;
  delete o.apiKey;
  delete o.apiKeys;
  return o;
}

export function modelExtra(model: OpencodeModel | undefined): JsonObject {
  const m: JsonObject = { ...(model || {}) };
  delete m.name;
  return m;
}

export function parseJsonObject(text: string): { ok: true; value: JsonObject } | { ok: false; error: string } {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'not-object' };
    return { ok: true, value: v as JsonObject };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function composeOptions(baseURL: string, keys: string[], extra: JsonObject = {}): OpencodeProviderOptions {
  const o: OpencodeProviderOptions = { ...extra };
  delete o.baseURL;
  delete o.apiKey;
  delete o.apiKeys;
  if (baseURL) o.baseURL = baseURL;
  const clean = keys.filter((k) => k);
  if (clean.length === 1) o.apiKey = clean[0];
  else if (clean.length > 1) o.apiKeys = clean;
  return o;
}

export function composeModel(name: string, extra: JsonObject = {}): OpencodeModel {
  const m: OpencodeModel = { ...extra };
  if (name) m.name = name; else delete m.name;
  return m;
}

export function rowsFromProvider(provider: Record<string, OpencodeProvider> | undefined): ProviderRow[] {
  return Object.entries(provider || {}).map(([id, p]) => ({
    id,
    name: typeof p.name === 'string' ? p.name : '',
    baseURL: typeof p.options?.baseURL === 'string' ? p.options.baseURL : '',
    keys: apiKeysOf(p.options),
    extraOptions: JSON.stringify(optionsExtra(p.options), null, 2),
    models: Object.entries(p.models || {}).map(([mid, m]) => ({
      id: mid,
      name: typeof m.name === 'string' ? m.name : '',
      extra: JSON.stringify(modelExtra(m), null, 2),
    })),
    rest: p,
  }));
}

export function providerFromRows(rows: ProviderRow[]):
  { ok: true; value: Record<string, OpencodeProvider> } | { ok: false; error: string } {
  const out: Record<string, OpencodeProvider> = {};
  for (const r of rows) {
    const id = r.id.trim();
    if (!id) return { ok: false, error: 'need-id' };
    if (out[id]) return { ok: false, error: 'dup-id' };
    const ex = parseJsonObject(r.extraOptions);
    if (!ex.ok) return { ok: false, error: `options:${ex.error}` };
    const models: Record<string, OpencodeModel> = {};
    for (const m of r.models) {
      const mid = m.id.trim();
      if (!mid) return { ok: false, error: 'need-id' };
      if (models[mid]) return { ok: false, error: 'dup-id' };
      const me = parseJsonObject(m.extra);
      if (!me.ok) return { ok: false, error: `model:${mid}:${me.error}` };
      models[mid] = composeModel(m.name, me.value);
    }
    const p: OpencodeProvider = { ...r.rest };
    if (r.name) p.name = r.name; else delete p.name;
    p.options = composeOptions(r.baseURL, r.keys, ex.value);
    p.models = models;
    out[id] = p;
  }
  return { ok: true, value: out };
}

export function collectModelOptions(providers: ProviderRow[]): string[] {
  const out: string[] = [];
  for (const p of providers) {
    const pid = p.id.trim();
    if (!pid) continue;
    for (const m of p.models) {
      const mid = m.id.trim();
      if (mid) out.push(`${pid}/${mid}`);
    }
  }
  return out.sort();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web exec vitest run src/opencodeConfig.test.ts`
Expected: PASS（8 tests）。

- [ ] **Step 5: 提交**

```bash
git add web/src/opencodeConfig.ts web/src/opencodeConfig.test.ts
git commit -m "feat(web): opencode 配置行式编辑辅助与测试"
```

---

### Task 4: `useLlm` 增 API 方法

**Files:**
- Modify: `web/src/useLlm.ts:1`、末尾 return 对象
- Test: `web/src/useLlm.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/useLlm.test.ts` 的 `describe('useLlm', ...)` 内、最后一个 `it` 之后追加：

```ts
  it('opencodeConfig 走 GET，saveOpencodeConfig 走 POST', async () => {
    const calls = stub(() => ({ body: { ok: true, config: { provider: {} } } }));
    await llm.opencodeConfig();
    expect(calls[0].url).toBe('/api/llm-admin/opencode');
    expect(calls[0].init?.method || 'GET').toBe('GET');
    await llm.saveOpencodeConfig({ provider: { a: {} }, model: 'a/m' });
    expect(calls[1].url).toBe('/api/llm-admin/opencode');
    expect(calls[1].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ provider: { a: {} }, model: 'a/m' });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web exec vitest run src/useLlm.test.ts`
Expected: FAIL，`llm.opencodeConfig is not a function`。

- [ ] **Step 3: 实现**

`web/src/useLlm.ts` 第 1 行前插入：

```ts
import type { OpencodeConfigFile, OpencodeProvider } from './opencodeConfig';
```

在 `return {` 对象内、`config:` 方法之后追加：

```ts
    opencodeConfig: () => json<OpencodeConfigFile>('/api/llm-admin/opencode'),
    saveOpencodeConfig: (payload: { provider: Record<string, OpencodeProvider>; model: string }) =>
      post<{ ok: boolean; path: string; backups: string[]; config: unknown }>('/api/llm-admin/opencode', payload),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web exec vitest run src/useLlm.test.ts`
Expected: PASS（全部）。

- [ ] **Step 5: 提交**

```bash
git add web/src/useLlm.ts web/src/useLlm.test.ts
git commit -m "feat(web): useLlm 增 opencode 配置读写方法"
```

---

### Task 5: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:960`
- Modify: `shared/i18n/en.js:953`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 的 `'llm.provider.nobase': '未设置 baseURL',` 之后插入：

```js
  'llm.oc.title': 'opencode 配置',
  'llm.oc.reload': '重新读取',
  'llm.oc.save': '保存',
  'llm.oc.saved': '已保存',
  'llm.oc.file': '文件：{path}',
  'llm.oc.raw': '原始 JSON',
  'llm.oc.jsonc_hint': '当前是 .jsonc；保存会写入 opencode.json，原 .jsonc 备份为 .bak。',
  'llm.oc.missing': '未找到 opencode.json，保存时会新建。',
  'llm.oc.invalid': '现有文件不是合法 JSON，无法编辑保存。',
  'llm.oc.default_model': '默认模型',
  'llm.oc.model_none': '（不设置）',
  'llm.oc.model_manual': '手填 provider/model',
  'llm.oc.providers': 'Provider 列表',
  'llm.oc.add_provider': '新增 provider',
  'llm.oc.provider_id': 'provider ID',
  'llm.oc.name': '名称',
  'llm.oc.baseurl': 'baseURL',
  'llm.oc.keys_hint': '每行一个 API key；留空则不写 apiKey。',
  'llm.oc.key': 'API key',
  'llm.oc.add_key': '加 key',
  'llm.oc.advanced_options': '高级：options 其余字段（JSON）',
  'llm.oc.models': '模型',
  'llm.oc.add_model': '新增模型',
  'llm.oc.model_id': '模型 ID',
  'llm.oc.advanced': '高级：模型其余字段（JSON）',
  'llm.oc.remove': '删除',
  'llm.oc.confirm_remove_provider': '确定删除该 provider？',
  'llm.oc.confirm_remove_model': '确定删除该模型？',
  'llm.oc.bad_json': '高级 JSON 必须是合法对象。',
  'llm.oc.need_id': 'provider/模型 ID 不能为空或重复。',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 的 `'llm.provider.nobase': 'No baseURL',` 之后插入：

```js
  'llm.oc.title': 'opencode config',
  'llm.oc.reload': 'Reload',
  'llm.oc.save': 'Save',
  'llm.oc.saved': 'Saved',
  'llm.oc.file': 'File: {path}',
  'llm.oc.raw': 'Raw JSON',
  'llm.oc.jsonc_hint': 'Currently .jsonc; saving writes opencode.json and backs the original up as .bak.',
  'llm.oc.missing': 'opencode.json not found; it will be created on save.',
  'llm.oc.invalid': 'The existing file is not valid JSON; editing is disabled.',
  'llm.oc.default_model': 'Default model',
  'llm.oc.model_none': '(none)',
  'llm.oc.model_manual': 'Custom provider/model',
  'llm.oc.providers': 'Providers',
  'llm.oc.add_provider': 'Add provider',
  'llm.oc.provider_id': 'provider ID',
  'llm.oc.name': 'Name',
  'llm.oc.baseurl': 'baseURL',
  'llm.oc.keys_hint': 'One API key per line; empty removes apiKey.',
  'llm.oc.key': 'API key',
  'llm.oc.add_key': 'Add key',
  'llm.oc.advanced_options': 'Advanced: other options (JSON)',
  'llm.oc.models': 'Models',
  'llm.oc.add_model': 'Add model',
  'llm.oc.model_id': 'Model ID',
  'llm.oc.advanced': 'Advanced: other model fields (JSON)',
  'llm.oc.remove': 'Remove',
  'llm.oc.confirm_remove_provider': 'Remove this provider?',
  'llm.oc.confirm_remove_model': 'Remove this model?',
  'llm.oc.bad_json': 'Advanced JSON must be a valid object.',
  'llm.oc.need_id': 'Provider/model IDs must be non-empty and unique.',
```

- [ ] **Step 3: 校验词条对称与零中文命中**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): opencode 配置面板词条"
```

---

### Task 6: 组件 `OpencodeConfigCard.vue` 与嵌入 ProxyView

**Files:**
- Create: `web/src/components/OpencodeConfigCard.vue`
- Modify: `web/src/components/ProxyView.vue:3`、`:303` 之后

- [ ] **Step 1: 创建组件**

创建 `web/src/components/OpencodeConfigCard.vue`：

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useLlm } from '../useLlm';
import { type OpencodeConfigFile, type ProviderRow, rowsFromProvider, providerFromRows, collectModelOptions } from '../opencodeConfig';
import { t } from '../i18n';

const emit = defineEmits<{ (e: 'saved'): void }>();
const api = useLlm();
const file = ref<OpencodeConfigFile | null>(null);
const providers = ref<ProviderRow[]>([]);
const model = ref('');
const baseline = ref('');
const err = ref('');
const saved = ref(false);

const invalid = computed(() => !!file.value && file.value.exists && file.value.config === null);
const modelOptions = computed(() => collectModelOptions(providers.value));
const dirty = computed(() => JSON.stringify({ providers: providers.value, model: model.value }) !== baseline.value);

function applyFile(f: OpencodeConfigFile) {
  file.value = f;
  providers.value = f.config && f.config.provider ? rowsFromProvider(f.config.provider) : [];
  model.value = f.config && typeof f.config.model === 'string' ? f.config.model : '';
  baseline.value = JSON.stringify({ providers: providers.value, model: model.value });
}
async function load() {
  err.value = '';
  saved.value = false;
  try { applyFile(await api.opencodeConfig()); } catch (e: any) { err.value = e?.message || String(e); }
}
onMounted(load);

function addProvider() {
  const ids = new Set(providers.value.map((p) => p.id));
  let id = 'new-provider';
  let i = 2;
  while (ids.has(id)) { id = `new-provider-${i}`; i += 1; }
  providers.value.push({ id, name: '', baseURL: '', keys: [], extraOptions: '{}', models: [], rest: {} });
}
function removeProvider(index: number) {
  if (window.confirm(t('llm.oc.confirm_remove_provider'))) providers.value.splice(index, 1);
}
function addModel(p: ProviderRow) {
  const ids = new Set(p.models.map((m) => m.id));
  let id = 'new-model';
  let i = 2;
  while (ids.has(id)) { id = `new-model-${i}`; i += 1; }
  p.models.push({ id, name: '', extra: '{}' });
}
function removeModel(p: ProviderRow, index: number) {
  if (window.confirm(t('llm.oc.confirm_remove_model'))) p.models.splice(index, 1);
}
async function save() {
  err.value = '';
  const built = providerFromRows(providers.value);
  if (!built.ok) {
    err.value = built.error === 'need-id' || built.error === 'dup-id' ? t('llm.oc.need_id') : t('llm.oc.bad_json');
    return;
  }
  try {
    await api.saveOpencodeConfig({ provider: built.value, model: model.value.trim() });
    await load();
    saved.value = true;
    emit('saved');
  } catch (e: any) { err.value = e?.message || String(e); }
}
</script>

<template>
  <section class="card">
    <div class="ch">{{ $t('llm.oc.title') }}
      <span class="row">
        <button class="ghost" @click="load">{{ $t('llm.oc.reload') }}</button>
        <button :disabled="!dirty || invalid" @click="save">{{ saved ? $t('llm.oc.saved') : $t('llm.oc.save') }}</button>
      </span>
    </div>
    <div class="muted">{{ $t('llm.oc.file', { path: file?.path || '' }) }}</div>
    <div v-if="invalid" class="warn">{{ $t('llm.oc.invalid') }}</div>
    <div v-else-if="file && !file.exists" class="muted">{{ $t('llm.oc.missing') }}</div>
    <div v-if="file?.format === 'jsonc'" class="muted">{{ $t('llm.oc.jsonc_hint') }}</div>
    <div v-if="err" class="err">{{ err }}</div>

    <div class="row">
      <span class="muted">{{ $t('llm.oc.default_model') }}</span>
      <select v-model="model">
        <option value="">{{ $t('llm.oc.model_none') }}</option>
        <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
      </select>
      <input v-model="model" :placeholder="$t('llm.oc.model_manual')" />
    </div>

    <div class="ch">{{ $t('llm.oc.providers') }}
      <button class="ghost" @click="addProvider">{{ $t('llm.oc.add_provider') }}</button>
    </div>

    <div v-for="(p, pi) in providers" :key="pi" class="prov">
      <div class="row">
        <input v-model="p.id" :placeholder="$t('llm.oc.provider_id')" />
        <input v-model="p.name" :placeholder="$t('llm.oc.name')" />
        <button class="danger" @click="removeProvider(pi)">{{ $t('llm.oc.remove') }}</button>
      </div>
      <div class="row">
        <input v-model="p.baseURL" :placeholder="$t('llm.oc.baseurl')" />
      </div>
      <div class="muted">{{ $t('llm.oc.keys_hint') }}</div>
      <div v-for="(k, ki) in p.keys" :key="ki" class="row">
        <input v-model="p.keys[ki]" :placeholder="$t('llm.oc.key')" />
        <button class="ghost" @click="p.keys.splice(ki, 1)">×</button>
      </div>
      <button class="ghost" @click="p.keys.push('')">{{ $t('llm.oc.add_key') }}</button>
      <details class="ex">
        <summary>{{ $t('llm.oc.advanced_options') }}</summary>
        <textarea v-model="p.extraOptions" class="cfg" rows="4"></textarea>
      </details>

      <div class="ch">{{ $t('llm.oc.models') }}
        <button class="ghost" @click="addModel(p)">{{ $t('llm.oc.add_model') }}</button>
      </div>
      <div v-for="(m, mi) in p.models" :key="mi" class="model">
        <div class="row">
          <input v-model="m.id" :placeholder="$t('llm.oc.model_id')" />
          <input v-model="m.name" :placeholder="$t('llm.oc.name')" />
          <button class="danger" @click="removeModel(p, mi)">{{ $t('llm.oc.remove') }}</button>
        </div>
        <details class="ex">
          <summary>{{ $t('llm.oc.advanced') }}</summary>
          <textarea v-model="m.extra" class="cfg" rows="4"></textarea>
        </details>
      </div>
    </div>

    <details class="ex">
      <summary>{{ $t('llm.oc.raw') }}</summary>
      <pre class="cfg">{{ file?.raw }}</pre>
    </details>
  </section>
</template>

<style scoped>
.card { border: 1px solid var(--bd); border-radius: 8px; padding: 10px; background: var(--bg2); display: flex; flex-direction: column; gap: 8px; }
.ch { display: flex; align-items: center; justify-content: space-between; font-weight: 700; color: var(--tx1); }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.row input, .row select { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 12px; }
button { background: var(--ac); color: var(--onac); border: 1px solid var(--ac); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-family: inherit; }
button.ghost { background: var(--bg5); color: var(--tx2); border-color: var(--bd); }
button.danger { background: none; border-color: var(--err); color: var(--err); }
button:disabled { opacity: .5; cursor: default; }
.muted { color: var(--tx4); font-size: 12px; }
.warn { color: var(--warn); font-size: 12px; }
.err { color: var(--err); font-size: 12px; }
.prov { border: 1px solid var(--bd); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.model { border-top: 1px solid var(--bd); padding-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.cfg { background: var(--bg1); border: 1px solid var(--bd); border-radius: 4px; padding: 8px; font-size: 12px; overflow: auto; max-height: 240px; white-space: pre-wrap; width: 100%; box-sizing: border-box; font-family: inherit; }
.ex summary { cursor: pointer; color: var(--tx2); font-size: 12px; }
.ex .cfg { margin-top: 6px; }
</style>
```

- [ ] **Step 2: 嵌入 ProxyView**

`web/src/components/ProxyView.vue` 第 3 行后（`import ChangePassphraseDialog ...` 之后）加入：

```ts
import OpencodeConfigCard from './OpencodeConfigCard.vue';
```

在 template 中 provider 卡片结束的 `</section>`（第 303 行）之后、`<section v-if="st?.vault.unlocked" class="card">`（第 305 行）之前插入：

```html
    <OpencodeConfigCard @saved="refresh" />
```

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误退出（exit 0）。

- [ ] **Step 4: 组件测试（可选但执行）**

Run: `npm.cmd --prefix web exec vitest run src/opencodeConfig.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/OpencodeConfigCard.vue web/src/components/ProxyView.vue
git commit -m "feat(web): 中转站 opencode 配置卡片"
```

---

### Task 7: 全量验证

**Files:**（无新文件）

- [ ] **Step 1: 服务端测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS。

- [ ] **Step 2: 前端测试**

Run: `npm.cmd run test:web`
Expected: 全部 PASS。

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: exit 0。

- [ ] **Step 4: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 5: 人工验收（dev）**

启动 `npm.cmd run dev:server` 与 `npm.cmd run dev:web`（后台、日志写 `logs\`），访问 `http://localhost:5173` → 「中转站」：
1. 面板显示 `opencode 配置` 卡片与当前文件路径、原始 JSON。
2. 改默认模型、改某 provider baseURL/apiKey、加/删模型 → 保存 → 确认 `~/.config/opencode/opencode.json` 更新且生成 `.bak`。
3. 保存后「上游 provider」卡片同步刷新。
4. 无 opencode.json 时保存能新建；`.jsonc` 保存后转为 `opencode.json` 且原文件成 `.bak`。

- [ ] **Step 6: 生成状态说明提交（如无需改动则跳过）**

若验证中发现文档需同步，更新 `README.md` 的 LLM 中转站小节后：

```bash
git add README.md
git commit -m "docs(readme): 中转站支持展示并编辑 opencode provider/model"
```

---

## 自查（Self-Review）

**Spec 覆盖：**

| Spec 章节 | 对应任务 |
|-----------|----------|
| §2 受管区块（model + provider 完整 CRUD、明文 key、模型完整字段） | Task 1（服务端校验/写盘）、Task 3（行式转换）、Task 6（UI） |
| §3.1 纯模块 readActiveConfig/validateManaged/normalizeProviderKeys/mergeAndWrite | Task 1 |
| §3.2 `/api/llm-admin/opencode` GET/POST、免密钥库门禁、400 错误 | Task 2 |
| §3.3 生效方式 | 复用既有 `listProviders` 重读；Task 7 验收 |
| §4.1 useLlm 方法 | Task 4 |
| §4.2 组件（始终显示、CRUD、默认模型、原始 JSON、保存后刷新） | Task 6 |
| §5 i18n | Task 5 |
| §6 测试 | Task 1/2/3/4 |
| §7 边界（缺文件/损坏/外部改动保留非受管键/key 形状） | Task 1/2/3 |
| §8 安全（明文仅授权页、不写入仓库） | Task 7 敏感扫描 + 提交规范 |

**占位符扫描：** 无 TBD/TODO；所有代码步骤含完整代码。

**类型一致性：** `OpencodeConfigFile` / `OpencodeProvider` / `ProviderRow` / `ModelRow` 在 Task 3 定义，Task 4/6 复用；`readActiveConfig`/`mergeAndWrite`/`normalizeProviderKeys` 在 Task 1 定义，Task 2 复用；`rowsFromProvider`/`providerFromRows`/`collectModelOptions` 在 Task 3 定义，Task 6 复用。函数名前后一致。
