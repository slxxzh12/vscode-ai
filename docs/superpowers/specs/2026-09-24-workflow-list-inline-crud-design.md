# 设计文档：「我的工作流」页签内联增删改工作流

日期：2026-09-24
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

左侧历史面板已有「我的工作流」页签（`HistoryList.vue` 的 `prompts` 页签，见 `2026-09-23-prompt-auto-workflow-design.md`），现在只把 `my-prompts` 这一个工作流的提示词摊平成列表展示，没有工作流层级，也没有任何增删改能力。

用户要求：

1. 该页签展示**全部工作流**（工作流 → 阶段 → 提示词三层）；
2. 工作流、阶段、提示词旁边都放**小小的 `＋` / `−`**；
3. 直接在界面里**新增一个小工作流**，或**删除整个工作流**；
4. `＋` / `−` 之外，还要支持**重命名工作流名/阶段名、编辑提示词文本**；
5. 提示词级 `＋` 的行为是**新建空提示词就地编辑**（不是复用收藏弹层）。

### 已与用户逐条确认的决定

| # | 决定 | 取值 |
|---|------|------|
| 1 | `＋`/`−` 操作哪些工作流 | **所有工作流（完整列表）**，展示工作流 → 阶段 → 提示词全树 |
| 2 | 编辑能力范围 | **加/减 + 重命名/编辑**（工作流名/阶段名可重命名，提示词可编辑文本） |
| 3 | 提示词级 `＋` 怎么加文本 | **新建空提示词就地编辑**（不用收藏弹层） |
| 4 | 页签标题 | **维持「我的工作流」不变** |
| 5 | 新增工作流 | 顶部 `＋ 新增工作流` 新建空工作流，名称就地输入 |
| 6 | 删除确认 | 删除工作流/阶段用 `window.confirm`；删除单条提示词不确认 |

## 2. 现状与落点

- **数据层**：`web/src/prompts/usePromptCollect.ts` 模块级单例 `workflows/current/lastTarget` + `loadWorkflows()` + `collect()`。`loadWorkflows` 读 `GET /api/workflows-xml`，`collect` 走 `POST /api/workflows` 全量写回。
- **收藏纯函数**：`web/src/prompts/promptCollect.ts`（`appendPromptToWorkflow`、`collectToMyWorkflow`、`promptAbbr`、常量 `MY_WF_ID`/`MY_STAGE_ID`）。
- **UI**：`web/src/components/HistoryList.vue` 的 `prompts` 页签（`:286-295`），当前渲染 `filteredPrompts`（`myPrompts` 摊平为 `{stage, text}`）。
- **模型**：`web/src/workflowModel.ts` 的 `Workflow`/`WorkflowStage` + `newWorkflow(label)`/`newStage(label)`/`uid(prefix)`。
- **读写接口**：`GET /api/workflows-xml` → `{ workflows }`；`POST /api/workflows { workflows }` 全量覆盖（`server/index.js:868-879`）。**本次服务端零改动**。

## 3. 关键方案选择

把 CRUD 逻辑放进**数据层 `usePromptCollect`**，新建一个纯渲染组件：

- 好处：`HistoryList` 与其它用到 `pc.workflows` 的地方（终端 chips 等）共享同一份状态，增删改后全局即时一致；每个操作都可单测。
- 备选（不采用）：在 `HistoryList.vue` 内直接拼 `fetch`（把数据逻辑塞进视图，难测且破坏「一个功能一个文件夹」）；复用 `WorkflowFormTab.vue`（完整表单编辑器太重，不符合「小 `＋`/`−`」的诉求，左栏也放不下）。

## 4. 详细设计

### 4.1 数据层 `web/src/prompts/usePromptCollect.ts`

在返回对象中新增以下方法（全部「本地改 `workflows` → `POST /api/workflows` 全量写回」，沿用 `collect()` 里已验证的 POST 模式，抽取一个私有 `persist(next: Workflow[]): Promise<boolean>` 帮助函数复用）：

```ts
export interface WorkflowCrud {
  addWorkflow(): Promise<boolean>;          // 用 newWorkflow(t('pc.new_workflow')) 追加，就地编辑名称
  removeWorkflow(wfId: string): Promise<boolean>; // 过滤掉整棵子树
  renameWorkflow(wfId: string, label: string): Promise<boolean>;
  addStage(wfId: string): Promise<boolean>;  // newStage(t('pc.new_stage')) 追加
  removeStage(wfId: string, stageId: string): Promise<boolean>;
  renameStage(wfId: string, stageId: string, label: string): Promise<boolean>;
  addPrompt(wfId: string, stageId: string): Promise<boolean>; // 追加空字符串 ''，就地编辑
  removePrompt(wfId: string, stageId: string, index: number): Promise<boolean>;
  setPrompt(wfId: string, stageId: string, index: number, text: string): Promise<boolean>;
}
```

- `persist(next)`：`POST /api/workflows`，成功后用返回的 `j.workflows` 刷新 `workflows.value`（保持与 `collect` 一致），失败返回 `false` 且**不改本地状态**。
- 每个方法先做浅拷贝生成 `next`，若目标不存在则直接返回 `false`（不误发请求）。
- 移除「入参被修改」风险：沿用 `collect` 的浅拷贝约定。

### 4.2 新组件 `web/src/prompts/WorkflowListPane.vue`

纯渲染组件（`defineProps<{ workflows: Workflow[] }>` + `emit('mutate', ...)` 或直接引入 `usePromptCollect`）。为保持数据一致，**直接 `import { usePromptCollect }` 复用同一单例**，组件内部调用 4.1 的 CRUD 方法；`onMounted` 时 `loadWorkflows()`。

结构：

```
[＋ 新增工作流]                                     ← 顶部按钮
▾ 工作流A  [名称输入框]                    −        ← 工作流行（折叠箭头 + 名称 + 删除）
   阶段A1 [名称输入框]  ＋  −                        ← 阶段行（名称 + 加提示词 + 删除阶段）
       [多行文本输入框]  −                            ← 提示词行（文本 + 删除）
       [多行文本输入框]  −
   阶段A2 ...
▾ 工作流B ...
```

- **工作流行**：折叠箭头（本地 `expanded` Set，默认全展开或记住展开态）＋ `label` 输入框（blur/回车触发 `renameWorkflow`）＋ `−`（`confirm` 后 `removeWorkflow`）。
- **阶段行**：`label` 输入框（blur/回车 `renameStage`）＋ `＋`（`addPrompt`）＋ `−`（`confirm` 后 `removeStage`）。
- **提示词行**：多行 `textarea`（blur 触发 `setPrompt`）＋ `−`（`removePrompt`，不确认）。
- 输入框未失焦前的本地草稿用 `v-model` 暂存，失焦才回写，避免每敲一个字就发一次 POST。
- 样式沿用 `HistoryList` 现有的 `.mrow`/`.mtext` 视觉风格与 CSS 变量，紧凑小号按钮（`＋`/`−` 用 `+`/`−` 或 `＋`/`−` 字符，不引 emoji）。

### 4.3 `web/src/components/HistoryList.vue`

- `prompts` 页签（`:286-295`）改为：

  ```html
  <template v-else-if="tab === 'prompts'">
    <WorkflowListPane />
  </template>
  ```

- 删除现有的 `myPrompts` / `filteredPrompts` / `PromptRow` 计算（`:71-89`），以及 `promptAbbr` / `MY_WF_ID` 的 import（`:10`）。
- 保留 `watch(() => props.tab, ...)` 里对 `loadWorkflows` 的调用或改由 `WorkflowListPane` 自己 `onMounted` 加载（后者更内聚，推荐）。
- `hasMore`/`onScroll`/`noMatch` 里对 `'prompts'` 的 guard 保留（仍不分页）。

### 4.4 服务端

零改动（`POST /api/workflows` 已是全量覆盖语义）。

## 5. i18n（`shared/i18n/zh-CN.js` + `en.js` 同步，前缀 `pc.`）

| key | zh-CN | en |
|---|---|---|
| `pc.new_workflow` | 新工作流 | New workflow |
| `pc.new_stage` | 新阶段 | New stage |
| `pc.add_workflow` | 新增工作流 | Add workflow |
| `pc.del_workflow` | 删除工作流 | Delete workflow |
| `pc.del_workflow_confirm` | 删除整个工作流及其所有阶段？ | Delete this workflow and all its stages? |
| `pc.del_stage` | 删除阶段 | Delete stage |
| `pc.del_stage_confirm` | 删除该阶段及其所有提示词？ | Delete this stage and all its prompts? |
| `pc.del_prompt` | 删除提示词 | Delete prompt |
| `pc.add_prompt` | 添加提示词 | Add prompt |

- 提交前 `npm.cmd run check:i18n` 零命中；中英键集合保持对称。
- 删除确认文案优先用新 `pc.del_workflow_confirm` / `pc.del_stage_confirm`（比复用 `wfe.del_confirm` 更精确，但后者亦可；本设计采用新词条）。

## 6. 边界情况

- **无任何工作流**：列表显示空态 + 顶部「新增工作流」按钮可用；点 `＋` 新建后立即进入编辑。
- **删除当前终端正在使用的工作流**：`workflows` 刷新后终端 chips 随 `pc.workflows` 同步消失（`collect`/`loadWorkflows` 都是全量刷，天然一致）。
- **POST 失败**：本地状态不改，弹出 `ElMessage.error`（复用 `pc.failed`）。
- **目标不存在**（并发下已删）：`remove/rename/add` 直接返回 `false`，不误发请求。
- **空提示词**：允许存在空 `''`（就地编辑中），但服务端 `sanitizeModel` 会过滤纯空白；本地编辑态的空串在未失焦前不落盘。
- **语言切换**：工作流/阶段 label 是已写入的数据，不随语言切换改写（与既有约定一致）。
- **手机端**：`PhoneView.vue` 不挂载左侧面板，不受影响。

## 7. 测试与验证

- `web/src/prompts/usePromptCollect.test.ts`（扩展）：
  - `addWorkflow` / `removeWorkflow` / `renameWorkflow` / `addStage` / `removeStage` / `renameStage` / `addPrompt` / `removePrompt` / `setPrompt` 各发一次 `POST /api/workflows`，且 body 含期望的全量列表；
  - POST 失败（`ok:false`）时不改 `workflows` 且返回 `false`；
  - 目标不存在时返回 `false` 且不发 POST。
- `web/src/prompts/WorkflowListPane.test.ts`（新增）：
  - 渲染全部工作流/阶段/提示词层级；顶部 `＋` 触发 `addWorkflow`；工作流 `−` 触发 `removeWorkflow`（mock confirm）；阶段 `＋` 触发 `addPrompt`；提示词 `−` 触发 `removePrompt`；名称/文本失焦触发对应 rename/set。
- 手工验收：`npm.cmd run dev` →
  1. 打开「我的工作流」页签 → 看到全部工作流树，每级都有 `＋`/`−`；
  2. 点「＋ 新增工作流」→ 新工作流出现，改名保存；
  3. 点工作流 `−` → 确认后整棵消失；
  4. 阶段内点 `＋` → 新空提示词，输入文本失焦保存；
  5. 点提示词 `−` → 立即删除；
  6. 切到终端，观察 chips 随增删即时变化。
- 命令：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 8. 影响面

- 新增：`web/src/prompts/WorkflowListPane.vue`、`web/src/prompts/WorkflowListPane.test.ts`。
- 修改：`web/src/prompts/usePromptCollect.ts`（新增 CRUD 方法）、`web/src/components/HistoryList.vue`（prompts 页签改挂新组件、删摊平计算）、`web/src/prompts/usePromptCollect.test.ts`、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`、`AGENTS.md`「目录速览」补一行。
- 不改：服务端、`workflowModel.ts` 数据结构、`workflowStore` 存储格式、`GET /api/workflows-xml` / `POST /api/workflows` 协议、`PromptCollectAddon.vue`、打包脚本。

## 9. 不做（明确排除）

- 不改页签标题（维持「我的工作流」）。
- 不做拖拽排序、批量操作、跨工作流移动阶段/提示词。
- 不把提示词级 `＋` 做成收藏弹层（已确认为「新建空提示词就地编辑」）。
- 不做端到端自动化测试（沿用单测 + 手工验证）。
- 不新增后端端点、数据库表或存储格式。
