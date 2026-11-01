# Markdown 支持 CSS 动画（设计）

## 背景

当前 Markdown 渲染默认关闭原始 HTML（`html: false`）；即使打开应用内的「HTML」开关，DOMPurify 也会移除 `<style>`、`script`、`svg`，因此 Markdown 里写的 CSS 动画（`@keyframes`、`transition`、伪类、内联 `style`）无法生效。静态网站的 `.md` 页面完全走 `html: false`，更不支持。

需要让作者可以在 Markdown 中直接写 CSS 动画，并在应用内预览与静态网站 `.md` 页面都生效。

## 目标

- 支持 `<style>` 块与元素内联 `style`，可用于 `@keyframes`、`transition`、伪类等。
- 默认开启，无需额外开关；仍提供现有「HTML」开关用于完全关闭原始 HTML。
- 应用内预览、静态网站 `.md` 页面都生效；PPT 模式沿用同一渲染。
- 默认把样式限制在文档内容区，避免影响应用界面；静态页支持页面级样式。
- 允许消毒后的内联 `<svg>` 与其 CSS 动画。
- 基础安全过滤：禁止脚本、事件属性、iframe/form 等；允许任意 `http(s)` `url()` 外部资源。
- 禁止 `javascript:`、`expression()`、`behavior`、`-moz-binding` 与 `</style` 注入。

## 非目标

- 不执行任何 JavaScript（不放开 `<script>`、`on*` 事件属性、`javascript:` URL）。
- 不做 sandbox iframe 渲染。
- 不为不支持 CSS `@scope` 的旧浏览器提供 polyfill（降级为动画不生效，其余正常）。
- 不自动解析/生成动画，作者直接写 CSS。

## 编写方式

````md
<style>
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: none; }
  }
  .fade-in { animation: fade-in .6s ease both; }
</style>

<div class="fade-in" style="animation-delay: .2s">内容</div>

<svg class="fade-in" width="80" height="80" viewBox="0 0 80 80">
  <circle cx="40" cy="40" r="30" fill="currentColor" />
</svg>
````

页面级样式（仅静态网站页面整页生效）：

````md
<style data-scope="page">
  body { background: #0b1020; }
</style>
````

- 普通 `<style>`：内容级，只作用于当前文档内容区。
- `<style data-scope="page">`：静态网站页面整页生效；应用内预览仍按内容级处理。
- 代码围栏（```` ``` ```` / `~~~`）里的 `<style>`、`#` 不参与提取。

## 实现

### 1. 共享 CSS 模块（新增 `shared/markdown-css.js`）

- `extractStyleBlocks(md)`：按行扫描并跳过代码围栏，提取 `<style ...>…</style>`，返回去掉这些块的 Markdown 与 `{ css, page }` 列表。
- `sanitizeCss(css, { page })`：
  - 移除 `expression(`、`javascript:`、`behavior`、`-moz-binding`、`</style`；
  - 内容级移除 `@import`，页面级允许；
  - 允许任意 `url()`（含 `http(s)`）。
- `scopeCss(css, selector)`：内容级输出 `@scope (<selector>) { … }`；页面级原样返回。
- `injectStyles(html, blocks, scopeSelector)`：生成 `<style>` 并拼到渲染结果。
- 每次渲染生成唯一作用域标识（如 `md-css-1`），避免多个预览 / 多页 PPT 样式互相污染。
- 已知限制：`@keyframes` 名称仍是全局的；同一页面多份文档建议使用带前缀的动画名。

### 2. 应用内渲染（`web/src/markdown.ts`、`DocViewer.vue`）

- 原始 HTML 默认开启（`html: true`）；「HTML」开关改为可关闭。
- 渲染流程：
  1. `extractStyleBlocks` 取出样式；
  2. markdown-it（`html: true`）渲染正文；
  3. DOMPurify 消毒（白名单放开 `<svg>` 及常见子元素/属性，继续禁止 script/iframe/form/事件属性）；
  4. `sanitizeCss` + `scopeCss`；
  5. 输出正文并附带 `<style>`，正文根节点标记唯一 `data-md-css` 作用域。
- 内联 `style` 保留并由消毒器过滤危险值。
- PPT：每页 HTML 自带样式与作用域，翻页时随 DOM 释放。

### 3. 静态网站页面（`server/markdown-page.js`）

- `.md` 页面改为 `html: true`。
- 新增 Node 端 HTML 消毒器 `sanitize-html`，与 Web 共用标签/属性白名单策略。
- 内容级样式注入到 `article.md-page` 的作用域；`data-scope="page"` 的样式注入到 `<head>`（整页生效）。
- 现有 Mermaid / ECharts / `mermaid-data` / PPT 脚本注入逻辑不变。

### 4. 安全边界

- 仍禁止：`<script>`、`<iframe>`、`<object>`、`<embed>`、`<form>` 及输入控件、`on*` 事件属性、`javascript:`。
- SVG 允许，但同样走标签/属性白名单与 CSS 值过滤。
- 允许外链 `url()` 与页面级 `@import`；内容级 `@import` 禁止。
- HTML 开关关闭时，原始 HTML（含 `<style>`、内联 `style`、`<svg>`）按文本转义。

### 5. 依赖

- Web 已有 `dompurify`。
- `server/package.json` 新增 `sanitize-html`（Node 端消毒，随绿色包发布）。
- 不新增 CSS 解析依赖，作用域使用浏览器原生 `@scope`。

## 测试

- `shared/markdown-css` 单元：
  - 提取 `<style>`，代码围栏内不提取；
  - 内容级禁止 `@import`、页面级允许；
  - 危险片段被移除；
  - `scopeCss` 生成 `@scope`，页面级不包裹。
- Web（happy-dom）：
  - 默认渲染保留 `<style>`、内联 `style`、`<svg>`；
  - `<script>`、`onclick`、`javascript:` 被移除；
  - 内容级样式带唯一作用域；
  - 关闭 HTML 开关后样式退回文本。
- Server：
  - 静态 `.md` 输出内容级作用域样式与页面级样式；
  - 危险标签/属性被移除；
  - Mermaid / PPT 脚本不受影响。
- PPT：同一页样式随页切换，不串页。

## 兼容性

- 现有 Markdown 表格、Mermaid、xychart/pie、`mermaid-data`、PPT 行为不变。
- 原始 HTML 由默认关闭改为默认开启（经消毒），依赖“HTML 默认关闭”的旧文档需要重新确认；可用 HTML 开关关闭。
- 不支持 `@scope` 的浏览器：内容级动画不生效，页面级样式正常。
