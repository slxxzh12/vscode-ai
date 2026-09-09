# Markdown 文件预览模式 — 设计

日期：2026-09-09
状态：已确认（方案 A）
范围：`web/` 纯前端；不改 server / shared / 协议。

## 背景与目标

中央区页签打开文件时，当前 `FilePreview.vue` 只做语法高亮展示（`/api/file` 取文本 → hljs）。当打开的是 `.md` 文件时，用户希望：
1. 顶部出现「代码 | 预览」切换能力；
2. 预览把 Markdown 渲染成排版漂亮的网页内容；
3. 支持 Mermaid 图表（` ```mermaid ` 代码块）；
4. 附带：代码块 hljs 高亮、相对路径图片显示、相对链接可点击。

## 需求要点（已与用户确认）

- 打开 `.md` 文件**默认直接进入预览**；顶部切换条可随时切回「代码」。
- 预览范围仅 `.md`（`.markdown` 同义）文件。
- 本应用为离线绿色包，所有依赖必须经 Vite 本地打包，禁止外链 CDN。

## 方案

**方案 A（选定）**：纯前端渲染，全部落在现有 `FilePreview.vue` 页签内。

- 新依赖：`markdown-it`（同步小包）；`mermaid`（体积大，用动态 `import()` 拆成独立异步 chunk，仅预览首次需要时加载）。
- 预览 = 把 Markdown 渲染成 HTML 字符串放进 `.md-body` 容器（`v-html`），`nextTick` 后对容器内 `pre.mermaid` 节点调 `mermaid.run()` 出图。
- 不改后端：相对图片/链接统一改写为现成的 `/api/raw?project=&path=` URL。

## 组件与数据流

### 新模块 `web/src/markdown.ts`

纯函数式导出，供测试：

```ts
export interface MarkdownOptions {
  projectId: string;
  fileDir: string;          // 当前 .md 所在目录（相对项目根），用于拼相对引用
}
export function renderMarkdown(md: string, opt: MarkdownOptions): string
export function isMarkdownFile(name: string): boolean   // .md / .markdown
```

行为：
- `markdown-it` 实例：`html: false`（原始 HTML 一律转义输出，防本地文件 XSS），启用表格等默认扩展即可。
- **代码块（自定义 fence）**：
  - info 为 `mermaid`：输出 `<pre class="mermaid" data-processed="false">…转义原文…</pre>`，交给 mermaid 处理；
  - 其它语言：用现有 `highlight.js`（`web/src` 已装 `highlight.js`）输出 `<pre class="hljs"><code class="hljs language-X">`，高亮失败回退为转义文本；
  - 无语言：普通 `<pre><code>` 转义。
- **相对路径改写**（block/inline 渲染规则覆盖）：
  - 图片 `src`：`./x.png` / `../y/a.png` / 无协议相对路径 → 基于 `fileDir` 归一化后接 `/api/raw?project=&path=`；`http(s):`、`data:`、`#锚点` 不改写。
  - 链接 `href`：同样规则改写为 `/api/raw`（相对目标文件），并加 `target="_blank" rel="noopener"`；`#` 开头锚点不改写、不加 target（预览内不跳转，点击无副作用）。
  - 归一化用纯字符串/路径拼接实现（相对 md 目录 resolve），不能依赖 `path`（浏览器环境）。

### `FilePreview.vue` 修改

- 顶部增加 meta 工具条行；当 `isMarkdownFile(name)` 为真时，工具条内渲染「代码 | 预览」分段切换按钮（`viewMode: 'preview' | 'code'`，md 默认 `preview`；非 md 无按钮、保持现状）。
- 预览分支渲染：
  - `status === 'ok'` 且 `viewMode === 'preview'` 时渲染 `<div class="md-body" v-html="mdHtml">`；
  - 监听/同步内容与 viewMode 变化，DOM 挂载后（`nextTick`）调 `renderMermaid(containerEl)`；
  - 防竞态：每次渲染前递增令牌，mermaid 完成时若令牌过期则丢弃结果。
- mermaid 加载（模块内一次初始化）：
  - `const mermaid = (await import('mermaid')).default;`
  - `mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' })`；
  - `renderMermaid` 遍历 `pre.mermaid:not([data-processed="true"])`，逐块 `await mermaid.render(id, code)` 把 SVG 填回容器，成功置 `data-processed="true"`；解析失败保留错误提示文本并 `console.error`。
- 错误/加载态沿用现有 `loading/error` 文案结构，不新增全局提示。

### 样式 `web/src/styles/markdown.css`

- 全局（非 scoped）css 文件，在 `FilePreview.vue` 顶层引入，选择器全部挂在 `.md-body` 前缀下防串扰。
- GitHub-dark 风贴合现有深色 UI（`#0e1116` 底、`#d5dae1` 字）：
  - 正文宽度约束：`max-width: 820px`、左右内边距、`line-height: 1.6`；
  - 标题分级、表格（边框/表头底色/斑马纹）、引用块（左边线）、行内 code 底色块、hr、列表、图片（`max-width: 100%` 圆角）、链接色；
  - hljs 代码块底色略高于页面；mermaid SVG 居中。

### 依赖变更 `web/package.json`

- dependencies 增加：`markdown-it`；devDependencies 可选加类型：`@types/markdown-it`（若项目 TS 配置需要）。
- `mermaid` 不静态 import，靠动态 `import()`（属 dependencies）。

## 错误处理

- `/api/file` 失败、超 1MB：沿用现有 `loading/error` 显示。
- mermaid 渲染单个图失败：不影响其它图；该块显示错误说明。
- 预览 DOM 渲染不执行（`html:false` 转义），脚本类 Markdown 原文以文本呈现。

## 测试

- `web/src/markdown.test.ts`（vitest，纯函数）：
  - `isMarkdownFile` 大小写/无扩展/其它扩展；
  - fence 分类：` ```mermaid ` 输出 `pre.mermaid`、js 输出 hljs 高亮、无语言转义、高亮失败回退；
  - 相对路径改写：同目录、`../`、目录含空格/中文；`http(s)`/`data:`/`#` 不改写；
  - `html:false`：内嵌 `<script>`/`<img onerror>` 被转义。
- 验证命令：`npm.cmd run typecheck`、`npm.cmd test`（web 部分）、手工 `npm.cmd run dev:web` 起一个含 mermaid 与本地图片的样例 .md 目测。

## 非目标（YAGNI）

- 不改后端、不加 `/api/markdown` 类接口。
- 不做编辑器实时编辑/自动滚动/目录大纲/KaTeX/脚注。
- 不把样式做成可选主题切换（先一套深色 GitHub 风）。
