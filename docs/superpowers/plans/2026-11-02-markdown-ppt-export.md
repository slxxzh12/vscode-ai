# Markdown 预览导出 PPT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Markdown 的 PPT 演示模式里一键把全部页逐页截图并导出为真正的 `.pptx` 文件，Web 应用与静态网站页都支持。

**Architecture:** 新增 `shared/markdown-ppt-export.js` 做与库无关的编排（切页 → 等渲染 → 截图 → 写 PPT → 下载 → 恢复原页）；扩展 `shared/markdown-ppt.js` 暴露 `renderAt/captureEl/size/index/isBusy` 和底栏导出按钮；Web 用 `html-to-image` + 动态 `import('pptxgenjs')`，静态页由服务端直出两个 UMD 库、点击时才加载。

**Tech Stack:** JavaScript ESM、Vue 3、Vitest、node:test、html-to-image 1.11.13、pptxgenjs 4.0.1、esbuild（静态页资源打包）。

---

## File Structure

- `shared/markdown-ppt-export.js`（新增）— 导出编排、文件名清洗、`contain` 计算、下载。
- `shared/markdown-ppt-export.d.ts`（新增）— 上述模块类型。
- `shared/markdown-ppt.js` / `.d.ts`（修改）— 导出按钮、`renderAt/captureEl/size/index/isBusy`、导出期间 busy。
- `shared/markdown-client.js`（修改）— 转出 `exportPptx`，供静态页使用。
- `shared/package.json`（修改）— 新增 `./markdown-ppt-export` 导出映射。
- `web/src/snapshot.ts` / `snapshot.test.ts`（修改）— `pptBackground`、`captureViewportPng`。
- `web/src/components/DocViewer.vue`（修改）— 接 `onExport`、动态加载 `pptxgenjs`。
- `web/src/markdownPpt.test.ts`、`web/src/markdownPptExport.test.ts`（修改/新增）— 控制器与编排测试。
- `server/mermaid-asset.js`（修改）— 直出 `html-to-image` / `pptxgenjs` 脚本。
- `server/proxy-static.js`（修改）— 两个资源名的路由。
- `server/markdown-page.js`（修改）— 静态页 `onExport` 接线。
- `server/test/markdown-page.test.js`、`server/test/proxy-engine.test.js`（修改）— 静态页断言。
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js`（修改）— 导出词条。
- `web/package.json`、`server/package.json`（修改）— 依赖。

---

### Task 1: 依赖与共享导出编排模块

**Files:**
- Modify: `web/package.json`
- Modify: `server/package.json`
- Modify: `shared/package.json`
- Create: `shared/markdown-ppt-export.js`
- Create: `shared/markdown-ppt-export.d.ts`
- Create: `web/src/markdownPptExport.test.ts`

- [ ] **Step 1: 安装依赖**

Run:
```powershell
npm.cmd install pptxgenjs@4.0.1 -w web
npm.cmd install pptxgenjs@4.0.1 html-to-image@1.11.13 -w server
```
Expected: `web/package.json` 出现 `"pptxgenjs": "^4.0.1"`；`server/package.json` 出现 `"pptxgenjs"` 与 `"html-to-image"`。

- [ ] **Step 2: 写失败测试**

Create `web/src/markdownPptExport.test.ts`:
```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { exportPptx, pptFileName, containRect } from '@devflow/shared/markdown-ppt-export';

function makeDeck() {
  const slides: any[] = [];
  return {
    slides,
    addSlide() {
      const slide = {
        background: null as any,
        images: [] as any[],
        addImage(img: any) { this.images.push(img); },
      };
      slides.push(slide);
      return slide;
    },
    async write() { return new Blob(['pptx']); },
  };
}

function makeController(total = 3, start = 1) {
  const rendered: number[] = [];
  let index = start;
  return {
    rendered,
    size: () => total,
    index: () => index,
    renderAt: async (i: number) => { index = i; rendered.push(i); },
    captureEl: () => ({}) as HTMLElement,
    isOpen: () => true,
  };
}

describe('containRect', () => {
  it('宽图上下留白', () => {
    const r = containRect(1600, 900, 10, 5.625);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(0);
    expect(r.w).toBeCloseTo(10);
    expect(r.h).toBeCloseTo(5.625);
  });

  it('高图左右留白', () => {
    const r = containRect(900, 1600, 10, 5.625);
    expect(r.h).toBeCloseTo(5.625);
    expect(r.w).toBeCloseTo(3.1640625);
    expect(r.x).toBeCloseTo((10 - 3.1640625) / 2);
    expect(r.y).toBeCloseTo(0);
  });
});

describe('pptFileName', () => {
  it('去掉 md 扩展名并清理非法字符', () => {
    expect(pptFileName('a/b:c?.md')).toBe('a-b-c-.pptx');
    expect(pptFileName('notes.markdown')).toBe('notes.pptx');
    expect(pptFileName('')).toBe('slides.pptx');
  });
});

describe('exportPptx', () => {
  it('按顺序导出全部页、上报进度、恢复原页', async () => {
    const controller = makeController(3, 1);
    const deck = makeDeck();
    const progress: Array<[number, number]> = [];
    let saved: { blob: Blob; name: string } | null = null;

    const out = await exportPptx({
      controller,
      capture: async () => ({ dataUrl: 'data:image/png;base64,AA', width: 1600, height: 900 }),
      createDeck: () => deck,
      filename: 'demo.md',
      background: '#0e1116',
      waitForPaint: async () => {},
      saveBlob: (blob: Blob, name: string) => { saved = { blob, name }; },
      onProgress: (done: number, total: number) => progress.push([done, total]),
    });

    expect(controller.rendered).toEqual([0, 1, 2, 1]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(deck.slides).toHaveLength(3);
    expect(deck.slides[0].background).toEqual({ color: '0e1116' });
    expect(deck.slides[0].images[0]).toMatchObject({ w: 10, h: 5.625 });
    expect(saved!.name).toBe('demo.pptx');
    expect(out).toEqual({ filename: 'demo.pptx', total: 3 });
  });

  it('截图失败时仍恢复原页并抛错', async () => {
    const controller = makeController(2, 1);
    const deck = makeDeck();
    let saved = false;
    await expect(exportPptx({
      controller,
      capture: async () => { throw new Error('canvas tainted'); },
      createDeck: () => deck,
      filename: 'x.md',
      waitForPaint: async () => {},
      saveBlob: () => { saved = true; },
    })).rejects.toThrow('canvas tainted');
    expect(controller.rendered).toEqual([0, 1]);
    expect(saved).toBe(false);
  });

  it('没有页时直接抛错', async () => {
    await expect(exportPptx({
      controller: makeController(0),
      capture: async () => ({ dataUrl: '', width: 1, height: 1 }),
      createDeck: () => makeDeck(),
      filename: 'x.md',
      waitForPaint: async () => {},
    })).rejects.toThrow('no slides to export');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/markdownPptExport.test.ts`
Expected: FAIL，报 `Cannot find module '@devflow/shared/markdown-ppt-export'`。

- [ ] **Step 4: 加 shared 导出映射**

Modify `shared/package.json`，在 `exports` 里 `./markdown-ppt` 之后加：
```json
"./markdown-ppt-export": { "types": "./markdown-ppt-export.d.ts", "default": "./markdown-ppt-export.js" },
```

- [ ] **Step 5: 写实现**

Create `shared/markdown-ppt-export.js`:
```js
// Markdown PPT 导出编排：与具体截图/PPT 库解耦，Web 与静态页共用。
const EXPORT_LABEL = 'Export PPT';

export function pptFileName(name) {
  const base = String(name || '').replace(/\.(md|markdown)$/i, '').trim();
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '-') || 'slides';
  return `${cleaned}.pptx`;
}

export function containRect(imageWidth, imageHeight, boxWidth, boxHeight) {
  const iw = Number(imageWidth) > 0 ? Number(imageWidth) : 1;
  const ih = Number(imageHeight) > 0 ? Number(imageHeight) : 1;
  const scale = Math.min(boxWidth / iw, boxHeight / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: (boxWidth - w) / 2, y: (boxHeight - h) / 2, w, h };
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') { setTimeout(resolve, 0); return; }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function defaultWaitForPaint(doc) {
  await nextFrame();
  if (doc && doc.fonts && typeof doc.fonts.ready?.then === 'function') {
    try { await doc.fonts.ready; } catch { /* ignore font loading failures */ }
  }
  await nextFrame();
}

function normalizeBackground(color) {
  const value = String(color || '').trim();
  return value.startsWith('#') ? value.slice(1) : value;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * @param {{
 *   controller: {
 *     size: () => number,
 *     index: () => number,
 *     renderAt: (i: number) => Promise<void>,
 *     captureEl: () => HTMLElement,
 *     isOpen?: () => boolean,
 *   },
 *   capture: (el: HTMLElement) => Promise<{ dataUrl: string, width: number, height: number }>,
 *   createDeck: () => any,
 *   filename: string,
 *   background?: string,
 *   document?: Document,
 *   waitForPaint?: () => Promise<void> | void,
 *   saveBlob?: (blob: Blob, filename: string) => void,
 *   onProgress?: (done: number, total: number) => void,
 *   isCancelled?: () => boolean,
 * }} options
 */
export async function exportPptx(options) {
  const opts = options || {};
  const controller = opts.controller;
  const total = Number(controller && controller.size && controller.size());
  if (!controller || !Number.isFinite(total) || total <= 0) {
    throw new Error('no slides to export');
  }

  const original = Number(controller.index && controller.index()) || 0;
  const deck = opts.createDeck();
  const filename = pptFileName(opts.filename);
  const background = normalizeBackground(opts.background);
  const slideW = 10;
  const slideH = 5.625;
  const paint = opts.waitForPaint || (() => defaultWaitForPaint(opts.document || (typeof document !== 'undefined' ? document : null)));
  const save = opts.saveBlob || downloadBlob;

  try {
    for (let i = 0; i < total; i++) {
      if (opts.isCancelled && opts.isCancelled()) throw new Error('export cancelled');
      await controller.renderAt(i);
      await paint();
      const shot = await opts.capture(controller.captureEl());
      const rect = containRect(shot.width, shot.height, slideW, slideH);
      const slide = deck.addSlide();
      if (background) slide.background = { color: background };
      slide.addImage({ data: shot.dataUrl, ...rect });
      if (opts.onProgress) opts.onProgress(i + 1, total);
    }
    if (opts.isCancelled && opts.isCancelled()) throw new Error('export cancelled');
    const blob = await deck.write({ outputType: 'blob' });
    save(blob, filename);
    return { filename, total };
  } finally {
    try { await controller.renderAt(original); } catch { /* ignore restore failure */ }
  }
}

export { EXPORT_LABEL };
```

Create `shared/markdown-ppt-export.d.ts`:
```ts
export interface PptExportController {
  size: () => number;
  index: () => number;
  renderAt: (index: number) => Promise<void>;
  captureEl: () => HTMLElement;
  isOpen?: () => boolean;
}

export interface PptExportCapture {
  dataUrl: string;
  width: number;
  height: number;
}

export interface PptExportOptions {
  controller: PptExportController;
  capture: (el: HTMLElement) => Promise<PptExportCapture>;
  createDeck: () => any;
  filename: string;
  background?: string;
  document?: Document;
  waitForPaint?: () => Promise<void> | void;
  saveBlob?: (blob: Blob, filename: string) => void;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}

export function pptFileName(name: string): string;
export function containRect(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number): { x: number; y: number; w: number; h: number };
export function exportPptx(options: PptExportOptions): Promise<{ filename: string; total: number }>;
export const EXPORT_LABEL: string;
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/markdownPptExport.test.ts`
Expected: PASS（3 个 describe 全绿）。

- [ ] **Step 7: 提交**

```powershell
git add web/package.json server/package.json shared/package.json shared/markdown-ppt-export.js shared/markdown-ppt-export.d.ts web/src/markdownPptExport.test.ts package-lock.json
git commit -m "feat(ppt): add shared markdown pptx export orchestrator"
```

---

### Task 2: Presenter 导出按钮与驱动 API

**Files:**
- Modify: `shared/markdown-ppt.js`
- Modify: `shared/markdown-ppt.d.ts`
- Modify: `web/src/markdownPpt.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/markdownPpt.test.ts` 末尾追加：
```ts
function makeExport(onExport: (progress: (d: number, t: number) => void) => Promise<void>) {
  ppt = createPptPresenter({
    document: window.document,
    mount: document.body,
    showOpenButton: false,
    slideCount: () => 3,
    slideTitle: (i) => `S${i}`,
    renderSlide: (i) => `<p>slide ${i}</p>`,
    onExport,
    labels: { export: '导出 PPT', exporting: '导出中 {done} / {total}' },
  });
  return ppt;
}

describe('PPT 导出按钮', () => {
  it('提供 onExport 时渲染导出按钮，并能显示进度', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    makeExport(async (progress) => {
      progress(1, 3);
      await gate;
      progress(3, 3);
    });
    ppt!.open(0);
    await flushPromises();
    const btn = ppt!.element.querySelector('.df-ppt-export') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('导出 PPT');

    btn.click();
    await flushPromises();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('导出中 1 / 3');

    press('ArrowRight');
    await flushPromises();
    expect(count()).toBe('1 / 3');

    release();
    await flushPromises();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('导出 PPT');
  });

  it('导出失败时恢复按钮并回调 onExportError', async () => {
    const errors: unknown[] = [];
    ppt = createPptPresenter({
      document: window.document,
      mount: document.body,
      showOpenButton: false,
      slideCount: () => 1,
      slideTitle: () => 'S',
      renderSlide: () => '<p>x</p>',
      onExport: async () => { throw new Error('boom'); },
      onExportError: (e) => errors.push(e),
      labels: { export: '导出 PPT', exporting: '导出中 {done} / {total}' },
    });
    ppt.open(0);
    await flushPromises();
    ppt.element.querySelector<HTMLButtonElement>('.df-ppt-export')!.click();
    await flushPromises();
    expect(errors).toHaveLength(1);
    expect(ppt.element.querySelector<HTMLButtonElement>('.df-ppt-export')!.textContent).toBe('导出 PPT');
  });

  it('暴露 size/index/renderAt/captureEl，renderAt 后再翻页仍正常', async () => {
    make();
    ppt!.open(0);
    await flushPromises();
    expect(ppt!.size()).toBe(3);
    expect(ppt!.index()).toBe(0);
    expect(ppt!.captureEl().classList.contains('df-ppt-main')).toBe(true);

    await ppt!.renderAt(2);
    await flushPromises();
    expect(ppt!.index()).toBe(2);
    expect(count()).toBe('3 / 3');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/markdownPpt.test.ts`
Expected: FAIL，报 `onExport` 未知或 `.df-ppt-export` 为 null / `ppt.size is not a function`。

- [ ] **Step 3: 改实现**

Modify `shared/markdown-ppt.js`：
1. 在 `const hideBtn = ...` 后新增：
```js
  const exportBtn = opts.onExport
    ? make('button', 'df-ppt-btn df-ppt-export', labels.export || 'Export PPT')
    : null;
  if (exportBtn) exportBtn.type = 'button';
```
2. `foot.append(prevBtn, countEl, nextBtn, hideBtn);` 改为：
```js
  if (exportBtn) foot.appendChild(exportBtn);
  foot.append(prevBtn, countEl, nextBtn, hideBtn);
```
3. `let navHidden = false;` 上方新增：
```js
  let busy = false;
  let exportLabel = labels.export || 'Export PPT';
  let exportingLabel = labels.exporting || 'Exporting {done} / {total}';
```
4. `setChrome` 末尾追加：
```js
    if (exportBtn) exportBtn.disabled = busy || !size;
```
5. `onKey` 的 `if (!open) return;` 后面加 `if (busy) return;`。
6. `go/next/prev` 开头各加 `if (busy) return;`。
7. 在 `refresh()` 之前新增：
```js
  function size() { return total(); }
  function indexNow() { return index; }
  function captureEl() { return main; }
  function isBusy() { return busy; }
  async function renderAt(i) {
    const n = total();
    if (!n) return;
    index = Math.min(Math.max(0, Number(i) || 0), n - 1);
    await render();
  }

  async function runExport() {
    if (busy || !exportBtn || !opts.onExport) return;
    busy = true;
    if (open) setChrome(total());
    exportBtn.disabled = true;
    exportBtn.textContent = exportingLabel.replace('{done}', '0').replace('{total}', String(total()));
    const progress = (done, totalCount) => {
      const d = Number(done) || 0;
      const t = Number(totalCount) || total();
      exportBtn.textContent = exportingLabel.replace('{done}', String(d)).replace('{total}', String(t));
    };
    try {
      await opts.onExport(progress);
    } catch (e) {
      if (opts.onExportError) {
        try { opts.onExportError(e); } catch { /* ignore handler errors */ }
      }
    } finally {
      busy = false;
      exportBtn.textContent = exportLabel;
      if (open) setChrome(total());
      else exportBtn.disabled = true;
    }
  }
  if (exportBtn) exportBtn.addEventListener('click', () => { void runExport(); });
```
8. `show()` 里 `navHidden = false;` 后加：
```js
    if (exportBtn) { exportBtn.textContent = exportLabel; exportBtn.disabled = false; }
```
9. 返回对象追加：
```js
    size,
    index: indexNow,
    renderAt,
    captureEl,
    isBusy,
```

- [ ] **Step 4: 更新类型**

Modify `shared/markdown-ppt.d.ts`：
```ts
export interface PptLabels {
  open?: string;
  close?: string;
  prev?: string;
  next?: string;
  hide?: string;
  export?: string;
  exporting?: string;
}

export interface PptOptions {
  // ...保留原有字段...
  onExport?: (progress: (done: number, total: number) => void) => Promise<void> | void;
  onExportError?: (error: unknown) => void;
}

export interface PptPresenter {
  // ...保留原有字段...
  size: () => number;
  index: () => number;
  renderAt: (index: number) => Promise<void>;
  captureEl: () => HTMLElement;
  isBusy: () => boolean;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/markdownPpt.test.ts src/markdownPptExport.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add shared/markdown-ppt.js shared/markdown-ppt.d.ts web/src/markdownPpt.test.ts
git commit -m "feat(ppt): add export button and render driver to presenter"
```

---

### Task 3: Web 截图工具（可见区域 + PPT 背景）

**Files:**
- Modify: `web/src/snapshot.ts`
- Modify: `web/src/snapshot.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/snapshot.test.ts` 的 import 中加入 `pptBackground, captureViewportPng`，并追加：
```ts
describe('pptBackground', () => {
  it('优先取 --bg3，再回退 --bg1/--bg0/兜底色', () => {
    const el = {} as HTMLElement;
    expect(pptBackground(el, styleReader({ '--bg3': '#0e1116', '--bg1': '#111' }))).toBe('#0e1116');
    expect(pptBackground(el, styleReader({ '--bg1': '#111' }))).toBe('#111');
    expect(pptBackground(el, styleReader({}))).toBe('#1e1e1e');
  });
});

describe('captureViewportPng', () => {
  it('按 clientWidth/clientHeight 截可见区域并返回尺寸', async () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#010203' }));
    try {
      const el = { clientWidth: 800, clientHeight: 450 } as HTMLElement;
      const out = await captureViewportPng(el, {
        toPng: async (target, options) => {
          expect(target).toBe(el);
          expect(options.width).toBe(800);
          expect(options.height).toBe(450);
          expect(options.style).toEqual({ overflow: 'hidden' });
          return 'data:image/png;base64,VP';
        },
      });
      expect(out).toEqual({ dataUrl: 'data:image/png;base64,VP', width: 800, height: 450 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/snapshot.test.ts`
Expected: FAIL，报 `pptBackground` / `captureViewportPng` 未导出。

- [ ] **Step 3: 写实现**

Modify `web/src/snapshot.ts`：
```ts
export interface SnapshotOptions {
  cacheBust: boolean;
  pixelRatio: number;
  backgroundColor: string;
  filter: (node: HTMLElement) => boolean;
  width?: number;
  height?: number;
  style?: Record<string, string>;
}

export function pptBackground(
  el: HTMLElement,
  getStyle: StyleReader = (e) => getComputedStyle(e),
): string {
  const s = getStyle(el);
  return (s.getPropertyValue('--bg3') || '').trim()
    || (s.getPropertyValue('--bg1') || '').trim()
    || (s.getPropertyValue('--bg0') || '').trim()
    || '#1e1e1e';
}

export async function captureViewportPng(
  el: HTMLElement,
  deps: CaptureDeps = { toPng },
): Promise<{ dataUrl: string; width: number; height: number }> {
  const width = el.clientWidth || el.offsetWidth || 1280;
  const height = el.clientHeight || el.offsetHeight || 720;
  const dataUrl = await deps.toPng(el, {
    ...snapshotOptions(el),
    width,
    height,
    style: { overflow: 'hidden' },
  });
  return { dataUrl, width, height };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/snapshot.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add web/src/snapshot.ts web/src/snapshot.test.ts
git commit -m "feat(snapshot): capture visible viewport for ppt export"
```

---

### Task 4: Web DocViewer 接线与文案

**Files:**
- Modify: `shared/markdown-client.js`（同时为静态页铺垫导出名）
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`
- Modify: `web/src/components/DocViewer.vue`

- [ ] **Step 1: 加文案词条**

Modify `shared/i18n/zh-CN.js`，在 `fp.ppt.hide_nav` 后加：
```js
'fp.ppt.export': '导出 PPT',
'fp.ppt.exporting': '导出中 {done} / {total}',
'fp.ppt.export_done': '已导出 {name}',
'fp.ppt.export_failed': '导出 PPT 失败：{msg}',
```
Modify `shared/i18n/en.js` 同位置加：
```js
'fp.ppt.export': 'Export PPT',
'fp.ppt.exporting': 'Exporting {done} / {total}',
'fp.ppt.export_done': 'Exported {name}',
'fp.ppt.export_failed': 'PPT export failed: {msg}',
```

- [ ] **Step 2: shared client 转出导出函数**

Modify `shared/markdown-client.js`：
```js
export { createPptPresenter } from './markdown-ppt.js';
export { exportPptx, pptFileName } from './markdown-ppt-export.js';
```

- [ ] **Step 3: DocViewer 接线**

Modify `web/src/components/DocViewer.vue` 顶部 import：
```ts
import { captureViewportPng, pptBackground } from '../snapshot';
import { exportPptx, pptFileName } from '@devflow/shared/markdown-ppt-export';
```
在 `ensurePpt()` 的 `createPptPresenter({...})` 里补充：
```ts
    onExport: async (progress) => {
      const { default: PptxGenJS } = await import('pptxgenjs');
      await exportPptx({
        controller: ppt!,
        capture: captureViewportPng,
        createDeck: () => new PptxGenJS(),
        filename: props.name,
        background: pptBackground(ppt!.captureEl()),
        onProgress: progress,
        isCancelled: () => !ppt?.isOpen(),
      });
      setToolMsg(t('fp.ppt.export_done', { name: pptFileName(props.name) }));
    },
    onExportError: (e) => setToolMsg(t('fp.ppt.export_failed', { msg: String((e as any)?.message || e) }), false),
```
并在 `labels` 里补：
```ts
      export: t('fp.ppt.export'),
      exporting: t('fp.ppt.exporting'),
```

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（若 `pptxgenjs` 类型未就绪，先确认 Step 1 已安装成功）。

- [ ] **Step 5: 跑 Web 测试**

Run: `npm.cmd --prefix web run test -- src/markdownPpt.test.ts src/markdownPptExport.test.ts src/snapshot.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add shared/markdown-client.js shared/i18n/zh-CN.js shared/i18n/en.js web/src/components/DocViewer.vue
git commit -m "feat(web): wire markdown pptx export into ppt mode"
```

---

### Task 5: 静态网站页资源与接线

**Files:**
- Modify: `server/mermaid-asset.js`
- Modify: `server/proxy-static.js`
- Modify: `server/markdown-page.js`
- Modify: `server/test/markdown-page.test.js`
- Modify: `server/test/proxy-engine.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/markdown-page.test.js` 追加：
```js
test('Markdown 页面带 PPT 导出接线与两个按需脚本名', () => {
  const html = renderMarkdownDocument('# 标题\n\n正文', 't');
  assert.match(html, /exportPptx/);
  assert.match(html, /__devflow_html_to_image__\.js/);
  assert.match(html, /__devflow_pptxgen__\.js/);
  assert.match(html, /onExport/);
});
```

在 `server/test/proxy-engine.test.js` 的「Markdown 图表页加载 Mermaid 脚本」测试末尾（`engine.stop(rule.id)` 之前）追加：
```js
  const htmlToImage = await fetch(`http://127.0.0.1:${port}/doc/__devflow_html_to_image__.js`);
  assert.equal(htmlToImage.status, 200);
  assert.match(htmlToImage.headers.get('content-type'), /javascript/);
  assert.match(await htmlToImage.text(), /htmlToImage/);
  const pptxgen = await fetch(`http://127.0.0.1:${port}/doc/__devflow_pptxgen__.js`);
  assert.equal(pptxgen.status, 200);
  assert.match(pptxgen.headers.get('content-type'), /javascript/);
  assert.match(await pptxgen.text(), /PptxGenJS/);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/markdown-page.test.js" "server/test/proxy-engine.test.js"`
Expected: FAIL，页面缺少 `exportPptx`，两个脚本路由 404。

- [ ] **Step 3: 服务端直出两个脚本**

Modify `server/mermaid-asset.js`：
```js
export const HTML_TO_IMAGE_SCRIPT_NAME = '__devflow_html_to_image__.js';
export const PPTXGEN_SCRIPT_NAME = '__devflow_pptxgen__.js';

let htmlToImageCached = null;
let pptxgenCached = null;

function resolveVendorOrModule(vendorName, modulePath) {
  const vendor = path.join(HERE, 'vendor', vendorName);
  if (fs.existsSync(vendor)) return vendor;
  const require = createRequire(import.meta.url);
  return require.resolve(modulePath);
}

export function readHtmlToImageScript() {
  if (!htmlToImageCached) {
    htmlToImageCached = fs.readFileSync(resolveVendorOrModule('html-to-image.js', 'html-to-image/dist/html-to-image.js'));
  }
  return htmlToImageCached;
}

export function readPptxgenScript() {
  if (!pptxgenCached) {
    pptxgenCached = fs.readFileSync(resolveVendorOrModule('pptxgen.bundle.js', 'pptxgenjs/dist/pptxgen.bundle.js'));
  }
  return pptxgenCached;
}
```
并在 `readMarkdownClientScript()` 的 mtime 计算里加入：
```js
    fs.statSync(path.join(sharedDir, 'markdown-ppt-export.js')).mtimeMs,
```

- [ ] **Step 4: 静态页路由**

Modify `server/proxy-static.js`：
import 增加 `HTML_TO_IMAGE_SCRIPT_NAME, PPTXGEN_SCRIPT_NAME, readHtmlToImageScript, readPptxgenScript`。
把 asset 三元表达式改为：
```js
    const asset = assetName === MERMAID_SCRIPT_NAME
      ? readMermaidScript()
      : assetName === ECHARTS_SCRIPT_NAME
        ? readEchartsScript()
        : assetName === MARKDOWN_CLIENT_SCRIPT_NAME
          ? readMarkdownClientScript()
          : assetName === HTML_TO_IMAGE_SCRIPT_NAME
            ? readHtmlToImageScript()
            : assetName === PPTXGEN_SCRIPT_NAME
              ? readPptxgenScript()
              : null;
```

- [ ] **Step 5: 静态页接线**

Modify `server/markdown-page.js`：
import 增加 `HTML_TO_IMAGE_SCRIPT_NAME, PPTXGEN_SCRIPT_NAME`。
把 `import { createPptPresenter, enhanceMarkdown, enhanceSimpleTables }` 改为 `import { createPptPresenter, enhanceMarkdown, enhanceSimpleTables, exportPptx }`。
在 `const slides=${slidesJson};` 之后、`const ppt=createPptPresenter({` 之前插入：
```js
      + 'const loadScript=(src)=>new Promise((resolve,reject)=>{const old=document.querySelector(`script[data-df-src="${src}"]`);if(old){resolve();return;}const s=document.createElement("script");s.src=src;s.dataset.dfSrc=src;s.onload=()=>resolve();s.onerror=()=>reject(new Error("load failed: "+src));document.head.appendChild(s);});'
      + 'const exportSlides=async(progress)=>{await loadScript(' + jsString(HTML_TO_IMAGE_SCRIPT_NAME) + ');await loadScript(' + jsString(PPTXGEN_SCRIPT_NAME) + ');const h=window.htmlToImage;const P=window.PptxGenJS;if(!h||!P)throw new Error("export libs missing");const bg=(getComputedStyle(ppt.captureEl()).getPropertyValue("--bg3")||getComputedStyle(ppt.captureEl()).getPropertyValue("--bg1")||"#1e1e1e").trim();await exportPptx({controller:ppt,capture:(el)=>h.toPng(el,{cacheBust:true,pixelRatio:(window.devicePixelRatio||1),width:el.clientWidth,height:el.clientHeight,style:{overflow:"hidden"},backgroundColor:bg}).then((dataUrl)=>({dataUrl,width:el.clientWidth,height:el.clientHeight})),createDeck:()=>new P(),filename:' + jsString(title) + ',background:bg,onProgress:progress,isCancelled:()=>!ppt.isOpen()});};'
```
把 `labels:{open:...}` 改为加入导出文案：
```js
      + 'labels:{open:' + jsString(t('fp.ppt')) + ',close:' + jsString(t('common.close'))
      + ',prev:' + jsString('← ' + t('fp.ppt.prev')) + ',next:' + jsString(t('fp.ppt.next') + ' →')
      + ',hide:' + jsString(t('fp.ppt.hide_nav'))
      + ',export:' + jsString(t('fp.ppt.export')) + ',exporting:' + jsString(t('fp.ppt.exporting')) + '},'
```
把 `renderError:...` 前插入：
```js
      + 'onExport:exportSlides,onExportError:(e)=>{try{const d=document.createElement("div");d.textContent=' + jsString(t('fp.ppt.export_failed', { msg: '@@MSG@@' })) + '.replace("@@MSG@@",String(e&&e.message||e));d.style.cssText="position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;background:#7f1d1d;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;max-width:80vw";document.body.appendChild(d);setTimeout(()=>d.remove(),5000);}catch(_){}},'
```

- [ ] **Step 6: 跑服务端测试确认通过**

Run: `node --test "server/test/markdown-page.test.js" "server/test/proxy-engine.test.js"`
Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add server/mermaid-asset.js server/proxy-static.js server/markdown-page.js server/test/markdown-page.test.js server/test/proxy-engine.test.js
git commit -m "feat(static): enable markdown pptx export on static pages"
```

---

### Task 6: 全量验证

**Files:** 无（只验证）

- [ ] **Step 1: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 退出码 0。

- [ ] **Step 2: 服务端 + Web 测试**

Run: `npm.cmd test`
Expected: 退出码 0。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 退出码 0，无中文命中。

- [ ] **Step 4: 构建 Web**

Run: `npm.cmd run build:web`
Expected: `vue-tsc` 与 `vite build` 成功，`web/dist` 生成。

- [ ] **Step 5: 手工验收（可选，需启动 dev）**

Run: `npm.cmd run dev`（后台），打开 `http://localhost:5173`，预览 `test/markdown_data/mermaid-flowchart-loop.md`：
1. 点「PPT 模式」；
2. 点「导出 PPT」；
3. 观察按钮显示 `导出中 n / N`；
4. 下载得到 `mermaid-flowchart-loop.pptx`，用 PowerPoint 打开，页数与一级标题数一致，每页为截图、16:9、无拉伸。

- [ ] **Step 6: 提交（若手工验收后有微调）**

```powershell
git add -A
git commit -m "test(ppt): verify markdown pptx export end to end"
```

---

## Self-Review

- 规格覆盖：输出 `.pptx`（Task 1/4）、PPT 模式入口（Task 2）、全部页与恢复（Task 1）、16:9 `contain`（Task 1）、只截可见区域（Task 3）、Web + 静态页（Task 4/5）、按需加载（Task 4/5）、i18n（Task 4）、测试（各 Task + Task 6）。
- 类型/命名一致：`renderAt/captureEl/size/index/isBusy`、`exportPptx/pptFileName/containRect`、`captureViewportPng/pptBackground` 全计划一致。
- 无占位符：每个代码步骤均给出可执行代码与命令。
