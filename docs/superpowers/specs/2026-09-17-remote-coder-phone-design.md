# 设计文档：手机遥控（remote_coder 手机界面）

日期：2026-09-17
分支：master
状态：待评审

## 1. 概述

顶栏 `📷`（整页截图）替换为 `📱`：点击后**新开标签页**打开手机界面（`/?phone=1`）。手机界面只有两块内容——opencode 画面与下面的输入框。

- **画面**：一张固定路径的 PNG（`remote_coder/screen.png`），只在手机点「截图」时由**桌面端**截一次并覆盖写，然后 commit + push。
- **输入框**：发送的文字既写入 `remote_coder/messages.jsonc`，又送进桌面端**当前活动的 opencode 会话**（等同在桌面输入框回车）。

已与用户确认的约束：

- 手机页放在本应用内、点击顶栏按钮**新开标签页**打开；桌面界面不动。
- 消息通道双路：HTTP 为主，`messages.jsonc` 文件为兜底（人工/脚本/git 同步直接改文件也生效）。
- 消息处理：送进桌面当前活动会话 + 写入 `messages.jsonc`。
- 截图：**只在手机发起截图命令时**截一次，然后 commit。
- 图片固定同一路径、反复覆盖；提交只发生在截图命令路径（避免仓库历史膨胀）。
- 旧的「整页截图 + 唯一文件名」`📷` 功能移除。

## 2. 架构与数据流

### A. 截图（手机发起）

1. 手机 `POST /api/remote-coder/message` `{ kind: 'screenshot' }`
2. 服务端追加一条 `messages.jsonc` 条目，返回 `{ ok, id }`
3. 桌面端每 2s `GET /api/remote-coder/inbox`，拿到该未处理条目
4. 桌面端立即 `POST /api/remote-coder/ack { ids: [...] }`（认领，避免下一轮重复处理）
5. 桌面端对**终端区域**（xterm 容器）截图，`POST /api/remote-coder/screen { dataUrl }`
6. 服务端解码 PNG → **覆盖写** `remote_coder/screen.png` → `git add -- remote_coder/screen.png` → `git commit -m "snapshot(remote): screen.png" -- remote_coder/screen.png` → `git push origin HEAD`
7. 手机在等待窗口内轮询 `GET /api/remote-coder/state`（2s 一次，最多 15s）拿到新的 `rev` 后，用 `GET /api/remote-coder/screen.png?v=<rev>` 刷新 `<img>`

### B. 消息（手机发起）

1. 手机 `POST /api/remote-coder/message` `{ kind: 'message', text: '继续' }`
2. 服务端追加 `messages.jsonc` 条目
3. 桌面端下一轮 `GET /inbox` 拿到 text → 立即 `POST /ack` → 派发窗口事件 `df-remote-send` → `TerminalView.sendToActive(text)`（等同输入框回车发送）
4. 手机端（POST 已返回 200）显示「已发送」

### C. 文件兜底

外部（人/脚本/`git pull` 同步）直接往 `messages.jsonc` 追加同结构条目 —— `/inbox` **每次请求实时读文件、不做内存缓存**，因此下一次轮询即拿到，后续与 A/B 完全一致。

## 3. 文件位置与格式

目录：`<应用目录>/remote_coder/`（沿用现有快照目录；应用目录 = 仓库根 / 绿色包根，服务端已持有 `repoRoot`）。

- `remote_coder/screen.png`：固定文件名，每次覆盖；不存在时手机页显示占位文案。
- `remote_coder/messages.jsonc`：顶层数组（JSONC：允许 `//` 注释），追加写：

```jsonc
[
  // 手机点「截图」
  { "id": "c-1758000000000-a1b2", "ts": 1758000000000, "kind": "screenshot", "handled": false },
  // 手机发消息
  { "id": "m-1758000001000-c3d4", "ts": 1758000001000, "kind": "message", "text": "继续", "handled": false }
]
```

规则：

- `id`：`c-<ts>-<4位随机>`（截图）/ `m-<ts>-<4位随机>`（消息）。
- `kind`：`screenshot` | `message`；`message` 必有非空 `text`。
- `handled`：默认 `false`，桌面端处理完整批后置 `true`（服务端重写文件时按 2 空格缩进输出纯 JSON）。
- 文件不存在 → 视为空数组；解析失败（坏 JSONC / 顶层非数组）→ 抛 `bad-jsonc`，读接口返回空列表并只记日志，**不覆盖**该文件（避免吞掉内容）。

## 4. 服务端

### 4.1 新增 `server/remote-coder-store.js`（纯逻辑，`git` 可注入）

- 常量：`REMOTE_DIR = 'remote_coder'`、`SCREEN_FILE = 'screen.png'`、`MESSAGES_FILE = 'messages.jsonc'`
- `readMessages(dir)`：读 + 解析 JSONC → 数组（不存在 → `[]`；坏文件 → 抛 `bad-jsonc`）
- `appendMessage(dir, entry)`：读 → push（自动补 `id`/`ts`/`handled:false`）→ 原子写回（临时文件 + rename）
- `markHandled(dir, ids)`：命中 id 的条目置 `handled: true` 后写回；返回改动条数
- `inbox(dir)`：返回 `handled !== true` 的条目
- `saveScreen(dir, dataUrl)`：复用现有 `decodePng` 的校验（`data:image/png;base64,` + 非空）→ 覆盖写 `screen.png`，返回 `{ bytes, rev }`
- `screenRev(dir)`：`screen.png` 的 mtime+size 拼成的字符串版本号；不存在返回 `''`
- `commitScreen(repoRoot, { git })`：`git add -- remote_coder/screen.png` → `git commit -m "snapshot(remote): screen.png" -- remote_coder/screen.png` → `git push origin HEAD`；返回 `{ uploaded, reason }`，`reason ∈ '' | 'not-a-repo' | 'git-failed' | 'git-unavailable'`（沿用现有 `snapshot-store.js` 的判定口径）

### 4.2 新增 `server/remote-coder-mount.js`（挂在 `http-api.js`，避免把主文件撑大）

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| GET | `/api/remote-coder/inbox` | — | `{ entries: [...] }`（未处理条目） |
| POST | `/api/remote-coder/message` | `{ kind?, text? }` | `{ ok, id }`；`kind='message'` 时 `text` 非空、≤ 32KB |
| POST | `/api/remote-coder/screen` | `{ dataUrl }`（≤ 32MB） | `{ ok, rev, uploaded, reason }` |
| GET | `/api/remote-coder/state` | — | `{ rev }` |
| GET | `/api/remote-coder/screen.png` | `?v=`（忽略） | PNG，`Cache-Control: no-store`；无图 404 |
| POST | `/api/remote-coder/ack` | `{ ids: [...] }` | `{ ok, changed }` |

- 错误映射：`bad-image` / `bad-jsonc` / 参数缺失 → 400；其余 500。
- 写盘成功后 commit/push 失败不影响 200（仅回 `reason`），与现有快照口径一致。
- **移除** 旧 `POST /api/snapshot` 路由；`server/snapshot-store.js` 整体删除，其中 `decodePng` 等助手**迁入** `remote-coder-store.js`（旧 `snapshot-store.test.js` 同步删除，用例并入新 store 测试）。

### 4.3 访问控制

沿用现有远端访问门禁：手机（非 loopback）首次访问需带 `?access=<token>`，之后由 Cookie 维持；`/?phone=1` 与 `/api/remote-coder/*` 都不新增豁免。

## 5. 前端

### 5.1 入口

- `web/src/main.ts`：`new URLSearchParams(location.search).get('phone') === '1'` 时挂载 `PhoneView`，否则挂载 `App`（手机页**不**建立终端 WS，只做 HTTP）。
- `web/src/App.vue`：`📷` → `📱`，`onPhone()` = `window.open('<origin>/<path>?phone=1' + 现有 access 参数, '_blank')`；删除 `onSnapshot` / `snapshotting` / `snapshotMsg` / `.snap-*` 样式与相关 `top.snapshot*` 词条用法。

### 5.2 手机页 `web/src/remote-coder/PhoneView.vue`

- 顶部：标题 + 「截图」按钮 + 状态文字（等待中 / 已更新 <时间> / 超时 / 提交失败原因）。
- 中部：`<img :src="'/api/remote-coder/screen.png?v=' + rev">`；无图显示「还没有截图，点『截图』」。
- 底部：输入框 + 发送键（回车发送）；发送成功短暂提示「已发送」，失败显示原因。

### 5.3 组合式函数

- `web/src/remote-coder/useRemoteCoder.ts`（手机侧，`fetch` 可注入）：`requestShot()`、`sendMessage(text)`、`fetchState()`、`waitForNewScreen(prevRev, timeoutMs = 15000)`。
- `web/src/remote-coder/useDesktopRemoteCoder.ts`（桌面侧，`fetch`/`document` 可注入）：每 2s `GET /inbox` → **先 `POST /ack`**（拿到即认领，避免下一轮重复处理）→ 再派发：`screenshot` 条目派发 `df-remote-screen`、`message` 条目派发 `df-remote-send`（detail `{ text }`）；`document.visibilityState !== 'visible'` 时**跳过本轮且不 ack**（等页面可见后补处理）。

### 5.4 终端侧 `web/src/components/TerminalView.vue`

- 监听 `df-remote-send` → `sendToActive(text)`。
- 监听 `df-remote-screen` → `captureToPngDataUrl(hostRef)`（复用 `snapshot.ts`）→ `POST /api/remote-coder/screen`；捕获整体加 10s 超时（隐藏/最小化标签页 `requestAnimationFrame` 不触发，会失败），失败只写本地日志 —— 手机侧表现为 15s 超时提示。
- 等待首帧由 `requestAnimationFrame` 改为 `setTimeout(..., 50)` 兜底，避免后台标签页卡死。

### 5.5 i18n 词条（中英同时补齐）

| key | zh-CN | en |
| --- | --- | --- |
| `top.remote` | 手机遥控 | Remote phone |
| `remote.title` | 手机遥控 | Remote control |
| `remote.shot` | 截图 | Capture |
| `remote.shot_pending` | 等待桌面端响应… | Waiting for desktop… |
| `remote.shot_timeout` | 桌面端未响应（请保持桌面页面打开） | No response from desktop (keep the desktop page open) |
| `remote.shot_done` | 已更新 {time} | Updated {time} |
| `remote.commit_failed` | 已保存到本地（提交失败：{reason}） | Saved locally (commit failed: {reason}) |
| `remote.no_screen` | 还没有截图，点「截图」 | No capture yet — tap “Capture” |
| `remote.placeholder` | 输入消息发给当前会话… | Message the active session… |
| `remote.send` | 发送 | Send |
| `remote.sent` | 已发送 | Sent |
| `remote.send_failed` | 发送失败：{msg} | Send failed: {msg} |

删除 `top.snapshot` / `top.snapshot.saved` / `top.snapshot.savedLocal` / `top.snapshot.savedGitFailed` / `top.snapshot.failed`。

## 6. 测试与验收

- `server/test/remote-coder-store.test.js`：append/inbox/markHandled；坏 jsonc 抛错且不覆盖；`saveScreen` 连续两次写同名文件（目录里仍只有 1 个 png、内容为最后一次）；`commitScreen` 的 git 调用序列与失败 `reason`。
- `server/test/remote-coder-mount.test.js`：6 个端点的正常/400/404 分支（含 `screen.png` 无图 404、body 超限 400）。
- `web/src/remote-coder/useRemoteCoder.test.ts`：`requestShot`/`sendMessage` 的 POST 形状、`waitForNewScreen` 超时返回。
- `web/src/components/PhoneView.test.ts`：无图占位、点截图进入等待、发送成功后清空输入并提示、失败提示。
- `web/src/remote-coder/useDesktopRemoteCoder.test.ts`：screenshot/message 条目派发事件并 ack；`visibilityState !== 'visible'` 时不请求。
- 人工验收（dev，端口 33333）：点 `📱` → 新标签打开手机页 → 点「截图」→ `remote_coder/screen.png` 更新且 `git log` 出现 `snapshot(remote)` 提交 → 输入框发消息 → 桌面当前会话收到并发送、`messages.jsonc` 出现该条目且 `handled` 被回填。
- 全绿：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web`。

## 7. 边界与取舍

- **桌面页面必须可见且打开**才能在截图命令时出图；标签页隐藏/窗口最小化时浏览器暂停 `requestAnimationFrame`，捕获可能失败 → 手机侧 15s 超时提示（不重试、不排队）。
- **无当前项目 / 非 git 仓库**：图与 jsonc 照写，但不 commit（返回 `reason`，手机页提示「已保存到本地（提交失败：…）」）。
- **局域网访问**：服务端默认绑定 `127.0.0.1`；手机需 `DEVFLOW_HOST=0.0.0.0` 或 master 模式才能连上（沿用现有机制，不新增开关）。
- **多桌面标签页**：每个标签页各自轮询，同一会话可能收到重复消息；`handled` 回填只能拦住「已处理完」的条目。按「正常只开一个窗口」的约定接受该边界。
- **`messages.jsonc` 会被机器重写**：写入时按纯 JSON 序列化（仍是合法 JSONC），人工加的注释会在下一次写入时丢失。
- **仓库体积**：同一张图反复覆盖提交，每次提交仍留一份历史副本；只在截图命令时提交，频率由用户手点控制（用户已确认）。
- **消息文本**：不做富文本/附件，纯文本 ≤ 32KB；不做转义处理（原样送进终端输入）。

## 8. 明确不做

- 不做实时终端流（WS）到手机；手机只看图片。
- 不做定时自动截图；不做长截图/滚动拼接；不做图片缩放查看。
- 不做手机端消息历史列表/重发/撤回。
- 不做多会话路由（固定送当前活动会话）、不做多手机身份区分。
- 不做服务端文件 watcher（靠桌面端每 2s 的 `/inbox` 实时读文件实现兜底）。
- 不做推送被拒后的自动 `pull --rebase` 重试。

## 9. 决策记录

- 手机页在本应用内、**新开标签页**打开：用户选择（选项 2）。
- 消息双通道（HTTP 为主 + 文件兜底）：用户选择（选项 3）。
- 消息处理 = 送进当前活动会话 + 写 jsonc：用户确认。
- 截图只在手机发命令时进行，之后 commit：用户明确（不做轮询截图）。
- 图片固定同一路径反复覆盖：用户明确（「一致用一个位置，反复更新同一张图」）。
- 目录沿用应用根下 `remote_coder/`：与现有快照目录一致，避免新增目录。
- 轮询而非 WS 广播：实现更少、天然支持「外部改文件」兜底，且不新增 WS 协议常量。
