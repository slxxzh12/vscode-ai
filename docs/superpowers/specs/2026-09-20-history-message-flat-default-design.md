# 设计文档：历史面板「全部会话」恢复平铺视图并设为默认样式

日期：2026-09-20
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

左侧历史面板的「消息」页此前有「仅当前会话 / 全部会话」两个筛选按钮（`web/src/components/HistoryList.vue`，`hist.filter.on/off`）。2026-09-17 的「会话两级目录」改造把「全部会话」换成了**按会话分组的树**（见 `docs/superpowers/specs/2026-09-17-session-history-tree-design.md`），平铺视图只保留在「仅当前会话」。

本设计在**保留会话树**的前提下，为「全部会话」补回**平铺**样式，并把它设为默认：

1. 「全部会话」下新增一个 `[平铺] [分会话]` 子切换，默认选 **平铺**，可随时切回树；
2. 平铺 = 所有会话的消息混排（带页签名标签与日期分隔），即 2026-09-17 之前的行为；
3. 「仅当前会话」与打开面板的默认筛选（「仅当前会话」）**都不变**。

核心约束（已与用户逐条确认）：

| # | 决定 | 取值 |
|---|------|------|
| 1 | 默认筛选 | 打开面板仍是「仅当前会话」（`msgFilter` 默认 `true`，不变） |
| 2 | 子切换范围 | 只在「全部会话」（`filter === false`）下出现 `[平铺] [分会话]` |
| 3 | 默认样式 | 「全部会话」默认**平铺**；「分会话」= 现有会话树 |
| 4 | 持久化 | 样式选择随 window-state 持久化（与 `msgFilter` 平行），刷新后保留 |
| 5 | 实现方式 | 最小改动：App.vue 加状态、HistoryList 内加子切换与分支；不抽组件 |

## 2. 现状与落点

- 筛选状态 `msgFilter`（`web/src/App.vue:193`，默认 `true`）经 `HistoryList` 的 `filter` prop 传入（`App.vue:674`）；`filter=true` → 平铺，`filter=false` → 会话树。
- 筛选纯函数 `filterMessages`（`web/src/msgFilter.ts:38-49`）：`filterOn=false`（全部会话）时不过滤，`props.messages` 即全量消息，已含各会话消息，无需后端改动。
- `HistoryList.vue` 渲染：
  - 筛选栏 `filterbar`（`HistoryList.vue:190-193`），仅 `tab === 'messages'` 时渲染，内含两个 `.filterbtn`。
  - 模板分支：`v-if="!filter"` → 会话树（`221-249`）；`v-else` → 平铺（`250-267`，数据源 `msgRows`，见 `132`）。
  - `hasMore`（`67-69`）、`noMatch`（`71-77`）、`onScroll`（`90-98`）、底部统计（`271`）当前按 `props.filter` 二选一取 `filteredMessages.length` 或 `treeTotal`。
- 窗口状态 `WindowState` / `RestorePlan` / `planRestore`（`web/src/windowState.ts:8-75`）：`msgFilter` 已存档与恢复（`68`），是本设计新增字段的直接参照；服务端 `window-state.json` 为自由 JSON，无需改服务端。

## 3. 前端

### 3.1 `web/src/windowState.ts`

- 新增类型：`export type AllStyle = 'flat' | 'tree';`
- `WindowState` 增加 `msgAllStyle?: AllStyle;`（`windowState.ts:8-14`）。
- `RestorePlan` 增加 `msgAllStyle?: AllStyle;`（`16-22`）。
- `planRestore` 中，在 `msgFilter` 之后（`68` 附近）加：
  ```ts
  if (state.msgAllStyle === 'flat' || state.msgAllStyle === 'tree') plan.msgAllStyle = state.msgAllStyle;
  ```
  非法值一律忽略（不覆盖默认）。

### 3.2 `web/src/App.vue`

- 新增 `const msgAllStyle = ref<AllStyle>('flat');`（放在 `msgFilter` 附近，`App.vue:193`）。
- `currentWindowState()`（`254-262`）加入 `msgAllStyle: msgAllStyle.value`。
- `restoreWindowState`（`263-292`）在 `msgFilter` 恢复之后（`275` 附近）加 `if (plan.msgAllStyle) msgAllStyle.value = plan.msgAllStyle;`。
- 存档 watch 的依赖数组（`293-296`）加入 `msgAllStyle`。
- `HistoryList`（`674-679`）新增传参：`:all-style="msgAllStyle"`、`@update:all-style="msgAllStyle = $event"`。

### 3.3 `web/src/components/HistoryList.vue`

- props 新增 `allStyle?: 'flat' | 'tree'`（默认 `'flat'`，`withDefaults`，`10-22`）。
- emits 新增 `(e: 'update:all-style', v: 'flat' | 'tree'): void;`（`23-35`）。
- 派生一个视图判定：
  ```ts
  const treeView = computed(() => !props.filter && props.allStyle === 'tree');
  ```
  即：`filter=true` → 平铺（仅当前会话）；`filter=false && allStyle==='tree'` → 会话树；其余 → 平铺（全部会话）。
- 筛选栏（`190-193`）在 `tab === 'messages' && !filter` 时，于两个 `.filterbtn` 之后追加子切换：
  - 两个按钮 `[平铺] [分会话]`，class 用 **`stylebtn`**（与 `.filterbtn` 同款样式，但用独立类名，避免影响现有 `findAll('.filterbtn')` 断言），选中项加 `on`；
  - `:title="$t('hist.style.title')"`；
  - 点击分别 `emit('update:all-style', 'flat' | 'tree')`。
- 模板分支：把现有 `v-if="!filter"` 的树分支改为 `v-if="treeView"`；其后的 `v-else` 平铺分支不变（`filter=false` 时 `props.messages` 已是全量，同一段模板即可渲染全部会话平铺）。
- 分页与空态判定统一改用 `treeView`：
  - `hasMore`（`67-69`）：消息页改为 `msgLimit < (treeView.value ? treeTotal.value : filteredMessages.value.length)`；文件页保持原逻辑。
  - `noMatch`（`71-77`）：`treeView.value` → 树判据；否则平铺判据（`messages.length > 0 && filteredMessages.value.length === 0`）。
  - `onScroll`（`90-98`）：消息页改为按 `treeView.value ? treeTotal.value : filteredMessages.value.length` 判断是否还能加载下一页。
  - 底部统计（`271`）：同上，用 `treeView` 二选一。
- 搜索/删除/打开消息等交互复用现有实现，不加新逻辑。

## 4. i18n

新增词条（`shared/i18n/zh-CN.js` + `en.js`，键集合对称；`hist.tree.*` 已有词条不动）：

| key | zh-CN | en |
|---|---|---|
| `hist.style.flat` | 平铺 | Flat |
| `hist.style.tree` | 分会话 | By session |
| `hist.style.title` | 平铺：全部消息混排；分会话：按会话分组的树 | Flat: all messages mixed; By session: grouped tree |

提交前 `npm.cmd run check:i18n` 必须零命中（代码注释/日志除外）。

## 5. 边界情况

- **存档无 `msgAllStyle`（老存档/首次）**：默认 `flat`。
- **存档为非法值**：`planRestore` 忽略，仍默认 `flat`。
- **在「仅当前会话」下**：不渲染子切换；`allStyle` 存在但不影响渲染（`treeView=false`）。
- **在「全部会话 + 分会话」下切换筛选再切回**：样式状态保留（页面级 ref），继续显示树。
- **切换样式时**：重置分页计数。在 `HistoryList.vue` 现有 `watch(() => props.tab, ...)`（`48`）旁新增 `watch(() => props.allStyle, () => { msgLimit.value = PAGE; })`，避免平铺与树两套视图共用计数造成错位。
- **搜索词**：两套视图共用同一 `query`；平铺按 `filteredMessages` 过滤，树沿用现有 `treeNodes` 过滤逻辑。
- **消息无 `sessionId` 只有 `tabName`**：平铺照常显示（带 `tabName` 徽标）；树按现有规则归组。

## 6. 测试与验证

- `web/src/windowState.test.ts`（扩展）：`planRestore` 携带合法 `msgAllStyle`；非法值忽略；`saveWindowState`/`flushWindowState` 透传该字段。
- `web/src/components/HistoryList.test.ts`（扩展）：
  - 现有 4 个树测试（`129`、`148`、`158`、`166` 行）改为显式传 `allStyle: 'tree'`；
  - 新增「全部会话默认平铺」：`filter=false` 不传 `allStyle` → 渲染 `.mrow`、无 `.tnode`；
  - 新增「全部会话 + 分会话」：传 `allStyle:'tree'` → 渲染 `.tnode`；
  - 新增「子切换仅全部会话出现」：`filter=true` 不渲染 `.stylebtn`；`filter=false` 渲染 2 个；点击分别 emit `update:all-style` 的 `flat` / `tree`。
- 手工验收：`npm.cmd run dev` → 历史 → 消息 → 全部会话：默认平铺、带页签名与日期分隔；点「分会话」出树；刷新后保留所选样式。
- 命令：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 7. 影响面

- 修改：`web/src/windowState.ts`、`web/src/App.vue`、`web/src/components/HistoryList.vue`、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`、`web/src/windowState.test.ts`、`web/src/components/HistoryList.test.ts`。
- 不改：`web/src/msgFilter.ts`（`filterOn=false` 已返回全量）、服务端、`window-state.json` 结构（自由 JSON，新字段自动兼容）、`void.db`、账本、协作子系统、打包脚本。

## 8. 不做（明确排除）

- 改动「仅当前会话」的平铺行为。
- 改动会话树本身（分组/展开/打开/编辑逻辑）。
- 把会话树抽成独立组件（`SessionTree.vue`）——属可选后续重构。
- 折叠状态持久化、拖拽分组、三按钮式（`仅当前会话 / 全部会话·平铺 / 全部会话·分会话`）改版。
- 端到端自动化测试（沿用现有单测 + 手工验证）。
