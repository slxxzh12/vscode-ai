# 项目文件搜索（类 IDEA / VS Code）设计

## 背景

「目录」页签由 `web/src/components/HistoryList.vue` 渲染，其树视图是统一 `web/src/components/TreeView.vue` + 数据源 `web/src/tree/projectTreeSource.ts`（包装 `useProjects`）。后端已有 `/api/tree`（列目录）、`/api/file`（读文件）等接口，实现在 `server/projects.js` / `server/http-api.js`。

现状问题：目录页签只有目录树，没有搜索入口。用户要在项目里按文件名找文件、按内容找命中行，只能自己逐目录展开或用外部工具，效率低。

目标形态对齐 IDEA「Find in Path」/ VS Code 搜索面板：点目录上方搜索按钮 → 弹框 → 输入关键词 → 按「文件名命中」与「内容命中」两组展示；内容命中按文件分组，列出每个命中行与行号，点击直达该行并高亮。

## 目标

- 目录页签头部新增 🔍 按钮，点击弹出搜索框（el-dialog）。
- 一个输入框同时搜索**文件名**与**文件内容**，结果分两组。
- 内容命中**按文件分组**：文件头显示相对路径 + 命中处数（可折叠），组下列出每条命中 `行号 + 该行文本`，关键词高亮。
- 点击文件名命中 → 打开该文件；点击内容命中行 → 打开文件并定位到该行高亮。
- 支持「区分大小写」开关，默认不区分。
- 搜索范围：**当前选中的项目目录内**。
- 搜索时跳过 `node_modules`、`.git`、`dist`、`dist-portable` 等常见目录。
- 全量中英 i18n。

## 非目标

- 不做跨项目搜索。
- 不做全词匹配、正则、文件类型过滤（含/排除）等高级选项。
- 不做结果流式推送（SSE/WS）、不做搜索历史。
- 不改工具侧树（notepad/postman/navicat 等）；它们不实现搜索能力时按钮自动隐藏。

## 设计

### 一、后端扫描（新增 `server/project-search.js`）

新增独立模块，导出 `searchProject(root, { query, caseSensitive = false, limits })`，纯文件系统遍历，不依赖 HTTP。

- **忽略目录**（常量集，按目录名精确匹配）：`node_modules`、`.git`、`dist`、`dist-portable`、`build`、`out`、`coverage`、`.next`、`.nuxt`、`.cache`、`.idea`、`.vscode`。
- **遍历**：显式栈（非递归），`fs.readdirSync(dir, { withFileTypes: true })`；跳过符号链接目录，防目录环；目录先入栈顺序不影响结果正确性。
- **文件名命中**：对文件 basename 做（按开关的）大小写 `includes`，命中即收集 `{ path, name }`（`path` 为相对 root 的 POSIX 风格路径）。
- **内容命中**：仅文本文件。
  - 先按大小筛：`size > MAX_FILE_BYTES`（默认 1MB）跳过。
  - 读前 64KB，含 NUL 视为二进制跳过（复用 `projects.readText` 的二进制探测思路）。
  - 逐行查找子串（按开关大小写），收集 `{ path, name, line, text }`：`line` 为 1-based 行号，`text` 为该行原文（截断到 400 字符）。
- **上限（`limits` 可覆盖，命中任一即 `truncated: true`）**：
  - 文件名命中 ≤ 200；
  - 内容命中总条数 ≤ 300；
  - 单文件内容命中 ≤ 50；
  - 扫描文件数 ≤ 20000。
- 返回 `{ nameHits, contentHits, truncated, scanned }`。
- `query` 为空：由路由层返回 400；模块层可返回空结果，不做报错。

### 二、HTTP 接口（`server/http-api.js`）

- 新增 `GET /api/search?project=&q=&case=`：
  - `project` 经 `projects._project`/`listProjects` 解析出 root；不存在 → 复用 `treeStatusOf` 的 404；越界/非法由模块抛 `forbidden` → 403。
  - `q` 去空后为空 → 400 `{ error: 'q required' }`。
  - `case` 为 `1`/`true` 时 `caseSensitive = true`。
  - 调用 `searchProject(root, { query, caseSensitive })`，`sendJson(200, result)`。
  - 异常按现有约定 `sendJson(res, treeStatusOf(e?.code), { error: e?.code || 'failed' })`。

### 三、树数据源契约扩展（`web/src/tree/treeSource.ts`）

沿用现有「能力缺省即隐藏」约定，新增可选能力：

```ts
export interface SearchHit { path: string; name: string; line?: number; }
export interface SearchResult {
  nameHits: { path: string; name: string }[];
  contentHits: { path: string; name: string; line: number; text: string }[];
  truncated: boolean;
  scanned: number;
}
export interface TreeSource {
  // …
  search?(query: string, opts: { caseSensitive: boolean }): Promise<SearchResult>;
  openHit?(hit: SearchHit): void;
}
```

类型定义放在 `treeSource.ts`，与契约同处。

### 四、项目数据源实现（`web/src/tree/projectTreeSource.ts` + 新 `web/src/search/projectSearch.ts`）

- 新增 `web/src/search/projectSearch.ts`：`searchProject(projectId, query, opts)` 调 `GET /api/search`，做类型化解析与错误抛出（复用现有 fetch 封装风格，如 `useProjects`）。
- `projectTreeSource` 增加：
  - `search(query, opts)` → 调 `projectSearch`。
  - `openHit(hit)` → 调新回调 `opts.onOpenFileAt(pid, hit.path, hit.name, hit.line)`。
  - 入参新增可选 `onOpenFileAt`；未提供时退回 `onOpenFile`（不跳行）。

### 五、弹窗组件（新增 `web/src/components/FileSearchDialog.vue`）

- el-dialog（宽约 720px，`append-to-body`，`:model-value="open"`，`@update:model-value` 关闭）。
- 顶部：搜索输入框 + 「Aa 区分大小写」开关；输入防抖 300ms 自动搜索（≥1 字符），回车立即搜索。
- 结果区两组，各带总数：
  1. **文件名命中**：扁平列表，每行相对路径，点击 `source.openHit({ path, name })` 并关闭。
  2. **内容命中**：按文件分组；文件头显示「相对路径 + 命中 N 处」并可折叠；组内每行 `行号 + 该行文本`（关键词高亮），点击 `source.openHit({ path, name, line })` 并关闭。文件头点击 → `openHit({ path, name })`（只打开不跳行）。
- 状态：未搜索、加载中、无命中、出错、`truncated` 提示「结果过多，已截断」。
- 高亮实现：纯展示层按大小写设置对命中行做分段 `<span class="hit">`；不引入新依赖。

### 六、`TreeView.vue` 接入

- 头部操作区在 `⟳ / 📄＋ / 📁＋` 旁，当 `source.search` 存在时显示 🔍 按钮，点击 `searchOpen = true`。
- `TreeView` 内部持有 `searchOpen`，渲染 `<FileSearchDialog v-if="searchOpen" :source="source" @close="searchOpen = false" />`。
- 工具树未实现 `search` → 按钮自动隐藏，无行为变化。

### 七、打开并跳行链路

- `HistoryList.vue`：`projectTreeSource({ ..., onOpenFileAt })`，新增 emit `open-file-at(projectId, path, name, line)`。
- `App.vue`：新增 `onOpenFileAt(projectId, path, name, line)`（仿 `onDetailFile`）：
  - `pushFileHistory` + `center.openFile(...)`；
  - 维护 `locatePath` / `locateLine` / `locateToken` 三个 ref，`locateToken++`。
  - 透传 `:locate-token / :locate-path / :locate-line` 给 `TerminalView`。
- `TerminalView.vue`：新增三个 props，透传到 `FilePreview`。
- `FilePreview.vue`：新增三个 props，透传到 `DocViewer`。
- `DocViewer.vue`：新增 props `locateToken?` / `locatePath?` / `locateLine?`：
  - 监听 `locateToken`（配合 `locatePath === path`）；`locateLine > 0` 时：
    - 若当前非 code 模式（markdown/html 默认 preview），先切到 `viewMode = 'code'`；
    - 待编辑器挂载后，用 CodeMirror 计算该行起止偏移，`dispatch` 选中该行、`scrollIntoView` 并 `focus`；可用一次性 line 高亮/选区表示。
  - 文件首次打开时（`load()` 完成）也要消费 pending 的定位请求，避免与挂载时序竞争（`load` 内完成后调用 `applyLocate()`）。
  - 图片/PDF/二进制：无编辑器，定位请求直接忽略。
- 同一文件重复跳不同行：`:key="activeFile.id"` 不变，靠 `locateToken` 变化重新触发。

### 八、i18n（`shared/i18n/zh-CN.js` + `en.js`）

新增 `search.*` 词条（中英对称），至少包含：按钮 title、弹窗标题、输入占位、区分大小写、文件名分组标题、内容分组标题、命中处数、加载中、无命中、出错、结果截断、关闭等。提交前跑 `npm.cmd run check:i18n`。

## 影响文件

- 新增 `server/project-search.js`、`server/test/project-search.test.js`
- 改 `server/http-api.js`、`server/test/http-api.test.js`
- 改 `web/src/tree/treeSource.ts`、`web/src/tree/projectTreeSource.ts`
- 新增 `web/src/search/projectSearch.ts`
- 新增 `web/src/components/FileSearchDialog.vue`、`web/src/components/FileSearchDialog.test.ts`
- 改 `web/src/components/TreeView.vue`（头部按钮 + 挂载弹窗）
- 改 `web/src/components/HistoryList.vue`、`web/src/App.vue`、`web/src/components/TerminalView.vue`、`web/src/components/FilePreview.vue`、`web/src/components/DocViewer.vue`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

## 测试计划

- server `project-search`（新增，`node --test`）：临时目录构造树，覆盖文件名命中、内容命中行号与文本、区分大小写开关、跳过 `node_modules/.git/dist`、跳过二进制与 >1MB 文件、各类上限触发 `truncated`、空 `q`（模块层空结果）、越界 root。
- server `http-api`：补 `GET /api/search` 正常返回、`q` 为空 400、未知项目 404、越界 403。
- web `FileSearchDialog`（vitest）：分组渲染、命中数、点击文件头 / 命中行分别 emit 正确参数、空态/错误态/截断态。
- web `projectSearch` / `projectTreeSource`：请求参数（project/q/case）与响应映射、`openHit` 回调带 `line`。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
- 手动：目录页签点 🔍 → 输入关键词 → 两组结果正确 → 点内容命中行打开文件并高亮跳到该行；开启「区分大小写」结果变化；大项目搜索不卡 UI、显示截断提示。

## 后续（本轮不做）

- 跨项目 / 全局搜索。
- 正则、全词、文件类型过滤，`.gitignore` 精确忽略。
- 搜索历史与最近搜索、结果二次过滤。
- 内容搜索流式增量返回与可取消。
- 结果面板内直接替换（Replace）/ 批量改写。
