# 设计文档：机器用量上报（master 收 + slave 定时推，不再依赖加群）

日期：2026-09-16
分支：master
状态：待评审

## 1. 问题与目标

现状：token 用量上报绑死在「加群」体系里。

- `server/collaboration/engine.js:364 reportHeartbeat()`：只有「自己所属的群存在」且「自己不是 hub」时才推送；不在群里直接 `{ code: 'no-group' }` 什么都不做。
- 推送走 Ed25519 签名信封：`this._sign(CollabPeer.STATS, { groupId, usage })` → `POST /api/collab/stats`。
- master 侧 `engine.js:380 _storeHeartbeat()` 强制校验「上报者是该群成员」且「自己是 hub」，否则 `not-member` / `not-hub`。
- 间隔 `server/collaboration/heartbeat.js:3`：60–65 分钟随机。
- 采集 `server/collaboration/agent-stats.js:35`：本机执行 `opencode stats --days 7`，解析 `sessions/messages/days/totalCost/input/output/cacheRead/cacheWrite`。

用户要求：**不依赖加群**；由 master 主动提供「接收」接口；每台机器上报自己的 `sessions/days/messages/input/output`；间隔 **60–90 分钟随机**；master 侧能查看。

目标：

1. slave 只要在设置里粘一次 master 的访问链接，就能长期、周期性地把本机用量推给 master（不建群、不进成员列表）。
2. master 提供「接收」接口与「汇总查看」接口；只有 master 对外开接口，slave 只推不对外开。
3. 间隔 60–90 分钟随机；服务启动时先上报一次。
4. 替换旧链路：删除签名信封那条上报路径。

## 2. 已确认的决策

| # | 决策 | 来源 |
| --- | --- | --- |
| 1 | 复用「访问链接」里的 `token` 做认证，不打签名信封 | 用户选 2 |
| 2 | 替换：删除旧签名信封 heartbeat，上报统一走新 token 接口 | 用户选 1 |
| 3 | 邀请令牌落盘 + 支持长期不过期（重启不丢） | 用户选 1 |
| 4 | 只有 master 提供只读查看接口；slave 只推、不对外开接口 | 用户选 2 |
| 5 | 上报间隔 60–90 分钟随机（现为 60–65） | 用户原话 |
| 6 | 采集口径沿用 `opencode stats --days N`（默认 7 天） | 沿用 |
| 7 | 中英文案同时补齐，禁止写死单语言 | 沿用 AGENTS.md |

## 3. 架构与数据流

```
slave（任意机器）                                   master（被上报方）
┌───────────────────────────┐                    ┌────────────────────────────┐
│ 配置：master 链接          │                    │ 邀请令牌（落盘、可长期）    │
│  <dataDir>/usage-report.json│                   │  <dataDir>/collab/invite.json│
│ 定时：60–90min 随机        │                    │                            │
│ 采集：opencode stats       │  POST /api/usage/report                │
│       --days 7             │ ─────────────────► │ 校验 X-DF-Token            │
│                            │  X-DF-Token: <tk>  │ 落库 usage-peers.json       │
│                            │  body: 机器身份+用量│ WS 广播 / 界面刷新          │
└───────────────────────────┘                    └────────────────────────────┘
                                                    GET /api/usage（本机界面读）
```

上报 body 的机器身份取自本机协作身份（`server/collaboration/identity.js`）：`machineId/employeeId/username/host/port`。

## 4. 接口契约

### 4.1 `POST /api/usage/report`（仅 master）

- 认证：请求头 `X-DF-Token: <token>`，与落盘邀请令牌做 `safeEqual`（`timingSafeEqual`）比较。
- 请求体：

```json
{
  "machineId": "…",
  "employeeId": "…",
  "username": "…",
  "host": "192.168.x.x",
  "port": 22222,
  "usage": { "sessions": 12, "days": 7, "messages": 340, "input": 1234567, "output": 234567, "totalCost": 1.23, "cacheRead": 0, "cacheWrite": 0, "collectedAt": 1758000000000 }
}
```

- 响应：`200 {"ok":true}`；令牌错/过期 `403 {"error":"bad-token"}`；body 非法 `400 {"error":"bad-body"}`。
- 必须在 `server/remote-gate.js` 的 `isPeerRequest()` 白名单里（与 `/api/collab/peer`、`/api/collab/stats` 同级），否则「未开启远程访问」会被 Cookie 门禁以 `403 remote-disabled` 拦掉。

### 4.2 `GET /api/usage`（仅 master，供本机界面）

```json
{ "updatedAt": 1758000000000,
  "peers": { "<machineId>": { "machineId": "…", "employeeId": "…", "username": "…", "host": "…", "port": 22222, "sessions": 12, "days": 7, "messages": 340, "input": 1234567, "output": 234567, "totalCost": 1.23, "receivedAt": 1758000000000 } } }
```

### 4.3 删除

- `POST /api/collab/stats`（`server/collaboration/http-mount.js:92-96`）
- `CollabPeer.STATS` 常量（`shared/collab.js`）
- `engine.reportHeartbeat()` / `_storeHeartbeat()` / `_inHeartbeat()` / `_inStats()`（`engine.js:353-398`）

## 5. 令牌持久化与失效

| 项 | 规则 |
| --- | --- |
| 文件 | `<dataDir>/collab/invite.json`，内容 `{ token, password, expiresAt }` |
| 生成 | `POST /api/remote/invite` 生成后立即写盘（现逻辑在 `server/index.js:413`，仅内存） |
| 撤销 | `POST /api/remote/revoke` 删除该文件 |
| 启动 | 服务启动时读入；文件不存在 = 未开启访问 |
| 长期 | `POST /api/remote/invite` 的 body `days` 显式传 `0` → `expiresAt = 0`；`activeInvite()` 对 `expiresAt === 0` 视为永久有效。`days` 缺省或不合法时仍按现状取默认 1 天（不会误判为长期） |
| 有效期上限 | 与现状一致：显式天数 1–100（`server/remote-gate.js:17-19`） |

## 5.1 范围边界（不做的事）

- 不改动「加群」体系本身：群创建/邀请/成员列表/群聊/群文件/技能分发/远程执行/同步种子全部保持现状，只把「用量上报」这一条链路从签名信封换成 token 上报。
- 不改采集口径（仍 `opencode stats`）、不改 `days` 默认 7 天、不引入历史曲线与数据库。

## 6. slave 配置与定时

- 配置存 `<dataDir>/usage-report.json`：`{ "masterUrl": "http://<host>:<port>", "token": "<token>", "days": 7 }`。
- 界面：设置/协作页新增「上报到 master」输入框，粘贴 master 访问链接。链接格式沿用 `server/index.js:106` 的 `inviteLink()`：`http://<addr>:<port>/?access=<token>`；解析规则：取 URL 的 `host`/`port` 与查询参数 `access` 作为 token，三者缺一即报「链接不合法」。另提供「立即上报一次」按钮与状态显示（上次上报时间、成功/失败原因、下次上报时间）。
- 定时：启动即上报一次；之后每次在 60–90 分钟之间随机取延迟（`60000*60`…`60000*90`）；上报失败只记录日志 + 状态，不影响服务运行。
- 采集：沿用 `collectAgentStats({ cmd, days })`（`opencode stats --days 7`）。

## 7. 存储（master 侧）

`<dataDir>/usage-peers.json`：

```json
{ "updatedAt": 1758000000000,
  "peers": { "<machineId>": { "…usage 字段…", "machineId": "…", "employeeId": "…", "username": "…", "host": "…", "port": 22222, "receivedAt": 1758000000000 } } }
```

- 每台机器只保留**最新一份**（按 `machineId` upsert，旧值整体覆盖）。
- 在线判定：`receivedAt` 距今小于 **3 小时**（= 上报间隔上限 90 分钟 × 2）显示为在线点。
- 兼容：`GET /api/collab/snapshot` 的 `heartbeats` 字段保留，值改从新存储取（前端数据结构不变）；`writeUsageSnapshot()` 写进共享下载目录的 `usage.json` 同样改为取新存储。

## 8. 界面

- 新增「机器用量」视图（独立页或在协作页顶部区块）：每台上报机器一行，列出 `员工/用户名`、`host:port`、`sessions`、`days`、`messages`、`input`、`output`、`totalCost`、`最后上报时间`、在线点。
- 群成员列表的用量列改读同一份数据（`GET /api/usage`）；该成员从未上报过则显示 `—`。
- 新增词条中英同时补齐（如 `usage.title`、`usage.machine`、`usage.last_report`、`usage.online`、`usage.report_link_placeholder`、`usage.report_ok`、`usage.report_failed`、`usage.bad_link`）。

## 9. 测试

server 单测（`node --test "server/test/*.test.js"`）：

- 令牌：正确 → `200`；错误/过期 → `403 bad-token`；`expiresAt === 0` → 长期有效。
- body：缺 `machineId` / `usage` 非对象 → `400 bad-body`；合法 → 落库且可读。
- upsert：同一 `machineId` 二次上报覆盖旧值，`peers` 不新增条目。
- 持久化：`invite.json` 写入后重新读取仍有效；删文件后失效。
- 定时器：注入随机函数与 `collect`，断言延迟落在 `[60min, 90min]`，启动时先报一次。
- 旧路径已移除：`CollabPeer.STATS` 不存在；`POST /api/collab/stats` 返回 `404`。

web 单测（vitest）：链接解析（合法/缺 token/非法 URL）→ `{ masterUrl, token }` 或错误；状态展示由纯函数决定。

手工验收：

1. release（22222）当 master：开启访问 → 复制链接 → `data/collab/invite.json` 落盘。
2. dev（33333）当 slave：粘贴该链接 → 点「立即上报一次」→ master 的 `usage.json` 出现该机器一行，`GET /api/usage` 返回该 `machineId`。
3. 重启 master 后再上报一次仍成功（令牌持久化）。
4. 故意用错令牌 → `403 bad-token`，slave 界面显示失败原因。

## 10. 风险与取舍

- **令牌复用**：能打开 master 远程界面的同一串钥匙被 slave 明文存在本地，且可设为永不过期 → 凭据暴露面变大。本次按用户决定复用；后续可选「专用上报令牌」解耦（本次不做）。
- **无 TLS**：与现有协作链路一致，走 LAN 内明文 HTTP；公网场景需要额外前置（本次不做）。
- **只留最新快照**：不保留历史曲线，`days` 只是采集窗口而非时间序列（本次不做）。
