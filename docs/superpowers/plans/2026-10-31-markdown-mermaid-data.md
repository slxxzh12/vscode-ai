# Markdown 数据脚本生成 Mermaid 图表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 ```` ```mermaid-data ```` 围栏，执行其中的 JS（可相对当前 Markdown 读取数据），把返回值作为 Mermaid 源码渲染。

**Architecture:** markdown-it 只把围栏转成 `<pre class="mermaid-data">`；客户端增强阶段执行脚本、替换成 `<pre class="mermaid">`，再走现有 ECharts/Mermaid 管线。宿主通过 `readAsset(rel)` 注入相对路径读取能力。

**Tech Stack:** Node ESM、Vue 3、markdown-it、vitest、node:test。

---

### Task 1: 围栏渲染

**Files:**
- Modify: `shared/markdown.js`
- Test: `web/src/markdown.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/markdown.test.ts` 的 `describe('renderMarkdown')` 内追加：

```ts
it('mermaid-data 代码块 → pre.mermaid-data 且内容转义', () => {
  const h = renderMarkdown('```mermaid-data\nreturn `<b>x</b>`\n```', P);
  expect(h).toContain('class="mermaid-data"');
  expect(h).toContain('data-processed="false"');
  expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
  expect(h).not.toContain('<b>x</b>');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- markdown.test`
Expected: FAIL（输出里没有 `class="mermaid-data"`）。

- [ ] **Step 3: 实现 fence 分支**

在 `shared/markdown.js` 的 `md.renderer.rules.fence` 中，`if (parts[0] === 'mermaid')` 之前加：

```js
if (parts[0] === 'mermaid-data') {
  return `<pre class="mermaid-data" data-processed="false">${escapeHtml(token.content)}</pre>\n`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- markdown.test`
Expected: PASS。

---

### Task 2: 客户端执行数据脚本

**Files:**
- Modify: `shared/markdown-client.js`
- Modify: `shared/markdown-client.d.ts`
- Test: `web/src/markdown-enhance/mermaid-data.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `web/src/markdown-enhance/mermaid-data.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { enhanceDataCharts } from '@devflow/shared/markdown-client';

describe('enhanceDataCharts', () => {
  it('执行脚本，把返回值换成 mermaid 块', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<pre class="mermaid-data" data-processed="false">return "pie title X\\n  \\"a\\" : 1"</pre>';
    await enhanceDataCharts(host, { dataErrorText: (m) => `ERR:${m}` });
    const pre = host.querySelector('pre.mermaid');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('pie title X');
    expect(host.querySelector('pre.mermaid-data')).toBeNull();
  });

  it('fetch 相对路径交给 readAsset', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<pre class="mermaid-data" data-processed="false">const t = await (await fetch("./a.csv")).text(); return "pie title " + t</pre>';
    const calls: string[] = [];
    await enhanceDataCharts(host, {
      readAsset: async (p) => { calls.push(p); return 'X'; },
      dataErrorText: (m) => m,
    });
    expect(calls).toEqual(['./a.csv']);
    expect(host.querySelector('pre.mermaid')!.textContent).toContain('pie title X');
  });

  it('返回空内容 → 错误节点', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<pre class="mermaid-data" data-processed="false">return "   "</pre>';
    await enhanceDataCharts(host, { dataErrorText: (m) => `ERR:${m}` });
    const pre = host.querySelector('pre.mermaid-data-error');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('ERR:');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- mermaid-data`
Expected: FAIL（`enhanceDataCharts` 未导出）。

- [ ] **Step 3: 实现**

在 `shared/markdown-client.js` 顶部加入：

```js
function defaultReadAsset(rel) {
  const url = new URL(String(rel), document.baseURI).toString();
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}

function runDataScript(code, readAsset) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const safeFetch = async (path) => {
    const rel = String(path || '').trim();
    if (!rel || /^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
      throw new Error('only relative paths are allowed');
    }
    const text = await readAsset(rel);
    return new Response(String(text), { status: 200, headers: { 'Content-Type': 'text/plain' } });
  };
  const fn = new AsyncFunction('fetch', 'readFile', code);
  return fn(safeFetch, (p) => Promise.resolve(readAsset(String(p || ''))));
}

export async function enhanceDataCharts(container, options = {}) {
  const nodes = Array.from(container.querySelectorAll('pre.mermaid-data:not([data-processed="true"])'));
  if (!nodes.length) return;
  const readAsset = options.readAsset || defaultReadAsset;
  for (const pre of nodes) {
    try {
      const out = await runDataScript(pre.textContent || '', readAsset);
      if (typeof out !== 'string' || !out.trim()) throw new Error('empty mermaid source');
      const next = document.createElement('pre');
      next.className = 'mermaid';
      next.dataset.processed = 'false';
      next.textContent = out;
      pre.replaceWith(next);
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      pre.dataset.processed = 'error';
      pre.classList.remove('mermaid-data');
      pre.classList.add('mermaid-data-error');
      pre.textContent = options.dataErrorText ? options.dataErrorText(msg) : msg;
    }
  }
}
```

在 `enhanceMarkdown` 开头、`groupMermaidSides(container)` 之前加：

```js
await enhanceDataCharts(container, options);
```

在 `shared/markdown-client.d.ts` 的 `EnhanceMarkdownOptions` 增加：

```ts
readAsset?: (rel: string) => Promise<string>;
dataErrorText?: (msg: string) => string;
```

并导出：

```ts
export function enhanceDataCharts(
  container: HTMLElement,
  options?: { readAsset?: (rel: string) => Promise<string>; dataErrorText?: (msg: string) => string },
): Promise<void>;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- mermaid-data`
Expected: PASS。

---

### Task 3: 宿主相对路径读取

**Files:**
- Create: `web/src/markdownAssets.ts`
- Test: `web/src/markdownAssets.test.ts`（新建）
- Modify: `web/src/components/DocViewer.vue`
- Modify: `web/src/markdown-enhance/index.ts`

- [ ] **Step 1: 写失败测试**

新建 `web/src/markdownAssets.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { resolveRelPath, makeReadAsset } from './markdownAssets';
import type { DocSource } from './tools/doc/docSource';

describe('resolveRelPath', () => {
  it('按文件目录拼接并处理 ./ ../', () => {
    expect(resolveRelPath('docs', './a.csv')).toBe('docs/a.csv');
    expect(resolveRelPath('docs/sub', '../a.csv')).toBe('docs/a.csv');
    expect(resolveRelPath('', 'a.csv')).toBe('a.csv');
  });
  it('拒绝绝对路径与外部 URL', () => {
    expect(resolveRelPath('docs', '/a.csv')).toBeNull();
    expect(resolveRelPath('docs', 'https://x/a.csv')).toBeNull();
  });
});

describe('makeReadAsset', () => {
  it('读取相对路径对应的文件', async () => {
    const src = { read: async (p: string) => ({ name: p, content: `c:${p}`, size: 0 }) } as unknown as DocSource;
    const read = makeReadAsset(src, 'docs/a.md');
    expect(await read('./b.csv')).toBe('c:docs/b.csv');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- markdownAssets`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

新建 `web/src/markdownAssets.ts`：

```ts
import type { DocSource } from './tools/doc/docSource';

export function resolveRelPath(fileDir: string, rel: string): string | null {
  const s = String(rel || '').trim();
  if (!s || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|\\)/i.test(s)) return null;
  const segs = fileDir.split('/').filter(Boolean);
  for (const part of s.replace(/[?#].*$/, '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!segs.length) return null;
      segs.pop();
    } else segs.push(part);
  }
  return segs.join('/') || null;
}

export function makeReadAsset(source: DocSource, file: string): (rel: string) => Promise<string> {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  return async (rel: string) => {
    const target = resolveRelPath(dir, rel);
    if (!target) throw new Error('only relative paths are allowed');
    const r = await source.read(target);
    return r.content;
  };
}
```

`web/src/markdown-enhance/index.ts`：`enhanceMarkdown` 增加可选参数并透传：

```ts
export async function enhanceMarkdown(
  container: HTMLElement,
  opts: { readAsset?: (rel: string) => Promise<string> } = {},
): Promise<void> {
```

在调用 `enhanceShared` 的 options 里加：

```ts
readAsset: opts.readAsset,
dataErrorText: (msg) => t('markdown.data_error', { msg }),
```

`web/src/components/DocViewer.vue`：import：

```ts
import { makeReadAsset } from '../markdownAssets';
```

把 `await enhanceMarkdown(body);` 改为：

```ts
await enhanceMarkdown(body, { readAsset: makeReadAsset(props.source, props.path) });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- markdownAssets markdown-enhance`
Expected: PASS。

---

### Task 4: 静态网站页面

**Files:**
- Modify: `server/markdown-page.js`
- Test: `server/test/markdown-page.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/test/markdown-page.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownDocument } from '../markdown-page.js';

test('mermaid-data 页面注入 mermaid/echarts/client 脚本', () => {
  const html = renderMarkdownDocument('```mermaid-data\nreturn "pie title X\\n  \\"a\\" : 1"\n```', 't');
  assert.match(html, /class="mermaid-data"/);
  assert.match(html, /__devflow_mermaid__\.js/);
  assert.match(html, /__devflow_echarts__\.js/);
  assert.match(html, /__devflow_markdown__\.js/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/markdown-page.test.js`
Expected: FAIL（没有 mermaid/echarts 脚本）。

- [ ] **Step 3: 实现**

`server/markdown-page.js` 的 `scriptsHtml` 中：

```js
const hasData = /<pre class="[^"]*\bmermaid-data\b/.test(body);
const dynamic = hasMermaid || hasCharts || hasData;
```

脚本注入条件改为：

```js
if (hasMermaid || hasData) tags.push(`<script src="${MERMAID_SCRIPT_NAME}"></script>`);
if (hasCharts || hasData) tags.push(`<script src="${ECHARTS_SCRIPT_NAME}"></script>`);
```

增加错误文案模板并在 opts 里传入：

```js
const dataErrTpl = jsString(t('markdown.data_error', { msg: '@@MSG@@' }));
```

```js
+ `const dataErrTpl=${dataErrTpl};`
+ 'dataErrorText:(msg)=>dataErrTpl.replace(\'@@MSG@@\',String(msg||\'\')),'
```

`renderMarkdownDocument` 里同样加：

```js
const hasData = /<pre class="[^"]*\bmermaid-data\b/.test(body);
const dynamic = hasMermaid || hasChartSyntax(text) || hasData;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/test/markdown-page.test.js`
Expected: PASS。

---

### Task 5: 样式与词条

**Files:**
- Modify: `shared/markdown.css`
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`
- Test: `web/src/i18n.test.ts`（既有，跑通即可）

- [ ] **Step 1: 加样式**

在 `shared/markdown.css` 的 mermaid 规则附近加：

```css
.md-body pre.mermaid-data[data-processed="false"] { visibility: hidden; }
.md-body .mermaid-data-error {
  color: var(--errtx);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12.5px;
  padding: 8px 12px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: 6px;
}
```

- [ ] **Step 2: 加中英文词条**

`shared/i18n/zh-CN.js`：

```js
'markdown.data_error': '数据脚本执行失败：{msg}',
```

`shared/i18n/en.js`：

```js
'markdown.data_error': 'Data script failed: {msg}',
```

- [ ] **Step 3: 跑 i18n 与相关测试**

Run: `npm.cmd run check:i18n`
Expected: 通过，无中文命中。

Run: `npm.cmd --prefix web run test -- mermaid-data markdownAssets markdown.test`
Expected: PASS。

---

### Task 6: 全量验证与构建

- [ ] **Step 1: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过。

- [ ] **Step 2: 全量测试**

Run: `npm.cmd test`
Expected: 全部通过。

- [ ] **Step 3: 打包自检**

Run: `node scripts/build-all.js --no-zip`
Expected: 标准包与 opencode 包均输出 Done。
