# 工作流按文件存储 + Priority 排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工作流从 `devflow.xml` 的 `<workflows>` 段迁到 `<端口数据目录>/workflows/<id>.xml` 单文件存储，并支持 `priority` 排序。

**Architecture:** 新增 `server/workflow-store.js`（读/写/删/迁移单文件，返回按 priority 排序的列表）；`shared/workflow-xml.js` 增加 `priority` 解析/序列化与 `sortWorkflows`；`server/index.js` 装配 store 并把 runner/协作/接口的数据源切到 store；前端编辑器改为「当前工作流」单文件导入导出。

**Tech Stack:** Node ESM + `node:test`；Vue 3 + TS + vitest；共享代码通过 `@devflow/shared/workflow-xml` 引用。

设计文档：`docs/superpowers/specs/2026-09-21-workflow-file-storage-priority-design.md`。

**关键约定（避免破坏既有测试）**：`priority` 采用**条件出现**——缺省/0 时解析结果不含该键、序列化不输出该属性；非 0 时才出现。`sortWorkflows` 把缺失当 0。

---

## File Structure

- Modify: `shared/workflow-xml.js`、`shared/workflow-xml.d.ts` — priority + `sortWorkflows`。
- Create: `server/workflow-store.js` — 单文件存储。
- Modify: `server/port-paths.js` — `workflowsDir`。
- Modify: `server/devflow-config.js` — `validateWorkflows` 透传 priority。
- Modify: `server/workflow-seed.js` — hash 纳入 priority（有条件）。
- Modify: `server/index.js` — 装配 store、切换数据源与接口、NODE 路径补 workflowsDir。
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js` — 词条。
- Modify: `web/src/workflowModel.ts` — `Workflow.priority`、sanitize。
- Modify: `web/src/components/WorkflowEditor.vue`、`WorkflowXmlTab.vue`、`WorkflowFormTab.vue`。
- Tests: `server/test/shared-workflow-xml.test.js`、`server/test/workflow-store.test.js`(新)、`server/test/port-paths.test.js`、`server/test/devflow-config.test.js`、`web/src/workflowModel.test.ts`。

---

### Task 1: shared priority + sortWorkflows

**Files:**
- Modify: `shared/workflow-xml.js`
- Modify: `shared/workflow-xml.d.ts`
- Test: `server/test/shared-workflow-xml.test.js`

- [ ] **Step 1: 追加失败测试**

在 `server/test/shared-workflow-xml.test.js` 末尾追加（并在顶部 import 加入 `sortWorkflows, serializeWorkflow`——`serializeWorkflow` 已导入）：

```js
test('shared: priority 解析与序列化（缺省不出现）', () => {
  const withP = '<workflows><workflow id="a" label="A" priority="7"><stage id="s" label="S"><prompt>p</prompt></stage></workflow></workflows>';
  const wfs = parseWorkflowsXml(withP);
  assert.equal(wfs[0].priority, 7);
  assert.ok(serializeWorkflow(wfs[0]).includes('priority="7"'));

  const noP = '<workflows><workflow id="b" label="B"><stage id="s" label="S"><prompt>p</prompt></stage></workflow></workflows>';
  const plain = parseWorkflowsXml(noP)[0];
  assert.equal('priority' in plain, false);
  assert.ok(!serializeWorkflow(plain).includes('priority='));
});

test('shared: priority 非法值归 0 且不输出', () => {
  const xml = '<workflows><workflow id="a" label="A" priority="abc"><stage id="s" label="S"><prompt>p</prompt></stage></workflow></workflows>';
  const wf = parseWorkflowsXml(xml)[0];
  assert.equal(wf.priority, 0);
  assert.ok(!serializeWorkflow(wf).includes('priority='));
});

test('shared: sortWorkflows 按 priority 降序、label 升序、id 升序', () => {
  const list = [
    { id: 'b', label: 'B', stages: [] },
    { id: 'a', label: 'A', stages: [] },
    { id: 'c', label: 'A', stages: [], priority: 5 },
    { id: 'd', label: 'C', stages: [], priority: 5 },
  ];
  assert.deepEqual(sortWorkflows(list).map((w) => w.id), ['c', 'd', 'a', 'b']);
  assert.deepEqual(list.map((w) => w.id), ['b', 'a', 'c', 'd']);   // 不改原数组
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/shared-workflow-xml.test.js"`
Expected: FAIL（`sortWorkflows is not a function`）

- [ ] **Step 3: 实现**

`shared/workflow-xml.js`：在 `parseWorkflowsXml` 的 wf 对象构造处加 priority：

```js
    const wf = {
      id: attr(wm[1], 'id') || `wf-${workflows.length}`,
      label: attr(wm[1], 'label') || attr(wm[1], 'id'),
      stages: [],
    };
    const prioRaw = attr(wm[1], 'priority');
    if (prioRaw !== '') {
      const n = Number(prioRaw);
      wf.priority = Number.isFinite(n) ? n : 0;
    }
```

`serializeWorkflow` 改为：

```js
export function serializeWorkflow(w) {
  const prio = Number.isFinite(Number(w.priority)) ? Number(w.priority) : 0;
  const pAttr = prio ? ` priority="${prio}"` : '';
  const stages = (w.stages || []).map((s) => {
    const group = s.group ? ` group="${escXml(s.group)}"` : '';
    const prompts = (s.prompts || []).map((p) => `      <prompt>${escXml(p)}</prompt>`).join('\n');
    return `    <stage id="${escXml(s.id)}" label="${escXml(s.label)}"${group}>\n${prompts}\n    </stage>`;
  }).join('\n');
  return `  <workflow id="${escXml(w.id)}" label="${escXml(w.label)}"${pAttr}>\n${stages}\n  </workflow>`;
}
```

文件末尾新增：

```js
// 按 priority 降序 → label 升序 → id 升序；缺失 priority 视为 0。
export function sortWorkflows(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const prio = (w) => (Number.isFinite(Number(w && w.priority)) ? Number(w.priority) : 0);
  return arr.sort((a, b) => {
    const d = prio(b) - prio(a);
    if (d) return d;
    const la = String((a && (a.label || a.id)) || '');
    const lb = String((b && (b.label || b.id)) || '');
    const c = la.localeCompare(lb);
    if (c) return c;
    return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
  });
}
```

- [ ] **Step 4: 更新类型声明**

`shared/workflow-xml.d.ts` 改为：

```ts
export interface WorkflowStage { id: string; label: string; group?: string; prompts: string[]; }
export interface Workflow { id: string; label: string; priority?: number; stages: WorkflowStage[]; }
export declare function parseWorkflowsXml(xml: string): Workflow[];
export declare function serializeWorkflow(w: Workflow): string;
export declare function serializeWorkflowsFragment(workflows: Workflow[]): string;
export declare function sortWorkflows<T extends { id: string; label?: string; priority?: number }>(workflows: T[]): T[];
export declare function escXml(s: unknown): string;
export declare function decode(s: unknown): string;
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test "server/test/shared-workflow-xml.test.js"`
Expected: PASS（原 7 + 新 3）

- [ ] **Step 6: 提交**

```bash
git add shared/workflow-xml.js shared/workflow-xml.d.ts server/test/shared-workflow-xml.test.js
git commit -m "feat(workflow): priority 解析序列化与 sortWorkflows"
```

---

### Task 2: 单文件存储 workflow-store

**Files:**
- Create: `server/workflow-store.js`
- Test: `server/test/workflow-store.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/workflow-store.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowStore, safeWorkflowFile } from '../workflow-store.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-wfstore-')); }
const wf = (id, label, priority) => ({ id, label, ...(priority ? { priority } : {}), stages: [{ id: 's', label: 'S', prompts: ['p'] }] });

test('safeWorkflowFile 净化非法字符并防穿越', () => {
  assert.equal(safeWorkflowFile('dev'), 'dev.xml');
  assert.equal(safeWorkflowFile('a/b\\c'), 'a_b_c.xml');
  assert.ok(!safeWorkflowFile('..').includes('/'));
  assert.ok(!safeWorkflowFile('..').includes('\\'));
});

test('writeAll 落盘为单文件，readAll 读回并按 priority 排序', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('b', 'B', 0), wf('a', 'A', 5)]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.xml', 'b.xml']);
  const out = store.readAll();
  assert.deepEqual(out.map((w) => w.id), ['a', 'b']);
  assert.equal(out[0].priority, 5);
});

test('writeAll 删除不再存在的文件', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('a', 'A'), wf('b', 'B')]);
  store.writeAll([wf('a', 'A')]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.xml']);
  assert.deepEqual(store.readAll().map((w) => w.id), ['a']);
});

test('单文件损坏被跳过，其余照常', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('a', 'A')]);
  fs.writeFileSync(path.join(dir, 'broken.xml'), '<workflow', 'utf8');
  assert.deepEqual(store.readAll().map((w) => w.id), ['a']);
});

test('同 id 重复文件：按文件名后者覆盖并告警', () => {
  const dir = tmp();
  const store = createWorkflowStore({ dir, logger: { warn() {} } });
  fs.writeFileSync(path.join(dir, '1.xml'), '<workflow id="dup" label="First"><stage id="s" label="S"><prompt>p</prompt></stage></workflow>', 'utf8');
  fs.writeFileSync(path.join(dir, '2.xml'), '<workflow id="dup" label="Second"><stage id="s" label="S"><prompt>p</prompt></stage></workflow>', 'utf8');
  const out = store.readAll();
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'Second');
});

test('migrateFromConfigXml 拆分 <workflows> 并从配置移除该段', () => {
  const dir = tmp();
  const cfg = path.join(tmp(), 'devflow.xml');
  const xml = '<?xml version="1.0"?>\n<devflow>\n  <server language="zh-CN" host="127.0.0.1" />\n  <agents default="opencode" />\n  <workflows>\n  <workflow id="dev" label="D"><stage id="s" label="S"><prompt>p</prompt></stage></workflow>\n  </workflows>\n</devflow>\n';
  fs.writeFileSync(cfg, xml, 'utf8');
  const store = createWorkflowStore({ dir, configFile: cfg });
  assert.equal(store.migrateFromConfigXml(), true);
  assert.deepEqual(store.readAll().map((w) => w.id), ['dev']);
  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(!/<workflows\b/i.test(after));
  assert.ok(/<server\b/.test(after) && /<agents\b/.test(after));
});

test('migrateFromConfigXml 目录已有文件时不迁移', () => {
  const dir = tmp();
  const cfg = path.join(tmp(), 'devflow.xml');
  fs.writeFileSync(cfg, '<devflow><workflows><workflow id="x" label="X"><stage id="s" label="S"><prompt>p</prompt></stage></workflow></workflows></devflow>', 'utf8');
  const store = createWorkflowStore({ dir });
  store.writeAll([wf('keep', 'K')]);
  assert.equal(store.migrateFromConfigXml(), false);
  assert.deepEqual(store.readAll().map((w) => w.id), ['keep']);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/workflow-store.test.js"`
Expected: FAIL（`Cannot find module '../workflow-store.js'`）

- [ ] **Step 3: 实现 server/workflow-store.js**

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseWorkflowsXml, serializeWorkflow, sortWorkflows } from '@devflow/shared/workflow-xml';
import { validateWorkflows } from './devflow-config.js';

const EXT = '.xml';

// id → 安全文件名（仅 [A-Za-z0-9._-]；为空/纯点用 id 的 sha256 前缀兜底）
export function safeWorkflowFile(id) {
  const raw = String(id == null ? '' : id);
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  const base = cleaned && cleaned !== '_' ? cleaned : crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
  return `${base}${EXT}`;
}

// 每端口一个目录，单文件存一个 workflow；读时按 priority 排序。
export function createWorkflowStore({ dir, configFile = null, seedStore = null, logger = console } = {}) {
  fs.mkdirSync(dir, { recursive: true });

  function filePathFor(id) {
    const resolved = path.resolve(path.join(dir, safeWorkflowFile(id)));
    if (resolved !== path.resolve(dir) && !resolved.startsWith(path.resolve(dir) + path.sep)) throw new Error('bad workflow path');
    return resolved;
  }
  function listFiles() {
    try { return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(EXT)); }
    catch (e) { logger?.warn?.('workflow dir read failed', (e && e.message) || e); return []; }
  }
  function readAll() {
    const byId = new Map();
    for (const name of listFiles().sort()) {
      let wfs = [];
      try { wfs = parseWorkflowsXml(fs.readFileSync(path.join(dir, name), 'utf8')); }
      catch (e) { logger?.warn?.(`workflow file parse failed: ${name}`, (e && e.message) || e); continue; }
      const wf = wfs[0];
      if (!wf || !wf.id) { logger?.warn?.(`workflow file has no workflow: ${name}`); continue; }
      if (byId.has(wf.id)) logger?.warn?.(`duplicate workflow id "${wf.id}": ${name} overrides earlier file`);
      byId.set(wf.id, wf);
    }
    return sortWorkflows([...byId.values()]);
  }
  function writeAll(list) {
    const clean = validateWorkflows(list);
    const wanted = new Map();
    for (const wf of clean) wanted.set(safeWorkflowFile(wf.id), wf);
    for (const [, wf] of wanted) {
      const p = filePathFor(wf.id);
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, serializeWorkflow(wf) + '\n', 'utf8');
      fs.renameSync(tmp, p);
    }
    for (const name of listFiles()) {
      if (!wanted.has(name)) { try { fs.unlinkSync(path.join(dir, name)); } catch { /* ignore */ } }
    }
    seedStore?.update?.(clean);
    return sortWorkflows(clean);
  }
  // 一次性迁移：目录为空且配置里有 <workflows> → 拆成单文件并删掉该段
  function migrateFromConfigXml() {
    if (!configFile || !fs.existsSync(configFile)) return false;
    if (listFiles().length) return false;
    let xml = '';
    try { xml = fs.readFileSync(configFile, 'utf8'); } catch { return false; }
    const wfs = parseWorkflowsXml(xml);
    if (wfs.length) writeAll(wfs);
    const stripped = xml.replace(/[ \t]*<workflows\b[^>]*>[\s\S]*?<\/workflows>\s*/i, '');
    if (stripped !== xml) fs.writeFileSync(configFile, stripped, 'utf8');
    return wfs.length > 0;
  }
  return { readAll, writeAll, migrateFromConfigXml, filePathFor, dir };
}
```

- [ ] **Step 4: `validateWorkflows` 透传 priority**

`server/devflow-config.js` 的 `validateWorkflows` 中，把 workflow 返回对象改为（保留条件出现）：

```js
    return {
      id: id || `wf-${wi}`,
      label: label || id || `wf-${wi}`,
      ...(Number.isFinite(Number(w && w.priority)) && Number(w.priority) ? { priority: Number(w.priority) } : {}),
      stages: stages.map((s, si) => { /* 原样 */ }),
    };
```

在 `server/test/devflow-config.test.js` 末尾追加：

```js
test('validateWorkflows 透传非 0 priority（0/缺失不产生键）', () => {
  const out = validateWorkflows([
    { id: 'a', label: 'A', priority: 3, stages: [{ id: 's', label: 'S', prompts: ['p'] }] },
    { id: 'b', label: 'B', priority: 0, stages: [{ id: 's', label: 'S', prompts: ['p'] }] },
    { id: 'c', label: 'C', stages: [{ id: 's', label: 'S', prompts: ['p'] }] },
  ]);
  assert.equal(out[0].priority, 3);
  assert.equal('priority' in out[1], false);
  assert.equal('priority' in out[2], false);
});
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test "server/test/workflow-store.test.js" "server/test/devflow-config.test.js"`
Expected: PASS（新 7 + 新 1 + 既有）

- [ ] **Step 6: 提交**

```bash
git add server/workflow-store.js server/test/workflow-store.test.js server/devflow-config.js
git commit -m "feat(workflow): 单文件存储 workflow-store + 迁移"
```

---

### Task 3: 端口路径 workflowsDir

**Files:**
- Modify: `server/port-paths.js`
- Test: `server/test/port-paths.test.js`

- [ ] **Step 1: 追加失败测试**

在 `server/test/port-paths.test.js` 的第 18 行（`workflowsFile` 断言后）插入：

```js
  assert.equal(p.workflowsDir, path.join(base, 'workflows'));
```

并在 `ensurePortDirs` 测试的目录数组里加入 `p.workflowsDir`。

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/port-paths.test.js"`
Expected: FAIL（`undefined`）

- [ ] **Step 3: 实现**

`server/port-paths.js` 的 `portPaths` 返回对象里，`workflowsFile` 后加：

```js
    workflowsDir: path.join(dir, 'workflows'),
```

`ensurePortDirs` 的目录数组加入 `paths.workflowsDir`：

```js
  for (const d of [paths.dir, paths.schedulerDir, paths.collabDir, paths.uploadDir, paths.downloadDir, paths.downloadsDir, paths.workflowsDir, paths.skillsRoot, paths.sessionLogsDir, paths.postmanDir, paths.notepadDir, paths.yamlDir, paths.jsDir, paths.translateDir, paths.navicatDir]) {
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/port-paths.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/port-paths.js server/test/port-paths.test.js
git commit -m "feat(port): 端口数据目录新增 workflows/"
```

---

### Task 4: seed hash 纳入 priority

**Files:**
- Modify: `server/workflow-seed.js`
- Test: `server/test/workflow-seed.test.js`

- [ ] **Step 1: 追加失败测试**

在 `server/test/workflow-seed.test.js` 末尾追加（`hashWorkflow` 已导入）：

```js
test('hashWorkflow 区分 priority（nonzero 才计入）', () => {
  const base = { id: 'w', label: 'W', stages: [] };
  assert.equal(hashWorkflow(base), hashWorkflow({ ...base, priority: 0 }));
  assert.notEqual(hashWorkflow(base), hashWorkflow({ ...base, priority: 3 }));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/workflow-seed.test.js"`
Expected: FAIL（两次 hash 相等）

- [ ] **Step 3: 实现**

`server/workflow-seed.js` 的 `hashWorkflow`：

```js
export function hashWorkflow(w) {
  const norm = {
    id: w.id,
    label: w.label,
    ...(Number.isFinite(Number(w.priority)) && Number(w.priority) ? { priority: Number(w.priority) } : {}),
    stages: (w.stages || []).map((s) => ({ id: s.id, label: s.label, group: s.group || '', prompts: s.prompts || [] })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/workflow-seed.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/workflow-seed.js server/test/workflow-seed.test.js
git commit -m "feat(workflow): 工作流种子 hash 纳入 priority"
```

---

### Task 5: 服务端装配与接口切到 store

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 加 import**

`server/index.js` 顶部（`workflow-merge.js` import 附近）加：

```js
import { createWorkflowStore } from './workflow-store.js';
import { fallbackWorkflows } from './workflow-xml.js';
```

- [ ] **Step 2: buildWorkspace 内建 store 并迁移**

在 `buildWorkspace` 里 `const workflowSeedStore = ...;`（约 `:253`）之后插入：

```js
  // 工作流改为每端口一个目录、单文件存一条；启动时把旧 devflow.xml 的 <workflows> 一次性拆出来
  const workflowStore = createWorkflowStore({ dir: paths.workflowsDir, configFile, seedStore: workflowSeedStore, logger: log });
  workflowStore.migrateFromConfigXml();
  if (!workflowStore.readAll().length) workflowStore.writeAll(fallbackWorkflows());
```

- [ ] **Step 3: 数据源切到 store**

- WorkflowRunner 装配：`getWorkflows: () => loadDevflowConfig(configFile).workflows,` → `getWorkflows: () => workflowStore.readAll(),`
- 协作引擎装配：`getWorkflows: () => loadDevflowConfig(configFile).workflows,` → `getWorkflows: () => workflowStore.readAll(),`
- 协作引擎 `mergeWorkflows`：

```js
    mergeWorkflows: (incoming) => workflowStore.writeAll(mergeWorkflowList(workflowStore.readAll(), incoming)),
```

- [ ] **Step 4: 导出 store 到 ws 包**

`buildWorkspace` 的 `return { ... }`（约 `:493`）加入 `workflowStore`：

```js
  return { projects, saveProjects, workflows, workflowStore, sessionManager, workflowRunner, engine, collabMount, usageMount, usageReporter, scheduler, httpApi, llmMount, translateMount, llmVault, usageStore, taskStore, workflowSeedStore, sessionLedger, historyFile: paths.historyFile, paths, restoreSessionById, navicatMount };
```

- [ ] **Step 5: 接口切到 store**

`GET /api/workflows-xml`：

```js
  if (url.pathname === '/api/workflows-xml' && req.method === 'GET') {
    const workflows = ws?.workflowStore?.readAll() || [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ workflows }));
    return;
  }
```

`POST /api/workflows` 的写入行：

```js
      try { saved = ws?.workflowStore?.writeAll(body.workflows) || []; }
```

`POST /api/config/xml` 里，把 seed 刷新行改为（写盘后若配置带 `<workflows>` 则顺带迁移）：

```js
      try {
        if (/<workflows\b/i.test(xml)) ws?.workflowStore?.migrateFromConfigXml();
        ws?.workflowSeedStore?.update(ws?.workflowStore?.readAll() || []);
      } catch { /* ignore */ }
```

- [ ] **Step 6: NODE 逃生通道补 workflowsDir**

`onListening` 的 NODE 分支 `ensurePortDirs({ ...portPaths(actual), ... })` 里，`workflowsFile` 行后加：

```js
        workflowsDir: path.join(stateRoot, 'workflows'),
```

- [ ] **Step 7: 冒烟验证**

Run: `node --test "server/test/ws-gateway.test.js" "server/test/workflow-runner.test.js" "server/test/config.test.js"`
Expected: PASS（无回归）

- [ ] **Step 8: 提交**

```bash
git add server/index.js
git commit -m "feat(workflow): 装配单文件 store 并切换接口/协作数据源"
```

---

### Task 6: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 的 `wfe.title` 附近加入：

```js
  'wfe.current_workflow': '当前工作流',
  'wfe.priority': '优先级',
  'wfe.import_workflow': '导入工作流文件',
  'wfe.export_workflow': '导出当前工作流',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 加入（键对称）：

```js
  'wfe.current_workflow': 'Current workflow',
  'wfe.priority': 'Priority',
  'wfe.import_workflow': 'Import workflow file',
  'wfe.export_workflow': 'Export current workflow',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: 零命中

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 工作流单文件导入导出与优先级词条"
```

---

### Task 7: 前端 workflowModel priority

**Files:**
- Modify: `web/src/workflowModel.ts`
- Test: `web/src/workflowModel.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `web/src/workflowModel.test.ts` 的 `duplicate / new / sanitize` describe 内追加：

```ts
  it('sanitizeModel 保留非 0 priority、丢弃非法', () => {
    const m = [w({ priority: 5 }), w({ id: 'x', priority: NaN as unknown as number })];
    const out = sanitizeModel(m);
    expect(out[0].priority).toBe(5);
    expect('priority' in out[1]).toBe(false);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- --run src/workflowModel.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`web/src/workflowModel.ts`：

```ts
export interface Workflow {
  id: string;
  label: string;
  priority?: number;
  stages: WorkflowStage[];
}
```

`sanitizeModel` 的 workflow 映射改为：

```ts
export function sanitizeModel(model: Workflow[]): Workflow[] {
  return (model || []).map((w) => {
    const prio = Number(w.priority);
    return {
      id: w.id,
      label: w.label,
      ...(Number.isFinite(prio) && prio ? { priority: prio } : {}),
      stages: (w.stages || []).map((st) => ({
        id: st.id,
        label: st.label,
        group: st.group || '',
        prompts: (st.prompts || []).map((p) => String(p)).filter((p) => p.trim() !== ''),
      })),
    };
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- --run src/workflowModel.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/workflowModel.ts web/src/workflowModel.test.ts
git commit -m "feat(workflow): 前端 Workflow 支持 priority"
```

---

### Task 8: 前端编辑器单文件导入导出

**Files:**
- Modify: `web/src/components/WorkflowXmlTab.vue`
- Modify: `web/src/components/WorkflowEditor.vue`
- Modify: `web/src/components/WorkflowFormTab.vue`

- [ ] **Step 1: WorkflowXmlTab 改为单工作流**

`web/src/components/WorkflowXmlTab.vue` script 顶部：

```ts
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { xml } from '@codemirror/lang-xml';
import { serializeWorkflow, parseWorkflowsXml } from '@devflow/shared/workflow-xml';
import { useTheme } from '../theme';
import type { Workflow } from '../workflowModel';

const props = defineProps<{ workflow: Workflow | null }>();
const emit = defineEmits<{ (e: 'update:workflow', w: Workflow): void }>();
```

把 `props.model` 相关改为单工作流：

```ts
const text = ref(props.workflow ? serializeWorkflow(props.workflow) : '');
```

`parseNow`：

```ts
function parseNow() {
  const bad = wellFormed(text.value);
  if (bad) { xmlError.value = bad; return; }
  xmlError.value = '';
  const next = parseWorkflowsXml(text.value)[0];
  if (next && props.workflow && JSON.stringify(next) !== JSON.stringify(props.workflow)) {
    justEmitted = true;
    emit('update:workflow', next);
  }
  handEdited = false;
}
```

`refreshFromForm` / watch：

```ts
function refreshFromForm() {
  xmlError.value = '';
  handEdited = false;
  setText(props.workflow ? serializeWorkflow(props.workflow) : '');
}

watch(() => props.workflow, (w) => {
  if (justEmitted) { justEmitted = false; return; }
  if (!handEdited) setText(w ? serializeWorkflow(w) : '');
}, { deep: true });
```

模板顶部加空态：

```html
  <div class="xmlwrap">
    <div v-if="!workflow" class="empty">{{ $t('wfe.preview.empty') }}</div>
    <template v-else>
      <div class="bar">
        <button class="btn" @click="refreshFromForm">{{ $t('wfe.refresh_from_form') }}</button>
      </div>
      <div v-if="xmlError" class="err">{{ $t('wfe.xml_error', { msg: xmlError }) }}</div>
      <div ref="host" class="editor" />
    </template>
  </div>
```

样式加 `.empty { color: var(--tx3); font-size: 13px; }`。`mount()` 需在 workflow 存在时调用：把 `onMounted(mount)` 改为 `onMounted(() => { if (props.workflow) mount(); })`，并在 watch 里当从 null 变有值时 `nextTick(mount)`（新增 `import { nextTick }`）。

- [ ] **Step 2: WorkflowEditor 加当前工作流与单文件导入导出**

`web/src/components/WorkflowEditor.vue` script：

imports 增加：

```ts
import { serializeWorkflow, parseWorkflowsXml, sortWorkflows } from '@devflow/shared/workflow-xml';
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
```

（`watch` 加入现有 vue import。）

加当前工作流状态与操作：

```ts
const currentId = ref('');
watch(model, () => {
  if (!model.value.some((w) => w.id === currentId.value)) currentId.value = model.value[0]?.id || '';
}, { deep: true });
const current = computed<Workflow | null>(() => model.value.find((w) => w.id === currentId.value) || model.value[0] || null);

function applyWorkflow(wf: Workflow) {
  const next = model.value.slice();
  const i = next.findIndex((w) => w.id === wf.id);
  if (i >= 0) next[i] = wf; else next.push(wf);
  applyModel(sortWorkflows(next));
  currentId.value = wf.id;
}
```

`load()` 之后设默认：

```ts
async function load() {
  try {
    const r = await fetch('/api/workflows-xml').then((x) => x.json());
    model.value = Array.isArray(r?.workflows) ? JSON.parse(JSON.stringify(r.workflows)) : [];
  } catch { model.value = []; }
  currentId.value = model.value[0]?.id || '';
  history.value = [JSON.stringify(model.value)];
  hIndex.value = 0;
  dirty.value = false;
}
```

`exportXml` 改为导出当前工作流：

```ts
function exportXml() {
  if (!current.value) return;
  const xml = serializeWorkflow(current.value) + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  a.download = `${current.value.id || 'workflow'}.xml`;
  a.click();
  URL.revokeObjectURL(a.href);
}
```

`onFile` 改为导入单文件：

```ts
async function onFile(e: Event) {
  const inp = e.target as HTMLInputElement;
  const f = inp.files?.[0];
  if (!f) return;
  const xml = await f.text();
  const wf = parseWorkflowsXml(xml)[0];
  if (!wf) { msg.value = t('wfe.failed', { msg: 'no workflow in file' }); inp.value = ''; return; }
  applyWorkflow(wf);
  emit('saved');
  msg.value = t('wfe.imported');
  inp.value = '';
}
```

模板 header 加选择器，XML 页签与按钮文案更换：

```html
      <header class="weh">
        <span class="wtitle">{{ $t('wfe.title') }}</span>
        <select v-if="model.length" v-model="currentId" class="wsel" :title="$t('wfe.current_workflow')">
          <option v-for="w in model" :key="w.id" :value="w.id">{{ w.label }}{{ w.priority ? ' · P' + w.priority : '' }}</option>
        </select>
        <nav class="tabs">...</nav>
        <button class="wex" @click="close">×</button>
      </header>
```

```html
        <WorkflowXmlTab v-if="tab === 'xml'" :workflow="current" @update:workflow="applyWorkflow" />
```

底部按钮：

```html
        <button class="webtn" :disabled="busy" @click="pickFile">{{ $t('wfe.import_workflow') }}</button>
        <button class="webtn" :disabled="busy || !current" @click="exportXml">{{ $t('wfe.export_workflow') }}</button>
```

样式加：

```css
.wsel { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 8px; font-size: 12px; font-family: inherit; max-width: 260px; }
```

- [ ] **Step 3: WorkflowFormTab 显示 priority 徽标**

`web/src/components/WorkflowFormTab.vue` 的 `.wrow` 中，`<input class="in id" ...>` 后加：

```html
        <span v-if="w.priority" class="prio" :title="$t('wfe.priority')">P{{ w.priority }}</span>
```

样式加：

```css
.prio { flex: none; background: var(--bg5); color: var(--tx3); border: 1px solid var(--bd); border-radius: 10px; padding: 1px 8px; font-size: 11px; }
```

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add web/src/components/WorkflowXmlTab.vue web/src/components/WorkflowEditor.vue web/src/components/WorkflowFormTab.vue
git commit -m "feat(workflow): 编辑器按当前工作流单文件导入导出"
```

---

### Task 9: 全量验证与手工验收

- [ ] **Step 1: 全量检查**

Run: `npm.cmd test`
Expected: server + web 全绿

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`

- [ ] **Step 2: 手工验收**

Run: `npm.cmd run dev`（PowerShell `Start-Process` 后台起，日志写 `logs\`），访问 http://localhost:5173。

验收清单：
1. 首次启动后 `<端口数据目录>/workflows/` 生成 `dev.xml`/`test.xml`/`doc.xml`，且 `downloads/devflow.xml` 里 `<workflows>` 段已消失、`server`/`agents` 仍在。
2. 手改某文件 `priority="5"` → 刷新页面，顶栏该工作流按钮排到最前（无需重启后端）。
3. 编辑器「当前工作流」下拉切换；XML 页签只显示该 workflow；「导出当前工作流」下载 `<id>.xml`；「导入工作流文件」按 id 加入/覆盖。
4. 点顶栏某分组 ▶ 运行，确认上一特性的分组执行仍正常（数据源已成 store）。

- [ ] **Step 3: 提交（如修复）**

```bash
git add <改动文件>
git commit -m "fix(workflow): 单文件存储验收修复"
```

---

## Self-Review 记录

- **Spec 覆盖**：存储/迁移（Task 2、5）、priority 语义（Task 1）、排序（Task 1）、编辑器单文件导入导出（Task 8）、端口路径（Task 3）、seed（Task 4）、i18n（Task 6）、前端模型（Task 7）、非目标（未做界面 priority 输入、未保留整份配置入口）。
- **占位符扫描**：无 TBD/TODO；代码步骤含完整代码。
- **类型一致性**：`createWorkflowStore({dir,configFile,seedStore,logger})`、`readAll/writeAll/migrateFromConfigXml`、`sortWorkflows`、`Workflow.priority?`、`WorkflowXmlTab` 的 `workflow`/`update:workflow` 在各 Task 间一致。
- **条件 priority 约定**：Task 1/2/4/7 都只在非 0 时携带 `priority`，避免破坏既有 deep-equal 测试。

## Execution Handoff

按仓库 `AGENTS.md`：**默认 inline 执行**（本会话内执行 executing-plans），不使用 subagent 驱动。
