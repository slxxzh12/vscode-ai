# 拖入本地文件直接预览（浏览器 FileSystemHandle）设计

## 背景

应用是「本机 Node 服务 + 普通浏览器」（绿色包起本地服务后浏览器访问，无 Electron/Tauri 壳）。现有文件预览链路：`web/src/components/TerminalView.vue` 按中心页签类型渲染 → `file` 页签走 `web/src/components/FilePreview.vue` → 注入项目来源 → `web/src/components/DocViewer.vue`（md 预览、html 预览、图片/PDF、代码编辑、二进制提示都已具备）；`tool` 页签走 `web/src/tools/doc/ToolDocPane.vue` → `toolDocSource`。

现有所有 `DocSource`（`web/src/tools/doc/docSource.ts`）都是**服务端按绝对路径读写磁盘**（`/api/text`、`/api/files/<tool>/*`）。

需求：把 OS 里的文件拖到网页上，直接展示其内容（Markdown 直接预览），可编辑并保存回原文件；拖入文件夹时能浏览目录树，且 Markdown 相对路径图片能解析。

**关键约束**：浏览器拖拽拿不到文件的 OS 绝对路径（`DataTransfer` 只给 `File` 对象；`File.path` 是 Electron 专有，`getAsFileSystemHandle()` 也只有句柄、无路径）。因此**无法把拖入目录 `add` 进现有「工作目录」**（工作目录由服务端按绝对路径读盘），只能走浏览器 `FileSystemHandle` 客户端直连磁盘。产物：一个「本地来源」，行为手感对齐工作目录，但服务端专有能力（定位资源管理器、运行脚本、git/代码统计等）对它不可用。

## 目标

- 拖入文件/文件夹到页面任意位置（含统计/通讯录/定时任务等所有栏位）触发，出现全屏高亮提示。
- 拖入**文件**：每个文件开一个中心页签，`DocViewer` 直接展示；md 默认预览渲染，图片/PDF blob 展示，代码可编辑。
- 拖入**文件夹**：挂载为一个「本地来源」根，开一个本地根页签；激活时左侧 `aside` 显示该文件夹目录树，点文件在右侧就地切换预览。
- 可编辑并**保存回原文件**：沿用 DocViewer 现有「自动保存 + Ctrl+S + 保存按钮」，写回走文件句柄；首次写回申请权限，被拒则报错提示、内容仍可看，不静默丢改动。
- Markdown 相对路径图片：拖入文件夹时经根句柄解析为 `blob:` URL 注入渲染。
- 全量中英 i18n。

## 非目标

- 不改服务端、不新增 HTTP 接口（全程浏览器 API）。
- 不把本地来源写入「工作目录」列表 / 窗口状态存档（刷新即失效）。
- 一次只挂一个本地根（新拖文件夹替换旧根）；不做多根并存。
- 不做本地树的创建/重命名/删除/移动/定位资源管理器（能力缺省即隐藏）。
- 不做非 Chromium 的写回（无 `getAsFileSystemHandle` 时降级为只读预览）。
- 不做 IndexedDB 句柄持久化 / 刷新后重新授权恢复。

## 设计

### 一、纯函数工具（新增 `web/src/local/localHandles.ts`）

- `extOf(name): string`、`kindOf(name): 'image' | 'pdf' | 'text'`（复用 DocViewer 现有扩展名集合 `IMG`/`pdf`，保持判定一致）。
- `splitRel(path): string[] | null` / `joinRel(dir, name): string`：相对路径（POSIX 风格）规范化，过滤空段与 `.`，`..` 逐段回退，越界返回 `null`（防止穿出根）。
- `MAX_TEXT_BYTES = 10 * 1024 * 1024`，`isTooLarge(size): boolean`。
- `supportsHandles(): boolean`：`typeof DataTransferItem !== 'undefined' && 'getAsFileSystemHandle' in DataTransferItem.prototype`。
- `isProbablyBinary(bytes: Uint8Array): boolean`：前 64KB 含 NUL（对齐 `server/projects.js` 的探测思路）。

### 二、共享状态（新增 `web/src/local/useLocalSources.ts`）

模块级单例状态（同一会话内跨组件共享，刷新自然清空）：

```ts
interface LocalRoot { name: string; handle: FileSystemDirectoryHandle | null }
interface LocalFile { key: string; name: string; handle: FileSystemFileHandle | null; file: File }

const root: Ref<LocalRoot | null>
const files: Ref<Map<string, LocalFile>>   // key 单调自增 id
const activePath: Ref<string>              // 本地根页签当前选中文件的相对路径
```

导出：

- `root` / `files` / `activePath`、`supportsHandles`。
- `mountFolder(handle)`：替换旧根、`activePath = ''`（不触碰已挂的单文件条目）。
- `addFiles(entries): string[]`：返回 key；超过上限 20 个时截断并提示。
- `unmountRoot()`：仅清根与 `activePath`，保留单文件条目。
- `removeFile(key)`：移除单文件条目。
- `clearAll()`：清根与全部单文件条目（仅测试/兜底用）。
- `releaseObjectUrls(key)`：回收该来源已建的 blob URL（页签关闭时调用）。

### 三、文档来源（新增 `web/src/local/localDocSource.ts`）

实现 `DocSource`（`kind: 'local'`），两种作用域，按需缓存以保证引用稳定（DocViewer `watch(() => [props.source, props.path], load)` 不能被新对象反复触发）：

- `localRootDocSource()`：单例，按传入 `path` 从根句柄逐段解析。
- `localFileDocSource(key)`：按 key 从 `files` 取单文件句柄，`Map` 缓存。

能力：

- `read(path)`：
  - 解析出 `File`（根 = 逐段 traverse；单文件 = 该句柄 `getFile()`）。
  - `kind` 为 image/pdf：生成并缓存 `blob:` URL，返回 `{ name, content: '', size, binary: true }`。缓存按来源作用域记「当前 URL」，同来源切换到新文件时先 revoke 旧 URL；`releaseObjectUrls(key)`/`releaseMarkdownAssets()` 负责兜底回收。
  - 文本：`size > MAX_TEXT_BYTES` → 抛错（DocViewer 走 `open_failed` 展示）；否则读文本，`isProbablyBinary` → `{ binary: true }`，否则返回内容。
  - 不提供 `abs`（`fileAbs` 保持空，`reveal` 能力缺省即隐藏）。
- `write(path, content)`：
  - 取句柄（单文件直接用；根 = 逐段 `getFileHandle(path, { create:false })`）。
  - `queryPermission({ mode: 'readwrite' })`；非 `granted` 时 `requestPermission({ mode: 'readwrite' })`。**自动保存不是用户手势，`requestPermission` 可能抛 `SecurityError`** → 抛出一条明确错误（i18n「需要点击保存授权」），DocViewer 的保存错误态支持点击重试（`onRetrySave`，是用户手势）→ 授权成功后可写。
  - `createWritable()` → `write(content)` → `close()`。
  - 无句柄（降级/不支持写回）→ 抛 i18n「当前浏览器不支持写回原文件」。
- `rawUrl(path)`：返回 `read()` 阶段缓存的 blob URL（图片/PDF）。DocViewer `rawSrc()` 是同步调用，故必须提前在 `read()` 里建好。
- `resolveMarkdownAssets(refs)`（见下）：把相对路径解析为 blob URL 映射。
- 不提供 `list` / `meta` / `hash` / `reveal` / `run` / `pickExternal` / `markdownImageBase`（对应 UI 自动隐藏；diff 的「加载」选择器也因此隐藏）。

### 四、Markdown 相对资源（改 `web/src/markdown.ts` + `web/src/components/DocViewer.vue`）

`markdown.ts`：

- 导出 `collectAssetRefs(mdText, fileDir): { rel: string; suffix: string }[]`：用 markdown-it 解析 token，复用现有 `resolveTarget` 抽出所有相对 `image`/`link_open` 目标（去重）。
- `MarkdownOptions` 增加可选 `assetMap?: Map<string, string>`；`rewriteTokenAttrs` 中解析出 `rel` 后：`assetMap?.get(rel)` 命中→设为该 URL；否则若有 `projectId`→沿用 `buildRaw`；否则保持原样。

`DocViewer.vue` `applyPreview()`：

- 渲染前若 `props.source.resolveMarkdownAssets` 存在，先 `collectAssetRefs(raw.value, fileDir)` → `await source.resolveMarkdownAssets(refs)` 得到 `Map`，再 `renderMarkdown(raw.value, { projectId, fileDir, assetMap })`。
- 预览重建前先 `source.releaseMarkdownAssets?.()` 回收上一轮 blob URL，避免泄漏。
- `DocSource` 契约（`docSource.ts`）新增两个可选方法：

```ts
resolveMarkdownAssets?(refs: { rel: string; suffix: string }[]): Promise<Map<string, string>>;
releaseMarkdownAssets?(): void;
```

### 五、目录树来源（新增 `web/src/local/localTreeSource.ts`）

实现 `TreeSource`（`web/src/tree/treeSource.ts`），只提供读能力：

- `loadChildren(dirKey)`：从根句柄逐段解析目录（`..` 越界返回 `[]`），`for await (const handle of dir.values())`；返回 `dir` 在前、`item` 在后，`key` = 相对路径。
- `open(node)`：`activePath = node.key`，并激活本地根页签（由组件回调注入，见六）。
- 不实现 `createFile/createFolder/rename/remove/move/reveal/run/detail/copyContent` → TreeView 自动隐藏对应菜单与按钮。

### 六、组件

- 新增 `web/src/local/LocalSidebar.vue`：仿 `ToolSidebar.vue`，`TreeView` + `localTreeSource`，`title` = 根文件夹名，`active-key` = `activePath`，`storage-key` 固定 `devflow-local-collapsed`；`open` → 切回本地根页签。
- 新增 `web/src/local/LocalDropOverlay.vue`：全屏遮罩 + 提示文案（`local.drop_hint`）。
- 新增 `web/src/local/useLocalDrop.ts`：封装 window 级拖拽监听（`dragenter/dragover/dragleave/drop`），返回 `{ dragging, onDropHandled }`，供 `App.vue` 挂载/卸载；drop 时**同步**快照 `dataTransfer.items` 与 `getAsFileSystemHandle()` 承诺（事件结束后 DataTransfer 失效），再 await。

### 七、接线

- `web/src/useCenter.ts`：`CenterTab.kind` 联合类型增加 `'local'`；新增 `openLocalRoot(label)`（id `l:root`，已存在则更新 label 并激活）与 `openLocalFile(key, label)`（id `l:f:<key>`）；`closeById` 支持 `l:` 前缀：关 `l:root` → `unmountRoot()`（不影响其它单文件页签）；关 `l:f:<key>` → `removeFile(key)` + `releaseObjectUrls(key)`。
- `App.vue`：
  - `onMounted` 挂 `useLocalDrop`；`onBeforeUnmount` 卸载。
  - drop 回调：目录句柄 → `mountFolder` + `center.openLocalRoot`（替换旧根）；文件句柄 → `addFiles` + 逐个 `center.openLocalFile`。
  - `supportsHandles()` 为假（非 Chromium）时降级：文件走 `dataTransfer.files` 造只读条目（`handle: null`，`read` 用 `file.text()`，写入抛「不支持写回」）；文件夹无法枚举 → 不挂载，提示 `local.unsupported`。
  - 左侧 `aside` 分支：`activeTool` → `ToolSidebar`；`activeLocalRoot`（激活页签是 `l:root` 且 `root` 非空）→ `LocalSidebar`；否则 `HistoryList`。
- `web/src/components/TerminalView.vue`：新增 `activeLocal` 计算属性与 `local-layer` 层：
  - 根页签：`DocViewer :source="localRootDocSource" :path="activePath" :name="leafName"`（`activePath` 为空时显示 `local.empty`）。
  - 单文件页签：按 `l:f:<key>` 取条目，`DocViewer :source="localFileDocSource(key)" :path="entry.name" :name="entry.name"`。
  - 用 `v-show` 与既有 `file-layer`/`tool-layer` 平级，保持多页签状态不丢。
- `web/src/windowState.ts`：`toSavedTabs` 仅收 `kind === 'file'`，本地页签天然不入档；`recentTabs`（`restorePrefs.ts`）里 `l:` id 不参与 `bootAllowed`（其只认 `f:`/`s:`），无需改动，仅在实现时确认不产生脏数据。

### 八、交互细则

- 拖拽只在 `dataTransfer.types` 含 `Files` 时介入，且 `preventDefault`，避免浏览器默认打开文件；应用内 TreeView 的自定义拖拽（`text/plain`）不受影响。
- 同一批拖入含多个文件夹：取第一个作根，其余忽略并提示。
- 同一批拖入文件超过 20 个：取前 20 个并提示。
- 一次只保留一个本地根；单文件页签可多个并存，替换根不影响它们。
- 页签右键/关闭沿用现有逻辑；关闭本地根页签即卸载根（清树、回收其 blob），已打开的本地单文件页签不受影响。
- 刷新后本地页签与来源消失（不恢复）。

### 九、i18n（`shared/i18n/zh-CN.js` + `en.js`）

新增 `local.*` 词条（中英对称）：拖拽提示、只读降级提示、写回不支持、需要点击保存授权、文本过大（含上限）、空目录/未选文件、根文件夹标签、单批文件数/文件夹数超限、目录读取失败等。提交前跑 `npm.cmd run check:i18n`。

## 影响文件

- 新增 `web/src/local/localHandles.ts`、`useLocalSources.ts`、`localDocSource.ts`、`localTreeSource.ts`、`useLocalDrop.ts`、`LocalSidebar.vue`、`LocalDropOverlay.vue`
- 新增测试 `web/src/local/localHandles.test.ts`、`useLocalSources.test.ts`、`localDocSource.test.ts`、`localTreeSource.test.ts`
- 改 `web/src/tools/doc/docSource.ts`（两个可选方法）
- 改 `web/src/markdown.ts`（`collectAssetRefs` + `assetMap`）、`web/src/markdown.test.ts`、`web/src/useCenter.test.ts`
- 改 `web/src/components/DocViewer.vue`（`applyPreview` 资源预解析）
- 改 `web/src/useCenter.ts`、`web/src/components/TerminalView.vue`、`web/src/App.vue`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

## 测试计划

- `localHandles`（vitest，纯函数）：扩展名集合与 DocViewer 一致、`splitRel`/`joinRel` 规范化与 `..` 越界返回 `null`、`isTooLarge` 边界、`isProbablyBinary`。
- `useLocalSources`：`mountFolder` 替换旧根并清 `activePath` 且保留单文件条目、`addFiles` 返回 key 与 20 上限截断、`unmountRoot`/`removeFile` 互不影响、`releaseObjectUrls`。
- `localDocSource`（用结构化假句柄对象，无需真实 API）：文本读、图片 blob 缓存与 `rawUrl`、>10MB 抛错、二进制探测、`write` 授权已授予时写入成功、`requestPermission` 抛错时给出明确错误、无句柄时抛「不支持写回」。
- `localTreeSource`：假目录句柄 `values()` → 目录在前、越界 `..` 返回空、`open` 设置 `activePath`。
- `markdown`：`collectAssetRefs` 抽取相对 image/link（含 `..`、`?query#hash`、外链过滤）；`assetMap` 命中时替换、未命中且无 `projectId` 时保持原样。
- `useCenter`：`openLocalRoot`/`openLocalFile` id 与去重、`closeById` 对 `l:` 的分支。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
- 手动（Chrome/Edge）：拖单个 `.md`（含外链图片）→ 预览；拖含相对图片的文件夹 → 左树 + 预览图片正常；拖图片/PDF；编辑后 Ctrl+S 写回并在外部编辑器确认；等自动保存触发授权提示 → 点重试授权后自动保存成功；拖 >10MB 文本被拒；非 Chromium（或屏蔽 API）降级只读；刷新后本地页签消失。

## 后续（本轮不做）

- 多本地根并存与来源列表 UI。
- 句柄持久化（IndexedDB）+ 刷新后「重新授权」恢复。
- 本地目录的新建/重命名/删除/移动、定位资源管理器。
- 把本地来源「另存/固化」到工作目录（需弹系统目录对话框）。
- 拖入即上传到服务端工具目录（notepad 等）。
