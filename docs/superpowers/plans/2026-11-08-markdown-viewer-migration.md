# Markdown Viewer 静态页与仓库迁移 Implementation Plan（Plan 3/3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把本仓库的 Web 预览与静态 Markdown 页切到 `@devflow/markdown-viewer`，补齐 `/_mdv/*` 资产路由、PPT 接入、构建/打包脚本与文档。

**Architecture:** 服务端新增 `/_mdv/*` 静态资产路由，直接托管包 `dist/standalone/`；`server/markdown-page.js` 只保留服务端渲染的 HTML 与页面骨架，增强交给 `/_mdv/index.js`（内置 Vue + Element Plus）。Web 端 `markdown-enhance` 退化为对包内 `enhanceElementMarkdown` 的薄封装，DocViewer 等调用点不改。

**Tech Stack:** Node ESM、Vue 3、Element Plus、Vite、esbuild、现有静态页框架。

**前置：** Plan 1（core 迁移）与 Plan 2（Vue 组件 + dist 构建）已完成。

---

## 文件结构

```
packages/markdown-viewer/src/vue/
  enhance.ts            # 命令式增强入口（Web 旧调用点复用）
  ppt.ts                # PPT 演示/导出控制器
server/
  markdown-viewer-assets.js   # /_mdv/* 资产路由
  markdown-page.js            # 静态页改引 /_mdv/index.js
  index.js                    # 挂 /_mdv/* 路由
scripts/
  dev.js                      # 启动前构建包
  build.js                    # 校验 standalone 产物
web/src/markdown-enhance/
  index.ts                    # 改为包内 enhanceElementMarkdown 薄封装
docs/knowledge/
  markdown-viewer.md          # 模块说明
```

---

### Task 1: 新增 `/_mdv/*` 资产路由

**Files:**
- Create: `server/markdown-viewer-assets.js`

- [ ] **Step 1: 写资产服务**

创建 `server/markdown-viewer-assets.js`：

```js
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function markdownViewerDistDir() {
  const require = createRequire(import.meta.url);
  const pkgDir = path.dirname(require.resolve('@devflow/markdown-viewer/package.json'));
  return path.join(pkgDir, 'dist', 'standalone');
}

export function isMarkdownViewerAsset(pathname) {
  return pathname === '/_mdv' || pathname.startsWith('/_mdv/');
}

export function serveMarkdownViewerAsset(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }
  const root = markdownViewerDistDir();
  const rel = pathname.replace(/^\/_mdv\/?/, '') || 'index.js';
  const file = path.normalize(path.join(root, decodeURIComponent(rel)));
  if (!file.startsWith(root)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'public, max-age=86400',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}
```

- [ ] **Step 2: 写测试**

创建 `server/test/markdown-viewer-assets.test.js`：

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMarkdownViewerAsset, markdownViewerDistDir } from '../markdown-viewer-assets.js';

test('matches /_mdv paths', () => {
  assert.equal(isMarkdownViewerAsset('/_mdv'), true);
  assert.equal(isMarkdownViewerAsset('/_mdv/index.js'), true);
  assert.equal(isMarkdownViewerAsset('/mdv/index.js'), false);
});

test('resolves the package standalone dist', () => {
  assert.match(markdownViewerDistDir(), /markdown-viewer[\\/]+dist[\\/]+standalone$/);
});
```

- [ ] **Step 3: 跑测试**

Run: `node --test "server/test/markdown-viewer-assets.test.js"`
Expected: PASS（需先在 `packages/markdown-viewer` 执行过 `npm run build`，否则第二条断言仍成立，因为只校验路径拼接）。

### Task 2: 在服务端挂载 `/_mdv/*`

**Files:**
- Modify: `server/index.js:1615` 之前

- [ ] **Step 1: 引入资产模块**

在 `server/index.js` 顶部 import 区加入：

```js
import { isMarkdownViewerAsset, serveMarkdownViewerAsset } from './markdown-viewer-assets.js';
```

- [ ] **Step 2: 在 `/api/` 分支之后、SPA 兜底之前插入路由**

在 `server/index.js` 的：

```js
  if (url.pathname.startsWith('/api/')) {
    await ws.httpApi(req, res);
    return;
  }
  createStaticServer(path.join(__dirname, '..', 'web', 'dist'))(req, res, () => {
```

之间插入：

```js
  if (isMarkdownViewerAsset(url.pathname)) {
    serveMarkdownViewerAsset(req, res, url.pathname);
    return;
  }
```

- [ ] **Step 3: 手工验证**

Run:
```powershell
npm.cmd --prefix packages/markdown-viewer run build
$env:DEVFLOW_PORT = "33333"
node server/index.js
```
另开终端：
```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:33333/_mdv/index.js" -UseBasicParsing | Select-Object StatusCode, @{n='Length';e={$_.RawContentLength}}
Invoke-WebRequest -Uri "http://127.0.0.1:33333/_mdv/style.css" -UseBasicParsing | Select-Object StatusCode
```
Expected: 两个请求都返回 `200`；`/_mdv/index.js` 长度大于 0。随后关闭服务进程。

### Task 3: 静态页改用 `/_mdv/index.js`

**Files:**
- Modify: `server/markdown-page.js:77-153`（`scriptsHtml`）
- Modify: `server/markdown-page.js:168`（`article` 标签）

- [ ] **Step 1: 用新 `scriptsHtml` 替换旧实现**

把 `server/markdown-page.js` 中从 `function hasChartSyntax` 到 `scriptsHtml` 结束（含 `tags` 拼装）整体替换为：

```js
function hasChartSyntax(text) {
  return /(^|\n)\s*(xychart-beta|pie|gantt|timeline|flowchart|graph)\b/i.test(text);
}

function scriptsHtml(text, body, title, slides) {
  const hasMermaid = /<pre class="[^"]*\bmermaid\b/.test(body);
  const hasData = /<pre class="[^"]*\bmermaid-data\b/.test(body);
  const hasCharts = hasChartSyntax(text);
  const dynamic = hasMermaid || hasData || hasCharts || slides.length > 0;
  if (!dynamic) return '';
  const config = JSON.stringify({
    theme: 'auto',
    locale: getLocale(),
    ppt: slides.length > 0,
  }).replace(/</g, '\\u003c');
  return [
    '<link rel="stylesheet" href="/_mdv/style.css">',
    `<script type="application/json" id="mdv-config">${config}</script>`,
    '<script type="module" src="/_mdv/index.js"></script>',
  ].join('');
}
```

同时把顶部 import 中的 `getLocale` 从 `./i18n.js` 引入：

```js
import { getLocale, t } from './i18n.js';
```

删除不再使用的 `mermaid-asset.js` 相关 import（`ECHARTS_SCRIPT_NAME`、`FLOW_EDIT_SCRIPT_NAME`、`FLOW_X6_SCRIPT_NAME`、`HTML_TO_IMAGE_SCRIPT_NAME`、`MARKDOWN_CLIENT_SCRIPT_NAME`、`MERMAID_SCRIPT_NAME`、`PPTXGEN_SCRIPT_NAME`）。保留 `t` 供页面其它文案使用。

- [ ] **Step 2: 给 article 加 `data-mdv`**

把返回模板中的：

```js
<article class="md-body md-page"${pending}>
```

改为：

```js
<article class="md-body md-page" data-mdv>
```

并删除 `const pending = dynamic ? ' data-df-pending="1"' : '';` 这一行；`dynamic` 变量若不再使用，一并删除。

同时把返回模板里的 `${markdownCss()}${pptCss()}` 删掉（样式改由 `/_mdv/style.css` 提供），并删除 `markdownCss()` / `pptCss()` 两个函数定义，避免样式重复。

- [ ] **Step 3: 更新静态页测试**

修改 `server/test/markdown-page.test.js`：

1. 删除对 `__devflow_mermaid__.js`、`__devflow_echarts__.js`、`__devflow_markdown__.js`、`__devflow_flowx6__.js`、`__devflow_flowedit__.js`、`__devflow_html_to_image__.js`、`__devflow_pptxgen__.js` 的断言。
2. 新增断言：

```js
assert.match(html, /data-mdv/);
assert.match(html, /<script type="application\/json" id="mdv-config">/);
assert.match(html, /src="\/_mdv\/index\.js"/);
assert.match(html, /href="\/_mdv\/style\.css"/);
```

Keep the test that checks `article.md-page` exists.

- [ ] **Step 4: 跑静态页测试**

Run: `node --test "server/test/markdown-page.test.js"`
Expected: PASS。

- [ ] **Step 5: 更新 proxy-static 的旧脚本路由（如仍被测试引用）**

Run: `node --test "server/test/proxy-engine.test.js"`
若失败于 `__devflow_*` 断言，删除这些断言并改为断言 Markdown 页面包含 `/_mdv/index.js`；`proxy-static.js` 中旧的 `readMarkdownClientScript` 等分支可在确认无引用后删除。

### Task 4: standalone 支持预渲染 HTML 与 PPT 开关

**Files:**
- Modify: `packages/markdown-viewer/src/standalone.ts`
- Modify: `packages/markdown-viewer/src/vue/MarkdownViewer.vue`
- Create: `packages/markdown-viewer/src/vue/ppt.ts`

- [ ] **Step 1: standalone 使用 article 内已有 HTML**

把 `standalone.ts` 的 `mountOne` 改为：

```ts
function mountOne(root: HTMLElement) {
  const cfg = readConfig();
  const html = cfg.html ?? root.innerHTML;
  const host = document.createElement('div');
  root.replaceWith(host);
  createApp({
    render: () => h(MarkdownViewer, { ...cfg, html }),
  }).mount(host);
}
```

`StandaloneConfig` 增加 `ppt?: boolean`。

- [ ] **Step 2: 新增 `src/vue/ppt.ts`**

```ts
import { createPptPresenter } from '../core/markdown-ppt.js';
import { exportPptx, pptFileName } from '../core/markdown-ppt-export.js';
import { splitMarkdownSlides } from '../core/markdown-slides.js';
import { renderMarkdown } from '../core/render';
import type { MarkdownMessages } from '../core/i18n';

export interface PptControllerOptions {
  content: string;
  title: string;
  messages: MarkdownMessages;
  enhance: (root: HTMLElement) => Promise<void>;
  dispose: (root: HTMLElement) => void;
  onError?: (e: unknown) => void;
}

export function createPptController(options: PptControllerOptions) {
  const slides = splitMarkdownSlides(options.content).map((s) => ({
    title: s.title,
    html: renderMarkdown(s.content, { html: true, sanitize: true }),
  }));
  const ppt = createPptPresenter({
    showOpenButton: true,
    filename: options.title,
    slideCount: () => slides.length,
    slideTitle: (i) => slides[i]?.title || '',
    renderSlide: (i) => slides[i]?.html || '',
    enhance: options.enhance,
    dispose: options.dispose,
    labels: {
      open: options.messages['ppt.open'],
      close: options.messages['ppt.close'],
      prev: `‹ ${options.messages['ppt.prev']}`,
      next: `${options.messages['ppt.next']} ›`,
      hide: options.messages['ppt.hide_nav'],
      export: options.messages['ppt.export'],
      exporting: options.messages['ppt.exporting'],
    },
    onExport: async (progress: (done: number, total: number) => void) => {
      const [{ default: htmlToImage }, { default: PptxGenJS }] = await Promise.all([
        import('html-to-image'),
        import('pptxgenjs'),
      ]);
      const el = ppt.captureEl();
      const css = getComputedStyle(el);
      const bg = (css.getPropertyValue('--mdv-bg') || css.getPropertyValue('--bg3') || '#1e1e1e').trim();
      await exportPptx({
        controller: ppt,
        capture: (target: HTMLElement) =>
          htmlToImage
            .toPng(target, {
              cacheBust: true,
              includeQueryParams: true,
              pixelRatio: window.devicePixelRatio || 1,
              width: target.clientWidth,
              height: target.clientHeight,
              style: { overflow: 'hidden' },
              backgroundColor: bg,
            })
            .then((dataUrl: string) => ({ dataUrl, width: target.clientWidth, height: target.clientHeight })),
        createDeck: () => new PptxGenJS(),
        filename: pptFileName(options.title),
        background: bg,
        onProgress: progress,
        isCancelled: () => !ppt.isOpen(),
      });
    },
    onExportError: options.onError,
    renderError: (e: unknown) =>
      `<p class="note err">${String((e && (e as Error).message) || e)}</p>`,
  });
  return ppt;
}
```

- [ ] **Step 3: 把 `createPptController` 从 Vue 入口导出**

在 `packages/markdown-viewer/src/vue/index.ts` 末尾加：

```ts
export { createPptController } from './ppt';
export type { PptControllerOptions } from './ppt';
```

- [ ] **Step 4: MarkdownViewer 增加 `ppt` 开关**

在 `MarkdownViewer.vue` 中：

1. `props` 默认值加 `ppt: false`；`MarkdownViewerOptions`（在 `useMarkdownViewer.ts`）增加 `ppt?: boolean`。
2. 捕获 `useMarkdownViewer` 的返回值：`const api = useMarkdownViewer(body, () => ({ ... }));`
3. 在 `defineEmits` 之后加：

```ts
import { computed } from 'vue';
import { createPptController } from './ppt';
import { resolveMessages } from '../core/i18n';

const messages = computed(() => resolveMessages(props.locale || 'zh-CN', props.messages));
const pptController = computed(() => {
  if (!props.ppt) return null;
  return createPptController({
    content: props.content || '',
    title: 'Markdown',
    messages: messages.value,
    enhance: async () => { await api.enhance(); },
    dispose: () => api.dispose(),
    onError: (e) => emit('error', e),
  });
});
const pptOpenLabel = computed(() => messages.value['ppt.open']);
```

4. 模板里增加按钮：

```vue
<button v-if="pptController" class="mdv-ppt-open" @click="pptController.open(0)">{{ pptOpenLabel }}</button>
```

5. 在 `ppt.css` 中把 `.df-ppt-open` 的同款规则补上 `.mdv-ppt-open` 选择器（按钮样式与旧 PPT 按钮一致）。

- [ ] **Step 5: 增加 PPT 重依赖并构建**

Run:
```powershell
npm.cmd install -w packages/markdown-viewer html-to-image@^1.11.13 pptxgenjs@^4.0.1
npm.cmd --prefix packages/markdown-viewer run build
```
Expected: `dist/standalone/chunks/` 出现 html-to-image 与 pptxgenjs 分包。

### Task 5: Web 端 `markdown-enhance` 改为包的薄封装

**Files:**
- Create: `packages/markdown-viewer/src/vue/enhance.ts`
- Modify: `packages/markdown-viewer/src/vue/index.ts`
- Modify: `web/src/markdown-enhance/index.ts`

- [ ] **Step 1: 新增命令式增强入口 `src/vue/enhance.ts`**

把 `web/src/markdown-enhance/index.ts` 的完整逻辑迁入包内，替换 i18n / 主题来源：

```ts
import { enhanceMarkdown as enhanceShared } from '../core/markdown-client.js';
import { loadEcharts } from '../core/charts-loader';
import { resolveMessages, translate, type MarkdownLocale, type MarkdownMessages } from '../core/i18n';
import { createElementTableRenderer, extractTable } from './table-renderer';

type Item = { host: HTMLElement; dispose(): void };

const states = new WeakMap<HTMLElement, Item[]>();

export interface EnhanceElementOptions {
  locale?: MarkdownLocale;
  messages?: Partial<MarkdownMessages>;
  theme?: 'dark' | 'light';
  readAsset?: (rel: string) => Promise<string>;
}

export function disposeElementMarkdown(container: HTMLElement): void {
  const items = states.get(container);
  if (!items) return;
  for (const item of items) {
    try { item.dispose(); } catch { /* ignore */ }
    if (item.host.isConnected) item.host.remove();
  }
  states.delete(container);
}

export async function enhanceElementMarkdown(
  container: HTMLElement,
  options: EnhanceElementOptions = {},
): Promise<void> {
  const locale = options.locale || 'zh-CN';
  const messages = resolveMessages(locale, options.messages);
  const renderer = createElementTableRenderer(() => locale, () => messages);
  const items = await enhanceShared(container, {
    loadEcharts,
    loadFlowX6: () => import('../core/markdown-flowchart-x6.js'),
    loadMermaid: async () => (await import('mermaid')).default,
    theme: options.theme === 'light' ? 'default' : 'dark',
    dark: options.theme !== 'light',
    errorText: (msg) => translate(messages, 'markdown.mermaid_error', { msg }),
    dataErrorText: (msg) => translate(messages, 'markdown.data_error', { msg }),
    readAsset: options.readAsset,
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
  states.set(container, items as Item[]);
}
```

- [ ] **Step 2: 从 Vue 入口导出**

`src/vue/index.ts` 追加：

```ts
export { enhanceElementMarkdown, disposeElementMarkdown } from './enhance';
export type { EnhanceElementOptions } from './enhance';
```

- [ ] **Step 3: Web 兼容层改为薄封装**

把 `web/src/markdown-enhance/index.ts` 整体改为：

```ts
import { enhanceElementMarkdown, disposeElementMarkdown } from '@devflow/markdown-viewer';
import { locale, t } from '../i18n';

export function disposeMarkdown(container: HTMLElement): void {
  disposeElementMarkdown(container);
}

export async function enhanceMarkdown(
  container: HTMLElement,
  opts: { readAsset?: (rel: string) => Promise<string> } = {},
): Promise<void> {
  await enhanceElementMarkdown(container, {
    locale: locale.value,
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    readAsset: opts.readAsset,
    messages: {
      'markdown.mermaid_error': t('markdown.mermaid_error', { msg: '{msg}' }),
      'markdown.data_error': t('markdown.data_error', { msg: '{msg}' }),
      'table.confirm': t('common.ok'),
    },
  });
}
```

保留导出签名不变，`DocViewer.vue`、`useEnhance.ts` 无需改动。

- [ ] **Step 4: 跑 Web 测试**

Run: `npm.cmd run test:web`
Expected: 全部 PASS。若 `web/src/markdown-enhance/*.test.ts` 仍直接测旧 `table.ts` / `charts.ts`，保持现状即可（旧文件暂不删除）。

### Task 6: 构建与启动脚本接入

**Files:**
- Modify: `package.json`
- Modify: `scripts/dev.js`
- Modify: `scripts/build.js`

- [ ] **Step 1: 根脚本增加 `build:mdv`**

`package.json` 的 `scripts` 增加：

```json
"build:mdv": "npm --prefix packages/markdown-viewer run build",
```

并把三条脚本改为：

```json
"dev:web": "npm run build:mdv && set DEVFLOW_PORT=33333&& npm --prefix web run dev",
"build:web": "npm run build:mdv && npm --prefix web run build",
"test:web": "npm run build:mdv && npm --prefix web run test"
```

- [ ] **Step 2: dev 启动前构建包**

在 `scripts/dev.js` 顶部加：

```js
const { execSync } = require('node:child_process');
```

在启动 server/web 之前执行：

```js
execSync('npm --prefix packages/markdown-viewer run build', { stdio: 'inherit', cwd: ROOT });
```

（`ROOT` 用文件里现有的仓库根变量；若没有，用 `__dirname/..`。）

- [ ] **Step 3: 打包前校验 standalone 产物**

在 `scripts/build.js` 的 `check(...)` 区域加：

```js
check(
  fs.existsSync(path.join(ROOT, "packages", "markdown-viewer", "dist", "standalone", "index.js")),
  "markdown-viewer standalone dist missing; run `npm run build:mdv` first",
);
```

- [ ] **Step 4: 全量构建验证**

Run:
```powershell
npm.cmd run build:web
node scripts/build.js --no-zip
```
Expected: 退出码 0；绿色包内存在 `node_modules/@devflow/markdown-viewer/dist/standalone/index.js`。

### Task 7: 文档与目录说明

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/knowledge/markdown-viewer.md`

- [ ] **Step 1: 更新 AGENTS.md 目录速览**

在「目录速览」的 `shared/` 一行后补一条：

```md
- `packages/markdown-viewer/` — Markdown 渲染独立包（Vue 3 组件库）：`src/core/` 为框架无关内核（解析、Mermaid/ECharts、表格提取、流程图、PPT、词条），`src/vue/` 为 ElTable/主题/词条适配，`src/standalone.ts` 供静态页自举。`shared/markdown*` 仅保留兼容 re-export，新代码直接引用本包。
```

- [ ] **Step 2: 新增模块知识文档**

创建 `docs/knowledge/markdown-viewer.md`：

```md
# Markdown Viewer（@devflow/markdown-viewer）

## 职责

统一提供 Markdown 解析、表格（ElTable）、Mermaid/ECharts 图表、流程图 X6、PPT、打印与样式，供 Web 预览与静态 Markdown 页共用。

## 结构

- `packages/markdown-viewer/src/core/`：框架无关内核，不 import `vue` / `element-plus`。
- `packages/markdown-viewer/src/vue/`：Vue 组件、ElTable 渲染器、词条与样式。
- `packages/markdown-viewer/src/standalone.ts`：静态页自举入口，内置 Vue + Element Plus。
- `shared/markdown*`：兼容 shim，仅 `export *`，不再新增实现。

## 静态页接入

- 服务端 `/_mdv/*` 托管 `dist/standalone/`。
- `server/markdown-page.js` 输出 `<article class="md-body md-page" data-mdv>` + `mdv-config` JSON + `/_mdv/index.js`。
- 未检测到动态图表/PPT 的 Markdown 页不加载 Vue 运行时。

## 开发命令

- 构建包：`npm run build:mdv`
- 包测试：`npm --prefix packages/markdown-viewer test`
- `npm run dev` 会自动先构建包。
```

- [ ] **Step 3: 词条检查**

Run: `npm.cmd run check:i18n`
Expected: 退出码 0（库内词条在包内，不进 devflow 词条检查；Web 兼容层继续用现有 key）。

### Task 8: 全量验证

**Files:** 本计划全部改动

- [ ] **Step 1: 服务端测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS。

- [ ] **Step 2: Web 测试**

Run: `npm.cmd run test:web`
Expected: 全部 PASS。

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 退出码 0。

- [ ] **Step 4: 静态页手工验证**

Run:
```powershell
$env:DEVFLOW_PORT = "33333"
node server/index.js
```
访问一个含 Mermaid `xychart-beta` 的 Markdown 静态页，确认：
- 页面加载 `/_mdv/index.js` 与 `/_mdv/style.css`；
- 表格渲染为 Element Plus 表格；
- 折线图正常；
- 无 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 5: 敏感信息扫描**

Run:
```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat-|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git ls-files env
```
Expected: 第一条无真实凭据；第二条为空。

- [ ] **Step 6: 提交**

Run:
```powershell
git add server packages/markdown-viewer web/src/markdown-enhance scripts package.json AGENTS.md docs/knowledge/markdown-viewer.md
git commit -m "feat(markdown): Web 与静态页切换到 markdown-viewer 包"
```

---

## 自审记录

- Spec 覆盖：`/_mdv/*` 资产、静态页统一 Vue 渲染、Web 兼容层、PPT 控制器、构建/启动脚本、文档。
- 未删除：`shared/markdown*` shim 与 `web/src/markdown-enhance/table.ts`、`charts.ts` 暂保留，避免一次性改测试；后续确认无引用再清理。
- 类型一致性：`enhanceElementMarkdown` / `disposeElementMarkdown` 从 `src/vue/enhance.ts` 导出，Web 兼容层与包根入口同名导出。
