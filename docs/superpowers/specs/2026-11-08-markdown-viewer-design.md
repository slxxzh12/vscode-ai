# Markdown 渲染能力抽成独立 npm 包设计（@devflow/markdown-viewer）

## 背景

当前 Markdown 渲染能力分散在三处，且与业务耦合：

- `shared/markdown*.js`：markdown-it 解析、表格指令、Mermaid/ECharts 图表解析、流程图、PPT、样式，已是事实上的内核，但没有正式包边界，依赖声明不全（实际 import 了 `markdown-it`、`highlight.js`、`@antv/x6`，`package.json` 只声明了 `@dagrejs/dagre`）。
- `web/src/markdown.ts`：业务渲染入口，含 DOMPurify、`/api/raw` 资源改写、样式块 scope、i18n。
- `web/src/markdown-enhance/`：Vue 适配层，表格直接依赖 Vue + Element Plus + `element-locale`。
- `server/markdown-page.js` + `server/mermaid-asset.js`：静态页自举，用 esbuild 即时打包 `shared/markdown-client.js`，并通过 UMD 全局加载 mermaid/echarts。

目标是把这套能力抽成可独立发布的 Vue 3 组件库，业务侧只保留资源解析、主题来源等薄适配。

## 目标

- 新增 workspace 包 `packages/markdown-viewer`，包名先用 `@devflow/markdown-viewer` 占位。
- 发布形态：Vue 3 组件库，`vue`、`element-plus` 为 peerDependencies。
- 能力完整覆盖：Markdown 解析渲染、表格（ElTable 排序/筛选）、图表（Mermaid → ECharts：折线/柱状/饼/甘特/时间线/流程图/雪佛龙）、Mermaid 原生渲染、流程图 X6 渲染与编辑、PPT 演示与导出、打印、样式体系。
- 重依赖（`echarts`、`mermaid`、`@antv/x6`、`pptxgenjs`、`html-to-image` 等）作为 dependencies，内部动态 import 懒加载。
- 内置中文（zh-CN）与英文（en）词条，`locale` 切换、`messages` 可局部覆盖。
- 主题通过 CSS 变量 + `theme` prop 控制，自带深色/浅色默认值。
- 本仓库的 Web 端与静态页都改为该包的首批使用方；静态页统一加载 Vue 运行时与组件库。

## 非目标

- 不内置任何业务地址（`/api/raw`、`projectId`、`assetMap`）与业务主题开关（`localStorage.devflow-theme`）。
- 不内置 devflow 的 i18n 体系（`@devflow/shared/i18n`）。
- 首版不提供 React / 原生 JS 的官方适配层。
- 首版不落地 npm registry 与正式包名（用占位名，发布前再定）。

## 决策记录

| 问题 | 结论 |
| --- | --- |
| 复用范围 | 发布成独立 npm 包，供其它项目使用 |
| 框架形态 | Vue 3 组件库；`vue`、`element-plus` 为 peerDependencies |
| 功能范围 | 全能力（表格、图表、流程图、PPT、打印、样式） |
| 静态页 | 也加载 Vue 运行时与组件库，统一成一套渲染 |
| 代码位置 | 本仓库新增 `packages/markdown-viewer` workspace |
| 包名/registry | 先用 `@devflow/markdown-viewer` 占位，发布前再定 |
| 重依赖 | 全部作为 dependencies，内部动态 import 懒加载 |
| 文案 | 内置中英双语，`locale`/`messages` 可配置 |
| 主题 | CSS 变量 + `theme` prop |

## 架构

```
packages/markdown-viewer/
  package.json
  tsconfig.json
  vite.config.ts
  src/
    index.ts                 # 公共出口：组件、composable、类型
    core/                    # 框架无关内核（不 import vue / element-plus）
      markdown.ts            # markdown-it + highlight.js + 表格/图片指令
      sanitize.ts            # DOMPurify 包装（可配置、可关闭）
      enhance.ts             # 统一增强管线
      table.ts               # extractTable / TableData
      mermaid.ts             # renderMermaidBlocks + Mermaid 主题配置
      css.ts                 # style 块提取 / 消毒 / scope
      charts/
        parse.ts             # Mermaid -> ChartSpec
        echarts.ts           # ECharts 渲染（折线/柱/饼/甘特/时间线）
        flowchart-model.ts   # 流程图模型
        flowchart-graph.ts   # dagre 布局
        flowchart-x6.ts      # X6 渲染
        flowchart-editor.ts  # X6 编辑器
      ppt.ts                 # 演示器
      ppt-export.ts          # PPTX 导出
      print.ts
      i18n/
        zh-CN.ts
        en.ts
        index.ts
    vue/                     # Vue 适配层
      MarkdownViewer.vue
      useMarkdownViewer.ts
      table-renderer.ts      # ElTable 表格渲染
      styles/
        variables.css        # CSS 变量默认值（深/浅）
        markdown.css         # 正文、表格、代码、Mermaid、图表
        ppt.css
      index.ts
    standalone.ts            # 静态页自举入口（内置 Vue + Element Plus）
  dist/
```

分层原则：

- `core/` 只操作 DOM 与纯数据，不 import `vue` / `element-plus`，可单独单测。
- `vue/` 负责组件生命周期、ElTable 渲染、主题属性、词条注入。
- `standalone.ts` 只做「扫描页面 → 读配置 → 挂载组件」，不承载渲染逻辑。

## 公共 API

主组件：

```vue
<MarkdownViewer
  :content="mdText"
  :html="htmlText"
  theme="dark | light | auto"
  locale="zh-CN | en"
  :messages="{ ... }"
  :asset-src="(rel, suffix) => string"
  :read-asset="(rel) => Promise<string>"
  :flowchart-editable="true"
  :ppt="true"
  :printable="true"
  @ready
  @error
  @link-click
  @flowchart-save
  @ppt-export
/>
```

- `content` 与 `html` 二选一；同时提供时以 `html` 为准。
- `asset-src` 默认原样返回，业务方传入 `/api/raw` 等改写逻辑。
- `read-asset` 供 `mermaid-data` 读取相对资源，默认用 `fetch(new URL(rel, document.baseURI))`。
- `flowchart-editable`、`ppt`、`printable` 控制可选增强是否挂载。
- 插槽：`toolbar`、`empty`、`error`。
- 事件：`ready`（增强完成）、`error`（解析/增强失败）、`link-click`（内部链接）、`flowchart-save`、`ppt-export`。

额外导出：

- `useMarkdownViewer(elRef, options)`：命令式接入，返回 `{ enhance, dispose }`。
- 类型：`MarkdownViewerOptions`、`MarkdownMessages`、`AssetResolver`、`MarkdownTheme`、`MarkdownLocale`。
- 样式：`@devflow/markdown-viewer/style.css`。
- 静态页：`@devflow/markdown-viewer/standalone`。

`package.json` 出口草案：

```json
{
  "name": "@devflow/markdown-viewer",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./style.css": "./dist/style.css",
    "./standalone": { "default": "./dist/standalone/index.js" },
    "./standalone/*": "./dist/standalone/*"
  },
  "peerDependencies": {
    "vue": "^3.5.0",
    "element-plus": "^2.14.0"
  },
  "dependencies": {
    "@antv/x6": "^3.1.8",
    "@dagrejs/dagre": "^3.1.3",
    "dompurify": "^3.4.15",
    "echarts": "^6.1.0",
    "highlight.js": "^11.10.0",
    "html-to-image": "^1.11.13",
    "markdown-it": "^14.1.0",
    "mermaid": "^11.17.2",
    "pptxgenjs": "^4.0.1"
  }
}
```

## 渲染管线

1. 解析：`createMarkdownRenderer()` 用 markdown-it + highlight.js，保留现有 `df-table`、`table-width`、图片尺寸指令，输出 `mermaid` / `mermaid-data` 占位块。
2. 消毒：DOMPurify 安全白名单；`sanitize: false` 可关闭；样式块先提取再消毒，不进入正文消毒流程。
3. 资源改写：对 `img[src]` / `a[href]` 调用注入的 `assetSrc`，库本身不拼接任何业务 URL。
4. 增强（顺序固定）：`mermaid-data` → Mermaid 并排分组 → 原始表格标记 → 表格替换 → ECharts 图表 → Mermaid 渲染。
5. 表格：内核只产出 `TableData`（headers/rows），渲染交给可替换的 `TableRenderer`；Vue 默认实现用 ElTable（排序阈值、筛选、列宽、表头样式），测试使用原生实现。
6. 图表：`parse` 纯函数把 Mermaid 语法转 `ChartSpec`，失败返回 `null` 回落 Mermaid；`echarts` 动态 import，按需注册 Line/Bar/Pie/Custom + Grid/Tooltip/Legend/Title + CanvasRenderer。
7. 流程图：默认 X6 渲染；`flowchart-editable` 时才动态加载编辑器。
8. PPT/打印：演示器与导出全部懒加载（`html-to-image`、`pptxgenjs`）。
9. 生命周期：组件 `onBeforeUnmount` 统一 `dispose`；同一容器重复 enhance 先去重并释放旧实例。

## 依赖与构建

- `vue`、`element-plus` 为 peerDependencies，主构建中标记 external。
- 重依赖放 dependencies，主构建中 external，运行时 `import()` 懒加载；使用方无需手动注册。
- 构建工具：Vite library mode + `vite-plugin-dts`，输出 ESM + d.ts；CSS 抽取为 `dist/style.css`。
- 主构建的 `style.css` 只包含库自身样式；使用方项目自行按现有方式引入 Element Plus 样式。
- 额外产物 `dist/standalone/`：
  - `index.js`：自举入口，内置 Vue + Element Plus。
  - `style.css`：库自身样式 + Element Plus 样式（静态页无需另引）。
  - 按需分包：mermaid / echarts / X6 / pptxgenjs / html-to-image 各自成 chunk，浏览器动态 import。
- 包体积验收：主入口 gzip 体积、standalone 首屏 gzip 体积、懒加载 chunk 是否齐全，写入构建自检。

## 主题与样式契约

- 统一类名前缀 `mdv-`：`.mdv`、`.mdv-body`、`.mdv-table`、`.mdv-el-table`、`.mdv-raw-table`、`.mdv-mermaid`、`.mdv-echart`、`.mdv-error`、`.mdv-toolbar`。
- CSS 变量（使用方可覆盖）：
  - `--mdv-bg`、`--mdv-bg-alt`、`--mdv-text`、`--mdv-text-muted`
  - `--mdv-border`、`--mdv-accent`
  - `--mdv-code-bg`、`--mdv-code-text`
  - `--mdv-table-head-bg`、`--mdv-table-head-text`
  - `--mdv-error`
- `theme` prop 在根节点设置 `data-mdv-theme="dark|light"`；`auto` 跟随 `prefers-color-scheme`。
- 迁移期保留旧 `md-*` 类名别名（`.md-table`、`.md-el-table`、`.md-raw-table`、`.mermaid`、`.md-echart`），避免一次性全量改样式；迁移完成后再评估移除。

## 国际化

- 库内置 `zh-CN` / `en` 两套词条（Mermaid 错误、数据块错误、PPT 按钮、流程图编辑按钮等）。
- `locale` 切换；`messages` 做局部覆盖；缺失回退顺序 `locale -> en -> key`。
- 不依赖 `@devflow/shared/i18n`，以满足「独立发布、零业务依赖」。

## 静态页集成

1. 服务端把包的 `dist/standalone/` 目录挂到 `/_mdv/*`，带长缓存与正确 MIME。
2. `server/markdown-page.js` 的 Markdown 页面固定注入：
   - `<link rel="stylesheet" href="/_mdv/style.css">`
   - `<script type="application/json" id="mdv-config">{ theme, locale, slides }</script>`
   - `<script type="module" src="/_mdv/index.js"></script>`
3. `standalone.ts` 读取 `article.md-page`、解析 `mdv-config`、挂载 `<MarkdownViewer>`；`readAsset` 用页面相对地址 fetch。
4. 不再按内容预判加载 mermaid/echarts/vendor 脚本；由组件内部懒加载对应 chunk。
5. 删除 `server/mermaid-asset.js` 中对 `shared/markdown-client.js` 的 esbuild 即时打包逻辑；保留 `vendor/` 仅作为历史兜底或迁移后清理。

## 本仓库迁移步骤

1. 建 `packages/markdown-viewer` 骨架，纳入 `package.json` workspaces。
2. 把 `shared/markdown*.js` 迁入 `core/`，TS 化，拆分模块，保留现有测试并一起迁移。
3. 实现 Vue 组件、ElTable 渲染器、词条、样式变量与 standalone 入口。
4. Web 侧：
   - `web/src/markdown.ts` 只保留 DOMPurify 配置、`assetSrc`（`/api/raw`）、样式 scope 相关业务参数，解析与增强委托给包。
   - `web/src/markdown-enhance/` 退化为兼容层，重新导出包的组件与 composable，避免大面积改调用点。
   - `DocViewer.vue` 等调用点逐步切到 `<MarkdownViewer>` 或包内 composable。
5. Server 侧：`markdown-page.js`、`mermaid-asset.js`、`proxy-static.js` 改用 standalone 产物与 `/_mdv/*` 路由。
6. 清理 `shared` 中已迁走的文件与 `package.json` exports，更新相关测试路径。
7. 更新打包脚本：`scripts/build.js`、`build-opencode.js`、`build-mac.js` 的 workspace 依赖拷贝、自检与产物白名单。
8. 更新 `AGENTS.md` 目录速览与 `docs/knowledge/` 模块说明。

## 测试与验收

- core 单测：Markdown 解析、表格指令、图表语法、表格提取、CSS 提取/消毒、词条回退。
- Vue 组件测试：`@vue/test-utils` + happy-dom，覆盖表格/图表/流程图/PPT 挂载与 dispose、重复 enhance 去重。
- server 集成测试：Markdown 页引用 `/_mdv/index.js` 与 `style.css`、chunk 可访问、404 行为、缓存头。
- 全量：`npm run typecheck`、`npm test`、`npm run build:web`、绿色包启动自检。
- 验收标准：
  - Web 预览与静态页同一 Markdown 渲染结果一致。
  - 空白 Vue 3 项目只安装 `vue`、`element-plus`、`@devflow/markdown-viewer` 即可跑通核心能力。
  - 静态页无 Vue 手动引入代码，页面只引 `/_mdv/*`。

## 风险与回滚

- 目录迁移影响 `require.resolve('@devflow/shared')`、打包拷贝、测试路径：迁移与打包脚本同批提交，逐项跑构建自检。
- 静态页引入 Vue + Element Plus，首屏体积增加：standalone 懒加载 + `/_mdv/*` 长缓存；首屏只加载解析与样式。
- 类名/样式迁移面大：保留 `md-*` 别名，分阶段清理。
- X6/PPT 分包在静态页下的相对路径与 `base`：standalone 构建固定 `base: './'`，服务端按目录直出。
- 回滚：包与迁移分层提交；如静态页异常，可临时回退到旧 `shared/markdown-client.js` 打包路径（保留一个版本周期）。

## 未决事项

- 正式包名与 registry（公共 npm 还是私有源）在发布前确定。
- 是否在首版同时提供 React 适配（当前不做）。
- 旧 `md-*` 类名别名的移除时间点。
