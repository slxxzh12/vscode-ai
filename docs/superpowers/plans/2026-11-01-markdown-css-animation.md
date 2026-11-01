# Markdown 支持 CSS 动画 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Markdown 里的 `<style>`、内联 `style` 与内联 `<svg>` 在应用预览和静态网站 `.md` 页面中生效，默认开启且经过安全消毒。

**Architecture:** 共享模块 `shared/markdown-css.js` 负责提取样式、过滤危险片段并用 CSS `@scope` 限定作用域；应用内用 DOMPurify、静态页新增 `sanitize-html` 做 HTML 消毒；两边共用同一套样式处理。

**Tech Stack:** markdown-it、DOMPurify、sanitize-html、CSS `@scope`、Vitest、node:test。

---

### Task 1: 共享 CSS 处理模块

**Files:**
- Create: `shared/markdown-css.js`
- Create: `shared/markdown-css.d.ts`
- Test: `web/src/markdownCss.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/markdownCss.test.ts
import { describe, it, expect } from 'vitest';
import { extractStyleBlocks, sanitizeCss, renderStyleBlocks, scopeCss } from '@devflow/shared/markdown-css';

describe('extractStyleBlocks', () => {
  it('提取内容级与页面级样式，代码围栏内不提取', () => {
    const md = [
      '<style>.a { animation: fade .3s; }</style>',
      '<style data-scope="page">body { background: #000; }</style>',
      '',
      '```html',
      '<style>.no { color: red; }</style>',
      '```',
    ].join('\n');
    const r = extractStyleBlocks(md);
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0].page).toBe(false);
    expect(r.blocks[1].page).toBe(true);
    expect(r.markdown).toContain('<style>.no');
  });
});

describe('sanitizeCss', () => {
  it('移除危险片段；内容级去 @import，页面级保留', () => {
    expect(sanitizeCss('@import "x.css"; .a { width: expression(1); }')).not.toContain('@import');
    expect(sanitizeCss('@import "x.css";', { page: true })).toContain('@import');
    expect(sanitizeCss('.a { background: url(javascript:alert(1)); }')).not.toContain('javascript:');
    expect(sanitizeCss('.a{} </style><script>x</script>')).not.toContain('<script');
  });
});

describe('scopeCss / renderStyleBlocks', () => {
  it('内容级包 @scope，页面级不包', () => {
    expect(scopeCss('.a{}', '[data-md-css="x"]')).toContain('@scope ([data-md-css="x"])');
    const tags = renderStyleBlocks(
      [{ css: '.a{}', page: false }, { css: 'body{}', page: true }],
      '[data-md-css="x"]',
    );
    expect(tags.content).toContain('@scope');
    expect(tags.page).toContain('body{}');
    expect(tags.page).not.toContain('@scope');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web exec -- vitest run src/markdownCss.test.ts`
Expected: FAIL，提示找不到 `@devflow/shared/markdown-css`。

- [ ] **Step 3: 实现共享模块**

```js
// shared/markdown-css.js
// Markdown 样式提取、消毒与作用域注入；不执行任何脚本。

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const STYLE_OPEN_RE = /^\s*<style\b([^>]*)>/i;
const STYLE_END_RE = /<\/style>/i;

export function sanitizeCss(css, opts = {}) {
  let out = String(css || '').replace(/<\/style/gi, '');
  out = out.replace(/expression\s*\(/gi, 'blocked(');
  out = out.replace(/javascript\s*:/gi, 'blocked:');
  out = out.replace(/(^|[;{\s])(behavior|-moz-binding)\s*:/gi, '$1blocked:');
  if (!opts.page) out = out.replace(/@import[^;]*;/gi, '');
  return out.trim();
}

export function sanitizeCssValue(value) {
  return sanitizeCss(value, { page: true });
}

export function extractStyleBlocks(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const blocks = [];
  let fence = '';
  let inStyle = false;
  let page = false;
  let buf = [];

  const pushBlock = (css) => {
    if (String(css).trim()) blocks.push({ css: String(css), page });
    page = false;
    buf = [];
  };

  for (const line of lines) {
    if (!inStyle) {
      const fm = FENCE_RE.exec(line);
      if (fm) {
        const marker = fm[1][0];
        if (!fence) fence = marker;
        else if (fence === marker) fence = '';
        out.push(line);
        continue;
      }
      if (!fence) {
        const m = STYLE_OPEN_RE.exec(line);
        if (m) {
          page = /\bdata-scope\s*=\s*(?:"page"|'page'|page)\b/i.test(m[1]);
          const rest = line.slice(m.index + m[0].length);
          const end = STYLE_END_RE.exec(rest);
          if (end) {
            pushBlock(rest.slice(0, end.index));
            const tail = rest.slice(end.index + end[0].length);
            if (tail.trim()) out.push(tail);
          } else {
            inStyle = true;
            buf = rest ? [rest] : [];
          }
          continue;
        }
      }
      out.push(line);
      continue;
    }
    const end = STYLE_END_RE.exec(line);
    if (end) {
      buf.push(line.slice(0, end.index));
      pushBlock(buf.join('\n'));
      inStyle = false;
      const tail = line.slice(end.index + end[0].length);
      if (tail.trim()) out.push(tail);
    } else {
      buf.push(line);
    }
  }
  if (inStyle) pushBlock(buf.join('\n'));
  return { markdown: out.join('\n'), blocks };
}

export function scopeCss(css, selector) {
  if (!selector) return css;
  return `@scope (${selector}) {\n${css}\n}`;
}

export function renderStyleBlocks(blocks, scopeSelector) {
  const list = Array.isArray(blocks) ? blocks : [];
  const content = list
    .filter((b) => !b.page)
    .map((b) => sanitizeCss(b.css, { page: false }))
    .filter(Boolean)
    .join('\n');
  const page = list
    .filter((b) => b.page)
    .map((b) => sanitizeCss(b.css, { page: true }))
    .filter(Boolean)
    .join('\n');
  return {
    content: content ? `<style>${scopeCss(content, scopeSelector)}</style>` : '',
    page: page ? `<style>${page}</style>` : '',
  };
}

let seq = 0;
export function nextScopeId(prefix = 'md-css') {
  seq += 1;
  return `${prefix}-${seq}`;
}
```

```ts
// shared/markdown-css.d.ts
export interface MarkdownStyleBlock {
  css: string;
  page: boolean;
}

export function sanitizeCss(css: string, opts?: { page?: boolean }): string;
export function sanitizeCssValue(value: string): string;
export function extractStyleBlocks(md: string): { markdown: string; blocks: MarkdownStyleBlock[] };
export function scopeCss(css: string, selector?: string): string;
export function renderStyleBlocks(
  blocks: MarkdownStyleBlock[],
  scopeSelector?: string,
): { content: string; page: string };
export function nextScopeId(prefix?: string): string;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web exec -- vitest run src/markdownCss.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add shared/markdown-css.js shared/markdown-css.d.ts web/src/markdownCss.test.ts
git commit -m "feat(markdown): 新增 CSS 样式提取与作用域模块"
```

---

### Task 2: 应用内渲染默认开启原始 HTML 并注入样式

**Files:**
- Modify: `web/src/markdown.ts:7-19,113-154`
- Test: `web/src/markdown.test.ts:18-40,76-82`

- [ ] **Step 1: 更新失败测试**

把 `web/src/markdown.test.ts` 的「原始 HTML 模式」改为默认开启断言，并新增样式/SVG/危险内容断言：

```ts
describe('renderMarkdown 原始 HTML 模式', () => {
  it('默认开启：原始 HTML 与内联样式渲染，脚本与事件属性移除', () => {
    const md = '<div style="color:red">x</div><script>alert(1)</script><img src="x.png" onerror="alert(1)">';
    const h = renderMarkdown(md, P);
    expect(h).toContain('<div');
    expect(h).toContain('style="color:red"');
    expect(h).not.toContain('<script');
    expect(h).not.toContain('onerror');
  });

  it('html:false 时原始 HTML 转义', () => {
    const h = renderMarkdown('<script>alert(1)</script>', { ...P, html: false });
    expect(h).toContain('&lt;script&gt;');
  });

  it('<style> 转为作用域样式，@import 被移除', () => {
    const h = renderMarkdown('<style>@import "x.css"; .a { animation: fade 1s; }</style><div class="a">x</div>', P);
    expect(h).toContain('@scope');
    expect(h).toContain('animation: fade 1s');
    expect(h).not.toContain('@import');
  });

  it('内联 SVG 保留，脚本移除', () => {
    const h = renderMarkdown('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg><script>x</script>', P);
    expect(h).toContain('<svg');
    expect(h).toContain('<circle');
    expect(h).not.toContain('<script');
  });
});
```

同时把第 76 行的 `html:false` 测试改为显式 `html: false`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web exec -- vitest run src/markdown.test.ts`
Expected: FAIL（默认仍转义、`<style>` 被移除）。

- [ ] **Step 3: 修改 `web/src/markdown.ts`**

```ts
import {
  extractStyleBlocks,
  nextScopeId,
  renderStyleBlocks,
  sanitizeCssValue,
  type MarkdownStyleBlock,
} from '@devflow/shared/markdown-css';

export interface MarkdownOptions {
  projectId: string;
  fileDir: string;
  assetMap?: Map<string, string>;
  html?: boolean;
  extraStyleBlocks?: MarkdownStyleBlock[];
}

const PURIFY_OPTS = {
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button', 'select', 'option', 'math', 'link', 'meta', 'base'],
  FORBID_ATTR: ['srcdoc'],
};
```

在 `renderSafeHtml` 里，取到 `root` 后、`rewriteHtmlUrls` 前加内联样式清理：

```ts
function sanitizeInlineStyles(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('[style]'))) {
    const v = el.getAttribute('style') || '';
    el.setAttribute('style', sanitizeCssValue(v));
  }
}
```

```ts
  const root = host.querySelector('[data-md-html-root]') || host;
  sanitizeInlineStyles(root);
  rewriteHtmlUrls(root, opt);
```

替换 `renderMarkdown`：

```ts
export function renderMarkdown(mdText: string, opt: MarkdownOptions): string {
  if (opt.html === false) return md.render(mdText, { opt });
  const { markdown, blocks } = extractStyleBlocks(mdText);
  // 应用内页面级样式也按内容级处理
  const all = blocks.concat(opt.extraStyleBlocks || []).map((b) => ({ ...b, page: false }));
  const clean = renderSafeHtml(markdown, opt);
  if (!all.length) return clean;
  const scope = nextScopeId();
  const tags = renderStyleBlocks(all, `[data-md-css="${scope}"]`);
  return `<div data-md-css="${scope}">${tags.content}${clean}</div>`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web exec -- vitest run src/markdown.test.ts src/markdownCss.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/markdown.ts web/src/markdown.test.ts
git commit -m "feat(markdown): 默认开启消毒后的原始 HTML 与 CSS 动画"
```

---

### Task 3: DocViewer 默认开启并让 PPT 每页带上样式

**Files:**
- Modify: `web/src/components/DocViewer.vue:120-131,347-360,397-415`
- Test: `web/src/markdownPpt.test.ts`（已有键盘测试，无需改）、新增断言可放 `markdownCss.test.ts`

- [ ] **Step 1: 修改偏好默认值**

```ts
// 原始 HTML 默认开启；用户可手动关闭
function readMdHtmlPref(): boolean {
  try {
    const v = localStorage.getItem(MD_HTML_KEY);
    return v === null ? true : v === '1';
  } catch { return true; }
}
```

- [ ] **Step 2: 拆分 PPT 文档与样式**

在 `DocViewer.vue` 中 `splitMarkdownSlides` 的调用改为先提取样式：

```ts
import { extractStyleBlocks, type MarkdownStyleBlock } from '@devflow/shared/markdown-css';

function docSlides(): { slides: ReturnType<typeof splitMarkdownSlides>; blocks: MarkdownStyleBlock[] } {
  if (!mdHtmlOn.value) return { slides: splitMarkdownSlides(raw.value), blocks: [] };
  const { markdown, blocks } = extractStyleBlocks(raw.value);
  return { slides: splitMarkdownSlides(markdown), blocks };
}
```

`renderMdContent` 增加可选样式参数：

```ts
async function renderMdContent(text: string, extraStyleBlocks?: MarkdownStyleBlock[]): Promise<string> {
  // ...assetMap 逻辑不变
  return renderMarkdown(text, {
    projectId: props.source.markdownImageBase?.projectId || '',
    fileDir: fileDirOf(props.path),
    assetMap,
    html: mdHtmlOn.value,
    extraStyleBlocks,
  });
}
```

PPT 配置改为：

```ts
    slideCount: () => (isMd.value ? docSlides().slides.length : 0),
    slideTitle: (i) => docSlides().slides[i]?.title || '',
    renderSlide: (i) => {
      const { slides, blocks } = docSlides();
      const slide = slides[i];
      return slide ? renderMdContent(slide.content, blocks) : '';
    },
```

- [ ] **Step 3: 跑测试**

Run: `npm.cmd --prefix web exec -- vitest run src/markdownPpt.test.ts src/markdownSlides.test.ts src/markdown.test.ts`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add web/src/components/DocViewer.vue
git commit -m "feat(markdown): PPT 每页继承文档 CSS 动画"
```

---

### Task 4: 静态页 HTML 消毒模块

**Files:**
- Modify: `server/package.json`（新增 `sanitize-html`）
- Create: `server/markdown-sanitize.js`
- Test: `server/test/markdown-sanitize.test.js`

- [ ] **Step 1: 安装依赖**

Run: `npm.cmd install --workspace server sanitize-html`
Expected: `package.json` 出现 `sanitize-html`，lock 更新。

- [ ] **Step 2: 写失败测试**

```js
// server/test/markdown-sanitize.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMarkdownHtml } from '../markdown-sanitize.js';

test('保留 svg 与内联样式，移除脚本/事件/iframe', () => {
  const html = sanitizeMarkdownHtml(
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' +
    '<div style="animation:fade 1s">x</div>' +
    '<script>x</script><iframe src="x"></iframe><img src="x" onerror="x">',
  );
  assert.match(html, /<svg/);
  assert.match(html, /<circle/);
  assert.match(html, /style="animation:fade 1s"/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<iframe/);
  assert.doesNotMatch(html, /onerror/);
});

test('内联样式里的危险片段被移除', () => {
  const html = sanitizeMarkdownHtml('<div style="background:url(javascript:alert(1))">x</div>');
  assert.doesNotMatch(html, /javascript:/);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test server/test/markdown-sanitize.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现消毒模块**

```js
// server/markdown-sanitize.js
import sanitizeHtml from 'sanitize-html';
import { sanitizeCssValue } from '@devflow/shared/markdown-css';

const SVG_TAGS = [
  'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
  'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'use',
  'symbol', 'clipPath', 'mask', 'pattern', 'title', 'desc',
];
const SVG_ATTRS = [
  'xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity',
  'stroke-opacity', 'font-size', 'text-anchor', 'preserveAspectRatio', 'id',
  'gradientUnits', 'offset', 'stop-color', 'stop-opacity', 'href',
];

const forbidden = new Set(['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button', 'select', 'option', 'link', 'meta', 'base']);
const allowedTags = sanitizeHtml.defaults.allowedTags.filter((t) => !forbidden.has(t)).concat(SVG_TAGS);
const allowedAttributes = { ...sanitizeHtml.defaults.allowedAttributes };
allowedAttributes['*'] = [...(allowedAttributes['*'] || []), 'class', 'id', 'style', 'title'];
for (const tag of SVG_TAGS) allowedAttributes[tag] = [...(allowedAttributes[tag] || []), ...SVG_ATTRS];

export function sanitizeMarkdownHtml(html) {
  const clean = sanitizeHtml(String(html || ''), {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'xlink:href'],
    disallowedTagsMode: 'discard',
  });
  return clean.replace(/style="([^"]*)"/g, (_m, v) => `style="${sanitizeCssValue(v).replace(/"/g, '&quot;')}"`);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test server/test/markdown-sanitize.test.js`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add server/package.json package-lock.json server/markdown-sanitize.js server/test/markdown-sanitize.test.js
git commit -m "feat(markdown): 新增静态页 HTML 消毒模块"
```

---

### Task 5: 静态网站 `.md` 接入样式与页面级 CSS

**Files:**
- Modify: `shared/markdown.js`（导出 html 引擎）
- Modify: `server/markdown-page.js:4,68-70,125-135`
- Test: `server/test/markdown-page.test.js`

- [ ] **Step 1: 写失败测试**

```js
// 追加到 server/test/markdown-page.test.js
test('Markdown 样式按内容作用域注入，页面级样式进入 head', () => {
  const md = [
    '# 标题',
    '<style>.a { animation: fade 1s; }</style>',
    '<style data-scope="page">body { background: #000; }</style>',
    '<div class="a">x</div>',
  ].join('\n');
  const html = renderMarkdownDocument(md, 't');
  assert.match(html, /@scope \(\.md-body\)/);
  assert.match(html, /body \{ background: #000; \}/);
  assert.match(html, /<div class="a">x<\/div>/);
});

test('静态页移除脚本并保留内联 SVG', () => {
  const html = renderMarkdownDocument(
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg><script>x</script>',
    't',
  );
  assert.match(html, /<svg/);
  assert.match(html, /<circle/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/markdown-page.test.js`
Expected: FAIL（样式被转义/未注入）。

- [ ] **Step 3: 导出 html 引擎**

在 `shared/markdown.js` 末尾追加：

```js
export const markdownHtml = createMarkdown({ html: true });

export function renderMarkdownRawHtml(text) {
  return markdownHtml.render(String(text || ''));
}
```

- [ ] **Step 4: 修改静态页渲染**

`server/markdown-page.js` 顶部 import 改为：

```js
import { escapeHtml, isMarkdownFile, renderMarkdownRawHtml } from '@devflow/shared/markdown';
import { extractStyleBlocks, renderStyleBlocks } from '@devflow/shared/markdown-css';
import { sanitizeMarkdownHtml } from './markdown-sanitize.js';
```

`renderMarkdownDocument` 改为：

```js
export function renderMarkdownDocument(text, title, extraHtml = '') {
  const { markdown, blocks } = extractStyleBlocks(text);
  const body = sanitizeMarkdownHtml(renderMarkdownRawHtml(markdown));
  const slides = splitMarkdownSlides(markdown).map((s) => ({
    title: s.title,
    html: sanitizeMarkdownHtml(renderMarkdownRawHtml(s.content)),
  }));
  const styles = renderStyleBlocks(blocks, '.md-body');
  const hasMermaid = /<pre class="[^"]*\bmermaid\b/.test(body);
  const hasData = /<pre class="[^"]*\bmermaid-data\b/.test(body);
  const dynamic = hasMermaid || hasChartSyntax(markdown) || hasData;
  const scripts = scriptsHtml(markdown, body, title, slides);
  const pending = dynamic ? ' data-df-pending="1"' : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><script>${THEME_INIT_SCRIPT}</script><style>${THEME_CSS}${markdownCss()}${pptCss()}</style>${styles.content}${styles.page}</head><body><article class="md-body md-page"${pending}>${body}</article>${scripts}${extraHtml}</body></html>`;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test server/test/markdown-page.test.js server/test/markdown-sanitize.test.js`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add shared/markdown.js server/markdown-page.js server/test/markdown-page.test.js
git commit -m "feat(markdown): 静态页支持 CSS 动画与页面级样式"
```

---

### Task 6: 文案、README 与整体验证

**Files:**
- Modify: `shared/i18n/zh-CN.js:1497-1498`
- Modify: `shared/i18n/en.js:1497-1498`
- Modify: `README.md:140`
- Modify: `README.zh-CN.md:140`

- [ ] **Step 1: 更新 HTML 开关提示（默认已开启）**

```js
// zh-CN.js
'fp.md_html_hint': '渲染 Markdown 中的原始 HTML、内联 SVG 与 CSS 动画（默认开启；关闭后按纯文本显示，内容会经安全消毒）',
```

```js
// en.js
'fp.md_html_hint': 'Render raw HTML, inline SVG, and CSS animations inside Markdown (on by default; turn off to show them as text; content is sanitized)',
```

- [ ] **Step 2: README 补充动画说明**

英文 `README.md` 的 Markdown 增强列表加一条：

```md
- **CSS animations**: `<style>` blocks and inline `style` work in Markdown preview and static `.md` pages; content styles are scoped to the document, page-level styles (`<style data-scope="page">`) apply only to static pages. Inline SVG is allowed; scripts remain disabled.
```

中文 `README.zh-CN.md` 对应加一条：

```md
- **CSS 动画**：Markdown 预览与静态 `.md` 页面都支持 `<style>` 与内联 `style`；内容级样式自动限定在文档内，页面级样式（`<style data-scope="page">`）只在静态页生效。允许内联 SVG，仍禁止脚本。
```

- [ ] **Step 3: 全量验证**

Run:
```bash
npm.cmd run check:i18n
npm.cmd --prefix web exec -- vitest run src/markdown.test.ts src/markdownCss.test.ts src/markdownSlides.test.ts src/markdownPpt.test.ts
node --test server/test/markdown-page.test.js server/test/markdown-sanitize.test.js
npm.cmd run typecheck
```
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js README.md README.zh-CN.md
git commit -m "docs(markdown): 说明 CSS 动画与 SVG 支持"
```

---

## 自审

- 规格覆盖：样式/内联/页面级/SVG/Web/静态页/PPT/安全/测试均有对应任务。
- 占位符：无 TBD/TODO；所有实现步骤含完整代码。
- 类型一致：`MarkdownStyleBlock`、`extractStyleBlocks`、`renderStyleBlocks`、`sanitizeMarkdownHtml` 在任务间命名一致。
