# 设计文档：无工作流时自动建「我的工作流」+ 左侧缩写页签

日期：2026-09-23
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

现有「+」收藏（见 `2026-09-21-collect-prompt-to-workflow-design.md`）在没有任何工作流时直接报错：`pc.no_workflows`（「还没有工作流，请先在『编辑工作流』里新建」，`PromptCollectAddon.vue:86,147`）。用户要求：

1. **不要提示用户没有工作流**；
2. 没有工作流时，**自动创建一个名为「我的工作流」的工作流**（含一个默认阶段），把收藏的提示词放进去；
3. 收藏的提示词在界面上以**缩写名**展示（取首行，过长截断），**悬停/展开看完整原文**；
4. 新增的「我的工作流」提示词要能在**左侧直接看到**，点击把完整原文送进终端输入框复用。

### 已与用户逐条确认的决定

| # | 决定 | 取值 |
|---|------|------|
| 1 | 「我的工作流」是什么 | **真的自动新建一个工作流**，label「我的工作流」，含一个默认阶段；之后 + 默认收进它，不再报错 |
| 2 | 存进工作流的文本 | **存完整原文**（与现有手动收藏一致） |
| 3 | 界面上的缩写 | 缩写名取**首行**（第一个换行前），仍过长再按字符截断加 `…`；悬停/展开看全文 |
| 4 | 存储方式 | 工作流里**仍存完整原文**，缩写只在 UI 层派生（**不改数据结构** `prompts: string[]`） |
| 5 | 展示位置 | **两处都做**：工作流编辑器里长提示词显示缩写；左侧历史面板新增页签「我的工作流」展示缩写列表 |
| 6 | 左侧页签摆放 | 历史面板**顶部新增页签**「我的工作流」（与「消息 / 目录 / 文件」并列） |
| 7 | 页签点击行为 | 点击一条 → 把**完整原文**送进当前终端输入框（复用既有 `df-fill-composer`） |
| 8 | 默认阶段名 | 「常用提示词」 |

## 2. 现状与落点

- **收藏数据层**：`web/src/prompts/promptCollect.ts`（纯函数 `appendPromptToWorkflow`）、`web/src/prompts/usePromptCollect.ts`（模块级单例 `workflows/current/lastTarget` + `collect()`）。
- **收藏 UI**：`web/src/prompts/PromptCollectAddon.vue`（`＋` 快速追加 + `▾` 两级选择弹层；无工作流时 `quickAdd` 直接报错、弹层显示空态文案）。
- **目标解析**：`usePromptCollect.ts:40-47` `resolveTarget()`，`lastTarget`→`current`→第一个工作流首阶段，全无则 `null`。
- **读写接口**：`GET /api/workflows-xml` → `{ workflows }`；`POST /api/workflows { workflows }` 全量覆盖（`server/index.js`）。**本次服务端零改动**。
- **数据模型**：`Workflow { id, label, priority?, stages[] }`、`WorkflowStage { id, label, group?, prompts: string[] }`（`web/src/workflowModel.ts:1-12`），已有 `newWorkflow(label)` / `newStage(label)`。
- **左侧面板**：`web/src/components/HistoryList.vue`，页签类型 `SideTab = 'files' | 'messages' | 'tree'`（`:11`），el-tabs 表头在 `:210-214`，内容按 `tab` 分支渲染（`tree` 用 `TreeView`，其余走 `list`）。父组件 `App.vue` 维护 `historyTab`（`:191`）、`SIDE_TABS`（`:196`）、`isSideTab`（`:205`）、`windowState.ts` 的 `HistoryTab`（`:5`）。
- **点击回填链路**：`HistoryList` emit `open-message` → `App.vue:382-385 onOpenMessage()` → `window.dispatchEvent(new CustomEvent('df-fill-composer', { detail: { text } }))` 填入终端输入框。**复用即可，App 点击路由零改动**。

## 3. 关键方案选择

自动建「我的工作流」的逻辑放在**数据层 `usePromptCollect.collect()`**：

- 好处：`PromptCollectAddon` 只负责 UI；左侧新页签读同一份模块级 `pc.workflows`，收藏后状态天然一致，无需额外事件；
- 备选（不采用）：放在 `PromptCollectAddon.vue`（UI 与数据耦合、左侧拿不到即时状态）；新增后端端点（违反既有「提示词收藏服务端零改动」约束）。

## 4. 详细设计

### 4.1 纯函数 `web/src/prompts/promptCollect.ts`

新增常量与函数（无副作用，可单测）：

```ts
export const MY_WF_ID = 'my-prompts';
export const MY_STAGE_ID = 'my-prompts-stage';

// 取首行（第一个 \n 或 \r 之前）→ trim → 超过 max 截断并加 '…'；空/纯空白返回 ''
export function promptAbbr(text: string, max?: number): string; // max 默认 40

// list 中已有 MY_WF_ID 工作流 → 复用它（缺阶段则补一个阶段）；
// 否则新建工作流 + 阶段（labels 由调用方用 i18n 传入）。
// 把完整原文追加进去（复用 appendPromptToWorkflow 的去重语义）。
export function collectToMyWorkflow(
  list: Workflow[], text: string,
  labels: { wfId: string; wfLabel: string; stageId: string; stageLabel: string },
): { status: 'ok' | 'exists'; list: Workflow[]; workflowId: string; stageId: string };
```

- `collectToMyWorkflow` 只在 `resolveTarget()` 为 `null` 时被调用；若 list 中已存在同 id 工作流但无阶段，则补阶段后再追加，不新建重复工作流。
- 追加去重、浅拷贝（入参不被修改）沿用 `appendPromptToWorkflow`。
- **空文本守卫**：`text.trim()` 为空时直接返回 `{ status: 'exists', list, workflowId, stageId }`（阶段 id 取 `MY_STAGE_ID`），**不创建任何工作流、不写盘**，避免留下空工作流。
- 去重命中（同阶段已有相同 trim 文本）时返回 `'exists'` 且 `list` 不变，`collect` 据此不发 POST。

### 4.2 数据层 `web/src/prompts/usePromptCollect.ts`

- `collect(text, target?)`：`resolveTarget(target)` 为 `null` 时改走 `collectToMyWorkflow`，成功后 `POST /api/workflows`、写 `lastTarget`、刷新 `workflows`，返回 `'ok'`。**不再产生 `'no-workflow'`**（`CollectStatus` 里移除该值；`'no-stage'` 保留，用于显式传入的失效目标）。
- 无工作流时不再返回错误；POST 失败仍返回 `'error'`。
- i18n labels 直接由 `usePromptCollect.ts` 引入 `t`（`import { t } from '../i18n'`）调用 `t('pc.my_workflow')` / `t('pc.my_stage')` 生成，不新增参数传递层。

### 4.3 控件 `web/src/prompts/PromptCollectAddon.vue`

- `quickAdd()`：删除 `if (!hasWorkflows) { error; return }` 守卫，直接 `collect`（无工作流时自动建）。
- `▾` 弹层：`hasWorkflows === false` 时不再显示 `pc.no_workflows`，改显示一个按钮「添加到『我的工作流 / 常用提示词』」，点击等同 `quickAdd`。
- `toast()`：移除 `no-workflow` 分支（保留 `exists` / `no-stage` / `error`）。

### 4.4 左侧新页签「我的工作流」`web/src/components/HistoryList.vue`

- 类型扩展：`SideTab` 增加 `'prompts'`（`HistoryList.vue:11`）；`windowState.ts:5` 的 `HistoryTab`、`App.vue:191` 的 `historyTab` 联合类型、`App.vue:196` 的 `SIDE_TABS` 同步加 `'prompts'`。
- 表头：`el-tabs` 内新增 `<el-tab-pane :label="$t('pc.my_workflow')" name="prompts" />`，放在**第一个**（当前 `messages` 之前）；`activeTab` v-model 仍由父组件 `App.vue` 的 `historyTab` 控制，新增值不改变默认选中页。
- 数据：复用 `usePromptCollect()`；`watch(() => props.tab, ...)` 在切到 `'prompts'` 时调用 `loadWorkflows()`。
- 计算：`myWorkflow = pc.workflows.value.find(w => w.id === MY_WF_ID)`；把各阶段提示词展开为 `{ stageLabel, text }` 列表（可按阶段分组展示）。
- 渲染：每条显示 `promptAbbr(text)`，`title` 为完整 `text`；点击 `emit('open-message', text)`（完整原文回填输入框）。搜索框按 `query` 过滤（匹配完整 `text`）。
- 空态：`$t('hist.empty_prompts')`（「还没有收藏的提示词」），**不是**「没有工作流」提示。
- `hasMore` / `onScroll` / `noMatch`：对 `'prompts'` 页签做 guard（不分页；`noMatch` 按提示词过滤，避免误用 messages/files 分支）。
- 样式：行样式复用现有 `.mrow`/`.mtext`（首行缩写由 `promptAbbr` 产出，必要时再加 CSS 省略号兜底）。

### 4.5 工作流编辑器里的缩写展示（`web/src/components/WorkflowFormTab.vue`）

- 提示词行 `.prow`（`:172-178`）在 `CodeEditor` 前加一个紧凑缩写标签：
  ```html
  <span v-if="p.trim()" class="pabbr" :title="p">{{ promptAbbr(p) }}</span>
  <CodeEditor class="ta" ... />
  ```
- `CodeEditor` 仍是**完整原文**的编辑区（不改其 `model-value`/`@change`）；缩写标签只是可悬停的短名（`title` = 完整原文）。
- 新增 `.pabbr` 样式（`flex: none`、`max-width` + `text-overflow: ellipsis`、`color: var(--tx3)`），放到 `.ta` 左侧、`.handle` 之后。
- 不改 `WorkflowEditor` 的加载/保存、XML 序列化与数据结构。

## 5. i18n（`shared/i18n/zh-CN.js` + `en.js` 同步，前缀 `pc.` / `hist.`）

| key | zh-CN | en |
|---|---|---|
| `pc.my_workflow` | 我的工作流 | My workflows |
| `pc.my_stage` | 常用提示词 | Common prompts |
| `pc.add_to_mine` | 添加到「我的工作流 / 常用提示词」 | Add to "My workflows / Common prompts" |
| `hist.empty_prompts` | 还没有收藏的提示词 | No saved prompts yet |

- 删除两个文件中不再使用的 `pc.no_workflows`（现有唯一使用点在 `PromptCollectAddon.vue`，本次移除）。
- 提交前 `npm.cmd run check:i18n` 零命中（注释/日志除外）；中英键集合保持对称。

## 6. 边界情况

- **首次收藏（无工作流）**：自动建「我的工作流 / 常用提示词」并写入；toast 用 `pc.ok`（正常成功提示，不是错误）。
- **已有「我的工作流」**：直接复用，不重复新建；同阶段重复文本 → `exists`，不写盘。
- **「我的工作流」存在但无阶段**：补一个「常用提示词」阶段后追加。
- **其他工作流已存在且可用**：`resolveTarget` 正常返回，行为与现在一致（不会新建）。
- **显式传入失效目标**：仍返回 `no-stage`，toast 提示。
- **空 / 纯空白文本**：不创建工作流、不写盘，按 `exists` 处理（消息/提示词理论上非空）。
- **左侧页签为空**：显示 `hist.empty_prompts`，不提示「没有工作流」。
- **语言切换**：工作流/阶段 label 是创建时写入的**数据**，切换语言不会改写已存在的 label（可接受）。
- **手机端**：`PhoneView.vue` 不挂载左侧面板，不受影响。

## 7. 测试与验证

- `web/src/prompts/promptCollect.test.ts`（新增）：
  - `promptAbbr`：首行提取、trim、超长截断加 `…`、空/纯空白返回 `''`、多行取首行；
  - `collectToMyWorkflow`：空列表 → 新建工作流+阶段并写入；已有同 id 工作流 → 复用；已有工作流但无阶段 → 补阶段；重复文本 → `exists`；入参不被修改。
- `web/src/prompts/usePromptCollect.test.ts`（修改）：
  - 第 45-50 行「无工作流 → no-workflow，且不发 POST」改为「无工作流 → 自动建并 `ok`，发 POST，POST 体含新工作流与文本」，并断言 `lastTarget` 指向新工作流/阶段。
- `web/src/components/HistoryList.test.ts`（扩展）：切到 `prompts` 页签渲染出收藏的缩写；空态显示 `hist.empty_prompts`；点击行 emit `open-message` 且文本为完整原文。
- 手工验收：`npm.cmd run dev` →
  1. 清空所有工作流后，在左侧「消息」点 `＋` → 不再报错，自动建「我的工作流 / 常用提示词」并提示成功；
  2. 切到左侧「我的工作流」页签 → 看到该条的首行缩写，悬停显示全文，点击把全文填入终端输入框；
  3. 再次收藏另一条（多行消息）→ 列表新增首行缩写；
  4. 打开「编辑工作流」→ 长提示词显示缩写、悬停看全文；
  5. 重复收藏同一条 → 提示已存在，不重复。
- 命令：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 8. 影响面

- 新增：无（沿用 `web/src/prompts/` 模块，补纯函数与用例）。
- 修改：`web/src/prompts/promptCollect.ts`、`usePromptCollect.ts`、`PromptCollectAddon.vue`、`web/src/components/HistoryList.vue`、`web/src/components/WorkflowFormTab.vue`（`.prow` 加缩写标签）、`web/src/windowState.ts`、`web/src/App.vue`（`historyTab`/`SIDE_TABS` 类型）、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`、`web/src/prompts/promptCollect.test.ts`、`web/src/prompts/usePromptCollect.test.ts`、`web/src/components/HistoryList.test.ts`、`AGENTS.md`「目录速览」补一行。
- 不改：服务端、`workflowModel.ts` 数据结构、`workflowStore` 存储格式、`GET /api/workflows-xml` / `POST /api/workflows` 协议、`open-message` 行为、打包脚本。

## 9. 不做（明确排除）

- 不新增独立提示词存储 / 新数据库表（缩写只在 UI 层派生，原文仍进工作流 `prompts`）。
- 不做自动摘要 / AI 缩写（缩写规则固定为「首行 + 截断」）。
- 不做左侧页签的拖拽排序、批量操作、编辑/删除（编辑仍去「编辑工作流」）。
- 不自动迁移/合并已有工作流；不改用户已有数据的 label。
- 不做端到端自动化测试（沿用单测 + 手工验证）。
