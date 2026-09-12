# 设计文档：工作流编辑器增强（表单拖拽/分组 + XML 双向同步 + 实时预览）

日期：2026-09-12
分支：master
状态：待评审（已与用户确认架构方案 A、双向实时同步、全屏弹窗+标签页）

## 1. 概述

现有 `web/src/components/WorkflowEditor.vue` 已是结构化表单编辑器（工作流 → 阶段 → 提示语），
保存时 `POST /api/workflows` 由 `server/devflow-config.js:updateWorkflows` 写回活动配置 XML
（`<dataHome>/downloads/devflow.xml`）。本设计在**不改变存储与协议**的前提下增强它：

1. 全屏弹窗 + 标签页 `[表单 | XML | 预览]`。
2. 表单页支持**拖拽排序**与**分组带（group band）可视化**。
3. XML 页提供 `<workflows>` 片段的 **CodeMirror 编辑器**，与表单**双向实时同步**。
4. 预览页只读模拟终端底部工作流切换器/阶段流程/提示语 chips 的真实效果。
5. 前端**校验提示**、未保存守卫、撤销/重做、复制等易用性改进。
6. 入口从终端底部 `✎` 图标改为带文字的「编辑工作流」按钮（仅 Agent 会话可见）。

所有新增用户可见文案走 i18n（zh-CN + en）。

## 2. 现状与扩展点

- 编辑器：`web/src/components/WorkflowEditor.vue`（151 行，模态弹窗），加载 `GET /api/workflows-xml`，
  保存 `POST /api/workflows`，另有整份 XML 导入/导出（`GET/POST /api/config/xml`）。
- 终端消费：`TerminalView.vue:399 loadWorkflows()` 拉 `GET /api/workflows-xml`，`@saved` 后立即重载，
  底部渲染 `.wfbtns`（`TerminalView.vue:733`）、`.flowbar/.fgroup/.fglabel/.stage/.flowline`、
  `.chipbar/.chip`（`TerminalView.vue:740-762`）；入口按钮 `TerminalView.vue:735`。
- 服务端：`server/workflow-xml.js` 有手写 `parseWorkflowXml`/`decode`/`attr`；`server/devflow-config.js`
  有 `serializeWorkflow`/`escXml`/`validateWorkflows`/`updateWorkflows`。二者均无第三方依赖。
- 数据结构：`Workflow = { id, label, stages: [{ id, label, group, prompts: string[] }] }`。
  `group` 为可选字符串；终端按「连续且同名」聚合为分组（`TerminalView.vue:376 stageGroups`）。
- 既有双向同步先例：`CurlView.vue` 采用「以最后一次自身发出文本为基准」防回流抖动；
  「可视化 | 代码」双模式范式见 `2026-09-12-curl-yaml-visual-editors-design.md`。
- 配置热重载：`server/index.js:513 fs.watch(configFile)` 广播 `S2C.CONFIG_CHANGED`；
  `POST /api/workflows` 也会广播（`server/index.js:427-438`）。保存后无需重启后端。
- 前端已有依赖：`@codemirror/lang-xml`、`prettier`、`@devflow/shared`（工作区包）；无拖拽库。

## 3. 总体方案（方案 A，已选）

拆出纯逻辑共享模块 + 独立子组件，避免前端重复实现 XML（防漂移）。

```
shared/workflow-xml.js        新增：纯函数 XML 解析/序列化（零依赖，唯一事实源）
shared/workflow-xml.d.ts      新增：类型声明
shared/package.json           新增 exports "./workflow-xml"

server/workflow-xml.js        保留 fallbackWorkflows（i18n）；parse 从 shared re-export
server/devflow-config.js      serializeWorkflow / parse 改用 shared，删重复实现

web/src/workflowModel.ts      新增：纯逻辑（校验/分组推导/排序/复制/新建）
web/src/workflowModel.test.ts 新增：vitest

web/src/components/WorkflowEditor.vue     改造：全屏宿主 + 标签页 + 状态/同步/历史
web/src/components/WorkflowFormTab.vue    新增：表单（拖拽 + 分组带）
web/src/components/WorkflowXmlTab.vue     新增：CodeMirror XML 片段编辑
web/src/components/WorkflowPreviewTab.vue 新增：终端效果只读预览
web/src/components/TerminalView.vue       改入口按钮 + 打开宿主
```

数据流：

```
WorkflowEditor（持有 model = 单一事实源）
  ├─ WorkflowFormTab     props:model        emit:update:model
  ├─ WorkflowXmlTab      props:model        emit:update:model（解析成功时）
  └─ WorkflowPreviewTab  props:model        （只读）
保存：WorkflowEditor → POST /api/workflows { workflows: model } → 用响应回填 model
```

## 4. `shared/workflow-xml.js`（新增，纯函数）

导出：

- `Workflow`（类型）、`WorkflowStage`（类型）。
- `parseWorkflowsXml(xml) → Workflow[]`：移植 `server/workflow-xml.js` 的 `parseWorkflowXml`
  逻辑（正则扫 `<workflow>` / `<stage>` / `<prompt>`，含 `attr`/`decode`）。因为只匹配 workflow 段，
  对整份 `devflow.xml` 也成立。
- `serializeWorkflow(w) → string`：移植 `server/devflow-config.js:serializeWorkflow` 的缩进格式。
- `serializeWorkflowsFragment(workflows) → string`：输出 `<workflows>…</workflows>` 片段（供 XML 页与测试）。
- `escXml(s)`、`decode(x)`。

`server/workflow-xml.js` 保留 `fallbackWorkflows`（依赖 `./i18n.js`），`parseWorkflowXml` 改为
`export { parseWorkflowsXml as parseWorkflowXml } from '@devflow/shared/workflow-xml'`。
`server/devflow-config.js` 的 `serializeWorkflow`/`escXml` 改从 shared 引入（`serializeDevflowConfig`
仍保留，用于整份文档）。

## 5. `web/src/workflowModel.ts`（新增，纯逻辑）

- `emptyModel()` / `newWorkflow()` / `newStage()` / `newPrompt()`：生成带唯一 id 的默认项
  （id 生成沿用 `uid('wf'|'st')` 规则）。
- `groupBands(stages) → { name: string; stages: StageDef[] }[]`：按「连续同名 group」聚合
  （与终端 `stageGroups` 语义一致）。
- `moveItem<T>(arr, from, to)`、`moveStageAcrossBands(stages, fromIndex, toGroupName)`。
- `duplicateWorkflow(w)` / `duplicateStage(s)`：深拷贝并重生成 id、label 加后缀。
- `validateModel(model) → { errors: Err[]; warnings: Err[] }`：
  - error：工作流 id 空 / 重复；阶段 id 空 / 同工作流内重复。
  - warning：label 为空（服务端以 id 兜底）；提示语全为空。
  - `Err = { path: string; message: string }`。
- `sanitizeModel(model)`：过滤空提示语（对齐服务端 `validateWorkflows`）。

## 6. 双向同步算法

- 宿主由 model 派生规范 XML `canonical = serializeWorkflowsFragment(model)`（computed）。
- `WorkflowXmlTab` 内部持有可编辑文本 `text` 与 `lastEmitted` 基准（复用 CurlView 防回流模式）。
- **表单 → XML**：model 变化时，若 XML 文本未被手动改动（`text === lastEmitted`）或 XML 页未聚焦，
  则把 `text` 重置为 `canonical`。
- **XML → 表单**：输入后 **300ms 防抖** 调用 `parseWorkflowsXml`：
  - 成功：得到 next；与当前 model 做 JSON 比较，**不同才** `emit('update:model')`（防循环）；
    本回合**不回写 text**（防光标跳动）；记录 `lastEmitted = serializeWorkflowsFragment(next)`，
    使后续由该次输入产生的 model 变化不会反过来覆盖用户文本。
  - 失败：保留旧 model，仅在 XML 页顶部显示内联 `xmlError`（不阻塞表单/保存）。
- **焦点归属**：焦点在表单即由表单驱动 model；焦点在 XML 即由 XML 驱动 model；切换标签页时，
  进入 XML 若文本与基准一致则用 model 重生成，进入表单依 model 重渲染。
- **往返稳定**：`parseWorkflowsXml(serializeWorkflowsFragment(model))` 与 `model` 深度相等
  （id 已由新建逻辑生成）。服务端 `validateWorkflows` 仍可能过滤空提示语/补 id，保存后用响应回填，
  沿用现有 `WorkflowEditor.vue:41` 行为。

## 7. UI 布局与各页

### 7.1 宿主 `WorkflowEditor.vue`
- 全屏遮罩弹窗（`position:fixed; inset:0`，面板约 `94vw × 90vh`）。
- 顶部：标题 + 标签页 `[表单 | XML | 预览]` + 关闭按钮。
- 底部操作栏：消息区 + `[导入 XML | 导出 XML | 保存]`（沿用现有逻辑）。
- 关闭时若有未保存改动（`dirty`）→ i18n 确认框。
- 键盘：`Ctrl+Z` 撤销、`Ctrl+Y`/`Ctrl+Shift+Z` 重做（model 快照栈，上限 50）。

### 7.2 `WorkflowFormTab.vue`
- 工作流卡片列表，原生 HTML5 DnD 拖拽排序。
- 每卡：label 输入、id 只读展示、复制、删除。
- 阶段按 `groupBands` 渲染为「分组带」：带标题可重命名（重命名即改写组内所有阶段 `group`）；
  无 group 的阶段渲染在无名带中。
- 阶段可在带内拖拽排序，也可跨带拖拽（落到目标带即设为目标带 group）。
- 阶段行：label、上移/下移、删除；提示语列表（拖拽排序、增删、多行 textarea）。
- 校验错误以行内红字显示；顶部汇总；有 error 时禁用保存。

### 7.3 `WorkflowXmlTab.vue`
- CodeMirror（`@codemirror/lang-xml`）编辑 `<workflows>…</workflows>` 片段。
- 顶部：解析错误条（红）+「从表单刷新」按钮（canonical 覆盖文本）。
- 同步逻辑见第 6 节。

### 7.4 `WorkflowPreviewTab.vue`
- 只读模拟终端底部结构，复用终端样式类名/视觉变量：
  1. 工作流切换按钮行（当前选中态，默认第一个）。
  2. 分组 flowbar：`fglabel` + `stage` 按钮 + `flowline` 连接线 + `fgap` 组间间隔。
  3. 当前（首个）阶段提示语 chips。
- 纯展示，不触碰终端实现。

## 8. 入口改造（`TerminalView.vue`）

- `TerminalView.vue:735` 的 `✎` 按钮改为带文字的「编辑工作流」按钮（i18n `wfe.open`），
  仍位于 `.wfbtns`（Agent 会话下可见），样式沿用 `.wfbtn`。
- `WorkflowEditor` 的打开/关闭与 `@saved="loadWorkflows"` 保持不变。

## 9. i18n（中英对称，`shared/i18n/{zh-CN,en}.js`）

新增（示例，最终以实现为准，中英必须同时补齐）：

| key | zh-CN | en |
| --- | --- | --- |
| `wfe.open` | 编辑工作流 | Edit workflows |
| `wfe.tab.form` | 表单 | Form |
| `wfe.tab.xml` | XML | XML |
| `wfe.tab.preview` | 预览 | Preview |
| `wfe.drag_hint` | 拖拽调整顺序 | Drag to reorder |
| `wfe.group_rename` | 重命名分组 | Rename group |
| `wfe.duplicate` | 复制 | Duplicate |
| `wfe.undo` | 撤销 | Undo |
| `wfe.redo` | 重做 | Redo |
| `wfe.unsaved` | 有未保存的改动，确定关闭？ | Unsaved changes. Close anyway? |
| `wfe.err.dup_id` | id 重复：{id} | Duplicate id: {id} |
| `wfe.err.empty_id` | id 不能为空 | id cannot be empty |
| `wfe.write_err.empty_label` | 名称为空（将以 id 兜底） | Empty name (will fall back to id) |
| `wfe.xml_error` | XML 解析失败：{msg} | XML parse error: {msg} |
| `wfe.refresh_from_form` | 从表单刷新 | Refresh from form |

复用现有 `wfe.*`（save/import/export/saved/failed/add_*/del/new_*/label/group_label/prompt）。
提交前跑 `npm.cmd run check:i18n`。

## 10. 测试与验收

- `web/src/workflowModel.test.ts`：校验（重复/空 id、空 label 警告）、`groupBands` 聚合、
  `moveItem`/跨带移动、复制（重生成 id）、`sanitizeModel` 过滤空提示语。
- shared 往返测试（可加 `server/test/workflow-xml.test.js` 或 web 侧）：
  - `parseWorkflowsXml(serializeWorkflowsFragment(model))` 深度相等；
  - `<`/`>`/`&`/`"`/`'` 与换行转义往返；
  - 空提示语过滤；对完整 `devflow.xml` 文本解析仍得到相同 workflows。
- 命令（全绿）：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web`。
- 人工验收：
  1. Agent 会话下点「编辑工作流」→ 全屏编辑器打开。
  2. 表单拖拽排序 / 改分组名 / 跨组拖拽 → 预览页同步。
  3. XML 页改文本 → 表单页同步；改坏 → 报错且表单不变。
  4. 保存 → 终端底部工作流/阶段/提示语即时更新，无需重启。

## 11. 明确不做（YAGNI）

- 不动 legacy `WorkflowRunner`（WS `WF_LIST`/`WF_RUN`）与 `workflows.json`。
- XML 页只编辑 `<workflows>` 片段；`<server>`/`<agents>` 不在本编辑器范围
  （整份 XML 的导入/导出仍走现有按钮 `GET/POST /api/config/xml`）。
- 不引拖拽库、不引 XML 库（用原生 DnD 与现有 shared 手写解析）。
- 不改变后端工作流加载路径，不重启后端进程（沿用 `CONFIG_CHANGED` 广播 + 前端重载）。
- 不做多用户协同编辑、不做版本历史/回滚（撤销栈仅会话内）。

## 12. 决策记录

- 增强现有表单编辑器（而非独立页面 / 直接裸 XML 编辑）：用户确认。
- 双向**实时**同步（而非只读预览 / 手动应用）：用户确认。
- 布局：全屏弹窗 + 标签页：用户确认。
- 预览：模拟终端效果（只读）：用户确认。
- 架构：方案 A（shared 纯模块 + 拆组件），而非前端重复实现：用户确认。
- 入口：底部工作流栏，仅 Agent 会话，`✎` 改为带文字的「编辑工作流」按钮：用户确认。
