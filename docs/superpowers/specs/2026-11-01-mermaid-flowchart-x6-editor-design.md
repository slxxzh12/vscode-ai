# Mermaid 流程图切换 X6 + 可视化编辑（设计）

## 背景

当前 Mermaid `flowchart/graph` 由 `shared/markdown-flowchart.js` 自行解析，用 dagre 布局后交给 ECharts custom 系列渲染。复杂流程图存在三个问题：

1. 节点/连线容易重叠，布局可读性不足；
2. 连线基本是直线，没有正交/避让路由；
3. 缺少缩放、平移、拖拽、折叠等交互，无法在预览里调整。

同时希望支持在界面上直接编辑流程图，并把修改保存回 Markdown。

## 目标

- 流程图统一改用 AntV X6 渲染：dagre/保存坐标布局、正交连线路由、缩放/平移、子图。
- 双击流程图打开全屏编辑器，可拖动节点、调整连线端点、增删节点/连线、改标签、增删子图、节点拖入拖出子图。
- 编辑结果保存回 Mermaid；坐标用块内注释持久化；未改动属性尽量原样保留。
- 应用内可写文件直接回写 `.md`；不可写或静态网站页面则复制 Mermaid + 下载当前流程图块。
- Web 预览、静态网站、PPT、打印共用同一套 X6 渲染。
- X6 及编辑器按需懒加载，不拖慢首屏。

## 非目标

- 不做撤销/重做、复制粘贴、协同编辑、自动保存（v1）。
- 不做非 `flowchart/graph` 的 Mermaid 图形编辑。
- 不做服务端无头浏览器渲染或截图。
- 不保证支持 Mermaid 全部语法；遇到无法映射的语法时保留原文并降级。

## 使用方式

- 预览中双击流程图 → 打开全屏编辑器。
- 工具栏：选择、添加节点、添加连线、添加子图、删除、自动布局、保存、取消。
- 应用内保存：写回当前 `.md` 中对应的 ` ```mermaid ` 代码块；文件不可写时改为复制 + 下载。
- 静态网站保存：复制 Mermaid 到剪贴板 + 下载当前流程图块 `.md`。

## 坐标持久化

在 Mermaid 代码块末尾追加一行注释：

```mermaid
%% x6-positions: {"n1":{"x":120,"y":80},"g1":{"x":20,"y":20,"w":400,"h":260}}
```

- 节点坐标为左上角 `x/y`；子图额外保存 `w/h`。
- Mermaid 渲染器会忽略 `%%` 注释；本项目解析器读取并恢复位置。
- 没有该注释时按 dagre 自动布局；编辑器「自动布局」会重算并覆盖坐标。

## 实现

### 1. 解析与序列化（新增 `shared/markdown-flowchart-x6.js`）

- 解析 Mermaid 为模型：
  - `direction`
  - `nodes: { id, label, shapeRaw, classRaw, linkRaw, originalLines, x?, y? }`
  - `edges: { id, source, target, label, rawSyntax, originalLine, points? }`
  - `groups: { id, label, direction, nodeIds, originalLines, x?, y?, w?, h? }`
  - `classDefs` / `classAssign` 原文
  - `extraLines`：无法映射但必须保留的行
- 序列化：
  - 未改动的节点/连线/子图/classDef 输出原始行；
  - 改动项输出标准 Mermaid；新增项生成规范语法；
  - 末尾追加 `%% x6-positions`。
- 提供 `replaceMermaidBlock(markdown, blockIndex, newCode)` 纯函数，用于应用内回写。

### 2. 只读渲染

- X6 `Graph`，SVG 渲染；`panning`、`mousewheel` 缩放开启；只读时禁用节点拖动与连线。
- 连线使用正交/曼哈顿路由（`router: 'manhattan'`，必要时回退 `orth`）。
- 节点形状按 Mermaid 形状映射；子图用 X6 分组/父子节点。
- 主题跟随现有 `--tx/--bd/--ac2/--bg*` 变量。
- 渲染失败时保留 `pre.mermaid`，交给 Mermaid 原生渲染。

### 3. 编辑器（新增 `shared/markdown-flowchart-editor.js`）

- 框架无关：直接创建全屏 DOM 浮层 + X6 画布，Web 与静态页共用，避免把 Vue 打进静态页。
- 能力：
  - 节点拖动、连线端点重连；
  - 添加节点/连线/子图；
  - 删除选中节点/连线/子图；
  - 双击节点/连线编辑标签；
  - 节点拖入/拖出子图；
  - 自动布局；
  - 保存/取消。
- 保存时调用注入的 `onSave(code)`；关闭后释放 X6 实例与事件。

### 4. 集成

- `shared/markdown-charts.js` 的 `flowchart` 分支改为懒加载 X6 渲染器。
- 渲染后给容器标记原始代码与块序号；双击调用编辑器。
- Web（DocViewer）：
  - 传入 `onSave`：文件可写时重读文件、校验原块仍存在，替换并保存；不可写时复制 + 下载。
  - 保存成功后刷新普通预览与 PPT。
- 静态页（`server/markdown-page.js` + `server/mermaid-asset.js`）：
  - 新增按需编辑器脚本 `__devflow_flowedit__.js`，首次双击时动态加载；
  - `onSave` 执行复制 + 下载当前块。
- X6 依赖同时加入 web 与 server（静态页由 esbuild 打包），编辑器单独懒加载。

### 5. 错误与冲突

- 解析失败 / X6 加载失败：不替换节点，继续 Mermaid 原生渲染；双击不进入编辑。
- 保存时文件已被外部修改、或找不到原代码块：提示重新加载，不静默覆盖。
- 文件不可写：自动降级为复制 + 下载。

## 测试

- 解析/序列化往返：节点、连线、子图、坐标、classDef 保留；未支持行原样保留。
- 坐标注释读写与自动布局覆盖。
- 块替换纯函数：多块文档只替换目标块。
- 编辑器模型操作：增删节点/连线/子图、改标签、重连 → 期望 Mermaid。
- 静态页：包含 `__devflow_flowedit__.js` 注入与双击入口。
- X6 渲染做数据级/容器级断言；像素与交互用人工验收。

## 兼容与风险

- X6 体积较大，必须懒加载；静态页首次编辑时才下载编辑器脚本。
- 复杂 Mermaid 语法无法全部映射，采用「保留原文 + 只改可识别部分」策略。
- 现有 ECharts 流程图测试将迁移到 X6 模型/序列化测试。
- PPT/打印依赖 DOM/SVG 截图，X6 使用 SVG 渲染以保持兼容。
