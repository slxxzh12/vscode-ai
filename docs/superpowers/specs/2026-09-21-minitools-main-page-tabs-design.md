# 设计文档：小工具并入主页面统一壳子（工具页签 + 统一树 + 文档查看器复用）

日期：2026-09-21
分支：master
状态：已与用户确认方案（待实现）

## 1. 概述

现状：五个小工具（`notepad`、`yaml`、`translate`、`postman`、`navicat`）都开在 `MiniTools.vue` 的 fullscreen `el-dialog` 里，各自「自带左侧树 + 右侧内容」，各工具左侧树实现也不统一（`FileTree`/`TreeNode` vs `ItemTree` vs `NavicatTree`）。

用户希望：**以当前主页面（explorer：左侧面板 + 中央主区）为唯一壳子**，小工具不再是弹窗，而是主区里的「工具页签」——左侧面板显示该工具的固定树，中央显示该工具的内容；所有工具共用同一套树组件与同一套壳子，只有主区内容按工具不同。

本设计是 `2026-09-21-minitools-unified-file-workbench-design.md` 的自然延续（该文档「后续（本轮不做）」明确留了「小工具文件树与首页项目文件树共用同一份组件实现」）。

### 需求原文（用户）

> 我觉得小工具里的 yaml、Notepad 是不是可以直接合并成一个，但是页面上加两个入口呢，而且文档展示的方式直接用首页展示的方式，只是里面展示是固定一个目录呢？
>
> 我觉得没有必要再重新开发一套。
>
> postman 展示的目录树也跟主页的保持一样的规则。
>
> navicat 目录树也一样，只是右边区域展示内容不同而已。
>
> 以当前主页面为基础。

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 壳子 | 以当前主页面（explorer）为基础，不新增 rail；工具 = 主区页签 |
| 2 | 左侧面板 | 活动页签是工具时，左侧 `aside` 显示该工具的固定树；否则显示现有 `HistoryList` |
| 3 | 树组件 | 主页项目树与工具树**合并为同一组件、同一外观与交互** |
| 4 | 文档显示 | `notepad`/`yaml` 复用主页面 `FilePreview` 那套显示（抽出 `DocViewer`） |
| 5 | notepad/yaml | 同一实现按 `tool` 参数化，各自独立目录，互不可见 |
| 6 | 改造范围 | 五个工具（`notepad`/`yaml`/`translate`/`postman`/`navicat`）全部改 |
| 7 | 入口 | 磁贴（应用市场页 + 欢迎页）保留；活动栏为 5 个工具各加一个快捷图标 |
| 8 | 实施方式 | inline（本会话）执行，按第 8 节分三步 |

## 3. 现状（改动前）

- 工具弹窗：`web/src/components/MiniTools.vue` 以 fullscreen `el-dialog` 承载五个工具，操作栏经 `web/src/tools/dialogActions.ts` 的 `DIALOG_ACTIONS_TARGET` Teleport 到弹窗标题行。
- 工具入口：磁贴在 `AppMarketView.vue`（`rail === 'mobile'`，🧰）与 `WelcomeView.vue`（空页签时的覆盖层）各一份；跨挂载意图走 `web/src/uiIntents.ts` 的 `pendingTool`。
- 工具左侧树三套实现：
  - 主页项目树：`web/src/components/FileTree.vue` + `TreeNode.vue`（`ui-monospace`、懒加载递归 `/api/tree`、右键菜单含定位/复制/详情、`useProjects`）。
  - 工具文件树：`web/src/components/ItemTree.vue`（一次性 `{folders, items}`、行内重命名、拖拽移动、运行按钮、状态点），`notepad`/`yaml`/`translate`/`postman` 经 `FileSidebar.vue`/`PostmanTree.vue` 使用。
  - navicat 连接树：`web/src/tools/navicat/NavicatTree.vue`（连接→库→表 懒加载）。
- 工具数据层：`web/src/tools/files/useToolFiles.ts`（`/api/files/<tool>/*`，`FileTool = 'notepad'|'yaml'|'js'|'translate'`）+ `useFileWorkbench.ts`（打开/新建/防抖自动保存）。
- 主页面布局：`App.vue` 的 `rail === 'explorer'` 分支渲染 `aside.side`（`HistoryList`）+ 分隔拖拽条 + `section.center`（`TerminalView`）。
- 主区页签：`web/src/useCenter.ts` 的 `CenterTab` 只有 `kind: 'session' | 'file'`；`TerminalView.vue` 按 `activeFile`/`isSessionView` 切换终端与 `FilePreview`。
- 文档显示：`web/src/components/FilePreview.vue`（约 940 行）与项目文件深度绑定——`useProjects()` 的 `text/write/rawUrl/format/fileMeta/fileHash/reveal/runScript/tree/pickTextFile`，按 `projectId + path` 取数；含预览/代码/可视化/curl、编辑器、Base64、diff、详情、状态栏、自动保存。

## 4. 设计

### 4.1 统一树组件 `TreeView.vue`

新增 `web/src/components/TreeView.vue`（落地时可沿用 `ItemTree` 名，合并 `FileTree`/`TreeNode`/`ItemTree`），成为主页与所有工具唯一的树：

- **统一外观**：`ui-monospace` 紧凑行、`📁`/`📄` 图标、`--bg4` 悬停/选中底、`--ac2` 选中字色、缩进、时间、状态点。
- **统一交互**：单击目录展开/折叠、单击文件打开、行内重命名、右键菜单（新建文件/文件夹、重命名、删除、复制名称/相对路径、定位、运行、详情）、拖拽移动、折叠状态 `localStorage` 持久化。
- **数据源适配器 `TreeSource`**（见下），能力缺省即隐藏对应菜单/按钮：

```
type TreeSource = {
  rootLabel?: string;
  load(dirKey: string): Promise<TreeNodeModel[]>;   // 懒加载子节点；'' = 根
  open(node: TreeNodeModel): void;
  caps: { createFile?, createFolder?, rename?, remove?, move?, run?, runFolder?, copyName?, copyPath?, reveal?, detail? };
  createFile?(dir, name)/createFolder?(dir, name)/rename?(key, name)/remove?(key)/move?(key, dir);
  run?(key)/runFolder?(dir);
};

type TreeNodeModel = {
  key: string;                 // 唯一 id：项目=相对路径；工具文件=文件 id；navicat=连接/库/表 key
  name: string;
  kind: 'dir' | 'item';
  icon?: string;
  time?: string;
  status?: 'pass' | 'fail';
  hasChildren?: boolean;       // 懒加载提示
  children?: TreeNodeModel[];  // undefined = 未加载
};
```

- **三层拆分**：`TreeView`（纯展示 + 交互规则）、`useTreeSource`（适配器契约与懒加载状态）、各源适配器：
  - 项目源：`useProjects().tree(projectId, rel)` 懒加载递归；`createFile/createDir/reveal/text`；含定位/复制内容/详情。
  - 工具文件源：`useToolFiles(tool)` 的 `{folders, items}` / `load/read/save` 映射为节点；`createFile/createFolder/renameItem/renameFolder/removeItem/removeFolder/moveItem`；`postman`/`navicat` 文件分组带 `run`/`status`。
  - navicat 源：连接→库→表 懒加载；连接编辑/重命名/删除，点表查询。
- 保留现有能力：`postman` 的文件夹/单条「运行」与状态点；工具树的拖拽移动与折叠持久化。

### 4.2 工具壳子与主区页签

- `useCenter.ts`：`CenterTab` 增加 `kind: 'tool'` 与 `tool?: ToolId`（id `t:<tool>`）；新增 `openTool(tool)`（upsert + 激活）与 `closeById('t:...')` 处理。
- `TerminalView.vue`：活动页签是工具时，主区渲染该工具的内容组件（第 4.3 节），并隐藏终端/输入框；会话/文件页签逻辑不变；工具页签标签按当前语言取词条（读 `tab.tool`）。
- `App.vue`：`rail === 'explorer'` 分支的 `aside.side`，在活动页签是工具时渲染该工具的 `TreeView`，否则渲染现有 `HistoryList`；分隔拖拽条与宽度逻辑不变。

### 4.3 各工具内容（右区，各自独立）

- `notepad` / `yaml`：`DocViewer`（第 4.4 节）。两者同一组件按 `tool` 参数化，各自独立目录（`tools/notepad/`、`tools/yaml/`），互不可见。
- `translate`：保留现有「输入 → 输出」双栏，去掉文件树部分（文件树移入左侧面板）。
- `postman`：保留现有请求/响应面板与其「放大浮层」，去掉自带左侧树与弹窗操作栏。
- `navicat`：保留现有连接/查询面板，去掉自带左侧树（连接树移入左侧面板）。

### 4.4 `DocViewer` 抽取（复用主页面文档显示）

- 新增 `web/src/components/DocViewer.vue`：从 `FilePreview.vue` 抽出「显示主体」——头部工具条（预览/代码切换、保存状态、工具菜单）、预览（markdown/html）、编辑器、可视化（yaml）、curl 视图、Base64 面板、diff 面板、详情面板、状态栏、自动保存（`scheduleSave/flush`）——只依赖注入的 `DocSource` 与 `path/name`，不再直接 `useProjects`。
- `FilePreview.vue` 变薄：构造「项目 `DocSource`」（包装 `useProjects`）传给 `DocViewer`，并保留项目专有动作：定位资源管理器、运行脚本、外部文件选择、markdown 图片按 `projectId` 解析、`detailToken` 自动打开详情。
- 工具 `DocSource`：`read/write` 走 `/api/files/<tool>/*`；`list` 由 `{folders, items}` 适配（供 diff 选文件）；`rawUrl/meta/hash/reveal/run/markdownImageBase` 缺省 → 工具模式下对应按钮/能力自动隐藏。
- 单调来源：`format`（`/api/format` 压缩）与 `formatText`（Prettier）与来源无关，保留在 `DocViewer` 内直接调用。

```
type DocSource = {
  kind: 'project' | 'tool';
  read(path): Promise<{ content; size; mtime?; abs?; binary?; name }>;
  write(path, content): Promise<void>;
  rawUrl?(path): string;
  list?(dir): Promise<TreeItem[]>;
  meta?(path): Promise<FileMeta>;
  hash?(path): Promise<FileHashes>;
  reveal?(path): Promise<void>;
  run?(path): Promise<void>;
  pickExternal?(): Promise<{ name; content; size; binary? } | { cancelled: true } | { error: string }>;
  markdownImageBase?: { projectId: string; dir: string };
};
```

### 4.5 入口与清理

- 磁贴（应用市场页 + 欢迎页）：5 个工具点任意一个 → 切到 `#explorer` + 打开该工具页签（不再开弹窗）。
- 活动栏：为 5 个工具各加一个快捷图标（点了切 explorer + 激活该工具页签；已是该页签则只激活）。
- 删除弹窗链路：`MiniTools.vue` 的 `el-dialog` 与工具分支、`tools/dialogActions.ts`（确认无他用后删除）、`tools/notepad/NotepadTool.vue`；`TextToolBody.vue`/`PostmanTool.vue`/`NavicatTool.vue` 精简为纯内容组件。
- `uiIntents.ts`：`pendingTool` 保留（供磁贴/欢迎页触达 App），App 统一处理 rail 切换与开页签。
- i18n 中英补齐；服务端基本零改动（工具文件仍走既有 `/api/files/<tool>/*`）。

### 4.6 数据流

```
磁贴 / 活动栏图标点工具
  → pendingTool（或直接调用）→ App 切到 explorer + center.openTool(tool)
  → aside 渲染该工具 TreeView；主区渲染该工具内容组件
  → 左侧树点文件 → 写入该工具工作台状态（activeId）
  → 主区内容按 activeId 载入（notepad/yaml = DocViewer；postman/navicat/translate 各自）

工具页签关闭
  → aside 回到 HistoryList（若还有会话/文件页签）或保持空态
```

### 4.7 边界与错误处理

- 无活动文件：`notepad`/`yaml` 显示空态提示，不自动建文件（沿用现有 `useFileWorkbench` 语义）。
- 工具文件专有能力缺失（定位/运行/哈希/markdown 图片）：`DocViewer` 按 `DocSource` 能力自动隐藏，不报错。
- 手机页（`?phone=1`）：不显示工具页签入口；沿用现有手机逻辑。
- 多个工具页签同时打开：各自独立目录、独立工作台状态，互不影响。
- 刷新恢复：工具页签的持久化沿用现有「最近 N 个页签」逻辑；`restorePrefs`/`windowState` 需能识别 `t:<tool>`（实现时按需扩展，否则工具页签刷新后不恢复，属可接受的降级）。

## 5. 影响面

| 文件 | 改动 |
| --- | --- |
| `web/src/components/TreeView.vue` | 新增（合并 `FileTree`/`TreeNode`/`ItemTree`） |
| `web/src/components/FileTree.vue`、`TreeNode.vue`、`ItemTree.vue` | 迁移到 `TreeView`（保留兼容或删除） |
| `web/src/components/FilePreview.vue` | 抽出 `DocViewer`，变薄为项目适配层 |
| `web/src/components/DocViewer.vue` | 新增（通用文档查看器） |
| `web/src/tools/tree/`（新增） | 项目/工具/navicat 三个 `TreeSource` 适配器 |
| `web/src/tools/doc/`（新增） | 工具 `DocSource` 适配器 + 工具内容组件 |
| `web/src/useCenter.ts` | `kind: 'tool'` + `openTool` |
| `web/src/components/TerminalView.vue` | 工具页签主区分支 |
| `web/src/App.vue` | 左侧面板按活动页签切换；入口分流 |
| `web/src/components/MiniTools.vue`、`AppMarketView.vue`、`WelcomeView.vue` | 入口改走工具页签；删除弹窗 |
| `web/src/tools/notepad/NotepadTool.vue`、`text/TextToolBody.vue`、`postman/PostmanTool.vue`、`navicat/NavicatTool.vue` | 精简为纯内容组件 |
| `web/src/tools/dialogActions.ts` | 删除（确认无他用） |
| `shared/i18n/zh-CN.js`、`en.js` | 新增/调整词条（中英对称） |
| 测试 | 见第 6 节 |

## 6. 测试计划

- `TreeView` 单测：三种 `TreeSource` 的展开/选择/懒加载；右键菜单按能力显隐；行内重命名；拖拽移动；折叠持久化。
- `useCenter.openTool` / `closeById('t:...')` 单测。
- `App.vue` 左侧面板在「工具页签 / 非工具页签」下的切换；入口分流（磁贴/活动栏 → 开对应工具页签）。
- `DocViewer`：项目源行为与现有 `FilePreview` 一致（回归）；工具源读写 + 能力缺省时按钮隐藏。
- 各内容组件（`TextToolBody`/`PostmanTool`/`NavicatTool`）去掉树后的用例更新。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 7. 非目标

- 不改主页面 `FilePreview`/`FileTree` 的对外行为（只做抽取/迁移，不改变既有项目文件的读写与显示）。
- 不做工具文件导入/导出、二进制/图片/PDF 预览（工具文件按纯文本处理）。
- 不重写 `postman` 的 curl 记录模型、`navicat` 的连接/执行/导出逻辑。
- 不改服务端路径与数据目录结构。
- 不做工具页签的完整持久化恢复（刷新不恢复属可接受降级，见 4.7）。

## 8. 实施顺序（较大重构，分三步）

1. **统一 `TreeView` + 主页面项目树迁移**（基础设施，主页面行为不回退）。
2. **工具壳子 + `notepad`/`yaml`**（含 `DocViewer` 抽取）。
3. **`postman`/`navicat`/`translate` 迁移 + 清理弹窗**。

## 9. 风险

- `FilePreview` 抽取是主风险点：靠「项目源保持原行为 + 回归测试」兜底，必要时先加测试再抽取。
- 主页项目树迁移到统一组件会影响核心体验：分步 1 单独交付并回归，再进入分步 2/3。
- 改动面广（App/TerminalView/useCenter/五个工具），建议每步独立自测（`npm.cmd test` + `typecheck` + `check:i18n`）后再进入下一步。
