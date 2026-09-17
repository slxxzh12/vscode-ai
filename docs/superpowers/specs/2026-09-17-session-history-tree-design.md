# 设计文档：历史面板「全部会话」会话两级目录 + 点击恢复会话

日期：2026-09-17
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

现状：左侧历史面板的「消息」页有「仅当前会话 / 全部会话」两个筛选按钮（`web/src/components/HistoryList.vue:125-128`，`hist.filter.on/off`）。选「全部会话」时所有会话的消息**平铺**混在一起，看不出消息属于哪个会话，也没法从历史直接回到某个会话。

本设计把「全部会话」视图改成**按会话的两级目录**：

1. 一级 = 会话（列出历史消息里出现过的所有会话）；
2. 二级 = 该会话的消息内容（点击一级行展开/折叠）；
3. 一级行尾「打开」按钮 → 右侧终端**恢复/切换**到该会话（在跑的直接切；已退出/不在内存的按服务端账本重新拉起）。

同时修复多 agent（opencode + nga.cmd 等）场景下会话恢复的三个已知问题：opencode 会话 id 发现错配、无续会话能力时静默丢上下文、多个会话抢占同一对话。

核心约束（已与用户逐条确认）：

| # | 决定 | 取值 |
|---|------|------|
| 1 | 落点 | 仅改「全部会话」视图；「仅当前会话」保持现有平铺不变；两个筛选按钮都保留 |
| 2 | 一级目录范围 | **历史消息里出现过的会话**（消息里存了 `sessionId`/`tabName`）；不读账本全量 |
| 3 | 二级内容 | 该会话的历史消息（复用现有消息行渲染 + 日期分隔） |
| 4 | 一级行交互 | 点整行 = 展开/折叠二级消息；行尾单独「打开」按钮 = 恢复/切到右侧终端 |
| 5 | 已退出/不在内存 | 点「打开」时按服务端账本重新拉起（复用启动恢复逻辑 + 新增接口） |
| 6 | 无 `sessionId` 的消息 | 按 `tabName` 合成一组；「打开」按钮禁用 |
| 7 | 无续会话能力 | 退化重开原 agent 命令，并在用户主动打开时提示「未找到可续对话」 |
| 8 | 抢占同一对话 | 若目标 `agentSessionId` 已被别的活跃会话占用 → 只切过去不重建（防串台） |
| 9 | opencode 发现 | 增加「已认领 id」排除 + 发现串行化，消除同目录多会话错配 |
| 10 | 其它 agent 续接 | 文档化 `resumeCmd`/`resumeDiscover` 配置（模板加注释 + `docs/learn/` 指南），真值由用户填 |

## 2. 现状与落点

- 会话列表只在顶部页签出现（`web/src/components/TerminalView.vue:950-964`）；历史面板只有消息/文件两个页签，没有会话列表。
- 点页签 → `onTabClick` → `terminal.switchTo(sid)` → `C2S.START`（`web/src/useTerminal.ts:122`）→ 服务端 `setActive` + 重放回滚（`server/ws-gateway.js:90-97`）；**已退出的会话 START 会报 `exited` 错**（`ws-gateway.js:93`），所以不能直接用它做「恢复」。
- 消息模型 `HistoryMessage { text, ts, sessionId?, tabName? }`（`web/src/useMessageHistory.ts:6`），落盘于 `/api/history`（`server/http-api.js` 侧 `message-history`）。
- 消息筛选纯函数 `filterMessages`（`web/src/msgFilter.ts:38-49`）：`filterOn=false`（全部会话）时不过滤，原样返回。
- 会话账本 `server/session-ledger.js`：`<数据目录>/ports/<端口>/sessions.json` + `session-logs/<id>.log`，上限 30 条；条目含 `id/name/projectId/cwd/kind/agentId/agentCmd/agentSessionId/state`。
- 启动恢复 `server/session-restore.js`：逐条 `create({ id, name, ..., replay })` + `markRestored`；agent 会话延迟注入 `buildResumeCommand() || agent.cmd || rec.agentCmd`。
- 续会话适配器 `server/agent-resume.js`：
  - `buildResumeCommand`（8-20）：`resumeCmd`（可含 `{id}`）优先；opencode 内建 `opencode --session <id>`；否则 `null`。
  - `discoverAgentSessionId`（54-66）：`resumeDiscover` 优先；opencode 内建 `opencode session list --format json -n 30` + `pickOpencodeSession`。
  - `pickOpencodeSession`（29-42）：按 `directory === cwd` + `created ∈ [since-60s, now+60s]` 取最接近 `since` 的 id，**无去重/认领**。
- 发现调度 `server/index.js:195-214` `scheduleAgentDiscovery`：`onCreated` 后 15s/60s 各跑一次；只检查本会话是否已有 `agentSessionId`，**无全局认领协调**。
- agent 配置解析 `server/devflow-config.js:57-60,81-82` 已支持 `resumeCmd`/`resumeDiscover`，无需改动。
- `SessionSummary` 类型：`shared/index.d.ts:17`、`web/src/useTerminal.ts:5`。

## 3. 前端

### 3.1 `web/src/sessionTree.ts`（新增，纯函数，单一职责：消息 → 会话树）

```ts
export interface SessionNode {
  key: string;               // sessionId | `name:<tabName>` | '__unknown__'
  label: string;             // 展示名
  sessionId: string | null;  // 可恢复才有值
  messages: HistoryMessage[]; // 倒序（最新在前）
}
export function buildSessionTree(messages: HistoryMessage[]): SessionNode[]
```

- 分组键：有 `sessionId` → `sessionId`；否则有 `tabName` → `name:<tabName>`；都无 → `__unknown__`。
- 展示名：该组**最新一条**的非空 `tabName`；否则 `sessionId`；否则 i18n `hist.tree.unknown`（由调用方注入文案，保持纯函数不依赖 i18n）。
- 排序：组间按组内最新消息 `ts` 倒序；组内消息倒序。
- `sessionId === null` 的组不可恢复（UI 禁用「打开」）。

### 3.2 `web/src/components/HistoryList.vue`

- 新增 props：`liveSessionIds?: string[]`（当前 running 的会话 id，用于状态点）。
- 新增 emit：`(e: 'open-session', sessionId: string)`。
- 渲染条件：`tab === 'messages' && filter === false` → 渲染树；否则维持现有平铺。
- 一级行（`.tnode`）：`▸/▾` 折叠箭头 + 状态点 + 显示名 + 条数徽标 + 行尾「打开」按钮。
  - 状态点：`sessionId` 在 `liveSessionIds` → `running` 样式；否则灰（可恢复/已关闭）。
  - 点整行 = toggle 展开（组件内 `ref(Set<string>)`，默认全折叠）；点「打开」= `emit('open-session', sessionId)`（`@click.stop`）。
  - 「打开」**仅在该组无 `sessionId` 时禁用**；有 `sessionId` 时一律可点（是否在 `liveSessionIds` 只影响状态点样式，点击都走服务端恢复/切换）。
- 二级：复用现有 `.mrow` 消息行 + `.daysep` 日期分隔；点消息 = `emit('open-message', text)`；`×` = `emit('remove-message', msg)`。
- 搜索：query 先过滤消息；若某组**显示名命中** query，则整组消息保留（否则只看命中消息）；命中逻辑沿用现有 `match()`。
- 分页：按**展平后**的可见消息计 `PAGE=50`，滚动加载；`hasMore`/`noMatch`/空态文案复用现有键。
- 折叠状态不持久化（刷新即全折叠）。

### 3.3 `web/src/useTerminal.ts`

- `SessionSummary` 增加 `resumed?: boolean`。
- 新增 `restoreSession(id: string): Promise<SessionSummary | null>`：
  - `send(C2S.RESTORE, { sessionId: id })`，用**独立** `restoreResolve` 等待 `SESSION_CREATED`；
  - 收 `ERROR`（`restore-failed`）→ resolve `null`（`state.error` 已由现有分支写入）；
  - 不乐观设置 `activeSessionId`（避免失败后指向不存在的会话）；成功后由 `SESSION_CREATED` 分支设置。
- 不新增 `SESSION_RESTORED` 消息类型，复用 `SESSION_CREATED`。

### 3.4 `web/src/App.vue`

- 给 `HistoryList` 传 `:live-session-ids="liveSessionIds"`（`terminal.state.sessions` 中 `state==='running'` 的 id）。
- `@open-session="openHistorySession"`：
  ```ts
  async function openHistorySession(sid: string) {
    const s = await terminal.restoreSession(sid);
    if (s && s.restored && s.kind === 'agent' && s.resumed === false) notify(t('hist.tree.fresh_agent'));
  }
  ```
  （`notify` 用现有提示机制；恢复成功后 `activeSessionId` 变化，`TerminalView.vue:768` 的 watcher 自动激活中心页签。）
- 提示**仅**在用户主动打开时触发；启动期自动恢复不弹。

## 4. 协议与服务端

### 4.1 协议

- `shared/index.js` + `shared/index.d.ts`：`C2S` 增加 `RESTORE: 'restore'`。
- `SessionSummary`（`shared/index.d.ts:17`）增加 `resumed?: boolean`。
- 不新增 `S2C` 类型：恢复成功复用 `SESSION_CREATED`（`{ session }`）+ `REPLAY`；失败用 `ERROR`（`code:'restore-failed'`，`message` 为 reason）。

### 4.2 `server/agent-resume.js`（Fix 2）

- `pickOpencodeSession(items, { cwd, since, slackMs, now, exclude })`：`exclude` 为 id 集合（`Set`/数组），命中的项直接跳过。
- `discoverAgentSessionId({ agent, cwd, since, run, exclude })`：透传 `exclude` 给 `pickOpencodeSession`。

### 4.3 `server/index.js`（Fix 2 + 接线）

- 发现串行化：模块内 `let discoveryQueue = Promise.resolve()`，每次发现链到队列尾部执行，避免并发读到同一份旧 `claimed` 集合。
- `scheduleAgentDiscovery` 回填前重新读账本，构造
  `exclude = new Set(账本中 id !== 本会话且 agentSessionId 非空的 id)`，再调用 `discoverAgentSessionId({ ..., exclude })`。
- 新增 `isAgentSessionIdTaken(agentSessionId, exceptDevflowId)`：扫描当前 `sessionManager` 在跑会话对应账本记录，返回是否已被**其它**会话占用。
- 新增 `findLiveByAgentSessionId(agentSessionId, exceptDevflowId)`：返回占用该对话的在跑会话（或 null）。
- 新增 `restoreSessionById(sid)`：
  ```
  在跑会话存在        → { ok:true, session, redirected:false }
  账本无该 id         → { ok:false, reason:'not-found' }
  agentSessionId 被占 → { ok:true, session: owner, redirected:true }
  其它                → await restoreRecord(...) → { ok:true, session, redirected:false }
  失败                → { ok:false, reason }
  ```
- `createGateway({ ..., restoreSessionById })`。

### 4.4 `server/session-restore.js`（Fix 1）

- 抽出并导出：
  ```js
  export async function restoreRecord({ ledger, sessionManager, agents, logger,
    rec, resumeDelayMs = 1500, exists = fs.existsSync, isAgentSessionIdTaken = () => false })
  // → { session, resumed: boolean }；失败抛出
  ```
  - 复用现有 `create({ id, name, ..., replay: ledger.readLog(rec.id) })` + `markRestored`。
  - 续会话命令 `cmd`：
    - `agent = agents.find(a => a.id === rec.agentId)`；
    - `resumeCmd = rec.kind === 'agent' ? buildResumeCommand({ agent, agentSessionId: rec.agentSessionId }) : null`；
    - **占用检测**：`rec.agentSessionId && isAgentSessionIdTaken(rec.agentSessionId, rec.id)` → `resumeCmd = null`（不抢对话）；
    - `cmd = resumeCmd || (agent && agent.cmd) || rec.agentCmd || null`；
    - `resumed = !!resumeCmd`。
  - 写入 `session.resumed = resumed`（运行时字段，不入账本）；`resumed` 时延迟 `resumeDelayMs` 后 `sessionManager.write(id, cmd + '\r')`。
- `restoreSessions` 改为循环调用 `restoreRecord`，并传 `isAgentSessionIdTaken`（由调用方基于「已恢复/在跑」会话构造），行为与结果结构（`{ restored, skipped }`）保持不变。
- `SessionManager.summary()`（`server/session-manager.js:60-64`）增加 `resumed: s.resumed === true ? true : undefined`。

### 4.5 `server/ws-gateway.js`

- `createGateway` 入参增加 `restoreSessionById = null`。
- `C2S.RESTORE`：
  ```js
  case C2S.RESTORE: {
    const r = await restoreSessionById?.(msg.sessionId);
    if (!r || !r.ok) { conn.send({ type: S2C.ERROR, code: 'restore-failed', message: r?.reason || 'restore-failed' }); break; }
    sessionManager.setActive(r.session.id, conn);
    conn.send({ type: S2C.SESSION_CREATED, session: sessionManager.summary(r.session) });
    replay(conn, r.session);
    break;
  }
  ```
  （`handleMessage` 需支持 `await`；当前为同步函数，改为 `async` 并在 `ws.on('message')` 中 `void handleMessage(...)`，内部 catch 兜底。）
- 保留现有 `C2S.START` 行为不变（`switchTo` 仍走 START）。

## 5. 配置与文档（Fix 3）

- `config/devflow.xml`：在 `<agents>` 上方加 XML 注释，说明 `resumeCmd`（含 `{id}` 占位）与 `resumeDiscover`（stdout 去空白即 id）的语义，并给 `claudecode`/`nga` 示例（占位，不含真值/密钥）。**agent 标签本身不加属性**，新装行为不变。
- 新增 `docs/learn/agent续会话配置.md`：
  - opencode 内建适配器（发现规则 + `opencode --session <id>`）；
  - 其它 agent 的 `resumeCmd`/`resumeDiscover` 配法与验证方法；
  - 风险：多会话同目录、`--continue` 类命令的串台；
  - 说明**活动配置在 `<数据目录>/ports/<端口>/downloads/devflow.xml`**，改仓库模板只影响新装实例。
- 不改 `server/devflow-config.js`（解析/序列化已支持）。

## 6. i18n

新增词条（`shared/i18n/zh-CN.js` + `en.js`，键集合对称）：

| key | zh-CN | en |
|---|---|---|
| `hist.tree.open` | 打开 | Open |
| `hist.tree.open_title` | 恢复/切换到该会话 | Restore/switch to this session |
| `hist.tree.count` | {n} 条 | {n} |
| `hist.tree.unknown` | 未知会话 | Unknown session |
| `hist.tree.restore_failed` | 恢复失败：{reason} | Restore failed: {reason} |
| `hist.tree.fresh_agent` | 未找到可续对话，已重开会话 | No resumable conversation found; reopened the session |

提交前 `npm.cmd run check:i18n` 必须零命中（代码注释/日志除外）。

## 7. 边界情况

- **组只有 `tabName`、无 `sessionId`**：正常展开看消息，「打开」禁用。
- **消息里出现但账本已淘汰（>30 条）或已被 kill**：点「打开」→ `ERROR restore-failed: not-found` → 前端提示 `hist.tree.restore_failed`，不影响其它会话。
- **目标 `agentSessionId` 被活跃会话占用**：`restoreSessionById` 返回占用者 → 前端切到占用者（不重建），树里被点的那条仍是关闭态。
- **agent 配置缺失（agent 被删/改名）**：`agent=null` → 退化为 `rec.agentCmd`；`resumed=false`，用户主动打开时提示。
- **发现未完成前重启**：`agentSessionId=null` → 退化重开，`resumed=false`。
- **同目录多个 opencode 会话**：`exclude` + 串行化后不再错配；若都被认领则本次不认领，退化为重开。
- **`restoreSessionById` 重建期间原 exited 会话仍在内存**：`sessionManager.create` 以相同 id 覆盖 Map 条目（旧对象 pty 已为 null，无泄漏）；**不走 `kill`**，避免 `removed` 事件误删账本与回滚文件。
- **多端同时点「打开」**：服务端按序处理；第二个请求命中「在跑」分支，只切换不重建。
- **恢复失败不影响启动**：`restoreSessions` 逐条 catch，沿用现有 `skipped` 语义。
- **折叠状态**：仅内存，不持久化。

## 8. 测试与验证

- `web/src/sessionTree.test.ts`（新增）：按 `sessionId` 分组；无 `sessionId` 回退 `tabName`；两者都无归 `__unknown__`；组间/组内倒序；显示名取最新 `tabName`。
- `web/src/components/HistoryList.test.ts`（扩展）：`tab=messages && filter=false` 渲染树；点行展开/折叠；「打开」emit `open-session`；无 `sessionId` 组按钮禁用；`filter=true` 仍走平铺。
- `web/src/useTerminal.test.ts`（扩展）：`restoreSession` 发 `C2S.RESTORE`；收 `SESSION_CREATED` resolve 且带 `resumed`；收 `ERROR restore-failed` resolve `null`。
- `server/test/agent-resume.test.js`（扩展）：`pickOpencodeSession` 的 `exclude` 生效；全部被排除返回 `null`。
- `server/test/session-restore.test.js`（扩展）：`restoreRecord` 正常续接 `resumed=true`；无 id / 被占用 → 退化 `agent.cmd` 且 `resumed=false`；`restoreSessions` 结果结构不变。
- `server/test/ws-gateway.test.js`（扩展）：`RESTORE` 四态——在跑直接切、账本重建回 `SESSION_CREATED`+`REPLAY`、`not-found` 回 `ERROR`、被占用切到占用者。
- `server/test/session-manager.test.js`（扩展）：`summary()` 带 `resumed`。
- 命令：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 9. 影响面

- 新增：`web/src/sessionTree.ts`、`web/src/sessionTree.test.ts`、`docs/learn/agent续会话配置.md`、本设计文档。
- 修改：`web/src/components/HistoryList.vue`、`web/src/App.vue`、`web/src/useTerminal.ts`、`shared/index.js`、`shared/index.d.ts`、`server/agent-resume.js`、`server/session-restore.js`、`server/session-manager.js`、`server/ws-gateway.js`、`server/index.js`、`config/devflow.xml`、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`。
- 新增运行时字段：`SessionSummary.resumed`（仅内存/WS，不入账本）。
- 不改：`void.db`、`session-projects.json`、账本文件格式、协作子系统、打包脚本。

## 10. 不做（明确排除）

- 「仅当前会话」视图的改动（保持平铺）。
- 一级目录读取账本全量会话（只列历史消息里出现过的会话）。
- 为 nga/claudecode 硬编码续会话命令（由 XML 配置）。
- 会话树的折叠状态持久化、拖拽分组、自定义会话分组/标签。
- 启动期自动恢复弹提示（只在用户主动「打开」时提示）。
- 端到端自动化测试（沿用现有单测 + 手工验证）。
