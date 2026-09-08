# 网页版 opencode —— Web 终端 + 多会话管理 设计文档

- 日期：2026-09-08
- 状态：已评审通过（4 个设计分段均获用户确认）
- 工作目录：`D:\root\devflow\devflow`（当前为空 git 仓库）

## 1. 背景与目标

做一个「网页版 opencode」：在浏览器里跑一个**通用 Web 终端 + 多会话管理**界面，opencode 只是其中的典型用法。用户可远程访问、同时管理多个常驻会话、在项目目录树上操作、并通过右上角 **Workflow**（命令步骤编排模板）把一串命令逐条自动敲进当前会话执行。

### 产品定位（已确认）
- 通用 Web 终端 + 多会话管理；不是 opencode 专用 TUI 复刻。
- 会话**持久化、可断线重连**（类 tmux 语义）：网页/断网只影响「显示器」，会话进程与输出缓冲在服务端常驻。
- 布局参考 VS Code：左侧目录树 + 会话列表；中央终端区（顶部会话标签）；右上角 Workflow 下拉面板。

### 范围（v1 非目标）
- 不做用户账号/多用户隔离。
- 不做认证（见 §11「暂缓」），但预留实现位。
- 不做会话进程的磁盘持久化与崩溃恢复；服务重启后历史进程不自动拉起。
- 不做 E2E 测试的强要求（可选延后）。

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 后端运行时 | **Node.js ≥ 20（ESM）**，`http.createServer` + `ws`（WebSocketServer），**不使用 bun.server** |
| PTY | `node-pty`（跨平台：Windows 走 conpty，Linux 走 pty） |
| 前端 | Vue 3 + Vite + TypeScript + xterm.js（`@xterm/addon-fit`） |
| 前端依赖 | 全部本地打包，**零 CDN、零外链、零写死地址** |
| 测试 | 后端 `node:test` + 可注入 fake pty；前端 `vitest`；E2E `playwright`（v1 可选） |

## 3. 架构总览

```
web-terminal（monorepo，workspaces: server / web / shared）
├─ server/   Node 后端
│   ├─ index.js          http.createServer + WebSocketServer + upgrade
│   ├─ ws-gateway.js     连接态 ws.data、消息分发、attach/detach 时序
│   ├─ session-manager   常驻会话：pty、环形缓冲、attach/detach
│   ├─ pty-runner.js     node-pty 封装（file/args 按平台；safeWrite；alive）
│   ├─ ring-buffer.js    行对齐的环形输出缓冲
│   ├─ projects.js       项目配置 + 目录树列表 API（含路径越界防护）
│   └─ workflow-runner.js Workflow 模板存储 + 执行器（向会话注入命令）
├─ web/      Vue 3 + Vite 前端
└─ shared/   前后端共用消息协议类型
```

数据流：

```
浏览器 WS ──(create/start/input/resize/stop/kill)──▶ WS 网关 ──▶ SessionManager
                                                              │ attach → pty.onData → 扇出 ws
浏览器 ◀──(output/replay/session-created/…)── 实时增量；attach 时整段重放
```

## 4. WebSocket 协议

单条 WS 连接可持续存在；**切换会话 = 对同一条连接重发 `start`**。

连接建立时：`ws.data = { sessionId: null }`。任何会话级消息处理前先检查 `ws.data.sessionId`，为 `null` 则忽略（除 create/list）。

客户端 → 服务端：

| type | 载荷 | 说明 |
|---|---|---|
| `list` | – | 返回会话概要列表 |
| `create` | `{ cwd?, cols, rows, projectId? }` | 新建会话；回 `session-created`；随后自动 attach |
| `start` | `{ sessionId }` | attach：设 `ws.data.sessionId`，重放缓冲后转实时 |
| `input` | `{ data }` | 写入绑定会话的 pty |
| `resize` | `{ cols, rows }` | 调整绑定会话 pty 尺寸 |
| `stop` | – | detach（进程与缓冲保留） |
| `kill` | `{ sessionId }` | 结束进程并销毁会话 |
| `ping` | – | 保活 |

服务端 → 客户端：

| type | 载荷 | 说明 |
|---|---|---|
| `output` | `{ data }` | 实时 pty 增量 |
| `replay` | `{ data }` | attach 时的整段缓冲重放（自带清屏+复位前缀） |
| `session-created` | `{ session }` | create 成功 |
| `session-list` | `{ sessions }` | list 响应 |
| `session-exited` | `{ sessionId, exitCode }` | 进程自然退出（缓冲保留） |
| `error` | `{ code, message }` | 如：会话不存在 / 会话忙 / 越界 |

## 5. 会话层（Session）

```js
{
  id,            // 短 id，如 s_ab12cd
  name,          // 显示名（默认“项目名 · 启动时间”；改名不在 v1 协议，不可改）
  projectId,     // 所属项目 → 决定默认 cwd
  pty,           // node-pty 实例；进程退出后置 null
  alive: true,   // 会话级哨兵；pty exit → false，禁止再写
  ring,          // 环形缓冲实例
  clients: Set,  // 当前 attach 的 ws（v1 通常 0..1）
  cols, rows,
  cwd, exitCode?, exitTime?
}
```

- shell 选择按平台：`win32 → powershell.exe`；否则 `$SHELL || /bin/bash`。
- 会话默认 cwd = 所属项目 root（无项目时用进程 cwd）。
- `SessionManager` 用 `Map` 持有全部会话，与任何 ws 生命周期解耦。

## 6. attach / detach 规则

核心目标：**旧 handler 永远不能写到已关闭的 socket**（用户显式要求）。

- 每个 Session **只有一份** pty `onData` 处理器，做统一扇出：

```js
pty.onData = chunk => {
  ring.push(chunk);
  for (const ws of session.clients) {
    if (!wsAlive(ws)) continue;               // 连接级 alive 检查
    try { ws.send(JSON.stringify({ type: 'output', data: chunk })) }
    catch { wsAlive(ws, false) }
  }
}
```

- 扇出按 alive 过滤，而不是「每个 ws 注册一份 onData」→ 从根上避免残留 handler。
- detach / 换会话 / 前端关闭 = `session.clients.delete(ws)`；ws `close` 时同样从所有 Session.clients 移除自己。
- 前端「启动/切换终端」时：先 detach 旧会话（停旧回调、忽略旧 ws 事件），再注册新 WS 的 `onmessage/onclose` 并 attach 新会话。
- `kill` / 进程 exit 后：把该 ws 从所有会话移除；同时本会话 pty 销毁。

## 7. 三层防崩溃

针对 `ptyProcess.write` 抛 `Socket is closed` 等运行时异常（用户显式要求）：

1. **局部 try/catch**：所有 pty 写、ws 写统一走 `safeWrite` / `safeSend`，内部 try/catch 吞掉单点异常。
2. **alive 哨兵**：连接级 + 会话级各一枚。
   - 会话级：`pty.on('exit') → session.alive = false`；写 pty 前先查。
   - 连接级：`ws.close → wsAlive(ws, false)`；写 ws 前先查。
3. **全局兜底**：`process.on('uncaughtException', err => log(err))` —— 记录日志、进程不退出。

任何单条 socket 异常最多被 1 层捕获，全局兜底保证整服务不因一个连接崩溃。

## 8. 环形缓冲与重放

- 每段 pty data 追加进 `ring`；上限默认 256KB。
- 超限截断**只允许发生在行首**（找最近 `\n` 再往前裁），避免从半截转义序列开始回放。
- attach 时发送的 `replay` 内容 = `\x1b[2J\x1b[H`（清屏+归位）+ 缓冲内容；随后转入实时 `output`。
- 进程退出后缓冲仍保留（可回看），直到会话被 `kill`。

## 9. 项目与目录树

- 配置 `server/projects.json`（可用环境变量 `DEVFLOW_PROJECTS` 覆盖路径）：

```json
{ "projects": [ { "id": "devflow", "name": "devflow-server", "root": "D:\\repos\\devflow" } ] }
```

- 「当前项目」由前端维护：目录树根、新建终端默认 cwd、Workflow 作用域都跟随当前项目。
- HTTP API（暂不做认证，见 §11）：
  - `GET /api/projects`
  - `GET /api/tree?project=devflow&path=packages/api` → `{ items: [{ name, type: 'file'|'dir' }] }`，点击展开、深度由请求驱动，不整树下发。
- 路径安全：拼接后 `path.resolve` + `fs.realpath` 必须仍在该项目 `root` 内，越界返回 403（含符号链接逃逸）。

## 10. Workflow 引擎

**模板**（`server/workflows.json`，键 `workflows`）：

```json
[ { "id": "deploy", "name": "部署前端", "steps": [
    { "id": "build",   "advance": "auto",   "cmd": "npm run build" },
    { "id": "deploy",  "advance": "auto",   "cmd": "rsync -av dist/ prod:/srv/app" },
    { "id": "restart", "advance": "manual", "cmd": "pm2 restart app", "hint": "确认服务启动后点下一步" }
] } ]
```

**执行语义（已确认）**：Workflow 把命令**逐条敲进用户指定的当前会话**，像真人操作一样；推进方式 = 自动 + 手动混合。

- 运行对象：`{ runId, workflow, cur, sessionId, status: running|paused|done|aborted, stepLog[] }`。
- 运行前校验：目标会话存在、进程存活、且**当前空闲在 shell 提示符**（其 pty 没有占用 stdin 的交互进程）。不空闲 → `error: 会话忙`。
- **auto 步**：命令后追加**不可见 OSC 完成标记**再注入，如：
  ```
  npm run build; printf '\x1b]777;dfdone;run_ab12_1\x07'
  ```
  OSC 序列不渲染在屏幕上、不污染输出。runner 监听该会话 pty 输出流，匹配到唯一标记 `dfdone;run_ab12_1` 即判完成 → 自动敲下一条。若命令本身是交互式程序则不加标记。
- **manual 步**：注入命令后暂停（status=paused），Workflow 面板显示「下一步 ▶」，用户点击后注入下一条。
- 同会话内不允许两条 workflow 并发：运行中再次启动会先中止旧的。
- 每步记录 `startedAt/finishedAt/status`；出错/超时把该步输出尾部写入 stepLog，面板可展开查看。
- 命令注入统一走 `safeWrite`（遵守 alive 哨兵与 try/catch）。

## 11. 认证 —— 暂缓，但预留位

- v1 **不做认证**（用户 2026-09-08 明确决定）。
- 安全提醒：本服务可在网页上执行任意 shell 命令，等价于 root shell。部署时务必只绑 `127.0.0.1` 或内网，公网访问必须前置反代鉴权。
- 预留钩子：`index.js` 的 HTTP 中间件链与 WS `upgrade`/`connection` 处预留 `requireAuth()` 占位；后续仅需实现并接入，不改动其他模块。

## 12. 前端结构与交互

页面结构（对齐评审通过的 layout-v2 总览图）：

- `App.vue` — 顶栏：当前项目/会话名、右上角 `⚡ Workflow ▾`、运行状态指示。
- `Sidebar/` — 最左 activity rail（目录树 / 会话列表两个视图）。
- `TerminalView.vue` — xterm 实例 + 顶部会话标签条 + 「＋ 新建会话」。
- `WorkflowPanel.vue` — 右上角下拉：模板列表 → 运行 → 每步状态（▶/✓/⏸）+「下一步」。
- `useTerminal.js` composable — 封装 WS 连接、指数退避重连、attach/detach、replay 时序。

重连：断线 → UI 提示「已断开，正在重连」→ 指数退避 → 成功后对当前会话重发 `start`（服务端回放缓冲，屏幕自动恢复）。

## 13. 仓库结构与脚本

```
devflow/
├─ package.json       # workspaces: shared, server, web
├─ shared/            # 消息协议类型（前后端同源）
├─ server/            # Node 后端（ESM）
├─ web/               # Vue3 + Vite + TS 前端
├─ .gitignore         # 含 .superpowers/、node_modules/、dist/
└─ README.md          # 快速启动说明
```

根脚本：`dev:server`、`dev:web`、`test`、`typecheck`（详见实现阶段）。

## 14. 测试策略

- 后端 `node:test`，依赖注入使 SessionManager 可注入 fake pty。用例覆盖：
  - attach/detach、换会话、ws 关闭后不再写入（alive）；
  - 三层防崩溃路径；
  - 环形缓冲行对齐截断；
  - `safeWrite` 在 pty 已死时静默失败；
  - `/api/tree` 越界（含符号链接）403；
  - workflow auto/manual 推进、会话忙拒绝、同会话并发中止。
- 前端 `vitest`：composable + 协议时序（mock WebSocket）。
- E2E Playwright：可选，延后。

## 15. 记录的技术约束（用户显式要求）

1. 后端用 Node `http.createServer` + `ws`（**不用 bun.server**）；bun 仅可选作包管理器。
2. 前端不得出现写死的 CDN 地址/外链，依赖全部本地打包。
3. WebSocket 建立即初始化 `ws.data = { sessionId: null }`。
4. 每次「启动终端」新注册的 onData/回调不得写入已关闭 socket；旧 handler 必须清理。
5. `ptyProcess.write` 抛 `Socket is closed` 的三层修复：`uncaughtException` 全局兜底 + alive 标记 + pty 操作 try/catch。
