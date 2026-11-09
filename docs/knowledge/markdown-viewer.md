# Markdown Viewer（@devflow/markdown-viewer）

## 职责

统一提供 Markdown 解析、表格（ElTable）、Mermaid/ECharts 图表、流程图 X6、PPT、打印与样式，供 Web 预览与静态 Markdown 页共用。

## 结构

- `packages/markdown-viewer/src/core/`：框架无关内核，不 import `vue` / `element-plus`。
- `packages/markdown-viewer/src/vue/`：Vue 组件、ElTable 渲染器、词条与样式。
- `packages/markdown-viewer/src/standalone.ts`：静态页自举入口，内置 Vue + Element Plus。
- `shared/markdown*`：兼容 shim，仅 `export *`，不再新增实现。

## 静态页接入

- 服务端 `/_mdv/*` 托管 `dist/standalone/`（主 server 与静态站反向代理都可访问）。
- `server/markdown-page.js` 输出 `<article class="md-body md-page" data-mdv>` + `mdv-config` JSON + `/_mdv/index.js`。
- 页面 CSS 统一来自 `/_mdv/style.css`，不再内联 shared 的 Markdown/PPT 样式。
- 多页 Markdown 会在 `mdv-config` 中带 `content` 与 `ppt:true`，由 standalone 内的 Vue 组件提供 PPT 演示/导出。

## 开发命令

- 构建包：`npm run build:mdv`
- 包测试：`npm --prefix packages/markdown-viewer test`
- `npm run dev` / `npm run build:web` / `npm run test:web` 会自动先构建包。
- 修改 `packages/markdown-viewer/src` 后需要重新 `npm run build:mdv`（Web 与静态页消费的是 `dist/`）。
