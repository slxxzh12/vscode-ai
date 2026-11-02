# Markdown 预览导出 PPT（设计）

## 背景

Markdown 预览已经有 PPT 演示模式：`shared/markdown-ppt.js` 提供浮层、翻页、键盘、全屏、按一级标题分页，并在每页渲染完成后调用 `enhanceMarkdown` 处理 Mermaid / ECharts。Web 端（`web/src/components/DocViewer.vue`）与静态网站的 `.md` 页面（`server/markdown-page.js`）共用这套实现。

现在需要在此基础上增加「导出 PPT」：进入 PPT 模式后，逐页截图，把截图按页插入一个真正的 `.pptx` 文件并下载。需求要点：

- 导出物是 PowerPoint 可直接打开的 `.pptx`。
- 原理是「PPT 模式 + 每页截图」：复用现有逐页渲染/增强，不另外排版。
- Web 应用与静态网站页都要支持。
- 页面比例固定 16:9；截图只取当前可见区域，超出部分不进入截图。

## 目标

- PPT 演示模式底栏新增「导出 PPT」按钮，一键导出全部页。
- 导出过程自动逐页切换、等待 Mermaid / ECharts / 字体/布局稳定后截图。
- 每页截图按 16:9 等比 `contain` 居中放入幻灯片，空白用 PPT 主题背景色填充。
- 导出完成后回到导出前所在页；导出失败也恢复原页并提示。
- Web 主包不因新增依赖变大：`pptxgenjs` 按需动态加载。
- 静态网站页在用户点「导出 PPT」时才加载截图库与打包库，未使用时不产生额外下载。
- 中英文文案齐全。

## 非目标

- 不实现服务端生成 PPT 的接口，不上传截图。
- 不把每页内容重建成可编辑的 PPT 元素；每页就是一张图片。
- 不做单页导出、页码区间选择（本期固定导出全部页）。
- 不改变现有 PPT 分页规则（仍按一级标题分页）。
- 不保证跨域图片能被截图（受 canvas 污染限制，失败时明确报错）。
- 不改变演示模式现有的全屏/翻页/隐藏翻页行为。

## 关键决策

| 决策点 | 选择 |
| --- | --- |
| 输出格式 | 真正的 `.pptx`，使用 `pptxgenjs` |
| 导出入口 | PPT 演示模式内（不是普通预览工具栏） |
| 导出范围 | 全部页，自动逐页，结束后回原页 |
| 页面比例 | 固定 16:9 |
| 截图区域 | 当前可见区域（`.df-ppt-main` 视口），超出部分自然裁掉 |
| 图片放入方式 | 等比 `contain` 居中，不拉伸；空白用主题背景填充 |
| 生成位置 | 浏览器端生成（无服务端接口、无截图上传） |
| 覆盖范围 | Web 应用 + 静态网站 Markdown/PPT 页 |
| 库加载 | Web 动态 `import()`；静态页按需 `<script>` 加载 UMD 包 |

## 实现

### 1. 共享编排模块（新增 `shared/markdown-ppt-export.js` + `.d.ts`）

职责单一：驱动 presenter 逐页渲染、调用注入的截图与建 PPT 能力、下载、恢复原页。不直接 import 任何第三方库，方便 Web 与静态页共用。

```js
/**
 * @param {{
 *   controller: {
 *     size: () => number,
 *     index: () => number,
 *     renderAt: (i: number) => Promise<void>,
 *     captureEl: () => HTMLElement,
 *   },
 *   capture: (el: HTMLElement) => Promise<{ dataUrl: string, width: number, height: number }>,
 *   createDeck: () => any,                 // PptxGenJS 实例
 *   filename: string,                      // 原始文件名（.md 会被替换为 .pptx）
 *   background?: string,                   // 16:9 空白处填充色
 *   onProgress?: (done: number, total: number) => void,
 * }} options
 */
export async function exportPptx(options) { ... }
```

流程：

1. 读取 `total = controller.size()`；`total <= 0` 直接抛错。
2. 记录 `original = controller.index()`。
3. `deck = createDeck()`，布局固定 `LAYOUT_16x9`（10 × 5.625 英寸）。
4. `for i in 0..total-1`：
   - `await controller.renderAt(i)`；
   - `await waitForPaint()`：两帧 `requestAnimationFrame` + `document.fonts.ready`；
   - `shot = await capture(controller.captureEl())`；
   - 按 `contain` 计算 `x/y/w/h`，`slide.addImage({ data: shot.dataUrl, x, y, w, h })`；`slide.background = { color: background }`。
   - `onProgress?.(i + 1, total)`。
5. `blob = await deck.write({ outputType: 'blob' })`（`pptxgenjs` 浏览器 API）。
6. 通过临时 `<a download="<filename>.pptx">` + `URL.createObjectURL(blob)` 下载，随后 `revokeObjectURL`。
7. `finally`：`await controller.renderAt(original)` 恢复原页；异常先恢复再抛出。

`contain` 计算：

```text
scale = min(slideW / shotW, slideH / shotH)
w = shotW * scale
h = shotH * scale
x = (slideW - w) / 2
y = (slideH - h) / 2
```

文件名：`filename` 去掉末尾 `.md` / `.markdown`，替换非法字符 `[\\/:*?"<>|]` 为 `-`，再拼 `.pptx`。

### 2. Presenter 增强（修改 `shared/markdown-ppt.js` + `.d.ts`）

新增选项：

```ts
onExport?: (progress: (done: number, total: number) => void) => Promise<void> | void;
onExportError?: (error: unknown) => void;
labels?: { ...; export?: string; exporting?: string; failed?: string };
```

新增返回 API：

```ts
size: () => number;
index: () => number;
renderAt: (i: number) => Promise<void>;
captureEl: () => HTMLElement;   // 返回 .df-ppt-main
isBusy: () => boolean;
```

实现要点：

- 把内部 `render()` 改为返回 Promise，`renderAt(i)` 设置 `index` 后 `await render()`；`render()` 在 `enhance` 完成、`delete body.dataset.dfPending` 之后 resolve。
- 新增底栏「导出 PPT」按钮（有 `onExport` 时才渲染），点击：
  - `busy = true`，按钮禁用，文案切到 `labels.exporting` 模板并用进度更新（如 `导出中 3 / 10`）；
  - 导出期间 `go/next/prev/open/close` 的键盘与按钮翻页一律忽略；
  - 完成后 `busy = false`，按钮文案恢复；
  - 失败时恢复按钮，并调用可选 `opts.onExportError?.(error)` 交给调用方展示。
- `captureEl()` 返回 `.df-ppt-main`（滚动视口），截图宽度/高度由调用方取 `clientWidth/clientHeight`，保证只截可见区域。
- `showOpenButton` 的独立页面按钮行为不变。

### 3. Web 接入（修改 `web/src/components/DocViewer.vue`、`web/src/snapshot.ts`）

- `snapshot.ts` 新增：

```ts
export function captureViewportPng(el: HTMLElement): Promise<{ dataUrl; width; height }>
```

内部调用 `toPng(el, { ...snapshotOptions(el), width: el.clientWidth, height: el.clientHeight, style: { overflow: 'hidden' } })`；返回 `dataUrl` 与 `clientWidth/clientHeight`。这样即使内容超出，也只截视口。

- `DocViewer.ensurePpt()` 增加：

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
  });
  setToolMsg(t('fp.ppt.export_done', { name: pptFileName(props.name) }));
},
onExportError: (e) => setToolMsg(t('fp.ppt.export_failed', { msg: String((e as any)?.message || e) }), false),
```

其中 `pptFileName(name)` 得到 `xxx.pptx`（与 `exportPptx` 内部同一规则）；`pptBackground(el)` 按 `--bg3` → `--bg1` → `--bg0` → `#1e1e1e` 取色（`--bg3` 是 `.df-ppt-main` 的实际背景）。

- `pptxgenjs` 只在导出时动态加载，不进入主包首屏。

### 4. 静态页接入（修改 `server/mermaid-asset.js`、`server/proxy-static.js`、`server/markdown-page.js`）

- `shared/markdown-client.js` 追加：`export { exportPptx } from './markdown-ppt-export.js';`。
- `server/mermaid-asset.js` 新增导出：

```js
export const HTML_TO_IMAGE_SCRIPT_NAME = '__devflow_html_to_image__.js';
export const PPTXGEN_SCRIPT_NAME = '__devflow_pptxgen__.js';
export function readHtmlToImageScript() { ... }  // vendor 优先，否则 require.resolve('html-to-image/dist/html-to-image.js')
export function readPptxgenScript() { ... }      // vendor 优先，否则 require.resolve('pptxgenjs/dist/pptxgen.bundle.js')
```

两者都做内存缓存（与现有 mermaid/echarts 一致）。

- `server/proxy-static.js` 的资源路由增加这两个文件名，`Content-Type: text/javascript`；`pptxgen`/`html-to-image` 可长缓存，`__devflow_markdown__.js` 仍 `no-cache`。
- `server/markdown-page.js` 的初始化脚本：
  - import 增加 `exportPptx`；
  - 增加 `loadScript(src)` 帮助函数（幂等：已存在 `window.htmlToImage` / `window.PptxGenJS` 则直接复用）；
  - `createPptPresenter` 传入 `onExport`：
    1. `await loadScript(HTML_TO_IMAGE_SCRIPT_NAME)` → `window.htmlToImage.toPng`；
    2. `await loadScript(PPTXGEN_SCRIPT_NAME)` → `window.PptxGenJS`；
    3. `await exportPptx({ controller: ppt, capture: el => htmlToImage.toPng(el, { cacheBust: true, pixelRatio: devicePixelRatio, width: el.clientWidth, height: el.clientHeight, style: { overflow: 'hidden' }, backgroundColor: ... }).then(...), createDeck: () => new PptxGenJS(), ... })`。
  - `onExportError` 用页面内联提示（页面顶部临时条或卡片样式），避免 `alert`。
- 静态页面的 PPT 按钮仍由现有 `showOpenButton` 控制；导出按钮只在打开演示后出现。

### 5. 依赖与打包

- `web/package.json` 新增 `pptxgenjs`（运行时依赖，浏览器端 import）。
- `server/package.json` 新增 `pptxgenjs` 与 `html-to-image`（用于静态页资源解析；打包脚本会按 `server/package.json` 的真实解析结果拷贝依赖）。
- 两者版本保持一致；`pptxgenjs` 使用其自带 `dist/pptxgen.bundle.js`（浏览器 UMD，全局 `PptxGenJS`），`html-to-image` 使用 `dist/html-to-image.js`（全局 `htmlToImage`）。
- 打包自检会自动覆盖新增的 server 依赖；无需额外改动 `scripts/build*.js`，但需确认资源文件被打进绿色包（依赖目录随 `server/package.json` 拷贝）。

### 6. 国际化

在 `shared/i18n/zh-CN.js` 与 `shared/i18n/en.js` 同时新增：

- `fp.ppt.export`：导出 PPT / Export PPT
- `fp.ppt.exporting`：导出中 {done} / {total} / Exporting {done} / {total}
- `fp.ppt.export_done`：已导出 {name} / Exported {name}
- `fp.ppt.export_failed`：导出 PPT 失败：{msg} / PPT export failed: {msg}

Presenter 的默认文案（未传 `labels`）使用英文兜底，实际调用方都传 `t()` 结果。

## 错误处理与边界

- 无页（空文档）：导出按钮禁用；`exportPptx` 也做防御性抛错。
- 导出中再点导出/翻页：忽略（presenter `busy`）。
- 图片跨域污染 canvas：`toPng` 抛错 → 中止 → 恢复原页 → `onExportError` 提示。
- 切换文件/关闭 PPT/组件卸载时正在导出：presenter `destroy`/`close` 使后续 `renderAt` 失效；`exportPptx` 在每步后检查 `controller.isOpen?.()`，失效则抛「已取消」并恢复。
- 内存：截图逐个生成、逐个写入 PPT，不长期保留全部 dataURL 之外的副本；下载后释放 object URL。
- 超长内容：按决策只截可见区域，不缩放、不拼接。
- 大文档页数多：顺序执行，给出 `done/total` 进度，避免并发把浏览器卡死。

## 测试

- `web/src/markdownPptExport.test.ts`（新增，`@vitest-environment happy-dom` 或纯 node）：
  - 按 0..N-1 顺序调用 `renderAt`，最后回到原页；
  - `onProgress` 次数与数值；
  - `contain` 计算（宽图/高图两组）；
  - `capture` 抛错时仍恢复原页并抛错；
  - 文件名清洗。
- `web/src/markdownPpt.test.ts` 扩展：
  - 传 `onExport` 时出现导出按钮；
  - 点击后进入 busy，翻页被忽略，进度文案更新；
  - 导出失败后按钮恢复。
- `web/src/snapshot.test.ts` 扩展：`captureViewportPng` 带上 `clientWidth/clientHeight` 与 `overflow: hidden`。
- `server/test/*.test.js`：静态页资源路由能返回 `html-to-image` / `pptxgenjs` 脚本，Markdown 页面脚本包含 `exportPptx` 与两个脚本名。
- 回归：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run check:i18n`。

## 涉及文件清单

新增：

- `shared/markdown-ppt-export.js`
- `shared/markdown-ppt-export.d.ts`
- `web/src/markdownPptExport.test.ts`

修改：

- `shared/markdown-ppt.js`
- `shared/markdown-ppt.d.ts`
- `shared/markdown-client.js`
- `shared/i18n/zh-CN.js`
- `shared/i18n/en.js`
- `server/mermaid-asset.js`
- `server/proxy-static.js`
- `server/markdown-page.js`
- `web/src/components/DocViewer.vue`
- `web/src/snapshot.ts`
- `web/src/snapshot.test.ts`
- `web/src/markdownPpt.test.ts`
- `web/package.json`
- `server/package.json`
