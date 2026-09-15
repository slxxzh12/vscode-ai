# 设计文档：master 同步种子（update.json）+ slave 主动检查/同步

日期：2026-09-15
分支：master
状态：待评审

## 1. 概述

在既有 master/slave 协作模型上，新增「同步种子」机制与 slave 主动同步入口：

1. **master 勾选共享文件**，保存为一份带**日期版本号**的种子文件 `update.json`（记录版本 + 文件清单）。
2. **master 不主动推送**任何消息给 slave。
3. **slave 主动检查**：启动 / 进入协作页 / 手动点击时，向所属 master 查询 `update.json`；若 master 版本比本机记录的新 → **自动弹窗**展示版本与文件清单。
4. **slave 用户确认**后只拉取种子内列出的文件；**同意或拒绝都会更新本机记录的时间戳/版本**（拒绝后同一版本不再重复弹窗）。
5. **slave 也可在群组里主动发起同步**：列出 master 共享目录的**全部文件**，勾选后拉取到**本机 downloads 目录**；列表中标出哪些文件属于当前种子。
6. slave 在本机数据目录下**按 master 分别记录**：`<masterMachineId>.json`，保存同步时间戳、动作、以及原样保存的 `update.json`。

本设计取代此前讨论中「master 群发 offer 推送」的方案（已确认取消推送）。

## 2. 现状与扩展点

- 协作引擎：`server/collaboration/engine.js`（`CollabEngine`）。已有 downloads（master 共享目录）与「slave 点击才拉取」链路：
  - `pullDownloads()`（engine.js:392）→ peer `PULL_DOWNLOADS` → `_inPullDownloads()`（engine.js:414）。
  - `readManifest/writeDownload`（engine.js:322-342）维护 `<downloadsDir>/manifest.json`。
- peer 信封：`CollabPeer`（`shared/collab.js` / `shared/collab.d.ts`）+ `_sign/_post/handleIncoming`（engine.js:241）。
- HTTP 挂载：`server/collaboration/http-mount.js`（`/api/collab/*`）。
- 本地 WS 广播：`server/index.js` 的 `eventBus` → `broadcastCollab`；前端 `CollaborationView.vue` 订阅 `CollabS2C.*`。
- 前端协作页：`web/src/collaboration/GroupView.vue`（左栏设置 + downloads 区，当前 `v-if="remoteState.enabled"` 仅 master 可见）、`CollaborationView.vue`（全局容器）、`useCollab.ts`。
- 数据目录：`server/workspace.js` `profilePaths(dir)` → `dir`（档案根）、`downloadsDir = <dir>/downloads`、`storeFile = <dir>/collab/collab.json`。
- 相关既有实现（**保持独立、不复用**）：`server/workflow-seed.js` 的 `workflows.seed.json`（本机工作流变更的单调版本），与本设计的 `update.json` 语义不同。

## 3. 数据文件

### 3.1 master：`<profileDir>/downloads/update.json`

```json
{
  "version": "2026-09-15 10:30:00",
  "updatedAt": 1757941800123,
  "files": [
    { "name": "group.json", "kind": "group", "size": 123, "sha256": "…" }
  ]
}
```

- `version`：保存时的**本机本地时间**，定长格式 `YYYY-MM-DD HH:mm:ss`（秒级）。定长 → 字符串字典序 = 时间序，直接比较。
- 同一秒内重复保存导致 `version` 与上次相同 → 自动 `+1 秒`，保证严格递增。
- `files`：master 在本机 `manifest.json` 中**勾选**的文件子集（含 `name/kind/size/sha256`）。
- 该文件写入 `downloadsDir`，但对普通下载列表隐藏（见 §6）。

### 3.2 slave：`<profileDir>/sync/<masterMachineId>.json`

```json
{
  "masterId": "…",
  "version": "2026-09-15 10:30:00",
  "action": "accept",
  "checkedAt": 1757941805000,
  "update": { "version": "…", "updatedAt": 0, "files": [] }
}
```

- 每个 master（hub）一个文件，互不覆盖。
- `version`：本机最近一次**确认过**（同意或拒绝）的 master 版本；`applyUpdate` 时更新。
- `action`：`accept` | `reject`。
- `update`：原样保存该版本 master 的 `update.json`（便于审计/展示上次同步内容）。
- 目录不存在时自动创建；原子写（`.tmp` + rename）。

## 4. 服务端

### 4.1 新模块 `server/collaboration/sync-seed.js`（新增）

- `formatVersion(date = new Date())` → `"YYYY-MM-DD HH:mm:ss"`（本地时间，`pad2`）。
- `nextVersion(prevVersion, now)`：若新格式化值与 `prevVersion` 相同则 `+1 秒`，保证严格递增。
- `readUpdate(dir)` / `writeUpdate(dir, update)`：读写 `<dir>/update.json`（缺省 `{ version: '', updatedAt: 0, files: [] }`；写入原子）。
- `recordPath(syncDir, masterId)` / `readRecord` / `writeRecord(syncDir, masterId, record)`：读写 slave 记录。

### 4.2 `CollabEngine`

- 构造新增注入：`syncDir`（slave 记录目录，`<profileDir>/sync`）。
- `publishUpdate(names)`：取 `readManifest().files` 中 `names` 的子集 → `version = nextVersion(当前 update.version, now)` → `writeUpdate(downloadsDir, …)`；返回 `{ code:'ok', update }`；`_emit('synced')`。
- `readUpdate()`：读 master 的 `update.json`（供 UI 展示当前种子）。
- peer `UPDATE_CHECK` → `_inUpdateCheck(env)`：校验 `env.from` 是本机自有群（`ownedGroup`）成员；返回 `{ ok:true, data:{ update } }`（无种子返回 `update:null`）。
- peer `LIST_DOWNLOADS` → `_inListDownloads(env)`：校验请求方为本地群成员；返回 `{ ok:true, data:{ manifest, update } }`（master 共享目录的**全部文件清单**，不含内容 + 当前种子）。
- `checkUpdate(masterId?)`：slave 端。
  - 选定目标 hub：传入 `masterId` 或取第一个「`hubId !== self` 且包含自己」的群 → 找 hub 成员 profile。
  - `_post(hub, _sign(UPDATE_CHECK, {}))` → 取回 `update`。
  - 读本机 `recordPath(syncDir, hubId)`；`newer = update && update.version > (record?.version || '')`。
  - 返回 `{ code:'ok', masterId, masterLabel, update, local: record || null, newer }`。
- `listRemoteFiles(masterId?)`：slave 端。定位 hub 后 `_post(hub, _sign(LIST_DOWNLOADS, {}))` → 返回 `{ code:'ok', masterId, masterLabel, manifest, update: seedUpdate }`（供 slave 勾选）。
- `applyUpdate({ masterId, action })`：
  - 解析 hub 与当前 `update`（取最近一次 check 结果，或即时 `UPDATE_CHECK`）。
  - `action === 'accept'`：`pullDownloads(update.files.map(f => f.name), masterId)` 只拉种子内文件并落盘；成功后写记录 `action:'accept'`。
  - `action === 'reject'`：不拉取；写记录 `action:'reject'`。
  - 两种情况都写 `version = update.version`、`checkedAt = now`、`update` 原样保存。
  - 返回 `{ code:'ok', action, version, files: [names] }`；`_emit('synced')`。
- `pullDownloads(names?, masterId?)` / `_inPullDownloads`：`names` 非空时只回传/只接收这些文件（`null`=全量，兼容旧行为）；`masterId` 可指定来源 hub。
- **slave 主动拉取**（手动勾选）不改写本机确认记录（`sync/<masterId>.json`）；记录仅由 `applyUpdate` 的同意/拒绝推进（避免手动操作影响版本确认语义）。

### 4.3 `http-mount.js` 新增路由

- `POST /api/collab/update/publish { names }` → `engine.publishUpdate(names)`（非 hub 返回 `not-master`）。
- `GET  /api/collab/update` → `{ update: engine.readUpdate() }`（本机展示当前种子）。
- `POST /api/collab/update/check { masterId? }` → `engine.checkUpdate(masterId)`。
- `POST /api/collab/update/apply { masterId, action }` → `engine.applyUpdate(...)`。
- `GET  /api/collab/downloads/remote { masterId? }` → `engine.listRemoteFiles(masterId)`（slave 列 master 文件）。
- `POST /api/collab/downloads/pull { masterId?, names }` → `engine.pullDownloads(names, masterId)`（slave 拉选中文件）。

### 4.4 `index.js` 注入

- `syncDir: path.join(paths.dir, 'sync')` 传给 `CollabEngine`；启动时确保目录存在。

## 5. 前端

### 5.1 master（`GroupView.vue`，当前群 `hubId === 本机`）

- 「同步配置到 Slave 群成员」区域：本机 `manifest` 文件行前加勾选框（`selectedFiles: Set<string>`）+「全选 / 全不选」。
- 按钮「保存同步种子」→ `POST /api/collab/update/publish { names }`；成功后提示「已保存，版本 {version}」。
- 顶部展示当前种子版本（`GET /api/collab/update`，`version || '—'`）。

### 5.2 slave（`GroupView.vue`，当前群 `hubId !== 本机`）

- 新增「从 master 同步」区域：`GET /api/collab/downloads/remote` 拉取 master **全部文件清单**；
  - 每行勾选框；属于当前种子的文件加「种子」标记（`update.files` 命中）。
  - 「全选 / 全不选」+「同步选中」→ `POST /api/collab/downloads/pull { masterId, names }` → 落本机 downloads 目录；成功后刷新本机列表并提示。
- 展示 master 当前种子版本与「检查更新」按钮。

### 5.3 slave 自动弹窗（`CollaborationView.vue`，全局）

- 挂载时对每个 hub 调 `POST /api/collab/update/check`；任一 `newer` → 写入 `pendingUpdate` → **自动弹窗**。
- 弹窗展示：版本号、来源 master（工号@IP）、文件清单（名称/大小）。
  - 「同意同步」→ `POST /api/collab/update/apply { masterId, action:'accept' }` → 切换为结果视图（已同步文件列表）。
  - 「拒绝」→ `POST /api/collab/update/apply { masterId, action:'reject' }` → 关闭。
- `useCollab.ts` 新增：`getUpdate()`、`publishUpdate(names)`、`checkUpdate(masterId?)`、`listRemoteFiles(masterId?)`、`pullDownloads(names, masterId?)`、`applyUpdate(masterId, action)`。

### 5.4 本地 WS

- 不新增 S2C 类型：slave 的 check/apply/pull 由前端主动调用；`applyUpdate`/`pullDownloads` 内部 `_emit('synced')` 会复用现有 `COLLAB_SYNCED` 刷新快照。

## 6. 边界与取舍

- **无推送**：仅 slave 主动检查（启动 / 进入协作页 / 手动），不做后台轮询。
- `update.json` 与 `manifest.json` 一样从下载文件列表中排除（`listDownloadFiles` 忽略）。
- 版本为定长本地时间字符串；比较用字符串 `>`。跨时区/改系统时间不保证单调语义（接受；同一秒内 `+1s` 兜底）。
- 拒绝也写记录并推进到该版本 → 同一版本不再重复弹窗；master 后续保存（新时间戳）会再次提示。
- 拉取沿用 peer `PULL_DOWNLOADS`（加 `names`/`masterId`），新增 `LIST_DOWNLOADS` 仅返回清单，不新增内容协议。
- slave 主动拉取不推进确认版本（见 §4.2）；如需“拉全了就别再弹”，用户可在弹窗里点同意/拒绝。
- 服务端写盘失败 best-effort（记日志，不抛出）；`update.json` 缺失时 `checkUpdate` 返回 `newer:false`。

## 7. i18n

中英对称新增（示例，实施时以两文件键集合对称为准）：

| key | zh-CN | en |
| --- | --- | --- |
| `collab.update.version` | 种子版本 {version} | Seed version {version} |
| `collab.update.select_all` | 全选 | Select all |
| `collab.update.save_seed` | 保存同步种子 | Save sync seed |
| `collab.update.saved` | 已保存，版本 {version} | Saved, version {version} |
| `collab.update.check` | 检查更新 | Check for updates |
| `collab.update.available` | master 有新的同步种子（版本 {version}） | Master has a new sync seed (version {version}) |
| `collab.update.from` | 来源 | From |
| `collab.update.accept` | 同意同步 | Sync now |
| `collab.update.reject` | 拒绝 | Decline |
| `collab.update.synced` | 已同步 {count} 个文件 | Synced {count} file(s) |
| `collab.update.rejected` | 已拒绝本次更新 | Update declined |
| `collab.update.latest` | 已是最新 | Already up to date |
| `collab.update.pull_title` | 从 master 同步 | Sync from master |
| `collab.update.pull_selected` | 同步选中 | Pull selected |
| `collab.update.seed_badge` | 种子 | Seed |
| `collab.update.pulled` | 已拉取 {count} 个文件 | Pulled {count} file(s) |
| `collab.update.no_remote` | 未找到 master | No master found |

提交前 `npm run check:i18n` 通过（`web/src`、`server` 零中文命中）。

## 8. 测试与验收

- 单测：
  - `server/test/collab-sync-seed.test.js`：`formatVersion` 定长、`nextVersion` 同秒 `+1s`、读写往返、`writeUpdate` 原子。
  - 扩展 `server/test/collab-engine.test.js`：
    - `publishUpdate` 写 `update.json` 且 files 为选中子集；
    - `_inUpdateCheck` / `_inListDownloads` 非成员返回 `not-member`，成员返回种子/清单；
    - `checkUpdate` 版本比较（master > 本地 → `newer:true`）；
    - `applyUpdate(accept)` 只拉取种子内列出的文件；`applyUpdate(reject)` 不改文件但写记录且 `version` 更新；
    - `pullDownloads(names)` 只拉选中文件；`pullDownloads(null)` 全量不变。
  - 扩展 `server/test/collab-http.test.js`：新端点冒烟（publish → check → remote 列表 → pull → apply）。
- 全量：`npm test`、`npm run typecheck`、`npm run check:i18n`、`npm run build:web`。
- 人工验收：master 勾选并保存 → 版本为当前时间；重启 slave 进入协作页 → 自动弹窗显示该版本；同意后本地出现对应文件，拒绝后不再弹同一版本；slave 在群组里勾选 master 文件 → 拉取到本机 downloads 目录。

## 9. 明确不做（YAGNI）

- 不做 master→slave 推送、不做后台定时轮询。
- 不做多 master 同时更新的冲突合并（各 master 独立记录，逐个提示）。
- 不做增量 diff/断点续传（整文件按清单拉取）。
- 不做历史版本回滚、不做种子内容编辑器（直接在 downloads 目录产物上勾选）。

## 10. 决策记录

- master 不主动推送、slave 主动检查：用户明确。
- 版本号为带日期的秒级时间戳（`YYYY-MM-DD HH:mm:ss`）：用户明确。
- 同意/拒绝都推进本机记录版本，拒绝后不重复弹窗：用户明确。
- slave 在数据目录按 master 分文件记录（含同步时间戳 + update.json 原文）：用户明确。
- 种子文件命名 `update.json`：用户明确。
- slave 可主动发起同步、勾选服务端文件拉到本机目录：用户明确。
- slave 勾选列表取 master 全部文件并标出种子成员：用户明确。
