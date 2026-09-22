# 设计文档：Postman / Navicat 迁移到主区工具页签（统一左侧树 + 批量执行 + 同款搜索）

日期：2026-09-22
分支：master
状态：已与用户确认方案（待实现）
前置：`2026-09-21-minitools-main-page-tabs-design.md`（本设计完成其 Phase 3 的 postman / navicat 迁移，并补充「同款搜索」与「Postman 批量执行」）

## 1. 概述

现状：五个小工具里，`notepad`/`yaml`/`translate` 已迁到「主区工具页签 + 左侧统一 `ToolSidebar`/`TreeView`」的壳子；`postman`/`navicat` 仍开在 `MiniTools.vue` 的 fullscreen `el-dialog` 里，各自「自带左侧树 + 右侧内容」，左侧树实现也不统一（`PostmanTree` 用 `ItemTree`、`NavicatTree` 为自定义连接树）。

用户希望：**Postman / Navicat 的左侧导航与 notepad 保持一致**（统一 `TreeView`），**只有右侧内容不同**；**搜索与首页同款**（可搜「文件名」与「内容」）；**Postman 增加批量执行按钮**，直接批量跑左边导航上的用例。

### 需求原文（用户）

> 要改一下 postMan、navicat 的左侧导航，理论上也都是存储的文件，展示方式与 notepad 保持一致。只是右侧内容有一点区别而已。
>
> 搜索跟首页使用一样的搜索能力。就是能搜索文件名和内容即可。
>
> 不过要注意一个事情，是 Postman 需要有一个执行按钮，可以直接批量执行左边导航上的 Postman 的用例。

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 壳子 | 迁移到主区工具页签（不再弹窗）；`MiniTools` 弹窗链路删除 |
| 2 | 左侧面板 | 统一 `ToolSidebar` + `TreeView`，与 notepad 同壳 |
| 3 | Navicat 特有能力 | 树上方小工具栏放「＋新建连接」；表单弹窗、编辑、复制连接串、导出 ncx 保留在右侧 |
| 4 | Postman 批量执行 | 树上方小工具栏放「▶ 批量执行」：跑**当前选中目录（含子目录）**的全部用例；未选中目录时 = 全部 |
| 5 | 搜索 | 复用首页的 `FileSearchPanel`（`TreeView` 头部 🔍）；两工具均实现 `TreeSource.search` / `openHit`，支持「名字 + 内容」 |
| 6 | 右侧内容 | 保留各自现有 UI；去掉对弹窗标题行 Teleport（`DIALOG_ACTIONS_TARGET`）的依赖 |
| 7 | 清理 | 删除 `MiniTools` 弹窗、`dialogActions.ts` 及 `NotepadTool`/`PostmanTree`/`NavicatTree`/`FileSidebar`/`ItemTree` 等遗留组件 |
| 8 | 实施方式 | inline（本会话）执行 |

## 3. 现状（改动前）

- 工具弹窗：`web/src/components/MiniTools.vue` 以 fullscreen `el-dialog` 承载 `PostmanTool`/`NavicatTool`/`TextToolBody`；磁贴点击处对 `notepad`/`yaml`/`translate` 已改走 `requestToolTab(id)`，`postman`/`navicat` 仍 `open.value = id` 开弹窗；工具操作栏经 `web/src/tools/dialogActions.ts` 的 `DIALOG_ACTIONS_TARGET` Teleport 到弹窗标题行。
- 入口：磁贴由 `AppMarketView.vue` 渲染 `MiniTools`；`WelcomeView.vue` 经 `pendingTool` 意图触发。活动栏当前**没有**工具专用图标（只有 explorer/scheduler/contacts/mobile/proxy/stat），不在本设计改动范围。
- 主区工具渲染：`TerminalView.vue` 的 `activeTool` 分支已支持 `notepad`/`yaml`（`ToolDocPane`）与 `translate`（`TextToolBody`）；`App.vue` 左侧 `aside` 在 `activeTool` 时渲染 `ToolSidebar`。
- 工具工作台：`web/src/tools/useToolWorkbench.ts` 提供「按 tool 共享、左侧树与主区内容共用」的模块级状态（文件型工具）。
- 左树数据源契约：`web/src/tree/treeSource.ts`（`TreeSource`：`loadChildren`/`open` + 可选能力 `createFile`/`createFolder`/`rename`/`remove`/`move`/`run`/`runFolder`/`reveal`/`detail`/`copyName`/`copyPath`/`copyContent`/`search`/`openHit`）；统一组件 `web/src/components/TreeView.vue`，能力缺省即隐藏对应按钮/菜单。
- 搜索：`TreeView` 头部在有 `source.search` 时显示 🔍，点开内嵌 `web/src/search/FileSearchPanel.vue`（勾选「内容/文件名/大小写」，命中「名字组」与「内容组」，点命中调 `source.openHit`）。首页由 `projectTreeSource.search` → `searchProject`（`/api/search`）驱动。
- 数据存储：
  - Postman 记录是真实文件：`<数据目录>/tools/postman/**/*.json`，文件名 = curl 原文 sha256 前 16 位，展示名用 `title`，缺失回退 `command`；`usePostmanHistory.ts` 已在内存里持有 `history`（含 `id`/`command`/`title`/`result`/`updatedAt`/`folder`/`name`）与 `folders`。
  - Navicat 连接存单个 `<数据目录>/tools/navicat/profiles.json`（`navicat-store.js`）；`useNavicat.ts` 持有 `profiles`（`id`/`name`/`type`/`host`/`port`/`user`/`database`/`options`/`hasPassword`/`updatedAt`，**不含密码明文**），并可通过 `listDatabases`/`listTables` 拉实时库/表。
- 遗留组件：`web/src/tools/notepad/NotepadTool.vue`（已迁移，弹窗时代残留）、`web/src/components/FileSidebar.vue`（仅 `NotepadTool` 使用）、`web/src/components/ItemTree.vue`（仅 `FileSidebar`、`PostmanTree` 使用）。

## 4. 设计

### 4.1 入口

- `MiniTools.vue`：磁贴点击**全部**走 `requestToolTab(id)`（postman/navicat 与 notepad/yaml/translate 一致）；删除 `el-dialog` 与其中的工具分支、`provide(DIALOG_ACTIONS_TARGET)`、`open`/`dlgOpen` 状态；`watch(pendingTool)` 逻辑保留（置位即 `requestToolTab`）。
- `App.vue`：现有 `watch(pendingToolTab)` → `rail='explorer'` + `center.openTool(id)` 已满足，无需改。

### 4.2 左侧面板 `ToolSidebar.vue`

- Props 由 `tool: FileTool` 放宽为 `tool: ToolId`（`'translate'|'yaml'|'notepad'|'postman'|'navicat'`）。
- 文件型（`notepad`/`yaml`/`translate`）：保持现状（`useToolWorkbench(tool)` + `TreeView` + `storageKey`）。
- `postman`：渲染 `PostmanSidebarBar`（「▶ 批量执行」）+ `TreeView :source="postmanWorkbench.treeSource"`。
- `navicat`：渲染 `NavicatSidebarBar`（「＋新建连接」）+ `TreeView :source="navicatWorkbench.treeSource"`。
- 两工具都带 `title`（`tools.<tool>`）与 `storage-key`（`devflow-<tool>-collapsed`）；搜索由 `TreeView` 头部 🔍 自动出现（因 `source.search` 存在），不另加搜索框。
- `App.vue` 里传给 `ToolSidebar` 的 `activeTool` 类型同步放宽为 `ToolId`。

### 4.3 数据源与共享状态

> 两工具**不是文件型**，各自一份模块级单例 workbench，供左侧树/工具条与右侧内容共用（同 `useToolWorkbench` 的「模块级缓存」思路）。

#### 4.3.1 Postman

- 新增 `web/src/tools/postman/usePostmanWorkbench.ts`（模块级单例）：
  - 持有 `usePostmanHistory()` 的 `history`/`folders` 与 `load`。
  - 状态：`activeId`、`activeFolder`、`runStatus`（`Record<id,'pass'|'fail'>`）、`curlCmd`、`respHeaders`/`respBody`/`respStderr`/`status`/`failed`、`busy`、`msg`、`copied`。
  - 动作：`openRecord(rec)`（载入 `curlCmd`、清空响应）、`runOne(rec)`、`runFolder(path)`（批量：跑该目录含子目录的全部记录，逐条 `setStatus` + 更新进度 `msg`）、`runCurlCmd()`、`clearResult()`、`copyOut()`。
  - 导出：`treeSource: TreeSource`、`sidebarRun()`（= 用 `activeFolder` 调 `runFolder`；根目录时 = 全部）。
- 新增 `web/src/tools/postman/postmanTreeSource.ts`：
  - `loadChildren('')`：根级文件夹（`dir`）+ 根级记录（`item`）；`loadChildren(folderKey)`：直接子文件夹 + 该目录记录。
  - 记录节点：`key=record.id`、`name=title||command`、`time=updatedAt` 格式化、`status=runStatus[id]`。
  - 能力：`createFolder`（新建文件夹）、`rename`（目录改名 / 记录改名=改 `title`）、`remove`（删目录 / 删记录，删除当前活动项时清空右侧）、`move`（记录→目录；拖拽）、`run`（跑单条）、`runFolder`（右键「运行文件夹」）、`copyName`/`copyPath`、`search`/`openHit`。
  - 不提供 `createFile`（记录由执行 curl 生成）、`reveal`/`detail`/`copyContent`。
- 新增 `web/src/tools/postman/PostmanSidebarBar.vue`：一个「▶ 批量执行」按钮，`disabled=busy`，点击调 workbench 的批量执行；显示 `msg`（进度/完成）。

#### 4.3.2 Navicat

- 新增 `web/src/tools/navicat/useNavicatWorkbench.ts`（模块级单例）：
  - 持有 `useNavicat()` 的 `profiles`/`load`/`save`/`remove`/`rename`/`test`/`listDatabases`/`listTables` 及右侧所需的 `exec`/`connstr`/`exportNcx`/`reveal`。
  - 状态：`activeId`、`activeDatabase`、`sql`、`result`、`busy`、`msg`、连接表单弹窗状态（`dlg`/`dlgTab`/`dlgMsg`/`form`/`saving`/`testing`）。
  - 动作：`openNew()`/`openEdit(p)`/`doSave()`/`doTest()`、`selectConn(p)`/`selectDatabase(db)`/`pickTable(db,table)`（追加 `SELECT`）、`doExec()`、`copyConn(withPassword)`、`doExport()`、`onRemove(p)`。
  - 导出：`treeSource: TreeSource`。
- 新增 `web/src/tools/navicat/navicatTreeSource.ts`：
  - 树层级：连接（`dir`）→ 库（`dir`，mysql/postgres）或 直接表（`item`，sqlite）或 db（`item`，redis）；库 → 表（`item`）。节点 key 用带前缀的稳定串（如 `c:<id>`、`d:<id>\u0000<db>`、表节点为 `t:<id>\u0000<db>\u0000<table>`）。
  - `loadChildren('')` → 连接列表；`loadChildren('c:<id>')` → 按 `type` 拉库或表；`loadChildren('d:...')` → 拉表。
  - `open(node)`：连接 → 选中连接；库 → 选中库；表 → 追加 `SELECT`。
  - 能力：`rename`（连接改名）、`remove`（删连接，删当前活动项时清空右侧）、`copyName`、`search`/`openHit`。
  - 不提供 `createFile`/`createFolder`/`move`/`run`（头部只剩 ⟳ 与 🔍）。
- 新增 `web/src/tools/navicat/NavicatSidebarBar.vue`：一个「＋新建连接」按钮，点击调 `openNew()`。搜索不在此，改由 `TreeView` 头部 🔍。
- 连接表单弹窗 `el-dialog` 仍放 `NavicatTool.vue`（右侧），绑定 workbench 的弹窗状态；`NavicatSidebarBar` 只负责置位，不自己渲染弹窗（`NavicatTool` 在活动页签时必已挂载）。

### 4.4 搜索（与首页同款）

- 复用 `FileSearchPanel.vue` + `TreeSource.search`；两工具各自实现**纯函数**搜索（客户端，在已加载数据上检索，无需服务端改动）。
- `search(query, { caseSensitive, name, content })` 返回 `{ nameHits, contentHits, truncated, scanned }`：
  - Postman：**名字**命中的记录（`title||command` 含分词）→ `{path: record.id, name: title||command}`；**内容**命中 = 对 `JSON.stringify(record, null, 2)` 逐行匹配 → `{path, name, line, text}`（`line` 为该 JSON 文本行号，`text` 截断）。
  - Navicat：**名字**命中的连接（`name`）→ `{path: profile.id, name}`；**内容** = 对 `JSON.stringify(profile, null, 2)` 逐行匹配（`hasPassword` 而非明文，无泄密）→ `{path, name, line, text}`。
  - 分词/大小写/名字-内容开关语义对齐首页（忽略长度 < 2 的分词）。
- `openHit(hit)`：Postman → 选中并打开该记录；Navicat → 选中该连接。

### 4.5 右侧内容

- `PostmanTool.vue`：删除 `<aside class="pmside">` 与 `PostmanTree` 引用、删除 `Teleport` 包裹的动作条；改为使用 `usePostmanWorkbench()` 的状态与方法，保留 curl 编辑器 + 响应（Headers/Body/Stderr）三框 + 放大浮层 + 复制；动作条内联（运行/清空/保存到）；`onMounted` 触发 `load()`。
- `NavicatTool.vue`：删除 `<aside class="nvside">`（含「新建」/刷新/搜索框）与 `NavicatTree` 引用、删除 `Teleport` 包裹的工具栏；改用 `useNavicatWorkbench()`；保留连接工具栏（连接名/编辑/复制连接串/复制含密码/导出 ncx）+ SQL 编辑器 + 结果表/CSV + 连接表单弹窗。
- `TerminalView.vue` 工具分支：`activeDocTool`（notepad/yaml）→ `ToolDocPane`；`translate` → `TextToolBody`；`postman` → `PostmanTool`；`navicat` → `NavicatTool`。

### 4.6 清理

- 删除：`web/src/tools/dialogActions.ts`、`web/src/components/FileSidebar.vue`、`web/src/components/ItemTree.vue` 及其测试、`web/src/tools/notepad/NotepadTool.vue` 及其测试、`web/src/tools/postman/PostmanTree.vue` 及其测试、`web/src/tools/navicat/NavicatTree.vue` 及其测试。
- `MiniTools.vue` 收敛为「仅磁贴」；移除 `element-plus` 弹窗相关引入（`MiniTools.test.ts` 重写为「磁贴点击 → `requestToolTab`」）。
- `web/src/fileTree.ts` 保留（`useToolFiles`/`useFileWorkbench` 仍用其类型）。
- i18n：新增词条（如批量执行、批量进度/完成、新建连接按钮 title 等）中英同步补齐。

## 5. 文件清单

**新增**
- `web/src/tools/postman/usePostmanWorkbench.ts`（+ test）
- `web/src/tools/postman/postmanTreeSource.ts`（+ test）
- `web/src/tools/postman/PostmanSidebarBar.vue`（+ test）
- `web/src/tools/navicat/useNavicatWorkbench.ts`（+ test）
- `web/src/tools/navicat/navicatTreeSource.ts`（+ test）
- `web/src/tools/navicat/NavicatSidebarBar.vue`（+ test）

**修改**
- `web/src/components/MiniTools.vue`（仅磁贴 + `requestToolTab`）
- `web/src/components/ToolSidebar.vue`（按 tool 分派 workbench/sidebar bar；类型放宽）
- `web/src/components/TerminalView.vue`（postman/navicat 分支）
- `web/src/App.vue`（`activeTool` 类型放宽）
- `web/src/tools/postman/PostmanTool.vue`（去左树/去 Teleport，接 workbench）
- `web/src/tools/navicat/NavicatTool.vue`（去左树/搜索框/Teleport，接 workbench）
- `web/src/components/MiniTools.test.ts`（重写）
- `web/src/components/ToolSidebar.test.ts`（补 postman/navicat 分派用例）
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js`（新增词条）
- `AGENTS.md`（目录速览：postman/navicat 不再是弹窗工具）

**删除**
- `web/src/tools/dialogActions.ts`
- `web/src/components/FileSidebar.vue`、`web/src/components/ItemTree.vue`、`web/src/components/ItemTree.test.ts`
- `web/src/tools/notepad/NotepadTool.vue`、`web/src/tools/notepad/NotepadTool.test.ts`
- `web/src/tools/postman/PostmanTree.vue`、`web/src/tools/postman/PostmanTree.test.ts`
- `web/src/tools/navicat/NavicatTree.vue`、`web/src/tools/navicat/NavicatTree.test.ts`

## 6. 测试与验证

- 单测：
  - `postmanTreeSource.test.ts`：`loadChildren` 根/子目录映射、`status` 透传、`rename`/`remove`/`move` 调对应动作、`search` 名字+内容命中与 `openHit`。
  - `usePostmanWorkbench.test.ts`：`runFolder` 批量跑选中目录（含子目录）逐条置 `runStatus`、根目录=全部；`openRecord` 载入 curl。
  - `navicatTreeSource.test.ts`：连接/库/表三层懒加载映射、`open` 表追加 SELECT、`search`/`openHit`。
  - `useNavicatWorkbench.test.ts`：选中连接/库、连接弹窗打开保存、删除清空活动项。
  - `MiniTools.test.ts`：5 个磁贴点击均置 `pendingToolTab`。
  - `ToolSidebar.test.ts`：postman 渲染批量执行条、navicat 渲染新建连接条。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 全绿。
- 手工（dev，`npm.cmd run dev`，http://localhost:5173）：从应用市场磁贴打开 Postman / Navicat → 主区工具页签；左侧树展开/折叠、右键菜单、拖拽、🔍 搜索名字+内容并点命中定位；Postman「▶ 批量执行」跑当前目录/全部并看到状态点与进度；Navicat「＋新建连接」弹表单、保存后在树上出现、点表把 `SELECT` 追加进 SQL；右侧原功能不回归。

## 7. 非目标

- 不改 `notepad`/`yaml`/`translate` 的既有行为（不为文件型工具补 `search`）。
- 不新增活动栏工具图标（现状无）。
- 不改 Postman/Navicat 的服务端存储与 API（搜索为客户端实现）。
- 不做与本次无关的重构。
