# 小工具统一文件工作台（类首页代码编辑）设计

## 背景

「小工具」（`web/src/components/MiniTools.vue`）现分两种形态：

- 有文件树的一组：`notepad`、`yaml`、`js`、`translate` 通过 `web/src/tools/files/useFileWorkbench.ts` 共用「左树 + 右编辑 + 1 秒防抖自动保存」，树组件为 `web/src/components/ItemTree.vue`（经 `FileSidebar.vue` 包裹）。
- 无文件概念的一组：`postman`（左侧是自动记录的 curl 历史树 `PostmanTree.vue`，右侧编辑器只编辑内存里的 curl 文本，没有文件保存）、`navicat`（左侧是连接/库/表树 `NavicatTree.vue`，右侧编辑器只编辑内存里的 SQL，没有文件保存）。

现有痛点：

1. `notepad` 的编辑器绑定了 `:disabled="!activeId"`——没先「新建文件 / 选中文件」就不能输入。
2. `postman`、`navicat` 的编辑结果无法落成文件，换工具即丢。
3. 各工具的左侧树外观/交互不一致（`ItemTree.vue` 是「根行 🏠 + 悬停按钮」，而首页项目文件树 `web/src/components/FileTree.vue` 是「小标题 + ⟳ / 📄＋ / 📁＋ 图标按钮 + 右键菜单」）。

首页的项目文件编辑（会话页「文件」标签的 `FileTree.vue` + 右侧 `FilePreview.vue` 代码编辑器）是用户认可的形态。本次把小工具统一到这套形态。

## 目标

- 小工具的文件展示「方框」（左侧树面板、标题栏、行样式、右键菜单）**外观与交互都对齐首页 `FileTree.vue`**，数据仍各走自己的后端目录。
- 右侧编辑器**始终可直接编辑**（不要求先有活动文件）。
- 没有活动文件时，点「保存」/ Ctrl+S → **按时间戳新建文件并写入**（在 `YYYYMMDD-HHmmss` + 默认扩展名的文件名下）；文件建立后恢复现有 1 秒防抖自动保存。
- `postman`：历史树升级为文件树（每条 curl 记录即一个文件，一个左侧面板，可运行 + 可文件管理）。
- `navicat`：连接树升级为「连接 + 文件」分组混排的单棵文件树式面板。
- `notepad` / `yaml` / `js` / `translate` 复用同一套工作台，行为一致。

## 非目标

- 不改首页 `FileTree.vue` / `FilePreview.vue` 本身。
- 不把 `postman` 记录改成纯文本 curl 文件（保留 JSON 记录以持久化运行结果与按 curl 去重）。
- 不做文件导入/导出、二进制、富文本、语法树。
- 不改 `navicat` 的连接/执行/导出逻辑，只在其左侧增加「文件」分组并接入文件保存。

## 设计

### 一、通用外观与交互（`ItemTree.vue` / `FileSidebar.vue`）

对齐首页 `FileTree.vue`：

- `FileSidebar.vue` 标题栏：左侧小标题（当前工具的 `tools.*` 文案），右侧三个图标按钮 `⟳`（刷新树）、`📄＋`（新建文件）、`📁＋`（新建文件夹）；样式与首页 `.head/.ic` 一致（无边框、悬停高亮）。
- `ItemTree.vue`：
  - 行样式对齐首页：`ui-monospace` 紧凑行、`📁`/`📄` 图标、`--bg4` 悬停/选中底、`--ac2` 选中字色。
  - 去掉「🏠 根」行；顶层项直接列出。**点标题栏/列表空白区 = 选中根目录（`activeFolder = ''`）**，拖拽文件到列表空白 = 移到根。
  - 交互改为**右键菜单**（对齐首页 `.ctx`）：新建文件（`tree.ctx.new_file`）、新建文件夹（`tree.ctx.new_dir`）、重命名（`tree.rename`）、删除（`tree.delete`）、复制名称（`tree.copy_file_name` / `tree.copy_dir_name`）、复制相对路径（`tree.copy_path`）；`postman` 额外保留 ▶ 运行（悬停显示，`showRun` 时文件夹/文件都在）。
  - 文件夹展开折叠沿用（`localStorage` 折叠持久化、拖拽移动保留）。
  - 组件接口（`folders/items/activeFolder/activeId/actions/storageKey/statuses/showRun` 与 emits）保持不变，仅重排模板与样式。
- 菜单词条统一放 `tree.*`；新增缺失的键，中英同步。

### 二、`useFileWorkbench` 增强（始终可编辑 + 无文件保存即时间戳建文件）

`web/src/tools/files/useFileWorkbench.ts`：

- 入参扩展：`useFileWorkbench({ tool?, defaultExt, files? })`。`files` 为注入的 FilesProvider（见第三节）；未注入时用 `useToolFiles(tool)`（此时 `tool` 必填）。`web/src/tools/files/useToolFiles.ts` 的 `FileTool` 联合类型增加 `'navicat'`。
- `stamp()` 复用现有 `YYYYMMDD-HHmmss`。
- 内容变化（`watch(content)`）：
  - 有 `activeId`：维持现状 → 置 `dirty` + 1 秒防抖 `flushSave()`。
  - 无 `activeId`：只置 `dirty = true` 并清提示，**不自动建文件、不起定时器**（符合「无文件时只手动保存才落盘」）。
- `flushSave()`：
  - `activeId` 为空且 `content` 非空 → 调 `files.createFile(activeFolder, stamp() + defaultExt)`，拿到 `id` 后置为 `activeId`，再 `files.save(id, content)`；成功后 `dirty = false`，`msg = files.saved`。
  - `activeId` 为空且 `content` 为空 → 直接返回（不建空文件）。
  - `activeId` 非空且 `dirty` → 维持现状写入。
  - Ctrl+S 与「保存」按钮都走此逻辑。
- `newFile()`：**去掉 `window.prompt`** → 直接 `files.createFile(activeFolder, stamp() + defaultExt)`，置为活动文件、清空编辑区、`dirty = false`。
- `title`：无 `activeId` 时显示 `files.untitled`（新词条）并在 `dirty` 时加 `*`；有 `activeId` 时显示文件名 + `*`。
- 返回新增 `refresh()`（重新 `files.load()`，供标题栏 ⟳ 用）。
- 编辑器绑定去掉 `:disabled`：`NotepadTool.vue`、`TextToolBody.vue` 不再禁用 `CodeEditor`。

### 三、`postman`（历史树 → 文件树，保留自动记录）

**前端** `web/src/tools/postman/`：

- 新增 `usePostmanFiles.ts`：实现与 `useToolFiles` 相同的 FilesProvider 形状（`folders/items/load/read/save/createFile/createFolder/renameFolder/removeFolder/renameItem/removeItem/moveItem`），但走 `/api/postman/*` 的既有端点 + 新端点（见后端），把 `PostmanRecord` 映射为 `FileItem`（`label = title || command 首行`、`folder`、`updatedAt`）。
  - `read(id)` → 命令文本；`save(id, content)` → 回写 `command`；`createFile(folder, name)` → 建时间戳 `.json`（空 command）；`renameItem` → 复用 `setRecordTitle`（改显示标题，文件名不变）。
- `PostmanTool.vue` 改用 `useFileWorkbench({ files: usePostmanFiles(), defaultExt: '.json' })`；左侧渲染统一 `FileSidebar`/`ItemTree`（`showRun = true`、`statuses` 保留）；右侧保留 curl 编辑框 + 响应区不变。
- 保留：点「运行」→ 仍自动记录（hash 文件名，按 curl 去重），记录出现在树里；运行文件夹/单条仍可用。
- 无活动文件保存 → 时间戳 `.json` 文件，写入当前 curl 文本。

**后端** `server/postman-history.js`：

- 放宽记录文件名校验：`isRecordName` 由 `^[0-9a-f]{16}\.json$` 改为接受 `^[A-Za-z0-9_.-]+\.json$`（仍经 `normalizeRel` 防穿越），以容纳时间戳文件名。
- 新增 `read(id)` → `{ content: rec.command, title, updatedAt }`；`write(id, content)` → 更新 `rec.command`（保留 `title`/`result`）；`createFile(folder, name)` → 写 `{ command: '', updatedAt }`，重名抛 `exists`。
- 新增 HTTP 端点（`server/http-api.js`）：
  - `GET /api/postman/record?id=…` → `{ content }`
  - `PUT /api/postman/record` `{ id, content }` → `{ ok }`
  - `POST /api/postman/record` `{ folder, name }` → `{ ok, id }`

### 四、`navicat`（连接树升级为「连接 + 文件」混排）

**后端**：

- `server/port-paths.js`：新增 `navicatSqlDir: path.join(dir, 'tools', 'navicat', 'sql')`，并加入 `ensurePortDirs` 创建列表（`navicatDir` 已在列表中，`sql` 子目录随其创建）。
- `server/index.js`：`fileStores` 增加 `navicat: createNotepadStore({ dir: paths.navicatSqlDir })`，自动开放 `/api/files/navicat/*`（`http-api.js` 的 `filesMatch` 已泛化，无需改路由）。

**前端** `web/src/tools/navicat/`：

- `NavicatTree.vue` 外观重排对齐首页，内含两个分组：
  - 「连接」分组（`nv.conn_group`）：现有连接/库/表节点，懒加载、右键编辑/重命名/删除、点击选库/选表逻辑不变，仅按首页行样式重排。
  - 「文件」分组（`nv.file_group`）：直接复用统一 `ItemTree` 组件渲染 `useToolFiles('navicat')` 的 `folders/items/actions`，点击文件把内容载入右侧 SQL 编辑区，右键新建/重命名/删除/复制名称/复制路径。
- `NavicatTool.vue` 右侧 `sql` 改用 `useFileWorkbench({ tool: 'navicat', defaultExt: '.sql' })` 的 `content`/`save`/`title`；「执行/清空/结果表/导出」逻辑不变；无活动文件保存 → 时间戳 `.sql`。

### 五、i18n

- 新增词条（中英对称）：`files.untitled`、`nv.conn_group`、`nv.file_group`；标题栏与右键菜单复用现有 `tree.refresh`/`tree.new_file`/`tree.new_dir`/`tree.ctx.new_file`/`tree.ctx.new_dir`/`tree.rename`/`tree.delete`/`tree.copy_file_name`/`tree.copy_dir_name`/`tree.copy_path` 等键。
- 跑 `npm.cmd run check:i18n`；`web/src` 与 `server` 用户可见范围内零中文命中。

## 影响文件

- 改 `web/src/components/ItemTree.vue`、`web/src/components/FileSidebar.vue`
- 改 `web/src/tools/files/useFileWorkbench.ts`、`web/src/tools/files/useToolFiles.ts`（如需导出 `FileItem` 映射）
- 改 `web/src/tools/notepad/NotepadTool.vue`、`web/src/tools/text/TextToolBody.vue`
- 改 `web/src/tools/postman/PostmanTool.vue`、`PostmanTree.vue`（可并入统一树）、新增 `usePostmanFiles.ts`
- 改 `web/src/tools/navicat/NavicatTool.vue`、`NavicatTree.vue`
- 改 `server/postman-history.js`、`server/http-api.js`、`server/index.js`、`server/port-paths.js`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- 新增/改对应测试（见下）

## 测试计划

- server `postman-history`：`read/write/createFile`、时间戳文件名放行、`exists`/`not-found`、路径穿越仍被拒。
- server `notepad-http`：补 `/api/files/navicat/*` 目录增删改查。
- web `useFileWorkbench`（新增测试）：无 `activeId` 时输入不自动建文件；`flushSave` 无文件 → 按时间戳建文件并写入；`activeId` 存在 → 1 秒防抖 / Ctrl+S 行为不变。
- web `NotepadTool` / `TextToolBody`：编辑器不再 disabled；无文件时保存生成时间戳文件。
- web `PostmanTool`：树渲染记录、运行自动记录、保存生成时间戳 `.json`。
- web `NavicatTool`：文件分组载入 SQL、保存生成时间戳 `.sql`。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 后续（本轮不做）

- 未保存内容在切换文件/关闭工具时的二次确认。
- 文件名搜索/过滤、多选批量删除。
- 小工具文件树与首页项目文件树共用同一份组件实现（本轮只对齐外观与交互，不合并数据层）。
