# Markdown Viewer Vue 组件与构建 Implementation Plan（Plan 2/3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@devflow/markdown-viewer` 上增加 Vue 3 组件、ElTable 渲染器、内置中英词条、样式、standalone 入口与可发布构建产物。

**Architecture:** 保留 Plan 1 迁入的 `src/core/*`（ESM JS + d.ts）作为框架无关内核；新增 `src/vue/` 适配层与 `src/index.ts` 根入口；用 Vite library mode 输出 `dist/`（`vue`、`element-plus` external），再用独立配置输出 `dist/standalone/`（内置 Vue + Element Plus，供静态页使用）。

**Tech Stack:** Vue 3、Element Plus、Vite 6、vite-plugin-dts、Vitest、happy-dom、DOMPurify、ECharts、Mermaid、X6。

**前置：** 已完成 Plan 1（core 已迁入 `packages/markdown-viewer/src/core/`，`shared/markdown*` 为兼容 shim）。

---

## 文件结构

```
packages/markdown-viewer/
  package.json
  tsconfig.json
  vite.config.ts
  vite.standalone.config.ts
  vitest.config.ts
  src/
    index.ts                 # 根入口：MarkdownViewer / useMarkdownViewer / 类型
    core/
      index.js / .d.ts       # Plan 1 的 src/index.js 移到这里
      i18n/
        messages.ts          # 词条类型 + zh-CN / en 默认值
        index.ts             # translate / resolveMessages
      sanitize.ts
      render.ts
      charts-loader.ts
    vue/
      MarkdownViewer.vue
      useMarkdownViewer.ts
      table-renderer.ts
      styles/
        variables.css
        markdown.css
        ppt.css
        index.css
      index.ts
    standalone.ts
  test/
    i18n.test.ts
    render.test.ts
    table-renderer.test.ts
    markdown-viewer.test.ts
```

---

### Task 1: 安装构建依赖并更新包脚本

**Files:**
- Modify: `packages/markdown-viewer/package.json`

- [ ] **Step 1: 安装依赖**

Run:
```powershell
npm.cmd install -D -w packages/markdown-viewer vue@^3.5.0 element-plus@^2.14.0 vite@^6.0.0 @vitejs/plugin-vue@^5.2.0 vite-plugin-dts@^4.3.0 typescript@~5.6.0 vitest@^2.1.0 @vue/test-utils@^2.4.6 happy-dom@^15.11.7 vue-tsc@^2.1.0
```
Expected: 退出码 0，`packages/markdown-viewer/package.json` 的 `devDependencies` 出现上述包。

- [ ] **Step 2: 更新 `package.json` 的 exports / scripts / peerDependencies**

把 `packages/markdown-viewer/package.json` 改成：

```json
{
  "name": "@devflow/markdown-viewer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "src/core", "src/vue/styles"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./style.css": "./dist/style.css",
    "./standalone": "./dist/standalone/index.js",
    "./standalone/*": "./dist/standalone/*",
    "./core": { "types": "./src/core/index.d.ts", "default": "./src/core/index.js" },
    "./core/markdown": { "types": "./src/core/markdown.d.ts", "default": "./src/core/markdown.js" },
    "./core/markdown-client": { "types": "./src/core/markdown-client.d.ts", "default": "./src/core/markdown-client.js" },
    "./core/markdown-charts": { "types": "./src/core/markdown-charts.d.ts", "default": "./src/core/markdown-charts.js" },
    "./core/markdown-css": { "types": "./src/core/markdown-css.d.ts", "default": "./src/core/markdown-css.js" },
    "./core/markdown-flowchart": { "default": "./src/core/markdown-flowchart.js" },
    "./core/markdown-flowchart-editor": { "types": "./src/core/markdown-flowchart-editor.d.ts", "default": "./src/core/markdown-flowchart-editor.js" },
    "./core/markdown-flowchart-graph": { "types": "./src/core/markdown-flowchart-graph.d.ts", "default": "./src/core/markdown-flowchart-graph.js" },
    "./core/markdown-flowchart-model": { "types": "./src/core/markdown-flowchart-model.d.ts", "default": "./src/core/markdown-flowchart-model.js" },
    "./core/markdown-flowchart-x6": { "types": "./src/core/markdown-flowchart-x6.d.ts", "default": "./src/core/markdown-flowchart-x6.js" },
    "./core/markdown-ppt": { "types": "./src/core/markdown-ppt.d.ts", "default": "./src/core/markdown-ppt.js" },
    "./core/markdown-ppt-export": { "types": "./src/core/markdown-ppt-export.d.ts", "default": "./src/core/markdown-ppt-export.js" },
    "./core/markdown-slides": { "types": "./src/core/markdown-slides.d.ts", "default": "./src/core/markdown-slides.js" },
    "./core/markdown-table-sort": { "types": "./src/core/markdown-table-sort.d.ts", "default": "./src/core/markdown-table-sort.js" },
    "./package.json": "./package.json"
  },
  "sideEffects": ["**/*.css"],
  "scripts": {
    "build": "vite build && vite build --config vite.standalone.config.ts",
    "build:main": "vite build",
    "build:standalone": "vite build --config vite.standalone.config.ts",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json"
  },
  "peerDependencies": {
    "element-plus": "^2.14.0",
    "vue": "^3.5.0"
  },
  "dependencies": {
    "@antv/x6": "^3.1.8",
    "@dagrejs/dagre": "^3.1.3",
    "dompurify": "^3.4.15",
    "highlight.js": "^11.10.0",
    "markdown-it": "^14.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.0",
    "@vue/test-utils": "^2.4.6",
    "element-plus": "^2.14.0",
    "happy-dom": "^15.11.7",
    "typescript": "~5.6.0",
    "vite": "^6.0.0",
    "vite-plugin-dts": "^4.3.0",
    "vitest": "^2.1.0",
    "vue": "^3.5.0",
    "vue-tsc": "^2.1.0"
  }
}
```

- [ ] **Step 3: 确认依赖安装**

Run: `npm.cmd ls -w packages/markdown-viewer vue element-plus vite vite-plugin-dts`
Expected: 全部已安装，无 `missing`。

### Task 2: 添加 TS / Vite / Vitest 配置

**Files:**
- Create: `packages/markdown-viewer/tsconfig.json`
- Create: `packages/markdown-viewer/vite.config.ts`
- Create: `packages/markdown-viewer/vite.standalone.config.ts`
- Create: `packages/markdown-viewer/vitest.config.ts`

- [ ] **Step 1: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "allowJs": true,
    "checkJs": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "src/**/*.js", "test/**/*.ts"]
}
```

- [ ] **Step 2: `vite.config.ts`（主构建）**

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';

const external = [
  'vue',
  'element-plus',
  'echarts',
  'echarts/core',
  'echarts/charts',
  'echarts/components',
  'echarts/renderers',
  'mermaid',
  '@antv/x6',
  '@dagrejs/dagre',
  'markdown-it',
  'highlight.js',
  'dompurify',
  'pptxgenjs',
  'html-to-image',
];

export default defineConfig({
  plugins: [vue(), dts({ include: ['src/**/*.ts', 'src/**/*.vue'], outDir: 'dist' })],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { external },
    cssCodeSplit: false,
  },
});
```

- [ ] **Step 3: `vite.standalone.config.ts`（静态页自举构建）**

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: './',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: { entry: 'src/standalone.ts', formats: ['es'], fileName: 'index' },
    outDir: 'dist/standalone',
    emptyOutDir: true,
    rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js' } },
    cssCodeSplit: false,
  },
});
```

- [ ] **Step 4: `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
```

### Task 3: 调整 core 根出口与包根入口

**Files:**
- Move: `packages/markdown-viewer/src/index.js` → `packages/markdown-viewer/src/core/index.js`
- Move: `packages/markdown-viewer/src/index.d.ts` → `packages/markdown-viewer/src/core/index.d.ts`
- Create: `packages/markdown-viewer/src/index.ts`
- Create: `packages/markdown-viewer/src/vue/index.ts`

- [ ] **Step 1: 移动 core 根出口**

Run:
```powershell
git mv packages/markdown-viewer/src/index.js packages/markdown-viewer/src/core/index.js
git mv packages/markdown-viewer/src/index.d.ts packages/markdown-viewer/src/core/index.d.ts
```

移动后把 `src/core/index.js` 的相对路径从 `./core/` 改为 `./`，完整内容：

```js
export * from './markdown.js';
export * from './markdown-client.js';
export * from './markdown-charts.js';
export * from './markdown-css.js';
export * from './markdown-flowchart.js';
export * from './markdown-flowchart-graph.js';
export * from './markdown-flowchart-model.js';
export * from './markdown-ppt.js';
export * from './markdown-ppt-export.js';
export * from './markdown-slides.js';
export * from './markdown-table-sort.js';
```

`src/core/index.d.ts` 完整内容：

```ts
export * from './markdown.js';
export * from './markdown-client.js';
export * from './markdown-charts.js';
export * from './markdown-css.js';
export * from './markdown-flowchart-graph.js';
export * from './markdown-flowchart-model.js';
export * from './markdown-ppt.js';
export * from './markdown-ppt-export.js';
export * from './markdown-slides.js';
export * from './markdown-table-sort.js';
```

- [ ] **Step 2: 新建 Vue 入口 `src/vue/index.ts`**

```ts
export { default as MarkdownViewer } from './MarkdownViewer.vue';
export { useMarkdownViewer } from './useMarkdownViewer';
export type { MarkdownViewerOptions, MarkdownTheme } from './useMarkdownViewer';
export { createElementTableRenderer } from './table-renderer';
export type { TableData, TableRenderer } from './table-renderer';
```

PPT 演示/导出在 Plan 3 通过 core 的 `createPptPresenter` / `exportPptx` 接入，不在此计划新增 Vue 侧控制器。

- [ ] **Step 3: 新建包根入口 `src/index.ts`**

```ts
export * from './vue';
export type { MarkdownLocale, MarkdownMessages } from './core/i18n';
export { renderMarkdown } from './core/render';
export type { RenderOptions } from './core/render';
```

### Task 4: 内置中英词条

**Files:**
- Create: `packages/markdown-viewer/src/core/i18n/messages.ts`
- Create: `packages/markdown-viewer/src/core/i18n/index.ts`
- Test: `packages/markdown-viewer/test/i18n.test.ts`

- [ ] **Step 1: 写词条 `messages.ts`**

```ts
export type MarkdownLocale = 'zh-CN' | 'en';

export interface MarkdownMessages {
  'markdown.mermaid_error': string;
  'markdown.data_error': string;
  'table.confirm': string;
  'flowchart.edit.title': string;
  'flowchart.edit.save': string;
  'flowchart.edit.cancel': string;
  'flowchart.edit.add_node': string;
  'flowchart.edit.add_edge': string;
  'flowchart.edit.add_group': string;
  'flowchart.edit.del': string;
  'flowchart.edit.layout': string;
  'flowchart.edit.reconnect_source': string;
  'flowchart.edit.reconnect_target': string;
  'flowchart.edit.hint': string;
  'ppt.open': string;
  'ppt.close': string;
  'ppt.prev': string;
  'ppt.next': string;
  'ppt.hide_nav': string;
  'ppt.export': string;
  'ppt.exporting': string;
  'ppt.export_failed': string;
}

export const ZH_CN: MarkdownMessages = {
  'markdown.mermaid_error': 'Mermaid 渲染失败：{msg}',
  'markdown.data_error': '数据脚本执行失败：{msg}',
  'table.confirm': '确定',
  'flowchart.edit.title': '编辑流程图',
  'flowchart.edit.save': '保存',
  'flowchart.edit.cancel': '取消',
  'flowchart.edit.add_node': '添加节点',
  'flowchart.edit.add_edge': '添加连线',
  'flowchart.edit.add_group': '添加子图',
  'flowchart.edit.del': '删除',
  'flowchart.edit.layout': '自动布局',
  'flowchart.edit.reconnect_source': '重连起点',
  'flowchart.edit.reconnect_target': '重连终点',
  'flowchart.edit.hint': '双击节点/连线改标签；把节点拖进子图即可分组。',
  'ppt.open': 'PPT 模式',
  'ppt.close': '退出 PPT',
  'ppt.prev': '上一页',
  'ppt.next': '下一页',
  'ppt.hide_nav': '隐藏翻页',
  'ppt.export': '导出 PPT',
  'ppt.exporting': '导出中 {done} / {total}',
  'ppt.export_failed': '导出 PPT 失败：{msg}',
};

export const EN: MarkdownMessages = {
  'markdown.mermaid_error': 'Mermaid render failed: {msg}',
  'markdown.data_error': 'Data script failed: {msg}',
  'table.confirm': 'OK',
  'flowchart.edit.title': 'Edit flowchart',
  'flowchart.edit.save': 'Save',
  'flowchart.edit.cancel': 'Cancel',
  'flowchart.edit.add_node': 'Add node',
  'flowchart.edit.add_edge': 'Add edge',
  'flowchart.edit.add_group': 'Add group',
  'flowchart.edit.del': 'Delete',
  'flowchart.edit.layout': 'Auto layout',
  'flowchart.edit.reconnect_source': 'Reconnect source',
  'flowchart.edit.reconnect_target': 'Reconnect target',
  'flowchart.edit.hint': 'Double-click a node/edge to edit its label; drag a node into a group to embed it.',
  'ppt.open': 'PPT mode',
  'ppt.close': 'Exit PPT',
  'ppt.prev': 'Previous',
  'ppt.next': 'Next',
  'ppt.hide_nav': 'Hide pager',
  'ppt.export': 'Export PPT',
  'ppt.exporting': 'Exporting {done} / {total}',
  'ppt.export_failed': 'PPT export failed: {msg}',
};

export const DEFAULT_MESSAGES: Record<MarkdownLocale, MarkdownMessages> = {
  'zh-CN': ZH_CN,
  en: EN,
};
```

- [ ] **Step 2: 写 `i18n/index.ts`**

```ts
import { DEFAULT_MESSAGES, type MarkdownLocale, type MarkdownMessages } from './messages';

export type { MarkdownLocale, MarkdownMessages } from './messages';
export { DEFAULT_MESSAGES } from './messages';

export function resolveMessages(
  locale: MarkdownLocale = 'zh-CN',
  overrides?: Partial<MarkdownMessages>,
): MarkdownMessages {
  return { ...(DEFAULT_MESSAGES[locale] || DEFAULT_MESSAGES.en), ...(overrides || {}) };
}

export function translate(
  messages: MarkdownMessages,
  key: keyof MarkdownMessages,
  params: Record<string, string> = {},
): string {
  const template = messages[key] || DEFAULT_MESSAGES.en[key] || String(key);
  return template.replace(/\{(\w+)\}/g, (_, name) => (name in params ? params[name] : `{${name}}`));
}
```

- [ ] **Step 3: 写测试**

创建 `packages/markdown-viewer/test/i18n.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { resolveMessages, translate } from '../src/core/i18n';

describe('i18n', () => {
  it('falls back to en and interpolates', () => {
    const messages = resolveMessages('en');
    expect(translate(messages, 'markdown.mermaid_error', { msg: 'x' })).toBe('Mermaid render failed: x');
  });

  it('merges overrides', () => {
    const messages = resolveMessages('zh-CN', { 'table.confirm': '好' });
    expect(messages['table.confirm']).toBe('好');
  });
});
```

- [ ] **Step 4: 跑测试**

Run: `npm.cmd --prefix packages/markdown-viewer test -- i18n`
Expected: PASS。

### Task 5: 通用消毒与 Markdown 渲染

**Files:**
- Create: `packages/markdown-viewer/src/core/sanitize.ts`
- Create: `packages/markdown-viewer/src/core/render.ts`
- Test: `packages/markdown-viewer/test/render.test.ts`

- [ ] **Step 1: `sanitize.ts`**

```ts
import DOMPurify from 'dompurify';
import { sanitizeCssValue } from './markdown-css.js';

const PURIFY_OPTS = {
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button', 'select', 'option', 'math', 'link', 'meta', 'base'],
  FORBID_ATTR: ['srcdoc'],
  ADD_ATTR: ['target'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

const purify = (() => {
  const factory = DOMPurify as unknown;
  if (typeof factory === 'function' && typeof window !== 'undefined') {
    return (factory as (w: Window) => typeof DOMPurify)(window);
  }
  return DOMPurify;
})();

export function sanitizeHtml(html: string): string {
  return purify.sanitize(html, PURIFY_OPTS);
}

export function sanitizeInlineStyles(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('[style]'))) {
    const value = el.getAttribute('style') || '';
    el.setAttribute('style', sanitizeCssValue(value));
  }
}
```

- [ ] **Step 2: `render.ts`**

```ts
import { createMarkdown } from './markdown.js';
import { extractStyleBlocks, nextScopeId, renderStyleBlocks, type MarkdownStyleBlock } from './markdown-css.js';
import { sanitizeHtml, sanitizeInlineStyles } from './sanitize';

export interface RenderOptions {
  html?: boolean;
  sanitize?: boolean;
  assetSrc?: (rel: string, suffix: string) => string | null;
  extraStyleBlocks?: MarkdownStyleBlock[];
}

const md = createMarkdown();
const mdHtml = createMarkdown({ html: true });

function splitUrl(raw: string): { rel: string; suffix: string } | null {
  if (/^(https?:|data:|blob:|mailto:|tel:)/i.test(raw)) return null;
  if (raw.startsWith('#') || raw.startsWith('/')) return null;
  const qi = raw.search(/[?#]/);
  const before = qi < 0 ? raw : raw.slice(0, qi);
  if (!before) return null;
  return { rel: before, suffix: qi < 0 ? '' : raw.slice(qi) };
}

function rewrite(root: ParentNode, assetSrc?: RenderOptions['assetSrc']): void {
  if (!assetSrc) return;
  for (const img of Array.from(root.querySelectorAll('img[src]'))) {
    const hit = splitUrl(img.getAttribute('src') || '');
    if (!hit) continue;
    const next = assetSrc(hit.rel, hit.suffix);
    if (next) img.setAttribute('src', next);
  }
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const hit = splitUrl(a.getAttribute('href') || '');
    if (!hit) continue;
    const next = assetSrc(hit.rel, hit.suffix);
    if (!next) continue;
    a.setAttribute('href', next);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  }
}

export function renderMarkdown(text: string, options: RenderOptions = {}): string {
  if (options.html === false) return md.render(text);
  const { markdown, blocks } = extractStyleBlocks(text);
  const raw = mdHtml.render(markdown);
  const wrapped = `<div data-md-html-root>${raw}</div>`;
  const clean = options.sanitize === false ? wrapped : sanitizeHtml(wrapped);
  if (typeof document === 'undefined') return clean;

  const host = document.createElement('div');
  host.innerHTML = clean;
  const root = host.querySelector('[data-md-html-root]') || host;
  sanitizeInlineStyles(root);
  rewrite(root, options.assetSrc);

  const all = blocks.concat(options.extraStyleBlocks || []).map((b) => ({ ...b, page: false }));
  if (!all.length) return root.innerHTML;
  const scope = nextScopeId();
  const tags = renderStyleBlocks(all, `[data-md-css="${scope}"]`);
  return `<div data-md-css="${scope}">${tags.content}${root.innerHTML}</div>`;
}
```

- [ ] **Step 3: 写测试**

创建 `packages/markdown-viewer/test/render.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/core/render';

describe('renderMarkdown', () => {
  it('renders mermaid blocks', () => {
    const html = renderMarkdown('```mermaid\npie\n  "a": 1\n```');
    expect(html).toContain('class="mermaid"');
  });

  it('rewrites relative images via assetSrc', () => {
    const html = renderMarkdown('![x](img/a.png)', { assetSrc: (rel) => `/raw/${rel}` });
    expect(html).toContain('src="/raw/img/a.png"');
  });
});
```

- [ ] **Step 4: 跑测试**

Run: `npm.cmd --prefix packages/markdown-viewer test -- render`
Expected: PASS。

### Task 6: ElTable 表格渲染器

**Files:**
- Create: `packages/markdown-viewer/src/vue/table-renderer.ts`
- Test: `packages/markdown-viewer/test/table-renderer.test.ts`

- [ ] **Step 1: 移植并参数化现有表格实现**

把 `web/src/markdown-enhance/table.ts` 的完整实现复制到 `src/vue/table-renderer.ts`，做以下替换：

1. 删除 `import { elementLocale } from '../element-locale'`。
2. 新增 `import en from 'element-plus/es/locale/lang/en'; import zhCn from 'element-plus/es/locale/lang/zh-cn';`。
3. 新增导出：

```ts
import { resolveMessages, type MarkdownLocale, type MarkdownMessages } from '../core/i18n/index';

export type TableData = { headers: string[]; rows: string[][] };
export interface TableRenderer {
  (host: HTMLElement, data: TableData): { dispose(): void };
}

function localeFor(locale: MarkdownLocale, messages: MarkdownMessages) {
  if (locale === 'en') return en;
  return { ...zhCn, el: { ...zhCn.el, table: { ...zhCn.el.table, confirmFilter: messages['table.confirm'] } } };
}

export function createElementTableRenderer(
  locale: () => MarkdownLocale,
  messages: () => MarkdownMessages,
): TableRenderer {
  return (host, data) => mountTable(host, data, localeFor(locale(), messages()));
}
```

4. 把原 `TableHost` 的 `ElConfigProvider` 改为使用传入的 locale：

```ts
const TableHost = defineComponent({
  props: {
    headers: { type: Array as PropType<string[]>, required: true },
    rows: { type: Array as PropType<string[][]>, required: true },
    locale: { type: Object as PropType<typeof zhCn>, required: true },
  },
  setup(props) {
    // ...原 data / filters / widths / sortable 计算保持不变...
    return () =>
      h(ElConfigProvider, { locale: props.locale }, () =>
        h(
          ElTable,
          { data: data.value, border: true, stripe: true, size: 'small', fit: true },
          () =>
            props.headers.map((label, i) => {
              const opts = filters.value[i];
              return h(
                ElTableColumn,
                {
                  key: i,
                  prop: `c${i}`,
                  minWidth: widths.value[i],
                  sortable: sortable.value,
                  sortMethod: sortable.value
                    ? (a: Record<string, string>, b: Record<string, string>) =>
                      compareCells(a[`c${i}`] ?? '', b[`c${i}`] ?? '')
                    : undefined,
                  filters: opts.length ? opts : undefined,
                  filterMethod: opts.length
                    ? (value: string, row: Record<string, string>) => row[`c${i}`] === value
                    : undefined,
                  filterPlacement: 'bottom-end',
                },
                {
                  header: () => h('span', { innerHTML: label }),
                  default: ({ row }: { row: Record<string, string> }) =>
                    h('span', { innerHTML: row[`c${i}`] ?? '' }),
                },
              );
            }),
        ),
      );
  },
});
```

5. 把原 `mountTable(host, data)` 改为：

```ts
export function mountTable(host: HTMLElement, data: TableData, locale: typeof zhCn): { dispose(): void } {
  host.style.setProperty('--md-table-inner-width', `${tableMinWidth(data.headers, data.rows)}px`);
  const app = createApp(TableHost, { ...data, locale });
  app.mount(host);
  return { dispose: () => app.unmount() };
}
```

其余函数（`isPlainCell`、`cellText`、`filterOptions`、`compareCells`、`columnMinWidth`、`tableMinWidth`、`extractTable`）保持原样。

- [ ] **Step 2: 写测试**

创建 `packages/markdown-viewer/test/table-renderer.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { extractTable } from '../src/vue/table-renderer';

describe('extractTable', () => {
  it('extracts headers and rows', () => {
    const el = document.createElement('table');
    el.innerHTML = '<thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>';
    expect(extractTable(el)).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] });
  });

  it('returns null for nested tables', () => {
    const el = document.createElement('table');
    el.innerHTML = '<thead><tr><th>a</th></tr></thead><tbody><tr><td><table><tr><td>x</td></tr></table></td></tr></tbody>';
    expect(extractTable(el)).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `npm.cmd --prefix packages/markdown-viewer test -- table-renderer`
Expected: PASS。

### Task 7: `useMarkdownViewer` 与 `MarkdownViewer.vue`

**Files:**
- Create: `packages/markdown-viewer/src/core/charts-loader.ts`
- Create: `packages/markdown-viewer/src/vue/useMarkdownViewer.ts`
- Create: `packages/markdown-viewer/src/vue/MarkdownViewer.vue`
- Test: `packages/markdown-viewer/test/markdown-viewer.test.ts`

- [ ] **Step 1: `charts-loader.ts`**

把 `web/src/markdown-enhance/charts.ts` 的 `loadEcharts` 复制过来：

```ts
type EChartsCore = typeof import('echarts/core');

let cached: EChartsCore | null = null;

export async function loadEcharts(): Promise<EChartsCore> {
  if (cached) return cached;
  const [core, charts, components, renderers] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]);
  core.use([
    charts.LineChart,
    charts.BarChart,
    charts.PieChart,
    charts.CustomChart,
    components.GridComponent,
    components.TooltipComponent,
    components.LegendComponent,
    components.TitleComponent,
    renderers.CanvasRenderer,
  ]);
  cached = core;
  return core;
}
```

- [ ] **Step 2: `useMarkdownViewer.ts`**

```ts
import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';
import { enhanceMarkdown as enhanceShared } from '../core/markdown-client.js';
import { loadEcharts } from '../core/charts-loader';
import { renderMarkdown, type RenderOptions } from '../core/render';
import { resolveMessages, translate, type MarkdownLocale, type MarkdownMessages } from '../core/i18n';
import { createElementTableRenderer, extractTable } from './table-renderer';

export type MarkdownTheme = 'dark' | 'light' | 'auto';

export interface MarkdownViewerOptions extends Omit<RenderOptions, 'html'> {
  content?: string;
  html?: string;
  theme?: MarkdownTheme;
  locale?: MarkdownLocale;
  messages?: Partial<MarkdownMessages>;
  flowchartEditable?: boolean;
  readAsset?: (rel: string) => Promise<string>;
}

type Item = { host: HTMLElement; dispose(): void };

function resolvedTheme(theme: MarkdownTheme): 'dark' | 'light' {
  if (theme === 'dark' || theme === 'light') return theme;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useMarkdownViewer(
  el: Ref<HTMLElement | null>,
  options: () => MarkdownViewerOptions,
): { enhance: () => Promise<void>; dispose: () => void } {
  let items: Item[] = [];
  let disposed = false;

  const dispose = () => {
    for (const item of items) {
      try { item.dispose(); } catch { /* ignore */ }
    }
    items = [];
  };

  const enhance = async () => {
    if (disposed || !el.value) return;
    dispose();
    const opts = options();
    const locale = opts.locale || 'zh-CN';
    const messages = resolveMessages(locale, opts.messages);
    const theme = resolvedTheme(opts.theme || 'auto');
    const renderer = createElementTableRenderer(() => locale, () => messages);

    const result = await enhanceShared(el.value, {
      loadEcharts,
      loadFlowX6: () => import('../core/markdown-flowchart-x6.js'),
      loadMermaid: async () => (await import('mermaid')).default,
      theme: theme === 'light' ? 'default' : 'dark',
      dark: theme === 'dark',
      errorText: (msg) => translate(messages, 'markdown.mermaid_error', { msg }),
      dataErrorText: (msg) => translate(messages, 'markdown.data_error', { msg }),
      readAsset: opts.readAsset,
      enhanceTables: (root) => {
        const out: Item[] = [];
        for (const table of Array.from(root.querySelectorAll<HTMLTableElement>('table'))) {
          if (table.closest('.md-el-table, .el-table')) continue;
          if (table.parentElement?.closest('table')) continue;
          const data = extractTable(table);
          if (!data) continue;
          const host = document.createElement('div');
          host.className = 'md-el-table';
          table.replaceWith(host);
          out.push({ host, ...renderer(host, data) });
        }
        return out;
      },
    });
    items = result as Item[];
  };

  watch(
    () => options(),
    async () => {
      await nextTick();
      const opts = options();
      if (!el.value) return;
      const renderOptions: RenderOptions = {
        html: true,
        sanitize: opts.sanitize,
        assetSrc: opts.assetSrc,
        extraStyleBlocks: opts.extraStyleBlocks,
      };
      el.value.innerHTML = opts.html ?? renderMarkdown(opts.content || '', renderOptions);
      await enhance();
    },
    { immediate: true, deep: true },
  );

  onBeforeUnmount(() => {
    disposed = true;
    dispose();
  });

  return { enhance, dispose };
}
```

- [ ] **Step 3: `MarkdownViewer.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMarkdownViewer, type MarkdownViewerOptions } from './useMarkdownViewer';

const props = withDefaults(defineProps<MarkdownViewerOptions>(), {
  content: '',
  html: '',
  theme: 'auto',
  locale: 'zh-CN',
  flowchartEditable: false,
});

const body = ref<HTMLElement | null>(null);
const theme = computed(() => props.theme || 'auto');

useMarkdownViewer(body, () => ({
  content: props.content,
  html: props.html,
  theme: props.theme,
  locale: props.locale,
  messages: props.messages,
  sanitize: props.sanitize,
  assetSrc: props.assetSrc,
  extraStyleBlocks: props.extraStyleBlocks,
  flowchartEditable: props.flowchartEditable,
  readAsset: props.readAsset,
}));

const emit = defineEmits<{ ready: []; error: [unknown]; linkClick: [string] }>();

// linkClick：捕获内部链接点击，交给使用方决定是否拦截
function onClick(event: MouseEvent) {
  const target = (event.target as HTMLElement | null)?.closest('a[data-md-link]');
  if (!target) return;
  const rel = target.getAttribute('data-md-link');
  if (rel) emit('linkClick', rel);
}
</script>

<template>
  <div class="mdv" :data-mdv-theme="theme" @click="onClick">
    <slot name="toolbar" />
    <div ref="body" class="mdv-body md-body" />
    <slot name="empty" />
  </div>
</template>

<style>
@import './styles/index.css';
</style>
```

- [ ] **Step 4: 写组件测试**

创建 `packages/markdown-viewer/test/markdown-viewer.test.ts`：

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MarkdownViewer from '../src/vue/MarkdownViewer.vue';

describe('MarkdownViewer', () => {
  it('renders markdown content', async () => {
    const wrapper = mount(MarkdownViewer, { props: { content: '# hi' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(wrapper.find('.mdv-body').html()).toContain('<h1>hi</h1>');
  });
});
```

- [ ] **Step 5: 跑测试**

Run: `npm.cmd --prefix packages/markdown-viewer test -- markdown-viewer`
Expected: PASS（若 Element Plus 样式未加载不影响断言）。

### Task 8: 样式与 CSS 变量

**Files:**
- Create: `packages/markdown-viewer/src/vue/styles/variables.css`
- Create: `packages/markdown-viewer/src/vue/styles/markdown.css`
- Create: `packages/markdown-viewer/src/vue/styles/ppt.css`
- Create: `packages/markdown-viewer/src/vue/styles/index.css`

- [ ] **Step 1: 写 `variables.css`**

```css
.mdv {
  --mdv-bg: var(--bg0, #1e2227);
  --mdv-bg-alt: var(--bg1, #181d24);
  --mdv-text: var(--tx, #d5dae1);
  --mdv-text-strong: var(--tx1, #e6e9ef);
  --mdv-text-muted: var(--tx2, #9aa4b2);
  --mdv-border: var(--bd, #2a323e);
  --mdv-accent: var(--ac2, #4c9aff);
  --mdv-code-bg: var(--hlc, #8b949e);
  --mdv-table-head-bg: #1e40af;
  --mdv-table-head-text: #ffffff;
  --mdv-error: var(--errtx, #fca5a5);
}
.mdv[data-mdv-theme='light'] {
  --mdv-bg: #eef1f5;
  --mdv-bg-alt: #f4f6f9;
  --mdv-text: #1f2937;
  --mdv-text-strong: #111827;
  --mdv-text-muted: #4b5563;
  --mdv-border: #d7dce3;
  --mdv-accent: #2563eb;
  --mdv-code-bg: #6e7781;
  --mdv-table-head-bg: #1e40af;
  --mdv-table-head-text: #ffffff;
  --mdv-error: #b91c1c;
}
```

- [ ] **Step 2: 复制并作用域化现有 Markdown 样式**

Run:
```powershell
Copy-Item "shared\markdown.css" "packages\markdown-viewer\src\vue\styles\markdown.css"
Copy-Item "shared\markdown-ppt.css" "packages\markdown-viewer\src\vue\styles\ppt.css"
```
然后把 `markdown.css` 中所有 `.md-body` 选择器前面加上 `.mdv `（即 `.md-body` → `.mdv .md-body`），把 `--md-` 变量映射到新变量：
```powershell
$p = "packages\markdown-viewer\src\vue\styles\markdown.css"
$t = Get-Content $p -Raw
$t = $t -replace '(?<![\w.-])\.md-body', '.mdv .md-body'
$t = $t -replace '--md-table-head-bg', '--mdv-table-head-bg'
$t = $t -replace '--md-table-head-color', '--mdv-table-head-text'
[System.IO.File]::WriteAllText((Resolve-Path $p), $t, (New-Object System.Text.UTF8Encoding($false)))
```
Expected: `Select-String -Path $p -Pattern '^\.mdv \.md-body'` 有命中。

- [ ] **Step 3: 写 `index.css`**

```css
@import './variables.css';
@import './markdown.css';
@import './ppt.css';

.mdv { color: var(--mdv-text); background: var(--mdv-bg); }
.mdv-body { color: var(--mdv-text); }
```

### Task 9: standalone 自举入口

**Files:**
- Create: `packages/markdown-viewer/src/standalone.ts`

- [ ] **Step 1: 写 `standalone.ts`**

```ts
import { createApp, h } from 'vue';
import MarkdownViewer from './vue/MarkdownViewer.vue';
import './vue/styles/index.css';

type StandaloneConfig = {
  content?: string;
  html?: string;
  theme?: 'dark' | 'light' | 'auto';
  locale?: 'zh-CN' | 'en';
};

function readConfig(): StandaloneConfig {
  const node = document.getElementById('mdv-config');
  if (!node || !node.textContent) return {};
  try {
    return JSON.parse(node.textContent) as StandaloneConfig;
  } catch {
    return {};
  }
}

function mountOne(root: HTMLElement) {
  const cfg = readConfig();
  const content = cfg.content ?? root.dataset.mdvContent ?? '';
  const host = document.createElement('div');
  root.replaceWith(host);
  createApp({
    render: () => h(MarkdownViewer, { ...cfg, content }),
  }).mount(host);
}

function boot() {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>('article.md-page[data-mdv]'))) {
    mountOne(root);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
```

- [ ] **Step 2: 跑主构建 + standalone 构建**

Run: `npm.cmd --prefix packages/markdown-viewer run build`
Expected: 退出码 0；`packages/markdown-viewer/dist/index.js`、`dist/index.d.ts`、`dist/style.css`、`dist/standalone/index.js` 存在。

- [ ] **Step 3: 检查懒加载分包**

Run: `Get-ChildItem packages/markdown-viewer/dist/standalone -Recurse | Select-Object Name, Length`
Expected: `index.js` 之外存在 `chunks/` 下的 mermaid / echarts / x6 / pptxgenjs / html-to-image 分包（体积明显大于主文件）。

### Task 10: 全量验证与提交

**Files:** 本计划全部改动

- [ ] **Step 1: 跑包测试**

Run: `npm.cmd --prefix packages/markdown-viewer test`
Expected: 全部 PASS。

- [ ] **Step 2: 跑包类型检查**

Run: `npm.cmd --prefix packages/markdown-viewer run typecheck`
Expected: 退出码 0。

- [ ] **Step 3: 跑仓库既有测试**

Run: `npm.cmd run test:web`
Expected: 全部 PASS（shared shim 仍指向 core）。

- [ ] **Step 4: 敏感信息扫描**

Run:
```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat-|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git ls-files env
```
Expected: 第一条无真实凭据；第二条为空。

- [ ] **Step 5: 提交**

Run:
```powershell
git add packages/markdown-viewer package-lock.json
git commit -m "feat(markdown): markdown-viewer 增加 Vue 组件、词条、样式与 standalone 构建"
```

---

## 自审记录

- Spec 覆盖：Vue 组件、ElTable 渲染器、内置中英词条、CSS 变量主题、standalone 入口、发布构建产物。
- 未包含：PPT 演示/导出的 Vue 编排与静态页切换（Plan 3 用 core 的 `createPptPresenter` / `exportPptx` 接入）。
- 类型一致性：`MarkdownLocale` / `MarkdownMessages` 由 `core/i18n` 单一导出；`TableData` / `TableRenderer` 由 `vue/table-renderer` 导出。
