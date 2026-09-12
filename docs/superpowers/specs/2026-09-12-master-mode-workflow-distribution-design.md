# 设计文档：开启 master 模式 + 工作流分发 + 工作流种子文件

日期：2026-09-12
分支：master
状态：待评审（已确认：仅改名现有区域、新增工作流分发、种子文件记「清单+版本号」）

## 1. 概述

1. **改名**：协作页左栏的「远程访问」区域改名为「开启 master 模式」（中英），区域内容与行为不变。
2. **工作流分发**：在既有分发器（skills/command/agent）中新增 **工作流** 资产，可打包 `devflow.xml` 的 stage 工作流并分发给群成员；接收方安装时**按 id 合并**进本机配置。
3. **工作流种子文件**：新增固定位置的种子文件，记录工作流清单（`id/label/hash/updatedAt`）与**单调版本号**；workflows 每次变化时重写清单、版本号 +1，用于识别工作流变化。

## 2. 现状与扩展点

- 远程访问区域：`web/src/collaboration/GroupView.vue:132`（标题键 `collab.remote.title`，zh「远程访问」/en「Remote access」），按钮「生成邀请链接与密码」。
- 协作页签：`CollaborationView.vue:16`（群组/任务），本次不改。
- 分发链路：`CollabEngine.listAssets/buildPackage/sendPackage`（`server/collaboration/engine.js:77-178`）→ zip 内 `skills/`、`command/`、`agent/`；接收方 `installBundleZip`（`bundle-installer.js`）解包；master 发布到 downloads 后 slave 安装走 `engine.installDownload`。
- 工作流存储：活动配置 `<dataHome>/downloads/devflow.xml` 的 `<workflows>`，唯一写入口 `server/devflow-config.js` 的 `updateWorkflows(file, workflows)`（`/api/workflows` POST 亦用它）。
- 固定配置目录：`server/data-home.js` 的 `downloadsDir()`。

## 3. 改名（最小改动）

- `shared/i18n/zh-CN.js`：`'collab.remote.title': '远程访问'` → `'开启 master 模式'`。
- `shared/i18n/en.js`：`'collab.remote.title': 'Remote access'` → `'Master mode'`。
- 其余 `remote.*` 文案保持不变（开关/链接/密码语义不变）。

## 4. 工作流种子文件 `server/workflow-seed.js`（新增）

位置：与活动配置同目录 `<dataHome>/downloads/workflows.seed.json`（由 `updateWorkflows` 的 `path.dirname(file)` 推导，随配置走）。

结构：

```json
{
  "version": 3,
  "updatedAt": 1757600000000,
  "workflows": [
    { "id": "dev", "label": "开发工作流", "hash": "sha256…", "updatedAt": 1757590000000 }
  ]
}
```

- `seedFileFor(configFile)` → `<dirname(configFile)>/workflows.seed.json`。
- `hashWorkflow(w)`：对归一化后的工作流（id/label/stages/prompts）做 sha256。
- `buildCatalog(workflows, prev)`：生成清单；`hash` 未变的条目沿用 `prev` 的 `updatedAt`，变化或新增的记为当前时间。
- `updateSeed(configFile, workflows)`：
  - 读取旧种子（不存在则 `{ version: 0, workflows: [] }`）；
  - 生成新清单；**仅当清单（id+hash 集合）发生变化**时 `version = old.version + 1`、`updatedAt = now`；否则保留原 version；
  - 原子写入种子文件，返回新种子。
- `readSeed(configFile)`：读取（缺省 `{ version: 0, updatedAt: 0, workflows: [] }`）。

**挂接**：`devflow-config.js` 的 `updateWorkflows(file, workflows)` 在写盘后调用 `updateSeed(file, list)`。这样任何工作流变更（UI 保存、分发合并）都会刷新种子与版本。

**暴露**：`server/index.js` 新增 `GET /api/workflows-seed` 返回 `readSeed(configFile)`。

## 5. 工作流分发

### 5.1 服务端
- `CollabEngine` 构造注入 `getWorkflows()` 与 `mergeWorkflows(list)`（由 `index.js` 提供，避免 collaboration 层直接依赖 `devflow-config`）。
- `listAssets()` 增加 `workflow: [{ id, name }]`（name = label）。
- `buildPackage({ skills, command, agent, workflow })`：
  - 对所选 `workflow` id，从 `getWorkflows()` 找到定义，`assertSafeRel(id)` 后写入条目 `workflow/<id>.json`（内容为归一化工作流 JSON）。
  - 与 skills/command/agent 合并为同一个 zip。
- `sendPackage`：payload 增加 `workflow: [ids]`；系统消息列出 label（`collab.sys.part.workflow`）。
- `installBundleZip({ zip, skillRoot, configRoot, installWorkflows })`：新增 `workflow/` 分支 → 解析 JSON 收集 → 调用 `installWorkflows(list)`；`counts.workflow` 计数。
- `engine.installDownload` 调用 `installBundleZip` 时传 `installWorkflows: (list) => this.mergeWorkflows(list)`。

### 5.2 `index.js` 注入
- `getWorkflows: () => loadDevflowConfig(configFile).workflows`
- `mergeWorkflows: (incoming) => { const cur = loadDevflowConfig(configFile).workflows; const byId = new Map(cur.map((w) => [w.id, w])); for (const w of incoming) byId.set(w.id, w); return updateWorkflows(configFile, [...byId.values()]); }`
  （同 id 覆盖、新 id 追加，保留接收方其它工作流；`updateWorkflows` 内部 `validateWorkflows` 校验。）

### 5.3 前端
- `web/src/collaboration/SkillDistributor.vue`：新增 `workflow` 分组与勾选（`assets.workflow`），参与 `buildPackage`。
- `web/src/collaboration/useCollab.ts`：`getAssets` 类型加 `workflow: { id: string; name: string }[]`；`buildPackage` 入参加 `workflow?: string[]`。
- 种子版本展示：`SkillDistributor` 顶部显示「工作流种子 v{version}」（数据来自 `GET /api/workflows-seed`），便于确认分发的是哪一版。

## 6. i18n

中英对称新增/修改：

| key | zh-CN | en |
| --- | --- | --- |
| `collab.remote.title` | 开启 master 模式 | Master mode |
| `collab.dist.workflow` | 工作流 workflow/（{count}） | Workflows workflow/ ({count}) |
| `collab.sys.part.workflow` | 工作流 {names} | workflows {names} |
| `collab.seed.version` | 工作流种子 v{version} | Workflow seed v{version} |

提交前 `npm run check:i18n` 通过。

## 7. 边界与取舍

- 只分发/合并 `devflow.xml` 的 stage 工作流（WorkflowEditor 那套），不含 `workflow-xml` 的 cmd-step 模板。
- 合并按 id：接收方已有同 id 工作流会被覆盖；不提供冲突交互确认（沿用现有分发的“安装即生效”风格）。
- 直推（FILE_PUSH）的 bundle 收件项仍只提供下载（既有行为）；工作流分发主要走 master 发布→downloads→安装链路。
- 种子版本在清单变化时才递增；仅时间变化不算变化。
- 种子文件与 devflow.xml 同目录；写入失败不阻断工作流写盘（best-effort，记日志）。

## 8. 测试与验收

- 单测：
  - `server/test/workflow-seed.test.js`：清单生成、hash 稳定、**变化才递增 version**、不变不递增、读写往返。
  - `server/test/devflow-config.test.js`（扩展）：`updateWorkflows` 后种子存在且 version 递增。
  - `server/test/collab-package.test.js`（扩展/新增）：`buildPackage({workflow})` 产出 `workflow/<id>.json`；`installBundleZip` 通过注入的 `installWorkflows` 合并（同 id 覆盖/新 id 追加）。
- 全量：`npm test`、`npm run typecheck`、`npm run check:i18n`、`npm run build:web` 全绿。
- 人工验收：改名生效；分发器出现工作流勾选；打包发送/发布安装后接收方 devflow.xml 新增该工作流；改动工作流后种子 version +1 且 UI 显示新版本。

## 9. 明确不做（YAGNI）

- 不改协作页签结构；不动远程访问开关/链接/密码语义。
- 不做工作流冲突合并 UI、不做版本回滚、不做增量同步（整包分发）。
- 不做 cmd-step 工作流模板的分发。

## 10. 决策记录

- 只改名现有区域、新增工作流分发：用户明确。
- 种子文件记「清单 + 单调版本号」：用户明确。
- 种子文件固定放配置目录（与 devflow.xml 同处）：沿用用户对固定存储位置的偏好。
- 合并策略按 id：保持与现有分发一致。
