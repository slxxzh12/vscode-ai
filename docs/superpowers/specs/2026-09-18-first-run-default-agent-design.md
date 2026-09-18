# 设计文档：首次启动选择默认 Agent

日期：2026-09-18
分支：master
状态：已与用户确认方案（待实现）

## 1. 概述

引入多 Agent 后（`opencode` / `claudecode` / `nga` / `codeagent`），新用户第一次启动时不知道默认用哪个。本设计在**首次启动**时自动弹出设置面板，让用户明确选择「默认 Agent」；选择写回服务端活动配置，全局生效、只引导一次。

需求原文（用户）：

> 第一次启动时，需要的时候弹出设置框，选择哪一个作为默认的 agent。

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 「默认 Agent」的权威源 | 服务端活动配置 `<agents default="...">`，全局生效（不再只是浏览器 localStorage） |
| 2 | 弹窗时机 | 配置中没有「已选过」标记 **且** agent 数 ≥ 2 |
| 3 | 弹窗形态 | 复用现有设置弹窗，自动打开并聚焦 / 高亮「Agent 列表」 |
| 4 | 用户关掉不选 | 下次启动继续弹，直到真正选过一次；未选前用 seed 的 `opencode` 兜底，不阻塞使用 |
| 5 | 与「无项目」引导的先后 | 先选默认 agent；选完 / 关掉设置后，再弹「添加目录」 |
| 6 | 「已选过」标记存法 | 方案 A：写进配置 `<agents default="..." chosen="1">`（单一配置源，无额外文件） |
| 7 | 设置面板「设为默认」 | 统一为全局：任何时候都写服务端 `<agents default>` + 更新本机当前项目 agentId |
| 8 | 首次选择后用量采集 | 无需重启即生效：用量上报时**动态解析**默认 agent 的 `cmd` / `statsCmd` |

## 3. 现状（改动前）

- 默认 agent 有两个来源：
  - 服务端活动配置 `<agents default="opencode">`（`server/devflow-config.js` 解析；`server/index.js` 启动时读入 `BOOT_CFG`，`defaultAgent()` 供用量采集使用；`GET /api/agents` 每次请求重新读并返回 `{ default, agents }`）。
  - 前端按项目存 localStorage（`web/src/components/TerminalView.vue` 的 `cfgKey = devflow-agent-cfg-<项目指纹>`，保存 `{ agentId, agents, wf }`）。
- 设置弹窗（`TerminalView.vue`）里「Agent 列表」每行有「设为默认」按钮，当前行为只是 `agentId = a.id`（仅本机、仅当前项目），**不写服务端**。
- 已有先例：`web/src/App.vue` 的「首次无项目自动弹添加目录弹窗」（`loadProjects()` → 无项目且未提示过 → `openAddFolder()`，`noProjectPrompted` 每页面会话一次）。
- 设置弹窗挂在 `TerminalView.vue` 内；`App.vue` 的 `openAgentSettings()` 会先把 `rail` 切回 `explorer` 再派发 `df-open-agent-settings` 事件（因此没有项目时也能打开设置）。
- 用量上报器 `server/usage-report.js` 的 `createUsageReporter({ cmd, statsCmd, ... })` 目前把 `cmd` / `statsCmd` 作为**启动时固定值**闭包使用（`reportNow()` 内 `collect({ cmd, statsCmd, days })`）。

## 4. 设计

### 4.1 服务端

**`server/devflow-config.js`**

- `parseDevflowConfig`：解析 `<agents>` 时增加 `chosen` 布尔（`chosen="1"` 为真；缺省 `false`）。返回值 `agents` 变为 `{ default, list, chosen }`。
- `serializeDevflowConfig`：`chosen` 为真时在 `<agents ...>` 开标签输出 ` chosen="1"`，否则不输出。
- `buildDefaultConfig`：`agents` 增加 `chosen: false`。
- 新增 `updateAgentsDefault(file, id)`：
  - 读取 XML，定位 `<agents ...>` 开标签；
  - 只替换/追加该标签的 `default="<id>"` 与 `chosen="1"` 两个属性，其余标签与全部内容（含注释、正文）原样保留；
  - 写法对齐现有 `updateServerAttrs`（正则定位开标签 → 拼接 → 写盘）；
  - 返回 `{ default: id, chosen: true }`。

**`server/index.js`**

- `GET /api/agents`：响应增加 `chosen`（来自 `loadDevflowConfig(configFile).agents.chosen`）。即 `{ default, agents, chosen }`。
- 新增 `POST /api/agents/default`：
  - body `{ id }`；
  - 重新读配置，校验 `id` 存在于当前 `agents.list`，否则 `400 bad-agent`；
  - 调 `updateAgentsDefault(configFile, id)`，返回 `{ ok: true, default: id }`。
- 用量采集动态化：
  - `server/usage-report.js` 的 `createUsageReporter` 新增可选 `resolveAgent`（函数，返回 `{ cmd, statsCmd }`）；`reportNow()` 每次上报时若提供则调用它取当前 `cmd` / `statsCmd`，否则回退构造时的 `cmd` / `statsCmd`（兼容现有调用与单测）。
  - `server/index.js` 传入 `resolveAgent: () => defaultAgent()`，并把 `defaultAgent()` 改为每次基于 `loadDevflowConfig(configFile)` 实时解析（替代仅用启动时 `BOOT_CFG`），使首次选择后无需重启即生效。
  - 启动日志里的 `agent bin resolved` 仍按启动时默认 agent 打印一次（可保留，作为提示）。

**`config/devflow.xml`（seed 模板）**

- `<agents default="opencode">` 不含 `chosen` → 全新实例首次启动会弹窗；老实例升级到本版本同样首次会弹一次（尚未显式选过）。

### 4.2 前端

**`web/src/App.vue`**

- 启动引导编排（`needAgentChoice` 必须先于「无项目」判断确定）：
  - 启动时先 `await` 拉取 `/api/agents`；若 `!chosen && agents.length >= 2`，置 `needAgentChoice = true`，调用 `openAgentSettings({ firstRun: true })`（扩展 `openAgentSettings` 支持透传 firstRun 细节），并**暂缓**「无项目」自动弹窗。
  - `loadProjects()` 中「无项目自动弹添加目录」改为：仅当 `!needAgentChoice` 时才弹；否则挂起，等设置关闭后再决定（顺序：agent 信息就绪 → `loadProjects()`）。
  - 监听 `window` 的 `df-settings-closed` 事件：若仍在 `needAgentChoice`（用户没选）且无项目，则 `openAddFolder()`。
- `openAgentSettings` 派发事件时带 `{ detail: { firstRun } }`。

**`web/src/components/TerminalView.vue`**

- `onOpenSettings(e)`：读取 `e.detail?.firstRun`，为真时置 `firstRunHint = true`。
- 设置弹窗「Agent 列表」区块：`firstRunHint` 时显示一行提示（新词条 `term.agent_first_run_hint`），并在 `nextTick` 后 `scrollIntoView` 到该区块（用模板 ref）。
- 「设为默认」按钮：`@click` 改为调用新方法 `setDefaultAgent(a.id)`：
  - `agentId.value = a.id`（本机当前项目，沿用现有行为）；
  - `POST /api/agents/default` `{ id }`；成功后 `firstRunHint.value = false`；
  - 失败则提示（新词条 `term.agent_set_default_failed`），不影响本地选择。
- 设置弹窗关闭（`settingsOpen` 由真变假）时，派发 `window` 事件 `df-settings-closed`（供 App 继续「无项目」引导）。

**i18n（`shared/i18n/zh-CN.js` + `en.js`，中英同步）**

- `term.agent_first_run_hint`：请选择默认 Agent / Choose the default Agent
- `term.agent_set_default_failed`：设置默认 Agent 失败：{msg} / Failed to set default Agent: {msg}

### 4.3 数据流

```
首启 → GET /api/agents { default, agents, chosen:false }
      → !chosen && agents>=2 → 打开设置弹窗(聚焦 Agent 列表)
      → 用户点「设为默认」→ POST /api/agents/default {id}
            → updateAgentsDefault 写 <agents default="id" chosen="1">
            → 前端 agentId=id（localStorage 当前项目）
      → 关闭设置 → 若仍无项目 → 弹「添加目录」
下次启动 → GET /api/agents chosen:true → 不再弹
```

### 4.4 错误处理与边界

- `POST /api/agents/default` 的 `id` 不在列表 → 400，前端提示，不改变本地选择。
- agent 仅 1 个 → 不弹（无需选择），也不写 `chosen`；若之后通过 XML 增加 agent 变 ≥2，则下次启动会弹一次（可接受）。
- 用户反复关掉设置 → 每次启动都弹，直到选过（决策 4）。
- 用户直接改 XML 删掉 `chosen` → 会重新弹，属可接受的显式操作。
- 动态解析默认 agent 后，若默认 agent 可执行文件不存在，用量采集按既有逻辑记 error（行为与现在一致）。

## 5. 影响面

| 文件 | 改动 |
| --- | --- |
| `server/devflow-config.js` | 解析/序列化 `chosen`；新增 `updateAgentsDefault` |
| `server/index.js` | `GET /api/agents` 加 `chosen`；新增 `POST /api/agents/default`；`defaultAgent()` 实时化；用量上报传 `resolveAgent` |
| `server/usage-report.js` | `createUsageReporter` 支持 `resolveAgent` 动态解析 |
| `config/devflow.xml` | seed 模板保持无 `chosen`（无需改，仅确认） |
| `web/src/App.vue` | 首启编排：先选 agent 后弹添加目录 |
| `web/src/components/TerminalView.vue` | firstRun 提示 + 滚动；「设为默认」写服务端；关闭派发 `df-settings-closed` |
| `shared/i18n/zh-CN.js` / `en.js` | 新增 2 个词条 |
| `server/test/*.test.js` | 新增/补充 `chosen`、`updateAgentsDefault`、`/api/agents/default`、`resolveAgent` 单测 |

## 6. 测试

- `server/test/devflow-config.test.js`（或新增）：`parseDevflowConfig` 解析 `chosen` 缺省 false / `chosen="1"` true；`serializeDevflowConfig` 仅 chosen=true 时输出；`updateAgentsDefault` 往返、保留注释与工作流、非法/未知 id 由上层校验。
- `server/test/usage-report.test.js`：`resolveAgent` 提供时每次上报用其返回值；未提供时回退原 `cmd`/`statsCmd`（现有断言不变）。
- `server/test/http-api.test.js` 或新增：`GET /api/agents` 含 `chosen`；`POST /api/agents/default` 合法 → 写盘并回读、非法 → 400。
- `npm.cmd run check:i18n`（词条中英对称、用户可见范围无硬编码中文）。
- `npm.cmd run typecheck`（App.vue / TerminalView.vue）。
- `npm.cmd test`（server + web 回归）。

## 7. 验证（手工）

1. 全新数据档案（清空/换端口）启动 dev：首次自动打开设置弹窗、「Agent 列表」高亮并有提示；选 `codeagent` → 关闭 → 弹「添加目录」。
2. 刷新页面：不再自动弹设置；`<活动配置>/downloads/devflow.xml` 的 `<agents>` 带 `default="codeagent" chosen="1"`。
3. 设置面板点其它 agent 的「设为默认」：配置即时更新，`GET /api/agents` 的 `default` 跟着变。
4. 用量：选完后不重启，等一次上报（或点「立即上报」）确认用新的 `cmd`/`statsCmd`。
5. 关掉设置不选 → 重启后端再开页面 → 仍会弹。
6. 只有 1 个 agent 的配置：不弹。
