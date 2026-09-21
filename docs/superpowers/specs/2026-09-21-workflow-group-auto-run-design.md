# 设计文档：工作流分组自动执行（分组 ▶、提示词 ID、失败回退）

日期：2026-09-21
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

终端输入框上方的工作流（数据源 `config/devflow.xml` 的 `workflow → stage(id,label,group) → prompts`，经 `GET /api/workflows-xml` 下发）目前只能手动点阶段/chip 逐个把提示词送进会话。本设计让它支持**按分组自动执行**：

1. 每个分组标签旁放一个 **▶ 启动按钮**，点击后该分组内所有提示词按顺序自动送给当前 Agent 会话执行；
2. **每个提示词有稳定 ID**（`<stageId>#<序号>`），运行时逐步显示状态（▶ 运行中 / ✓ 完成 / ✕ 失败）；
3. **分组是暂停边界**：一组跑完自动停下，等用户点下一组的 ▶ 再继续；
4. **失败可回退**：自动判定失败后停下，任一步的 chip 旁提供 `↺`，可回退到该提示词 ID 并自动重跑。

复用已存在但前端未挂载的 WS 后端 `WorkflowRunner`（`server/workflow-runner.js`）；不重新挂载旧的 `WorkflowPanel.vue` 面板，UI 全部内联在输入框区域。

核心约束（已与用户逐条确认）：

| # | 决定 | 取值 |
|---|------|------|
| 1 | 改造对象 | WS `WorkflowRunner`（复用后端），驱动源为 `config/devflow.xml` 工作流 |
| 2 | 数据源 | `config/devflow.xml` 的 `workflow → stage(group) → prompts`；命令步骤为可选扩展 |
| 3 | 步骤类型 | 支持两类：`cmd` 用 OSC 完成标记，`prompt` 用 agent 回写的 token |
| 4 | 完成判定 | prompt 步发送时追加一行「完成后输出 `DF_DONE:<runId>:<i>`」（`<i>` = 组内步骤序号），服务端匹配 token |
| 5 | 失败判定 | 自动判定 + 人工兜底：会话退出/写入失败/硬超时 → 该步 ✕、停止；用户可 `↺` 回退 |
| 6 | 分组语义 | 分组 = 暂停边界：组内自动串行，组末停，等确认再进下一组 |
| 7 | 启动入口 | 每个分组标签旁一个 ▶ 三角按钮，点它跑整组 |
| 8 | 状态/回退 UI | 内联在阶段/prompt chip 上：状态图标 + 失败步旁 `↺`；不加新面板 |
| 9 | 运行持久化 | 不做（刷新/重启即丢，v1） |

## 2. 现状与落点

- 工作流定义：`shared/workflow-xml.js`（解析/序列化，含 `stage.group`）、`server/devflow-config.js`（`loadDevflowConfig` 每次现读、不缓存）、`server/workflow-xml.js`（server 侧解析 + fallback）。
- WS runner（已存在、后端已接线）：`server/workflow-runner.js`（`WorkflowRunner`/`Run`，`buildMarkerCmd` 注入 OSC 标记判定 auto 步）；`server/ws-gateway.js:131` 的 `handleWorkflow`（`WF_LIST/WF_RUN/WF_NEXT/WF_ABORT`）；`server/index.js:363` 装配，当前工作流数组来自 `workflows.json`（`server/index.js:262`）。
- 前端未挂载组件：`web/src/components/WorkflowPanel.vue`（原挂 `web/src/App.vue`，已于提交 `f5bbdfd` 移除）。本设计**不重新挂载**它。
- 当前分组 UI：`web/src/components/TerminalView.vue` 的 `stageGroups`（`:698`）、`flowbar` 模板（`:1211`）、`chips`（`:709`）、`pickStage/onChipClick`（`:717`/`:730`）、`sendPromptTo`（`:777`）；工作流模型纯函数在 `web/src/workflowModel.ts`（`groupBands` 等）。
- OSC 标记工具：`server/pty-runner.js:32` `buildMarkerCmd`（Windows 用 `[char]27` 构造 ESC，已实测透传）。

## 3. 数据模型与 ID

- **JSON 模型不变**：`workflow { id, label, stages[] }`，`stage { id, label, group, prompts[] }`。**不新增 XML 属性**。
- **prompt 稳定 ID** = `` `${stageId}#${promptIndex}` ``（如 `code#0`、`design#1`）；仅在 UI 显示与回退定位使用。stage id 或顺序变化时 ID 随之变化（可接受，v1 不追求跨编辑稳定）。
- **分组分组规则**沿用 `groupBands`：连续相同 `group` 的 stages 为同一组，组名空串也算一组。
- **运行期步骤 token** 用 `runId` + 组内序号（`i`）编码，避免 ID 里的 `#` 等字符进入 token：`DF_DONE:<runId>:<i>`。
- **命令步骤（可选扩展）**：`<stage type="cmd">` 时其 prompts 视为 shell 命令，走 OSC 标记判定；默认 `type="prompt"`。v1 不强制实现 UI 编辑，只让 runner 识别该属性。

## 4. 服务端 `WorkflowRunner` 扩展

### 4.1 数据源改为 provider

`WorkflowRunner` 构造参数由 `workflows` 数组改为 `getWorkflows: () => Workflow[]`；由 `server/index.js:363` 注入 `() => loadDevflowConfig(configFile).workflows`（每次 `start` 现读，符合「服务端不缓存 xml」约定）。`server/index.js:262` 的 `loadWorkflows(workflowsFile)` 保留给旧 paths 逻辑，不再作为 runner 数据源。

### 4.2 分组运行模型（`GroupRun`）

新增按分组运行（与现有整条 workflow 的 `Run` 并存，互不影响）：

- 入参：`{ workflowId, groupAnchor, sessionId }`，`groupAnchor` = 该组首个 stage 的 id（用于定位分组，避免同名分组歧义）。
- 展开：找到该 workflow 中 anchor 所在 stage 的下标，向后取连续相同 `group` 的 stages；把它们的 prompts 按 (stage 顺序, prompt 顺序) 摊平为线性 steps。
- step：`{ id: '<stageId>#<idx>', stageId, index, text, type: 'prompt'|'cmd', status, startedAt, finishedAt }`。
- 组内自动串行；每步完成后进下一步；全部完成 → `status='paused'`（组完成，等待下一组 ▶）。`paused` 的 run 保留在内存，允许回退/中止。
- 同一会话已有 `paused`/`failed` 的 run 时，对**新分组**点 ▶ → 先结束旧 run（置 `done`），再创建新 run；同一分组重复点 ▶ → 视为重启该组。

### 4.3 完成与失败判定

- **prompt 步发送文本** = 用户提示词原文 + 空行 + 一行追加指令（i18n，用当前服务端语言），例如：
  `[DevFlow] 完成后请在最后单独输出一行：DF_DONE:<runId>:<i>`
- 服务端在会话输出流（复用现有 `sessionManager` 的 `data` 事件订阅）中匹配 `DF_DONE:<runId>:<i>` → 该步成功。
- **cmd 步**：`buildMarkerCmd(text, runId, i, shell)`，匹配 `ESC]777;dfdone;<runId>_<i>BEL`（现有实现）。
- **失败**（自动）：`session exited` / `session removed` / 写入失败 / **硬超时**（常量 `STEP_TIMEOUT_MS`，默认 30 分钟，按步计时）→ 该步 `status='error'`，run `status='failed'`，停止并广播。v1 不做错误关键词匹配。
- **人工兜底**：`failed`/`paused` 的 run 可 `↺` 回退（见 4.4），或 `WF_ABORT` 结束。

### 4.4 回退

新增 `rollback(runId, stepId)`：定位 step 下标，把该步及其后所有步 `status` 重置为 `waiting`、清 `startedAt/finishedAt`，run 置 `running`，从该步重新串行执行（重发该提示词及后续）。若调用时正有步在运行，不尝试中断 Agent（用户可用现有「取消/undo」），只重设游标并发送目标提示词——在文档中标注该限制。

### 4.5 快照

`snapshot()` 增加 `groupName` 与 `steps[{ id, stageId, status, label }]`；供前端按 `id` 匹配 chip 渲染状态与 `↺`。

## 5. WS 协议（`shared/index.js` + `shared/index.d.ts`）

- `C2S.WF_RUN`：载荷扩展 `{ workflowId, groupAnchor?, sessionId }`；带 `groupAnchor` = 分组运行，不带 = 保持旧整条运行（向后兼容）。
- 新增 `C2S.WF_ROLLBACK = 'wf-rollback'`：`{ runId, stepId }`。
- S2C 复用 `WF_STATUS`/`WF_FINISHED`；`WorkflowRunner.onStatus` 既有广播逻辑（`server/ws-gateway.js:161`）不改结构，仅在 payload 里多字段。

## 6. 前端（`web/src/components/TerminalView.vue` + `web/src/workflowModel.ts`）

- **纯函数抽到 `workflowModel.ts`** 并单测：`promptStepId(stageId, i)`、`groupSteps(stages, anchorStageId)`（展开分组为线性步骤）。
- **▶ 按钮**：`flowbar` 的每个分组的 `fglabel` 旁（`:1214`）加 `▶`，仅 `activeIsAgent` 且会话可写时可用；点击 `terminal.send(C2S.WF_RUN, { workflowId: wfKind, groupAnchor: 该组首个 stage 的 id, sessionId: activeSessionId })`。
- **运行中状态**：新增 ref 保存当前 `run`（订阅 `S2C.WF_STARTED/WF_STATUS/WF_FINISHED`）；由 `steps` 建立 `Map<stepId, status>`。渲染时：
  - 阶段按钮/chip 按所属 stage 与 index 取到 `stepId`，叠加状态图标（▶/✓/✕）；
  - 当前运行步高亮；
  - `failed` 的步骤在 chip 旁显示 `↺` → `terminal.send(C2S.WF_ROLLBACK, { runId, stepId })`；
  - 运行中在分组 ▶ 位置显示 `■` 中止（`WF_ABORT`）。
- **不改现有 chip 行为**：`pickStage`（填入）与 `onChipClick`（填入/发送）逻辑保持；状态只作装饰叠加。
- 切换工作流/会话时清空本地 run 缓存。

## 7. i18n

新增词条（`shared/i18n/zh-CN.js` + `en.js`，键集合对称）：

| key | zh-CN | en |
|---|---|---|
| `wf.group.run` | 运行本组 | Run this group |
| `wf.group.stop` | 中止本组运行 | Stop this group run |
| `wf.step.rollback` | 回退到该步并重跑 | Roll back to this step and rerun |
| `wf.step.pending` | 等待 | Waiting |
| `wf.step.running` | 运行中 | Running |
| `wf.step.done` | 完成 | Done |
| `wf.step.error` | 失败 | Failed |
| `wf.done_marker` | `[DevFlow] 完成后请在最后单独输出一行：DF_DONE:{token}` | `[DevFlow] When finished, output a single line at the end: DF_DONE:{token}` |

其中 `{token}` = `<runId>:<i>`（见 4.3），服务端按同一字符串匹配。

提交前 `npm.cmd run check:i18n` 必须零命中（代码注释/日志除外）。

## 8. 边界情况

- **组内无提示词**：▶ 直接置组完成（`paused`），不发任何内容。
- **非 Agent 会话 / 无活动会话**：不显示 ▶（沿用现有 `activeIsAgent` 门槛）。
- **会话中断**：run 置 `failed` 并广播；重开会话后需重新点 ▶（v1 不自动续跑）。
- **Agent 未回写 token**（如反问、卡住）：等硬超时后标 ✕，用户可 `↺` 或手动处理。
- **Agent 提前回显 token**（把指令当正文复述）：可能被误判完成；v1 接受，实测后再调（如要求 token 独占一行且前后无内容）。
- **回退时该步正在运行**：不中断 Agent，只重设游标并重发目标提示词（文档标注）。
- **切换分组/工作流**：本地 run 缓存清空；旧 run 保留在服务端直到被新 run 取代或 `WF_ABORT`。
- **`workflows.json` 旧运行路径**：`WF_RUN` 不带 `groupAnchor` 时保持旧行为，不受影响。

## 9. 测试与验证

- `server/test/workflow-runner.test.js`（扩展）：分组展开（anchor 定位 + 连续 group 边界）、prompt 步匹配 `DF_DONE` token 成功、组末 `paused`、`↺` 回退后从该步重发、硬超时标 `error`（注入可控时钟/常量）、会话退出标 `failed`；cmd 步沿用既有 OSC 用例。
- `server/test/ws-gateway-workflow.test.js`（扩展）：`WF_RUN` 带 `groupAnchor` 的 started/status、`WF_ROLLBACK` 消息、非法 `runId/stepId` 返回 ERROR。
- `web/src/workflowModel.test.ts`（扩展）：`promptStepId`、`groupSteps` 的纯函数用例（含同名分组、空组、多 prompt stage）。
- 手工验收：`npm.cmd run dev` → 打开 Agent 会话 → 点某分组 ▶ → 观察组内提示词依次发送、chip 状态变化、组末停下；制造失败（关会话/超时）验证 ✕ 与 `↺` 重跑；点下一组 ▶ 继续。
- 命令：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 10. 影响面

- 修改：`server/workflow-runner.js`、`server/ws-gateway.js`、`server/index.js`、`shared/index.js`、`shared/index.d.ts`、`web/src/components/TerminalView.vue`、`web/src/workflowModel.ts`、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`，以及上述测试文件。
- 不改：`shared/workflow-xml.js` / `server/workflow-xml.js` 的 XML 结构、`config/devflow.xml` 模板、`WorkflowPanel.vue`（保持未挂载）、`workflows.json` 旧运行路径、`void.db`、协作/打包子系统。

## 11. 不做（明确排除）

- 运行状态持久化（刷新/重启续跑）。
- 跨分组自动连跑（组末必停）。
- 错误关键词匹配、基于输出静默的完成判定（改用 token 方案）。
- 在 XML 里为每个 prompt 写入显式 `id` 属性。
- 重新挂载或删除旧 `WorkflowPanel.vue`。
- 向非 Agent 会话发送工作流提示词。
- 端到端自动化测试（沿用现有单测 + 手工验证）。
