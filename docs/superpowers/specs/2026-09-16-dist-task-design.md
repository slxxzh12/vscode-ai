# 设计文档：分发通知 → 成员本机任务表 → 接受后安装（skills / workflow）

日期：2026-09-16
分支：master
状态：已评审通过（待写实现计划）

## 1. 概述

群主在「分发技能」「分发工作流」里打包并发布后，当前只写了一条没有下载地址、没有类型标记的系统消息，成员需要自己去「任务」页签比对种子 diff 再手动拉取安装。

本设计把这条链路补完整：

1. **群主发布后广播一条「分发通知」消息**（聊天消息，`target = all`）：正文写清**消息类型**（技能升级 / 工作流升级）、**下载地址**，并要求成员去更新。
2. **成员（slave）本机建任务表**：读到 `target = all` 的分发通知后，按类型在本机任务表各建一条任务（技能 1 条、工作流 1 条）。
3. **成员点「接受」**：自动把包拉到本机 → 解包安装 —— skills 装到**本机 agent 对应的技能目录**，command/agent 装到本机 config 对应目录，workflow **与当前 workflow 融合（名字一样直接覆盖）**。

需求原文（用户）：

> 分发技能 和 分发工作流 相关的打包之后，给群成员推送一条消息，target 是 all，下载地址在消息里面写清楚，消息类型也写清楚，要求用户去更新
>
> slave机器需要获取 群组里面消息，对于all 消息，需要在自己本机 建立一个任务表，放到任务表里，对于升级skills 或者workflow，分别产生一条任务
>
> 接受之后，skills 安装到当前机器agent 对应skill 目录里面
>
> workflow跟当前的workflow融合起来，如果workflow名字一样，那么直接覆盖掉

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 消息如何承载类型 + 地址 | 新增聊天消息 `kind:'dist'`；正文 i18n 可读（含类型与地址），`meta` 带结构化字段，成员不解析正文 |
| 2 | 任务粒度与去重 | 一条通知按类型拆任务（有技能类资产 → 1 条 `skills`，有 workflow → 1 条 `workflow`）；唯一键 `(group_id, kind, hash)`，同 hash 不重建、hash 变了才更新 |
| 3 | 成员如何获取群消息 | 实时（WS/peer 收到即处理）+ 启动/入群补扫（扫历史 `dist` 消息）；额外维护「已扫到哪条消息」的游标 |
| 4 | 点「接受」装什么 | 全装：skills → 本机 agent 技能目录，command/agent → 本机 config 对应目录，workflow → 融合本地 workflows |
| 5 | workflow「名字一样」的判定 | 按 `label`（显示名）判定；同名覆盖内容但**保留本地 id**（已有会话/引用不失效） |
| 6 | UI 呈现 | 「任务」页签顶部新增「分发任务」区（保留既有种子 diff 区）；群聊 `dist` 消息渲染成小卡片 |

## 3. 现状（改动前）

- 分发链路：UI「🛠 分发技能」/「🧩 分发工作流」→ `POST /api/collab/packages`（`buildPackage`，本地打 zip，落 `upload/`+`download/`+`downloads/`+`seed` 表）→ `POST /api/collab/packages/:id/publish`（`publishPackage`，master 专属，把 zip 写进本机 `downloads/skills/<uuid>-<label>.zip`）。
- 成员取包：`pullDownloads(names, masterId)` 走 **peer 签名通道**（`PULL_DOWNLOADS` → master 的 `_inPullDownloads`），不依赖 HTTP 下载与令牌。
- 安装：`installDownload(name)` → `installBundleZip({ zip, skillRoot, configRoot, installWorkflows })`；workflow 走 `engine.mergeWorkflows`（`server/index.js` 注入，**当前按 `id` 合并**）。
- 聊天消息体：`{ id, groupId, kind:'text'|'system'|'cmd-result', fromId, text, toId, ts, seq, meta }`；落 `collab-db` 的 `message` 表（列含 `target`）。
- 聊天拉取由前端驱动：`GroupChatView.pullFromHub()` → `POST /api/collab/groups/:id/chat-pull` → `applyChatPull`；服务端目前没有定时补扫。
- 「任务」页签（`TasksView.vue`）现在只展示「各 master 的种子文件 diff」。
- 数据库单一文件 `<数据目录>/void.db`，现有 5 张表：`usage`/`seed`/`member`/`member_command`/`message`。

## 4. 架构与数据流

```
群主：打包 → 发布（publishPackage 成功）
        └─ _broadcastDist(groupId, pkgInfo)
             ├─ 聊天里插一条 kind:'dist' 消息（正文 i18n + meta 结构化）
             ├─ _logMessage({ target:'all' }) → collab-db.message
             └─ _broadcastChat 推给全体成员（CHAT_SEND）
                     ↓（成员 side）
成员：收到 kind:'dist'（实时） / 启动补扫拉到历史 dist 消息
        └─ ingestDist(msg)：校验 fromId === group.hubId
             └─ 按 kind 各 upsert 一条 task（UNIQUE(group_id, kind, hash)）
                     ↓（用户在「任务」页）
成员：点「接受」
        ├─ pullDownloads([name], hubId)    ← peer 签名通道拉包
        ├─ installDownload(name)           ← skills/command/agent 落本机目录；workflow 融合
        └─ status='done'（失败 → 'failed'）
```

## 5. 消息协议：`kind:'dist'`

```js
{
  id, groupId, kind: 'dist', fromId: <群主 machineId>, toId: null, ts, seq,
  text: <i18n 正文，见 5.2>,
  meta: {
    target: 'all',
    type: 'skills' | 'workflow' | 'mixed',   // 仅用于正文/卡片文案；任务拆分不依赖它（见 7）
    name: 'skills/<uuid>-assets-3-ab12cd.zip',
    url: 'http://<host>:<port>/api/collab/downloads/file/skills%2F<...>.zip',
    hash, size, count,
    skills: ['a', 'b'], command: [...], agent: [...],
    workflow: [{ id, label }],
    skillsUpdatedAt, workflowUpdatedAt,
    packageId,
  },
}
```

### 5.1 下载地址

- `url` 指向群主本机的共享下载路由 `/api/collab/downloads/file/<name>`；`name` 含 `/` 时整段 `encodeURIComponent`（路由是按 `/` 切分后再 `decodeURIComponent`，因此单段编码可用）。
- **不带 `access` 令牌**（聊天记录会落库并广播，令牌等同访问口令，不能进消息）。
- 人可用手机/浏览器手动下载（前提是已通过邀请链接换过访问 Cookie）；**成员点「接受」时走 peer 签名通道自动拉取**，不依赖该 URL。

### 5.2 正文词条（中英各一条，`{type}` / `{name}` 插值）

| key | zh-CN | en |
| --- | --- | --- |
| `collab.dist.msg.skills` | 【技能升级】群主发布了新的技能包：{name}（含 {count} 项）。下载地址：{url} —— 请到「任务」页点「接受」完成更新。 | [Skills update] The host published a new skills package: {name} ({count} items). Download: {url} — open the Tasks tab and click Accept to update. |
| `collab.dist.msg.workflow` | 【工作流升级】群主发布了新的工作流：{name}（含 {count} 个）。下载地址：{url} —— 请到「任务」页点「接受」完成更新。 | [Workflow update] The host published new workflows: {name} ({count}). Download: {url} — open the Tasks tab and click Accept to update. |
| `collab.dist.msg.mixed` | 【技能 / 工作流升级】群主发布了新的分发包：{name}（共 {count} 项）。下载地址：{url} —— 请到「任务」页点「接受」完成更新。 | [Skills / workflow update] The host published a new bundle: {name} ({count} items). Download: {url} — open the Tasks tab and click Accept to update. |

## 6. 数据库：本机任务表 + 游标（仍在单一 `void.db`）

```sql
CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  hub_id TEXT,
  kind TEXT NOT NULL,            -- 'skills' | 'workflow'
  hash TEXT NOT NULL,            -- 包内容 hash（去重键的一部分）
  name TEXT,                     -- downloads 里的 zip 名
  url TEXT,                      -- 展示/手动下载用
  payload TEXT,                  -- JSON：{skills,command,agent,workflow,skillsUpdatedAt,workflowUpdatedAt,count,size}
  status TEXT NOT NULL,          -- 'pending' | 'done' | 'ignored' | 'failed'
  message_id TEXT,               -- 来源消息 id
  created_at INTEGER, updated_at INTEGER,
  UNIQUE (group_id, kind, hash)
);
CREATE TABLE IF NOT EXISTS task_cursor (
  group_id TEXT PRIMARY KEY,
  last_ts INTEGER,
  last_id TEXT,
  updated_at INTEGER
);
```

- 「本机任务表」只存本机该做的事，与 `seed`（打包记录）、`message`（群消息）无关。
- 群主本机不建任务：`ingestDist` 只处理 `groupId` 的群主发来的消息，且跳过 `fromId === 本机 machineId`。
- 迁移：`createCollabDb` 里 `CREATE TABLE IF NOT EXISTS` 即可（不动现有 5 张表）；表数从 5 张变 7 张，实现时同步更新 `AGENTS.md` 的数据目录说明。

## 7. 触发与 ingest

三个入口，全部幂等：

1. **实时**：`_inChatSend`（peer 收到聊天消息）与本地广播路径里，`msg.kind === 'dist'` → `ingestDist(msg)`。
2. **拉取落库**：`applyChatPull({ groupId, messages })` 内扫描 `kind === 'dist'` 的消息 → `ingestDist`。
3. **启动补扫**：workspace ready 后，对每个「我是成员且 hub 不是我」的群调用 `pullChatFrom(hubId, { groupId })`，把结果交给 `applyChatPull`；失败只记日志（等下次心跳/拉取）。

**任务 kind 的判定**：由 `meta` 里各资产是否非空决定（`workflow` 非空 → 建 `workflow` 任务；`skills`/`command`/`agent` 任一非空 → 建 `skills` 任务），**不依赖 `meta.type`**（后者只用于文案）。

**幂等与游标**：

- 任务侧幂等由 `UNIQUE(group_id, kind, hash)` 保证：`INSERT ... ON CONFLICT DO UPDATE` 只刷新 `name/url/payload/updated_at`，且仅当原 `status = 'pending'`（即不把 `done`/`ignored` 拉回 `pending`）。
- 游标 `task_cursor`（每群一行，`last_ts` + `last_id`，只增不减）：**实时与批量两条路径都在成功处理某条消息后调用 `advanceCursor(groupId, msg)`**；扫描时跳过 `(ts, id)` 不大于游标的消息。
- 游标只是性能优化：即使游标丢失或滞后，重复扫描也不会重复建任务（幂等键兜底）。

**校验**：`ingestDist` 要求 `msg.groupId` 存在、`msg.fromId === group.hubId`、`group.members` 含本机、`meta.hash` 与 `meta.name` 非空、`meta.type ∈ {skills, workflow, mixed}`；任一不满足直接忽略（不报错）。

## 8. 接受 / 忽略（API + engine）

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/collab/tasks` | 返回本机任务表（含 `status` 过滤参数可选） |
| POST | `/api/collab/tasks/:id/accept` | `engine.acceptTask(id)` |
| POST | `/api/collab/tasks/:id/ignore` | `engine.ignoreTask(id)` |

`acceptTask(id)` 流程：

1. 找任务；`status !== 'pending' && status !== 'failed'` → `{ code: 'not-pending' }`。
2. 找包：本地 `downloadsDir/<name>` 不存在则 `pullDownloads([name], hubId)`（peer 通道）；仍不存在 → `status='failed'`，`{ code: 'file-missing' }`。
3. `installDownload(name)`（复用现有 `installBundleZip`）：
   - `skills/<name>/**` → `engine.skillRoot()`（本机 agent 对应技能目录，即 `<数据目录>/skills-opencode/`；`DEVFLOW` 环境变量可覆盖）
   - `command|agent/**` → `engine.configRoot()/<kind>/`
   - `workflow/workflows.xml` → `mergeWorkflows(list)`
4. 成功 `status='done'`、`updated_at=now`，`_emit('synced', {})`；失败 `status='failed'` 并把错误写进 `payload.lastError`（不新增列）。

`ignoreTask(id)`：`status='ignored'`，不删行（同 hash 不再打扰；hash 变了会产生新行）。

## 9. workflow 融合：同名（label）覆盖、保留本地 id

`server/index.js` 注入的 `mergeWorkflows(incoming)` 从「按 `id` 合并」改为：

1. 读本地 `workflows`。
2. 对每个 `incoming` 工作流 `w`：
   - 先按 `label`（`String(w.label||'').trim()`）在本地找同名项；命中 → 用 `{ ...local, ...w, id: local.id }`（**内容覆盖、id 保留本地**）。
   - 未命中 → 按 `id` upsert（保留既有兼容行为）。
3. `updateWorkflows(configFile, merged)` 落盘。

## 10. UI

### 10.1 「任务」页签（`TasksView.vue`）

- 顶部新增「分发任务」区（在现有「种子」区之上）：
  - 分组：待接受 / 已完成 / 已忽略（可用简单筛选或分区展示）
  - 每条：类型图标（🛠 技能 / 🧩 工作流）、任务名、数量与大小、来源群与群主、时间、下载地址（可点）、状态
  - 按钮：`接受`（pending/failed）、`忽略`（pending）
  - 空态文案、操作结果提示
- 现有种子 diff 区保留在下方，不改逻辑。

### 10.2 群聊（`GroupChatView.vue`）

- `kind === 'dist'` 的消息渲染为卡片：📦 + 类型标签（技能升级 / 工作流升级）+ 名称 + 下载地址链接 + 「去任务页接受」按钮（切到「任务」页签）。

### 10.3 i18n 新增词条（中英对称）

`collab.task.*`：`dist_title`、`dist_empty`、`kind.skills`、`kind.workflow`、`accept`、`ignore`、`status.pending|done|ignored|failed`、`accepted`、`ignored`、`accept_failed`、`goto_tasks`、`from_group`、`download_addr`；
`collab.dist.msg.skills` / `collab.dist.msg.workflow`（见 5.2）。

## 11. 测试与验收

**server**

- `publishPackage` 成功后产生 `kind:'dist'` 消息：`meta.target='all'`、`type` 正确、`url` 含编码后的文件名、`collab-db.message` 里 `target='all'`。
- `ingestDist`：技能包 → 只建 1 条 `skills` 任务；工作流包 → 只建 1 条 `workflow` 任务；同时含两者 → 2 条任务。
- 幂等：同 hash 重复 ingest 不新增行；hash 变 → 更新原任务且 `status` 保持（`done`/`ignored` 不被翻回）。
- 游标：第二次 ingest 同一批消息不再命中（游标已推进）。
- 校验：非群主发的 `dist`、非成员群、缺 hash → 不建任务。
- `acceptTask`：本地无包时走 `pullDownloads`；skills 落到 `skillRoot()`、command/agent 落到 `configRoot()`、workflow 融合；`status='done'`；失败置 `failed`。
- `mergeWorkflows`：`label` 同名 → 覆盖内容且 id 保持本地；不同名 → 新增；同 id 不同名 → 覆盖（兼容旧行为）。

**web**

- `TasksView`：任务列表渲染、接受/忽略调用与状态刷新、空态。
- `GroupChatView`：`dist` 消息卡片渲染（类型标签 + 地址链接 + 跳转按钮）。

**回归与命令**

- `npm.cmd test`（server + web）、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 全绿。
- 人工：master 分发技能 → 成员聊天出现 dist 卡片、任务页出现 1 条技能任务 → 接受 → 本机 `skills-opencode/<name>` 出现、任务变已完成；分发工作流 → 接受 → 本机 `devflow.xml` 里同名工作流被覆盖（id 不变）。

## 12. 边界与取舍

- **不改老通道**：`sendPackage`（FILE_PUSH）与 `distributeToGroup`（SKILL_PUSH）本轮不发 dist 通知（UI 未使用；需要时可后续接同一 `_broadcastDist`）。
- **下载地址不带令牌**：为避免把访问口令写进聊天记录，URL 只作为人工下载入口；机器侧一律走 peer 签名通道。
- **只认群主**：成员发的 `dist` 消息不建任务（防伪造/防误报）。
- **任务不自动执行**：必须用户点「接受」；不做静默自动升级。
- **workflow 融合保留本地 id**：避免已存在的会话引用失效；同名视为「同一个工作流的新版本」。
- **群主本机不建任务**：内容本就在群主机器上（它自己就是来源）。

## 13. 明确不做

- 不做自动更新 / 定时静默升级。
- 不做增量 diff 安装（整包覆盖式安装）。
- 不做任务的进度百分比、重试队列、依赖顺序。
- 不改 `usage` / `seed` / `member` / `member_command` / `message` 表结构。
- 不做移动端专用任务界面（沿用现有 Web UI，移动端自适应属后续）。

## 14. 决策记录

- 消息用 `kind:'dist'` + `meta` 结构化字段承载类型与地址（用户选 1）：成员读 `meta` 建任务，不解析正文文本。
- 任务粒度按类型拆分、`(group_id, kind, hash)` 去重（用户选 1）：对应「升级 skills 或者 workflow 分别产生一条任务」。
- 获取群消息用「实时 + 启动补扫 + 游标」（用户选 2）：接受多一份游标状态，换更少的历史重扫。
- 「接受」= 全装（skills/command/agent/workflow 全部落位）（用户选 1）：与现有 `installDownload` 行为一致。
- workflow 按 `label` 同名覆盖且保留本地 id（用户选 1）。
- UI 在「任务」页签顶部新增分发任务区、群聊渲染 dist 卡片（用户选 1）。
- 设计整体经用户确认「可以的」。
