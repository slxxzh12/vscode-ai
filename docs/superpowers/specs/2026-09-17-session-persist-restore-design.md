# 设计文档：会话永久持久化与重启恢复（含 agent 上下文续接）

日期：2026-09-17
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

现状：终端会话（PTY）只活在服务端进程内存里（`server/session-manager.js` 的 `sessions` Map）。关浏览器窗口不杀会话，刷新后前端靠 `SESSION_LIST` 自动把页签恢复回来；但**一旦重启后端（含改端口重启、绿色包「重启后端」、崩溃重启），所有会话连同页签一起消失**，只剩文件页签能靠 `window-state.json` 恢复。

本设计让会话数据**永久落盘**，使得**重启后端后**：

1. 会话页签按原顺序、原名、原目录恢复；
2. 终端回滚内容（scrollback）回放出来，看起来和重启前一致；
3. **agent 会话继续上一次的对话上下文**（opencode 内建支持，其它 agent 通过配置扩展）。

核心约束（已与用户逐条确认）：

| # | 决定 | 取值 |
|---|------|------|
| 1 | 持久化范围 | 会话元数据 + 终端回滚文本**永久落盘**，端口隔离（`<数据目录>/ports/<端口>/`） |
| 2 | 恢复粒度 | 恢复页签 + 回滚历史 + **agent 对话上下文续接**（不只是外壳） |
| 3 | opencode 续接 | 内建适配器：`opencode session list --format json` 发现 id → 恢复时 `opencode --session <id>` |
| 4 | claudecode 续接 | v1 **不写死命令**：做成「按 agent 配置的适配器」，通过 XML `resumeCmd` / `resumeDiscover` 属性配置（用户之后填真值） |
| 5 | 恢复时机 | **服务端启动时急切恢复**（重建 PTY + 预填回滚 + 注入续会话命令），前端只认领，不重复创建 |
| 6 | 会话身份 | 恢复时**复用原 devflow 会话 id 与 createdAt**，保证页签身份、顺序、消息归属不变 |
| 7 | 用户主动关闭 | `kill`（关页签）即从账本删除记录与回滚文件；下次重启不再恢复 |
| 8 | 容量 | 账本上限 30 条（按 `updatedAt` LRU 淘汰）；单会话回滚文件封顶 512KB（留尾） |
| 9 | workflow 会话 | 不持久化、不恢复（`kind:'workflow'` 直接跳过；运行态本就不可恢复） |
| 10 | 与 window-restore 关系 | 本设计**修订** `2026-09-17-window-restore-design.md` 的第 12 条与 §8（原「不做 opencode 续接」） |

## 2. 现状与落点

- `server/session-manager.js:18` — 会话存内存 `Map`，`create()` 的 id 为 `s_` + 8 位随机 hex（`shortId()`），**不跨重启复用**；`list()` 按 `createdAt` 降序 + `seq` 降序。
- `server/session-manager.js:27-30` — 会话对象含 `ring`（`RingBuffer`，256KB）、`clients`、`cwd`、`projectId`、`name`、`state`、`createdAt`。
- `server/ws-gateway.js:73-118` — `C2S.LIST` 回 `SESSION_LIST`；`C2S.CREATE` 建会话并回 `SESSION_CREATED` + `REPLAY`；`C2S.START` 重放 `session.ring.content`。
- `web/src/components/TerminalView.vue:684-695` — `SESSION_LIST` 命中 `agentSids` 则绑定回固定 Agent 会话，否则 `startAgent()` 新建；`autoTried` 只做一次。
- `web/src/components/TerminalView.vue:317-355` — **agent 命令由前端自己敲进终端**（`launchAgentCmd`），服务端不知道启动了哪个 agent。
- `server/session-projects.js` — 已有 `sessionId → projectId` 映射（服务端重启后靠它归属消息），只增不删、上限 500。
- `server/json-store.js` — 通用小存储（读时归一化、写临时文件再 rename、损坏回退默认）。
- `server/port-paths.js:11-45` — 端口数据目录纯路径推导 + `ensurePortDirs`。
- `server/devflow-config.js:52-55` — `<agents>` 里每个 `<agent>` 目前只解析 `id`/`name`/`cmd`；`serializeDevflowConfig` 也只序列化这三个属性。
- `server/workflow-runner.js:102-124` — 工作流也走 `sessionManager.create()`（与 agent 会话同一条创建路径）。
- 实测：`opencode session list --format json -n 3` 输出 `{ id, title, updated, created, projectId, directory }`，`directory` 即会话目录。

## 3. 服务端

### 3.1 `server/session-ledger.js`（新增，单一职责：会话账本 + 回滚落盘）

```js
export const MAX_SESSIONS = 30;
export const MAX_LOG_BYTES = 512 * 1024;
export const KINDS = ['agent', 'shell', 'workflow'];   // workflow 仅用于识别并跳过恢复/持久化

export function normalizeLedger(input)          // 逐项校验；非法项丢弃；上限 MAX_SESSIONS
export function createSessionLedger({ file, logsDir, logger })
// → {
//     read(): { sessions: Entry[] },
//     upsert(entry): void,                       // 按 id 合并写入（幂等）
//     remove(id): void,                          // 删记录 + 删 <logsDir>/<id>.log
//     appendLog(id, chunk): void,                // 追加回滚（内存缓冲 + 脏标记）
//     flushLog(id): void,                        // 立即落盘（exit/kill/定时调用）
//     readLog(id): string | null,                // 恢复用：读回滚文本
//     flushAll(): void,
//   }
```

账本条目形状：

```json
{
  "id": "s_ab12cd34",
  "name": "◈ OpenCode",
  "projectId": "devflow",
  "cwd": "D:\\<项目根>",
  "kind": "agent",
  "agentId": "opencode",
  "agentCmd": "opencode",
  "agentSessionId": "ses_...",
  "cols": 80,
  "rows": 24,
  "createdAt": 1789614805105,
  "updatedAt": 1789646575332,
  "state": "running"
}
```

- 复用 `createJsonStore({ file, normalize: normalizeLedger, defaults: () => ({ sessions: [] }) })`。
- `appendLog` 维护每会话有界缓冲（超过 `MAX_LOG_BYTES` 截头留尾），定时（10s 有脏才写）+ `exit`/`kill` 立即 `flushLog`（临时文件 + rename）。
- `agentSessionId` 由发现适配器异步回填（§3.3）。
- `cwd` 只存运行时推导值；**不写死绝对路径到源码**，`cwd` 是数据。

### 3.2 `server/session-manager.js`（扩展）

`create()` 新增可选入参并透传：

```js
create({ projectId, cwd, name, cols, rows,
         id = null,            // 显式 id：恢复时复用原 devflow id
         kind = 'shell',       // 'agent' | 'shell' | 'workflow'
         agentId = null,
         agentCmd = null,
         createdAt = null,     // 恢复时复用原创建时间，保持排序
         replay = null })      // 恢复时预填 ring 的回滚文本
```

- `id = id || shortId()`；`createdAt = createdAt || Date.now()`。
- `replay` 非空时 `session.ring.push(replay)`（现有 `REPLAY` 机制零改动即可回放）。
- `summary()` 增加 `kind`、`agentId`、`restored`（`restored` 由恢复模块注入会话对象；续接命令由服务端注入，不下发前端）。
- 新增 `markRestored(id)`：恢复后置 `session.restored = true`。

`SessionManager` 保持「只管理 PTY 生命周期」，账本/适配器通过构造参数或事件注入，不把持久化逻辑塞进这个文件。

### 3.3 `server/agent-resume.js`（新增，单一职责：按 agent 的续会话适配器）

```js
export function buildResumeCommand({ agent, agentSessionId })
// agent: { id, cmd, resumeCmd?, resumeDiscover? }
// 返回可直接敲进终端的命令字符串；无法续接返回 null

export async function discoverAgentSessionId({ agent, cwd, since, spawnFn })
// 返回会话 id 或 null；spawnFn 可注入以便单测
```

- **内建 opencode 适配器**（当 `agentId === 'opencode'` 或 `cmd === 'opencode'` 且未配 `resumeCmd` 时生效）：
  - 发现：`spawnFn('opencode', ['session', 'list', '--format', 'json', '-n', '30'], { cwd })`，解析 JSON，筛 `directory` 等于 `cwd`（大小写/斜杠归一）且 `created` 落在 `[since - 60s, now + 60s]` 的项，取 `created` 最接近 `since` 的 `id`。
  - 续接命令：`opencode --session <id>`。
- **配置驱动适配器**（通用，供 claudecode 等）：
  - `resumeDiscover`（可选）：一条命令，stdout 去空白即会话 id；在会话 cwd 下执行；失败/空则视为无 id。
  - `resumeCmd`（可选）：续接命令模板，含 `{id}` 占位符时用发现的 id 替换；不含 `{id}` 则原样使用（如 `claudecode --continue`）。
  - 两者皆无 → 该 agent 只恢复外壳 + 回滚，不续上下文。
- `resumeDiscover` 执行的是本地 XML 配置里的命令，与 `cmd` 同信任级别；XML 属用户本机配置（不入库、无明文密钥）。

### 3.4 `server/session-restore.js`（新增，单一职责：启动时恢复编排）

```js
export async function restoreSessions({ ledger, sessionManager, agents, logger })
// → { restored: number, skipped: Array<{ id, reason }> }
```

流程：

1. `ledger.read().sessions` 逐条：
   - `cwd` 不存在 → 跳过并记 `reason:'cwd-missing'`（不删记录，用户可能挂载盘后再来）。
   - `sessionManager.create({ id, name, projectId, cwd, kind, agentId, agentCmd, createdAt, cols, rows, replay: ledger.readLog(id) })`。
2. agent 会话：取下命令 `cmd = buildResumeCommand() || agent.cmd || rec.agentCmd`（**能续则续，续不上退化为原 agent 命令**，保证 agent 自动起来）；非 null 则延迟约 1.5s 后 `sessionManager.write(id, cmd + '\r')`；最后统一 `sessionManager.markRestored(id)`（无论命令为何，都标记「已恢复」以免前端重复注入）。
3. 恢复失败逐条 catch，不阻断其它会话与整个启动。

### 3.5 接线

- `server/port-paths.js`：新增
  - `sessionsFile: path.join(dir, 'sessions.json')`
  - `sessionLogsDir: path.join(dir, 'session-logs')`
  - `ensurePortDirs` 增加 `sessionLogsDir`。
- `server/ws-gateway.js`：
  - `C2S.CREATE` 读取并透传 `kind` / `agentId` / `agentCmd`（前端在建会话时已知道要启动哪个 agent）。
  - `SESSION_CREATED` / `SESSION_LIST` 的 summary 自然带上 §3.2 新增字段。
- `server/index.js`：
  - 构造 `const ledger = createSessionLedger({ file: paths.sessionsFile, logsDir: paths.sessionLogsDir, logger: log })`。
  - `SessionManager.on('data')` → `ledger.appendLog`；`on('exit')`/`on('removed')` → `ledger.flushLog`。
  - 会话创建后（`onCreated`）对 `kind !== 'workflow'` 的会话 `ledger.upsert(...)`；`kill` 时 `ledger.remove(id)`。
  - agent 会话发现 id：`onCreated` 后异步跑 `discoverAgentSessionId`（重试 2 次，间隔 15s/60s），成功后 `ledger.upsert({ ...entry, agentSessionId })`；失败静默（下次仍可用 `--continue` 类配置兜底）。
  - 启动时机：会话管理器就绪后 `restoreSessions(...)`（**非阻塞**，`void` 调用，不拖慢服务监听与 WS）。
- `server/devflow-config.js`：
  - `parseDevflowConfig` 的 `<agent>` 解析增加 `resumeCmd`、`resumeDiscover`（缺省空串，非空才带键）。
  - `serializeDevflowConfig` 仅在属性非空时输出，旧文件不受影响。

## 4. 前端

### 4.1 协议与类型

- `shared/index.d.ts:17` 与 `web/src/useTerminal.ts:5` 两处 `SessionSummary` 同步增加 `kind?: 'agent' | 'shell' | 'workflow'`、`agentId?: string | null`、`restored?: boolean`；WS 消息 type 仍只用 `C2S`/`S2C` 常量，不新增消息类型。
- `web/src/useTerminal.ts`：`createSession()` 透传 `kind`/`agentId`/`agentCmd`；`state.sessions` 原样保留新增字段。

### 4.2 `web/src/components/TerminalView.vue`

- `createNew()` / `startAgent()` / `restartAgentForProject()` 调 `createSession()` 时带上 `kind`（有 `c.cmd` 为 `agent` 否则 `shell`）、`agentId`、`agentCmd`。
- `SESSION_LIST` 处理器（`autoTried` 分支）改为：
  1. 先找 `restored && kind === 'agent'` 的会话 → 认领为固定 Agent 页签（`agentSid`、`agentProjectId`），`switchTo`，并置 `agentCliReady = true`（**服务端已注入过续会话命令，前端不得重复注入**）。
  2. 否则退回现有逻辑（命中 `agentSids` 绑定 / 新建）。
- 非固定 Agent 的恢复会话由现有 `watch(state.sessions)` 的 `ensureSession()` 自动建页签；回滚由服务端 `REPLAY` 完成，前端无需特殊处理。

### 4.3 提示文案

- v1 **不新增用户可见文案**：恢复后的页签（原名）与服务端回滚已足够表达「会话已被恢复」，不再弹提示，因此无需新增 i18n 词条。

## 5. 边界情况

- **cwd 不存在**（盘未挂载/目录被删）：跳过该会话，不删账本；前端该页签不出现，其余正常。
- **PTY 创建失败**（agent 二进制缺失）：该条跳过并记日志，不阻断启动。
- **opencode 会话 id 没发现成功**：`resumeCmd` 为空 → 用原 agent 命令重开（自动起 agent，但不续上下文），回滚照常；用户可在其中手动 `opencode --continue`。
- **同一目录多个 agent 会话**：发现按 `created` 与 `since` 最接近匹配，且只回填一次；极端并发下可能错配，可接受（用户可手动重建）。
- **agent 恢复即续会生成的 opencode 新 session**：`--session <id>` 为继续同一 id（非 fork），不产生分叉；下一次发现回填时以原 id 为准，不覆盖。
- **用户关掉页签**：`kill` → `ledger.remove`，回滚文件一并删除，永久不再恢复。
- **进程崩溃（未走 exit 钩子）**：回滚最多丢最近一次 10s 定时刷盘窗口的内容；元数据在创建时已落盘，页签仍能恢复。
- **workflow 会话**：`kind:'workflow'` 不入账本、不恢复。
- **账本/回滚文件损坏**：`normalizeLedger` 容错回退空账本；`readLog` 失败返回 null；不阻断启动。
- **多端同时连**：恢复只在服务端启动时做一次；多端各自收到同一 `SESSION_LIST`，不重复创建。
- **前端旧版本（无新字段）**：`restored` 缺省 falsy，走旧逻辑，无破坏。
- **改端口重启**：端口隔离本就换一份数据目录，`ports/<新端口>` 无账本 → 不恢复（符合「换端口=换一份数据」的既有约定）。
- **账本上限淘汰**：超过 30 条时淘汰 `updatedAt` 最旧的记录并删其回滚文件，避免磁盘无限增长。

## 6. 测试与验证

- `server/test/session-ledger.test.js`（新增）：归一化/非法项丢弃/上限 30/`upsert` 幂等/`remove` 删记录与文件/`appendLog` 封顶留尾/`readLog` 回读/损坏回退。
- `server/test/agent-resume.test.js`（新增）：opencode 发现——注入假 `spawnFn`，验证按 `directory + 时间窗` 匹配与最接近 `created`；`buildResumeCommand` 对 `{id}` 模板替换、无 `{id}` 原样、缺 id 返回 null；配置驱动 `resumeDiscover` 失败兜底。
- `server/test/session-manager.test.js`（扩展）：显式 `id`/`createdAt` 生效且 `list()` 顺序保持；`replay` 预填 ring 后 `REPLAY` 内容含该文本；`summary` 带新字段；`markRestored`。
- `server/test/session-restore.test.js`（新增）：给定账本恢复——id/cwd/name 一致、ring 已预填、agent 会话被写入续接命令（假 PTY 捕获 write）、`workflow` 被跳过、`cwd` 缺失被跳过且不删记录。
- `server/test/ws-gateway.test.js`（扩展）：`CREATE` 带 `kind/agentId/agentCmd` 时 summary 带回；`SESSION_LIST` 含 `restored` 会话。
- `server/test/session-projects.test.js` / `port-paths.test.js`（扩展）：新增两个路径断言。
- `web/src/useTerminal.test.ts`（扩展）：`createSession` 透传新字段；收 `SESSION_LIST` 保留 `restored`/`resumeCmd`。
- 前端 `TerminalView` 认领逻辑以 `useCenter`/`useTerminal` 单测覆盖（既有测试风格），不引入组件级重测。
- 命令：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run check:i18n`。

## 7. 影响面

- 新增：`server/session-ledger.js`、`server/agent-resume.js`、`server/session-restore.js`、5 份新测试（server 4 + web 1）、本设计文档。
- 修改：`server/port-paths.js`、`server/session-manager.js`、`server/ws-gateway.js`、`server/index.js`、`server/devflow-config.js`、`web/src/useTerminal.ts`、`web/src/components/TerminalView.vue`、`shared/index.d.ts`（`SessionSummary` 类型）。
- 新增运行时数据（不入库）：`<数据目录>/ports/<端口>/sessions.json`、`session-logs/<id>.log`。
- 修订既有文档：`docs/superpowers/specs/2026-09-17-window-restore-design.md` 的第 12 条与 §8（改为：会话续接由本设计承担，window-state 仍只管文件页签）。
- 不改：`void.db` 结构、`session-projects.json` 格式、协作子系统、scheduler 存储、打包脚本（无新增运行时依赖）。

## 8. 不做（明确排除）

- 恢复过程中重建 workflow 运行态（workflow 会话不入账本）。
- 进程内热重载恢复（只在后端启动时恢复一次；不做 AC 无缝接管）。
- 跨端口/跨机器同步会话账本（仍是一个端口一份数据）。
- 远端/手机端专门的会话恢复 UI（沿用同一 `SESSION_LIST` 流程）。
- 为 claudecode 硬编码续会话命令（由 XML `resumeCmd`/`resumeDiscover` 配置，v1 留位）。
- 终端回滚的全文无损归档（封顶 512KB 留尾，非审计级日志）。
