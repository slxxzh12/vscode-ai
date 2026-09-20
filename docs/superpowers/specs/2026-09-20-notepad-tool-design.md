# 记事本（Notepad）小工具设计

## 背景

「小工具」（`web/src/components/MiniTools.vue`）里有一个「排序」工具（`tool id = 'sort'`）：顶栏 6 个排序按钮 + 去重，下面是 input/output 两个 textarea，用 `web/src/textTools.ts` 的 `sortText`/`dedupText` 做纯前端文本处理。它没有文件管理，用完即弃。

同时，「小工具」里的 Postman（`web/src/tools/postman/`）已经有一套成熟的**左侧目录树**：文件夹展开折叠、就地新建、重命名、删除、右键菜单、悬停图标、拖拽移动记录，数据落在 `<端口数据目录>/tools/postman/`（`server/postman-history.js`）。

现在要把「排序」工具升级为「记事本」：左侧是类似 Postman 的目录管理，新建文件落在 `<端口数据目录>/tools/notepad/`，右侧编辑文件正文，排序/去重作为对当前文件正文的操作。

## 目标

- 「排序」工具改名为「记事本」（Notepad），`tool id` 由 `sort` 改为 `notepad`。
- 左侧目录树能力对齐 Postman：新建文件夹、新建文件、重命名（文件夹/文件）、删除（文件夹/文件）、拖拽把文件移入文件夹。
- 文件为 UTF-8 纯文本，读/写/重命名/移动/删除都落盘到 `<端口数据目录>/tools/notepad/`。
- 编辑落盘：**自动保存**（输入停顿后写回）+ **显式保存按钮 / Ctrl+S**。
- 排序（字典升序/字典降序/整数升序/整数降序）与去重作为对当前文件正文的操作（替换正文）。
- 抽出通用 `FileTree` 组件，Postman 与记事本共用一份树交互。

## 非目标

- 不做富文本/语法高亮，编辑器仍是 `<textarea>` 纯文本。
- 不做文件导入/导出、二进制、图片。
- 不改 Postman 的后端数据格式与既有交互；只做前端树组件抽取的等价重构。
- 不保留原「排序」工具的 input→output 双框模式（改为单编辑器 + 就地变换）。

## 设计

### 一、通用树组件 `web/src/components/FileTree.vue`

由 `web/src/tools/postman/PostmanTree.vue` 抽取，行为等价，接口泛化：

- Props：
  - `folders: string[]` — 相对路径去重后的文件夹列表（`a`、`a/b`）。
  - `items: FileItem[]` — `{ id: string; folder: string; name: string; label?: string; updatedAt?: string }`；显示文本 = `label || name`。
  - `activeFolder: string`、`activeId: string`。
  - `actions: FileTreeActions`。
  - `storageKey: string` — 折叠状态持久化的 localStorage key（Postman 与记事本各一份，默认全展开）。
  - `statuses?: Record<string, 'pass' | 'fail'>` — 可选状态点，仅 Postman 用。
  - `showRun?: boolean` — 是否显示 ▶（作用于文件夹/文件），仅 Postman 用。
- Actions（泛化）：
  - `createFolder(parent, name): Promise<ActionResult>`
  - `renameFolder(path, name): Promise<ActionResult>`
  - `removeFolder(path): Promise<ActionResult>`
  - `renameItem(id, name): Promise<ActionResult>`
  - `removeItem(id): Promise<ActionResult>`
  - `moveItem(id, folder): Promise<ActionResult>`
  - `runFolder?(path): void`、`runItem?(item): void`（可选）
- Emits：`select-folder(path)`、`select-item(item)`、`run-folder(path)`、`run-item(item)`。
- i18n：按钮文案改用通用 `tree.*` 键（`tree.root/new_folder/new_subfolder/rename/delete/cancel/empty/rename_ph/exists/rename_failed/run_folder/run_item`），中英同步；原 `tools.pm_*` 中树用的键删除或保留给 Postman 其他位置（实现时确认无引用后清理）。

### 二、Postman 适配 `web/src/tools/postman/PostmanTree.vue`

保留该文件作为薄封装：把 `PostmanRecord[]` 映射为 `items`（`label = title || command`，`folder`、`updatedAt` 原样），把 `PostmanActions` 包装成 `FileTreeActions`，透传 `statuses`、`showRun = true`、`storageKey = 'devflow-postman-collapsed'`，并转发 `select-item → select-record`、`run-item → run-record`。`PostmanTool.vue` 与 `usePostmanHistory.ts` 不改。

### 三、记事本前端 `web/src/tools/notepad/`

- `useNotepadFiles.ts`（数据/请求层）：
  - 状态 `folders: Ref<string[]>`、`items: Ref<NotepadFile[]>`（`{ id, folder, name, updatedAt }`）。
  - `load()` → `GET /api/notepad/tree`。
  - `read(id)` → `GET /api/notepad/file?id=…` → `string`。
  - `save(id, content)` → `PUT /api/notepad/file`。
  - `createFile(folder, name)` → `POST /api/notepad/file`（返回 `{ id }`）。
  - `createFolder/renameFolder/removeFolder/renameItem/removeItem/moveItem` → 对应端点，成功后 `load()`。
- `NotepadTool.vue`（布局）：
  - 左侧 `<FileTree storage-key="devflow-notepad-collapsed" :show-run="false">`，无状态点。
  - 右侧：工具条（保存、字典升序/降序、整数升序/降序、去重）+ 编辑器 `<textarea>`；顶部显示当前文件名，`dirty` 时加 `*`。
  - 选中文件 → `read` 填充编辑器、清 `dirty`；空文件/新建后为空。
  - 自动保存：编辑器 `input` 后起 1000ms 防抖，`save` 成功清 `dirty`；保存失败保留 `dirty` 并提示。
  - Ctrl+S / 保存按钮：立即 `save`。
  - 排序/去重：`sortText`/`dedupText` 对编辑器当前内容变换并写回编辑器（触发自动保存）。
  - 删除当前打开文件后清空编辑器。
  - 新建文件：输入名（默认 `未命名.txt` / `untitled.txt`），`createFile` 后打开。
- `MiniTools.vue`：`ToolId` 的 `'sort'` → `'notepad'`，icon `📝`，label `tools.notepad`；`open === 'notepad'` 渲染 `<NotepadTool />`（不走 `mtbody` 双框布局）；移除 `SORT_BTNS`/`runSort`/`runDedup`/input/output 相关旧逻辑。

### 四、后端 `server/notepad-store.js`

`createNotepadStore({ dir })`，逻辑参照 `server/postman-history.js`，沿用 `SEG = /^[A-Za-z0-9_.-]+$/` 与 `normalizeRel`（禁绝对路径、`..`、盘符），并保证所有读写都在 `dir` 内：

- `list()` → `{ items: [{ id, folder, name, updatedAt }], folders: string[] }`。`id` = 相对路径（`a/b/x.txt`）。
- `listFolders()` → `string[]`（相对路径，供树）。
- `read(id)` → `{ content, size }`；文件不存在抛 `not-found`；超过上限（`MAX_FILE_BYTES = 2 * 1024 * 1024`）抛 `too-large`。
- `write(id, content)` → `{ size }`；`id` 必须已通过 `normalizeRel` + 末段为合法文件名（`SEG`），不存在则创建（等价保存）。
- `createFile(folder, name)` → `{ id }`；文件已存在抛 `exists`。
- `createFolder(rel)` / `renameFolder(rel, name)`（重名抛 `exists`，返回新相对路径）/ `removeFolder(rel)`（`fs.rmSync recursive`）。
- `renameItem(id, name)`（只改末段；目标存在抛 `exists`；返回新 id）/ `removeItem(id)` / `moveItem(id, folder)`。
- 仅 UTF-8 文本；读盘失败/坏编码按 utf8 返回。

### 五、HTTP `server/notepad-mount.js`

独立挂载（由 `index.js` 装配，风格对齐 `usage-mount.js`），处理 `/api/notepad/*`：

- `GET /api/notepad/tree` → `{ items, folders }`
- `GET /api/notepad/file?id=…` → `{ content, size }`
- `PUT /api/notepad/file` `{ id, content }` → `{ ok, size }`
- `POST /api/notepad/file` `{ folder, name }` → `{ ok, id }`
- `PATCH /api/notepad/file` `{ id, name }` → `{ ok, id }`
- `DELETE /api/notepad/file?id=…` → `{ ok }`
- `POST /api/notepad/folder` `{ path }` / `PATCH /api/notepad/folder` `{ path, name }` / `DELETE /api/notepad/folder?path=…`
- `POST /api/notepad/move` `{ id, folder }`

错误按 `store` 抛出的 `code` 映射：`bad-path`/`bad-id`→400、`exists`→409、`not-found`→404、`too-large`→413、其他→500；响应体 `{ error }`（与 Postman 端点风格一致）。

### 六、路径与装配

- `server/port-paths.js`：新增 `notepadDir: path.join(dir, 'tools', 'notepad')`，并加入 `ensurePortDirs` 的创建列表。
- `server/index.js`：`createNotepadStore({ dir: paths.notepadDir })` + `createNotepadMount({ store })`，在 HTTP 分发里转交 `/api/notepad/*`。

### 七、i18n

- 新增：`tools.notepad`、`np.*`（`save`/`saved`/`unsaved`/`new_file`/`file_name`/`file_ph`/`open_failed`/`save_failed`/`too_large`/`deleted`/`sorted`/`deduped` 等）。
- 树相关：`tree.*`（见第一节）。
- 中英键集合保持对称；跑 `npm.cmd run check:i18n`。

## 影响文件

- 新增 `web/src/components/FileTree.vue`
- 新增 `web/src/tools/notepad/useNotepadFiles.ts`、`web/src/tools/notepad/NotepadTool.vue`、对应测试
- 改 `web/src/tools/postman/PostmanTree.vue`（改为 FileTree 薄封装）
- 改 `web/src/components/MiniTools.vue`（工具改名/接线）
- 新增 `server/notepad-store.js`、`server/notepad-mount.js`、测试
- 改 `server/port-paths.js`、`server/index.js`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

## 测试计划

- server `notepad-store.test.js`：list/read/write/createFile/createFolder/renameFolder/removeFolder/renameItem/removeItem/move；路径穿越（`..`、绝对路径、非法段）被拒；`exists`/`not-found`/`too-large` 分支。
- server `notepad-http.test.js`：各端点成功 + 错误码映射。
- web `useNotepadFiles.test.ts`：请求路径、成功回调、失败保留。
- web `FileTree.test.ts`：承接原 `PostmanTree.test.ts` 用例（展开折叠、新建/重命名/删除、右键、拖拽），必要时补 `showRun=false` 不渲染 ▶。
- web `MiniTools.test.ts`：第 4 个工具改为断言渲染 `NotepadTool`；移除依赖双框排序的旧断言。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 后续（本轮不做）

- 未保存内容在切换文件/关闭页面时的二次确认。
- 文件名搜索/过滤、多选与批量删除。
