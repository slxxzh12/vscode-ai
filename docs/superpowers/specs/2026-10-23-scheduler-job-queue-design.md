# 定时任务作业队列设计（Kafka 式分区 + MySQL/SQLite）

日期：2026-10-23
状态：待复核

## 背景

现有定时任务（`server/scheduler/`）到点后直接在进程内 `startRun`：

- 并发达到 `maxConcurrent` 时，本次触发被直接丢弃。
- 手动运行遇到同一任务正在执行时返回 `already-running`。
- 运行记录只存在本机 `runs.json`，无法跨机器共享。
- 没有排队、待审、重试、取消等作业生命周期管理。

目标是把定时任务改造成**生产者 - 消费者**模型：

- 定时任务只负责**生产作业**，写入共享队列。
- worker 按 partition 消费作业并执行。
- 新增独立的「作业队列」页面，形成可观测、可操作的作业管理列表。

## 目标

- 作业入队后不再因为并发不足而丢失。
- 用 topic + partition 模型实现「partition 内串行、partition 间并行」。
- 支持 MySQL（多机共享）与 SQLite（单机）两种队列后端。
- 支持 worker 注册、心跳、partition 分配与离线重分配。
- 支持待审、批准/驳回、取消、重试、失败原因、执行机器等作业管理能力。
- 作业记录成为唯一事实源，任务历史、汇总、报告都从队列表读取。

## 非目标

- 不做多 topic 管理界面，只保留默认 topic。
- 不做 partition 减少、跨 topic 路由、日志集中存储。
- 不做旧 `runs.json` / 旧报告迁移。
- 不做 MySQL 表结构自动迁移工具，只做建表与必要字段的幂等补齐。
- 不做作业执行的分布式事务或 exactly-once 语义。

## 术语

- **topic**：队列主题，默认 `scheduler.jobs`。
- **partition**：topic 的分区。同一 partition 内严格串行，不同 partition 可并行。
- **作业（job）**：一次待执行实例，对应一次运行记录。
- **worker**：执行作业的 devflow 节点；master 本身也是 worker。
- **master / slave**：沿用协作模块的 hub / member 概念；hub 即 master。
- **待审**：作业已入队但需要 master 人工批准后才能执行。

## 总体架构

```text
定时器 / 手动运行（生产者）
        │  写入作业快照
        ▼
共享队列（MySQL 优先，否则 SQLite）
  t_sched_job / t_work_status / t_sched_config
        ▲                    │
        │ 心跳 / 分配 partition │ 轮询领取
        │                    ▼
master（分配者 + worker）   各 worker（消费者）
                             │
                             ▼
                     runner / workflowExecutor
                             │
                             ▼
                 结果与报告写回 t_sched_job
```

- 生产者与消费者可以不在同一台机器（MySQL 模式）。
- SQLite 模式退化为单机：本机同时是 master、worker、生产者、消费者。

## 存储后端

### 选择规则

1. 配置了 MySQL 连接 → 使用 MySQL。
2. 未配置 → 使用本地 SQLite，落现有 `<端口数据目录>/void.db`。
3. 配置了 MySQL 但运行时连接失败：**不静默回落 SQLite**，停止消费并在队列页显示错误，每 10s 重连，避免队列分裂。

### MySQL 配置

- master 在「队列设置」里填写：`host / port / user / password / database`。
- 配置落 `<端口数据目录>/scheduler/queue.json`。
- 密码使用现有 `navicat-crypto` 的 `seal/open` 加密落盘；接口只返回 `hasPassword`，永不回传明文。
- slave 加入群后，经现有群成员签名同步通道拿到配置，并在本机同样加密保存。
- 同步通道是局域网 HTTP，安全级别与现有群令牌一致；不额外引入 TLS。

### partition 数配置

- 存共享配置表 `t_sched_config`，键 `partitionCount`，默认 `16`。
- 只允许增加，不允许减少。
- 增加时由 master 重新计算 `status in (0, 4)` 的作业的 `partitionId`，执行中的 `status = 3` 不动。

### 建表

- 启动时执行 `CREATE TABLE IF NOT EXISTS`。
- 对已有表做缺失字段的幂等补齐（`ALTER TABLE ... ADD COLUMN`，存在则跳过）。

## 数据模型

### t_sched_job

| 字段 | 类型 | 语义 |
|---|---|---|
| jobId | VARCHAR(64) PK | 作业 ID；每次入队、重试都是新 ID |
| parentJobId | VARCHAR(64) NULL | 重试/派生作业指向原作业 |
| topic | VARCHAR(64) NOT NULL | 默认 `scheduler.jobs` |
| groupName | VARCHAR(128) NULL | 任务分组，默认 `default`；供筛选 |
| partitionId | SMALLINT NOT NULL | `hash(topic + taskId) % partitionCount` |
| uniqueKey | VARCHAR(191) NULL | 用户可选指定；仅 `status = 0` 时参与唯一约束 |
| activeKey | VARCHAR(191) NULL | 内部列：`status = 0` 时等于 `uniqueKey`，否则 NULL |
| classname | VARCHAR(128) NOT NULL | 固定 `scheduler.task`（Node 无 Java 类概念） |
| methodName | VARCHAR(64) NOT NULL | 任务类型 `shell / ai / script / workflow` |
| paramStr | LONGTEXT NULL | JSON 快照：任务配置 + 触发信息 |
| result | LONGTEXT NULL | JSON 结果：退出码、错误、耗时、报告、日志路径、会话 ID |
| status | TINYINT NOT NULL | 见状态码 |
| weight | INT NOT NULL DEFAULT 0 | 同 partition 内越大越先；相同按 `createTime` FIFO |
| runtime | BIGINT NULL | 实际耗时（ms） |
| maxRunMilliSecond | INT NOT NULL | 单作业超时 |
| createIP | VARCHAR(64) NULL | 生产机器，`ip:port` |
| workIP | VARCHAR(64) NULL | 执行机器，`ip:port` |
| traceId | VARCHAR(64) NULL | 首次触发生成，重试沿用 |
| createTime | BIGINT NOT NULL | 入队时间（ms） |
| lastUpdateTime | BIGINT NOT NULL | 最后更新时间（ms）；终态时即完成时间 |
| createMachineId | VARCHAR(64) NULL | 内部列：生产者 machineId，用于「仅本机」判断 |
| onlyLocal | TINYINT NOT NULL DEFAULT 0 | 内部列：是否只允许创建机器消费 |

索引：

- `KEY idx_claim (topic, status, partitionId, weight, createTime)`：领取扫描。
- `UNIQUE KEY uk_active (activeKey)`：只对 `status = 0` 且用户填了 `uniqueKey` 的作业生效；`activeKey` 为 NULL 时不受限。
- `KEY idx_task (topic, groupName, createTime)`：按任务/分组筛选。

MySQL 示例：

```sql
CREATE TABLE IF NOT EXISTS t_sched_job (
  jobId VARCHAR(64) NOT NULL PRIMARY KEY,
  parentJobId VARCHAR(64) NULL,
  topic VARCHAR(64) NOT NULL,
  groupName VARCHAR(128) NULL,
  partitionId SMALLINT NOT NULL,
  uniqueKey VARCHAR(191) NULL,
  activeKey VARCHAR(191) NULL,
  classname VARCHAR(128) NOT NULL,
  methodName VARCHAR(64) NOT NULL,
  paramStr LONGTEXT NULL,
  result LONGTEXT NULL,
  status TINYINT NOT NULL,
  weight INT NOT NULL DEFAULT 0,
  runtime BIGINT NULL,
  maxRunMilliSecond INT NOT NULL,
  createIP VARCHAR(64) NULL,
  workIP VARCHAR(64) NULL,
  traceId VARCHAR(64) NULL,
  createTime BIGINT NOT NULL,
  lastUpdateTime BIGINT NOT NULL,
  createMachineId VARCHAR(64) NULL,
  onlyLocal TINYINT NOT NULL DEFAULT 0,
  KEY idx_claim (topic, status, partitionId, weight, createTime),
  KEY idx_task (topic, groupName, createTime),
  UNIQUE KEY uk_active (activeKey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

SQLite 使用同名列，`LONGTEXT` 用 `TEXT`、`BIGINT` 用 `INTEGER`、`TINYINT` 用 `INTEGER`；`uk_active` 用唯一索引（SQLite 允许多个 NULL）。

### t_work_status

| 字段 | 类型 | 语义 |
|---|---|---|
| id | VARCHAR(128) PK | `${machineId}:${topic}` |
| hostport | VARCHAR(128) NOT NULL | worker 访问地址 `ip:port` |
| status | TINYINT NOT NULL | 1 在线 / 0 离线 |
| lastUpdateTime | BIGINT NOT NULL | 最后心跳时间 |
| partitionIds | TEXT NULL | JSON 数组，如 `[0,3,5]` |
| role | VARCHAR(16) NOT NULL | `master` / `slave` |
| version | VARCHAR(32) NULL | devflow 版本 |
| topic | VARCHAR(64) NOT NULL | 默认 `scheduler.jobs` |

MySQL 示例：

```sql
CREATE TABLE IF NOT EXISTS t_work_status (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  hostport VARCHAR(128) NOT NULL,
  status TINYINT NOT NULL,
  lastUpdateTime BIGINT NOT NULL,
  partitionIds TEXT NULL,
  role VARCHAR(16) NOT NULL,
  version VARCHAR(32) NULL,
  topic VARCHAR(64) NOT NULL,
  KEY idx_topic_status (topic, status, lastUpdateTime)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### t_sched_config

共享键值表，先用于 `partitionCount`，后续可扩展。

```sql
CREATE TABLE IF NOT EXISTS t_sched_config (
  k VARCHAR(64) NOT NULL PRIMARY KEY,
  v TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 状态码

| code | 语义 |
|---|---|
| 0 | 排队中 |
| 1 | 成功 |
| 2 | 失败 |
| 3 | 调度中（已领取、执行中） |
| 4 | 待审 |

- 超时、取消、审批拒绝、worker 离线、服务重启中断都记为 `2 失败`，原因写入 `result.error`。
- 终态为 `1` 或 `2`；`0 / 3 / 4` 为非终态。
- `status != 0` 时 `activeKey = NULL`，`uniqueKey` 不参与唯一约束。

## Partition 与 worker

### 默认值

- partition 数默认 16。
- 作业按 `hash(topic + taskId) % partitionCount` 固定到 partition，同一任务稳定落在同一 partition（partition 数增加时可能迁移）。

### 注册与心跳

- worker 启动后每 10s 写一次 `t_work_status`：`hostport`、`status = 1`、`lastUpdateTime`、`role`、`version`、`topic`。
- master 每 10s 扫描一次：
  - `lastUpdateTime` 超过 30s 的在线 worker 标为离线。
  - 把在线 worker 按 `id` 排序，把 16 个 partition 轮流均分，写入各 worker 的 `partitionIds`。
  - 把离线 worker 名下 `status = 3` 的作业标为 `2 失败`，`result.error = worker-offline`。
- worker 每次心跳后重新读取自己的 `partitionIds`，只消费这些 partition。
- master 离线时：现有分配保持不变，不再重平衡；master 恢复后重新均分。期间 master 自己的 partition 无人消费，作业继续排队。
- SQLite 模式：只有本机一个 worker，16 个 partition 全部分配给本机。

## 作业生命周期

### 入队（生产）

定时触发到点后：

1. 生成 `jobId`、`traceId`、`createIP`、`createTime`。
2. 把任务配置、触发方式、计划触发时间等写入 `paramStr`。
3. `methodName = task.type`，`classname = scheduler.task`。
4. `maxRunMilliSecond` 取任务配置；未配置时沿用现有默认（AI 30 分钟，其他 10 分钟）。
5. `status = task.approvalRequired ? 4 : 0`。
6. `status = 0` 且用户填了 `uniqueKey` 时，`activeKey = uniqueKey`；`status = 4` 或未填时 `activeKey = NULL`。
7. 插入失败于唯一索引（已有同 `activeKey` 的排队作业）→ 本次静默跳过，只写服务端日志。

手动「立即运行」：

- 走同样的入队逻辑，但**不使用 `uniqueKey`**（`uniqueKey` / `activeKey` 均为 NULL）。
- 若任务需要审批，同样进入 `4 待审`。

### 审批

- 仅 master 可以批准/驳回；独立运行（无群组）时本机即 master。
- 批准：`status 4 → 0`，`lastUpdateTime` 更新；若 `uniqueKey` 非空则尝试写 `activeKey`，若与现有排队作业冲突则保持待审并返回 `409 unique-key-conflict`。
- 驳回：`status 4 → 2`，`result.error = rejected`。
- 只有 `status = 4` 的作业可以审批。

### 领取

worker 对每个自己负责的 partition 每秒轮询一次：

```sql
START TRANSACTION;
SELECT jobId FROM t_sched_job
 WHERE topic = ?
   AND partitionId = ?
   AND status = 0
   AND (onlyLocal = 0 OR createMachineId = ?)
 ORDER BY weight DESC, createTime ASC
 LIMIT 1
 FOR UPDATE;
UPDATE t_sched_job
   SET status = 3,
       workIP = ?,
       activeKey = NULL,
       lastUpdateTime = ?
 WHERE jobId = ?;
COMMIT;
```

- 每个 partition 同时只有一个 worker，事务 + `FOR UPDATE` 足够，不依赖 `SKIP LOCKED`，兼容 MySQL 5.7+。
- SQLite 模式在单进程内串行领取。
- 领取成功后 emit 本机 `SCHED_RUN_START`，队列页轮询可见。

### 执行

- 从 `paramStr` 还原任务快照，沿用现有 `buildSpawnSpec` / `workflowExecutor`。
- 运行上下文（`run.json`、报告路径、日志路径）沿用现有 `report.js` 约定，路径基于执行机的数据目录。
- 日志仍写执行机本地：`scheduler/logs/<taskId>/<jobId>.log`。
- 报告正文读取后写入 `result.reportMarkdown`（上限 2MB，超出截断）；同时记录 `result.reportFile`。

### 完成

- 成功：`status = 1`。
- 失败/超时/被停止：`status = 2`，原因写 `result.error`。
- 写 `runtime`、`workIP`、`lastUpdateTime`、`result`。
- emit 本机 `SCHED_RUN_END`。

`result` JSON：

```json
{
  "exitCode": 0,
  "error": null,
  "durationMs": 12345,
  "reportFile": "<taskId>/<jobId>/report.md",
  "reportMarkdown": "# ...",
  "logPath": "<执行机绝对路径>/logs/<taskId>/<jobId>.log",
  "sessionId": null,
  "reason": "success | failed | timeout | cancelled | rejected | worker-offline | interrupted | task-deleted"
}
```

### 取消

- `status = 0`：`2 失败`，`reason = cancelled`，同时置 `activeKey = NULL`。
- `status = 3`：调用现有 stop 逻辑终止进程/工作流，`2 失败`，`reason = cancelled`。
- `status = 4`：等同驳回，`2 失败`，`reason = rejected`。

### 重试

- 复制原作业的 `paramStr`，生成新 `jobId`，`parentJobId = 原 jobId`，沿用 `traceId`。
- 不携带 `uniqueKey`，避免与现有排队作业冲突。
- 若任务配置了「需审批」，新作业进入 `4 待审`；否则 `0 排队`。
- 只允许对 `status = 2` 的作业重试。

### 服务重启

- worker 启动时把自己名下遗留的 `status = 3` 作业标为 `2 失败`，`reason = interrupted`。
- 排队与待审作业保留，继续消费。

### 删除任务

- `status in (0, 4)`：标记 `2 失败`，`reason = task-deleted`。
- `status = 3`：停止执行并标记 `2 失败`，`reason = task-deleted`。
- 已完成历史保留（`paramStr` 内有任务名快照）。

### 手动清理

- 队列页提供「清空已完成」和「清空本 partition 已完成」。
- 只删除 `status in (1, 2)` 的记录；不自动清理。
- 日志与报告目录只在本机存在时一并删除；远程机器上的文件不处理。

## HTTP API

### 作业

- `GET /api/scheduler/jobs?status=&taskId=&partition=&limit=`
  - 返回 `{ jobs, summary, partitions }`。
  - `summary`：各状态数量。
  - `partitions`：`[{ id, queued, running, pendingApproval }]`。
- `GET /api/scheduler/jobs/:jobId`
  - 返回单条作业详情，包含 `paramStr` 摘要与报告正文。
- `POST /api/scheduler/jobs/:jobId/approve`（仅 master）
- `POST /api/scheduler/jobs/:jobId/reject`（仅 master）
- `POST /api/scheduler/jobs/:jobId/cancel`
- `POST /api/scheduler/jobs/:jobId/retry`
- `POST /api/scheduler/jobs/cleanup`
  - body：`{ scope: 'finished' | 'partition', partitionId?: number }`

### worker / 配置

- `GET /api/scheduler/workers`：返回 `t_work_status` 列表与在线状态。
- `GET /api/scheduler/queue/config`：返回 `{ backend, host, port, user, database, hasPassword, partitionCount }`；不回传密码。
- `PUT /api/scheduler/queue/config`：仅 master；写配置并测试连接。
- `POST /api/scheduler/queue/test`：测试 MySQL 连接，返回成功/失败原因。
- `PUT /api/scheduler/queue/partitions`：仅 master；只允许增加 partition 数。

### 兼容

- 现有 `/api/scheduler/tasks*` 保留。
- `/api/scheduler/runs*` 移除，由 `/api/scheduler/jobs*` 取代。
- `/api/scheduler/summary` 改为从队列表统计。
- 任务详情使用 `GET /api/scheduler/jobs?taskId=...`。

## 前端

### 作业队列页（独立入口）

- 活动栏新增「作业队列」入口，新增 `web/src/jobs/JobsView.vue` 与 `useJobs.ts`。
- 顶部：
  - `topic`、partition 数、存储后端（MySQL / SQLite）、在线 worker 数。
  - 状态统计卡：`排队 / 调度中 / 待审 / 成功 / 失败`。
- 工具条：
  - 状态筛选、任务名搜索。
  - 「清空已完成」（仅 master）。
  - 「队列设置」（仅 master）：MySQL 连接、测试连接、partition 数。
- Workers 区：`hostport / role / 在线状态 / partitionIds / version / 最后心跳`。
- 主体：16 个 partition 横向分列：
  - 列头：`P<n> · 排队 N · 执行中 N`。
  - 排序：执行中 → 排队（`weight` 降序、`createTime` 升序）→ 已结束（按 `lastUpdateTime` 倒序，默认最多 50 条）。
  - 点 partition 可只看该 partition。
- 作业详情抽屉：
  - `jobId / parentJobId / traceId / partition / groupName / status / createIP / workIP / createTime / runtime`。
  - 任务快照摘要（`paramStr`）。
  - 报告 Markdown 渲染。
  - 日志：仅当 `workIP` 是本机时显示「打开日志目录」，远程作业不提供日志。
  - 操作：待审（master）批准/驳回；排队/执行中取消；失败重试。
- 队列页可见时每 2 秒轮询；不在前台时暂停轮询。

### 定时任务页改动

- 任务编辑器新增可选字段：
  - `需审批`（`approvalRequired`）
  - `仅本机执行`（`onlyLocal`）
  - `uniqueKey`
  - `weight`
  - `maxRunMilliSecond`
- 「立即运行」改为入队；本地 WebSocket 事件仍用于即时刷新。
- 任务详情历史从队列表读取，展示状态、耗时、报告、执行机器。
- 汇总统计从队列表读取；新增「排队 / 待审」计数。
- `runs.json` 不再读写；旧文件保留但不展示。

## 国际化

新增词条（中英同时补齐）：

- `nav.jobs` / `jobs.title`
- `jobs.summary.queued|running|pending|success|failed`
- `jobs.status.queued|running|pending|success|failed`
- `jobs.partition` / `jobs.partition.empty` / `jobs.partition.more`
- `jobs.worker.online|offline|role.master|role.slave|lastHeartbeat`
- `jobs.action.approve|reject|cancel|retry|cleanup|cleanupPartition`
- `jobs.detail.*`（jobId/traceId/param/report/log/openLogDir）
- `jobs.config.*`（title/mysql/host/port/user/password/database/test/partitionCount/backend）
- `jobs.error.task-deleted|worker-offline|interrupted|cancelled|rejected|timeout|unique-key-conflict`
- `sched.field.approval_required|only_local|unique_key|weight|max_run_ms`

## 安全

- MySQL 密码只存加密密文，接口永不回传明文。
- 所有 SQL 参数化，`paramStr` 快照只由服务端生成。
- 报告/日志路径只从队列表记录读取，不接受客户端传路径。
- 审批与队列配置接口校验 master 身份；slave 调用返回 403。
- 队列连接信息同步沿用现有群成员签名通道。

## 兼容与迁移

- 不迁移旧 `runs.json` 与旧报告，页面不再展示；文件保留在磁盘。
- 现有任务定义（`tasks.json` + manifests）不变，只新增可选字段。
- MySQL 不可用时停止消费并重连，不静默回落 SQLite。
- 要求 MySQL 5.7+；建表与补列幂等。

## 测试

Server：

- 队列存储：入队（审批 / uniqueKey / partition / 快照）、领取、完成、取消、重试、清理。
- uniqueKey：仅 `status = 0` 冲突时拒绝；其他状态不占键。
- partition：哈希稳定性、增加 partition 后重哈希 `0/4`、执行中不动。
- worker：心跳、离线判定、partition 均分、离线 worker 名下运行中作业标失败。
- 审批：仅 master 可操作；批准恢复 `activeKey`；驳回写 `rejected`。
- 任务删除：排队/待审/执行中作业标失败；已完成保留。
- 报告：正文写入 `result.reportMarkdown`；超 2MB 截断；日志路径仅本机有效。
- API：`/jobs` 筛选、详情、动作、`/workers`、`/queue/config` 权限与密码不回传。
- SQLite 全流程测试；MySQL 适配层用假连接单测，另提供 `DEVFLOW_TEST_MYSQL` 环境变量下的集成测试（未设置则跳过）。

Web：

- `useJobs`：轮询、筛选、动作调用。
- `JobsView`：16 分区渲染、状态统计、审批/取消/重试、详情抽屉、空状态。
- 任务编辑器：新增字段保存与回显。
- 任务详情：从 `/jobs` 读取历史与报告。
- i18n：中英键集合对称（`check:i18n` / `i18n.test`）。

回归：

- `npm.cmd test`
- `npm.cmd run typecheck`
- `npm.cmd run check:i18n`

## 验收标准

1. 并发已满时，定时触发不再丢失，而是进入 partition 队列。
2. 同一任务连续触发时，按 partition 串行执行；不同任务在不同 partition 并行。
3. 队列页能看到 16 个 partition 的排队、执行中、待审、成功、失败状态。
4. 配置 MySQL 后，两台 devflow 可共享同一队列；worker 注册、partition 分配、离线重分配可见。
5. 未配置 MySQL 时，本机 SQLite 模式可完整跑通入队、消费、审批、重试、取消。
6. 任务设置「需审批」后，作业停在待审；master 批准后才执行，驳回后记失败。
7. 用户指定 `uniqueKey` 时，同一键在排队状态下只保留一条；不指定则不影响重复入队。
8. 服务重启后，排队作业继续执行；重启前的执行中作业标记失败并写 `interrupted`。
9. 删除任务后，其排队/待审/执行中作业结束；已完成历史仍可在队列页查看。
10. 现有任务编辑器、任务详情、汇总统计完成迁移，不再依赖 `runs.json`。

## 风险与限制

- **跨机环境一致性**：跨机执行的 shell/脚本/AI/工作流依赖执行机上的项目、脚本、工作流定义；环境不一致会导致失败。通过任务级「仅本机执行」规避。
- **master 单点**：partition 分配依赖 master；master 离线期间不再重平衡，其 partition 暂停消费。
- **报告大小**：报告正文写 MySQL，2MB 截断；超大报告需从执行机本地目录查看。
- **时钟偏差**：作业排序使用生产机 `createTime`；跨机时钟偏差可能影响同权重作业顺序，要求节点间时间基本同步。
- **MySQL 依赖**：多机模式需要可访问的 MySQL 5.7+；连接失败时队列暂停，不做本地降级。
