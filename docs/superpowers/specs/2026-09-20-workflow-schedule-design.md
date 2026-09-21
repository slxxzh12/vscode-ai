# 工作流定时功能设计

## 背景

两套既有机制：

- **工作流**（`config/devflow.xml` 的 `<workflows>`）：结构为 `workflow → stages → prompts`。运行时由 `WorkflowRunner`（`server/workflow-runner.js`）把工作流写进一个**活动终端会话**（PTY）逐步执行：`shared/workflow-group.js` 的 `expandGroupSteps(stages, anchor)` 把某个分组内的 prompts 拍平成线性步骤，`GroupRun`（`server/workflow-group-run.js`）按序把每步写入会话，`prompt` 步靠 done marker（`DF_DONE:<runId>:<i>`）回显推进，`cmd` 步靠 OSC 标记；分组跑完停在 `paused`（暂停边界），用户可在界面继续/中止。当前入口在终端面板，按「工作流 + 分组」发起。
- **定时任务**（`server/scheduler/`）：任务仅有 `shell`/`ai`/`script` 三类，周期支持 `interval`/`daily`；到点由 `engine.startRun` spawn 一个进程，日志写 `<调度目录>/logs/<taskId>/<runId>.log`，运行记录写 `runs.json`；每个任务对应一个 manifest（`void_manifest.json`），可导入/导出。

现在要让「工作流」也能定时执行：复用现有定时任务子系统，新增第 4 类任务 `workflow`，到点自动新建一个 agent 会话并在其中运行整条工作流。

## 目标

- 定时任务支持 `type: 'workflow'`：选择工作流（`devflow.xml` 的 `<workflows>`）+ Agent，配置周期（沿用 interval/daily），到点自动新建 agent 会话并按工作流全部 stage 的 prompts 顺序执行。
- 自动新建的会话跑完保留，可在会话列表/历史中查看；工作流若遇 `manual` 步则暂停等待人工点「下一步」。
- 运行状态与进度可见、可中止：复用定时任务的运行记录/日志，同时在所有已连接前端广播工作流进度。
- 任务 CRUD、manifest 导入导出、运行历史沿用现有通路。
- 全量中英 i18n。

## 非目标

- 不新增 cron 表达式（沿用 interval/daily）。
- 不支持「只跑某个 stage 分组」（一次跑整条工作流）。
- 不修改 `devflow.xml` 结构（不给 `<workflow>` 加 `schedule` 属性）。
- 不做运行完成的通知（邮件/webhook）、不做失败自动重试。
- 不改动终端面板既有的「按分组运行」交互。

## 设计

### 一、纯函数：整条工作流展开 `shared/workflow-group.js`

新增：

```js
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

- 复用 `promptStepId(stageId, index)`（`<stageId>#<组内序号>`）。
- `type` 沿用现有约定（`cmd` 才用 OSC 标记，其余按 prompt）。
- `advance` 缺省 `auto`；XML 解析不产出 `manual`，该分支留给带 `manual` 的定义。

### 二、`GroupRun` 扩展 `server/workflow-group-run.js`

- 构造函数增加可选 `finalStatus`（默认 `'paused'`，保持分组运行现状）。
- 步骤执行：`prompt` 步写 `text + doneMarker(token)` 等回显；`cmd` 步用 OSC 标记（现状不变）。
- `_succeedStep(i)`（某步完成）：标记该步 `done`、`currentIndex += 1`；然后
  - 若刚完成的步 `advance === 'manual'` → `status = 'paused'`、`_emit()` 后返回（**停在该步之后**，`currentIndex` 已指向下一个未执行步，其状态仍为 `waiting`）；
  - 否则按现状：有下一步则 `_beginStep(next)`，没有则 `_finishGroup()`。
- `_finishGroup()`：`status = finalStatus`（分组运行默认仍为 `'paused'`，整条工作流运行为 `'done'`），`_emit()`。
- `advance()`：
  - 当前步存在且状态为 `waiting`（manual 边界后的续跑）→ `_beginStep(currentIndex)`；
  - 当前步存在且已运行 → 沿用 `_succeedStep(currentIndex)`；
  - `currentIndex` 越界（分组末尾）→ `_finishGroup()`（保持既有行为）。
- 结果：「整条工作流」运行（`finalStatus: 'done'`）全自动跑完并置 `done`；带 `manual` 的定义在该步后 `paused`，人工点「下一步」继续。

### 三、`WorkflowRunner` 扩展 `server/workflow-runner.js`

新增方法：

```js
startAll({ workflowId, sessionId, finalStatus = 'done' })
```

- 用 `getWorkflows()`（返回 XML 解析后的 `{ id, label, stages }`）按 id 找到工作流；找不到返回 `{ ok:false, code:'not-found' }`。
- 用 `expandAllSteps(wf.stages)` 展开全部步骤。
- 会话校验同 `startGroup`（存在、`state === 'running'`）。
- 构造 `GroupRun(this, { id: wf.id, label: wf.label }, wf.label, steps, session, finalStatus)`，登记 `runs`/`_sessionRun`，执行首步，返回 `{ ok:true, run }`。
- 复用既有 `onStatus` 订阅、`advance`/`abort`、`get(runId)`。

`GroupRun` 的 `snapshot()` 已含 `workflowId/workflowName/status/currentIndex/steps/sessionId`，前端沿用。

### 四、WS 广播 `server/ws-gateway.js`

`workflowRunner.onStatus` 回调中，当 `connOf(runId)` 为空（定时触发的运行没有发起连接）时，向**所有**连接广播：

- `S2C.WF_STATUS`（带 `run.snapshot()`）；
- 结束时额外 `S2C.WF_FINISHED`。

`WF_NEXT`/`WF_ABORT` 已按 `runId` 全局查找 `workflowRunner.get`，任何连接都能继续/中止定时运行。

### 五、执行器 `server/scheduler/workflow-executor.js`（新）

```js
createWorkflowExecutor({ sessionManager, workflowRunner, resolveAgent, logger })
```

- `resolveAgent(agentId)`：由 `index.js` 注入，从 `loadDevflowConfig(configFile).agents.list` 找 `{ id, name, cmd }`。
- `start({ task, runId, logFile, onStatus })`：
  1. `resolveAgent(task.agentId)`；找不到 → 立即 `failed('agent-not-found')`。
  2. `sessionManager.create({ projectId: task.projectId, cwd: task.cwd, kind: 'agent', agentId, agentCmd: cmd, name: t('sched.wf.session_name', {...}) })`。
  3. 把 `sessionId` 与步骤清单写入 `logFile`（`fs.appendFileSync`）。
  4. `workflowRunner.startAll({ workflowId: task.workflowId, sessionId })`；返回 `not-found` → `failed('workflow-not-found')`。
  5. 订阅 `workflowRunner.onStatus`：把该 runId 的步骤开始/完成/暂停/结束追加到 `logFile`，并回调 `onStatus({ status, sessionId })`：
     - `running`/`paused` → `paused`（scheduler 记录为暂停中）；
     - `done` → `success`；
     - `failed` → `failed`；
     - `aborted` → `aborted`。
  6. 返回 `{ runId: wfRunId, sessionId, abort: () => workflowRunner.get(wfRunId)?.abort() }`。
- `stop()` 由 engine 调用返回的 `abort`。

### 六、调度引擎 `server/scheduler/engine.js`

- `createEngine` 增加注入 `workflowExecutor`（可为 `null`）。
- `startRun`：`task.type === 'workflow'` 时：
  - 若 `!workflowExecutor` → `finishImmediate(task, trigger, 'executor-unavailable')`；
  - 并发校验：`runner.count() + activeWorkflow.size >= maxConcurrent` → `max-concurrent`；
  - 生成 `runId`/`logFile`，写 `run`（新增字段 `sessionId: null`，`status: 'running'`），`activeWorkflow.set(task.id, runId)`，`emit('run-start')`；
  - 调 `executor.start(...)`，`onStatus` 中更新 run（含 `sessionId`）并在终态时清理 `activeWorkflow`、`scheduleTask` 重排、`emit('run-end')`。
- `stop(taskId)`：优先 `activeWorkflow.get(taskId)` 调 `abort`。
- `runIdOf`/`isRunning` 兼容 workflow（`activeWorkflow` 计入）。

### 七、任务存储与 manifest

- `server/scheduler/store.js`：`TYPES` 加 `'workflow'`；`validateTask` 中 `type === 'workflow'` 要求 `workflowId`、`agentId` 非空（`workflowId required` / `agentId required`）；`_buildTask` 保存 `workflowId`/`agentId`（其余分支字段置 `undefined`）。
- `server/scheduler/manifest.js`：`toManifest` 对 workflow 写 `m.workflow = { workflowId, agentId }`；`fromManifest` 读回；`toRel/toAbs` 不涉及路径。

### 八、装配 `server/scheduler/index.js` 与 `server/index.js`

- `createScheduler({ ..., workflowExecutor = null })` 透传给 `createEngine`。
- `server/index.js` 构造 `workflowExecutor = createWorkflowExecutor({ sessionManager, workflowRunner, resolveAgent: (id) => loadDevflowConfig(configFile).agents.list.find((a) => a.id === id), logger: log })` 并传入 `createScheduler`。
- 注意构造顺序：`workflowRunner`、`sessionManager` 需先于 `scheduler` 创建（现有顺序已满足）。

### 九、前端

- `web/src/scheduler/useScheduler.ts`：类型联合加 `'workflow'`。
- `web/src/scheduler/SchedulerView.vue`：
  - 类型下拉加 `workflow`；选中后显示「工作流」下拉（`GET /api/workflows-xml` 的 `workflows`，显示 `label`，值 `id`）与「Agent」下拉（`GET /api/agents` 的 `agents`，值 `id`）。
  - 表单校验：workflow 类型必须选工作流与 agent。
  - 任务列表/卡片显示 `工作流：<label> · Agent：<name>`（标签通过两份列表查名）。
  - 运行记录：`paused` 状态徽标；workflow 运行显示 `sessionId` 与「打开会话」按钮。
- `web/src/scheduler/format.ts`：`typeLabel`/`scheduleSummary` 支持 `workflow`。
- 「打开会话」：`SchedulerView` 新增可选 prop `onOpenSession: (sessionId: string) => void`；`App.vue` 传入 `openLiveSession`，实现为 `center.activateSession(sid)` + `terminal.switchTo(sid)`（`activateSession` 在页签不存在时会自动创建，`switchTo` 同步终端输出）。打开后首页欢迎层因页签非空而收起，主区即该 agent 终端，可看到工作流逐步写入的 prompt 与流式输出。
- 「点击进入工作流」：`workflow` 类型任务在操作区额外显示「打开运行会话」按钮；点击时 `loadRuns(taskId, 20)` 取最近一条带 `sessionId` 的运行 → 调 `onOpenSession`；没有则提示「该任务还没有运行记录，请先运行」。运行记录弹窗里每条运行也显示 `sessionId` 并可打开。

### 十、i18n

新增键（中英同步）：`sched.type.workflow`、`sched.wf.select`、`sched.wf.none`、`sched.agent.select`、`sched.wf.session_name`、`sched.wf.run_hint`、`sched.status.paused`、`sched.open_session`、`sched.wf.open`、`sched.wf.no_run`、`sched.wf.need_select`，以及执行器错误文案 `sched.err.agent_not_found`、`sched.err.workflow_not_found`。（`sched.status.paused` 已存在，复用不新增。）

## 影响文件

- 改 `shared/workflow-group.js`（+`expandAllSteps`）
- 改 `server/workflow-group-run.js`（`finalStatus` + manual 暂停）
- 改 `server/workflow-runner.js`（+`startAll`）
- 改 `server/ws-gateway.js`（无连接时广播）
- 新增 `server/scheduler/workflow-executor.js`
- 改 `server/scheduler/engine.js`、`store.js`、`manifest.js`、`index.js`
- 改 `server/index.js`（构造并注入执行器）
- 改 `web/src/scheduler/useScheduler.ts`、`SchedulerView.vue`、`format.ts`
- 改 `web/src/App.vue`（`openLiveSession` + 传入 `:on-open-session`）
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- 新增/改测试：`shared`/`server/test`/`web` 对应 `*.test.*`

## 测试计划

- `shared`：`expandAllSteps` 展开全部 stage（顺序、id、type、advance）。
- `workflow-group-run`/`workflow-runner`：`startAll` 全自动跑到 `done`；带 `manual` 步在该步后 `paused`，`advance()` 继续；`not-found`。
- scheduler store：workflow 任务校验（缺 workflowId/agentId 报错）+ manifest 往返。
- engine：注入假 executor，验证分派、并发上限、`stop` 调 `abort`、终态清理。
- workflow-executor：假 sessionManager + 真 WorkflowRunner，验证建会话参数（kind/agentId/agentCmd/name）、步骤日志、`paused→success` 状态回写、agent/workflow 缺失的失败。
- gateway：无绑定连接时 `WF_STATUS`/`WF_FINISHED` 广播到全部连接。
- web：SchedulerView 的 workflow 表单渲染/提交、format。
- 全量：`npm run test:server`、`npm run test:web`、`npm run typecheck`、`npm run check:i18n`。

## 已知风险

- 定时运行在**无人值守**下若某 prompt 步永不回显 done marker，会一直等待到 `stepTimeoutMs`（`WorkflowRunner.stepTimeoutMs`，默认 30 分钟）后 `failed`。这是既有行为，本次不额外处理。
- 自动新建的会话数量随触发累积（跑完保留），长期启用会堆会话；本次不做自动清理。
- 「打开会话」依赖 `App.vue` 的 `center.activateSession` 与 `terminal.switchTo`；定时运行的会话是**运行中**会话，已在 `terminal.state.sessions` 列表中，`activateSession` 会新建页签、`switchTo` 会拉取回放，无需走 RESTORE。
