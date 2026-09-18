# 设计文档：协作页签按 agent 选择 skills 目录并打包共享

日期：2026-09-18
分支：master
状态：待实现

## 1. 需求

用户原文：

> 在写作页签，打包skills，要把当前使用agent，比如claudecode,或者opencode所在目录列出来，根据是哪一个，打开哪个工具skills目录，打包，然后共享

澄清后：

- 「写作页签」= **协作页签**（`CollaborationView`，打包对话框 `SkillDistributor` 所在处），非新建页签。
- 在打包对话框里**列出所有 agent**（来自 `devflow.xml` 的 `<agents>`），每个带自己的 skills 目录路径。
- 用户**手动选一个 agent** 作为打包源，选择持久化。
- 打包与安装都用该 agent 的**真实** skills 目录；共享流程不变。

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 页签归属 | 协作页签的打包对话框，不新建 rail 入口 |
| 2 | 选择模型 | 列出所有 agent，手动选一个，选择持久化 |
| 3 | opencode skills 目录 | 真实目录 `~/.config/opencode/skills`（尊重 `DEVFLOW_OPENCODE_CONFIG`），替换现有端口级 `skills-opencode` |
| 4 | 安装目标 | 与打包源一致：落到所选 agent 的真实 skills 目录 |
| 5 | 目录映射 | 内置映射 + `devflow.xml` 的 `<agent skillsDir="…">` 覆盖；未知 agent 未配置则不可选 |
| 6 | 选择器位置 | 打包对话框（`SkillDistributor`）顶部，替换现有只读 `toolRoot` |
| 7 | 自定义目录 | 保留「自定义目录」一项（沿用现有 `custom` 逻辑，兼容老数据） |

## 3. 现状（改动前）

- 打包对话框：`web/src/collaboration/SkillDistributor.vue`
  - `onMounted` 调 `collab.getTool()`，把返回的 `info.root` 存入 `toolRoot`，仅在 `SkillDistributor.vue:116` **只读展示**。
  - 资产列表 `collab.getAssets()` → 技能/命令/Agent/工作流勾选 → `buildPackage` → `publishPackage`（`SkillDistributor.vue:59-92`）。
  - 没有任何 UI 调用 `setTool`。
- 服务端工具选择：
  - `server/collaboration/store.js:15` 默认 `tool: { kind: 'opencode', customRoot: null }`；`getTool`/`setTool` 在 `store.js:111-112`。
  - `server/collaboration/engine.js:74-87` `skillRoot()`：`custom` → 手填路径；`claudecode` → `~/.claude/skills`；否则 → `this.skillDefaultRoot`（= 端口目录）。
  - `engine.js:88-100` `configRoot() = dirname(skillRoot)`，`command/`、`agent/` 为同级目录。
  - `engine.js:102-119` `listAssets()`、`engine.js:121-199` `buildPackage()` 都通过 `skillRoot()`/`assetDir()` 取源。
- 端口数据目录：`server/port-paths.js:38` `skillsRoot: path.join(dir, 'skills-opencode')`（`dir = <dataHome>/ports/<端口>`）。
- 注入：`server/index.js:304` 传 `skillsRoot: paths.skillsRoot`。
- opencode 配置目录：`server/llm-config.js:6` `DEVFLOW_OPENCODE_CONFIG || ~/.config/opencode`。
- agent 列表来源：`server/devflow-config.js:36-76` 解析 `<agents default>` + `<agent id name cmd resumeCmd resumeDiscover statsCmd>`；`server/index.js:310` 已用 `loadDevflowConfig(configFile).workflows` 模式。
- HTTP：`server/collaboration/http-mount.js:146-151` `GET/POST /api/collab/tool`（`setTool(body.kind, body.customRoot)`）。
- 前端 API：`web/src/collaboration/useCollab.ts:117-118` `getTool`/`setTool`。
- 安装：`engine.acceptTask`（`engine.js:734`）→ `installDownload`（`engine.js:723`）→ `bundle-installer.js:15 installBundleZip({ skillRoot, configRoot, ... })`，全部经 `skillRoot()`/`configRoot()`。

**关键缺口**：opencode 的技能被装到端口目录 `<端口>/skills-opencode`，而 opencode 实际读取的是 `~/.config/opencode/skills`，分发的技能不会被 opencode 加载。

## 4. 设计

### 4.1 新模块 `server/collaboration/agent-skills.js`

单一职责：agent 描述 → skills 目录，以及目录可用性判断。

- `opencodeConfigDir()`：`process.env.DEVFLOW_OPENCODE_CONFIG || path.join(os.homedir(), '.config', 'opencode')`（与 `llm-config.js` 保持一致，抽取或复用）。
- `agentSkillsDir(agent)`：
  - `agent.id === 'opencode'`（或 `cmd` 基名为 `opencode`）→ `path.join(opencodeConfigDir(), 'skills')`
  - `agent.id === 'claudecode'`（或 `cmd` 基名为 `claudecode`）→ `path.join(os.homedir(), '.claude', 'skills')`
  - 否则若 `agent.skillsDir` 非空 → `path.resolve(agent.skillsDir)`
  - 否则 → `null`（不可选）
- `listAgentOptions({ agents, defaultId, selected })` → `[{ id, name, cmd, skillsDir, exists, selectable, selected }]`。
- `resolveSkillRoot({ selected, customRoot, agents, defaultSkillsRoot })`：
  - `selected === 'custom'` → `path.resolve(customRoot)`（空则回退默认）
  - 命中 agent → 映射目录
  - 找不到 → `defaultSkillsRoot`（端口目录，兜底，保证旧行为不崩）
- `DEVFLOW_COLLAB_SKILLS` 仍为 opencode skills 根的最高优先级覆盖（保留现有逃生口）。

### 4.2 配置解析扩展 `server/devflow-config.js`

- `parseDevflowConfig`：`<agent>` 增加解析可选 `skillsDir` 属性，写入 `agent.skillsDir`。
- `serializeDevflowConfig`：`agent.skillsDir` 存在时才输出该属性（中英对称、不污染默认模板）。
- `DEFAULT_AGENTS`（`devflow-config.js:8-13`）为 `opencode`、`claudecode` 内置映射即可，无需写死 `skillsDir`。

### 4.3 存储迁移 `server/collaboration/store.js`

- `defaultData().tool` 扩为 `{ agentId: 'opencode', customRoot: null }`。
- `_load()` 幂等迁移：旧 `tool.kind`（`opencode`/`claudecode`/`custom`）→ `tool.agentId`；`custom` 保留 `customRoot`。
- `getTool()` 返回 `{ agentId, customRoot }`；`setTool({ agentId, customRoot })` 写入并 `save()`。
- 首次运行（无 tool 记录）：`agentId` 取 `<agents default>`；由 `engine` 在构造/`getToolInfo` 时兜底决定，不在 store 里依赖 devflow 配置。

### 4.4 引擎 `server/collaboration/engine.js`

- 构造参数新增 `getAgents`（回调，返回 `{ default, list }`），`index.js` 传 `loadDevflowConfig(configFile).agents`。
- `skillRoot()` 改为：读 `store.getTool()` → `resolveSkillRoot({ selected: tool.agentId, customRoot: tool.customRoot, agents, defaultSkillsRoot: this.skillDefaultRoot })`。
- `getToolInfo()` 返回扩展结构：`{ tool, root, selected, agents: listAgentOptions(...) }`。
- `setTool({ agentId, customRoot })`：校验（`custom` 必须给路径；非 `custom` 必须是可选 agent），非法返回 `{ code: 'need-custom-root' | 'unknown-agent' | 'agent-unavailable' }`；成功 `_emit('synced', {})` 并返回 `getToolInfo()`。
- `configRoot()`/`assetDir()` 不变，自动跟随新 `skillRoot()`。
- 安装路径写入前 `fs.mkdirSync(dir, { recursive: true })`（`bundle-installer.js` 已有 `mkdir`，确认覆盖新建目录场景）。

### 4.5 HTTP `server/collaboration/http-mount.js`

- `GET /api/collab/tool`：返回 `engine.getToolInfo()`（新增 `agents`/`selected` 字段，向后兼容 `tool`/`root`）。
- `POST /api/collab/tool`：接受 `{ agentId, customRoot }`；兼容旧 `{ kind }`（映射到 `agentId`）；错误码按 4.4 转 i18n 文案返回 400。
- 其余端点（`/assets`、`/packages`、`/downloads/install`、`/tasks/:id/accept`）不改，自动走新 `skillRoot()`。

### 4.6 前端

`web/src/collaboration/useCollab.ts`：

- `getTool` 返回类型加 `agents`/`selected`。
- `setTool(agentId, customRoot?)`。

`web/src/collaboration/SkillDistributor.vue`：

- 顶部把只读 `.root` 换成 agent 选择器：
  - 每个 agent 一行：名称 + skills 目录（`code`）+ 是否存在标记；`selectable === false` 灰显不可点。
  - 「自定义目录」一行：可输入路径，回车/失焦生效。
- 选中调用 `collab.setTool(agentId, customRoot)` → 成功后重新 `loadAssets()`，并清空当前勾选。
- 勾选记忆 key 从 `collab-dist-<groupId>-<focus>` 改为 `collab-dist-<groupId>-<focus>-<agentId>`，避免不同 agent 串勾选。
- 保留种子版本行、打包/发布/下载/重新打包流程不变。

### 4.7 i18n

- 新增：`collab.dist.agent_selector`、`collab.dist.agent_custom`、`collab.dist.agent_missing`、`collab.dist.agent_unavailable`、`collab.dist.custom_root_ph`、`collab.err.unknown_agent`、`collab.err.agent_unavailable` 等。
- `collab.dist.skill_root`/`skill_root_hint` 保留或改为新选择器文案。
- 中英两文件键集合保持对称；跑 `npm.cmd run check:i18n`。

## 5. 测试与验收

- 单测：
  - `server/test/agent-skills.test.js`：opencode/claudecode/custom/未知 agent/`DEVFLOW_OPENCODE_CONFIG` 覆盖 的映射与 `selectable`。
  - `server/test/collab-tool.test.js`：`GET/POST /api/collab/tool` 新结构、旧 `{ kind }` 兼容、非法输入 400。
  - store 迁移：旧 `tool.kind` → `agentId`（可并入现有 collab store 测试）。
  - `engine.skillRoot()` 按选中 agent 返回不同目录（可用临时目录 + 注入 `getAgents`）。
  - 前端：`SkillDistributor` 选择切换后调用 `setTool` 并重载资产（vitest + mock `CollabApi`）。
- 命令：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
- 人工：
  1. 打开协作 → 群聊 → 「分发技能」→ 对话框顶部列出 opencode / claudecode（及配置的其它 agent）与各自目录。
  2. 选 opencode → 技能列表来自 `~/.config/opencode/skills`；选 claudecode → 来自 `~/.claude/skills`。
  3. 打包 → 发布 → 成员接受任务，技能落到成员所选 agent 的真实目录。
  4. 「自定义目录」填路径可正常列出与打包。
  5. 重启后端后选择仍保留。

## 6. 不做（范围外）

- 不新建「写作」页签、不改 rail/hash/`windowState`。
- 不改分发/发布/任务/应用市场的既有协议与数据表结构。
- 不修 claudecode 的 `command/agent` 子目录命名（真实为 `commands`/`agents`）——本次仅 skills 目录，`dirname(skills)` 行为保持现状。
- 不做自动目录迁移；已分发的旧包需成员重新接受才会落到新目录。
