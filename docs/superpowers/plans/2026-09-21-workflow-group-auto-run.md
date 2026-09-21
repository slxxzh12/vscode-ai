# 工作流分组自动执行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让终端输入框上方按「分组」排列的工作流提示词支持一键整组自动执行，每个提示词有稳定 ID，失败可回退到指定 ID 重跑。

**Architecture:** 复用后端 `WorkflowRunner`（`server/workflow-runner.js`），新增按分组的 `GroupRun`（新文件 `server/workflow-group-run.js`），数据源改为 `loadDevflowConfig(configFile).workflows`。完成判定：prompt 步发送时追加 `DF_DONE:<runId>:<i>` 指令并由服务端匹配 token，cmd 步沿用 OSC 标记。分组 = 暂停边界。前端在 `TerminalView.vue` 的 `flowbar` 每个分组旁加 ▶，chips 上内联状态与 `↺` 回退。

**Tech Stack:** Node ESM + `node:test`；Vue 3 + TS + vitest；WS 协议常量在 `shared/index.js`。

设计文档：`docs/superpowers/specs/2026-09-21-workflow-group-auto-run-design.md`。

---

## File Structure

- Create: `shared/workflow-group.js` — 分组展开与 prompt ID 纯函数（server/web 共用）。
- Create: `shared/workflow-group.d.ts` — 上述模块类型声明。
- Modify: `shared/package.json` — 增加 `./workflow-group` 导出。
- Create: `server/workflow-group-run.js` — `GroupRun` 类（分组运行状态机）。
- Modify: `server/workflow-runner.js` — 构造参数加 `getWorkflows/stepTimeoutMs/doneMarker`；新增 `startGroup()`、`rollback()`。
- Modify: `server/ws-gateway.js` — `WF_RUN` 支持 `groupAnchor`；新增 `WF_ROLLBACK`。
- Modify: `server/index.js` — 装配 `getWorkflows` 与 `doneMarker`。
- Modify: `shared/index.js` + `shared/index.d.ts` — 新增 `C2S.WF_ROLLBACK`。
- Modify: `shared/i18n/zh-CN.js` + `shared/i18n/en.js` — 新增词条。
- Modify: `web/src/components/TerminalView.vue` — ▶/状态/`↺` 与 WS 订阅。
- Create: `server/test/shared-workflow-group.test.js` — 纯函数测试。
- Modify: `server/test/workflow-runner.test.js` — GroupRun 测试。
- Modify: `server/test/ws-gateway-workflow.test.js` — 分组运行 + 回退协议测试。

---

### Task 1: 共享分组展开纯函数

**Files:**
- Create: `shared/workflow-group.js`
- Create: `shared/workflow-group.d.ts`
- Modify: `shared/package.json`
- Test: `server/test/shared-workflow-group.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/shared-workflow-group.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptStepId, expandGroupSteps, groupAnchorStages } from '@devflow/shared/workflow-group';

const STAGES = [
  { id: 'a', label: 'A', group: 'G1', prompts: ['p-a0', 'p-a1'] },
  { id: 'b', label: 'B', group: 'G1', prompts: ['p-b0'] },
  { id: 'c', label: 'C', group: 'G2', prompts: ['p-c0'] },
  { id: 'd', label: 'D', group: '', prompts: ['p-d0'] },
  { id: 'e', label: 'E', group: '', prompts: [] },
];

test('promptStepId 拼接 stageId 与序号', () => {
  assert.equal(promptStepId('a', 0), 'a#0');
  assert.equal(promptStepId('code', 3), 'code#3');
});

test('groupAnchorStages 取连续同名 group', () => {
  const band = groupAnchorStages(STAGES, 'b');
  assert.equal(band.group, 'G1');
  assert.deepEqual(band.stages.map((s) => s.id), ['a', 'b']);
  assert.equal(groupAnchorStages(STAGES, 'ghost'), null);
});

test('expandGroupSteps 摊平为线性步骤并带稳定 ID', () => {
  const out = expandGroupSteps(STAGES, 'a');
  assert.equal(out.group, 'G1');
  assert.deepEqual(out.steps.map((s) => s.id), ['a#0', 'a#1', 'b#0']);
  assert.deepEqual(out.steps.map((s) => s.index), [0, 1, 2]);
  assert.equal(out.steps[0].text, 'p-a0');
  assert.equal(out.steps[0].type, 'prompt');
});

test('expandGroupSteps 空分组返回空 steps', () => {
  const out = expandGroupSteps(STAGES, 'd');   // 与 e 同为空 group
  assert.deepEqual(out.steps.map((s) => s.id), ['d#0']);
});

test('stage type=cmd 时步骤类型为 cmd', () => {
  const stages = [{ id: 'x', label: 'X', group: 'G', type: 'cmd', prompts: ['npm test'] }];
  const out = expandGroupSteps(stages, 'x');
  assert.equal(out.steps[0].type, 'cmd');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/shared-workflow-group.test.js"`
Expected: FAIL（`Cannot find module '@devflow/shared/workflow-group'`）

- [ ] **Step 3: 实现 shared/workflow-group.js**

```js
// 工作流「分组」展开为线性步骤的纯函数（server 与 web 共用）。
// 分组规则与 groupBands 一致：连续同名 group 为一组，未命名（空串）也算一组。

export function promptStepId(stageId, index) {
  return `${stageId}#${index}`;
}

export function groupAnchorStages(stages, anchorStageId) {
  const list = Array.isArray(stages) ? stages : [];
  const start = list.findIndex((s) => s.id === anchorStageId);
  if (start < 0) return null;
  const group = String(list[start].group || '').trim();
  const picked = [];
  for (let i = start; i < list.length; i += 1) {
    if (String(list[i].group || '').trim() !== group) break;
    picked.push(list[i]);
  }
  return { group, stages: picked };
}

export function expandGroupSteps(stages, anchorStageId) {
  const band = groupAnchorStages(stages, anchorStageId);
  if (!band) return null;
  const steps = [];
  for (const st of band.stages) {
    const prompts = Array.isArray(st.prompts) ? st.prompts : [];
    prompts.forEach((text, idx) => {
      steps.push({
        id: promptStepId(st.id, idx),
        stageId: st.id,
        index: steps.length,
        text: String(text),
        type: st.type === 'cmd' ? 'cmd' : 'prompt',
      });
    });
  }
  return { group: band.group, steps };
}
```

- [ ] **Step 4: 创建 shared/workflow-group.d.ts**

```ts
export declare function promptStepId(stageId: string, index: number): string;
export declare function groupAnchorStages(
  stages: unknown[],
  anchorStageId: string,
): { group: string; stages: unknown[] } | null;
export declare function expandGroupSteps(
  stages: unknown[],
  anchorStageId: string,
): {
  group: string;
  steps: Array<{ id: string; stageId: string; index: number; text: string; type: 'cmd' | 'prompt' }>;
} | null;
```

- [ ] **Step 5: 注册导出**

修改 `shared/package.json` 的 `exports`，在 `"./workflow-xml"` 行后加入：

```json
    "./workflow-group": { "types": "./workflow-group.d.ts", "default": "./workflow-group.js" },
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test "server/test/shared-workflow-group.test.js"`
Expected: PASS（5 tests）

- [ ] **Step 7: 提交**

```bash
git add shared/workflow-group.js shared/workflow-group.d.ts shared/package.json server/test/shared-workflow-group.test.js
git commit -m "feat(workflow): 分组展开与 prompt ID 共享纯函数"
```

---

### Task 2: GroupRun 分组运行（完成判定 + 组末暂停）

**Files:**
- Create: `server/workflow-group-run.js`
- Modify: `server/workflow-runner.js`
- Test: `server/test/workflow-runner.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/workflow-runner.test.js` **末尾追加**：

```js
const GWFS = [{
  id: 'gw', label: 'GW', stages: [
    { id: 'a', label: 'A', group: 'G1', prompts: ['p-a0', 'p-a1'] },
    { id: 'b', label: 'B', group: 'G1', prompts: ['p-b0'] },
    { id: 'c', label: 'C', group: 'G2', prompts: ['p-c0'] },
  ],
}];

async function makeGroupRunner({ stepTimeoutMs = 30 * 60 * 1000 } = {}) {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ name: 'G' });
  const runner = new WorkflowRunner({
    sessionManager: sm,
    getWorkflows: () => GWFS,
    stepTimeoutMs,
    doneMarker: (token) => `DONE>${token}`,
  });
  return { sm, instances, session, runner };
}

test('startGroup 展开分组并把完成指令追加到首个提示词', async () => {
  const { session, runner, instances } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  assert.equal(res.ok, true);
  const snap = res.run.snapshot();
  assert.equal(snap.groupName, 'G1');
  assert.deepEqual(snap.steps.map((s) => s.id), ['a#0', 'a#1', 'b#0']);
  assert.equal(snap.steps[0].status, 'running');
  const write = instances[0].pty.writes[0];
  assert.ok(write.startsWith('p-a0'));
  assert.ok(write.includes(`DONE>DF_DONE:${res.run.runId}:0`));
  runner.stopAll();
});

test('匹配 token 后组内自动串行，组末 paused 且不清理', async () => {
  const { session, runner, instances } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  const { runId } = res.run;
  instances[0].pty.__emitData(`DF_DONE:${runId}:0`);
  assert.equal(res.run.snapshot().steps[0].status, 'done');
  assert.equal(res.run.snapshot().steps[1].status, 'running');
  instances[0].pty.__emitData(`DF_DONE:${runId}:1`);
  instances[0].pty.__emitData(`DF_DONE:${runId}:2`);
  assert.equal(res.run.snapshot().status, 'paused');
  assert.ok(res.run.snapshot().steps.every((s) => s.status === 'done'));
  assert.equal(runner.get(runId), res.run);   // paused 不清理，供回退
  runner.stopAll();
});

test('空分组直接 paused 且不写入', async () => {
  const EMPTY = [{ id: 'e', label: 'E', stages: [{ id: 'empty', label: 'X', group: 'G', prompts: [] }] }];
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({});
  const runner = new WorkflowRunner({ sessionManager: sm, getWorkflows: () => EMPTY });
  const res = runner.startGroup({ workflowId: 'e', groupAnchor: 'empty', sessionId: session.id });
  assert.equal(res.ok, true);
  assert.equal(res.run.snapshot().status, 'paused');
  assert.equal(instances[0].pty.writes.length, 0);
  runner.stopAll();
});

test('startGroup 未知分组返回 not-found', async () => {
  const { session, runner } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'ghost', sessionId: session.id });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'not-found');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/workflow-runner.test.js"`
Expected: FAIL（`runner.startGroup is not a function`）

- [ ] **Step 3: 实现 server/workflow-group-run.js**

```js
import crypto from 'node:crypto';
import { buildMarkerCmd } from './pty-runner.js';

const newRunId = () => 'grp_' + crypto.randomBytes(4).toString('hex');

// 分组运行：组内自动串行，组末暂停（暂停边界）。
// status: running | paused | failed | aborted
export class GroupRun {
  constructor(runner, workflow, group, steps, session) {
    this.runner = runner;
    this.runId = newRunId();
    this.workflowId = workflow.id;
    this.workflowName = workflow.label;
    this.groupName = group;
    this.sessionId = session.id;
    this.status = 'running';
    this.currentIndex = 0;
    this.errorMessage = null;
    this.steps = steps;
    this._tail = '';
    this._timer = null;
  }
  snapshot() {
    return {
      runId: this.runId, workflowId: this.workflowId, workflowName: this.workflowName,
      groupName: this.groupName, sessionId: this.sessionId, status: this.status,
      currentIndex: this.currentIndex, steps: this.steps, errorMessage: this.errorMessage,
    };
  }
  _emit() { this.runner._emit(this); }
  _current() { return this.steps[this.currentIndex] || null; }
  _marker(i) { return `\x1b]777;dfdone;${this.runId}_${i}\x07`; }
  _token(i) { return `DF_DONE:${this.runId}:${i}`; }

  _beginStep(i) {
    const step = this.steps[i];
    if (!step) { this._finishGroup(); return; }
    step.status = 'running';
    step.startedAt = Date.now();
    this.status = 'running';
    const session = this.runner.sm.get(this.sessionId);
    if (!session || !session.alive) { this._fail('session exited'); return; }
    let line = step.text;
    if (step.type === 'cmd') line = buildMarkerCmd(step.text, this.runId, i, session.pty.shell);
    else line = `${step.text}\n\n${this.runner.doneMarker(this._token(i))}`;
    const ok = this.runner.sm.write(this.sessionId, line + '\r');
    if (!ok) { this._fail('write failed'); return; }
    this._armTimeout();
    this._emit();
  }
  _armTimeout() {
    this._clearTimeout();
    this._timer = setTimeout(() => this._fail('step timeout'), this.runner.stepTimeoutMs);
    this._timer.unref?.();
  }
  _clearTimeout() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } }
  _succeedStep(i) {
    const step = this.steps[i];
    step.status = 'done';
    step.finishedAt = Date.now();
    this._clearTimeout();
    this._tail = '';
    this.currentIndex += 1;
    if (this.currentIndex < this.steps.length) this._beginStep(this.currentIndex);
    else this._finishGroup();
  }
  _finishGroup() {
    this._clearTimeout();
    this.status = 'paused';
    this._emit();
  }
  _fail(msg) {
    this._clearTimeout();
    this.errorMessage = msg;
    this.status = 'failed';
    const step = this._current();
    if (step && step.status !== 'done') step.status = 'error';
    this._emit();
  }
  onData(session, chunk) {
    if (session.id !== this.sessionId) return;
    if (this.status !== 'running') return;
    const step = this._current();
    if (!step) return;
    this._tail = (this._tail + chunk).slice(-256);
    const needle = step.type === 'cmd' ? this._marker(this.currentIndex) : this._token(this.currentIndex);
    if (this._tail.includes(needle)) this._succeedStep(this.currentIndex);
  }
  rollback(stepId) {
    const idx = this.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return false;
    this._clearTimeout();
    for (let i = idx; i < this.steps.length; i += 1) {
      this.steps[i].status = 'waiting';
      this.steps[i].startedAt = null;
      this.steps[i].finishedAt = null;
    }
    this.errorMessage = null;
    this.currentIndex = idx;
    this._beginStep(idx);
    return true;
  }
  advance() {
    if (!this._current()) return;
    this._succeedStep(this.currentIndex);
  }
  abort() {
    this._clearTimeout();
    const step = this._current();
    if (step && step.status !== 'done') step.status = 'error';
    this.status = 'aborted';
    this.errorMessage = this.errorMessage || 'aborted by user';
    this._emit();
  }
}
```

- [ ] **Step 4: 在 server/workflow-runner.js 中接入**

在文件顶部加入 import：

```js
import { expandGroupSteps } from '@devflow/shared/workflow-group';
import { GroupRun } from './workflow-group-run.js';
```

构造函数改为（保留 `workflows` 兼容旧路径）：

```js
  constructor({ sessionManager, workflows = [], getWorkflows = null, stepTimeoutMs = 30 * 60 * 1000, doneMarker = null, logger = console }) {
    this.sm = sessionManager;
    this.workflows = workflows;
    this.getWorkflows = getWorkflows;
    this.stepTimeoutMs = stepTimeoutMs;
    this.doneMarker = doneMarker || ((token) => `[DevFlow] When finished, output a single line at the end: ${token}`);
    this.log = logger;
```

在 `start()` 方法之后新增：

```js
  startGroup({ workflowId, groupAnchor, sessionId }) {
    const wfs = this.getWorkflows ? this.getWorkflows() : [];
    const wf = wfs.find((w) => w.id === workflowId);
    if (!wf) return { ok: false, code: 'not-found', message: 'workflow not found' };
    const expanded = expandGroupSteps(wf.stages || [], groupAnchor);
    if (!expanded) return { ok: false, code: 'not-found', message: 'group not found' };
    const session = this.sm.get(sessionId);
    if (!session) return { ok: false, code: 'not-found', message: 'session not found' };
    if (session.state !== 'running') return { ok: false, code: 'session-not-running', message: 'session not running' };
    const prevId = this._sessionRun.get(sessionId);
    if (prevId) { const prev = this.runs.get(prevId); if (prev) { try { prev.abort(); } catch { /* noop */ } } }
    const steps = expanded.steps.map((s) => ({ ...s, status: 'waiting', startedAt: null, finishedAt: null }));
    const run = new GroupRun(this, wf, expanded.group, steps, session);
    this.runs.set(run.runId, run);
    this._sessionRun.set(sessionId, run.runId);
    if (steps.length) run._beginStep(0);
    else run._finishGroup();
    return { ok: true, run };
  }
  rollback(runId, stepId) {
    const run = this.runs.get(runId);
    if (!run || typeof run.rollback !== 'function') return false;
    return run.rollback(stepId);
  }
```

> `_maybeCleanup` 只在 `status==='done'||'aborted'` 时清理；GroupRun 终态是 `paused`/`failed`，不会被清理，故暂停后仍可回退。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test "server/test/workflow-runner.test.js"`
Expected: PASS（原有 12 + 新增 4；全部通过）

- [ ] **Step 6: 提交**

```bash
git add server/workflow-group-run.js server/workflow-runner.js server/test/workflow-runner.test.js
git commit -m "feat(workflow): 分组运行 GroupRun（token 判定 + 组末暂停）"
```

---

### Task 3: GroupRun 失败判定与回退

**Files:**
- Modify: `server/test/workflow-runner.test.js`（只加测试；实现已在 Task 2 覆盖）

- [ ] **Step 1: 追加失败/回退测试**

在 `server/test/workflow-runner.test.js` 末尾追加：

```js
test('超时未完成 → 该步 error、run failed', async () => {
  const { session, runner } = await makeGroupRunner({ stepTimeoutMs: 20 });
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  await new Promise((r) => setTimeout(r, 50));
  const snap = res.run.snapshot();
  assert.equal(snap.status, 'failed');
  assert.equal(snap.steps[0].status, 'error');
  assert.equal(snap.errorMessage, 'step timeout');
  runner.stopAll();
});

test('会话退出 → run failed 且该步 error', async () => {
  const { session, runner, instances } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  instances[0].pty.__emitExit(1);
  assert.equal(res.run.snapshot().status, 'failed');
  assert.equal(res.run.snapshot().steps[0].status, 'error');
  runner.stopAll();
});

test('rollback 重置目标步及之后并从该步重跑', async () => {
  const { session, runner, instances } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  const { runId } = res.run;
  instances[0].pty.__emitData(`DF_DONE:${runId}:0`);
  instances[0].pty.__emitData(`DF_DONE:${runId}:1`);
  instances[0].pty.__emitData(`DF_DONE:${runId}:2`);
  const writesBefore = instances[0].pty.writes.length;
  const ok = runner.rollback(runId, 'a#1');
  assert.equal(ok, true);
  const snap = res.run.snapshot();
  assert.equal(snap.status, 'running');
  assert.equal(snap.steps[0].status, 'done');       // 回退点之前不受影响
  assert.equal(snap.steps[1].status, 'running');    // 从回退点重跑
  assert.equal(snap.steps[2].status, 'waiting');
  assert.equal(instances[0].pty.writes.length, writesBefore + 1);
  assert.ok(instances[0].pty.writes[writesBefore].startsWith('p-a1'));
  runner.stopAll();
});

test('rollback 未知 stepId 返回 false', async () => {
  const { session, runner } = await makeGroupRunner();
  const res = runner.startGroup({ workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  assert.equal(runner.rollback(res.run.runId, 'nope#9'), false);
  runner.stopAll();
});
```

- [ ] **Step 2: 运行测试确认通过（实现已在 Task 2）**

Run: `node --test "server/test/workflow-runner.test.js"`
Expected: PASS（全部）

- [ ] **Step 3: 提交**

```bash
git add server/test/workflow-runner.test.js
git commit -m "test(workflow): 分组运行失败判定与回退用例"
```

---

### Task 4: WS 协议 + 网关（groupAnchor / WF_ROLLBACK）

**Files:**
- Modify: `shared/index.js`
- Modify: `shared/index.d.ts`
- Modify: `server/ws-gateway.js`
- Test: `server/test/ws-gateway-workflow.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/ws-gateway-workflow.test.js` 末尾追加：

```js
const GWFS = [{ id: 'gw', label: 'GW', stages: [
  { id: 'a', label: 'A', group: 'G1', prompts: ['p-a0', 'p-a1'] },
  { id: 'b', label: 'B', group: 'G1', prompts: ['p-b0'] },
] }];

async function groupHarness() {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ name: 'G' });
  const runner = new WorkflowRunner({
    sessionManager: sm, getWorkflows: () => GWFS, doneMarker: (token) => `DONE>${token}`,
  });
  const t = await startTestServer({ sessionManager: sm, workflowRunner: runner });
  return { sm, session, runner, t, instances };
}

test('端到端: groupAnchor 启动分组并收到 wf-started/status', async (t) => {
  const { session, t: ts, instances } = await groupHarness();
  const c = await ts.connect();
  t.after(() => ts.stop());
  c.send(C2S.WF_RUN, { workflowId: 'gw', groupAnchor: 'a', sessionId: session.id });
  const started = await c.wait((m) => m.type === S2C.WF_STARTED);
  assert.equal(started.run.groupName, 'G1');
  assert.deepEqual(started.run.steps.map((s) => s.id), ['a#0', 'a#1', 'b#0']);

  instances[0].pty.__emitData(`DF_DONE:${started.run.runId}:0`);
  await c.wait((m) => m.type === S2C.WF_STATUS && m.run.steps[0].status === 'done');

  c.send(C2S.WF_ROLLBACK, { runId: started.run.runId, stepId: 'a#1' });
  const rb = await c.wait((m) => m.type === S2C.WF_STATUS && m.run.steps[1].status === 'running');
  assert.equal(rb.run.steps[0].status, 'done');

  c.send(C2S.WF_ROLLBACK, { runId: started.run.runId, stepId: 'nope#0' });
  const err = await c.wait((m) => m.type === S2C.ERROR);
  assert.equal(err.code, 'not-found');
  c.close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/ws-gateway-workflow.test.js"`
Expected: FAIL（`C2S.WF_ROLLBACK` undefined / 未处理）

- [ ] **Step 3: 新增协议常量**

修改 `shared/index.js` 的 `C2S`：

```js
  WF_LIST: 'wf-list', WF_RUN: 'wf-run', WF_NEXT: 'wf-next', WF_ABORT: 'wf-abort',
  WF_ROLLBACK: 'wf-rollback',
```

修改 `shared/index.d.ts` 的对应声明：

```ts
  WF_LIST: 'wf-list'; WF_RUN: 'wf-run'; WF_NEXT: 'wf-next'; WF_ABORT: 'wf-abort';
  WF_ROLLBACK: 'wf-rollback';
```

- [ ] **Step 4: 网关支持分组与回退**

修改 `server/ws-gateway.js` 的 `handleWorkflow`：把 `WF_RUN` 分支改为：

```js
      case C2S.WF_RUN: {
        const res = msg.groupAnchor
          ? workflowRunner.startGroup({ workflowId: msg.workflowId, groupAnchor: msg.groupAnchor, sessionId: msg.sessionId })
          : workflowRunner.start(msg.workflowId, msg.sessionId);
        if (!res.ok) { conn.send({ type: S2C.ERROR, code: res.code, message: res.message }); break; }
        workflowRunner.attachConn(res.run.runId, conn);
        conn.send({ type: S2C.WF_STARTED, run: res.run.snapshot() });
        conn.send({ type: S2C.WF_STATUS, run: res.run.snapshot() });
        break;
      }
```

在 `WF_ABORT` 分支之后新增：

```js
      case C2S.WF_ROLLBACK: {
        const ok = workflowRunner.rollback(msg.runId, msg.stepId);
        if (!ok) { conn.send({ type: S2C.ERROR, code: 'not-found', message: 'run or step not found' }); break; }
        const run = workflowRunner.get(msg.runId);
        conn.send({ type: S2C.WF_STATUS, run: run.snapshot() });
        break;
      }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test "server/test/ws-gateway-workflow.test.js"`
Expected: PASS（原有 2 + 新增 1）

- [ ] **Step 6: 提交**

```bash
git add shared/index.js shared/index.d.ts server/ws-gateway.js server/test/ws-gateway-workflow.test.js
git commit -m "feat(workflow): WS 协议支持分组运行与回退"
```

---

### Task 5: 服务端装配（数据源 + 完成指令 i18n）

**Files:**
- Modify: `server/index.js:363`

- [ ] **Step 1: 修改装配**

把 `server/index.js` 的：

```js
  const workflowRunner = new WorkflowRunner({ sessionManager, workflows, logger: log });
```

改为：

```js
  const workflowRunner = new WorkflowRunner({
    sessionManager,
    workflows,
    getWorkflows: () => loadDevflowConfig(configFile).workflows,
    doneMarker: (token) => t('wf.done_marker', { token }),
    logger: log,
  });
```

`t` 已在 `server/index.js:50` 从 `./i18n.js` 导入，无需新增 import。

- [ ] **Step 2: 加 i18n 词条（Task 6 提供键值）**

先完成 Task 6 的 `wf.done_marker`，否则此处 `t()` 回退为 key（不报错但不达预期）。

- [ ] **Step 3: 冒烟验证**

Run: `node --test "server/test/ws-gateway.test.js" "server/test/workflow-runner.test.js"`
Expected: PASS（无回归）

- [ ] **Step 4: 提交**

```bash
git add server/index.js
git commit -m "feat(workflow): 装配分组运行数据源与完成指令"
```

---

### Task 6: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 加中文词条**

在 `shared/i18n/zh-CN.js` 中加入（与现有 `wf.*` 放在一起）：

```js
  'wf.group.run': '运行本组',
  'wf.group.stop': '中止本组运行',
  'wf.step.rollback': '回退到该步并重跑',
  'wf.step.pending': '等待',
  'wf.step.running': '运行中',
  'wf.step.done': '完成',
  'wf.step.error': '失败',
  'wf.done_marker': '[DevFlow] 完成后请在最后单独输出一行：DF_DONE:{token}',
```

- [ ] **Step 2: 加英文词条**

在 `shared/i18n/en.js` 加入（键集合必须与中文对称）：

```js
  'wf.group.run': 'Run this group',
  'wf.group.stop': 'Stop this group run',
  'wf.step.rollback': 'Roll back to this step and rerun',
  'wf.step.pending': 'Waiting',
  'wf.step.running': 'Running',
  'wf.step.done': 'Done',
  'wf.step.error': 'Failed',
  'wf.done_marker': '[DevFlow] When finished, output a single line at the end: DF_DONE:{token}',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: 零命中（退出码 0）

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 工作流分组运行与回退词条"
```

---

### Task 7: 前端 ▶ / 状态 / 回退

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 补 import**

把第 6 行：

```ts
import { S2C } from '@devflow/shared';
```

改为：

```ts
import { C2S, S2C } from '@devflow/shared';
import { promptStepId } from '@devflow/shared/workflow-group';
```

- [ ] **Step 2: 加运行状态与逻辑**

在 `web/src/components/TerminalView.vue` 的 `onChipClick`（约 `:717`）**之前**插入：

```ts
// —— 分组自动执行：run 状态与回退 ——
interface WfRunStep { id: string; stageId: string; status: string; }
interface WfRunSnap { runId: string; workflowId: string; groupName: string; status: string; currentIndex: number; steps: WfRunStep[]; }
const wfRun = ref<WfRunSnap | null>(null);
const wfAnchor = ref<string>('');
const wfStepStatus = computed(() => {
  const m = new Map<string, string>();
  for (const s of wfRun.value?.steps || []) m.set(s.id, s.status);
  return m;
});
const wfUnsubs: Array<() => void> = [
  props.terminal.on(S2C.WF_STARTED, (m: any) => { wfRun.value = m.run; }),
  props.terminal.on(S2C.WF_STATUS, (m: any) => { wfRun.value = m.run; }),
  props.terminal.on(S2C.WF_FINISHED, () => { wfRun.value = null; wfAnchor.value = ''; }),
];
function groupRunning(anchor: string): boolean { return wfAnchor.value === anchor && wfRun.value?.status === 'running'; }
function startGroupRun(anchor: string) {
  const sid = props.terminal.state.activeSessionId;
  if (!sid || !activeIsAgent.value) return;
  wfRun.value = null;
  wfAnchor.value = anchor;
  props.terminal.send(C2S.WF_RUN, { workflowId: wfKind.value, groupAnchor: anchor, sessionId: sid });
}
function stopGroupRun() {
  if (wfRun.value) props.terminal.send(C2S.WF_ABORT, { runId: wfRun.value.runId });
  wfRun.value = null;
  wfAnchor.value = '';
}
function rollbackStep(stepId: string) {
  if (stepId && wfRun.value) props.terminal.send(C2S.WF_ROLLBACK, { runId: wfRun.value.runId, stepId });
}
function activeStageDef() { return curWf.value.stages.find((s) => s.id === activeStage.value) || curWf.value.stages[0] || null; }
function chipStepId(c: Chip): string {
  const st = activeStageDef();
  if (!st) return '';
  const idx = (st.prompts || []).findIndex((p) => String(p).trim() === c.text);
  return idx >= 0 ? promptStepId(st.id, idx) : '';
}
function chipStatus(c: Chip): string { const id = chipStepId(c); return id ? (wfStepStatus.value.get(id) || '') : ''; }
function chipRetryable(c: Chip): boolean { const s = chipStatus(c); return s === 'error' || s === 'done'; }
function stageStatus(s: StageDef): string {
  const list = (s.prompts || []).map((_, i) => wfStepStatus.value.get(promptStepId(s.id, i)) || '');
  if (!list.length) return '';
  if (list.includes('running')) return 'running';
  if (list.includes('error')) return 'error';
  if (list.every((x) => x === 'done')) return 'done';
  return '';
}
function stageIcon(st: string): string { return st === 'running' ? '▶' : st === 'done' ? '✓' : st === 'error' ? '✕' : ''; }
watch(() => props.terminal.state.activeSessionId, () => { wfRun.value = null; wfAnchor.value = ''; });
```

- [ ] **Step 3: 清理订阅**

在 `onBeforeUnmount`（约 `:1040`）的 `unsubList?.();` 之前加：

```ts
  for (const u of wfUnsubs) u();
```

- [ ] **Step 4: 模板加 ▶ 与阶段状态**

把 `flowbar` 的 `.fgroup`（约 `:1213`）替换为：

```html
            <div class="fgroup">
              <button
                class="gplay"
                :class="{ stop: groupRunning(g.stages[0].id) }"
                :title="groupRunning(g.stages[0].id) ? $t('wf.group.stop') : $t('wf.group.run')"
                @mousedown.stop
                @click.stop="groupRunning(g.stages[0].id) ? stopGroupRun() : startGroupRun(g.stages[0].id)"
              >{{ groupRunning(g.stages[0].id) ? '■' : '▶' }}</button>
              <span v-if="g.name" class="fglabel">{{ g.name }}</span>
              <template v-for="(s, i) in g.stages" :key="s.id">
                <button class="stage" :class="{ on: activeStage === s.id }" @click="pickStage(s)">{{ s.label }}<span v-if="stageStatus(s)" class="stic" :class="stageStatus(s)">{{ stageIcon(stageStatus(s)) }}</span></button>
                <span v-if="i < g.stages.length - 1" class="flowline" />
              </template>
            </div>
```

- [ ] **Step 5: 模板加 chip 状态与 ↺**

把 `chipbar` 的 `stageChips` 渲染（约 `:1226`）替换为：

```html
          <div class="chipstage">
            <span v-for="(c, i) in stageChips" :key="i" class="chipwrap">
              <button
                class="chip"
                :class="[{ on: composerText === c.text }, chipStatus(c)]"
                :title="c.text"
                @click="onChipClick(c)"
              ><span class="cdot" />{{ chipText(c.text) }}<span v-if="stageIcon(chipStatus(c))" class="stic">{{ stageIcon(chipStatus(c)) }}</span></button>
              <button v-if="chipRetryable(c)" class="rback" :title="$t('wf.step.rollback')" @mousedown.stop @click.stop="rollbackStep(chipStepId(c))">↺</button>
            </span>
          </div>
```

- [ ] **Step 6: 加样式**

在 `<style scoped>` 中（`.fgroup` 相关样式附近）加：

```css
.fgroup .gplay { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 0 5px; cursor: pointer; font-size: 10px; line-height: 16px; }
.fgroup .gplay.stop { color: var(--err); border-color: var(--err); }
.stic { margin-left: 3px; font-size: 10px; }
.stic.done { color: var(--ok); }
.stic.error { color: var(--err); }
.chipwrap { display: inline-flex; align-items: center; gap: 2px; }
.chip.done { color: var(--ok); }
.chip.error { color: var(--err); }
.rback { background: none; border: none; color: var(--warn2); cursor: pointer; font-size: 11px; padding: 0 2px; }
```

- [ ] **Step 7: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误

- [ ] **Step 8: 提交**

```bash
git add web/src/components/TerminalView.vue
git commit -m "feat(workflow): 输入框分组 ▶ 启动、内联状态与失败回退"
```

---

### Task 8: 全量验证与手工验收

- [ ] **Step 1: 全量测试与检查**

Run: `npm.cmd test`
Expected: server + web 全绿

Run: `npm.cmd run typecheck`
Expected: 无错误

Run: `npm.cmd run check:i18n`
Expected: 零命中

- [ ] **Step 2: 手工验收**

Run: `npm.cmd run dev`（PowerShell `Start-Process` 后台起，日志写 `logs\`），访问 http://localhost:5173。

验收清单：
1. 打开一个 Agent 会话，输入框上方每个分组旁出现 ▶。
2. 点某分组 ▶：组内提示词依次发送，每个 prompt 末尾带 `DF_DONE:<runId>:<i>` 指令；chip 状态 ▶ → ✓；组末停下，全部 ✓。
3. 点下一组 ▶：上一组状态清空，新组开始运行。
4. 运行中点 ■：中止，状态清空。
5. 制造失败（如关掉会话/等超时）：失败步 ✕，chip 旁出现 ↺；点 ↺ → 从该步重跑。
6. 不同工作流切换（顶栏工作流按钮）后 ▶ 仍指向当前工作流。

- [ ] **Step 3: 提交（如验收中修复）**

```bash
git add <改动文件>
git commit -m "fix(workflow): 分组运行验收修复"
```

---

## Self-Review 记录

- **Spec 覆盖**：数据源/ID（Task 1、5）、完成判定（Task 2）、失败/回退（Task 3）、分组边界（Task 2）、WS 协议（Task 4）、i18n（Task 6）、前端 ▶/状态/↺（Task 7）、非目标（未实现持久化/跨组连跑/关键词匹配，符合 spec 第 11 节）。
- **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性**：`startGroup({workflowId, groupAnchor, sessionId})`、`rollback(runId, stepId)`、`snapshot().steps[].id/status/stageId`、`promptStepId`、`expandGroupSteps` 在各 Task 间命名一致。

## Execution Handoff

按仓库 `AGENTS.md`：**默认 inline 执行**（本会话内执行 executing-plans），不使用 subagent 驱动，无需就执行方式提问。
