# 协作资产本地导出 / 导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让协作页支持把勾选的 skills/command/agent/workflow 导出成本地 zip（含 `Manifest.json`），并支持选择该 zip 在协作页导入安装。

**Architecture:** 复用现有 bundle 打包/解包管线，新增一个纯函数 Manifest 层（`asset-manifest.js`）。`buildPackage` 生成的 zip 追加 `Manifest.json`；本地导入走新增的 `asset-import.js`（暂存 → 严格校验 Manifest → `installBundleZip`）。群分发链路保持不变。

**Tech Stack:** Node ESM、node:test、自研 `zip.js`、Vue3 + TS + vitest、`@devflow/shared` i18n。

**Spec:** `docs/superpowers/specs/2026-09-18-collab-asset-export-import-design.md`

---

## File Structure

- Create `server/collaboration/asset-manifest.js` — Manifest 生成/解析/摘要（纯函数）。
- Create `server/collaboration/asset-import.js` — 本地导入暂存/应用/丢弃/清理。
- Modify `server/collaboration/engine.js` — `buildPackage` 写入 Manifest；新增 `stageImport/applyImport/discardImport/cleanupStagedImports/importAssetDir`。
- Modify `server/collaboration/http-mount.js` — `POST /api/collab/import`、`POST /api/collab/import/:id/apply`、`DELETE /api/collab/import/:id`；排除 raw body 误读。
- Modify `server/index.js` — 启动清理暂存。
- Modify `web/src/collaboration/types.ts` — `AssetManifest` 类型。
- Modify `web/src/collaboration/useCollab.ts` — `importAsset/applyImport/discardImport`。
- Create `web/src/collaboration/AssetImportDialog.vue` — 选文件 + Manifest 预览 + 确认导入。
- Modify `web/src/collaboration/SkillDistributor.vue` — `groupId` 可选，本地导出模式。
- Modify `web/src/collaboration/CollaborationView.vue` — 顶栏导出/导入按钮 + 挂弹窗。
- Modify `shared/i18n/zh-CN.js`、`shared/i18n/en.js` — 新词条。
- Tests: `server/test/collab-asset-manifest.test.js`、`server/test/collab-asset-import.test.js`、`server/test/collab-import.test.js`、`server/test/collab-pack-detail.test.js`、`web/src/collaboration/AssetImportDialog.test.ts`、`web/src/collaboration/SkillDistributor.test.ts`。

---

### Task 1: Manifest 纯函数模块

**Files:**
- Create: `server/collaboration/asset-manifest.js`
- Test: `server/test/collab-asset-manifest.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/collab-asset-manifest.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip } from '../collaboration/zip.js';
import { buildManifest, parseManifest, deriveType, manifestSummary, ASSET_FORMAT } from '../collaboration/asset-manifest.js';

function zipWith(entries) { return buildZip(entries); }

test('buildManifest + parseManifest 往返，含类型与明细', () => {
  const manifest = buildManifest({
    selection: { skills: ['foo'], command: [], agent: [], workflow: ['w1'] },
    details: { skills: [{ name: 'foo', files: 2, hash: 'h1' }], workflow: [{ id: 'w1', label: 'W1', stages: 3 }] },
    source: { machineId: 'm1', host: '127.0.0.1', port: 22222, employeeId: 'e1' },
    now: 123,
  });
  assert.equal(manifest.format, ASSET_FORMAT);
  assert.equal(manifest.type, 'mixed');
  assert.deepEqual(manifest.kinds, ['skills', 'workflow']);
  assert.equal(manifest.exportedAt, 123);
  const zip = zipWith([
    { name: 'Manifest.json', data: JSON.stringify(manifest) },
    { name: 'skills/foo/SKILL.md', data: 'x' },
  ]);
  const parsed = parseManifest(zip);
  assert.equal(parsed.type, 'mixed');
  assert.equal(parsed.skills[0].name, 'foo');
  assert.equal(parsed.workflow[0].stages, 3);
});

test('deriveType：仅 skills → skills，仅 workflow → workflow，两者 → mixed', () => {
  assert.equal(deriveType({ skills: [{ name: 'a' }] }), 'skills');
  assert.equal(deriveType({ workflow: [{ id: 'w' }] }), 'workflow');
  assert.equal(deriveType({ command: [{ name: 'c' }], workflow: [{ id: 'w' }] }), 'mixed');
  assert.equal(deriveType({}), 'skills');
});

test('parseManifest 严格拒绝：缺 Manifest / 坏 JSON / format 不对 / 非法 zip', () => {
  assert.throws(() => parseManifest(zipWith([{ name: 'skills/a/SKILL.md', data: 'x' }])), (e) => e.code === 'manifest-missing');
  assert.throws(() => parseManifest(zipWith([{ name: 'Manifest.json', data: '{not json' }])), (e) => e.code === 'bad-manifest');
  assert.throws(() => parseManifest(zipWith([{ name: 'Manifest.json', data: JSON.stringify({ format: 'other', version: 1 }) }])), (e) => e.code === 'bad-format');
  assert.throws(() => parseManifest(Buffer.from('nope')), (e) => e.code === 'invalid-zip');
});

test('manifestSummary 计数', () => {
  const s = manifestSummary({ type: 'skills', skills: [{ name: 'a' }, { name: 'b' }], command: [{ name: 'c' }], workflow: [] });
  assert.equal(s.counts.skills, 2);
  assert.equal(s.counts.command, 1);
  assert.equal(s.type, 'skills');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/collab-asset-manifest.test.js`
Expected: FAIL — `Cannot find module '../collaboration/asset-manifest.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/collaboration/asset-manifest.js`:

```js
import { readZip } from './zip.js';

export const ASSET_FORMAT = 'devflow-assets';
export const ASSET_FORMAT_VERSION = 1;
export const MANIFEST_NAME = 'Manifest.json';

function manifestError(code, cause) {
  const e = new Error(code);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

// 由四类明细推导导出类型：仅有 skills/command/agent → skills；仅 workflow → workflow；两者都有 → mixed
export function deriveType(manifest) {
  const hasSkills = ['skills', 'command', 'agent'].some((k) => ((manifest && manifest[k]) || []).length > 0);
  const hasWorkflow = ((manifest && manifest.workflow) || []).length > 0;
  if (hasSkills && hasWorkflow) return 'mixed';
  if (hasWorkflow) return 'workflow';
  return 'skills';
}

// selection: { skills, command, agent, workflow }；details: { skills:[{name,files,hash}], command:[{name}], agent:[{name}], workflow:[{id,label,stages}] }
export function buildManifest({ selection = {}, details = {}, source = null, now = Date.now() } = {}) {
  const skills = (details.skills || []).map((s) => ({ name: s.name, files: s.files ?? 0, hash: s.hash ?? null }));
  const command = (details.command || (selection.command || []).map((name) => ({ name }))).map((c) => ({ name: c.name }));
  const agent = (details.agent || (selection.agent || []).map((name) => ({ name }))).map((a) => ({ name: a.name }));
  const workflow = (details.workflow || []).map((w) => ({ id: w.id, label: w.label, stages: w.stages ?? 0 }));
  const draft = { skills, command, agent, workflow };
  const manifest = {
    format: ASSET_FORMAT,
    version: ASSET_FORMAT_VERSION,
    exportedAt: now,
    source: source || null,
    kinds: ['skills', 'command', 'agent', 'workflow'].filter((k) => draft[k].length > 0),
    skills, command, agent, workflow,
  };
  manifest.type = deriveType(manifest);
  return manifest;
}

// 严格解析 zip 内的 Manifest.json；任何不合规都抛带 .code 的错误
export function parseManifest(zip) {
  let entries;
  try { entries = readZip(zip); } catch (e) { throw manifestError('invalid-zip', e); }
  const entry = entries.find((e) => e.name === MANIFEST_NAME);
  if (!entry) throw manifestError('manifest-missing');
  let manifest;
  try { manifest = JSON.parse(entry.data.toString('utf8')); } catch (e) { throw manifestError('bad-manifest', e); }
  if (!manifest || typeof manifest !== 'object') throw manifestError('bad-manifest');
  if (manifest.format !== ASSET_FORMAT || !Number.isFinite(Number(manifest.version))) throw manifestError('bad-format');
  return manifest;
}

export function manifestSummary(manifest) {
  const m = manifest || {};
  return {
    type: m.type || deriveType(m),
    kinds: m.kinds || [],
    exportedAt: m.exportedAt || 0,
    source: m.source || null,
    counts: {
      skills: (m.skills || []).length,
      command: (m.command || []).length,
      agent: (m.agent || []).length,
      workflow: (m.workflow || []).length,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/collab-asset-manifest.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/asset-manifest.js server/test/collab-asset-manifest.test.js
git commit -m "feat(collab): add asset manifest build/parse module"
```

---

### Task 2: buildPackage 的 zip 写入 Manifest.json

**Files:**
- Modify: `server/collaboration/engine.js` (imports near line 13; `buildPackage` push before `const zip = buildZip(...)` around line 215)
- Test: `server/test/collab-pack-detail.test.js`

- [ ] **Step 1: Write the failing test**

Append to `server/test/collab-pack-detail.test.js` (add `readZip` import at top):

```js
import { readZip } from '../collaboration/zip.js';
```

```js
test('buildPackage 的 zip 内含 Manifest.json（含类型与明细）', async () => {
  const dir = tmpDir('df-pack-manifest-');
  const skillsRoot = path.join(dir, 'skills');
  const demo = path.join(skillsRoot, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(path.join(demo, 'SKILL.md'), '# demo', 'utf8');
  const engine = new CollabEngine({
    store: new CollabStore({ file: path.join(dir, 'collab.json') }),
    identity: loadIdentity({ file: path.join(dir, 'identity.json'), username: 'u', host: '127.0.0.1', port: 0 }),
    skillsRoot,
    uploadDir: path.join(dir, 'upload'),
    downloadDir: path.join(dir, 'download'),
    downloadsDir: path.join(dir, 'downloads'),
  });
  const rec = await engine.buildPackage({ skills: ['demo'] });
  const zip = fs.readFileSync(path.join(engine.uploadDir, rec.storedFile));
  const entry = readZip(zip).find((e) => e.name === 'Manifest.json');
  assert.ok(entry, 'Manifest.json 存在');
  const manifest = JSON.parse(entry.data.toString('utf8'));
  assert.equal(manifest.type, 'skills');
  assert.equal(manifest.skills[0].name, 'demo');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/collab-pack-detail.test.js`
Expected: FAIL — `Manifest.json 存在` assertion fails

- [ ] **Step 3: Write minimal implementation**

In `server/collaboration/engine.js`, add the import next to the other local imports (after line 15 `import { installBundleZip } from './bundle-installer.js';`):

```js
import { buildManifest } from './asset-manifest.js';
```

In `buildPackage`, immediately after the `detail` object is built (the line ending `workflow: pickedWorkflows.map(...)` closing `};`, currently around line 214) and before `const zip = buildZip(files.map(...))`, insert:

```js
    files.push({
      rel: 'Manifest.json',
      data: Buffer.from(JSON.stringify(buildManifest({
        selection: { skills: sSel, command: cSel, agent: aSel, workflow: wSel },
        details: {
          skills: skillDetails,
          command: cSel.map((name) => ({ name })),
          agent: aSel.map((name) => ({ name })),
          workflow: pickedWorkflows.map((w) => ({ id: w.id, label: w.label, stages: (w.stages || []).length })),
        },
        source: { machineId: this.pub.machineId, host: this.pub.host, port: this.pub.port, employeeId: this.pub.employeeId || '' },
      }), 'utf8'),
    });
```

Note: `installBundleZip` ignores entries whose top segment is not `skills`/`command`/`agent`/`workflow`, so group installs are unaffected.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test server/test/collab-pack-detail.test.js server/test/collab-bundle-installer.test.js server/test/collab-bundle-xml.test.js`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/engine.js server/test/collab-pack-detail.test.js
git commit -m "feat(collab): embed Manifest.json into built packages"
```

---

### Task 3: 本地导入模块

**Files:**
- Create: `server/collaboration/asset-import.js`
- Test: `server/test/collab-asset-import.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/collab-asset-import.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildZip } from '../collaboration/zip.js';
import { buildManifest } from '../collaboration/asset-manifest.js';
import { stageImport, applyImport, discardImport, cleanupStagedImports } from '../collaboration/asset-import.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'asset-import-')); }
function pkg() {
  const manifest = buildManifest({
    selection: { skills: ['demo'], workflow: ['w1'] },
    details: { skills: [{ name: 'demo', files: 1 }], workflow: [{ id: 'w1', label: 'W1', stages: 1 }] },
  });
  return buildZip([
    { name: 'Manifest.json', data: JSON.stringify(manifest) },
    { name: 'skills/demo/SKILL.md', data: '# demo' },
  ]);
}

test('stageImport 落暂存并返回预览；applyImport 安装', () => {
  const dir = tmp();
  const staged = stageImport({ zip: pkg(), dir });
  assert.ok(fs.existsSync(staged.file));
  assert.equal(staged.summary.type, 'skills');
  const skillRoot = path.join(dir, 'skills');
  const configRoot = path.join(dir, 'cfg');
  const r = applyImport({ id: staged.id, file: staged.file, manifest: staged.manifest, skillRoot, configRoot });
  assert.equal(r.code, 'ok');
  assert.ok(fs.existsSync(path.join(skillRoot, 'demo', 'SKILL.md')));
});

test('stageImport 拒绝无 Manifest 的 zip，且不留文件', () => {
  const dir = tmp();
  assert.throws(
    () => stageImport({ zip: buildZip([{ name: 'skills/a/SKILL.md', data: 'x' }]), dir }),
    (e) => e.code === 'manifest-missing',
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('discardImport 与 cleanupStagedImports 清理', () => {
  const dir = tmp();
  const a = stageImport({ zip: pkg(), dir });
  discardImport(a.file);
  assert.ok(!fs.existsSync(a.file));
  const b = stageImport({ zip: pkg(), dir });
  cleanupStagedImports(dir);
  assert.ok(!fs.existsSync(b.file));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/collab-asset-import.test.js`
Expected: FAIL — `Cannot find module '../collaboration/asset-import.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/collaboration/asset-import.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseManifest, manifestSummary } from './asset-manifest.js';
import { installBundleZip } from './bundle-installer.js';

function importError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// 暂存 zip 到 dir 并解析 Manifest；解析失败不留文件
export function stageImport({ zip, dir }) {
  if (!Buffer.isBuffer(zip) || zip.length === 0) throw importError('invalid-zip');
  const manifest = parseManifest(zip);   // 抛 invalid-zip / manifest-missing / bad-manifest / bad-format
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  const file = path.join(dir, `import-${id}.zip`);
  fs.writeFileSync(file, zip);
  return { id, file, manifest, summary: manifestSummary(manifest) };
}

// 严格校验后安装：skills/command/agent 落位，workflow 交给 installWorkflows 合并
export function applyImport({ id, file, manifest, skillRoot, configRoot, installWorkflows = null }) {
  if (!file || !fs.existsSync(file)) return { code: 'not-found' };
  try { manifest = manifest || parseManifest(fs.readFileSync(file)); }
  catch (e) { return { code: (e && e.code) || 'bad-manifest' }; }
  try {
    const r = installBundleZip({ zip: fs.readFileSync(file), skillRoot, configRoot, installWorkflows });
    return { code: 'ok', counts: r.counts, manifest };
  } catch (e) { return { code: 'invalid', error: String((e && e.message) || e) }; }
}

export function discardImport(file) {
  try { if (file) fs.unlinkSync(file); } catch { /* 不存在也算成功 */ }
  return { code: 'ok' };
}

export function cleanupStagedImports(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('import-') || !f.endsWith('.zip')) continue;
    try { fs.unlinkSync(path.join(dir, f)); n++; } catch { /* ignore */ }
  }
  return n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/collab-asset-import.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/asset-import.js server/test/collab-asset-import.test.js
git commit -m "feat(collab): add asset import stage/apply/discard module"
```

---

### Task 4: engine 导入方法与启动清理

**Files:**
- Modify: `server/collaboration/engine.js` (imports; insert methods after `installDownload`, around line 874)
- Modify: `server/index.js` (after line 333 `engine.peer = makePeerClient();`)
- Test: `server/test/collab-import.test.js` (create; engine-only tests in this task, HTTP tests added in Task 5)

- [ ] **Step 1: Write the failing test**

Create `server/test/collab-import.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabEngine } from '../collaboration/engine.js';
import { CollabStore } from '../collaboration/store.js';
import { loadIdentity } from '../collaboration/identity.js';
import { buildZip } from '../collaboration/zip.js';
import { buildManifest } from '../collaboration/asset-manifest.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-import-')); }

export function makeImportZip() {
  const manifest = buildManifest({
    selection: { skills: ['demo'], command: [], agent: [], workflow: ['w1'] },
    details: { skills: [{ name: 'demo', files: 1, hash: 'h' }], workflow: [{ id: 'w1', label: 'W1', stages: 1 }] },
    source: { machineId: 'm1', host: '127.0.0.1', port: 1, employeeId: 'e1' },
  });
  return buildZip([
    { name: 'Manifest.json', data: JSON.stringify(manifest) },
    { name: 'skills/demo/SKILL.md', data: '# demo' },
    { name: 'workflow/workflows.xml', data: '<workflows><workflow id="w1" label="W1"><stage id="s1" label="S1"><prompt>p</prompt></stage></workflow></workflows>' },
  ]);
}

function makeEngine(name) {
  const dir = path.join(tmp(), name);
  const skillsRoot = path.join(dir, 'skills');
  const downloadDir = path.join(dir, 'download');
  fs.mkdirSync(downloadDir, { recursive: true });
  fs.mkdirSync(skillsRoot, { recursive: true });
  let merged = null;
  const engine = new CollabEngine({
    store: new CollabStore({ file: path.join(dir, 'collab.json') }),
    identity: loadIdentity({ file: path.join(dir, 'identity.json'), username: name, host: '127.0.0.1', port: 0 }),
    skillsRoot, downloadDir,
    mergeWorkflows: (list) => { merged = list; return list; },
  });
  return { engine, skillsRoot, downloadDir, getMerged: () => merged };
}

test('engine.stageImport/applyImport 安装 skills 并合并 workflow；discardImport 清理', async () => {
  const { engine, skillsRoot, getMerged } = makeEngine('eng');
  const r = engine.stageImport(makeImportZip());
  assert.equal(r.code, 'ok');
  assert.equal(r.manifest.type, 'mixed');
  assert.equal(r.summary.counts.skills, 1);
  const ap = engine.applyImport(r.id);
  assert.equal(ap.code, 'ok');
  assert.ok(fs.existsSync(path.join(skillsRoot, 'demo', 'SKILL.md')));
  assert.equal(getMerged()[0].id, 'w1');
  assert.equal(engine.applyImport(r.id).code, 'not-found');   // 已消费
  const r2 = engine.stageImport(makeImportZip());
  assert.equal(engine.discardImport(r2.id).code, 'ok');
});

test('engine.stageImport 缺 Manifest 返回 manifest-missing', () => {
  const { engine } = makeEngine('eng2');
  const r = engine.stageImport(buildZip([{ name: 'skills/a/SKILL.md', data: 'x' }]));
  assert.equal(r.code, 'manifest-missing');
});

test('engine.cleanupStagedImports 删除残留', () => {
  const { engine } = makeEngine('eng3');
  engine.stageImport(makeImportZip());
  assert.ok(engine.cleanupStagedImports() >= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/collab-import.test.js`
Expected: FAIL — `engine.stageImport is not a function`

- [ ] **Step 3: Write minimal implementation**

In `server/collaboration/engine.js`, add import next to the `buildManifest` import added in Task 2:

```js
import { stageImport as stageImportAsset, applyImport as applyImportAsset, discardImport as discardImportAsset, cleanupStagedImports as cleanupStagedImportsAsset } from './asset-import.js';
```

Insert these methods inside the `CollabEngine` class, immediately after the `installDownload(name) { ... }` method (ends around line 874):

```js
  // ---- 本地导出包导入（独立于群）----
  importAssetDir() {
    return this.downloadDir || path.join(os.tmpdir(), `devflow-import-${this.identity?.machineId || 'x'}`);
  }
  stageImport(zip) {
    try {
      const r = stageImportAsset({ zip, dir: this.importAssetDir() });
      if (!this.importStaging) this.importStaging = new Map();
      this.importStaging.set(r.id, { file: r.file, manifest: r.manifest });
      return { code: 'ok', id: r.id, manifest: r.manifest, summary: r.summary };
    } catch (e) {
      return { code: (e && e.code) || 'invalid-zip', error: String((e && e.message) || e) };
    }
  }
  applyImport(id) {
    const it = this.importStaging && this.importStaging.get(id);
    if (!it) return { code: 'not-found' };
    const r = applyImportAsset({
      id, file: it.file, manifest: it.manifest,
      skillRoot: this.skillRoot(), configRoot: this.configRoot(),
      installWorkflows: (list) => (this.mergeWorkflows ? this.mergeWorkflows(list) : null),
    });
    if (r.code === 'ok') {
      discardImportAsset(it.file);
      this.importStaging.delete(id);
      this._emit('synced', {});
    }
    return r;
  }
  discardImport(id) {
    const it = this.importStaging && this.importStaging.get(id);
    if (!it) return { code: 'not-found' };
    discardImportAsset(it.file);
    this.importStaging.delete(id);
    return { code: 'ok' };
  }
  cleanupStagedImports() { return cleanupStagedImportsAsset(this.importAssetDir()); }
```

In `server/index.js`, immediately after `engine.peer = makePeerClient();` (line 333), add:

```js
  engine.cleanupStagedImports();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/collab-import.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/engine.js server/index.js server/test/collab-import.test.js
git commit -m "feat(collab): add engine local import methods and startup cleanup"
```

---

### Task 5: HTTP 导入端点

**Files:**
- Modify: `server/collaboration/http-mount.js` (raw-body exclusion near line 67; routes after the packages routes around line 135)
- Test: `server/test/collab-import.test.js` (append HTTP tests)

- [ ] **Step 1: Write the failing test**

Append to `server/test/collab-import.test.js` (add imports at top):

```js
import http from 'node:http';
import { createCollabMount } from '../collaboration/http-mount.js';
```

```js
async function startHttpNode(name) {
  const { engine, skillsRoot, getMerged } = makeEngine(name);
  const mount = createCollabMount({ engine, logger: console });
  const server = http.createServer((req, res) => mount(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { engine, server, port: server.address().port, skillsRoot, getMerged };
}

test('HTTP 导入：stage 返回 Manifest 预览，apply 落位并合并', async () => {
  const n = await startHttpNode('http1');
  try {
    const up = await fetch(`http://127.0.0.1:${n.port}/api/collab/import`, { method: 'POST', body: makeImportZip() });
    assert.equal(up.status, 200);
    const upBody = await up.json();
    assert.equal(upBody.manifest.type, 'mixed');
    assert.equal(upBody.summary.counts.workflow, 1);
    const ap = await fetch(`http://127.0.0.1:${n.port}/api/collab/import/${upBody.id}/apply`, { method: 'POST' });
    const apBody = await ap.json();
    assert.equal(apBody.code, 'ok');
    assert.ok(fs.existsSync(path.join(n.skillsRoot, 'demo', 'SKILL.md')));
    assert.equal(n.getMerged()[0].id, 'w1');
  } finally { n.server.close(); }
});

test('HTTP 导入：缺 Manifest / 非法 zip 返回 400', async () => {
  const n = await startHttpNode('http2');
  try {
    const noManifest = await fetch(`http://127.0.0.1:${n.port}/api/collab/import`, { method: 'POST', body: buildZip([{ name: 'skills/a/SKILL.md', data: 'x' }]) });
    assert.equal(noManifest.status, 400);
    assert.equal((await noManifest.json()).error, 'manifest-missing');
    const bad = await fetch(`http://127.0.0.1:${n.port}/api/collab/import`, { method: 'POST', body: Buffer.from('nope') });
    assert.equal(bad.status, 400);
  } finally { n.server.close(); }
});

test('HTTP 导入：DELETE 丢弃后 apply 返回 not-found', async () => {
  const n = await startHttpNode('http3');
  try {
    const up = await fetch(`http://127.0.0.1:${n.port}/api/collab/import`, { method: 'POST', body: makeImportZip() });
    const { id } = await up.json();
    const del = await fetch(`http://127.0.0.1:${n.port}/api/collab/import/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const ap = await fetch(`http://127.0.0.1:${n.port}/api/collab/import/${id}/apply`, { method: 'POST' });
    assert.equal(ap.status, 400);
    assert.equal((await ap.json()).error, 'not-found');
  } finally { n.server.close(); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/collab-import.test.js`
Expected: FAIL — HTTP import returns 404 / apply 404

- [ ] **Step 3: Write minimal implementation**

In `server/collaboration/http-mount.js`, the route function currently reads the body for every POST. Find:

```js
    const isFileUpload = seg[0] === 'groups' && seg[2] === 'files' && m === 'POST';
    let body = {};
    if (isBodyMethod && !isFileUpload) {
```

Replace with:

```js
    const isFileUpload = seg[0] === 'groups' && seg[2] === 'files' && m === 'POST';
    const isAssetImport = seg[0] === 'import' && seg.length === 1 && m === 'POST';
    let body = {};
    if (isBodyMethod && !isFileUpload && !isAssetImport) {
```

Then add the three routes right after the packages `upload` route (ends around line 135, before the `outfile` route):

```js
      // ---- 本地资产导入（独立于群）----
      if (seg[0] === 'import' && seg.length === 1 && m === 'POST') {
        const data = await readRaw(req).catch(() => null);
        if (!data) return sendJson(res, 413, { error: 'too_large' });
        const r = engine.stageImport(data);
        if (r.code !== 'ok') return sendJson(res, 400, { error: r.code });
        return ok(res, { id: r.id, manifest: r.manifest, summary: r.summary });
      }
      if (seg[0] === 'import' && seg.length === 3 && seg[2] === 'apply' && m === 'POST') {
        const r = engine.applyImport(seg[1]);
        if (r.code !== 'ok') return sendJson(res, 400, { error: r.code });
        return ok(res, { code: 'ok', counts: r.counts });
      }
      if (seg[0] === 'import' && seg.length === 2 && m === 'DELETE') {
        return ok(res, engine.discardImport(seg[1]));
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test server/test/collab-import.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/http-mount.js server/test/collab-import.test.js
git commit -m "feat(collab): add HTTP import endpoints"
```

---

### Task 6: i18n 词条（中英对称）

**Files:**
- Modify: `shared/i18n/zh-CN.js` (after `'collab.dist.package': '包：',`)
- Modify: `shared/i18n/en.js` (after `'collab.dist.package': 'Package:',`)

- [ ] **Step 1: Add zh-CN keys**

In `shared/i18n/zh-CN.js`, after the line `'collab.dist.package': '包：',`, insert:

```js
  'collab.export.button': '导出',
  'collab.export.title': '📤 导出资产（本地）',
  'collab.export.pack_download': '打包并下载（{count}）',
  'collab.import.button': '导入',
  'collab.import.title': '📥 导入资产',
  'collab.import.pick': '选择 zip 文件',
  'collab.import.type': '类型',
  'collab.import.type.skills': '技能',
  'collab.import.type.workflow': '工作流',
  'collab.import.type.mixed': '技能 + 工作流',
  'collab.import.source': '来源',
  'collab.import.exported_at': '导出时间',
  'collab.import.confirm': '确认导入',
  'collab.import.cancel': '取消',
  'collab.import.done': '导入完成',
  'collab.import.done_counts': '技能 {skills} · 命令 {command} · 代理 {agent} · 工作流 {workflow}',
  'collab.import.err.invalid_zip': '无效的 zip 文件',
  'collab.import.err.manifest_missing': '包内缺少 Manifest.json，无法导入',
  'collab.import.err.bad_format': 'Manifest.json 格式不受支持',
  'collab.import.err.bad_manifest': 'Manifest.json 内容无法解析',
  'collab.import.err.too_large': '文件过大，无法导入',
```

- [ ] **Step 2: Add en keys**

In `shared/i18n/en.js`, after the line `'collab.dist.package': 'Package:',`, insert:

```js
  'collab.export.button': 'Export',
  'collab.export.title': '📤 Export assets (local)',
  'collab.export.pack_download': 'Pack & download ({count})',
  'collab.import.button': 'Import',
  'collab.import.title': '📥 Import assets',
  'collab.import.pick': 'Choose zip file',
  'collab.import.type': 'Type',
  'collab.import.type.skills': 'Skills',
  'collab.import.type.workflow': 'Workflow',
  'collab.import.type.mixed': 'Skills + Workflow',
  'collab.import.source': 'Source',
  'collab.import.exported_at': 'Exported at',
  'collab.import.confirm': 'Import',
  'collab.import.cancel': 'Cancel',
  'collab.import.done': 'Imported',
  'collab.import.done_counts': 'Skills {skills} · Commands {command} · Agents {agent} · Workflows {workflow}',
  'collab.import.err.invalid_zip': 'Invalid zip file',
  'collab.import.err.manifest_missing': 'Manifest.json is missing; cannot import',
  'collab.import.err.bad_format': 'Unsupported Manifest.json format',
  'collab.import.err.bad_manifest': 'Manifest.json cannot be parsed',
  'collab.import.err.too_large': 'File too large to import',
```

- [ ] **Step 3: Run i18n check**

Run: `npm.cmd run check:i18n`
Expected: PASS (no Chinese in web/src or server user-visible strings; key sets symmetric)

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(collab): add export/import entries"
```

---

### Task 7: 前端类型与 API

**Files:**
- Modify: `web/src/collaboration/types.ts`
- Modify: `web/src/collaboration/useCollab.ts`

- [ ] **Step 1: Add AssetManifest types**

Append to `web/src/collaboration/types.ts`:

```ts
export interface AssetManifestItem { name?: string; id?: string; label?: string; files?: number; hash?: string | null; stages?: number; }
export interface AssetManifestSource { machineId?: string; host?: string; port?: number; employeeId?: string; }
export interface AssetManifest {
  format: string; version: number; type: 'skills' | 'workflow' | 'mixed';
  exportedAt: number; source: AssetManifestSource | null;
  kinds: string[];
  skills: AssetManifestItem[]; command: AssetManifestItem[]; agent: AssetManifestItem[]; workflow: AssetManifestItem[];
}
export interface AssetManifestSummary {
  type: 'skills' | 'workflow' | 'mixed'; kinds: string[]; exportedAt: number;
  source: AssetManifestSource | null;
  counts: { skills: number; command: number; agent: number; workflow: number };
}
```

- [ ] **Step 2: Add useCollab methods**

In `web/src/collaboration/useCollab.ts`, add the type import after the existing `import { t } from '../i18n';`:

```ts
import type { AssetManifest, AssetManifestSummary } from './types';
```

Then inside the returned object, after the `buildPackage` entry (around line 132), add:

```ts
    importAsset: (file: File) => http<{ id: string; manifest: AssetManifest; summary: AssetManifestSummary }>('/api/collab/import', { method: 'POST', body: file }),
    applyImport: (id: string) => post<{ code: string; counts?: Record<string, number> }>(`/api/collab/import/${id}/apply`),
    discardImport: (id: string) => http<{ code: string }>(`/api/collab/import/${id}`, { method: 'DELETE' }),
```

- [ ] **Step 3: Typecheck**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/collaboration/types.ts web/src/collaboration/useCollab.ts
git commit -m "feat(web): add collab asset import API client"
```

---

### Task 8: AssetImportDialog 组件

**Files:**
- Create: `web/src/collaboration/AssetImportDialog.vue`
- Test: `web/src/collaboration/AssetImportDialog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/collaboration/AssetImportDialog.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import AssetImportDialog from './AssetImportDialog.vue';

const MANIFEST = {
  format: 'devflow-assets', version: 1, type: 'mixed', exportedAt: 1700000000000,
  source: { machineId: 'm1', host: '127.0.0.1', port: 22222, employeeId: 'e1' },
  kinds: ['skills', 'workflow'],
  skills: [{ name: 'foo', files: 1, hash: 'h' }], command: [], agent: [],
  workflow: [{ id: 'w1', label: 'W1', stages: 2 }],
};

function mockCollab() {
  return {
    importAsset: vi.fn(async () => ({ id: 'imp1', manifest: MANIFEST, summary: {} })),
    applyImport: vi.fn(async () => ({ counts: { skills: 1, command: 0, agent: 0, workflow: 1 } })),
    discardImport: vi.fn(async () => ({ code: 'ok' })),
  };
}
async function pickFile(w: any) {
  const input = w.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.zip')], configurable: true });
  await input.trigger('change');
  await flushPromises();
}

describe('AssetImportDialog', () => {
  it('open=false 不渲染', () => {
    const w = mountC(AssetImportDialog, { props: { open: false, collab: mockCollab() as any } });
    expect(w.find('.mask').exists()).toBe(false);
  });

  it('选文件 → 预览 Manifest → 确认导入', async () => {
    const collab = mockCollab();
    const w = mountC(AssetImportDialog, { props: { open: true, collab: collab as any } });
    await pickFile(w);
    expect(collab.importAsset).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('foo');
    expect(w.text()).toContain('W1');
    await w.find('.confirm').trigger('click');
    await flushPromises();
    expect(collab.applyImport).toHaveBeenCalledWith('imp1');
    expect(w.text()).toContain('导入完成');
  });

  it('关闭时丢弃暂存并 emit close', async () => {
    const collab = mockCollab();
    const w = mountC(AssetImportDialog, { props: { open: true, collab: collab as any } });
    await pickFile(w);
    await w.find('.close').trigger('click');
    await flushPromises();
    expect(collab.discardImport).toHaveBeenCalledWith('imp1');
    expect(w.emitted('close')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- src/collaboration/AssetImportDialog.test.ts`
Expected: FAIL — cannot resolve `./AssetImportDialog.vue`

- [ ] **Step 3: Write the component**

Create `web/src/collaboration/AssetImportDialog.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import type { CollabApi } from './useCollab';
import type { AssetManifest } from './types';
import { t } from '../i18n';

const props = defineProps<{ open: boolean; collab: CollabApi }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const fileInput = ref<HTMLInputElement | null>(null);
const stagedId = ref('');
const manifest = ref<AssetManifest | null>(null);
const busy = ref(false);
const msg = ref('');
const msgErr = ref('');
const done = ref<Record<string, number> | null>(null);

const ERR_KEYS: Record<string, string> = {
  'invalid-zip': 'collab.import.err.invalid_zip',
  'manifest-missing': 'collab.import.err.manifest_missing',
  'bad-format': 'collab.import.err.bad_format',
  'bad-manifest': 'collab.import.err.bad_manifest',
  too_large: 'collab.import.err.too_large',
};
function errText(e: unknown) {
  const code = String((e as Error)?.message || e);
  return ERR_KEYS[code] ? t(ERR_KEYS[code]) : code;
}
const typeLabel = computed(() => (manifest.value ? t(`collab.import.type.${manifest.value.type}`) : ''));
const sourceLabel = computed(() => {
  const s = manifest.value?.source;
  if (!s) return '—';
  const id = s.employeeId || s.machineId || '';
  return id ? `${id}@${s.host || ''}:${s.port || ''}` : `${s.host || ''}:${s.port || ''}`;
});
const exportedAt = computed(() => (manifest.value?.exportedAt ? new Date(manifest.value.exportedAt).toLocaleString() : '—'));

function reset() {
  stagedId.value = ''; manifest.value = null; busy.value = false;
  msg.value = ''; msgErr.value = ''; done.value = null;
  if (fileInput.value) fileInput.value.value = '';
}
function pick() { msg.value = ''; msgErr.value = ''; done.value = null; fileInput.value?.click(); }
async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  if (stagedId.value) { try { await props.collab.discardImport(stagedId.value); } catch { /* ignore */ } stagedId.value = ''; }
  busy.value = true; msgErr.value = ''; manifest.value = null; done.value = null;
  try {
    const r = await props.collab.importAsset(f);
    stagedId.value = r.id;
    manifest.value = r.manifest;
  } catch (err) { msgErr.value = errText(err); }
  finally { busy.value = false; if (fileInput.value) fileInput.value.value = ''; }
}
async function confirmImport() {
  if (!stagedId.value) return;
  busy.value = true; msgErr.value = '';
  try {
    const r = await props.collab.applyImport(stagedId.value);
    done.value = r.counts || {};
    msg.value = t('collab.import.done');
    stagedId.value = '';
    manifest.value = null;
  } catch (err) { msgErr.value = errText(err); }
  finally { busy.value = false; }
}
async function close() {
  if (stagedId.value) { try { await props.collab.discardImport(stagedId.value); } catch { /* ignore */ } }
  reset();
  emit('close');
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="mask" @click.self="close">
      <div class="box" role="dialog" aria-modal="true">
        <div class="title">{{ $t('collab.import.title') }}</div>
        <input ref="fileInput" type="file" accept=".zip,application/zip" class="hidden" @change="onFile" />
        <div class="rowbtns">
          <button class="btn pick" :disabled="busy" @click="pick">{{ $t('collab.import.pick') }}</button>
        </div>
        <div v-if="manifest" class="preview">
          <div class="pline"><span class="pk">{{ $t('collab.import.type') }}</span><span class="pv">{{ typeLabel }}</span></div>
          <div class="pline"><span class="pk">{{ $t('collab.import.source') }}</span><span class="pv">{{ sourceLabel }}</span></div>
          <div class="pline"><span class="pk">{{ $t('collab.import.exported_at') }}</span><span class="pv">{{ exportedAt }}</span></div>
          <template v-if="manifest.skills.length">
            <div class="sec">{{ $t('collab.dist.skills', { count: manifest.skills.length }) }}</div>
            <div v-for="s in manifest.skills" :key="'s-' + s.name" class="item">🛠 {{ s.name }}</div>
          </template>
          <template v-if="manifest.command.length">
            <div class="sec">{{ $t('collab.dist.command', { count: manifest.command.length }) }}</div>
            <div v-for="c in manifest.command" :key="'c-' + c.name" class="item">⌨ {{ c.name }}</div>
          </template>
          <template v-if="manifest.agent.length">
            <div class="sec">{{ $t('collab.dist.agent', { count: manifest.agent.length }) }}</div>
            <div v-for="a in manifest.agent" :key="'a-' + a.name" class="item">🤖 {{ a.name }}</div>
          </template>
          <template v-if="manifest.workflow.length">
            <div class="sec">{{ $t('collab.dist.workflow', { count: manifest.workflow.length }) }}</div>
            <div v-for="w in manifest.workflow" :key="'w-' + w.id" class="item">🧩 {{ w.label || w.id }}</div>
          </template>
        </div>
        <div v-if="done" class="ok">{{ msg }} · {{ $t('collab.import.done_counts', { skills: done.skills || 0, command: done.command || 0, agent: done.agent || 0, workflow: done.workflow || 0 }) }}</div>
        <div v-if="msgErr" class="err">{{ msgErr }}</div>
        <div class="foot">
          <button class="btn close" :disabled="busy" @click="close">{{ $t('collab.import.cancel') }}</button>
          <button v-if="manifest" class="btn primary confirm" :disabled="busy" @click="confirmImport">{{ $t('collab.import.confirm') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.box { width: 520px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.hidden { display: none; }
.rowbtns { margin: 10px 0; }
.preview { max-height: 300px; overflow: auto; border: 1px solid var(--bd2); border-radius: 6px; padding: 8px 10px; }
.pline { display: flex; gap: 8px; font-size: 12px; padding: 2px 0; }
.pk { color: var(--tx6); flex: none; min-width: 64px; }
.pv { color: var(--tx1); word-break: break-all; }
.sec { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 8px 0 2px; font-weight: 600; }
.item { color: var(--tx1); font-size: 13px; padding: 2px 0; word-break: break-all; }
.ok { color: var(--ok, #22c55e); font-size: 13px; margin-top: 10px; }
.err { color: var(--err); font-size: 13px; margin-top: 10px; }
.foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.btn { padding: 5px 14px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.btn.primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.btn:disabled { opacity: .55; cursor: default; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test -- src/collaboration/AssetImportDialog.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/collaboration/AssetImportDialog.vue web/src/collaboration/AssetImportDialog.test.ts
git commit -m "feat(web): add asset import dialog"
```

---

### Task 9: SkillDistributor 本地导出模式

**Files:**
- Modify: `web/src/collaboration/SkillDistributor.vue`
- Test: `web/src/collaboration/SkillDistributor.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `describe('SkillDistributor agent selector', ...)` in `web/src/collaboration/SkillDistributor.test.ts`:

```ts
  it('本地导出模式：无 groupId 时打包后直接下载，不发布/上传', async () => {
    const collab: any = mockCollab();
    collab.buildPackage.mockResolvedValue({ package: { id: 'p1', fileName: 'a.zip', size: 1 } });
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }));
    vi.stubGlobal('fetch', fetchMock);
    if (!(URL as any).createObjectURL) (URL as any).createObjectURL = () => 'blob:x';
    if (!(URL as any).revokeObjectURL) (URL as any).revokeObjectURL = () => {};
    try {
      const w = mountC(SkillDistributor, {
        props: { collab, focus: 'skills', open: true },
        global: { plugins: [ElementPlus], stubs: { teleport: true, 'el-dialog': { template: '<div><slot /></div>' } } },
      });
      await flushPromises();
      await w.find('input[type="checkbox"]').setValue(true);
      await w.find('button.go').trigger('click');
      await flushPromises();
      expect(collab.buildPackage).toHaveBeenCalled();
      expect(collab.publishPackage).not.toHaveBeenCalled();
      expect(collab.uploadPackage).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith('/api/collab/outfile/p1');
    } finally { vi.unstubAllGlobals(); }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- src/collaboration/SkillDistributor.test.ts`
Expected: FAIL — `collab.uploadPackage` was called with `('p1', undefined)` (local mode not implemented)

- [ ] **Step 3: Implement local mode**

In `web/src/collaboration/SkillDistributor.vue`:

3a. Make `groupId` optional in the props (line 7):

```ts
const props = defineProps<{ collab: CollabApi; groupId?: string; focus?: 'all' | 'skills' | 'workflow'; open?: boolean }>();
```

3b. After `const focus = computed(...)`, add `local` and update `dialogTitle` (lines 9-10):

```ts
const local = computed(() => !props.groupId);
const dialogTitle = computed(() => (local.value
  ? t('collab.export.title')
  : focus.value === 'workflow' ? t('collab.chat.distribute_workflow') : t('collab.chat.distribute')));
```

3c. Update `storeKey` (line 77):

```ts
const storeKey = computed(() => `collab-dist-${props.groupId || 'local'}-${focus.value}-${selectedAgent.value}`);
```

3d. Update `doSubmit` (line 99) to short-circuit in local mode:

```ts
async function doSubmit() {
  if (!selectedCount.value) { msg.value = t('collab.dist.select_first'); return; }
  msg.value = ''; msgErr.value = ''; working.value = true;
  try {
    const r = await props.collab.buildPackage(selected.value);
    pkg.value = r.package;
    if (local.value) {
      await downloadPkg();
      msg.value = t('collab.dist.packed');
      return;
    }
    if (isMaster.value) {
      const pub = await props.collab.publishPackage(pkg.value.id);
      if (pub.code !== 'ok') { msgErr.value = t('common.send_failed', { msg: pub.code }); return; }
      sent.value = true;
      publishedVersion.value = pub.version || '';
      msg.value = t('collab.dist.published', { version: pub.version || '—' });
    } else {
      const up = await props.collab.uploadPackage(pkg.value.id, props.groupId);
      if (up.code !== 'ok') { msgErr.value = t('common.send_failed', { msg: up.code }); return; }
      sent.value = true;
      msg.value = t('collab.dist.uploaded');
    }
  } catch (e: any) { msgErr.value = String(e?.message || e); }
  finally { working.value = false; }
}
```

3e. Update the header title (line 140) and the main button (lines 194-196):

```html
      <span class="htitle">{{ local ? $t('collab.export.title') : $t('collab.dist.title') }} <span class="gn">{{ group?.name || '' }}</span></span>
```

```html
          <button class="go" :disabled="working || !selectedCount" @click="doSubmit">
            {{ working ? $t('common.sending') : (local ? $t('collab.export.pack_download', { count: selectedCount }) : (isMaster ? $t('collab.dist.pack_publish', { count: selectedCount }) : $t('collab.dist.pack_upload', { count: selectedCount }))) }}
          </button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm.cmd --prefix web run test -- src/collaboration/SkillDistributor.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/collaboration/SkillDistributor.vue web/src/collaboration/SkillDistributor.test.ts
git commit -m "feat(web): support local export mode in SkillDistributor"
```

---

### Task 10: CollaborationView 顶栏入口

**Files:**
- Modify: `web/src/collaboration/CollaborationView.vue`

- [ ] **Step 1: Add imports and state**

In `web/src/collaboration/CollaborationView.vue`, add imports after `import SyncUpdateDialog from './SyncUpdateDialog.vue';`:

```ts
import SkillDistributor from './SkillDistributor.vue';
import AssetImportDialog from './AssetImportDialog.vue';
```

After `const collab = useCollab();`, add:

```ts
const exportOpen = ref(false);
const importOpen = ref(false);
```

- [ ] **Step 2: Add topbar buttons and dialogs**

In the template, after the closing `</nav>` of the tabs (line 79), add:

```html
      <button class="tb" @click="exportOpen = true">{{ $t('collab.export.button') }}</button>
      <button class="tb" @click="importOpen = true">{{ $t('collab.import.button') }}</button>
```

Before the closing `</div>` of `.cv` (after the `<SyncUpdateDialog ... />` block), add:

```html
    <SkillDistributor :open="exportOpen" :collab="collab" @close="exportOpen = false" />
    <AssetImportDialog :open="importOpen" :collab="collab" @close="importOpen = false" />
```

In the `<style scoped>` block, after the `.tab.on` rule, add:

```css
.tb { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.tb:hover { border-color: var(--ac2); }
```

- [ ] **Step 3: Typecheck and run web tests**

Run: `npm.cmd run typecheck`
Expected: PASS

Run: `npm.cmd --prefix web run test`
Expected: PASS (all existing + new)

- [ ] **Step 4: Commit**

```bash
git add web/src/collaboration/CollaborationView.vue
git commit -m "feat(web): add export/import buttons to collaboration topbar"
```

---

### Task 11: 全量验证

- [ ] **Step 1: Run server tests**

Run: `npm.cmd run test:server`
Expected: PASS (all)

- [ ] **Step 2: Run web tests**

Run: `npm.cmd run test:web`
Expected: PASS (all)

- [ ] **Step 3: Run typecheck**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 4: Run i18n check**

Run: `npm.cmd run check:i18n`
Expected: PASS

- [ ] **Step 5: Sensitive-info scan (repo rule)**

Run: `git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat_|-----BEGIN [A-Z ]*PRIVATE KEY-----"`
Expected: no matches in the changed files

---

## Self-Review Notes

- **Spec coverage:** Manifest schema/type/kinds → Task 1; buildPackage embedding → Task 2; local import module → Task 3; engine methods + startup cleanup → Task 4; HTTP endpoints (stage/apply/discard) → Task 5; strict validation (missing format/version rejected) → Tasks 1/3/5; UI export (optional groupId + pack&download) → Task 9; UI import (file pick → preview → confirm, discard on close) → Task 8; topbar entries → Task 10; i18n → Task 6; tests/commands → Tasks 1-11; out-of-scope items unchanged.
- **Type consistency:** `stageImport/applyImport/discardImport/cleanupStagedImports/importAssetDir` names match between engine, module, and tests. Manifest error codes `invalid-zip/manifest-missing/bad-format/bad-manifest` match `ERR_KEYS` in the dialog and the HTTP `{ error }` payloads.
- **No placeholders:** all steps include concrete code/commands.
