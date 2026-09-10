# 设计文档：群邀请链接（生成 URL → 点击入群）

日期：2026-09-10
分支：master
状态：待评审

## 1. 概述

在现有协作子系统（`server/collaboration/**`、`web/src/collaboration/**`）的「加群邀请」能力上，新增**可分享的邀请链接**：群主/管理员生成一个 URL，通过任意渠道发给他人；对方点击后在本机 Devflow UI 打开，预览群名/邀请人/有效期，确认后加入群。

现有 `inviteMember` 要求邀请方**预先知道对方 machineId**（对方必须是好友）。邀请链接去掉这个前提：链接自带的签名 token 就是入群凭证，接收者可以是陌生人。

### 已与用户确认的约束

- 链接指向**接收者本机的 Devflow UI**（`http://127.0.0.1:<port>/?invite=<token>`），不提供任何对外网页/落地页。
- 入群方式：**验签即入群**，链接**可过期、可撤销**（多人可用，非一次性）。
- 点击后**先预览再确认加入**，不因误点直接入群。
- 生成链接权限：**群主 + 管理员**（与现有踢人权限一致）。
- 允许复用现有 **P2P 入群握手**（接收方后端 → 邀请方后端），跨机可用。
- **不新增、也不依赖任何远程执行 command 能力**（与现有 `remote-runner`/`@` 远程执行无关）。

## 2. 范围

**做：**
- 签名邀请 token 的签发与校验。
- 新增 `group-join` P2P 信封与 `_inGroupJoin` 接收逻辑。
- 群对象新增 `inviteEpoch` 用于撤销。
- 4 个本地 REST 端点（签发/撤销/预览/加入）。
- 联系人页生成链接 UI + 粘贴邀请码入群 UI + 全局 `?invite=` 弹窗。

**明确不做：**
- 不托管任何对外可访问的入群网页或端点（邀请方只被动接收 `group-join`）。
- 不做一次性（single-use）链接、邀请审批队列。
- 不新增远程执行 command 能力。
- 不改 `shared/index.js`、`server/ws-gateway.js`、`web/src/useTerminal.ts`。

## 3. Token 格式

紧凑三段式，便于识别与给出明确错误：

```
dfinv1.<base64url(canonical body)>.<base64url(signature)>
```

`body`（签名时按现有 `canonicalize` 递归键排序）：

```json
{
  "groupId": "uuid",
  "groupName": "team",
  "inviter": { "machineId": "uuid", "username": "alice", "host": "192.168.1.5", "port": 3001, "publicKey": "-----BEGIN PUBLIC KEY-----..." },
  "epoch": 0,
  "exp": 1789000000000,
  "jti": "uuid"
}
```

- 签名：`crypto.sign(null, Buffer.from(canonicalize(body),'utf8'), inviterPrivateKey)`；`signature` 为 base64。
- 验签：用 body 内嵌的 `inviter.publicKey`（自证，与现有信封一致）。**不**使用信封的 5 分钟时间窗；token 用 `exp` 绝对过期时间。
- `exp`：绝对毫秒时间戳，默认 TTL **7 天**（常量 `INVITE_TTL_MS`，API 可传 `ttlMs` 覆盖）。
- `epoch`：签发时的 `group.inviteEpoch || 0`。
- `jti`：随机 UUID，仅用于日志/排查；撤销基于 epoch，不维护 jti 表。

实现：新增 `server/collaboration/invite.js`，复用 `sign.js` 的 `canonicalize`：

```
makeInviteToken(privateKeyPem, body) -> string
parseInviteToken(token) -> { ok: true, body } | { ok: false, error }
```

## 4. 数据模型变更

群对象新增一个字段（随现有 `MEMBER_SYNC` 整体同步给成员）：

```jsonc
{ "id", "name", "ownerId", "createdAt", "members": [...], "inviteEpoch": 0 }
```

- 旧数据无该字段 → 一律按 `0` 处理（读取处用 `g.inviteEpoch || 0`）。
- 撤销 = `inviteEpoch + 1`；此后旧 token 的 `epoch` 不匹配即失效。

## 5. 协议变更（`shared/collab.js` + `.d.ts`）

`CollabPeer` 新增：

```js
GROUP_JOIN: 'group-join',
```

- 方向：接收方后端 → 邀请方后端。
- payload：`{ token }`；信封 `from` 为接收者 profile（machineId/username/host/port/publicKey）。
- 响应：邀请方的 HTTP 响应体 `{ ok:true, data:{ group } }`（完整群，含成员表），接收方据此落库并立即得到成员名单，无需等 `MEMBER_SYNC`。
- 入群成功后邀请方仍 `_broadcastMemberSync(g)` 给老成员。
- 不新增 S2C：入群后复用现有 `COLLAB_SYNCED` 触发前端刷新。

`handleIncoming` 增加 `case CollabPeer.GROUP_JOIN: return this._inGroupJoin(env);`。接收者身份不明时，现有逻辑用 `env.from.publicKey` 自证验签，正好覆盖陌生人点链接。

## 6. 服务端 REST API（`http-mount.js`）

统一挂在 `/api/collab` 下，失败沿用现有 `{ code }` / `{ error }` 风格（非 5xx）。

| 方法 | 路径 | body | 返回 | 权限 |
|---|---|---|---|---|
| POST | `/groups/:id/invite-link` | `{ origin?, ttlMs? }` | `{ token, url, expiresAt, jti }` | owner/admin |
| POST | `/groups/:id/invite-revoke` | – | `{ epoch }` | owner/admin |
| GET | `/join/preview?token=` | – | `{ code:'ok', groupId, groupName, inviter, expiresAt, alreadyMember }` 或 `{ code, error }` | 本机 |
| POST | `/join` | `{ token }` | `{ code, group? }` | 本机 |

- `url = ${origin || 'http://127.0.0.1:3001'}/?invite=${encodeURIComponent(token)}`；`origin` 由前端传 `location.origin`（开发态 5173 / 生产态 3001 自洽）。
- `preview` **只本地验签、不联网**，用于预览卡片。
- `join` 触发跨机握手（见 §7）。

## 7. 引擎方法（`engine.js`）

- `createInviteLink({ groupId, ttlMs })`：`_requireMember` + 角色 owner/admin；用 `g.inviteEpoch || 0` 签发；返回 `{ code:'ok', token, expiresAt, jti }`。非管理角色 → `{ code:'forbidden' }`。
- `revokeInvites(groupId)`：owner/admin → `g.inviteEpoch = (g.inviteEpoch||0)+1` → `saveGroup` → `_broadcastMemberSync(g)` → emit `synced`；返回 `{ code:'ok', epoch }`。
- `previewInvite(token)`：`parseInviteToken` → 校验 `exp` → 查本机是否已在群；返回 `{ code:'ok', groupId, groupName, inviter, expiresAt, alreadyMember }`，失败 `{ code:'bad-token' }` / `{ code:'expired' }`。
- `joinByInvite(token)`：
  1. 本地 `parseInviteToken` + 校验 `exp`（不通过 → `bad-token`/`expired`）；
  2. 若本机已是成员 → 直接返回 `{ code:'already-member', group }`；
  3. `_post(inviter.host, inviter.port, sign(GROUP_JOIN, { token }))`；`!res.ok` → `{ code:'unreachable' }`（或透传邀请方错误码）；
  4. 成功 → `store.upsertGroup(res.data.group)` → emit `synced` → `{ code:'joined', group }`。
- `_inGroupJoin(env)`（校验顺序）：
  1. `parseInviteToken(env.payload.token)` 失败 → `{ ok:false, error:'bad-token' }`；
  2. `body.inviter.machineId === this.pub.machineId`（只有被点名的邀请方能受理）否则 `not-inviter`；
  3. `exp` 过期 → `expired`；
  4. 本群存在且本机是成员，否则 `no-group` / `not-member`；
  5. `body.epoch === (g.inviteEpoch||0)`，否则 `invite-revoked`；
  6. 已在成员表 → 幂等返回 `{ ok:true, data:{ group:g } }`；
  7. `g.members.push({ ...env.from, role: this._assignRole(g) })` → `saveGroup` → `_broadcastMemberSync(g)` → emit `synced` → `{ ok:true, data:{ group:g } }`。

新成员角色沿用现有 `_assignRole`（管理位满 5 后为 `member`）。

## 8. Web UI

- `types.ts`：`CollabGroup` 增 `inviteEpoch?: number`。
- `useCollab.ts` 新增：`createInviteLink(groupId, origin)`、`revokeInvites(groupId)`、`previewInvite(token)`、`joinByInvite(token)`。
- `ContactsView.vue`：
  - 成员面板（`myRole` 为 owner/admin 时）：「生成邀请链接」按钮 → 只读链接输入框 + 「复制」+「重置链接」（二次确认，调 `revokeInvites` 后重新签发）。
  - 「添加」区：新增“粘贴邀请链接/邀请码”输入 + 「预览」→ 预览卡片 → 「加入」。
- 新增 `web/src/collaboration/JoinInviteCard.vue`：输入 token（或含 `?invite=` 的完整 URL，自动提取）→ 调 `previewInvite` → 展示群名/邀请人/有效期/`alreadyMember` → 「加入」/「取消」，成功后 `emit('joined', group)`。供粘贴框与全局弹窗复用。
- `App.vue`：`onMounted` 解析 `location.search` 的 `invite=`；命中则渲染 `JoinInviteCard` 全屏遮罩；`joined` 后切到 `rail='contacts'`，并 `history.replaceState` 清掉 query。
- `useCollab` 以 `token` 作为参数，`joinByInvite` 成功即写入 `state`（或触发 `refresh`）。

## 9. 错误处理

| 场景 | 码 | UI 文案 |
|---|---|---|
| token 格式/签名错 | `bad-token` | 邀请码无效或已损坏 |
| 已过期 | `expired` | 邀请链接已过期 |
| epoch 不符（被撤销/重置） | `invite-revoked` | 邀请链接已失效 |
| 群已解散 | `no-group` | 该群已不存在 |
| 邀请方不在线/网络不通 | `unreachable` | 无法连接邀请方，可能不在线 |
| 本机已在该群 | `already-member` | 视为成功，直接选中该群 |
| 非 owner/admin 签发 | `forbidden` | 无权限生成邀请链接 |

边界：重复/并发加入由邀请方成员表判断保证幂等；邀请方点自己的链接 → `already-member`；链接中的本机 UI 端口若非默认（改了端口），点击可能打不开 → 提供「粘贴邀请码」兜底路径。

## 10. 测试

- `server/test/collab-invite.test.js`：
  - 纯函数：`makeInviteToken`/`parseInviteToken` 往返；篡改 body / 篡改签名拒绝；过期拒绝。
  - 双节点 `createPairHarness`：owner 建群并 `createInviteLink` → B `joinByInvite` → 双方 `findGroup` 成员表一致、角色正确；`revokeInvites` 后旧 token 被拒（`invite-revoked`）；非 admin 成员 `createInviteLink` → `forbidden`；过期 token → `expired`；重复加入幂等；邀请方不可达 → `unreachable`；B 已是成员 → `already-member`。
- 扩展 `server/test/collab-http.test.js`：覆盖 4 个新路由的状态码/返回结构。
- 验收：`npm.cmd test` 全绿 + `npm.cmd run typecheck` 通过。

## 11. 实施顺序

1. `shared/collab.js` + `shared/collab.d.ts`：加 `GROUP_JOIN`。
2. `server/collaboration/invite.js`：token 签发/校验 + 单测。
3. `engine.js`：`createInviteLink` / `revokeInvites` / `previewInvite` / `joinByInvite` / `_inGroupJoin` + `handleIncoming` 分支；群 `inviteEpoch`。
4. `http-mount.js`：4 个端点。
5. server 测试补全 → `npm.cmd test`。
6. web：`types.ts` / `useCollab.ts` / `JoinInviteCard.vue` / `ContactsView.vue` / `App.vue`。
7. `npm.cmd run typecheck` + 手动联调（两个实例）。
