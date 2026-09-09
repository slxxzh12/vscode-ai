# 设计文档：群聊 + @ 远程 opencode 执行

日期：2026-09-09
分支：statistic
状态：已评审通过，待编写实施计划
前置：`docs/superpowers/specs/2026-09-09-collab-groups-skill-distribution-design.md`（协作子系统基础，本设计在其之上扩展）

## 1. 概述

在已完成的协作子系统（P2P 好友/群组/skill 分发）之上，新增 **群聊** 与 **@ 远程执行**：

- 群内成员可直接聊天。
- `@某人 /command 文本`：向**被 @ 成员的目标机器**发起远程任务，目标机新开 `opencode run "<文本>"` 一次性执行。
- 任意群成员可发起；目标机**每次弹确认**才执行，除非 command 命中目标机本地**白名单**（命中免确认、@ 即执行）。
- 执行**结果回传群里**，所有人可见。
- 离线成员上线后**可补拉历史**。

已确认架构：**方案 1 —— 复用现有 collab 签名信封 / store / 隔离目录模式扩展**，不引入新服务或长连接网格。

## 2. 数据模型

### 2.1 store 扩展（collab.json）

```json
{
  "chatMessages": [
    { "id", "groupId", "kind": "text|cmd-result|system",
      "fromId", "text",
      "toId": null,
      "meta": { "reqId": null, "exitCode": null, "stderr": null, "durationMs": null },
      "ts", "seq" }
  ],
  "commandAllowlist": ["deploy", "git status"]
}
```

- `kind`：
  - `text`：纯聊天 / @ 提及文本（`toId` 指向被 @ 成员，可为 null）。
  - `cmd-result`：远程执行结果记录。`text` 存 stdout（截断后）；`meta.reqId` 关联请求；`meta.exitCode` 退出码；`meta.stderr` 存 stderr（截断后）；`meta.durationMs` 执行耗时。
  - `system`：系统提示（如"X 拒绝了远程执行"、"消息未送达"）。
- `seq`：**每机独立单调递增**（断点续传补历史，避免同毫秒并列，沿袭会话排序教训）。
- `id`：UUID。`ts`：毫秒。
- 本地权威 + P2P 增量补拉，与群成员表一致。
- 历史本地 cap：每群最近 500 条（超限裁最旧）。

### 2.2 目标机待确认队列

```json
"pendingCmds": [
  { "id", "groupId", "fromId", "text", "reqSeq", "receivedAt" }
]
```
（不入 CHAT 历史；确认/拒绝后移除。）

## 3. 消息类型（扩展 shared/collab.js 的 CollabPeer）

```
CHAT_SEND   聊天/@ 消息投递（payload: groupId, toId|null, text, seq）
CMD_REQ     远程执行请求（payload: groupId, text, toId, seq, reqId）
CMD_CONFIRM 目标机确认/拒绝（payload: reqId, groupId, fromId, approve: boolean, reason?）
CMD_RESULT  执行结果回传（payload: reqId, groupId, toId, stdout, stderr, exitCode, meta）
CHAT_PULL   离线补拉：请求某群自 lastSeq 起的消息（payload: groupId, afterSeq）
```

响应（HTTP 信封应答里回 data）：CHAT_PULL 返回 `{ messages: [...] }`（按 seq 升序，截断阈值内）。

## 4. 流程

### 4.1 纯聊天
```
A 输入文本（无 @命令）→ 本机落 CHAT(text) → 逐群成员 POST CHAT_SEND
每个成员：验签 → 校验发送者是同群成员 → 落本地历史 → 本机 /ws 推浏览器追加消息
```

### 4.2 @ 远程执行
```
A 输入 "@B /command 帮我跑一下测试"
1. 解析：发起端（UI）解析出 toId=B, commandText="帮我跑一下测试"
   （通过 @ 下拉选择成员，避免依赖字符串正则猜测）
2. A 本机落 CHAT(text, toId=B)（UI 高亮 @B，群里可见）
3. A 向 B 单独 POST CMD_REQ { groupId, text, toId:B, reqId }
4. B 验签 → 同群校验通过 → 判断白名单：
   - 命中 → 自动 approve，进入第 5 步
   - 未命中 → 存 pendingCmds → 本机 /ws 推浏览器「收到远程执行请求」
     B 用户点「允许/拒绝」→ B 回 POST CMD_CONFIRM
     拒绝 → 群里落 system「B 拒绝了」；结束
5. B spawn `opencode run "<text>"`（cwd/超时/截断见 §5）
6. 完成后 B 回 POST CMD_RESULT { stdout/stderr/exitCode } 给群（CHAT_SEND 语义，
   各成员落 cmd-result 历史）
```

### 4.3 离线补拉
```
C 上线 → 向任一在线群成员 POST CHAT_PULL { groupId, afterSeq: 本地该群最后 seq }
对方回 { messages } → C 校验/追加到本地（按 seq 去重）
```

## 5. 执行与安全

- spawn：`opencode run "<text>"`，一次性非交互。
- cwd：可配置，默认本机 devflow 首个项目 root 或用户主目录；env `OPENCODE_ALLOW_CWD` 覆盖。
- 超时：默认 300s（`OPENCODE_RUN_TIMEOUT_MS`），超时 kill 并回 CMD_RESULT(timeout)。
- 输出截断：默认 200KB（`OPENCODE_RESULT_MAX_BYTES`），超出加省略标记。
- spawn 失败 / opencode 不存在 → CMD_RESULT { exitCode: -1, stderr }。
- 白名单 `commandAllowlist: string[]`：`text.startsWith(p)` 命中即自动执行。
- 每次非白名单命令都必须手动确认（无"记住本次会话"）。
- 鉴权：CHAT_SEND / CMD_REQ / CMD_RESULT / CHAT_PULL 走现有签名信封；接收方校验发送者为同群成员（`_knownProfile` + 群成员表）。只能 @ 群内已有成员；群外人不能发起。
- 执行是整条交给 opencode，devflow 侧不开 shell 通道；白名单 + 手动确认是双层防线。

### 错误处理表
| 情形 | 处理 |
|---|---|
| 目标机离线 | CMD_REQ 投递失败 → 发起方本地落 system「未送达」；目标机上线 CHAT_PULL 可见该请求文本但不自动执行 |
| 目标机拒绝 | CMD_CONFIRM(deny) → 群落 system「被拒绝」 |
| 命令超时/被杀 | CMD_RESULT(timeout/killed) |
| opencode 不存在 | CMD_RESULT(spawn-error) |

## 6. 前端 UI

### 6.1 入口与布局
- `GroupsView.vue` 点群名 → 进入群详情；新增群详情内**聊天视图**（消息流 + 输入框为主区），成员/角色/邀请/踢人保留（可折叠）。
- 新增组件 `web/src/collaboration/GroupChatView.vue`。

### 6.2 消息流
- 消息气泡：文本 / **@某人**（蓝字高亮，点击回填 @名）/ cmd-result（等宽代码块 + 退出码徽章）/ system。
- 自动滚动到底。
- 发送者用户名 + 时间 + 角色色。

### 6.3 输入
- 输入 `@` 弹群成员下拉（用户名），选择回填 `@用户名 `。
- `text` 以 `/command ` 开头 → 要求含 `@某人`；否则本地提示「先 @ 一个群成员再发命令」。
- 纯文本直接发 CHAT_SEND。

### 6.4 待确认 UI
- 本机收到未命中白名单的 CMD_REQ → 顶部卡片「允许 @谁: <text> 执行？」→ 允许 / 拒绝。

### 6.5 WS 接线
- 引擎收到 CHAT_SEND / CMD_REQ / CMD_RESULT / CHAT_PULL 结果 → 事件 → index 层广播 `CollabS2C` 新增类型（如 `COLLAB_CHAT`）到 `gateway.conns` → 前端追加/刷新。

## 7. 测试

- server（node:test）：seq 单调、白名单命中/未命中、非白名单生成 pendingCmd、confirm 后 spawn（opencode shim 可执行文件 mock）、结果截断回传、CHAT_PULL 增量、越权（非群成员发 CMD_REQ 被拒）。
- web（vitest）：@ 下拉成员过滤、/command 校验（有 toId 才允许发命令）、cmd-result 渲染数据纯函数。
- `npm test` 全绿 + `npm run typecheck` 通过。

## 8. 明确不做（v1 范围外）

- 多群聚合聊天页、消息编辑/撤回、已读回执、富文本/图片、语音/WebRTC。
- opencode 交互式会话（仅一次性 `opencode run`）。
- 历史无限存储（本地 cap 每群 500 条）。

## 9. 隔离约束（沿用）

- 新增文件只出现在：`server/collaboration/**`、`web/src/collaboration/**`、`shared/collab.js(.d.ts)`。
- 只改最小 master 文件：`server/index.js`（事件广播扩展）、`web/src/App.vue` 已接入通讯录；若引擎方法新增仅发生在隔离目录内文件。
- 不改 `shared/index.js`、`server/ws-gateway.js`、`web/src/useTerminal.ts`、`web/src/components/*`。
- 运行时数据（collab.json 含私钥）不入库（已 gitignore）。

## 10. 实施建议（writing-plans 细化）

1. shared：CollabPeer 增 CHAT/CMD 类型 + CollabS2C 增推送类型。
2. server：store 增 chatMessages/pendingCmds/commandAllowlist + seq 助手。
3. server：engine 增 sendChat / @ 解析 / handleIncoming 分支（CHAT_SEND、CMD_REQ、CMD_CONFIRM、CMD_RESULT、CHAT_PULL）。
4. server：remote-runner（spawn opencode run：cwd/超时/截断/spawn 失败）——独立模块可测。
5. server：index.js 事件广播扩展 + http-mount 补本地 API（拉历史、确认命令、白名单管理）。
6. web：useCollab 扩展（发聊天、确认命令、拉历史、白名单）→ GroupChatView + GroupsView 接线。
7. 测试补齐 + 全量验证。
