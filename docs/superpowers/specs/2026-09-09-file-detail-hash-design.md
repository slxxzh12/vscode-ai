# 设计：文件详细信息（绝对路径 / 大小 / MD5+SHA256）

日期：2026-09-09

## 背景与目标

devflow 内浏览文件时缺少"这个文件到底多大、在磁盘哪个位置、哈希是什么"的能力。目标：

- FilePreview 顶栏（文本文件）与 image/pdf 顶部细条提供「ⓘ 详细信息」开关；
- FileTree 左树对文件节点提供右键「ⓘ 详细信息」→ 在右侧预览区打开/激活该文件并自动展开详情面板；
- 面板展示：名称、类型、绝对路径（可复制）、大小、修改时间；MD5 与 SHA256 由后端单趟流式计算，>50MB 先 confirm 提示耗时。

## 架构

### A. 后端：两个轻量只读接口

文本读取有 1MB 上限（`readText`），图片/PDF 根本不读内容 → 详情不能只依赖 `/api/file`。新增两条 GET 路由，全部复用 `Projects` 既有的越界 / 符号链接逃逸防护（`_filePath`），只读不改写：

1. `GET /api/file/meta?project=&path=`
   - `projects.js` 新增 `meta(projectId, rel)`：`_filePath` 解析 → `statSync` → 返回 `{ name, path, abs, size, mtime }`。
   - 文件或目录皆可（目录 `abs`/`size` 仍可展示），`size` 为字节数，不设上限。
   - 错误码沿用：`not-found`、`forbidden`、`not-file` 不需要（目录也放行）。

2. `GET /api/file/hash?project=&path=`
   - `http-api.js` 内联实现（或 `projects.js` 加 `hash()`）：校验为普通文件（目录返回 `not-file`）→ `fs.createReadStream` 按 64KB chunk 同时喂 `crypto.createHash('md5')` 与 `crypto.createHash('sha256')` → 返回 `{ md5, sha256 }`。
   - 异步读流，不阻塞事件循环；单趟双哈希。
   - 测试：`server/test/http-api.test.js` 新增——meta 正常返回字段、meta 目录也返回、hash 与 `crypto` 直接算的已知值一致、越界 403、不存在 404。

`shared/` 视需要补充类型（前端可用 `any`/局部接口，不强求入库）。

### B. 前端：FilePreview 详情面板

新增状态 `detailOpen` 与数据 `detail = ref<{name,path,abs,size,mtime}|null>`、hash 计算状态。

- **开关位置**：
  - 文本文件（`kind==='text'`）：现有顶栏工具条加 `ⓘ 详细信息` 按钮，置于 Base64 开关旁。
  - image / pdf：当前没有头部工具条，为 image/pdf 补一条**顶部细条**（左：文件名；右侧：`ⓘ 详细信息` 开关；无其它文本工具按钮）。细条样式沿用 `.head`。
- **面板**：编辑器/图片/PDF 下方展开一块 `.detailpanel`（与 Base64 面板风格一致，独立于 b64）。字段列表：
  - 名称 / 类型（文件/图片/PDF/目录标签可简化为 text|image|pdf）
  - 绝对路径（可复制按钮；文本超长省略，`title` 全量）
  - 大小（`fmtBytes` 自适应 B/KB/MB）
  - 修改时间（`fmtMtime`）
  - MD5、SHA256 两行，初始 `—`，一个「计算 MD5+SHA256」按钮触发。
- **hash 触发**：
  - 若 `size > 50MB` → `window.confirm('文件较大（XX），计算 MD5/SHA256 可能需要一段时间，继续？')`，取消则不计算。
  - 计算中：按钮变 disabled「计算中…」，两行显示 `…`。
  - 完成：MD5/SHA256 展示；每行提供「复制」。失败：行内红字错误。
  - 二次打开面板不自动重算，仅当文件（path）变化重置。
- **数据来源**：打开面板时调 `/api/file/meta` 获取字段（不依赖文本 1MB 读取 → 大文件即使文本无法预览也能出详情）。加载 `meta` 失败面板内显示错误。
- `useProjects.ts` 新增 `fileMeta()`、`fileHash()` 两个 `get` 封装。
- 大文本超 1MB 打开时 FilePreview 现有行为就是报「打开失败」——详情面板独立加载 meta，仍可正常展示（既有行为，不属本次改动）。

### C. 左树右键 → 预览区联动

- `FileTree.vue` 右键菜单在 `menu.type === 'file'` 时增加「ⓘ 详细信息」项（放「复制路径」上方或分组）。点击后：`closeMenu()` + `emit('detail-file', projectId, path, name)`。
- `App.vue`：
  - 新 `detailToken = ref(0)`。
  - 收到 `detail-file` → `openFile(projectId, path, name)`（已开则 `center.openFile` 幂等激活）→ `detailToken.value++`。
- `App.vue → TerminalView` 传递 `:detail-token="detailToken"`；`TerminalView → FilePreview` 透传 `:detail-token`。
- `FilePreview.vue` 新增 prop `detailToken?: number`（`watch`，非 immediate）：当事件值变化且 `props.projectId/path` 与当前激活文件一致 → `detailOpen = true` 并触发 meta 加载。手动开关文件时 `load()` 已含重置逻辑，避免误弹。

## 交互细节 / 边界

- 详情与 Base64 面板可同时打开（垂直叠放各自独立区域）或互斥关闭——采用**互相独立**，同一时刻两者都显示时纵向叠加；为控制高度，面板高约 180–220px、内部可滚动。
- 切换文件 / 关闭面板 → 重置 detail 数据（沿用 `load()` 重置点）。
- 目录节点右键**不出现**「详细信息」（菜单项按 `type === 'file'` 过滤）。
- 打开已超过 1MB 的文本时现有错误提示保留；详情面板仍可查看 meta/hash。

## 涉及文件

- 新增接口：`server/projects.js`（`meta()`，hash 视实现位置）、`server/http-api.js`、`server/test/http-api.test.js`
- 前端：`web/src/useProjects.ts`、`web/src/components/FilePreview.vue`、`web/src/components/FileTree.vue`、`web/src/components/TerminalView.vue`、`web/src/App.vue`
- 可选：`shared/` 类型

## 测试

- server：`http-api.test.js` 补 meta/hash/越界/不存在用例；`npm.cmd test` 全绿。
- web：不新增组件测试（仓库无 FilePreview/FileTree 组件测试先例）；`npm.cmd run typecheck` + `npm.cmd run build:web` 通过。
- 手动：文本/图片/PDF 三种入口、大文件 confirm、树右键联动、路径复制。

## 范围外（YAGNI）

- 不做目录 hash（目录无意义）。
- 不做进度条百分比（流式计算大文件可选后续优化，本次仅「计算中…」）。
- 不做 sha1/多算法选择。
- 不改 `/api/file` 读取上限。
