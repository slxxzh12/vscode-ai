# Markdown 数据脚本生成 Mermaid 图表（设计）

## 背景

Markdown 目前支持 ```` ```mermaid ```` 静态图表，但数据写死在源码里。需要从当前 Markdown 同目录读取 CSV/JSON 等文件，处理后生成 Mermaid 源码，再复用现有图表渲染能力。

## 目标

- 新增 ```` ```mermaid-data ```` 围栏：内容是一段异步 JS，返回值作为 Mermaid 源码。
- 支持 `fetch('./data.csv')` 按当前 Markdown 所在目录解析。
- 复用现有渲染管线：xychart/pie/gantt/timeline/flowchart 走 ECharts，其他交给 mermaid。
- Web 预览、工具文档、静态网站三处共用 `@devflow/shared/markdown-client` 的同一实现。

## 非目标

- 不做 `![]()` 按扩展名内嵌文件（CSV/MD/图片/文本）。
- 不开放普通 Markdown 的原始 HTML（保持 `html: false`）。
- 不做数据文件的自动解析/列推断，数据处理全部由脚本完成。
- 不做 Web Worker 隔离（后续可加）。

## 语法

````md
```mermaid-data
const res = await fetch('./sales.csv');
const rows = (await res.text()).trim().split(/\r?\n/).map(r => r.split(','));

const labels = rows.slice(1).map(r => r[0]);
const values = rows.slice(1).map(r => Number(r[1]));

return `xychart-beta
  title "Sales"
  x-axis [${labels.join(',')}]
  y-axis "Amount"
  bar [${values.join(',')}]`;
```
````

- 返回值必须是字符串；非字符串视为错误。
- 不再需要下方再写 ```` ```mermaid ```` 块。

## 实现

### 1. Markdown 渲染（`shared/markdown.js`）

- 在 fence 规则里识别首个 info 词为 `mermaid-data`。
- 输出 `<pre class="mermaid-data" data-processed="false">${escapeHtml(content)}</pre>`。
- 与 `mermaid` 围栏区分，避免被 mermaid 官方渲染逻辑直接处理。

### 2. 客户端增强（`shared/markdown-client.js`）

新增 `enhanceDataCharts(container, options)`：

1. 遍历 `pre.mermaid-data:not([data-processed="true"])`。
2. 用 `new Function('fetch', 'readFile', code)` 构造异步函数并执行。
   - `readFile(path)` 返回文本。
   - `fetch(path)` 为受限包装：仅接受相对路径，交给 `options.readAsset(path)` 解析；不允许直接访问外网。
3. 等待返回值，校验为字符串。
4. 创建 `<pre class="mermaid">返回源码</pre>` 替换原节点，并标记已处理。
5. 失败时替换为错误提示节点（复用 `options.errorText`），不影响其他块。

`enhanceMarkdown` 调整为：先 `await enhanceDataCharts(...)`，再执行现有表格、ECharts、Mermaid 流程。

### 3. 相对路径解析（`options.readAsset`）

宿主注入 `readAsset(rel: string): Promise<string>`：

- 静态网站页（`server/markdown-page.js`）：`fetch(new URL(rel, location.href))`（由页面脚本默认实现）。
- 应用内项目文件（`FilePreview` / `DocViewer`）：以当前 Markdown 路径所在目录拼接 `rel`，走 `source.read` 或 `source.rawUrl`。
- 本地文件：走 `resolveMarkdownAssets` 得到 blob URL 后 fetch。
- 工具文件（notepad/markdown/js）：走 `source.read` 拼目录。

`enhanceMarkdown`（`web/src/markdown-enhance/index.ts`）增加可选参数，由 `DocViewer` 根据当前 `source` 与 `path` 生成 `readAsset`。

### 4. 静态页面脚本注入（`server/markdown-page.js`）

存在 `mermaid-data` 块时，页面必须加载 mermaid + echarts + markdown-client（数据脚本运行前无法判断最终图表类型），因此 `scriptsHtml` 把 `class="mermaid-data"` 也计入动态图表条件。

### 5. 错误提示

新增 i18n 键（中英）：
- `markdown.data_error`：数据脚本执行失败（含错误消息）

## 安全

- `mermaid-data` 会执行 Markdown 内的任意 JS；仅对可信文件使用。
- 通过注入的 `fetch` 限制为相对路径读取，不提供外网/应用 API 直接访问能力。
- 普通 Markdown 的 `html: false` 与现有 XSS 防护不变。

## 测试

- `shared/markdown.js`：`mermaid-data` 围栏输出 `pre.mermaid-data` 且内容转义。
- `shared/markdown-client.js`（web 测试环境）：
  - 脚本返回 xychart 源码 → 生成可被 `parseMermaidChart` 识别的图表。
  - 脚本抛错 / 返回非字符串 → 显示错误节点。
  - `fetch('./a.csv')` 调用注入的 `readAsset`，收到拼接后的相对路径。
- `DocViewer`：`readAsset` 按当前文件目录解析。
- `server/markdown-page.js`：含 `mermaid-data` 时注入 mermaid/echarts/client 脚本。

## 兼容性

- 现有 ```` ```mermaid ````、表格增强、ECharts 流程不变。
- 打包：仅新增 shared 源文件与 i18n 词条，`build.js` / `build-mac.js` 已按 shared 包整体拷贝。
