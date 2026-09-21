# 设计文档：工作流按文件存储 + Priority 排序

日期：2026-09-21
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

当前所有工作流都挤在活动配置 `devflow.xml` 的 `<workflows>` 段里（`server/devflow-config.js` 解析、`shared/workflow-xml.js` 解析/序列化）。本设计改为**每条工作流一个独立文件**，并给 workflow 加 **priority**，列表按 priority 排序：

1. 存储：`<端口数据目录>/workflows/<id>.xml`，每文件一个 `<workflow>`；
2. Priority：`<workflow priority="N">`，整数、缺省 0、**数字越大越靠前**，同值按 label、再按 id；
3. 一次性迁移：启动时把 `devflow.xml` 的 `<workflows>` 拆成单文件并删除该段；
4. 编辑器：加「当前工作流」选择，XML 页签与导入/导出都针对单个 `<workflow>` 文件。

核心约束（已与用户逐条确认）：

| # | 决定 | 取值 |
|---|------|------|
| 1 | 存储粒度 | 每个 workflow 一个文件：`<端口数据目录>/workflows/<id>.xml` |
| 2 | 迁移 | 一次性：启动时拆旧 `<workflows>` 段成单文件，并从 `devflow.xml` 删除该段 |
| 3 | priority 语义 | 整数、缺省 0、非法归 0，**数字越大越靠前**，同值按 label 再 id |
| 4 | priority 编辑 | 界面不提供输入框，只手改 `<id>.xml` 的 `priority`；界面按它排序 |
| 5 | 编辑器导入/导出 | 针对「当前工作流」的单个 `<workflow>` 文件；XML 页签也只显示当前工作流 |
| 6 | 整份配置导入/导出 | 编辑器不再提供；`/api/config/xml` 仅保留 API（server/agents） |
| 7 | 同 id 重复文件 | 按文件名排序，后者覆盖前者并告警 |

## 2. 现状与落点

- 解析/序列化：`shared/workflow-xml.js`（`parseWorkflowsXml`、`serializeWorkflow`、`serializeWorkflowsFragment`）、`shared/workflow-xml.d.ts`。
- 配置读写：`server/devflow-config.js`（`parseDevflowConfig`、`serializeDevflowConfig`、`loadDevflowConfig`、`updateWorkflows`、`resolveActiveConfigFile`、`ensureConfigFile`）。
- 接口：`server/index.js:601`（`GET /api/workflows-xml`）、`:795`（`POST /api/workflows` → `updateWorkflows`）、`:764`（`GET/POST /api/config/xml`）。
- 协作：`server/index.js:393`（`mergeWorkflows` → `updateWorkflows`）、`:383`（`getWorkflows`）、`:790`（`/api/workflows-seed`）。
- Runner：`server/index.js` 的 `WorkflowRunner({ getWorkflows: () => loadDevflowConfig(configFile).workflows })`（上一特性）。
- 端口路径：`server/port-paths.js`（`workflowsFile = workflows.json` 为遗留）。
- 前端：`web/src/workflowModel.ts`（`Workflow`/`WorkflowStage`、`sanitizeModel`、`validateModel`、`moveItem` 等）；`web/src/components/WorkflowEditor.vue`（三页签 + 导入/导出整份 `devflow.xml`）；`WorkflowXmlTab.vue`（CodeMirror 编辑 `<workflows>` 片段）；`TerminalView.vue:793`（`loadWorkflows`）。

## 3. 存储与迁移

### 3.1 路径

- `server/port-paths.js` 增加 `workflowsDir`：`<端口数据目录>/workflows`（与 `downloads/`、`void.db` 同级，端口隔离）。旧 `workflowsFile`（`workflows.json`）保留不动（遗留）。
- 文件名 = 净化 id：仅保留 `[A-Za-z0-9._-]`，其余字符替换为 `_`；结果为空或以 `.` 开头时用 `sha256(id).slice(0,12)` 兜底；写盘前用 `path.resolve` 校验仍在 `workflowsDir` 内（防穿越）。

### 3.2 文件格式

每个文件仅含一个 workflow 元素：

```xml
<workflow id="dev" label="开发工作流" priority="5">
    <stage id="design" label="需求设计" group="需求">
      <prompt>...</prompt>
    </stage>
</workflow>
```

沿用 `serializeWorkflow`（去掉 fragment 包装）与 `parseWorkflowsXml`（正则匹配任意位置的 `<workflow>`，单文件同样适用）。

### 3.3 迁移（一次性）

`workflowStore.migrateFromConfigXml()`：

1. 若 `workflowsDir` 已存在且含至少一个 `.xml` 文件 → 不迁移，返回；
2. 读 `configFile` 文本，`parseWorkflowsXml` 取得 workflows；
3. 若非空：逐个写 `workflows/<safeId>.xml`；
4. 从 `configFile` 文本里删除整个 `<workflows>...</workflows>` 块（含其内部），保留 `server`/`agents` 与其它注释，写回；
5. 无 `<workflows>` / 解析为空 → 不写文件（交由回退种子处理）。

仓库模板 `config/devflow.xml` 继续作为首启种子：`resolveActiveConfigFile` 先复制到活动配置，再走上面迁移。

## 4. 数据模型与 priority

- `shared/workflow-xml.js`：
  - `parseWorkflowsXml`：workflow 增加 `priority`（`Number(attr('priority'))`，`Number.isFinite` 否则 0）。
  - `serializeWorkflow`：输出 `priority="N"`（`N` 为有限数；缺省/0 也写出，保证可见可编辑）。
  - 新增 `sortWorkflows(list)`：按 `priority` 降序 → `label` 升序 → `id` 升序（`localeCompare`），返回新数组（不改原数组）。
- `shared/workflow-xml.d.ts` 同步类型。
- `web/src/workflowModel.ts`：`Workflow` 加 `priority?: number`；`sanitizeModel` 归一为有限整数（缺省 0）；`validateModel` 不因 priority 报错（非法仅在解析时归 0）。新增/复制 workflow（`newWorkflow`/`duplicateWorkflow`）默认 `priority: 0`。

## 5. 服务端

### 5.1 新增 `server/workflow-store.js`

```js
createWorkflowStore({ dir, configFile, seedStore = null, logger = console })
```

- `readAll()`：读 `dir` 下 `*.xml`，逐个 `parseWorkflowsXml` 取第一个 workflow；解析失败/空则跳过并 `logger.warn`；按文件名排序后合并，**同 id 后者覆盖前者并告警**；返回 `sortWorkflows(list)`。
- `writeAll(list)`：`validateWorkflows(list)` 规整 → 计算期望文件名集合 → 逐个写盘（临时文件 + rename 原子写）→ 删除不再存在的 `*.xml` → `seedStore?.update?.(list)` → 返回排序后的列表。
- `migrateFromConfigXml()`：见 3.3。
- `dir` 不存在时 `mkdirSync(recursive)`。

### 5.2 装配与接口（`server/index.js`）

- 启动时 `const workflowStore = createWorkflowStore({ dir: paths.workflowsDir, configFile, seedStore: workflowSeedStore, logger: log }); workflowStore.migrateFromConfigXml();`
- `getWorkflows`（runner 与协作引擎）改为 `() => workflowStore.readAll()`。
- `mergeWorkflows` 改为 `(incoming) => workflowStore.writeAll(mergeWorkflowList(workflowStore.readAll(), incoming))`。
- `GET /api/workflows-xml` → `{ workflows: workflowStore.readAll() }`。
- `POST /api/workflows` → `workflowStore.writeAll(body.workflows)`（沿用现有 400 校验与 `CONFIG_CHANGED` 广播）。
- `GET/POST /api/config/xml` 保留原样（整份 `devflow.xml`，仅 server/agents）。

### 5.3 `server/devflow-config.js`

- `updateWorkflows` 与 `loadDevflowConfig().workflows` 不再作为应用工作流来源（保留函数与解析能力以兼容测试/导入迁移；`parseDevflowConfig` 仍解析 `<workflows>`）。
- 迁移改为只在 store 内做，避免重复逻辑。

## 6. 前端

- `WorkflowEditor.vue`：
  - 下拉/列表选择「当前工作流」（`currentId`，默认第一个）。
  - XML 页签只显示 `serializeWorkflow(当前)`；编辑后 `parseWorkflowsXml` 回写该 workflow 到模型（按 id 替换）。
  - 「导出」：把 `serializeWorkflow(当前)` 作为 `<id>.xml` 下载（Blob，无需新接口）。
  - 「导入」：读单个文件文本 → `parseWorkflowsXml` 取第一个 workflow → 按 id 加入或覆盖模型 → 选中它。
  - 列表按 priority 排序展示（服务端已排序，前端直接显示）；显示只读 priority 徽标。
  - 移除对 `/api/config/xml` 的整份导入/导出按钮。
- `WorkflowFormTab.vue`：工作流列表沿用 `model`（已排序）；不做 priority 输入。
- `TerminalView.vue` 的 `loadWorkflows`：直接使用接口顺序（已按 priority 排），无需再排。

## 7. i18n

新增词条（`shared/i18n/zh-CN.js` + `en.js` 对称）：

| key | zh-CN | en |
|---|---|---|
| `wfe.current_workflow` | 当前工作流 | Current workflow |
| `wfe.priority` | 优先级 | Priority |
| `wfe.import_workflow` | 导入工作流文件 | Import workflow file |
| `wfe.export_workflow` | 导出当前工作流 | Export current workflow |

提交前 `npm.cmd run check:i18n` 零命中（注释/日志除外）。

## 8. 边界

- **无文件**：`readAll()` 返回空；由调用方决定回退（装配处保留：空则用 `fallbackWorkflows()` 并 `writeAll` 落盘一次，避免每次空读）。
- **单文件损坏**：跳过并告警，其余照常。
- **同 id 重复**：按文件名排序，后者覆盖前者并告警。
- **id 含非法字符**：文件名净化；workflow 元素内 `id` 仍保留原值。
- **迁移时 `devflow.xml` 无 `<workflows>`**：不写文件。
- **手动删除文件**：下次 `readAll` 即生效（重启后端，符合「改 json/xml 需重启」的既有约定）。
- **priority 非法/缺失**：按 0。

## 9. 测试与验证

- `server/test/workflow-store.test.js`（新增）：读/写/删文件、按 priority 排序、同 id 覆盖告警、单文件损坏跳过、路径穿越防护、`migrateFromConfigXml` 拆分且从 `devflow.xml` 移除 `<workflows>`（保留 server/agents）。
- `server/test/shared-workflow-xml.test.js`（扩展）：`priority` 解析/序列化往返；`sortWorkflows` 排序规则。
- `server/test/devflow-config.test.js`（调整）：`updateWorkflows` 相关用例改为 store 行为或标注保留解析。
- `web/src/workflowModel.test.ts`（扩展）：`priority` 归一、复制/新建默认 0。
- 手工验收：`npm.cmd run dev` → 看 `<端口数据目录>/workflows/*.xml` 生成；改某文件 `priority` 重启后端 → 顶栏按钮顺序变化；编辑器选当前工作流、导入/导出单文件。
- 命令：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 10. 影响面

- 新增：`server/workflow-store.js`、`server/test/workflow-store.test.js`。
- 修改：`shared/workflow-xml.js`、`shared/workflow-xml.d.ts`、`server/devflow-config.js`、`server/index.js`、`server/port-paths.js`、`web/src/workflowModel.ts`、`web/src/components/WorkflowEditor.vue`、`web/src/components/WorkflowXmlTab.vue`、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`、相关测试。
- 不改：`WorkflowRunner`/`GroupRun`（仍通过 `getWorkflows` provider 取数）、协作分发协议、`void.db`、打包脚本。

## 11. 不做（明确排除）

- 界面里编辑 priority（只手改文件）。
- 保留整份配置的导入/导出入口（`/api/config/xml` 仅留 API）。
- 把 `web/src/components/WorkflowPanel.vue` 重新挂载。
- 工作流的自动重载（改动仍需重启后端）。
- 端到端自动化测试（沿用现有单测 + 手工验证）。
