# 设计文档：群主标记 + 发给群生成升级 + slave 定时轮询与确认安装

日期：2026-09-18
分支：master
状态：待实现

## 1. 需求

用户原文（4 条，按顺序）：

> 在群组里面，展示的时候需要展示哪一个是master

> 同时master打包的发送到downloads 按钮，改成 发给群生成升级，在sqllite里面记录这个skills更新时间，大小，hash码

> slave 定时调用服务端接口 获取接口种子 接口结果，如果master有下发任务，那么在本地任务表里增加一个任务，然后弹出来消息，用户需要确认或者拒绝，确认之后，那么就把skills安装到本地的agent里面

> workflow合并到本地workflow里面

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 群主标记位置 | 成员表（`MemberUsageTable`）对应行加「群主」徽标 |
| 2 | 发布按钮语义 | 「发布到 downloads」→「发给群生成升级」：分发给群 + 生成 version |
| 3 | 升级版本机制 | 复用现有 `publishUpdate`（存 SQLite sync 表），不新建表 |
| 4 | SQLite 记录 | 复用 seed 表，扩展 `detail.skills[]` 每个 skill 的 `updatedAt/size/hash` |
| 5 | 轮询位置 | 成员机**服务端**非阻塞定时器（默认 60s），非前端轮询 |
| 6 | 任务来源 | 复用 `backfillDistTasks()`（拉 master 聊天 → `ingestDist` 建任务） |
| 7 | 弹窗 | 全局（App.vue 挂 `DistTaskNotifier`），任意页签都弹，含确认/拒绝 |
| 8 | 确认动作 | `acceptTask` → skills 落所选 agent 目录 + workflow 合并进本地 workflow |
| 9 | 拒绝动作 | `ignoreTask` |
| 10 | 多群成员表 | 顺带修正：成员表跟随当前选中群（传 `group` prop） |

## 3. 现状（改动前）

### 3.1 群主标记
- 成员表 `web/src/collaboration/MemberUsageTable.vue`：`rows = mergeMachines(peers, snap.group?.members)`，机器列只显示名称/`@host:port`/`不在群内`，无群主标记。
- 群主 = `group.hubId`（成员 `machineId === hubId`）。`GroupView.vue:353` 未把当前选中群传给成员表，导致多群时成员表恒取 `snap.group`（第一个群）。

### 3.2 发布
- 按钮：`web/src/collaboration/SkillDistributor.vue:156`（`isMaster`）→ `doPublish` → `collab.publishPackage(id)`；文案 `collab.dist.publish`=「发布到 downloads」。
- 服务端 `engine.publishPackage(packageId)`（`engine.js:721`）：校验 master → 从 outbox 取 zip → `writeDownload('skills/<uuid>-<name>', buf, 'skill')` → `upsertGroupSkill` → `_broadcastDist` → 返回 `{code,name,size}`。
- 升级版本：`engine.publishUpdate(names)`（`engine.js:618`）从 manifest 取文件（含 `size/sha256`），`nextVersion()` 生成 version 写 `syncStore`（SQLite）。当前**未被 `publishPackage` 调用**。
- seed 记录：`buildPackage`（`engine.js:194-206`）写 `seed` 表（含整包 `hash/size/skills_updated_at`），`detail.skills[]` 仅 `{name, files, updatedAt}`，**缺 size/hash**。
- 单技能 hash：`server/collaboration/skill-packer.js:27 packSkill(dir)` → `{skillName, hash, zip}`（zip 的 sha256）。

### 3.3 轮询与任务
- `engine.ingestDist(msg)`（`engine.js:314`）：dist 消息 → `taskStore.upsert`（`(group_id,kind,hash)` 唯一，幂等）→ `_emit('tasks', {created})`。
- `engine.backfillDistTasks()`（`engine.js:344`）：启动时拉各群聊天补任务；目前只在 `index.js:419` **启动调用一次**，无定时。
- `engine.acceptTask(id)`（`engine.js:765`）：确保包在本地 → `installDownload` → `installBundleZip({skillRoot,configRoot,installWorkflows})` → skills/command/agent 落位 + workflow 交 `mergeWorkflows` → `done`。
- `mergeWorkflows`（`index.js:312`）→ `mergeWorkflowList` + `updateWorkflows`（写 devflow.xml）。
- 事件转发：`index.js:358-364` 转发了 `friend-request/group-invite/inbox/synced/chat/cmd-pending/heartbeat`，**未转发 `tasks`**。
- 前端：`useCollab.listTasks/acceptTask/ignoreTask`（`useCollab.ts:137-139`）；`TasksView.vue` 仅列表，无弹窗。`CollaborationView.vue:60-66` 监听 `COLLAB_*`，无 `tasks`。
- workflow 合并已有测试：`server/test/collab-dist-accept.test.js:46-47`（`merged[0].label==='流程A'`）。

## 4. 设计

### 4.1 群主标记（A）

- `MemberUsageTable.vue`：新增可选 prop `group?: CollabGroup`。
  - `activeGroup = props.group ?? snap.value.group`；`rows = mergeMachines(props.peers, activeGroup?.members)`；`hubId = activeGroup?.hubId`。
  - 机器列在 `row.machineId === hubId` 时加 `<span class="crown">👑 {{ $t('collab.member.master') }}</span>`。
- `GroupView.vue:353`：`<MemberUsageTable ... :group="group" />`。
- i18n：`collab.member.master`（群主 / Master）。

### 4.2 发给群生成升级（B）

- i18n：`collab.dist.publish` → 「发给群生成升级」/「Send to group & create upgrade」；`collab.dist.published` → 「已发送，升级版本 v{version}」/「Sent, upgrade v{version}」。
- `buildPackage`（`engine.js`）：`detail.skills[]` 每项补 `size`、`hash`。
  - 对每个选中 skill 调用 `packSkill(path.join(this.skillRoot(), n))`（已 import 自 `skill-packer.js`），取 `hash` 与 `zip.length` 作 `size`；保留原 `files` 数与 `updatedAt`（目录 mtime）。
- `publishPackage`（`engine.js:721`）：
  - `writeDownload` 后调用 `const up = this.publishUpdate([name]);`，取 `up.update?.version`。
  - `_broadcastDist` 的 info 增加 `version`；返回 `{ code:'ok', name, size, version }`。
- 前端 `SkillDistributor.vue`：`doPublish` 保存返回的 `version`，`msg` 用 `collab.dist.published` 插值显示。
- `useCollab.publishPackage` 返回类型加 `version?: string`。
- dist 卡片文案可选带版本（`distTasks.distCardOf` 不强制改，仅 meta 多一个字段）。

### 4.3 slave 定时轮询 + 任务弹窗 + 安装（C）

**shared**
- `shared/collab.js`：`CollabS2C` 增加 `COLLAB_TASKS: 'collab-tasks'`。

**服务端**
- `engine.js` 新增 `pollDistTasks()`：
  - 调 `backfillDistTasks()`（拉 master 聊天 → 建任务）。
  - 对每个非本机为 hub 的群，调 `checkUpdate(hubId)`（拿最新升级 version，失败忽略）。
  - 返回 `{ code:'ok', groups, tasks, updates }`。
- `http-mount.js`：新增 `POST /api/collab/tasks/poll` → `await engine.pollDistTasks()`。
- `index.js`：
  - `eventBus.on('tasks', (payload) => broadcastCollab(CollabS2C.COLLAB_TASKS, payload))`。
  - 非阻塞定时器：`const distPollMs = Number(process.env.DEVFLOW_DIST_POLL_MS) || 60000; setInterval(() => engine.pollDistTasks?.().catch(()=>{}), distPollMs).unref?.();`

**前端**
- `useCollab.ts`：`pollTasks: () => post<{code:string; tasks?:number; updates?:unknown[]}>('/api/collab/tasks/poll')`。
- 新组件 `web/src/collaboration/DistTaskNotifier.vue`：
  - props `{ terminal }`；自建 `useCollab()`。
  - `onMounted`：`collab.refresh()` + `loadPending()`；订阅 `CollabS2C.COLLAB_TASKS` → `loadPending()`。
  - `loadPending()`：`listTasks('pending')`，非空则 `open=true`（记录已知 id，避免重复弹）。
  - 弹窗（`el-dialog`）列出 pending 任务：kind 文案（`kindKeyOf`）、数量（`taskItemCount`）、包名；每行「确认安装 / 拒绝」。
  - 确认 → `acceptTask(id)`；拒绝 → `ignoreTask(id)`；成功后重新 `loadPending()`，清空则关闭。
  - 可选显示本次升级 version（来自 `pollTasks`/`checkUpdate`），失败不阻塞。
- `App.vue`：挂 `<DistTaskNotifier :terminal="terminal" />`。
- i18n：`collab.dist.task_popup.title`、`...accept`、`...reject`、`...accepted`、`...rejected`、`...empty` 等（中英对称）。

### 4.4 workflow 合并（D）

- 复用现有 `installBundleZip → mergeWorkflows`，无需改代码。
- 补/确认测试：接受含 workflow 的任务后，本地 workflows 增加/覆盖（已有 `collab-dist-accept.test.js`，本次补一条覆盖合并去重的断言）。

## 5. 测试与验收

- server：
  - `publishPackage` 返回 `version`，且 `detail.skills` 含 `size/hash`（新增/扩展测试）。
  - `pollDistTasks()` 在成员侧能从 hub 拉到 dist 补出 pending 任务。
  - `POST /api/collab/tasks/poll` 200 且返回结构正确。
  - workflow 合并（扩展 `collab-dist-accept.test.js`）。
- web：
  - `MemberUsageTable` 群主徽标（扩展 `MemberUsageTable.test.ts`）。
  - `DistTaskNotifier` 有 pending 任务时弹窗、确认调 `acceptTask`、拒绝调 `ignoreTask`（新测试，mock CollabApi + terminal.on）。
  - `useCollab.pollTasks` 打到正确路由（扩展 `useCollab.test.ts`）。
- 命令：`npm.cmd run test:server`、`npm.cmd run test:web`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
- 人工：
  1. 群成员表群主那行显示 👑 群主。
  2. 群主打包 → 点「发给群生成升级」→ 显示升级版本；SQLite seed 有各 skill 的 size/hash。
  3. slave 起服务后 ≤60s 内本地任务表出现任务并弹窗；确认后 skills 进所选 agent 目录、workflow 并入本地；拒绝后任务 ignored。

## 6. 不做（范围外）

- 不新建 SQLite 表（复用 seed/sync/task）。
- 不改成员侧手动任务列表（`TasksView` 保留，与弹窗并存）。
- 不改 dist 的 P2P 推送/签名协议。
- 不做轮询间隔的 UI 配置（用环境变量 `DEVFLOW_DIST_POLL_MS`）。
- 不改 `checkUpdate`/`applyUpdate` 既有升级弹窗（`SyncUpdateDialog`）。
