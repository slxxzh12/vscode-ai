# 工作流定时功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有「定时任务」中新增 `workflow` 任务类型：到点自动新建 agent 会话，在其中顺序执行整条工作流的全部 prompt 步骤，并复用现有运行记录/日志与界面。

**Architecture:** `scheduler/engine` 对 `workflow` 类型改为调用注入的 `workflow-executor`（不 spawn 进程）。执行器新建会话后调用 `WorkflowRunner.startAll`（用新的 `expandAllSteps` 把全部 stage 的 prompts 拍平），`GroupRun` 以 `finalStatus: 'done'` 串行执行；运行状态经 `onStatus` 回写 scheduler run。没有绑定连接的运行（定时触发）由 gateway 广播进度。

**Tech Stack:** Node ESM、`node:test`、Vue3 + TS、Vitest、Element Plus（无独立 UI 库改动）。

**依赖前提：** 本计划在「Navicat 小工具」相关改动之上；`server/package.json` 与 `web/src/App.vue`、`web/src/scheduler/*` 以当前工作区为准。

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `shared/workflow-group.js` | 新增 `expandAllSteps(stages)` 纯函数 | 改 |
| `server/workflow-group-run.js` | `GroupRun` 支持 `finalStatus` 与 manual 暂停 | 改 |
| `server/workflow-runner.js` | 新增 `startAll`、`onStatus` 返回退订 | 改 |
| `shared/scheduler.d.ts` | 任务/运行类型加 workflow/paused/sessionId | 改 |
| `server/scheduler/store.js` | 类型校验与字段构建支持 workflow | 改 |
| `server/scheduler/manifest.js` | manifest 读写 workflow 字段 | 改 |
| `server/scheduler/engine.js` | 注入并分派 workflowExecutor | 改 |
| `server/scheduler/workflow-executor.js` | 建会话 + 启动工作流 + 状态回写 | 新增 |
| `server/scheduler/index.js` | 透传 workflowExecutor | 改 |
| `server/index.js` | 构造并注入执行器 | 改 |
| `server/ws-gateway.js` | 无绑定连接时广播工作流状态 | 改 |
| `web/src/scheduler/useScheduler.ts` | 类型联合加 workflow | 改 |
| `web/src/scheduler/format.ts` | 类型/状态标签 | 改 |
| `web/src/scheduler/SchedulerView.vue` | 表单 + 列表 + 运行记录 | 改 |
| `web/src/App.vue` | `openLiveSession` + 传 prop | 改 |
| `shared/i18n/zh-CN.js`、`shared/i18n/en.js` | 新词条 | 改 |

---

## Task 1: `expandAllSteps` 纯函数

**Files:**
- Modify: `shared/workflow-group.js`
- Test: `server/test/shared-workflow-group.test.js`

- [ ] **Step 1: 追加失败测试**

在 `server/test/shared-workflow-group.test.js` 顶部 import 改为：

```js
import { promptStepId, expandGroupSteps, groupAnchorStages, expandAllSteps } from '@devflow/shared/workflow-group';
```

文件末尾追加：

```js
test('expandAllSteps 展开全部 stage 的 prompts（跨分组、顺序、带 type/advance）', () => {
  const stages = [
    { id: 'a', label: 'A', group: 'G1', prompts: ['p-a0', 'p-a1'] },
    { id: 'b', label: 'B', group: 'G1', prompts: ['p-b0'] },
    { id: 'c', label: 'C', group: 'G2', type: 'cmd', prompts: ['npm test'] },
    { id: 'd', label: 'D', group: '', advance: 'manual', prompts: ['p-d0'] },
  ];
  const steps = expandAllSteps(stages);
  assert.deepEqual(steps.map((s) => s.id), ['a#0', 'a#1', 'b#0', 'c#0', 'd#0']);
  assert.deepEqual(steps.map((s) => s.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(steps.map((s) => s.type), ['prompt', 'prompt', 'prompt', 'cmd', 'prompt']);
  assert.deepEqual(steps.map((s) => s.advance), ['auto', 'auto', 'auto', 'auto', 'manual']);
  assert.equal(steps[2].text, 'p-b0');
  assert.equal(steps[4].stageId, 'd');
});

test('expandAllSteps 空/缺省返回空数组', () => {
  assert.deepEqual(expandAllSteps([]), []);
  assert.deepEqual(expandAllSteps(undefined), []);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/shared-workflow-group.test.js"`
Expected: FAIL，`expandAllSteps is not a function`。

- [ ] **Step 3: 实现**

在 `shared/workflow-group.js` 末尾（`expandGroupSteps` 之后）追加：

```js
// 整条工作流：把全部 stage 的 prompts 拍平成线性步骤（定时运行用）
export function expandAllSteps(stages) {
  const list = Array.isArray(stages) ? stages : [];
  const steps = [];
  for (const st of list) {
    const prompts = Array.isArray(st.prompts) ? st.prompts : [];
    prompts.forEach((text, idx) => {
      steps.push({
        id: promptStepId(st.id, idx),
        stageId: st.id,
        index: steps.length,
        text: String(text),
        type: st.type === 'cmd' ? 'cmd' : 'prompt',
        advance: st.advance === 'manual' ? 'manual' : 'auto',
      });
    });
  }
  return steps;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/shared-workflow-group.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add shared/workflow-group.js server/test/shared-workflow-group.test.js
git commit -m "feat(workflow): expandAllSteps 展开整条工作流步骤"
```

---

## Task 2: `GroupRun` 收尾状态 + `WorkflowRunner.startAll`

**Files:**
- Modify: `server/workflow-group-run.js`
- Modify: `server/workflow-runner.js`
- Test: `server/test/workflow-runner.test.js`

- [ ] **Step 1: 追加失败测试**

在 `server/test/workflow-runner.test.js` 顶部 import 追加 `expandAllSteps`（若不需要可省略），并在文件末尾追加：

```js
const ALLWFS = [{
  id: 'all', label: 'ALL', stages: [
    { id: 's1', label: 'S1', group: 'G1', prompts: ['p-1'] },
    { id: 's2', label: 'S2', group: 'G2', prompts: ['p-2', 'p-3'] },
  ],
}];

async function makeAllRunner() {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ name: 'ALL' });
  const runner = new WorkflowRunner({
    sessionManager: sm,
    getWorkflows: () => ALLWFS,
    doneMarker: (token) => `DONE>${token}`,
  });
  return { sm, instances, session, runner };
}

test('startAll 展开全部 stage 并全自动跑到 done', async () => {
  const { session, runner, instances } = await makeAllRunner();
  const res = runner.startAll({ workflowId: 'all', sessionId: session.id });
  assert.equal(res.ok, true);
  const snap = res.run.snapshot();
  assert.deepEqual(snap.steps.map((s) => s.id), ['s1#0', 's2#0', 's2#1']);
  assert.equal(snap.groupName, 'ALL');
  assert.equal(snap.steps[0].status, 'running');
  const { runId } = res.run;
  instances[0].pty.__emitData(`DONE>DF_DONE:${runId}:0`);
  assert.equal(res.run.snapshot().steps[1].status, 'running');
  instances[0].pty.__emitData(`DONE>DF_DONE:${runId}:1`);
  instances[0].pty.__emitData(`DONE>DF_DONE:${runId}:2`);
  assert.equal(res.run.snapshot().status, 'done');
  assert.ok(res.run.snapshot().steps.every((s) => s.status === 'done'));
  assert.equal(runner.get(runId), null);   // done 已清理
  runner.stopAll();
});

test('startAll 未知 workflow / 会话不存在返回 not-found', async () => {
  const { session, runner } = await makeAllRunner();
  assert.equal(runner.startAll({ workflowId: 'ghost', sessionId: session.id }).code, 'not-found');
  assert.equal(runner.startAll({ workflowId: 'all', sessionId: 'ghost' }).code, 'not-found');
  runner.stopAll();
});

test('startAll 遇 advance=manual 步在该步后 paused，advance 续跑到 done', async () => {
  const W = [{ id: 'm', label: 'M', stages: [
    { id: 'x', label: 'X', group: '', advance: 'manual', prompts: ['p-x'] },
    { id: 'y', label: 'Y', group: '', prompts: ['p-y'] },
  ] }];
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({});
  const runner = new WorkflowRunner({ sessionManager: sm, getWorkflows: () => W, doneMarker: (token) => `DONE>${token}` });
  const res = runner.startAll({ workflowId: 'm', sessionId: session.id });
  const { runId } = res.run;
  instances[0].pty.__emitData(`DONE>DF_DONE:${runId}:0`);
  assert.equal(res.run.snapshot().status, 'paused');
  assert.equal(res.run.snapshot().steps[0].status, 'done');
  assert.equal(res.run.snapshot().steps[1].status, 'waiting');
  res.run.advance();
  assert.equal(res.run.snapshot().steps[1].status, 'running');
  instances[0].pty.__emitData(`DONE>DF_DONE:${runId}:1`);
  assert.equal(res.run.snapshot().status, 'done');
  runner.stopAll();
});

test('onStatus 返回退订函数', async () => {
  const { runner } = await makeAllRunner();
  const off = runner.onStatus(() => {});
  assert.equal(typeof off, 'function');
  off();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/workflow-runner.test.js"`
Expected: FAIL，`runner.startAll is not a function`。

- [ ] **Step 3: 改 `server/workflow-group-run.js`**

把构造函数首行改为带 `finalStatus`：

```js
  constructor(runner, workflow, group, steps, session, finalStatus = 'paused') {
```

在其 `this._timer = null;` 下一行加：

```js
    this.finalStatus = finalStatus;
```

把 `_succeedStep`、`_finishGroup`、`advance` 三个方法整体替换为：

```js
  _succeedStep(i) {
    const step = this.steps[i];
    step.status = 'done';
    step.finishedAt = Date.now();
    this._clearTimeout();
    this._tail = '';
    this.currentIndex += 1;
    if (step.advance === 'manual') { this.status = 'paused'; this._emit(); return; }
    if (this.currentIndex < this.steps.length) this._beginStep(this.currentIndex);
    else this._finishGroup();
  }
  _finishGroup() {
    this._clearTimeout();
    this.status = this.finalStatus;
    this._emit();
  }
  advance() {
    const cur = this._current();
    if (cur && cur.status === 'waiting') { this._beginStep(this.currentIndex); return; }
    if (cur) { this._succeedStep(this.currentIndex); return; }
    this._finishGroup();
  }
```

- [ ] **Step 4: 改 `server/workflow-runner.js`**

顶部 import 改为：

```js
import { expandGroupSteps, expandAllSteps } from '@devflow/shared/workflow-group';
```

在 `startGroup` 方法之后（`rollback` 之前）插入 `startAll`：

```js
  startAll({ workflowId, sessionId, finalStatus = 'done' }) {
    const wfs = this.getWorkflows ? this.getWorkflows() : [];
    const wf = wfs.find((w) => w.id === workflowId);
    if (!wf) return { ok: false, code: 'not-found', message: 'workflow not found' };
    const session = this.sm.get(sessionId);
    if (!session) return { ok: false, code: 'not-found', message: 'session not found' };
    if (session.state !== 'running') return { ok: false, code: 'session-not-running', message: 'session not running' };
    const prevId = this._sessionRun.get(sessionId);
    if (prevId) { const prev = this.runs.get(prevId); if (prev) { try { prev.abort(); } catch { /* noop */ } } }
    const steps = expandAllSteps(wf.stages || []).map((s) => ({ ...s, status: 'waiting', startedAt: null, finishedAt: null }));
    const run = new GroupRun(this, { id: wf.id, label: wf.label }, wf.label, steps, session, finalStatus);
    this.runs.set(run.runId, run);
    this._sessionRun.set(sessionId, run.runId);
    if (steps.length) run._beginStep(0);
    else run._finishGroup();
    return { ok: true, run };
  }
```

把 `onStatus` 方法替换为（返回退订）：

```js
  onStatus(cb) {
    this._statusCbs.push(cb);
    return () => { const i = this._statusCbs.indexOf(cb); if (i >= 0) this._statusCbs.splice(i, 1); };
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test "server/test/workflow-runner.test.js" "server/test/shared-workflow-group.test.js"`
Expected: PASS（含既有 group 用例不回归）。

- [ ] **Step 6: Commit**

```bash
git add server/workflow-group-run.js server/workflow-runner.js server/test/workflow-runner.test.js
git commit -m "feat(workflow): WorkflowRunner.startAll 整条工作流自动执行"
```

---

## Task 3: 类型定义、store 与 manifest 支持 workflow

**Files:**
- Modify: `shared/scheduler.d.ts`
- Modify: `server/scheduler/store.js`
- Modify: `server/scheduler/manifest.js`
- Test: `server/test/scheduler-store.test.js`、`server/test/scheduler-manifest.test.js`

- [ ] **Step 1: 改 `shared/scheduler.d.ts`**

```ts
export type RunStatus = 'running' | 'success' | 'failed' | 'timeout' | 'killed' | 'paused';

export interface SchedulerTask {
  id: string;
  name: string;
  enabled: boolean;
  projectId: string | null;
  cwd: string | null;
  type: 'shell' | 'ai' | 'script' | 'workflow';
  filePath?: string | null;
  command?: string;
  ai?: { source: 'command' | 'prompt' | 'file'; commandName?: string; prompt?: string };
  script?: { path: string };
  workflow?: { workflowId: string; agentId: string };
  schedule: Schedule;
  createdAt: number;
  updatedAt: number;
}

export interface SchedulerRun {
  id: string;
  taskId: string;
  status: RunStatus;
  trigger: 'schedule' | 'manual';
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  durationMs: number | null;
  logFile: string;
  error: string | null;
  sessionId?: string | null;
}
```

- [ ] **Step 2: 追加失败测试**

`server/test/scheduler-store.test.js`：把 `validateTask(shellTask({ type: 'x' })).error` 断言改为 `'type must be shell|ai|script|workflow'`，并追加：

```js
test('validateTask 支持 workflow 类型', () => {
  const base = { name: 'w', type: 'workflow', schedule: { mode: 'interval', interval: { every: 1, unit: 'day' } } };
  assert.equal(validateTask(base).error, 'workflowId required');
  assert.equal(validateTask({ ...base, workflow: { workflowId: 'dev' } }).error, 'agentId required');
  assert.ok(validateTask({ ...base, workflow: { workflowId: 'dev', agentId: 'opencode' } }).ok);
});

test('createTask 保存 workflow 字段并可重新加载', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask({ name: 'wf', type: 'workflow', workflow: { workflowId: 'dev', agentId: 'opencode' },
    schedule: { mode: 'interval', interval: { every: 1, unit: 'day' } } });
  assert.deepEqual(task.workflow, { workflowId: 'dev', agentId: 'opencode' });
  assert.equal(task.command, undefined);
  assert.equal(new SchedulerStore({ dir }).getTask(task.id).workflow.workflowId, 'dev');
});
```

`server/test/scheduler-manifest.test.js` 追加（按该文件既有 import/写法）：

```js
test('manifest 往返保留 workflow 字段', () => {
  const dir = tmpDir();
  const task = { id: 't1', name: 'wf', enabled: true, type: 'workflow', cwd: null,
    workflow: { workflowId: 'dev', agentId: 'opencode' },
    schedule: { mode: 'interval', interval: { every: 1, unit: 'day' } } };
  const m = toManifest(task, dir);
  assert.deepEqual(m.workflow, { workflowId: 'dev', agentId: 'opencode' });
  const back = fromManifest(m, dir);
  assert.deepEqual(back.workflow, { workflowId: 'dev', agentId: 'opencode' });
});
```

（若该测试文件未 import `toManifest`/`fromManifest`，在顶部按现有风格补上 `import { toManifest, fromManifest } from '../scheduler/manifest.js';`，并确认 `tmpDir` helper 存在，否则用 `fs.mkdtempSync(path.join(os.tmpdir(), 'sched-mf-'))`。）

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test "server/test/scheduler-store.test.js" "server/test/scheduler-manifest.test.js"`
Expected: FAIL。

- [ ] **Step 4: 改 `server/scheduler/store.js`**

`TYPES` 改为：

```js
const TYPES = new Set(['shell', 'ai', 'script', 'workflow']);
```

`validateTask` 中类型错误文案改为 `'type must be shell|ai|script|workflow'`，并在 `if (t.type === 'script') { ... }` 之后加：

```js
  if (t.type === 'workflow') {
    const w = t.workflow || {};
    if (!w.workflowId) return { error: 'workflowId required' };
    if (!w.agentId) return { error: 'agentId required' };
  }
```

`_buildTask` 的 `script:` 行下加：

```js
      workflow: input.type === 'workflow' ? { workflowId: String(input.workflow.workflowId), agentId: String(input.workflow.agentId) } : undefined,
```

- [ ] **Step 5: 改 `server/scheduler/manifest.js`**

`toManifest` 的 `if (task.type === 'script') ...` 下加：

```js
  if (task.type === 'workflow') m.workflow = { ...(task.workflow || {}) };
```

`fromManifest` 的 `if (obj.type === 'script') ...` 下加：

```js
  if (obj.type === 'workflow') task.workflow = { ...(obj.workflow || {}) };
```

- [ ] **Step 6: 跑测试确认通过**

Run: `node --test "server/test/scheduler-store.test.js" "server/test/scheduler-manifest.test.js"`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add shared/scheduler.d.ts server/scheduler/store.js server/scheduler/manifest.js server/test/scheduler-store.test.js server/test/scheduler-manifest.test.js
git commit -m "feat(scheduler): workflow 任务类型存储与 manifest"
```

---

## Task 4: 引擎分派 `workflowExecutor`

**Files:**
- Modify: `server/scheduler/engine.js`
- Test: `server/test/scheduler-engine.test.js`

- [ ] **Step 1: 追加失败测试**

在 `server/test/scheduler-engine.test.js` 末尾追加：

```js
function wfTask(over = {}) {
  return { name: 'wf', enabled: true, type: 'workflow', workflow: { workflowId: 'dev', agentId: 'opencode' },
    schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } }, ...over };
}
function fakeExecutor() {
  const calls = [];
  const handles = new Map();
  return {
    calls, handles,
    start(args) {
      calls.push(args);
      let aborted = false;
      let cb = args.onStatus;
      const handle = { abort() { aborted = true; cb?.({ status: 'aborted' }); }, get aborted() { return aborted; }, emit: (s) => cb?.(s) };
      handles.set(args.runId, handle);
      return handle;
    },
  };
}

test('workflow 任务：触发时调用 executor 不 spawn 进程', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const executor = fakeExecutor();
  const events = [];
  const now = { v: 1000 };
  const engine = createEngine({ store, runner, workflowExecutor: executor, now: () => now.v });
  engine.onEvent((e) => events.push(e));
  store.createTask(wfTask());
  engine.refreshAll();
  now.v += HOUR;
  engine.tick();
  assert.equal(runner.calls.length, 0);
  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0].task.workflow.workflowId, 'dev');
  assert.equal(store.listRuns({ taskId: store.listTasks()[0].id }).length, 1);
  assert.deepEqual(events, ['run-start']);
});

test('workflow 任务：executor onStatus success → run success，可再次触发', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const executor = fakeExecutor();
  const now = { v: 1000 };
  const engine = createEngine({ store, runner: fakeRunner(), workflowExecutor: executor, now: () => now.v });
  const { task } = store.createTask(wfTask());
  engine.refreshAll();
  now.v += HOUR; engine.tick();
  const runId = executor.calls[0].runId;
  executor.handles.get(runId).emit({ status: 'success', sessionId: 'sess1' });
  const run = store.getRun(runId);
  assert.equal(run.status, 'success');
  assert.equal(run.sessionId, 'sess1');
  assert.equal(engine.isRunning(task.id), false);
});

test('workflow 任务：stop 调 executor.abort', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const executor = fakeExecutor();
  const now = { v: 1000 };
  const engine = createEngine({ store, runner: fakeRunner(), workflowExecutor: executor, now: () => now.v });
  const { task } = store.createTask(wfTask());
  engine.refreshAll();
  now.v += HOUR; engine.tick();
  const runId = executor.calls[0].runId;
  assert.equal(engine.stop(task.id), true);
  assert.equal(executor.handles.get(runId).aborted, true);
  assert.equal(store.getRun(runId).status, 'killed');
});

test('workflow 任务：未注入 executor → 立即 failed', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const engine = createEngine({ store, runner: fakeRunner(), now: () => 1000 });
  const { task } = store.createTask(wfTask());
  const r = engine.manualRun(task.id);
  assert.equal(r.run.status, 'failed');
  assert.equal(r.run.error, 'executor-unavailable');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/scheduler-engine.test.js"`
Expected: FAIL（workflow 任务走了 spawn）。

- [ ] **Step 3: 改 `server/scheduler/engine.js`**

`createEngine` 签名加 `workflowExecutor = null`：

```js
export function createEngine({
  store, runner = createRunner(), logger = console,
  now = () => Date.now(), tickMs = TICK_MS, aiBin = 'opencode',
  opencodeDataDir = null, workflowExecutor = null,
  maxConcurrent = Number(process.env.DEVFLOW_SCHED_MAX_CONCURRENT) || 3,
} = {}) {
```

在 `const taskRuns = new Map();` 下加：

```js
  const activeWorkflow = new Map();   // taskId -> { runId, handle }
```

`startRun` 首行加分派：

```js
  function startRun(task, trigger) {
    if (task.type === 'workflow') return startWorkflowRun(task, trigger);
    if (taskRuns.has(task.id)) return { error: 'already-running' };
```

在 `startRun` 之后（`complete` 之前）插入：

```js
  function startWorkflowRun(task, trigger) {
    if (taskRuns.has(task.id)) return { error: 'already-running' };
    if (!workflowExecutor) {
      const run = finishImmediate(task, trigger, 'executor-unavailable');
      return { run: { ...run } };
    }
    if (runner.count() + activeWorkflow.size >= maxConcurrent) return { error: 'max-concurrent' };
    const id = runIdGen();
    const logFile = store.logFileFor(task.id, id);
    const run = { id, taskId: task.id, status: 'running', trigger, startedAt: now(), finishedAt: null, exitCode: null, durationMs: null, logFile, error: null, sessionId: null };
    store.addRun(run);
    taskRuns.set(task.id, id);
    const finish = (status, extra = {}) => {
      const cur = activeWorkflow.get(task.id);
      if (!cur || cur.runId !== id) return;
      activeWorkflow.delete(task.id);
      taskRuns.delete(task.id);
      const patch = { status, finishedAt: now(), durationMs: now() - run.startedAt, ...extra };
      const updated = store.updateRun(id, patch);
      const fresh = store.getTask(task.id);
      if (fresh) scheduleTask(fresh, now());
      emit('run-end', { run: updated ? { ...updated } : { id, taskId: task.id, ...patch } });
    };
    const onStatus = (s = {}) => {
      if (s.sessionId) store.updateRun(id, { sessionId: s.sessionId });
      if (s.status === 'success') finish('success', { sessionId: s.sessionId || null });
      else if (s.status === 'failed') finish('failed', { error: s.error || 'workflow failed' });
      else if (s.status === 'aborted') finish('killed');
      else if (s.status === 'paused') store.updateRun(id, { status: 'paused' });
    };
    // 先占位并 emit run-start，再启动执行器；执行器的状态回调均为异步（queueMicrotask），不会抢在占位之前
    activeWorkflow.set(task.id, { runId: id, handle: null });
    emit('run-start', { run: { ...run } });
    let handle = null;
    try {
      handle = workflowExecutor.start({ task, runId: id, logFile, onStatus });
    } catch (e) {
      finish('failed', { error: String(e && e.message || e) });
      return { run: { ...store.getRun(id) } };
    }
    if (!handle || handle.error) {
      finish('failed', { error: (handle && handle.error) || 'executor-error' });
      return { run: { ...store.getRun(id) } };
    }
    const cur = activeWorkflow.get(task.id);
    if (cur && cur.runId === id) cur.handle = handle;
    return { run: { ...run } };
  }
```

```js
  function stop(taskId) {
    const wf = activeWorkflow.get(taskId);
    if (wf) { try { wf.handle?.abort?.(); } catch { /* ignore */ } return true; }
    const rid = taskRuns.get(taskId);
    if (!rid) return false;
    return runner.stop(rid);
  }
```

说明：`finish` 判 `activeWorkflow.get(task.id)?.runId === id`，因此执行器若在启动过程中同步回调终态，占位条目也能正常收尾；重复 `finish` 因条目已删而被忽略。执行器的状态回调均为异步（`queueMicrotask`，见 Task 5），`run-start` 一定先于任何终态。

`stop(taskId)` 替换为：

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/scheduler-engine.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/scheduler/engine.js server/test/scheduler-engine.test.js
git commit -m "feat(scheduler): engine 分派 workflow 执行器"
```

---

## Task 5: 执行器 `server/scheduler/workflow-executor.js`

**Files:**
- Create: `server/scheduler/workflow-executor.js`
- Test: `server/test/scheduler-workflow-executor.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-workflow-executor.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../session-manager.js';
import { WorkflowRunner } from '../workflow-runner.js';
import { createWorkflowExecutor } from '../scheduler/workflow-executor.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';

const WFS = [{ id: 'dev', label: 'DEV', stages: [{ id: 's1', label: 'S1', group: '', prompts: ['p-1'] }] }];

async function harness({ agent = { id: 'opencode', name: 'OpenCode', cmd: 'opencode' }, stepTimeoutMs = 30 * 60 * 1000 } = {}) {
  const instances = [];
  const created = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const realCreate = sm.create.bind(sm);
  sm.create = async (opts) => { created.push(opts); return realCreate(opts); };
  const runner = new WorkflowRunner({ sessionManager: sm, getWorkflows: () => WFS, doneMarker: (token) => `DONE>${token}`, stepTimeoutMs });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfexec-'));
  const executor = createWorkflowExecutor({
    sessionManager: sm,
    workflowRunner: runner,
    resolveAgent: (id) => (agent && id === agent.id ? agent : null),
    logger: console,
  });
  return { sm, instances, created, runner, executor, dir };
}

test('start：新建 agent 会话并启动整条工作流，成功回写 success', async () => {
  const { instances, created, executor, dir } = await harness();
  const logFile = path.join(dir, 't', 'r.log');
  const statuses = [];
  const task = { id: 't1', name: '夜间', projectId: null, cwd: process.cwd(), workflow: { workflowId: 'dev', agentId: 'opencode' } };
  const handle = executor.start({ task, runId: 'r1', logFile, onStatus: (s) => statuses.push(s) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(handle.error, undefined);
  assert.equal(created.length, 1);
  assert.equal(created[0].kind, 'agent');
  assert.equal(created[0].agentId, 'opencode');
  assert.equal(created[0].agentCmd, 'opencode');
  assert.ok(handle.sessionId);
  assert.equal(instances[0].pty.writes.length, 1);
  instances[0].pty.__emitData(`DONE>DF_DONE:${handle.runId}:0`);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(statuses.some((s) => s.status === 'success' && s.sessionId === handle.sessionId));
  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /session/);
});

test('start：agent 不存在 → failed agent-not-found，不建会话', async () => {
  const { created, executor, dir } = await harness();
  const task = { id: 't2', name: 'x', workflow: { workflowId: 'dev', agentId: 'ghost' } };
  const statuses = [];
  const r = executor.start({ task, runId: 'r2', logFile: path.join(dir, 'r2.log'), onStatus: (s) => statuses.push(s) });
  assert.equal(r.error, 'agent-not-found');
  assert.equal(created.length, 0);
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(statuses[0].status, 'failed');
});

test('start：工作流不存在 → failed workflow-not-found', async () => {
  const { created, executor, dir } = await harness();
  const task = { id: 't3', name: 'x', workflow: { workflowId: 'ghost', agentId: 'opencode' } };
  const statuses = [];
  const r = executor.start({ task, runId: 'r3', logFile: path.join(dir, 'r3.log'), onStatus: (s) => statuses.push(s) });
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(created.length, 1);
  assert.ok(statuses.some((s) => s.status === 'failed' && s.error === 'workflow-not-found'));
  assert.equal(typeof r.abort, 'function');
});

test('abort：中止工作流 run', async () => {
  const { executor, dir } = await harness();
  const task = { id: 't4', name: 'x', workflow: { workflowId: 'dev', agentId: 'opencode' } };
  const handle = executor.start({ task, runId: 'r4', logFile: path.join(dir, 'r4.log'), onStatus: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  handle.abort();
  assert.equal(handle.abort(), undefined);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/scheduler-workflow-executor.test.js"`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

Create `server/scheduler/workflow-executor.js`：

```js
import fs from 'node:fs';
import path from 'node:path';
import { t } from '../i18n.js';

function timeLabel(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function appendLog(logPath, line) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch { /* 日志失败不阻断 */ }
}

// 定时任务里 workflow 类型任务的执行器：新建 agent 会话 → 在会话里跑整条工作流
export function createWorkflowExecutor({ sessionManager, workflowRunner, resolveAgent, logger = console }) {
  function start({ task, runId, logFile, onStatus = () => {} }) {
    const notify = (s) => queueMicrotask(() => { try { onStatus(s); } catch (e) { logger?.warn?.('wf onStatus failed', e); } });
    const agent = resolveAgent ? resolveAgent(task.workflow?.agentId) : null;
    if (!agent) { notify({ status: 'failed', error: 'agent-not-found' }); return { error: 'agent-not-found' }; }
    let sessionId = null;
    let wfRunId = null;
    let off = null;
    const finished = () => { if (off) { off(); off = null; } };
    const handle = {
      get runId() { return wfRunId; },
      get sessionId() { return sessionId; },
      abort() { if (wfRunId) { try { workflowRunner.get(wfRunId)?.abort(); } catch { /* ignore */ } } },
    };
    sessionManager.create({
      projectId: task.projectId || null,
      cwd: task.cwd || null,
      kind: 'agent',
      agentId: agent.id,
      agentCmd: agent.cmd,
      name: t('sched.wf.session_name', { name: task.name, time: timeLabel() }),
    }).then((session) => {
      sessionId = session.id;
      appendLog(logFile, `# workflow ${task.workflow.workflowId} · agent ${agent.name} (${agent.cmd})`);
      appendLog(logFile, `# session ${session.id}`);
      const res = workflowRunner.startAll({ workflowId: task.workflow.workflowId, sessionId: session.id });
      if (!res.ok) {
        appendLog(logFile, `# workflow-not-found`);
        notify({ status: 'failed', sessionId, error: 'workflow-not-found' });
        return;
      }
      wfRunId = res.run.runId;
      appendLog(logFile, `# steps ${res.run.snapshot().steps.length}`);
      off = workflowRunner.onStatus((run) => {
        if (run.runId !== wfRunId) return;
        const snap = run.snapshot();
        appendLog(logFile, `[${new Date().toISOString()}] ${snap.status} ${Math.min(snap.currentIndex + 1, snap.steps.length)}/${snap.steps.length}`);
        if (snap.status === 'done') { finished(); notify({ status: 'success', sessionId }); }
        else if (snap.status === 'failed') { finished(); notify({ status: 'failed', sessionId, error: snap.errorMessage || 'workflow failed' }); }
        else if (snap.status === 'aborted') { finished(); notify({ status: 'aborted', sessionId }); }
        else if (snap.status === 'paused') { notify({ status: 'paused', sessionId }); }
      });
      notify({ status: 'running', sessionId });
    }).catch((e) => {
      logger?.warn?.('workflow executor session create failed', (e && e.message) || e);
      appendLog(logFile, `# session-create-failed ${String(e && e.message || e)}`);
      notify({ status: 'failed', error: 'session-create-failed' });
    });
    return handle;
  }
  return { start };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/scheduler-workflow-executor.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/scheduler/workflow-executor.js server/test/scheduler-workflow-executor.test.js
git commit -m "feat(scheduler): workflow 任务执行器（建会话+跑工作流）"
```

---

## Task 6: 装配执行器

**Files:**
- Modify: `server/scheduler/index.js`
- Modify: `server/index.js`

- [ ] **Step 1: 改 `server/scheduler/index.js`**

`createScheduler` 参数与 `createEngine` 调用加 `workflowExecutor`：

```js
export function createScheduler({ dir, projectResolver = () => null, logger = console, runner = null, agentCmd = 'opencode', opencodeDataDir = null, manifestRoot = null, workflowExecutor = null }) {
  const store = new SchedulerStore({ dir, logger, ...(manifestRoot ? { manifestRoot } : {}) });
  const engine = createEngine({ store, runner: runner || createRunner(), logger, aiBin: agentCmd, opencodeDataDir, workflowExecutor });
```

- [ ] **Step 2: 改 `server/index.js`**

顶部 import 区加：

```js
import { createWorkflowExecutor } from './scheduler/workflow-executor.js';
```

在 `const scheduler = createScheduler({...})` 之前，先构造执行器（`workflowRunner`、`sessionManager`、`loadDevflowConfig`、`configFile` 均已在作用域内）：

```js
  const workflowExecutor = createWorkflowExecutor({
    sessionManager,
    workflowRunner,
    resolveAgent: (id) => (loadDevflowConfig(configFile).agents.list || []).find((a) => a.id === id) || null,
    logger: log,
  });
```

把 `createScheduler` 调用加入 `workflowExecutor`：

```js
  const scheduler = createScheduler({
    dir: paths.schedulerDir,
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    logger: log,
    opencodeDataDir: path.join(paths.dir, 'opencode-data'),
    workflowExecutor,
  });
```

- [ ] **Step 3: 冒烟：语法与既有测试**

Run: `node --check server/index.js; node --check server/scheduler/index.js`
Expected: 无输出（语法 OK）。

Run: `node --test "server/test/scheduler-*.test.js"`
Expected: 全 PASS。

- [ ] **Step 4: Commit**

```bash
git add server/scheduler/index.js server/index.js
git commit -m "feat(scheduler): 装配 workflow 执行器"
```

---

## Task 7: 无绑定连接时广播工作流状态

**Files:**
- Modify: `server/ws-gateway.js`
- Test: `server/test/ws-gateway-workflow.test.js`

- [ ] **Step 1: 追加失败测试**

在 `server/test/ws-gateway-workflow.test.js` 末尾追加：

```js
test('无绑定连接的运行（定时触发）向所有连接广播状态', async (t) => {
  const { session, runner, t: ts, instances } = await groupHarness();
  const a = await ts.connect();
  const b = await ts.connect();
  t.after(() => ts.stop());
  // 直接启动（不经 WS），模拟定时触发：没有连接绑定
  const res = runner.startAll({ workflowId: 'gw', sessionId: session.id });
  assert.equal(res.ok, true);
  const { runId } = res.run;
  instances[0].pty.__emitData(`DF_DONE:${runId}:0`);
  const aStatus = await a.wait((m) => m.type === S2C.WF_STATUS && m.run.runId === runId);
  const bStatus = await b.wait((m) => m.type === S2C.WF_STATUS && m.run.runId === runId);
  assert.equal(aStatus.run.steps[0].status, 'done');
  assert.equal(bStatus.run.steps[0].status, 'done');
  a.close(); b.close();
});
```

（`groupHarness` 的 `GWFS` 含 3 个 prompt 步：`a#0,a#1,b#0`；`startAll` 会全部展开。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/ws-gateway-workflow.test.js"`
Expected: FAIL（两个客户端都收不到 WF_STATUS）。

- [ ] **Step 3: 改 `server/ws-gateway.js`**

把 `workflowRunner.onStatus(...)` 回调替换为：

```js
  if (workflowRunner) {
    workflowRunner.onStatus((run) => {
      const c = workflowRunner.connOf(run.runId);
      const finished = run.status === 'done' || run.status === 'aborted';
      if (c) {
        if (finished) c.send({ type: S2C.WF_FINISHED, runId: run.runId, status: run.status });
        c.send({ type: S2C.WF_STATUS, run: run.snapshot() });
        return;
      }
      // 定时触发的运行没有发起连接 → 广播给所有连接
      for (const conn of conns.values()) {
        if (finished) conn.send({ type: S2C.WF_FINISHED, runId: run.runId, status: run.status });
        conn.send({ type: S2C.WF_STATUS, run: run.snapshot() });
      }
    });
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/ws-gateway-workflow.test.js"`
Expected: PASS（既有用例不回归）。

- [ ] **Step 5: Commit**

```bash
git add server/ws-gateway.js server/test/ws-gateway-workflow.test.js
git commit -m "feat(workflow): 定时运行状态广播所有连接"
```

---

## Task 8: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 中文**

在 `zh-CN.js` 的 `'sched.type.script'` 后加：

```js
  'sched.type.workflow': '工作流',
```

在 `sched.*` 区末尾追加：

```js
  'sched.wf.select': '工作流',
  'sched.wf.none': '（无可选工作流）',
  'sched.agent.select': 'Agent',
  'sched.wf.task_meta': '工作流：{wf} · Agent：{agent}',
  'sched.wf.session_name': '定时：{name} · {time}',
  'sched.wf.need_select': '请选择工作流与 Agent',
  'sched.open_session': '打开会话',
  'sched.wf.open': '打开运行会话',
  'sched.wf.no_run': '该任务还没有运行记录，请先运行',
  'sched.err.agent_not_found': 'Agent 不存在',
  'sched.err.workflow_not_found': '工作流不存在',
  'wfe.sched.enable': '保存时同步为定时任务',
  'wfe.sched.need_agent': '请选择 Agent',
  'wfe.sched.created': '定时任务已创建',
  'wfe.sched.updated': '定时任务已更新',
  'wfe.sched.no_agent': '（无可用 Agent）',
```

- [ ] **Step 2: 英文**

在 `en.js` 的 `'sched.type.script'` 后加 `'sched.type.workflow': 'Workflow',`，并追加：

```js
  'sched.wf.select': 'Workflow',
  'sched.wf.none': '(no workflow)',
  'sched.agent.select': 'Agent',
  'sched.wf.task_meta': 'Workflow: {wf} · Agent: {agent}',
  'sched.wf.session_name': 'Scheduled: {name} · {time}',
  'sched.wf.need_select': 'Select a workflow and an agent',
  'sched.open_session': 'Open session',
  'sched.wf.open': 'Open run session',
  'sched.wf.no_run': 'No runs yet — run it first',
  'sched.err.agent_not_found': 'Agent not found',
  'sched.err.workflow_not_found': 'Workflow not found',
  'wfe.sched.enable': 'Sync as scheduled task on save',
  'wfe.sched.need_agent': 'Select an agent',
  'wfe.sched.created': 'Scheduled task created',
  'wfe.sched.updated': 'Scheduled task updated',
  'wfe.sched.no_agent': '(no agent)',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: 通过（无中文命中）。

Run: `node -e "Promise.all([import('./shared/i18n/zh-CN.js'),import('./shared/i18n/en.js')]).then(([z,e])=>{const zk=Object.keys(z.messages),ek=Object.keys(e.messages);console.log(zk.filter(k=>!ek.includes(k)),ek.filter(k=>!zk.includes(k)))})"`
Expected: 两个空数组。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(scheduler): 工作流定时词条"
```

---

## Task 9: 前端

**Files:**
- Modify: `web/src/scheduler/format.ts`
- Modify: `web/src/scheduler/useScheduler.ts`
- Modify: `web/src/scheduler/SchedulerView.vue`
- Modify: `web/src/App.vue`
- Test: `web/src/scheduler/format.test.ts`

- [ ] **Step 1: 改 `web/src/scheduler/format.ts`**

`STATUS_KEY` 加 `paused`，并新增类型标签函数：

```ts
const STATUS_KEY: Record<string, string> = { running: 'sched.status.running', success: 'sched.status.success', failed: 'sched.status.failed', timeout: 'sched.status.timeout', killed: 'sched.status.killed', paused: 'sched.status.paused' };
export function runStatusLabel(s: string): string {
  return STATUS_KEY[s] ? t(STATUS_KEY[s]) : s;
}

export function typeLabel(type: string): string {
  if (type === 'ai') return 'AI';
  if (type === 'workflow') return t('sched.type.workflow');
  return t(`sched.type.${type}`);
}
```

- [ ] **Step 2: 追加 format 测试**

在 `web/src/scheduler/format.test.ts` 追加：

```ts
import { typeLabel, runStatusLabel } from './format';

describe('typeLabel / runStatusLabel', () => {
  it('workflow 与 paused 有标签', () => {
    expect(typeLabel('workflow')).toBeTruthy();
    expect(runStatusLabel('paused')).toBeTruthy();
    expect(runStatusLabel('killed')).toBeTruthy();
  });
});
```

（若该文件已 `import { describe, it, expect } from 'vitest'`，复用；否则补上。）

- [ ] **Step 3: 改 `web/src/scheduler/useScheduler.ts`**

`TaskView` 无需改（继承 `SchedulerTask`）。无需其他改动。

- [ ] **Step 4: 改 `web/src/scheduler/SchedulerView.vue`**

顶部 import 改为：

```ts
import { scheduleSummary, formatTime, runStatusLabel, recentRunsOf, typeLabel } from './format';
```

`emptyForm()` 返回值加 `workflow`：

```ts
    workflow: { workflowId: '', agentId: '' },
```

新增状态与加载：

```ts
const workflows = ref<{ id: string; label: string }[]>([]);
const agents = ref<{ id: string; name: string }[]>([]);
async function loadWorkflowOptions() {
  try {
    const w = await fetch('/api/workflows-xml').then((r) => r.json());
    workflows.value = (w.workflows || []).map((x: any) => ({ id: x.id, label: x.label || x.id }));
  } catch { workflows.value = []; }
  try {
    const a = await fetch('/api/agents').then((r) => r.json());
    agents.value = (a.agents || []).map((x: any) => ({ id: x.id, name: x.name || x.id }));
  } catch { agents.value = []; }
}
function wfLabel(id: string) { return workflows.value.find((w) => w.id === id)?.label || id; }
function agentName(id: string) { return agents.value.find((a) => a.id === id)?.name || id; }
```

`openEdit` 的 `form.value = JSON.parse(...)` 里加 `workflow: task.workflow || { workflowId: '', agentId: '' },`。

`save()` 增加类型清理与校验：

```ts
  if (body.type !== 'workflow') delete body.workflow;
  if (body.type === 'workflow' && (!body.workflow?.workflowId || !body.workflow?.agentId)) { state.error = t('sched.wf.need_select'); return; }
```

`onMounted` 改为：

```ts
onMounted(async () => { await sched.refresh(); sched.loadAiCommands(); void loadWorkflowOptions(); });
```

模板：
- 类型下拉加一项：

```html
            <option value="workflow">{{ $t('sched.type.workflow') }}</option>
```

- 在 `<template v-else>`（script 分支）之前插入 workflow 分支：

```html
        <template v-else-if="form.type === 'workflow'">
          <label>{{ $t('sched.wf.select') }}
            <select v-model="form.workflow.workflowId">
              <option value="">{{ $t('sched.field.choose') }}</option>
              <option v-for="w in workflows" :key="w.id" :value="w.id">{{ w.label }}</option>
            </select>
            <span v-if="!workflows.length" class="dim">{{ $t('sched.wf.none') }}</span>
          </label>
          <label>{{ $t('sched.agent.select') }}
            <select v-model="form.workflow.agentId">
              <option value="">{{ $t('sched.field.choose') }}</option>
              <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
        </template>
```

（注意把原来的 `<template v-else>` 顺延；`v-else-if` 必须紧跟 `v-else-if="form.type === 'ai'"` 分支。）

- 列表徽标（第 184 行那处嵌套三元）替换为「图标 + 文字」，并在 script 区新增 `taskIcon`：

```ts
function taskIcon(t: TaskView): string {
  if (t.type === 'workflow') return '🔀';
  if (t.type === 'script') return '📜';
  if (t.type === 'shell') return '⌨';
  if (t.type === 'ai') return t.ai?.source === 'file' ? '📄' : '🤖';
  return '•';
}
```

```html
              <span class="badge" :class="t.type"><span class="bi">{{ taskIcon(t) }}</span>{{ typeLabel(t.type) }}</span>
```

样式追加：

```css
.badge .bi { margin-right: 4px; }
```

并在 `name` 行后补 workflow 元信息（`v-if="t.type === 'workflow' && t.workflow"`）：

```html
              <span v-if="t.type === 'workflow' && t.workflow" class="dim">{{ $t('sched.wf.task_meta', { wf: wfLabel(t.workflow.workflowId), agent: agentName(t.workflow.agentId) }) }}</span>
```

- 运行记录弹窗标题旁/条目里显示会话与打开按钮。在 `.histwrap` 的 `.histlist` 之后、`pre.logview` 之前插入：

```html
          <div class="runside">
            <div v-if="currentRun && currentRun.sessionId" class="runsess">
              <span class="dim">{{ currentRun.sessionId }}</span>
              <button @click="props.onOpenSession?.(currentRun.sessionId!)">{{ $t('sched.open_session') }}</button>
            </div>
          </div>
```

并新增计算属性与 prop：

```ts
const props = defineProps<{ terminal: any; onOpenSession?: (sessionId: string) => void }>();
const currentRun = computed(() => runs.value.find((r) => r.id === logRunId.value) || null);
```

新增「打开运行会话」处理函数：

```ts
async function openWfRun(task: TaskView) {
  state.error = '';
  const list = await sched.loadRuns(task.id, 20);
  const run = list.find((r) => r.sessionId);
  if (!run || !run.sessionId) { state.error = t('sched.wf.no_run'); return; }
  props.onOpenSession?.(run.sessionId);
}
```

在操作区（`.acts`）「历史」按钮之前插入（仅 workflow 任务显示）：

```html
            <button v-if="t.type === 'workflow'" @click="openWfRun(t)">{{ $t('sched.wf.open') }}</button>
```

（`computed` 已在 import 中。）

- [ ] **Step 5: 改 `web/src/App.vue`**

在 `openHistorySession` 附近加：

```ts
function openLiveSession(sid: string) {
  center.activateSession(sid);
  terminal.switchTo(sid);
}
```

模板里：

```html
      <SchedulerView :terminal="terminal" :on-open-session="openLiveSession" />
```

- [ ] **Step 6: 跑前端测试与类型检查**

Run: `npm.cmd --prefix web run test -- src/scheduler`
Expected: PASS。

Run: `npm.cmd run typecheck`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add web/src/scheduler/format.ts web/src/scheduler/format.test.ts web/src/scheduler/useScheduler.ts web/src/scheduler/SchedulerView.vue web/src/App.vue
git commit -m "feat(scheduler): 前端工作流定时表单与运行记录"
```

---

## Task 10: 工作流编辑器定时任务设定

**Files:**
- Create: `web/src/scheduler/workflowTask.ts`
- Test: `web/src/scheduler/workflowTask.test.ts`
- Modify: `web/src/components/WorkflowEditor.vue`
- Test: `web/src/components/WorkflowEditor.test.ts`

- [ ] **Step 1: 写纯函数失败测试**

Create `web/src/scheduler/workflowTask.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { scheduleEqual, findWorkflowTask, findWorkflowTasks, buildWorkflowTask } from './workflowTask';

const S1 = { mode: 'interval' as const, interval: { every: 1, unit: 'hour' as const } };
const S2 = { mode: 'daily' as const, daily: { at: '09:30', weekdays: [] as number[] } };
const T = (over: any = {}) => ({ id: 't1', type: 'workflow', name: 'DEV', schedule: S1, workflow: { workflowId: 'dev', agentId: 'opencode' }, ...over });

describe('workflowTask', () => {
  it('scheduleEqual 深度比较', () => {
    expect(scheduleEqual(S1, { mode: 'interval', interval: { every: 1, unit: 'hour' } })).toBe(true);
    expect(scheduleEqual(S1, S2)).toBe(false);
  });

  it('findWorkflowTask 按 workflowId + schedule 命中', () => {
    const tasks = [T()];
    expect(findWorkflowTask(tasks, 'dev', S1)?.id).toBe('t1');
    expect(findWorkflowTask(tasks, 'dev', S2)).toBe(null);
    expect(findWorkflowTask(tasks, 'other', S1)).toBe(null);
  });

  it('findWorkflowTasks 按 workflowId 过滤', () => {
    const tasks = [T(), T({ id: 't2', schedule: S2 }), T({ id: 't3', workflow: { workflowId: 'x', agentId: 'a' } })];
    expect(findWorkflowTasks(tasks, 'dev').map((x) => x.id)).toEqual(['t1', 't2']);
  });

  it('buildWorkflowTask 构造合法任务体', () => {
    expect(buildWorkflowTask({ workflowId: 'dev', label: 'DEV', agentId: 'opencode', schedule: S1 }))
      .toEqual({ name: 'DEV', type: 'workflow', enabled: true, workflow: { workflowId: 'dev', agentId: 'opencode' }, schedule: S1 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/scheduler/workflowTask.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现 `web/src/scheduler/workflowTask.ts`**

```ts
import type { Schedule, SchedulerTask } from '@devflow/shared/scheduler';

export function scheduleEqual(a: Schedule, b: Schedule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function findWorkflowTasks(tasks: SchedulerTask[], workflowId: string): SchedulerTask[] {
  return (tasks || []).filter((x) => x.type === 'workflow' && x.workflow?.workflowId === workflowId);
}

export function findWorkflowTask(tasks: SchedulerTask[], workflowId: string, schedule: Schedule): SchedulerTask | null {
  return findWorkflowTasks(tasks, workflowId).find((x) => scheduleEqual(x.schedule, schedule)) || null;
}

export function buildWorkflowTask({ workflowId, label, agentId, schedule }: { workflowId: string; label: string; agentId: string; schedule: Schedule }) {
  return { name: label, type: 'workflow' as const, enabled: true, workflow: { workflowId, agentId }, schedule };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/scheduler/workflowTask.test.ts`
Expected: PASS。

- [ ] **Step 5: 改 `web/src/components/WorkflowEditor.vue`**

顶部 import 追加：

```ts
import { findWorkflowTask, findWorkflowTasks, buildWorkflowTask } from '../scheduler/workflowTask';
import type { Schedule, SchedulerTask } from '@devflow/shared/scheduler';
```

`<script setup>` 内（`const canSave = ...` 之后）新增状态：

```ts
const schedOn = ref(false);
const schedAgent = ref('');
const agents = ref<{ id: string; name: string }[]>([]);
const schedTasks = ref<SchedulerTask[]>([]);
const sched = ref<Schedule>({ mode: 'interval', interval: { every: 1, unit: 'hour' } });
const WEEKDAYS = computed(() => [1, 2, 3, 4, 5, 6, 7].map((v) => ({ v, t: t('sched.wdshort.' + v) })));
function toggleWeekday(v: number) {
  if (sched.value.mode !== 'daily') return;
  const arr = sched.value.daily.weekdays;
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1); else arr.push(v);
}
async function loadSchedulerOptions() {
  try { agents.value = ((await fetch('/api/agents').then((r) => r.json())).agents || []).map((a: any) => ({ id: a.id, name: a.name || a.id })); } catch { agents.value = []; }
  try { schedTasks.value = ((await fetch('/api/scheduler/tasks').then((r) => r.json())).tasks || []); } catch { schedTasks.value = []; }
}
function prefillScheduler() {
  const first = findWorkflowTasks(schedTasks.value, currentId.value)[0];
  if (first) { schedOn.value = true; schedAgent.value = first.workflow?.agentId || ''; sched.value = JSON.parse(JSON.stringify(first.schedule)); }
  else { schedOn.value = false; schedAgent.value = ''; }
}
async function syncSchedulerTask(): Promise<'created' | 'updated'> {
  const wf = current.value;
  if (!wf) throw new Error('no workflow');
  const existing = findWorkflowTask(schedTasks.value, wf.id, sched.value);
  const body = buildWorkflowTask({ workflowId: wf.id, label: wf.label, agentId: schedAgent.value, schedule: sched.value });
  const url = existing ? `/api/scheduler/tasks/${encodeURIComponent(existing.id)}` : '/api/scheduler/tasks';
  const res = await fetch(url, { method: existing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const j: any = await res.json().catch(() => ({})); throw new Error(String(j?.error || `HTTP ${res.status}`)); }
  return existing ? 'updated' : 'created';
}
```

`load()` 末尾调用 `await loadSchedulerOptions(); prefillScheduler();`（`load` 已 async）。

`watch(currentId, () => { prefillScheduler(); });`（放在现有 `watch(model, ...)` 之后）。

`save()` 内：在 `dirty.value = false;` 之前加入：

```ts
    if (schedOn.value) {
      if (!schedAgent.value) { throw new Error(t('wfe.sched.need_agent')); }
      const kind = await syncSchedulerTask();
      msg.value = `${t('wfe.saved')} · ${t(kind === 'updated' ? 'wfe.sched.updated' : 'wfe.sched.created')}`;
    }
```

（注意 `save()` 的 `catch` 会把异常转成 `t('wfe.failed', ...)`；Agent 未选时应在最前面单独提示：把校验提前到 `save()` 开头：`if (schedOn.value && !schedAgent.value) { msg.value = t('wfe.sched.need_agent'); return false; }`。）

模板：在 `<footer class="wef">` 之前插入：

```html
      <div class="wesched">
        <label class="wechk"><input type="checkbox" v-model="schedOn" />{{ $t('wfe.sched.enable') }}</label>
        <template v-if="schedOn">
          <select v-model="sched.mode" class="wesel">
            <option value="interval">{{ $t('sched.mode.interval') }}</option>
            <option value="daily">{{ $t('sched.mode.daily') }}</option>
          </select>
          <template v-if="sched.mode === 'interval'">
            <input type="number" min="1" v-model.number="sched.interval.every" class="wenum" />
            <select v-model="sched.interval.unit" class="wesel">
              <option value="second">{{ $t('sched.unit.second') }}</option>
              <option value="minute">{{ $t('sched.unit.minute') }}</option>
              <option value="hour">{{ $t('sched.unit.hour') }}</option>
              <option value="day">{{ $t('sched.unit.day') }}</option>
            </select>
          </template>
          <template v-else>
            <input type="time" v-model="sched.daily.at" class="wetime" />
            <label v-for="w in WEEKDAYS" :key="w.v" class="wewd">
              <input type="checkbox" :checked="sched.mode === 'daily' && sched.daily.weekdays.includes(w.v)" @change="toggleWeekday(w.v)" />{{ w.t }}
            </label>
          </template>
          <select v-model="schedAgent" class="wesel">
            <option value="">{{ $t('sched.field.choose') }}</option>
            <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <span v-if="!agents.length" class="wedim">{{ $t('wfe.sched.no_agent') }}</span>
        </template>
      </div>
```

样式追加：

```css
.wesched { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 14px; border-top: 1px solid var(--bd2); font-size: 12px; color: var(--tx2); }
.wechk { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.wesel, .wetime, .wenum { background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 6px; font-family: inherit; }
.wenum { width: 64px; }
.wewd { display: inline-flex; align-items: center; gap: 2px; }
.wedim { color: var(--tx5); }
```

- [ ] **Step 6: 写组件测试**

Create `web/src/components/WorkflowEditor.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import WorkflowEditor from './WorkflowEditor.vue';

const WFS = [{ id: 'dev', label: 'DEV', stages: [{ id: 's', label: 'S', prompts: ['p'] }] }];
const S1 = { mode: 'interval', interval: { every: 1, unit: 'hour' } };
const TASKS = [{ id: 't1', type: 'workflow', name: 'DEV', schedule: S1, workflow: { workflowId: 'dev', agentId: 'opencode' } }];

function mount() {
  return mountC(WorkflowEditor, { global: { stubs: { WorkflowFormTab: true, WorkflowXmlTab: true, WorkflowPreviewTab: true } } });
}
afterEach(() => vi.unstubAllGlobals());

function stubFetch(calls: any[], tasks: any[]) {
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    calls.push([String(u), init?.method]);
    if (String(u) === '/api/workflows-xml') return { ok: true, json: async () => ({ workflows: WFS }) };
    if (String(u) === '/api/agents') return { ok: true, json: async () => ({ agents: [{ id: 'opencode', name: 'OpenCode' }] }) };
    if (String(u) === '/api/scheduler/tasks' && (!init || !init.method)) return { ok: true, json: async () => ({ tasks }) };
    if (String(u) === '/api/workflows') return { ok: true, json: async () => ({ workflows: WFS }) };
    return { ok: true, json: async () => ({}) };
  }));
}

describe('WorkflowEditor 定时任务设定', () => {
  it('已有同工作流任务 → 自动勾选并回填；保存走 PUT', async () => {
    const calls: any[] = [];
    stubFetch(calls, TASKS);
    const w = mount();
    await flushPromises();
    expect((w.find('.wesched input[type=checkbox]').element as HTMLInputElement).checked).toBe(true);
    await w.find('.webtn.primary').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/scheduler/tasks/t1' && m === 'PUT')).toBe(true);
  });

  it('无任务 → 不勾选；勾选并选 Agent 后保存走 POST', async () => {
    const calls: any[] = [];
    stubFetch(calls, []);
    const w = mount();
    await flushPromises();
    expect((w.find('.wesched input[type=checkbox]').element as HTMLInputElement).checked).toBe(false);
    await w.find('.wesched input[type=checkbox]').setValue(true);
    await w.find('.wesched select:last-of-type').setValue('opencode');
    await w.find('.webtn.primary').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/scheduler/tasks' && m === 'POST')).toBe(true);
  });
});
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/scheduler/workflowTask.test.ts src/components/WorkflowEditor.test.ts`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add web/src/scheduler/workflowTask.ts web/src/scheduler/workflowTask.test.ts web/src/components/WorkflowEditor.vue web/src/components/WorkflowEditor.test.ts
git commit -m "feat(workflow): 编辑器定时任务设定并同步到定时任务列表"
```

---

## Task 11: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 服务端测试**

Run: `npm.cmd run test:server`
Expected: 全 PASS。

- [ ] **Step 2: 前端测试**

Run: `npm.cmd run test:web`
Expected: 全 PASS。

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误。

- [ ] **Step 4: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 通过。

- [ ] **Step 5: 手动冒烟（可选，需本机起 dev）**

`npm.cmd run dev` → 左侧「定时任务」→ 新建：
1. 类型选「工作流」，选 `dev` 与 `opencode`，周期设为「每 1 分钟」或直接点「运行」；
2. 任务列表出现 `工作流：… · Agent：…`；
3. 运行后打开「历史」→ 运行记录为 `running/paused`，日志有 session 与步骤行；
4. 点「打开会话」→ 切到该 agent 会话，可见工作流 prompt 逐步写入。

- [ ] **Step 6: 收尾提交（若前面有未提交改动）**

```bash
git status --short
git add <仅本次涉及文件>
git commit -m "chore(scheduler): 工作流定时收尾"
```

---

## 已知限制

- XML 工作流经 `validateWorkflows` 后不含 `manual` 字段，实际定时运行总是全自动；`GroupRun` 的 manual 暂停为保留能力（测试覆盖）。
- 定时运行若某 prompt 步迟迟不回显 done marker，会在 `WorkflowRunner.stepTimeoutMs`（默认 30 分钟）后 `failed`。
- 自动新建的会话跑完保留，会累积；本次不做清理。
- manifest 导入的 workflow 任务需要目标机器存在同名 `workflowId` 与 `agentId`，否则运行时 failed。
