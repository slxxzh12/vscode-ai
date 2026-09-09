# 设计文档：群组协作与 Skill 点对点分发

日期：2026-09-09
分支：statistic
状态：已评审通过，待编写实施计划

## 1. 概述

在现有 devflow-web-terminal（shared/server/web 三 workspaces）基础上，新增一套 **P2P 网状协作子系统**：各开发者的 devflow 实例组成纯局域网群组，成员可加好友、建群，并在群内**点对点分发 opencode skills**（zip 包），接收方手动确认后安装到本机技能目录。

核心约束（已与用户逐条确认）：

- P2P 网状拓扑，无中央服务器；每台机器既是服务端也是客户端。
- 好友发现：手动输入对方 `ip:port` 发起握手，双向互登记。
- 好友与多群并存；非好友也可被邀请入群。
- 群主建群，owner 可指定 admin；**去掉审批**，任意群成员可直接发起分发。
- 分发以「本机技能目录（含 SKILL.md 的文件）打 zip」为单位，同名直接覆盖。
- 接收方必须**手动确认**后才安装。
- 离线/后入群成员：上线后拉取同步补装。
- 状态存各机本地 JSON（权威），经 P2P 增量同步（last-write-wins）。
- 本机密钥为 **Ed25519 私钥自持**；所有协作消息带签名，接收方用「该发送者公钥」验签（只签名不加密内容）。
- UI 为 Web 新页面。

## 1.5 目录隔离约束（重要）

本功能在 `statistic` 分支开发，master 后续会持续演进。为避免每次 pull master 大量冲突，新功能代码**全部进入隔离目录**，对 master 现有文件只做最小接线：

- 新文件只允许出现在：`server/collaboration/`、`web/src/collaboration/`、`shared/collab.js` + `shared/collab.d.ts`（协作常量独立文件，**不改** `shared/index.js`）、`server/collaboration.json`（数据）。
- master 现有文件**只允许**以下最小改动点：
  1. `server/index.js` — 实例化 Collaboration 并挂载其 HTTP 路由 + 把协作推送广播到已连浏览器 WS（复用 `gateway.conns`，不改 ws-gateway）。
  2. `web/src/App.vue` — 顶部加入口按钮 + 条件渲染 `<CollaborationView>`（collab 视图只在选中时挂载）。
  3. `shared/package.json` — `exports` 增加 `"./collab"` 子路径映射（让 `@devflow/shared/collab` 可被 server/web import）。
- `shared/collab.js` 导出 `CollabS2C`（本地服务端→本机浏览器 WS 推送类型）与 `CollabPeer`（机器↔机器 HTTP 信封 `type`）两组常量；协作用户层命令不走 WS（见 §6.3），故不需要 `CollabC2S`。
- 机器↔机器传输：统一走 HTTP `POST /api/collab/peer`，body 为签名信封 `{ type, from, payload, signature, ts }`（见 §3.2）。本地浏览器↔本地服务端：只走 `fetch('/api/collab/*')` REST + 复用现有 `/ws` 连接收 S2C 推送。
- ws-gateway、useTerminal.ts **不改**：协作 S2C 推送由 index.js 遍历 `gateway.conns` 下发；浏览器端 useTerminal 的 default 分支会把未知 type 以 `emit(msg.type)` 转发，collab UI 直接 `terminal.on(CollabS2C.x, ...)` 订阅。

隔离边界示意：

```
只新增（隔离目录）:  server/collaboration/**   web/src/collaboration/**   shared/collab.js(.d.ts)
最小改动（≤3 处）:  server/index.js   shared/package.json   web/src/App.vue
不改:              shared/index.js  server/ws-gateway.js  web/src/useTerminal.ts
```

运行时数据（不入库）：`server/collaboration/identity.json`（**含本机 Ed25519 私钥**）、`server/collaboration/collab.json`、`server/collaboration/inbox/`。`.gitignore` 追加了这三条规则（私钥绝不允许提交；此为对 master 文件的第四处例外改动，因安全必需）。

## 2. 总体架构

协作子系统与终端会话 / Workflow 并列，互不侵入（文件布局见 §1.5）：

```
server/
  collaboration/
    engine.js           协调器：身份/store/收发 API/事件总线（心跳推送由事件→gateway 广播）
    identity.js         本机身份：machineId + 用户名 + ip:port + Ed25519 密钥对（含 sign/verify）
    store.js            本地权威 JSON 持久化：friends / groups / skillsInbox / groupSkills
    sign.js             Ed25519 签名/验签 + 规范化 JSON（工具，供 engine/peer 复用）
    zip.js              零依赖 zip 写/读（Node 内置 zlib，不引第三方包）
    skill-packer.js     扫描技能源目录 → zip（内存流）
    skill-installer.js  校验并解压安装（同名备份覆盖、防路径穿越）
    peer-http.js        POST /api/collab/peer 接收：验签 → 按 CollabPeer.type 分发
    peer-client.js      主动侧 HTTP 调用：握手、分发 zip、pull-sync（fetch）
    http-api.js         本地 REST：/api/collab/{identity,friends,groups,skills,inbox,pull}
    http-mount.js       挂载到 index.js 的最小接线：/api/collab/* 路由
    event-bus.js        发布/订阅（engine 事件 → index.js 广播到 gateway.conns）
  collaboration.json    数据文件（同 projects.json 模式）
```

```
shared/
  collab.js             协作常量独立文件：CollabS2C / CollabPeer（不改 index.js）
  collab.d.ts           同上 TS 类型声明（web 侧 import 用）
```

```
web/src/collaboration/
  CollaborationView.vue   容器：本机身份卡 + tab
  FriendsView.vue         好友列表 + 「输入 ip:port 加好友」+ 删除好友
  GroupsView.vue          群列表 + 建群 + 群详情(成员/角色/admin 指定/邀请) + 入群邀请
  SkillDistributor.vue    勾选本地 skills → 选目标(群/好友) → 发起分发 + 历史
  InboxView.vue           待确认 skill 包 → 安装/忽略/删除 + 补拉提示
```

数据流（分发主循环）：

```
发起者: 扫本地 skills → 勾选 → zip → 遍历目标成员(在线)逐个 POST zip+元数据
接收者: 验签 → 暂存 inbox → 本机 WS 推给本机前端 → 用户点「确认安装」
       → skill-installer 解压到 ~/.config/opencode/skills/（同名先备份再覆盖）
离线成员: 上线后向任一在线群成员 pull-sync 拉「群技能清单」比对 → 补装
```

模块边界：

- `skill-packer`：技能目录 → zip。只依赖 fs/path。
- `skill-installer`：zip → 校验 → 解压安装。只依赖 fs/path + zip 库。
- `store`：纯状态读写与 JSON 持久化，不感知网络。
- `peer-http` / `peer-client`：网络收发与验签，依赖 store/identity。
- UI 仅与本地 HTTP API 和本地 WS 通信，不直接碰对端。

## 3. 身份、密钥与数据模型

### 3.1 本机身份

- 首次运行生成 `machineId`（UUID），写入 `server/collaboration.json`。
- 首次运行用 `crypto.generateKeyPairSync('ed25519')` 生成密钥对：
  - `identity.secretKey`（私钥）：**永不外发、不参与任何同步**，仅本机签名用。
  - `identity.publicKey`（公钥）：可分发，加好友/入群时给对方。
- 外显地址：`{ machineId, username, ip, port }`。
  - username：系统登录用户名。
  - ip：本机局域网 IP，默认取监听地址或可在配置声明。
  - port：devflow 监听端口。
- 密钥指纹：UI 展示公钥的 SHA-256 指纹（前 16 字节 hex），便于人工核对。

### 3.2 签名 / 验签（替代 HMAC，公/私钥方案）

- 发送方：对载荷做**规范化序列化**（payload 规范 JSON 字符串），`signature = Ed25519.sign(privateKey, canonicalPayload)`，附 `signature` + `timestamp` 头。
- 接收方：查好友/群成员表取**该发送者的公钥**，`Ed25519.verify(publicKey, canonicalPayload, signature)` → 通过才处理（好友请求/同步/任务分发）。
- 时间戳防重放：宽容窗 ±5 分钟。
- 密钥生命周期：加好友握手时双向交换公钥并持久化；无共享 secret。私钥与公钥均不随 peer 同步消息外发（公钥仅握手阶段显式交换一次）。

### 3.3 本地权威 JSON

`server/collaboration/collab.json`（store 数据；identity 单独存 `server/collaboration/identity.json`，二者均不入库）：

```json
{
  "identity": {
    "machineId": "uuid-a", "username": "alice", "ip": "192.168.1.5",
    "port": 3001, "publicKey": "ed25519-pub-pem",
    "secretKey": "ed25519-priv-pem"
  },
  "friends": [
    { "machineId": "uuid-b", "username": "bob", "ip": "192.168.1.6",
      "port": 3001, "publicKey": "ed25519-pub-pem", "addedAt": "2026-09-09T00:00:00Z" }
  ],
  "groups": [
    { "id": "group-1", "name": "team", "ownerId": "uuid-a",
      "members": [ { "machineId": "uuid-a", "role": "owner" },
                   { "machineId": "uuid-b", "role": "admin" } ] }
  ],
  "skillsInbox": [
    { "id": "inbox-1", "fromId": "uuid-b", "skillName": "my-skill",
      "hash": "sha256-hex", "zipPath": "inbox/inbox-1.zip",
      "status": "received", "receivedAt": "2026-09-09T00:00:00Z" }
  ],
  "groupSkills": [
    { "groupId": "group-1", "skillName": "my-skill",
      "hash": "sha256-hex", "distributedBy": "uuid-b", "installed": false }
  ]
}
```

- 每台机器 JSON 为权威；变更后向群内在线 peers 推增量（对象级替换 + 时间戳 last-write-wins）。

## 4. 好友与群组流程

### 4.1 加好友（手动输入 ip:port，双向互登记）

```
A 输入 B 的 ip:port → A 向 B POST /api/collab/handshake
   body: { type:'friend-request', from: A 身份{id,用户名,ip,port,公钥}, ts }
   该请求用 A 私钥签名（公钥随明文一并交给 B 做首次验签）
B 验签通过 → 保存 A 为「待确认好友」→ 经 B 本地 WS 推给 B 前端
B 前端确认 → B 向 A POST /api/collab/handshake { type:'friend-accept', from: B 身份, ts }
A 验签通过 → 双方 friends[] 落盘
```

- 双向互登记后，任一方发起同步/分发都能用对方公钥验签。
- 非好友不能收到对方任何消息（除首次 friend-request 明文带公钥）。

### 4.2 建群

- 群主 UI 建群 → 本地生成群 `{id, name, ownerId}`，自身 role=`owner`，写入 groups。
- 群主邀请目标：好友，或直接输入 ip:port（非好友也能入群）。

### 4.3 入群邀请（任一群成员可邀请，广播给全群）

```
发起者 X → 目标成员 T（若 T 不在群）发 group-invite（签名）
T 验签 → 前端提示入群 → 同意 → T 回复 group-accept（签名）
X 收到 accept → 更新本地 groups[] 加入 T
X 把「成员变更」增量广播给全群在线成员 → 各成员更新本地 groups[]
   （含 T 的 {id,用户名,ip,port,公钥} → 旧成员获得新成员公钥/地址）
```

- 新成员 T 由此拿到全群成员名单；已有成员拿到 T 的公钥与地址 → 两两直连网格。
- 角色语义：
  - `owner`：建群者。占 1 个管理位。
  - `admin`：管理位。**群内共 5 个管理位**：owner 之外，按入群先后自动把前 4 名成员升为 `admin`（第 2~5 位入群者），之后入群者为 `member`。owner 也可在之后手动指定/撤销 `admin`。
  - `member`：普通成员，无管理动作。

### 4.4 权限矩阵

| 操作 | owner | admin | member |
|---|---|---|---|
| 建群 / 解散群 | ✔ | – | – |
| 指定 / 撤销管理员 | ✔ | – | – |
| 邀请入群 | ✔ | ✔ | ✔ |
| 移出普通成员 | ✔ | ✔ | – |
| 移出其他 admin | ✔ | – | – |
| 发起 skill 分发 | ✔ | ✔ | ✔ |
| 接收并安装 | ✔ | ✔ | ✔ |

- 踢人规则：**admin 只能踢普通成员；owner 可踢任何人（含其他 admin）**。
- 被移出成员收到「已被移出」通知并退出群（本地删除群记录；后续 MEMBER_SYNC 不再含其地址）。

### 4.5 离线一致性

- 各机权威；在线时增量推送；掉线后上线时向任一在线群成员 `pull-sync` 拉最新成员名单与 groupSkills 清单对比。

## 5. Skill 分发与安装

### 5.1 技能源

- 默认扫描 `~/.config/opencode/skills/<name>/`（含 SKILL.md）。
- 支持用户手动指定/上传 skill 目录或 zip（临时入站）。
- 源目录可配置：`opencodeSkillsDir`。

### 5.2 发起分发

- UI 勾选一个或多个 skill → 选目标（整个群 或 部分好友）。
- `skill-packer` 把每个 skill 目录打成 zip（内存流，含 SKILL.md + 引用资源，排除隐藏文件如 .git）。

### 5.3 发送（P2P HTTP，签名保护）

```
对每个在线目标 T：
  POST http://{T.ip}:{T.port}/api/collab/skill
    headers: signature, timestamp
    body: { fromId, skillName, skillVersion(=文件hash), zipBytes,
            groupId?(群内分发时带), 描述 }
→ 接收方先验签（该发送者公钥）→ 通过则暂存
```

### 5.4 接收 / 手动安装

```
验签通过 → zip 存本地 inbox 目录 + skillsInbox[] 落盘(status=received)
→ 经本地 WS 推给本机前端「收到新 skill 包」
→ 用户点「安装」或「忽略」
   安装 → skill-installer：
     1) 校验 zip 结构合法（必须有 SKILL.md，路径不得越界 ../）
     2) 同名已存在 → 先备份 ~/.config/opencode/skills/<name>.bak 再覆盖
     3) 解压到 ~/.config/opencode/skills/<name>/
     4) skillsInbox.status=installed；groupSkills[] 记录 installed
   忽略 → status=ignored
```

### 5.5 群内分发与同步

- 群内分发：对所有「其他成员」各发一份；本地记一条 groupSkills（自身已拥有）。
- 离线/后入群成员：上线 `pull-sync` 拉取群技能清单（名字+hash+分发者）与本机对表：
  - 缺失 → 显示「可补拉」→ 向有该包的任一在线成员拉 zip → 安装。
  - hash 相同 → 已最新，跳过。
  - 同名覆盖：hash 不同即为新版 → 安装时提示并覆盖（本地保留 .bak）。

### 5.6 安全

- 入站 skill zip 均为未知代码（含 prompt/脚本）。安装前 UI 明确警告。
- 服务端强制 zip 结构校验：必须有 SKILL.md，无路径穿越。
- 所有入站消息验签 + 时间戳防重放。

### 5.7 边界与错误处理

- 目标离线 → 标记待发，等对方上线 pull-sync 时补拉（不自建发送队列）。
- 验签失败 / 时间戳超窗 → 丢弃并记 log，不入 inbox。
- zip 损坏 / 结构非法 → status=invalid，前端可见，可删除。

## 6. 前端 UI 与消息

### 6.1 导航

- 顶部入口切换：`▶ devflow`（终端页现状）| `👥 协作`（协作视图）。

### 6.2 协作页

| 组件 | 内容 |
|---|---|
| `CollaborationView.vue` | 本机身份卡（用户名/ip/端口/公钥指纹）+ tab |
| `FriendsView.vue` | 好友列表、状态；加好友表单（ip:port）；删除好友 |
| `GroupsView.vue` | 群列表；建群；群详情（成员+角色徽章、指定 admin、邀请成员）；入群邀请 |
| `SkillDistributor.vue` | 勾选本地 skills → 选目标 → 发起分发；分发历史 |
| `InboxView.vue` | 待确认 skill 包（名称/来源/大小/hash）→ 安装/忽略/删除；补拉提示 |

HTTP 走 `fetch('/api/...')`；实时推送复用现有 WS。

### 6.3 WS 消息（`shared/collab.js`，隔离常量）

现有会话/Workflow 消息（`shared/index.js`）全部不动。协作常量放独立文件 `shared/collab.js`（导出 `CollabS2C` / `CollabPeer`），web 侧经 `@devflow/shared/collab` 子路径 import：

- `CollabS2C`（本地服务端 → 本机浏览器，**复用现有 /ws 推送**）：`COLLAB_INBOX`（收到新包）、`COLLAB_FRIEND_REQ`（待确认好友）、`COLLAB_GROUP_INVITE`（待入群）、`COLLAB_SYNCED`（本机状态已变更 → 前端刷新快照）
- 协作用户层命令**不走 WS**：浏览器对本地服务端的所有操作走 HTTP `fetch('/api/collab/*')`；浏览器收推送只需订阅 `CollabS2C` 对应 type（useTerminal default 分支会 emit，无需改 useTerminal.ts）。
- `CollabPeer`（机器↔机器 HTTP 信封 `type`）：`FRIEND_REQUEST`、`FRIEND_ACCEPT`、`GROUP_INVITE`、`GROUP_ACCEPT`、`MEMBER_SYNC`、`SKILL_PUSH`、`PULL_SYNC`

> peer 间（机器↔机器）握手/分发/同步走 HTTP + 签名；WS 仅用于「本地服务端 ↔ 本地浏览器」。两层语义分开。

### 6.4 配置入口

- `collaboration.json`：默认 `server/collaboration.json`，环境变量 `DEVFLOW_COLLAB` 可覆盖（沿用 config.js 模式）。
- `opencodeSkillsDir`：默认 `~/.config/opencode/skills`。

### 6.5 测试

沿用现有模式（server 用 `node:test`，web 用 vitest）：

- server：签名/验签（对/错密钥、时间戳重放）、friend handshake 双向登记、群邀请广播到本地 groups、zip 打包结构、安装器路径穿越防护 + 同名备份覆盖、验签失败丢弃。
- web：组件渲染、分发目标选择、收件箱安装/忽略按钮。
- `npm test` 全绿、`npm run typecheck` 通过。

## 7. 明确不做（v1 范围外）

- 内容加密（只签名不加密）。
- 去中心共识（用 last-write-wins）。
- 自动安装（必须手动确认）。
- 消息聊天。
- 跨网段 / NAT 穿透。
- mDNS / UDP 广播自动发现。
- 移动端适配。

## 8. 实施建议（拆两份 plan：server 先行）

Server plan（本阶段）：
1. shared：`collab.js` + `collab.d.ts` + `package.json` exports 子路径。
2. server：sign.js（规范化 JSON + Ed25519）+ identity.js → 测试。
3. server：zip.js 零依赖写/读 → 测试。
4. server：store.js（collaboration.json 持久化）+ 测试。
5. server：skill-packer.js / skill-installer.js → 测试。
6. server：engine.js + event-bus.js（friend/group/skill/pull 全流程核心逻辑，纯内存可测）。
7. server：peer-http.js / peer-client.js / http-api.js / http-mount.js → 集成测试（双实例 P2P）。
8. server：index.js 接线 + 广播到 gateway.conns；配置。
9. `npm test`（server）+ `npm run typecheck`（web 不受影响）全绿。

Web plan（后续）：
10. web：协作页 UI（5 个组件）+ `useCollab` + App.vue 入口接线。
