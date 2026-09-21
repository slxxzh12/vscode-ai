# 设计文档：把会话消息 / 阶段提示「+」收藏进自定义工作流

日期：2026-09-21
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

用户在左侧会话里写过的提示词，目前只能靠历史面板回填输入框（`open-message`），或在工作流编辑器里手动复制。本设计给两处高频的提示语加一个「+」按钮，点了就能把该条文本**追加进任意工作流的任意阶段**，之后可在「编辑工作流」里继续精细配置。

两处入口（已与用户逐条确认）：

1. **左侧历史面板「消息」**：每条已发送消息（`HistoryList.vue` 的 `mrow`）加「+」；
2. **输入框上方的「常用」阶段提示 chips**：每个阶段提示（`TerminalView.vue` 的 `stageChips`）加「+」。

核心约束（已与用户逐条确认）：

| # | 决定 | 取值 |
|---|------|------|
| 1 | 提示来源 | 历史面板「消息」里的消息 + 阶段提示 chips（不含固定 1-5、不含文件页签、不含输入框实时内容） |
| 2 | 存储形态 | **不新增提示词库**；直接追加进目标工作流 XML 的 `stages[].prompts` |
| 3 | 目标选择 | **两者都要**：默认快速追加到「上次使用目标」（无则当前工作流/高亮阶段），另有下拉两级选择器（工作流 → 阶段） |
| 4 | 保存时机 | **点选即写入并保存**（`POST /api/workflows`，全量覆盖）；chips 由服务端 `CONFIG_CHANGED` 自动刷新 |
| 5 | 去重 | **同阶段内去重**：该阶段已含相同文本则跳过并提示「已存在」 |
| 6 | 实现方式 | 独立模块 `web/src/prompts/`（方案 1）：共享状态 composable + 复用控件 + 纯函数 |
| 7 | 保存冲突 | 沿用现有架构：POST 全量覆盖；collect 前先 GET 最新，不做额外并发合并 |

## 2. 现状与落点

- **读**：`GET /api/workflows-xml` → `{ workflows: Workflow[] }`（`server/index.js:612-617`，`ws.workflowStore.readAll()`）。
- **写**：`POST /api/workflows` body `{ workflows }` → `workflowStore.writeAll()` 全量覆盖（`server/index.js:809-822`；`server/workflow-store.js:43-58`），成功后广播 `S2C.CONFIG_CHANGED`（`server/index.js:818`）。
- **数据模型**：`Workflow { id, label, priority?, stages[] }`、`WorkflowStage { id, label, group?, prompts: string[] }`（`web/src/workflowModel.ts:1-12`）。
- **chips 落点**：`TerminalView.vue:1283-1305` 的 `.chipbar`；阶段提示在 `.chipstage` 内 `v-for="(c, i) in stageChips"`（`1286-1294`，`.chipwrap` 内已有 `.rback` 兄弟按钮先例）。`stageChips = chips.filter(c => !c.append)`（`715`），固定 1-5 是 `extraChips`（`716`）。
- **当前工作流/阶段**：`wfKind`（`TerminalView.vue:274`，`selectWf` 于 `902-903` 改）、`activeStage`（`709`，`pickStage` 于 `782-785` 改、`loadWorkflows` 于 `791-802` 兜底首阶段）。
- **消息行落点**：`HistoryList.vue` 平铺消息行 `279-289`、会话树消息行 `261-268`；行内删除键 `.x` 是**带 `@click.stop` 的 `<span>`**（`288`），「+」必须照此用 `<span>`（`.mrow` 本身是 `<button>`，不可嵌套 `<button>`）。
- **刷新链路**：TerminalView 已监听 `S2C.CONFIG_CHANGED` → `loadWorkflows()`（`955-960`），collect 后 chips 自动更新，无需新增广播。
- **模块级单例写法参照**：`web/src/useMessageHistory.ts`（`ref` + 模块级状态 + 防抖刷盘）。

## 3. 前端

### 3.1 新目录 `web/src/prompts/`

遵循「一个独立功能一个模块」，新增：

- `promptCollect.ts` —— 纯函数，无副作用，可单测。
- `usePromptCollect.ts` —— 模块级单例状态 + collect 编排（fetch）。
- `PromptCollectAddon.vue` —— 可复用的「+」控件（触发点 + 两级选择弹层）。
- `promptCollect.test.ts`、`usePromptCollect.test.ts` —— 单测。

### 3.2 `web/src/prompts/promptCollect.ts`（纯函数）

```ts
export type CollectResult =
  | { status: 'ok'; list: Workflow[] }
  | { status: 'exists'; list: Workflow[] }
  | { status: 'no-workflow' }
  | { status: 'no-stage' };

// 找到 wfId.stages[stageId]，text.trim() 为空直接按 exists 处理（不写）；
// 已含相同 trim 文本 → exists 且不改动；否则 push 原文本（保留用户原始缩进/换行）。
export function appendPromptToWorkflow(
  list: Workflow[], workflowId: string, stageId: string, text: string,
): CollectResult;
```

- 找不到 `workflowId` → `no-workflow`；找到工作流但找不到 `stageId`（或 `workflows` 为空）→ `no-stage`。
- 不修改入参，返回浅拷贝后的 `list`（`stages`/`prompts` 逐层复制），便于 undo/对比。
- 去重比较用 `String(p).trim() === text.trim()`；存储时写入**原文本**（不 trim，保留换行/缩进）。

### 3.3 共享状态 `web/src/prompts/usePromptCollect.ts`

模块级单例（照 `useMessageHistory`）：

```ts
export interface CollectTarget { workflowId: string; stageId: string; }
export function usePromptCollect(): {
  workflows: Ref<Workflow[]>;
  current: Ref<CollectTarget>;          // TerminalView 上报的当前工作流/高亮阶段
  lastTarget: Ref<CollectTarget | null>;// 上次使用的目标（localStorage 持久化）
  setCurrent(workflowId: string, stageId: string): void;
  loadWorkflows(): Promise<void>;       // GET /api/workflows-xml，写入 workflows
  collect(text: string, target?: CollectTarget): Promise<CollectResult['status'] | 'error'>;
};
```

- `current`：由 `TerminalView` 在 `selectWf` / `pickStage` / `loadWorkflows` 后调用 `setCurrent(wfKind, activeStage)` 上报。`activeStage` 为空时，`setCurrent` 内部兜底为该工作流首阶段（若 `workflows` 有缓存）。
- `lastTarget`：localStorage key `devflow-prompt-collect-target`，存 `{ workflowId, stageId }`；读取时解析失败/非法值一律忽略。
- 快速追加目标解析顺序：`lastTarget`（若在最新 `workflows` 中仍能找到）→ `current` → 第一个工作流的第一阶段 → 都没有则 `no-workflow`。
- `collect(text, target?)`：
  1. `await loadWorkflows()` 拿最新全量（避免用过时缓存覆盖）；
  2. 用 `appendPromptToWorkflow` 改内存；
  3. `status==='ok'` → `POST /api/workflows { workflows: list }`；失败返回 `'error'`；
  4. `status==='ok'` 时把该 target 记为 `lastTarget`；
  5. 返回状态串（`ok | exists | no-workflow | no-stage | error`）。
- 供 `PromptCollectAddon.vue` 调用；`TerminalView` 只用 `setCurrent`。

### 3.4 控件 `web/src/prompts/PromptCollectAddon.vue`

Props：`text: string`。根节点必须是 `<span>`（不能是 `<button>`，避免嵌套进消息行/chip 的按钮里）。

- 触发区：
  - 主体 `<span class="pcadd">+</span>`：`@mousedown.stop @click.stop` → **快速追加**（目标规则见 3.3）。
  - 右侧 `<span class="pccaret">▾</span>`：`@click.stop` → 打开两级选择弹层（`el-popover`，`trigger="click"`；Element Plus 已全局注册，见 `web/src/main.ts`）。
- 选择弹层内容：
  - `el-popover` 内两栏：左「工作流」列表，右显示所选工作流的「阶段」列表；
  - 顶部一个「上次使用」快捷项（`lastTarget` 存在时显示）；
  - 点阶段 → `collect(text, { workflowId, stageId })` → 关闭弹层 → 提示结果；
  - `workflows` 为空 → 显示 `pc.no_workflows`；所选工作流无阶段 → `pc.no_stages`；
  - 打开弹层时 `loadWorkflows()` 拉最新；`el-popover` 卸载/关闭时不保留。
- 结果提示：统一用 `ElMessage`（Element Plus 已注册），文案走 i18n（见第 4 节）；`exists` 用 `warning`、`ok` 用 `success`、`error`/`no-workflow` 用 `error`。
- 无工作流时：`+` 主体禁用（`class="disabled"`）且点击直接提示 `pc.no_workflows`。

### 3.5 `TerminalView.vue` 集成

- 引入 `usePromptCollect`，`setCurrent` 上报：
  - `selectWf`（`902-903`）末尾；
  - `pickStage`（`782-785`）末尾；
  - `loadWorkflows`（`791-802`）末尾（首阶段兜底之后）；
  - 用 `watch([wfKind, activeStage], ...)` 统一上报，避免每处遗漏（推荐做法）。
- 阶段提示 chips（`1286-1294` 的 `.chipwrap` 内、`.rback` 兄弟位置）加：
  ```html
  <PromptCollectAddon :text="c.text" />
  ```
  仅对 `stageChips` 渲染；固定 1-5（`extraChips`，`1296-1304`）不加。
- 不改 chips 既有 `@click="onChipClick(c)"`（收藏走 `.stop`，互不干扰）。

### 3.6 `HistoryList.vue` 集成

- 平铺消息行（`279-289`）与会话树消息行（`261-268`）：在 `.x` 之前插入
  ```html
  <PromptCollectAddon class="mpc" :text="row.item.text" />
  ```
- 控件根是 `<span>`，`@mousedown.stop @click.stop`，不影响行本身的 `open-message`。
- HistoryList 保持纯展示（不新增 props/emits）：控件内部直接调用 composable。
- 样式：`.mpc` 需 `flex: none`，与 `.x` 的 hover 显隐规则保持一致（参照 `.x` 现有 CSS）。

## 4. i18n

`shared/i18n/zh-CN.js` + `shared/i18n/en.js` **同步补齐**（键集合对称，前缀 `pc.`）：

| key | zh-CN | en |
|---|---|---|
| `pc.add` | 添加到工作流 | Add to workflow |
| `pc.quick` | 快速添加到「{wf} / {stage}」 | Quick-add to "{wf} / {stage}" |
| `pc.choose` | 选择工作流与阶段 | Choose workflow and stage |
| `pc.last_used` | 上次使用 | Last used |
| `pc.workflow` | 工作流 | Workflow |
| `pc.stage` | 阶段 | Stage |
| `pc.no_workflows` | 还没有工作流，请先在「编辑工作流」里新建 | No workflows yet — create one in "Edit workflow" first |
| `pc.no_stages` | 该工作流还没有阶段 | This workflow has no stages |
| `pc.ok` | 已添加到「{wf} / {stage}」 | Added to "{wf} / {stage}" |
| `pc.exists` | 「{stage}」已存在该提示语，未重复添加 | Already exists in "{stage}" |
| `pc.failed` | 添加失败：{msg} | Add failed: {msg} |

提交前 `npm.cmd run check:i18n` 必须零命中（注释/日志除外）。

## 5. 边界情况

- **无工作流**：快速追加禁用并提示 `pc.no_workflows`；选择弹层显示空态。
- **工作流无阶段**：`no-stage` → 提示 `pc.no_stages`。
- **目标已被删除**：`lastTarget` 指向的工作流/阶段在最新列表里找不到 → 回退到 `current`，并清理 `lastTarget`。
- **文本重复**：同阶段已有相同 trim 文本 → `exists`，不写盘、不改 `lastTarget`（也可选择仍记为 lastTarget；实现取「不写盘但关闭弹层并提示」，避免误以为失败）。
- **空文本**：消息/chip 文本理论上非空；纯空白 → 按 `exists` 处理，不发请求。
- **chips 上的首次快速追加**：`lastTarget` 为空、`current` 即该 chip 所在阶段 → 得到 `exists`（属预期）；用户改用下拉选择其他阶段后，`lastTarget` 生效，之后 + 即一键追加。
- **并发/覆盖**：collect 前 GET 最新；若同时打开着带未保存草稿的工作流编辑器，编辑器保存时仍按现有全量覆盖语义（既有约束，不在本次处理）。
- **多会话/多窗口**：`CONFIG_CHANGED` 广播保证各标签页 chips 同步刷新。
- **手机端**：手机入口是 `PhoneView.vue`，不挂载 `HistoryList`/App 侧栏，不受影响。

## 6. 测试与验证

- `web/src/prompts/promptCollect.test.ts`（vitest）：
  - 追加成功：返回 `ok`，目标阶段 `prompts` 末尾新增原文本，入参未被修改；
  - 去重：同阶段已有相同 trim 文本 → `exists` 且列表不变；不同阶段/不同文本不误判；
  - `no-workflow`（wfId 不存在）、`no-stage`（stageId 不存在或 workflows 为空）；
  - 空/纯空白文本。
- `web/src/prompts/usePromptCollect.test.ts`：mock `fetch`，验证 `collect` 的 GET→去重→POST 调用次序与 `lastTarget` 记录/回退；`exists` 时**不**发 POST。
- `web/src/components/HistoryList.test.ts`（扩展）：消息行渲染出 `PromptCollectAddon`（`.pcadd`），且点击不触发 `open-message`（`@click.stop` 生效）。
- 手工验收：`npm.cmd run dev`（:5173）→
  1. 左侧历史「消息」点某条 +→ 选「工作流/阶段」→ 提示成功；打开「编辑工作流」→ 对应阶段末尾出现该条；
  2. chips 上点 +→ 选目标 → chips 自动刷新（`CONFIG_CHANGED`）；
  3. 重复追加同一条 → 提示「已存在」，工作流不出现重复；
  4. 刷新页面后 + 的快速追加仍指向「上次使用目标」。
- 命令：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 7. 影响面

- 新增：`web/src/prompts/promptCollect.ts`、`usePromptCollect.ts`、`PromptCollectAddon.vue`、`promptCollect.test.ts`、`usePromptCollect.test.ts`。
- 修改：`web/src/components/TerminalView.vue`（chips 加控件 + 上报当前目标）、`web/src/components/HistoryList.vue`（消息行加控件 + 样式）、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`、`web/src/components/HistoryList.test.ts`、`AGENTS.md`「目录速览」补一行。
- 不改：服务端（复用既有 `GET /api/workflows-xml` 与 `POST /api/workflows`，无需新端点）、`workflowModel.ts` 数据结构、`workflowStore` 存储格式、工作流编辑器保存逻辑、`open-message` 行为、历史消息持久化（`message-history.jsonc`）、打包脚本。

## 8. 不做（明确排除）

- 不新增「我的提示词」独立存储 / 独立面板 / 独立页签（按用户选择的方案 2 语义：提示词直接进工作流）。
- 不在输入框实时内容上加「+」（只收历史消息与阶段提示）。
- 不改固定 1-5 快速答复 chips。
- 不给工作流编辑器加自动刷新（collect 广播已刷新终端侧；编辑器以打开时加载为准）。
- 不做 drag & drop 收藏、不做批量收藏/多选、不做撤销栈。
- 不做端到端自动化测试（沿用现有单测 + 手工验证）。
