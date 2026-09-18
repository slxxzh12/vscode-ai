# 设计文档：成员上传配置给群主审核 + 群主一键打包生成种子

日期：2026-09-18
分支：master
状态：待实现

## 1. 需求

用户原文（按顺序）：

> 协作里面，把 Master 按钮下的 我的群组去掉

> 从 master 同步 ,同步配置到 Slave 群成员 这写按钮页都去掉

> 如果当前用户是群主的话，🛠 分发技能,🧩 分发工作流 这两个可以直接打包，并且制作种子文件

> 如果不是群主的话，打包完成之后，直接调用 master 上传文件的接口，给管理员生成一个任务，管理可以决定接受或者拒绝

> 上传之后的文件放到 upload/ 目录里面

> 然后在群里给 群主发送一条消息

> 群主根据发送的消息，给自己生成一个任务

前两条（去掉「我的群组」「从 master 同步 / 同步配置到 Slave 群成员」）已随本设计一并落地。

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 群主打包 | 「🛠 分发技能」「🧩 分发工作流」弹窗：勾选后一步「打包并生成种子」（打包 + 发布升级），不再分两步 |
| 2 | 非群主打包 | 打包后调用群主「上传文件」接口，群主把 zip 落到自己的 `upload/` |
| 3 | 审核任务来源 | 成员上传成功后在群里发一条 `kind:'pkg-upload'` 消息；群主**根据该消息**给自己生成本机任务（对称于现有 dist 反向流程） |
| 4 | 群主接受 | 把该包发布到群：写共享下载 + 生成升级种子（`publishUpdate`）+ 广播全群 + 群里系统消息 |
| 5 | 群主拒绝 | 删除 `upload/` 里的包与 outbox 记录，任务标 `ignored`，群里发系统消息 |
| 6 | 任务状态 | 复用现有 `pending/done/ignored/failed`，不新增状态 |
| 7 | 传输通道 | 新增 peer 类型 `PKG_UPLOAD`（签名信封），复用现有 `/api/collab/peer` |
| 8 | 群主判定 | `group.hubId === this.pub.machineId` |

## 3. 现状（改动前）

- 打包：`engine.buildPackage({skills,command,agent,workflow})`（`engine.js:152`）→ 生成 zip 写 `uploadDir` + `downloadDir` + 共享 `downloads/`，落 outbox 与 seed 表。
- 发布：`engine.publishPackage(id)`（`engine.js:743`）→ 校验群主 → `writeDownload('skills/<uuid>-<name>')` → `publishUpdate([name])` 写 update.json → `upsertGroupSkill` → `_broadcastDist` 广播 `kind:'dist'` 消息。
- 成员任务：`_broadcastDist` 的 dist 消息被成员 `_inChatSend`/`applyChatPull` → `ingestDist`（`engine.js:322`）落本机 task（kind `skills`/`workflow`）→ `acceptTask` 安装 / `ignoreTask` 忽略。
- 前端：`SkillDistributor.vue` 两步「① 打包」→「发给群生成升级」（仅 `isMaster` 显示）。`DistTaskNotifier.vue` 全局弹窗接受/拒绝；`TasksView.vue` 列表。
- 群聊消息：`_broadcastChat` 发 `CHAT_SEND`；`_inChatSend`（`engine.js:1075`）接收并落库，对 `kind:'dist'` 调 `ingestDist`。
- 文件接收：`_inFilePush`（`engine.js:935`）把文件落到 `downloadDir`（inbox），非 `uploadDir`。

## 4. 设计

### 4.1 群主一键打包生成种子（前端）

- `SkillDistributor.vue`：主按钮改为按角色的一步动作 `doSubmit()`：
  - `isMaster`：`buildPackage` → `publishPackage` → 显示升级版本（`collab.dist.published`）。
  - 非群主：`buildPackage` → `uploadPackage` → 显示「已上传给群主，等待审核」（`collab.dist.uploaded`）。
- 打包完成后仍保留「下载」「重新打包」。
- 移除 `collab.update.pull_title`（从 master 同步）区块与 `collab.downloads.title`（同步配置到 Slave 群成员）区块（`GroupView.vue`），并去掉 Master 下的「我的群组」区块。

### 4.2 上传通道（shared + server）

**shared**
- `shared/collab.js` / `shared/collab.d.ts`：`CollabPeer` 增加 `PKG_UPLOAD: 'pkg-upload'`。

**成员侧 `engine.uploadPackageToMaster(packageId, groupId)`**
1. 校验：群存在、本机是成员、本机非 hub（`is-master` 直接返回）。
2. 从 outbox 取 zip（`uploadDir/<storedFile>`），读成 buffer。
3. 签名 `PKG_UPLOAD`：`{ groupId, name, hash, size, b64, package:{skills,command,agent,workflow} }`，POST 给 hub。
4. 群主返回 `{ packageId }`（群主侧 outbox 记录 id）。
5. 发群聊通知 `_sendPkgUploadNotice`：`kind:'pkg-upload'`，`toId=hubId`，meta `{ type,name,hash,size,count,url,packageId,skills,command,agent,workflow }`，正文 `collab.dist.upload_notice`。
6. 返回 `{ code:'ok', packageId }`。

**群主侧 `_inPkgUpload(env)`**
1. 校验发送者是群成员、本机是 hub。
2. base64 解码，校验 `size` 与 `sha256===hash`。
3. 写 `uploadDir/<assets-<from8>-<ts36>.zip>`。
4. `store.addOutbox({ kind:'file', fileName:name, storedFile, size, hash, package })` → 返回 `{ ok:true, data:{ packageId: rec.id } }`。

### 4.3 群主据消息生成审核任务（server）

- `engine.ingestUploadRequest(msg)`：
  - 校验 `kind==='pkg-upload'`、群存在、本机是 hub、发送者是成员（非本机）、meta 有 `hash`+`packageId`。
  - `taskStore.upsert({ groupId, hubId, kind:'upload', hash, name, url, payload:{skills,command,agent,workflow,count,size,packageId,submittedBy}, status:'pending', messageId })`。
  - `_emit('tasks', { created })`。
- 挂接点：
  - `_inChatSend`：`kind==='dist'` → `ingestDist`；`kind==='pkg-upload'` → `ingestUploadRequest`。
  - `applyChatPull`：同上补扫（拉历史时补任务）。

### 4.4 接受 / 拒绝（server）

- `acceptTask(id)` 增加分支：`task.kind==='upload'` → `_acceptUploadTask(task)`：
  - `publishPackage(task.payload.packageId)`；失败 → status `failed`（payload.lastError）。
  - 成功 → status `done` + `_addSystemMessage(collab.sys.upload_accepted)` + `_emit('tasks')`。
- `ignoreTask(id)` 增加分支：`task.kind==='upload'` → `removeOutbox(packageId)`（删 `upload/` 文件与记录）+ status `ignored` + 系统消息 `collab.sys.upload_rejected`。

### 4.5 HTTP / 前端 API

- `http-mount.js`：`POST /api/collab/packages/:id/upload`（body `{ groupId }`）→ `engine.uploadPackageToMaster(seg[1], body.groupId)`。
- `useCollab.ts`：`uploadPackage(id, groupId)` → 上述路由。
- `distTasks.ts`：`kindKeyOf` 支持 `'upload'` → `collab.task.upload`。

### 4.6 i18n（中英对称）

- `collab.dist.pack_publish`、`collab.dist.pack_upload`、`collab.dist.uploaded`、`collab.dist.upload_notice`
- `collab.task.upload`、`collab.sys.upload_accepted`、`collab.sys.upload_rejected`
- 复用 `collab.task.accept`/`collab.task.ignore`/`collab.task.status.*`。

## 5. 测试与验收

- server（新增 `server/test/collab-upload-review.test.js`，用 `createPairHarness`）：
  - 成员 `uploadPackageToMaster` → 群主 `uploadDir` 出现 zip，outbox 有记录。
  - 群主收到 `pkg-upload` 聊天消息 → `ingestUploadRequest` 建 `kind:'upload'` 的 pending 任务。
  - 群主 `acceptTask` → 任务 `done`、广播 dist、update.json 版本生成。
  - 群主 `ignoreTask` → 任务 `ignored`、`upload/` 文件被删。
- web：
  - `distTasks.kindKeyOf('upload')`。
  - `SkillDistributor`：群主一步调 `buildPackage`+`publishPackage`；非群主一步调 `buildPackage`+`uploadPackage`。
- 命令：`npm.cmd run test:server`、`npm.cmd run test:web`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 6. 不做（范围外）

- 不新建 SQLite 表（复用 task/seed/sync/outbox）。
- 不改现有 dist（群主→成员）推送协议与任务语义。
- 不做上传大小分片/断点续传（沿用现有单次 base64 上限）。
- 不改 `checkUpdate`/`applyUpdate` 既有升级弹窗。
