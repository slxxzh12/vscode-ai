# 设计文档：网页截图（Snapshot）功能

日期：2026-09-12
分支：master
状态：待评审

## 1. 概述

在 devflow 网页顶栏新增一个「相机」按钮，点击后把**当前 devflow 页面**（顶栏 + 侧栏 + 主内容区，即用户此刻看到的一屏）截取并**下载为 PNG 文件**。

已与用户确认的约束：

- **截取范围**：整个 devflow 页面（`.app` 根容器，`height:100%` 视口一屏；不做滚动拼接）。
- **输出**：直接下载 PNG 文件，不弹预览、不复制剪贴板、不存服务端。
- **触发**：顶栏按钮（放在语言/主题按钮旁）。

## 2. 现状与影响面

- `web/src/App.vue`：根 `<div class="app">` 即整个应用容器；顶栏 `.top` 已有语言、主题按钮（`App.vue:391-395`）。
- `web/package.json`：web 依赖清单，当前无任何截图/序列化库；项目零 CDN、字体本地。
- `web/src/`：纯逻辑集中在独立 `.ts` 模块并配 `*.test.ts`（vitest），如 `diff.ts`、`markdown.ts`、`scheduler/format.ts`。
- i18n：`shared/i18n/zh-CN.js` + `en.js` 为唯一词条源；`web/src/i18n.ts` 提供 `t()` / `$t()`。
- 终端使用 `@xterm/xterm` 的默认 DOM 渲染器（未加载 canvas addon），主内容区为常规 DOM，适合 `foreignObject` 序列化。

## 3. 技术选型

新增依赖 **`html-to-image`**：把 DOM 节点序列化进 SVG `foreignObject`，交由浏览器自身渲染后导出 PNG。

对比过的方案：

| 方案 | 结论 |
| --- | --- |
| `html-to-image`（选定） | 无需权限弹窗；文字/布局还原度高；自动内联 `<canvas>`、图片为 dataURL；体积小 |
| `html2canvas` | 自实现 CSS 渲染，对 CSS 变量/阴影/渐变还原不稳定，xterm 文字易错位；体积大 |
| 原生 `getDisplayMedia` | 像素级准确，但每次都弹授权框、需用户选标签页、可能截到应用外内容；体验割裂 |

## 4. 新增模块 `web/src/snapshot.ts`

纯逻辑与副作用分离，便于单测：

- `snapshotFileName(date = new Date()): string`
  生成文件名 `devflow-YYYYMMDD-HHmmss.png`（本地时间，各段补零）。
- `snapshotBackground(el: HTMLElement): string`
  读取计算样式里的主题背景色（优先 `--bg1`，回退 `--bg0`，再回退 `#1e1e1e`），避免导出透明 PNG。
- `snapshotFilter(node: Node): boolean`
  `html-to-image` 的 `filter`，跳过带 `data-snapshot-skip` 属性的元素。
- `captureToPng(el: HTMLElement): Promise<void>`
  调用 `toPng(el, options)`，得到 dataURL 后创建 `<a href download=snapshotFileName()>` 并 `click()` 触发下载。异常向上抛出由调用方提示。
- 选项：`{ cacheBust: true, pixelRatio: window.devicePixelRatio || 1, backgroundColor: snapshotBackground(el), filter: snapshotFilter }`。

## 5. `App.vue` 改动

- 根 `<div class="app">` 绑定 `ref="appRef"`。
- 顶栏语言/主题按钮旁新增相机按钮：

  ```html
  <button class="snap-btn" :disabled="snapshotting"
          :class="{ 'snap-hidden': snapshotting }"
          :title="$t('top.snapshot')" @click="onSnapshot">📷</button>
  ```

- `onSnapshot()` 流程：
  1. `snapshotting = true`（按钮 `visibility:hidden`，避免相机按钮自身入镜；同时禁用防连点）
  2. `await nextTick()` + `requestAnimationFrame` 等待重绘
  3. `await captureToPng(appRef)`
  4. 无论成功失败 `snapshotting = false`
  5. 失败：`alert(t('top.snapshot.failed'))`
- 样式：`.snap-btn` 与既有 `.lang-btn` / `.theme-btn` 一致（含 `.top.colored` 下的白字/半透明白底分支）；`.snap-hidden { visibility: hidden; }`。

## 6. i18n 词条

`shared/i18n/zh-CN.js` 与 `en.js` 对称新增：

| key | zh-CN | en |
| --- | --- | --- |
| `top.snapshot` | 截图当前页面 | Capture current page |
| `top.snapshot.failed` | 截图失败，请重试。 | Failed to capture the page, please try again. |

## 7. 数据流

```
点击 📷
  -> snapshotting = true（相机按钮 visibility:hidden）
  -> nextTick + requestAnimationFrame
  -> captureToPng(appRef)
       -> snapshotBackground(appRef) 读主题背景色
       -> toPng(appRef, { cacheBust, pixelRatio, backgroundColor, filter })
       -> dataURL -> <a download=devflow-<ts>.png>.click()
  -> snapshotting = false
  （异常 -> alert(top.snapshot.failed)）
```

## 8. 边界与取舍

- **按钮入镜**：截图前隐藏相机按钮；其余顶栏内容照常入镜。
- **透明背景**：强制取主题背景色（暗色主题导出暗底），避免 PNG 透明发黑。
- **高分屏**：`pixelRatio = devicePixelRatio`，避免模糊。
- **字体**：`html-to-image` 自动内联 `@font-face`；项目零 CDN、字体本地，无跨域问题。
- **范围**：`.app` 为 `height:100%` 视口容器，故「整个页面」＝当前视口一屏，**不做**滚动拼接（用户已确认）。
- **性能/重复点击**：截图期间按钮禁用，防连点。
- **失败**：仅捕获并提示，不改变页面状态。

## 9. 测试与验收

- 单测 `web/src/snapshot.test.ts`：
  - `snapshotFileName`：固定日期 → `devflow-20260912-093005.png`（含补零）。
  - `snapshotBackground`：注入 mock 计算样式，验证 `--bg1` / `--bg0` / 兜底色三级回退。
  - `snapshotFilter`：带/不带 `data-snapshot-skip` 的节点返回 false/true。
- 类型检查：`npm.cmd run typecheck` 通过。
- i18n：`shared/i18n` 词条中英对称；`npm.cmd run check:i18n` 通过。
- 全量测试：`npm.cmd test` 通过。
- 人工验收（浏览器）：
  1. `npm.cmd run dev:web` 打开 http://localhost:5173，亮/暗主题各点一次相机按钮；
  2. 下载得到 PNG，内容与界面一致（顶栏、侧栏、终端/预览），相机按钮自身不出现在图中；
  3. 高分屏下图片清晰不模糊。

## 10. 明确不做

- 不做滚动拼接的「整页长图」。
- 不做复制到剪贴板 / 弹预览 / 保存到服务端历史。
- 不做框选区域 / 仅截主内容区。
- 不引入后端接口与配置项。

## 11. 决策记录

- 选 `html-to-image` 而非 `html2canvas` / 原生截屏：无权限弹窗、还原度好、体积小，适配本项目文字为主的界面。
- 仅下载 PNG：用户明确选择。
- 顶栏按钮触发：用户明确选择。
- 截取整个 devflow 页面、单屏：用户明确选择。
