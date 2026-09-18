# 设计文档：远程访问页改为实时终端（复用 TerminalView）

日期：2026-09-18
分支：master
状态：待评审

## 1. 概述

把顶栏 `📱` 打开的手机页（`/?phone=1`，页面标题「远程访问」）从「截图 + 文本框」改为**实时遥控终端**：会话页签 + 终端黑框 + 工作流 + 输入/发送，界面逻辑**直接复用主页的 `TerminalView`**，不另写一套终端 UI。

- 入口不变：`web/src/main.ts` 用 `isPhoneEntry(location.search)` 判断，`?phone=1` 挂载 `PhoneView`，否则挂载 `App`。
- `PhoneView` 变薄：只做外壳（连 WS + 顶部截图按钮 + 状态），主体渲染 `<TerminalView phone>`。
- `TerminalView` 新增 `phone?: boolean`（默认 `false`）：手机模式下不自动建会话、不显示「＋新建会话」、无会话时显示空态提示、工作流判定改按会话自身 `kind`。
- **保留**：截图按钮（仍落盘 + commit/push `remote_coder/screen.png`）与 `messages.jsonc` 文件通道（外部/脚本写入、桌面仍接收、截图请求仍走它）。
- **移除**：手机页上的静态截图画面区（`<img>`）、旧的 `messages.jsonc` 文本框与发送按钮。

## 2. 架构与数据流

### A. 实时终端（新增）

1. `PhoneView` 自建 `useTerminal({})` + `useCenter()`，`onMounted` 调 `terminal.connect()`。
2. `useTerminal` 连 `ws(s)://<host>/ws`；`onOpen` 发 `C2S.LIST` 拉会话列表。
3. 服务端返回 `S2C.SESSION_LIST`（主机上全部会话，含 `kind`/`agentId`/`state`）。
4. `TerminalView`（`phone=true`）不自动 adopt/新建会话；页签栏由现有 `knownSessions` watcher 按会话列表列出。
5. 用户点页签 → `C2S.START { sessionId }` → `S2C.REPLAY` 回放缓冲 → `S2C.OUTPUT` 实时输出，写入 xterm。
6. 输入回车 → `C2S.INPUT { data, sessionId }`（经 composer 发送逻辑）。
7. 工作流：`GET /api/workflows-xml` 载入 `wfDefs`；`activeIsAgent` 为真时显示工作流按钮 + 阶段 + chips。

### B. 截图（保留）

1. 手机点「截图」→ `POST /api/remote-coder/message { kind:'screenshot' }`。
2. 桌面端 `/inbox` 取件 → ack → `df-remote-screen` → `captureToPngDataUrl(hostRef)` → `POST /api/remote-coder/screen`。
3. 服务端覆盖写 `remote_coder/screen.png` → `git add/commit/push`。
4. 手机端 `waitForNewScreen(prevRev)` 轮询 `/api/remote-coder/state` 拿到新 `rev` 后提示「已更新 {time}」；**不再显示图片**。

### C. 文件消息通道（保留）

`messages.jsonc` 服务端逻辑与桌面端 `/inbox` 轮询不变。手机页不再写 `message` 条目，但截图条目与外部/脚本写入的条目照旧被桌面端消费（`df-remote-send` / `df-remote-screen`）。

## 3. 前端

### 3.1 `web/src/remote-coder/PhoneView.vue`（改薄）

- 依赖：`useTerminal`、`useCenter`、`TerminalView`、`requestShot`/`waitForNewScreen`/`fetchScreenRev`（`./useRemoteCoder`）。
- 结构：
  - `header`：标题 `remote.title` + 「截图」按钮 `remote.shot` + 状态文字（`remote.shot_pending`/`remote.shot_done`/`remote.shot_timeout`）。
  - 主体：`<TerminalView :terminal :center :project-id="null" :phone="true" />`。
- 生命周期：`onMounted` 取一次 `rev` 并 `terminal.connect()`；`onBeforeUnmount` 调 `terminal.disconnect()`。
- 删除：`<img>` 画面区与 `.screen` 样式、`textarea.inp`、`.send` 按钮、`sendRemoteMessage`/`screenUrl` 的引用。
- 截图逻辑保留 `rev`（仅供 `waitForNewScreen` 判断新版本），不渲染图片。

### 3.2 `web/src/components/TerminalView.vue`（新增 `phone` 模式）

`defineProps` 增加 `phone?: boolean`，默认 `false`。`phone === true` 时：

1. **不自动建会话**：`init()` 里的 `SESSION_LIST` 处理（`pickRestoredAgent` / 复用 `agentSids` / `startAgent()`）整体跳过；`autoTried` 仍置位避免重复。
2. **隐藏新建按钮**：页签栏的 `.new`（`openNew`）加 `v-if="!phone"`。
3. **空态提示**：`term-wrap` 内叠加提示层，文案由 `phoneHintKey({ sessions, activeSessionId })` 决定（无活动会话时显示）。
4. **工作流判定**：`activeIsAgent` 在 `phone` 模式下改为 `isAgentSession(activeSession)`（按会话 `kind==='agent' || agentId` 判断），不再依赖手机 localStorage 里的 `agentSids`；桌面模式逻辑不变。
5. **composer 高度**：`phone` 模式用独立键 `devflow-composer-h-phone`，默认 `150px`；不读写桌面那份 `devflow-composer-h`。
6. **隐藏「历史」按钮**：composer `.ctools` 里的「历史」按钮加 `v-if="!phone"`（手机没有历史面板，`df-open-history` 无接收方）。

其余（终端 xterm、页签、工作流编辑器、文件预览、设置弹窗、`df-remote-*` 监听）沿用现实现，不改。

### 3.3 新增纯函数 `web/src/remote-coder/phoneMode.ts`

- `isAgentSession(session)`：`!!session && (session.kind === 'agent' || !!session.agentId)`。
- `phoneHintKey({ sessions, activeSessionId })`：`activeSessionId` 非空 → `null`；否则有 `state === 'running'` 的会话 → `'remote.pick_session'`；否则 → `'remote.no_sessions'`。

便于单测，`TerminalView` 手机模式消费这两个函数。

### 3.4 i18n（`shared/i18n/zh-CN.js` + `en.js`，中英同步）

新增：

| key | zh-CN | en |
| --- | --- | --- |
| `remote.no_sessions` | 当前没有运行中的会话，请先在桌面端打开 | No running sessions. Open one on the desktop first. |
| `remote.pick_session` | 点上方页签选择要控制的会话 | Tap a tab above to pick a session. |

清理（确认无其它引用后删除）：`remote.no_screen`、`remote.placeholder`、`remote.send`、`remote.sent`、`remote.send_failed`。

保留：`remote.title`、`remote.shot`、`remote.shot_pending`、`remote.shot_done`、`remote.shot_timeout`。

## 4. 服务端

不改动。`/api/remote-coder/*`、WS 门禁（`requireAuthWs` / access Cookie）、`messages.jsonc` 存储与 commit 全部沿用。手机连 WS 的鉴权与现有远程浏览器一致（非回环需邀请 Cookie）。

## 5. 测试与验收

- `web/src/remote-coder/phoneMode.test.ts`：`isAgentSession` 与 `phoneHintKey` 各分支。
- `web/src/remote-coder/PhoneView.test.ts`（更新）：`vi.mock` 掉 `TerminalView`，验证 ① 以 `phone=true` 渲染 `TerminalView`；② 点「截图」发 `POST /api/remote-coder/message {kind:'screenshot'}` 并提示「已更新」；③ 页面不再有 `<img>` 与文本框。
- `web/src/remote-coder/useRemoteCoder.test.ts` 不变。
- 服务端测试不变。
- 全绿：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web`。
- 人工验收（dev，端口 33333）：`/?phone=1` → 列出主机会话页签 → 点选 → 看到实时终端输出与工作流 → 输入回车发送 → 点「截图」→ `remote_coder/screen.png` 更新且 `git log` 出现 `snapshot(remote)` 提交。

## 6. 边界与取舍

- **远端手机**：需先用邀请链接（`?access=<token>`）打开过一次换取 Cookie；之后 `?phone=1` 可用。桌面 `📱` 按钮已带 access 参数。本次不新增「手机页专用链接」UI。
- **WS 断线**：沿用 `useTerminal` 自动重连（1s→10s 退避），顶部显示「重连中」。
- **手机与桌面会话独立**：服务端按连接维护活动会话，两端互不干扰；同一会话可被两端同时 attach（既有行为）。
- **无会话不新建**：手机端不主动创建会话，避免误开；要新会话请在桌面创建。
- **截图依赖桌面可见**：桌面页面隐藏/最小化时截不到图，手机端 15s 超时提示（沿用现状）。
- **手机上不可达的功能**：设置弹窗（齿轮在主页左侧栏）、文件树、文件预览、历史面板在手机页没有入口；工作流编辑器随 composer 仍在（可用）。
- **安全**：手机页能力等同远程浏览器访问（可执行命令、读写文件），沿用现有邀请有效期/密码门禁，不新增开关。

## 7. 明确不做

- 不做手机专用布局重排（横屏优化、底部安全区适配等），沿用 `TerminalView` 现有排版。
- 不新增服务端「全局最近活动会话」概念，手机不自动对齐桌面正在用的会话。
- 不改动截图 / `messages.jsonc` 服务端逻辑，不新增手机页专用链接。
- 不做多手机身份区分、不做推送/通知。

## 8. 决策记录

- 复用范围：只复用终端区（`TerminalView`），手机页仍是独立入口，不带左侧栏/文件树/项目选择（用户选择）。
- 做法：直接挂载 `TerminalView` + 新增 `phone` 模式开关（方案 A），不从 `TerminalView` 抽公共组件（方案 B）。
- 会话：不自动建、不自动选；顶部页签手动点选，无会话给提示（用户选择）。
- 截图 + `messages.jsonc` 通道与实时终端并存（用户选择）。
- 手机页只用终端 composer 输入；旧 `messages.jsonc` 文本框去掉，文件通道保留（用户选择）。
