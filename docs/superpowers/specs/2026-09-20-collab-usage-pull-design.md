# 群用量「按需向群主拉取」设计

## 背景

协作群里查看 token 消耗量（群页面右侧「机器用量」表与趋势图）目前的数据流转如下：

1. 每台机器启动即采集一次、之后每 60–90 分钟随机再采集一次本机 `nga stats`（`server/usage-report.js` 的 `createUsageReporter`），把结果 `POST /api/usage/report`（头 `X-DF-Token`）推给群主。
2. 群主 `peers.upsert` 存进本机 `UsagePeersStore`（`server/usage-peers.js`），并广播 `COLLAB_HEARTBEAT`（`server/index.js` 的 `syncUsageSnapshot`）。
3. 成员机本地 `UsagePeersStore` 默认只有自己；别人的数据靠协作协议从群主带回来：`pullDownloads` 的响应里带 `usage.members`，成员 `peers.upsert` 合并进本地库（`server/collaboration/engine.js:736-738`），再广播心跳刷新前端。
4. 前端 `GroupView.vue` 的 `loadPeers()` 读**本机** `GET /api/usage/peers`，并在每次协作快照 `snap` 变化时重读。

问题：

- 成员机看到的是「同步下来的副本」，只有在 `pullDownloads` 偶发触发（升级检查发现新版本、拉任务、手动）时才更新，可能长期滞后。
- 为维持这份副本，用量采集/收到上报后都要广播 `COLLAB_HEARTBEAT`，而这些广播对「点开看用量」本身没有直接价值。
- 同一份汇总既有 push（上报给群主）又有 pull（下发到成员本地）两套路径，职责重叠。

## 目标

- 成员机打开群页面 / 切换群 / 切到用量 tab 时，向群主**实时拉一次**汇总快照展示。
- 去掉用量触发的广播（不再在采集/上报后广播心跳）。
- 本地不再保存别人机器的用量副本。

## 非目标

- 不改采集频率与上报方式：各机仍每 60–90 分钟 `POST /api/usage/report` 推给群主（只有本机能跑 `nga stats`）。
- 不把采集频率改成「查看时实时采集」；汇总数据的新鲜度仍受各成员最近一次上报时间限制。
- 本轮不改趋势图 `/api/usage/daily` 的数据来源（见「后续」）。
- 不改群聊相关的同步机制。

## 设计

### 一、协议常量 `shared/collab.js`

`CollabPeer` 增加：

```js
USAGE_PULL: 'usage-pull',
```

### 二、engine 拉取与应答 `server/collaboration/engine.js`

- `handleIncoming` 的 `switch` 增加 `case CollabPeer.USAGE_PULL: return this._inUsagePull(env);`。
- 新增 `engine._inUsagePull(env)`：仅群主应答，校验来者是本群成员（沿用 `_inPullDownloads` 的判定：`ownedGroup(this.pub.machineId) || getGroup()` + 成员存在），返回：

  ```js
  { ok: true, data: { updatedAt: Date.now(), members: this.peers.list() } }
  ```

  非成员返回 `{ ok: false, error: 'not-member' }`。
- 新增 `engine.pullUsageFrom(masterId)`：用 `_hubFor(masterId)` 定位群主，签名发 `USAGE_PULL`，返回 `{ code: 'ok', updatedAt, members }`；无可达群主返回 `{ code: 'no-master' }` / `{ code: 'unreachable', error }`。
- **移除** `pullDownloads` 里的 usage 合并（`engine.js:736-738`）与 `_inPullDownloads` 返回体里的 `usage` 字段（`engine.js:757`）。本地库不再保存别人的用量。

### 三、本机 HTTP `server/usage-mount.js`

- `createUsageMount` 新增注入项 `pullFromHub(masterId)`（返回 `Promise<{ code, updatedAt, members }>`）。
- `GET /api/usage/peers` 支持 `?fresh=1&masterId=<hubId>`（`masterId` 为当前群群主，用于多群时定位；缺省时取第一个非本机 hub）：
  - `fresh` 不为真：维持现状，返回本地 `peers.snapshot()`。
  - `fresh` 为真：调 `pullFromHub(masterId)`。成功 → 返回群主汇总 `{ peers: members, updatedAt }`，并把这最后一次成功的 `members` 按 `masterId` 存进**进程内缓存**；失败/无群主 → 返回本地快照，若进程内有该群上次成功结果则优先返回它（离线回退）。
  - 响应可附带 `stale: true` 表示用了缓存/本地回退，供前端提示。
- 群主自己：`pullFromHub` 由装配方实现为「本机就是该群 hub 时直接返回本地 `peers.list()`」，无需打网络。

### 四、装配与去掉广播 `server/index.js`

- 删除 `syncUsageSnapshot`。
- `createUsageReporter({...})` 不再传 `onLocal`（本地 upsert 仍由 reporter 内部完成）。
- `createUsageMount({...})` 不再传 `onReport`；新增 `pullFromHub`：

  ```js
  pullFromHub: async (masterId) => {
    const owned = engine.store.ownedGroup(engine.pub.machineId);
    if (owned && (!masterId || owned.hubId === masterId)) {
      return { code: 'ok', updatedAt: Date.now(), members: usagePeers.list() };
    }
    return engine.pullUsageFrom(masterId);
  }
  ```

- `eventBus.on('heartbeat', ...)` 与 `broadcastCollab(COLLAB_HEARTBEAT, ...)` **保留**（`pullDownloads` 后仍 `_emit('heartbeat')`，供群聊刷新用），但不再由用量事件触发。

### 五、清理相互透传 `server/collaboration/http-mount.js`

`GET /api/collab/downloads` 返回体去掉附带的 `usage` 字段（`http-mount.js:189`），与 `_inPullDownloads` 保持一致。

### 六、前端触发 `web/src/collaboration/GroupView.vue`

- `loadPeers()` 改请求 `/api/usage/peers?fresh=1&masterId=<当前群 hubId>`。
- 触发时机改为：组件 mount、当前群 id 变化、`mtab` 切换（成员/趋势）各拉一次。
- 去掉 `watch(() => snap.value, loadPeers)`（不再依赖广播刷新）。
- 若响应 `stale` 为真，显示一条提示（新增 i18n 词条，中英同步）。

## 错误处理与兼容

- **群主离线/不可达**：成员回退到进程内最后一次成功结果；仍无则回退本地快照（通常只有自己）。前端提示「未能从群主获取最新用量」。
- **旧群主（无 `USAGE_PULL`）**：应答 `unknown-type`，成员静默回退本地，不报错。
- **旧成员**：不发起 `USAGE_PULL`，行为不变。
- **安全**：复用现有签名信封（Ed25519）+ 成员校验，不新增对外网页接口，不落盘群主令牌。

## 影响文件

- `shared/collab.js`：加常量。
- `server/collaboration/engine.js`：加 `_inUsagePull` / `pullUsageFrom` / `switch` 分支；移除 `pullDownloads`、`_inPullDownloads` 的 usage。
- `server/usage-mount.js`：`fresh` 分支 + `pullFromHub` 注入 + 缓存。
- `server/index.js`：删 `syncUsageSnapshot`，改装配，注入 `pullFromHub`。
- `server/collaboration/http-mount.js`：`downloads` GET 去掉 `usage`。
- `web/src/collaboration/GroupView.vue`：`loadPeers` 触发与 `fresh`。
- `shared/i18n/zh-CN.js` + `shared/i18n/en.js`：离线提示词条。

## 测试计划

- engine 双节点（`createPairHarness`）：成员 `pullUsageFrom()` 拿到群主的 `members`；非成员调 `_inUsagePull` 返回 `not-member`。
- `_inPullDownloads` 返回体不再含 `usage`；`pullDownloads` 不再改动本地 peers。
- usage-mount：`?fresh=1` 成功返回群主数据；群主不可达时回退；进程内缓存生效；不带 `fresh` 保持原行为。
- 更新既有断言：`server/test/collab-skills.test.js`、`collab-db.test.js` 等对 `pullDownloads` 带 usage 的断言。
- 前端：`GroupView` 相关测试（如涉及）改为断言 `fresh=1` 请求。

## 后续（本轮不做）

- 趋势图 `/api/usage/daily` 目前仍读本机库，成员机上只有自己。后续可让 `USAGE_PULL` 顺带返回群主侧的日粒度数据（或新增 `USAGE_DAILY_PULL`）。
