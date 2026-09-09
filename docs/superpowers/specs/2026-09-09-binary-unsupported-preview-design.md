# 二进制文件 →「不支持预览」提示页 设计

日期：2026-09-09

## 目标

exe/zip/dll 等二进制文件在 FilePreview 中被当作文本打开，目前表现为 >1MB 报 413 或按 UTF-8 解码成乱码。本次改造：

- 打开二进制文件时**后端探测并明确标识**，前端渲染「不支持预览」提示页，不再尝试读全文/挂编辑器。
- 提示页展示文件绝对路径为**可点击链接**，点击后调用系统资源管理器在所在目录中**定位并选中该文件**（explorer `/select`）。
- 二进制文件上保留 ⓘ 详细信息（meta/hash 可用，不读内容）。

## 方案

### 后端（`server/projects.js`）

`readText(projectId, rel, maxBytes = 1024*1024)` 增加二进制探测：

1. stat 后，读取文件**前 64KB**（`fs.readFileSync(file)` 截取，或 `createReadStream` 取首块）。
2. 探测窗口内若含 `0x00` 字节 → 判定二进制，返回 `{ name, path, size, mtime, abs, binary: true }`（**不含 content**）。
   - 大文件（>1MB）若在探测窗口命中 NUL，正常返回 binary，不再抛 `too-large`。
3. 探测窗口无 NUL → 保持现有逻辑：`size > maxBytes` 抛 `too-large`（413），否则 UTF-8 全文 + `binary: false`。

`server/http-api.js` `/api/file` GET 路由无需改动（透传 readText 返回值）。

### 前端（`web/src/components/FilePreview.vue`）

- `load()` 成功且 `f.binary === true` → 不 `mountEditor`，进入提示态。
- 模板新增居中提示面板（kind=text 分支内，替代编辑器/预览显示）：

```
⚠ 此文件为二进制格式，不支持网页预览

[绝对路径（可点击，mono）]  （title=完整路径）
[📂 在资源管理器中定位]（按钮，调 reveal(projectId, path)）
```

- 顶栏：二进制态保留 ⓘ 详细信息（`detailOpen`/`toggleDetail` 逻辑复用，meta/hash 对二进制有效）；格式化/Base64/排序/编辑器/预览切换等因现有 `kind === 'text' && showEditor` 等条件自动隐藏，需确认二进制态 `showEditor` 为 false。
- 新增 `isBinary` ref；`load()` 内设置/复位；`watch([projectId,path])` 切换文件自动复位。
- 底部常驻状态栏（上个改动）照常贴底。

### 可点击路径实现

提示页路径链接与「在资源管理器中定位」按钮均调用 web 端已有 `reveal(projectId, path)`（`useProjects.ts`，调 `/api/explorer/reveal`，后端对文件用 explorer `/select,<abs>` 高亮）。失败用 `alert` 报错（与 FileTree 行为一致）或复用底部状态栏报错——**采用底部状态栏**（`setToolMsg`），避免多套错误呈现。

## 数据流

```
FileTree 点击 exe → center.openFile → FilePreview load()
  → text() GET /api/file → readText 探测
     → binary:true 返回 {binary,name,path,size,mtime,abs}
  → isBinary=true, 不挂编辑器, 渲染提示面板
用户点绝对路径 / 「在资源管理器中定位」→ reveal(projectId,path) → /api/explorer/reveal → explorer /select 高亮
```

## 错误处理

- reveal 失败 → `setToolMsg('无法在系统资源管理器中打开：<msg>', false)`（底部状态栏）。
- 二进制大文件 hash：沿用现有 >50MB confirm 逻辑。

## 测试

- **server（TDD）**：`server/test/projects.test.js` 或 http-api 测试新增：
  1. 含 NUL 的小文件 → readText 返回 `binary:true` 且无 content。
  2. 普通 UTF-8 文本 → `binary:false` + content 正常。
  3. >1MB 且首 64KB 含 NUL → 返回 binary 而非 413。
  4. >1MB 且无 NUL（纯文本大文件）→ 仍抛 `too-large`。
- **web**：typecheck + build 通过；无组件测试基建（沿用惯例）。

## 手动验证

打开 exe/zip 文件 → 显示「不支持预览」提示面板（非乱码/非 413）→ 点绝对路径在资源管理器高亮该文件；ⓘ 详细信息可打开并算 hash；无 reveal 支持平台报错进状态栏。

## 范围外（YAGNI）

- 不做前端按扩展名预判（由后端统一探测）。
- 不处理目录（FileTree 双击目录为展开，不进 FilePreview）。
- 不改 image/pdf 分支。
