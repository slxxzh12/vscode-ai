# 设计文档：空白首页（欢迎页 + 小工具入口）

日期：2026-09-20
分支：master
状态：已与用户确认方案（待实现）

## 1. 概述

现状：首次进入界面、没有任何会话时，`TerminalView.vue` 会在收到 `SESSION_LIST` 后**强制新建并打开一个默认 Agent 会话**（`else startAgent()`）。用户不希望在没主动操作时就开出一个 Agent 页签/窗口。

改为：首次进入（无页签）时中心区显示一个**欢迎页**——
- 「新建 Agent」作为最显眼的主推荐按钮；
- 下方以卡片形式**介绍**各小工具，点卡片直接跳到「应用市场」页并**自动打开对应小工具**。

需求原文（用户）：

> 第一次界面时候，一个页签也没有，不要强行打开一个 agent，而且打开一个窗口，不要搞成强制。
> 在界面上展示一堆小工具，当前新建 Agent 作为最主要的推荐的，其他的小工具，放到首页介绍即可，用户直接跳转小工具页面，并且打开对应的小工具。

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 首次进入的形态 | 完全空白：不开任何页签、不自动建 Agent 会话 |
| 2 | 打开 Agent 的时机 | 仅用户主动操作（欢迎页/应用市场点「新建 Agent」，或标签栏「＋ 新建会话」） |
| 3 | 「窗口」的含义 | 即上面那个自动强开的 Agent 终端，与决策 1 是同一件事，不单独处理 |
| 4 | 小工具归属 | 不拆独立页，仍留在现有 🏪「应用市场」页；欢迎页只做介绍入口 |
| 5 | 点小工具卡片 | 切到「应用市场」页并自动打开该工具 |
| 6 | 应用市场页 | 增加一个显眼的「新建 Agent」入口 |
| 7 | 刷新恢复 | 保留：刷新后仍按「最近 N 个页签」恢复；服务端重启恢复的 Agent 会话仍被认领（属重连，非强开） |

## 3. 现状（改动前）

- 自动开 Agent：`web/src/components/TerminalView.vue:861-883` 的 `SESSION_LIST` 处理：认领 `pickRestoredAgent` → 复用已在运行的固定 Agent → 都没有则 `startAgent()`（强开）。
- 空白中心区没有专门的空态：无页签时 `isSessionView` 为真，显示一个空终端。
- 小工具：`web/src/components/MiniTools.vue` 定义 5 个工具（`translate/yaml/js/sort/postman`），全部开在 fullscreen `el-dialog`；工具元数据 `TOOLS` 内联在组件里，未导出。
- 小工具挂载点：`AppMarketView.vue:116`（🏪 应用市场，`rail === 'mobile'`）。
- 跨页面切换：App 用 URL hash 锚点（`#explorer/...`、`#mobile` 等），`window` 上监听 `hashchange → applyHash`，Rail 即随之切换（`App.vue:592`）。已有 `df-*` 自定义事件的先例（如 `df-open-agent-settings`、`df-fill-composer`）。
- 组件按 Rail 条件渲染：`rail` 非 `explorer` 时 `TerminalView` **会被卸载**（`App.vue:647-685`），因此「意图」不能只靠一次性事件，需用可跨挂载周期的待处理标记。

## 4. 设计

### 4.1 不再强开 Agent（`TerminalView.vue`）

- `SESSION_LIST` 处理里**删除**最后的 `else startAgent();`。
- 保留前两条：认领服务端恢复的 Agent 会话、复用已在运行的固定 Agent（刷新重连，符合「恢复最近页签」既有设计）。
- 效果：首次进入且无会话 → 无页签；`center.tabs` 为空 → 中心显示欢迎页。

### 4.2 小工具元数据单一来源（新增 `web/src/tools/catalog.ts`）

- 导出 `ToolId`、`MINI_TOOLS`（`{ id, icon, labelKey, descKey }`）。
- `MiniTools.vue` 改用 `MINI_TOOLS`（删除内联 `TOOLS`）；欢迎页用同一份元数据渲染介绍卡片。

### 4.3 跨挂载意图（新增 `web/src/uiIntents.ts`）

用模块级响应式标记，避免组件卸载期间丢失意图：

- `pendingTool: Ref<ToolId | null>` + `requestTool(id)` / `clearPendingTool()`。
- `pendingStartAgent: Ref<boolean>` + `requestStartAgent()` / `clearPendingStartAgent()`。

### 4.4 欢迎页（新增 `web/src/components/WelcomeView.vue`）

- Emits：`new-agent`、`open-tool(id)`（无 props）。
- 结构：标题 + 副标题；主按钮「＋ 新建 Agent」；「小工具」卡片网格（`MINI_TOOLS`，图标/名称/说明）。
- 由 `TerminalView` 在 `!phone && center.tabs.value.length === 0` 时以**绝对定位覆盖层**渲染（`position:absolute; inset:0`，不透明背景），盖住空的终端区/输入框/标签栏；下层组件保持挂载（xterm 实例不销毁），布局尺寸不变故无需重新 `fit`。首个会话建好后 `tabs` 非空 → 覆盖层自动消失。

### 4.5 组合与跳转

`TerminalView.vue`：
- 监听 `pendingStartAgent`（`immediate`），为真且非 phone 时清标记并调 `startAgent()`；无项目（`props.projectId` 为空）时改为派发 window 事件 `df-add-folder`（由 App 打开「添加目录」弹窗）。
- 欢迎页 `new-agent` → 同上逻辑。
- 欢迎页 `open-tool(id)` → `requestTool(id)`，然后 `window.location.hash = '#mobile'`（复用既有 hash 路由），App 切到应用市场、`TerminalView` 卸载、`MiniTools` 挂载。

`MiniTools.vue`：
- `watch(pendingTool, immediate)`：非空时 `openTool(id)` 并 `clearPendingTool()`。

`AppMarketView.vue`：
- 顶部新增显眼的「＋ 新建 Agent」入口：`requestStartAgent()` 后把 hash 切到 `#explorer/tree`（回到终端视图）。无需自行判断有无项目——统一由 `TerminalView` 处理待办意图（无项目则派发 `df-add-folder`）。

`App.vue`：
- 新增 `window` 监听 `df-add-folder → openAddFolder`，并在 `onBeforeUnmount` 移除。

### 4.6 i18n（`shared/i18n/zh-CN.js` + `en.js`，中英同步）

- `welcome.title`：开始使用 / Get started
- `welcome.subtitle`：新建 Agent 开始对话，或使用下方小工具 / Start an Agent session, or use a mini-tool below
- `welcome.new_agent`：新建 Agent / New Agent
- `welcome.new_agent_hint`：推荐 · 在所选项目目录启动 Agent / Recommended · launch an Agent in the selected project
- `welcome.tools_title`：小工具 / Mini tools
- `welcome.tools_hint`：点击卡片打开对应小工具 / Click a card to open that tool
- `tools.desc.translate` / `tools.desc.yaml` / `tools.desc.js` / `tools.desc.sort` / `tools.desc.postman`：各一句说明（中英）

### 4.7 数据流

```
首次进入（无会话/无页签）
  → SESSION_LIST 不再 startAgent → center.tabs 为空
  → TerminalView 渲染 WelcomeView

欢迎页点「新建 Agent」
  → 有项目：TerminalView.startAgent() → 会话页签出现 → 欢迎页收起、终端显示
  → 无项目：df-add-folder → App 打开「添加目录」

欢迎页点某小工具
  → requestTool(id) → hash=#mobile → 应用市场挂载 → MiniTools 读 pendingTool 打开该工具

应用市场点「新建 Agent」
  → requestStartAgent() → hash=#explorer/tree → TerminalView 挂载 → 处理待办意图
```

### 4.8 边界与错误处理

- 手机页（`phone`）：不显示欢迎页、不处理 startAgent 意图（沿用现有手机逻辑）。
- 无项目：不直接建会话（避免无 cwd），改为打开「添加目录」。
- 已有文件页签但无会话：`tabs.length > 0` → 不显示欢迎页（显示文件预览），符合「空白才欢迎」。
- 关闭全部页签后：欢迎页重新出现（空态）。
- 刷新/服务端重启：恢复逻辑不变，不因本次改动回归。

## 5. 影响面

| 文件 | 改动 |
| --- | --- |
| `web/src/components/TerminalView.vue` | 删 `else startAgent()`；接入欢迎页与 `pendingStartAgent`；`.term-wrap` 与欢迎页互斥显示 |
| `web/src/components/WelcomeView.vue` | 新增（欢迎页） |
| `web/src/components/MiniTools.vue` | 改用 `MINI_TOOLS`；监听 `pendingTool` 打开工具 |
| `web/src/components/AppMarketView.vue` | 顶部新增「新建 Agent」入口 |
| `web/src/tools/catalog.ts` | 新增（工具元数据单一来源） |
| `web/src/uiIntents.ts` | 新增（待处理意图） |
| `web/src/App.vue` | 监听 `df-add-folder` |
| `shared/i18n/zh-CN.js` / `en.js` | 新增 `welcome.*` 与 `tools.desc.*` 词条 |
| 测试 | `MiniTools` 的 `pendingTool` 打开工具；`uiIntents` 纯逻辑；欢迎页 emit |

## 6. 测试

- `web/src/components/MiniTools.test.ts`：`pendingTool` 置值后自动打开对应工具；不影响既有 8 条用例。
- `web/src/uiIntents.test.ts`（新增）：`requestTool` / `requestStartAgent` 置位与清除。
- `web/src/components/WelcomeView.test.ts`（新增）：渲染主按钮与工具卡片；点击 emit 正确事件。
- `npm.cmd run check:i18n`（词条中英对称、用户可见范围无硬编码中文）。
- `npm.cmd run typecheck`。
- `npm.cmd test`（server + web 全量回归）。

## 7. 验证（手工）

1. 全新档案（清空/换端口）启动 dev：进入界面无任何页签、无 Agent 会话，中心显示欢迎页。
2. 点「新建 Agent」：出现会话页签并进入终端，欢迎页收起。
3. 回到空白（关闭全部页签）：欢迎页重现；点某小工具卡片 → 跳到「应用市场」且该工具面板已打开。
4. 应用市场顶部「新建 Agent」：点击后回到终端并新建 Agent 会话。
5. 无项目时点「新建 Agent」：弹出「添加目录」。
6. 有历史页签时刷新：仍按最近 N 个恢复，行为不变。
