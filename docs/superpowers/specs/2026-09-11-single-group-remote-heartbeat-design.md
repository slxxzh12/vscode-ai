# 设计文档：单一隐式群组 + 远程访问 + 心跳用量 + master downloads

日期：2026-09-11
分支：master
状态：待评审

## 1. 概述

当前协作子系统（`server/collaboration/*`、`web/src/collaboration/*`）是**多群 + 好友 + 成员邀请 + 角色**的 P2P 模型，流程重、入口分散；而「远程访问」能力藏在设置弹窗里（`web/src/components/TerminalView.vue`），与协作互不相通，导致跨机协作实际不可用（对端 `/api/collab/peer` 会被远程门禁拦截）。

本设计把协作收敛为**单一隐式群组**：

- 群组页签 = 远程访问开关 + 一个共享空间（聊天 / 任务 / 技能）。
- 删除「创建群组 / 好友 / 成员邀请 / 角色 / 踢人 / 解散」整套流程。
- 加入方式：**粘贴开启方的链接**，接入同一共享空间。
- hub（开启远程访问并分享链接者）作为 **master**：汇总各成员上报的 agent 用量、发布技能包，写入 `downloads/`；其它实例（slave）**仅在用户点击时**从 master 拉取，不做实时汇总推送。
- 新增心跳：成员周期性采集本机 `opencode stats` 上报 hub，hub 汇总展示各实例用量。

### 已与用户确认的约束

- 最终形态：**单一隐式群组，开启远程访问即可用**。
- **保留密码 + 有效期**（只是把入口从设置搬到群组页签，不取消安全机制）。
- 参与者：**其它 devflow 实例（P2P）**，不是浏览器访客。
- 加入方式：**粘贴开启方的链接**。
- 实现深度：**彻底重构**（删除好友/多群/角色等概念，无死代码）。
- 心跳拓扑：其它实例**上报到本机（hub）服务器汇总**；不广播。
- 心跳频率：**每 5–10 分钟随机一次**（打乱时间，避免多实例同时打点）。
- 汇总分发：写入 master 的 **`downloads/` 通用共享目录**；slave **用户点击时才拉取**，不点击不请求、不推送。
- 首批范围：**用量汇总 + 技能包改拉取**（任务/文件互传本期不动，仍走原 push）。
- master 与链路：**hub 为 master**，**服务端间**签名信封拉取，再由本地服务端转给浏览器。

## 2. 范围与排除

**做：**

- 数据模型：单例群组 + 心跳表；删除好友/多群/待处理邀请/角色。
- 服务端：`server/collaboration/{store,engine,http-mount}.js`、`server/index.js`、`shared/collab.js`。
- 远程访问门禁：`?access=<token>` 免密进、`/api/collab/peer` 豁免 Cookie 门禁。
- 心跳与 agent 用量采集：新增 `server/collaboration/agent-stats.js`、`server/collaboration/heartbeat.js`。
- master `downloads/` 共享目录（用量、成员名单、技能包）+ 点击拉取。
- 前端：设置里的远程访问整段搬到群组页签；新增 `GroupView.vue`；`useCollab.ts` 精简。
- i18n 增删（中英同步）；测试改造与新增。
- 文档：`docs/` 使用说明同步（远程/协作入口变化）。

**明确排除（非目标）：**

- 多群组、好友、邀请审批、角色/踢人/解散、按 machineId 邀请、旧签名邀请链接。
- 除 `opencode` 外的 agent 用量采集（结构预留，`agent-stats.js` 可扩展）。
- 心跳历史曲线/持久化趋势（只保留最新值）。
- 任务/文件互传改拉取（后续迭代）。
- 运行中切换 master、多 master / master 选举。
- 群组页签以外的新导航结构。

## 3. 数据模型

### 3.1 目录布局（在既有端口档案目录内）

```
<stateRoot>/
  collab.json                 # 单例群组 + 心跳 + 既有收件箱/聊天/命令
  upload/                     # 我发出的文件留档（不变）
  download/                   # 收到的 zip/文件收件箱（不变）
  downloads/                  # 新增：master 共享目录（本地缓存/权威副本）
    manifest.json
    usage.json
    group.json
    skills/<name>.zip
```

- `downloads/`（复数）为本次新增，与 `download/`（收件，单数）区分。
- master 写权威副本；slave 点击同步时把 master 的内容落到自己的 `downloads/`。

### 3.2 `collab.json`（`CollabStore`）

保留：`identity`、`skillsInbox`、`groupSkills`、`outbox`、`tool`、`chatSeq`、`chatMessages`、`pendingCmds`、`commandAllowlist`。

删除：`friends`、`pendingFriends`、`groups`（多）、`pendingInvites`、`inviteEpoch`、成员 `role`。

新增/改为单例：

```jsonc
{
  "group": {
    "id": "shared",                 // 固定单例 id，内部仍作 chat/task/skill 分区键
    "name": "<i18n collab.group.default_name>",   // 默认名走 i18n，不写死语言
    "createdAt": 1789324800000,
    "hubId": "<machineId>",         // master 的 machineId；本机为 master 时等于自身
    "members": [
      { "machineId": "...", "username": "...", "host": "192.168.1.10", "port": 22222, "publicKey": "..." }
    ]
  },
  "heartbeats": {
    "<machineId>": {
      "agent": "opencode", "days": 7,
      "sessions": 21, "messages": 3986,
      "totalCost": 4.83, "input": 8598323, "output": 1048576,
      "cacheRead": 1031798784, "cacheWrite": 0,
      "collectedAt": 1789324800000, "receivedAt": 1789324800000
    }
  }
}
```

- `group` 为 `null` 时表示尚未开启远程访问/尚未加入。
- 成员无角色，均为对等成员。
- 在线判定：`receivedAt` 在 2× 心跳上限（约 20 分钟）内视为在线。

### 3.3 `downloads/manifest.json`（master 权威）

```jsonc
{
  "version": 1,
  "updatedAt": 1789324800000,
  "files": [
    { "name": "usage.json",       "kind": "usage",   "size": 1234, "sha256": "...", "updatedAt": 1789324800000 },
    { "name": "group.json",       "kind": "group",   "size": 567,  "sha256": "...", "updatedAt": 1789324800000 },
    { "name": "skills/dev.zip",   "kind": "skill",   "size": 20480, "sha256": "...", "updatedAt": 1789324800000 }
  ]
}
```

- `name` 为相对 `downloads/` 的路径，仅允许 `[A-Za-z0-9_./-]` 且不含 `..`。
- slave 以 `sha256` 判断是否需要更新。

## 4. 远程访问与加入

### 4.1 远程访问门禁（`server/index.js`）

- 新增：非回环请求若 URL 带 `?access=<token>` 且 `safeEqual(token, activeInvite().token)` 且未过期 → 下发 `devflow-access=<token>` HttpOnly Cookie（Max-Age 同 TTL），并 302 到去掉 `access` 的同一路径。
- **豁免**：`POST /api/collab/peer` 不做 Cookie 校验，交引擎用「信封签名 + 令牌/成员校验」鉴权；其余 `/api/*`、静态页、WS 仍受门禁。
- 生成邀请（`POST /api/remote/invite`）时调用 `engine.ensureGroup()`，并返回带令牌的链接 `http://<addr>:<port>/?access=<token>`；密码 / TTL / 锁定逻辑不变。
- 注入校验钩子：`engine.verifyAccessToken = (t) => { const inv = activeInvite(); return !!inv && safeEqual(t, inv.token); }`。

### 4.2 单例群组（`server/collaboration/engine.js`）

- `ensureGroup()`：无 `group` 时创建 `{ id:'shared', name, createdAt, hubId:self, members:[self] }`。
- `verifyAccessToken` 由外部注入（见 4.1），引擎不持有门禁状态。
- `handleIncoming`：未知发送方仍以 `env.from.publicKey` 自证签名（现逻辑），随后按 `env.type` 分派；删除 friend/group-invite 分支。

### 4.3 加入（slave）

- `joinByLink({ host, port, token })`：签名 `CollabPeer.GROUP_JOIN { token }` POST 到 hub。
- hub `_inJoin(env)`：
  1. `handleIncoming` 已验证 `env.from` 签名。
  2. `verifyAccessToken(env.payload.token)` 为假 → `{ ok:false, error:'bad-token' }`。
  3. 确保本机为 master 的群组存在；把 `env.from` 去重后加入 `members`；`hubId = self`。
  4. 写 `downloads/group.json` + 更新 manifest；返回 `{ ok:true, data:{ group } }`。
  5. 向既有成员点对点发送一次 `MEMBER_SYNC`（控制面一次性同步，见 §7 例外说明）。
- slave 收到响应：`store.group = group`，`hubId = hub.machineId`，`_emit('synced')`。
- 前端把链接解析为 `{ host, port, token }`：`new URL(pasted)` → host/port 取 origin，token 取 `searchParams.get('access')`；调用本地 `POST /api/collab/join` 时提交 `{ host, port, token }`。

### 4.4 协议常量（`shared/collab.js`）

- `CollabPeer` 删除：`FRIEND_REQUEST`、`FRIEND_ACCEPT`、`GROUP_INVITE`、`GROUP_ACCEPT`。
- `CollabPeer` 保留：`GROUP_JOIN`、`MEMBER_SYNC`、`SKILL_PUSH`、`FILE_PUSH`、`PULL_SYNC`、`CHAT_SEND`、`CMD_REQ`、`CMD_CONFIRM`、`CMD_RESULT`、`CHAT_PULL`。
- `CollabPeer` 新增：`HEARTBEAT`（成员→hub 上报）、`PULL_DOWNLOADS`（slave→master 拉取）。
- `CollabS2C` 删除：`COLLAB_FRIEND_REQ`、`COLLAB_GROUP_INVITE`。
- `CollabS2C` 保留：`COLLAB_INBOX`、`COLLAB_SYNCED`、`COLLAB_CHAT`、`COLLAB_CMD_PENDING`。
- `CollabS2C` 新增：`COLLAB_HEARTBEAT`（本地拿到最新用量/名单后通知浏览器刷新）。

## 5. 心跳与 agent 用量

### 5.1 `server/collaboration/agent-stats.js`

```js
export async function collectAgentStats({ cmd = 'opencode', days = 7, timeoutMs = 20000 } = {})
// -> { agent, days, sessions, messages, totalCost, input, output, cacheRead, cacheWrite, collectedAt }
//    或 { agent, days, error }
```

- 以 `execFile(cmd, ['stats', '--days', String(days)])` 执行；命令不存在 / 非 0 退出 → 返回 `{ error }`，不影响主流程。
- 去除 ANSI 转义与框线字符后正则解析：`Sessions`、`Messages`、`Days`、`Total Cost`、`Input`、`Output`、`Cache Read`、`Cache Write`。
- 数值解析支持 `8.2M`、`983.0M`、`3,986` 等格式（K/M/B 后缀 → 整数 token；cost 保留小数）。
- 纯函数解析导出（`parseStats(text)`）便于单测，测试用真实抓取样本做 fixture。

### 5.2 `server/collaboration/heartbeat.js`

```js
export function createHeartbeat({ engine, intervalMinMs = 5*60*1000, intervalMaxMs = 10*60*1000, days = 7, cmd = 'opencode', logger })
// start(): 立即采集一次，之后每次随机 [intervalMinMs, intervalMaxMs] 的延时
// stop() / collectOnce()
```

- 仅当存在 `group` 且 `hubId !== self.machineId`（本机为 slave）时把用量签名 `HEARTBEAT` 发给 hub。
- 本机为 master 时：直接把自己的用量写入 `heartbeats` 并刷新 `downloads/usage.json`。
- 在 `server/index.js` 的 `initWorkspace()` 后启动。

### 5.3 hub 接收

- `_inHeartbeat(env)`：校验 `env.from` 为群成员；写 `store.heartbeats[from.machineId]`；刷新 `downloads/usage.json` + manifest；`_emit('heartbeat')`（本机浏览器即时看到 hub 端汇总）。
- 事件总线：`eventBus.on('heartbeat', () => broadcastCollab(CollabS2C.COLLAB_HEARTBEAT, {}))`（与既有 `synced/inbox/chat` 同样的接线方式）。
- slave 不接收心跳；slave 的用量通过 §6 点击拉取 master 的 `usage.json` 获得。

## 6. master downloads 与点击拉取

### 6.1 master 写入

- `usage.json`：`heartbeats` 汇总快照（`{ updatedAt, members: { [machineId]: usage } }`）。
- `group.json`：群组名单快照（`{ id, name, hubId, updatedAt, members:[...] }`）。
- `skills/<name>.zip`：master 发布的可分发包（见 6.4）。
- 每次写入同步更新 `manifest.json`（含 sha256/size/updatedAt）。

### 6.2 slave 拉取（点击触发）

- 触发点：打开群组页签，或点击「同步 master」按钮 → `POST /api/collab/downloads/sync`。
- `engine.pullDownloads()`：签名 `PULL_DOWNLOADS { }` POST 到 hub，hub 返回 `{ ok:true, data:{ manifest, files:[{ name, b64 }] } }`（只返回 sha256 变化的文件）。
- slave 落盘到本地 `downloads/`，更新本地 `manifest.json`，把 `group.json` 合并进 `store.group`（名单以 master 为准），`_emit('heartbeat')`/`_emit('synced')`。
- 失败（不可达 / master 离线）：保留本地缓存，前端提示，不阻塞 UI。
- 体积保护：单次响应受 `http-mount` 既有 `MAX_BODY`（64MB）约束；超出返回错误，前端提示分批（分批为后续项）。

### 6.3 本地读取/下载

- `GET /api/collab/downloads` → `{ manifest, usage, group }`（读本地缓存；master 读权威副本）。
- `GET /api/collab/downloads/file/:name` → 流式返回本地 `downloads/` 内文件（`path.basename` 防穿越）。

### 6.4 技能包改拉取

- master：`SkillDistributor` 选技能/command/agent → 复用现有 `buildPackage`/`packSkill` 产出 zip → 写入 `downloads/skills/<name>.zip` + 更新 manifest（**不再** `sendPackage` push 成员）。
- slave：点击同步后 `downloads/skills/` 出现新包；在群组页签的 downloads 列表点击「安装」→ `POST /api/collab/downloads/install { name }` → 复用 `installZip` 安装到本机技能根。
- `skillsInbox`（收件箱）保留给仍走 push 的 `FILE_PUSH` 场景（任务/文件互传本期不动）；技能包安装路径新增 downloads 入口。

## 7. 推送例外说明

「完全取消推送」针对**汇总数据**（用量、技能包、名单快照）。以下属交互/控制面，保持既有机制：

- 聊天 `CHAT_SEND`、远程执行 `CMD_REQ/CMD_RESULT`：点对点交互消息。
- 成员变更：加入/离开时 hub 向既有成员点对点发送**一次** `MEMBER_SYNC`，保证聊天可达；名单的全量快照仍以 `downloads/group.json` 为准（点击拉取时覆盖）。

## 8. 前端

### 8.1 `TerminalView.vue`

- 删除远程访问相关模板与脚本：`remoteTtl`、`remoteLink`、`remotePassword`、`remoteMsg`、`remoteState`、`loadRemote/genRemote/revokeRemote/copyRemote/copyPassword/fmtExpire`，以及 `onOpenSettings` 内的 `loadRemote()`。

### 8.2 `CollaborationView.vue`

- 子页签改为「群组」/「任务」（key 不变，文案走 i18n）。

### 8.3 新增 `collaboration/GroupView.vue`（替代 `ContactsView.vue`）

- 远程访问面板：启用/撤销、TTL 下拉、一次性密码、复制带令牌链接、需重启/锁定提示（模板与样式自 `TerminalView` 迁入）。
- 加入区：粘贴链接输入 + 接入按钮（解析 origin + `access`）。
- 成员列表：头像/用户名/`host:port`、在线状态、`opencode` 用量（Input/Output/Days/Messages，可选 Cost）。
- 命令白名单（`commandAllowlist`）迁入此处。
- 「同步 master」按钮 + downloads 列表（用量/群组/技能包；技能包提供安装）。

### 8.4 其它组件

- `GroupChatView.vue` / `TasksView.vue` / `SkillDistributor.vue`：适配单例群（`groupId` 取 `snap.group.id`，群名查 `snap.group.name`）。
- `SkillDistributor.vue`：master 显示「发布到 downloads」，slave 显示「从 master 拉取」。
- 删除 `JoinInviteCard.vue`。
- `App.vue`：移除 `?invite=` 卡片与 `inviteCollab`/`onInviteJoined`。

### 8.5 `useCollab.ts` / `types.ts`

- 删除：`requestFriend/acceptFriend/removeFriend/createGroup/inviteMember/kickMember/deleteGroup/acceptInvite/rejectInvite/createInviteLink/revokeInvites/previewInvite/joinByInvite/sendPackage`（改为发布/拉取）。
- 新增：`join(link)`、`syncDownloads()`、`listDownloads()`、`installDownload(name)`、`heartbeats`/`downloads` 状态；远程访问 `remoteState/enable/revoke`。
- `types.ts`：`CollabSnapshot` 改为 `{ identity, group: CollabGroup|null, heartbeats, skillsInbox, outbox, groupSkills }`；`CollabGroup` 去掉 `ownerId/role/inviteEpoch`，加 `hubId`；新增 `CollabUsage`、`CollabDownloadFile`。

## 9. API 与 S2C 变更汇总

| 类型 | 旧 | 新 |
|---|---|---|
| HTTP | `POST /api/collab/friends*`、`/groups`（建群/邀请/踢人）、`/invites/*`、`/join`（旧 token） | 删除；新增 `POST /api/collab/join { host, port, token }`、`POST /api/collab/downloads/sync`、`GET /api/collab/downloads`、`GET /api/collab/downloads/file/:name`、`POST /api/collab/downloads/install` |
| 群发 | `POST /api/collab/groups/:id/distribute`、`/packages/:id/send`（push） | 改为 master 发布到 `downloads/`（`POST /api/collab/packages/:id/publish`） |
| Peer | friend/group-invite/accept | `HEARTBEAT`、`PULL_DOWNLOADS` |
| S2C | `collab-friend-req`、`collab-group-invite` | `collab-heartbeat` |

## 10. i18n

- 新增：`collab.remote.*`（迁自 `remote.*`）、`collab.join_link.*`、`collab.member.*`、`collab.heartbeat.*`、`collab.downloads.*`。
- 删除：`collab.friend.*`、`collab.group.create/mine/empty/member_count/invite_placeholder/invite/kick*/dissolve*/me_suffix`、`collab.role.*`、旧 `collab.invite.*`、旧 `collab.join.*`、`collab.pending`、`collab.add`。
- `remote.*` 命门禁页（登录/拦截/锁定）保留；面板文案迁为 `collab.remote.*` 或直接复用 `remote.*`。
- 中英两文件键集合保持对称；提交前跑 `npm.cmd run check:i18n`。

## 11. 分阶段

- **P1 单一群组 + 远程访问 + 群组页签重构**：数据模型、协议删除、门禁豁免与 `?access`、`joinByLink`、`GroupView`、设置搬 UI、i18n、测试。
- **P2 心跳 + 用量汇总 + master downloads（usage/group）**：`agent-stats.js`、`heartbeat.js`、`_inHeartbeat`、`downloads/` 写入与拉取、成员用量展示。
- **P3 技能包改拉取**：master 发布到 `downloads/skills/`、slave 同步与安装、`SkillDistributor` 改造。

每阶段独立可测、可交付；P2/P3 依赖 P1 的群组与 hub 概念。

## 12. 测试

- `server/test/agent-stats.test.js`：`parseStats` 用真实抓样（含框线/ANSI/`8.2M`/`3,986`）断言；命令缺失返回 `{ error }`。
- `server/test/heartbeat.test.js`：随机间隔落在 5–10 分钟；slave 上报、master 汇总写 `downloads/usage.json`。
- `server/test/collab-engine*.test.js`：改造为单例群；`joinByLink` + `verifyAccessToken`（正确/错误/过期）；删除 friend/多群用例。
- `server/test/collab-http.test.js`：新增 `/api/collab/downloads`、`/downloads/sync`、`/downloads/file` 路径穿越防护、`peer` 豁免门禁。
- `server/test/collab-invite.test.js`：旧签名邀请链接用例删除，新增 `?access` 免密 Cookie 与 `?access` 错误令牌用例。
- 现有 `collab-store/chat/const/skills/zip` 测试按新数据模型调整。
- `web/src/collaboration/useCollab.test.ts`：更新 API 面；`chat-parser.test.ts` 不变。
- 手动：两实例开启远程访问 → 粘贴链接接入 → 群组/任务可用；断开 master 后点击同步给出提示且不阻塞；心跳 5–10 分钟随机可见。

## 13. 风险与权衡

- **远程门禁豁免 `/api/collab/peer`**：该端点暴露给非回环网段，鉴权完全依赖信封签名与令牌/成员校验；需保证 `verifyEnvelope` 对所有分支都先于业务处理（现状是），并补测试。
- **`opencode stats` 文本解析脆弱**：版本升级可能改格式；用 fixture 锁定，解析失败降级为 `{ error }` 不影响主流程。
- **点击拉取的一致性**：成员名单在两次拉取之间可能过时，聊天可能漏发到新成员；用「加入时一次 MEMBER_SYNC」缓解，并在文档标注限制。
- **大包拉取**：单次 64MB 上限；超额报错，分批后续。
- **重构面大**：删除好友/多群会牵动大量测试与 i18n；分 P1/P2/P3 降低单次风险。
- **兼容旧数据**：`collab.json` 含旧 `friends/groups/pendingInvites` 时忽略即可（`_load` 已做 `{...defaultData, ...parsed}` 合并），首次写入后自然收敛为单例结构。

## 14. 非目标

- 多群/好友/邀请审批/角色（明确删除）。
- 非 opencode agent 的 stats（结构预留）。
- 心跳历史趋势与图表。
- 任务/文件互传改拉取。
- master 选举 / 多 master / 运行中切换 master。
- 浏览器直连 master（统一走服务端间拉取）。
