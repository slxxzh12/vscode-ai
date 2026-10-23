# 定时任务作业队列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把定时任务从「到点直接执行」改成「生产作业 → 共享队列 → 按 partition 消费」，并提供独立的作业队列管理页。

**Architecture:** 新增 `server/scheduler/queue/` 子系统：配置、SQL driver、repository、业务 service、worker 注册/分配、consumer。调度器只负责入队；worker 按 master 分配的 partition 用事务领取作业并执行。队列表是唯一事实源，报告正文写回 `result`，日志留执行机本地。

**Tech Stack:** Node 24 ESM、`node:sqlite`、`mysql2/promise`、Vue 3 + TypeScript、`node:test`、Vitest。

---

## 文件结构

**新增：**

- `server/scheduler/queue/partition.js` — 哈希与 partition 均分纯函数
- `server/scheduler/queue/config.js` — MySQL/SQLite 队列配置与密码加密
- `server/scheduler/queue/schema.js` — 建表 SQL（MySQL / SQLite）
- `server/scheduler/queue/driver-sqlite.js` — SQLite driver
- `server/scheduler/queue/driver-mysql.js` — MySQL driver
- `server/scheduler/queue/repository.js` — 通用 SQL repository
- `server/scheduler/queue/service.js` — 作业生命周期业务逻辑
- `server/scheduler/queue/workers.js` — worker 心跳与 partition 分配
- `server/scheduler/queue/consumer.js` — partition 消费循环与执行
- `server/scheduler/queue/index.js` — 队列装配（按配置选 driver）
- `server/scheduler/jobs-mount.js` — `/api/scheduler/jobs*`、`/workers`、`/queue/*`
- `server/test/scheduler-queue-partition.test.js`
- `server/test/scheduler-queue-config.test.js`
- `server/test/scheduler-queue-sqlite.test.js`
- `server/test/scheduler-queue-mysql.test.js`
- `server/test/scheduler-queue-service.test.js`
- `server/test/scheduler-queue-workers.test.js`
- `server/test/scheduler-queue-consumer.test.js`
- `server/test/scheduler-jobs-http.test.js`
- `web/src/jobs/useJobs.ts` + `.test.ts`
- `web/src/jobs/format.ts` + `.test.ts`
- `web/src/jobs/JobsView.vue` + `.test.ts`

**修改：**

- `shared/scheduler.js` — 状态码、topic、队列常量
- `shared/collab.js` — `QUEUE_CONFIG` peer 消息
- `server/scheduler/store.js` — 任务新增字段；移除 runs
- `server/scheduler/engine.js` — 只做入队
- `server/scheduler/index.js` — 装配队列/worker/consumer
- `server/scheduler/http-mount.js` — 任务接口改用队列；移除 runs 接口
- `server/index.js` — 启动/停止调度器；master/slave 信息
- `server/collaboration/engine.js` — 队列配置拉取
- `web/src/scheduler/useScheduler.ts` — 运行改入队；历史读 jobs
- `web/src/scheduler/SchedulerView.vue` — 新字段、历史/汇总改 jobs
- `web/src/scheduler/format.ts` — 新状态标签
- `web/src/App.vue`、`web/src/windowState.ts` — 新 rail
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js` — 新词条

---

## Task 1: 共享常量与 partition 纯函数

**Files:**
- Modify: `shared/scheduler.js`
- Create: `server/scheduler/queue/partition.js`
- Test: `server/test/scheduler-queue-partition.test.js`
- Modify: `server/test/scheduler-const.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/scheduler-queue-partition.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPartition, assignPartitions } from '../scheduler/queue/partition.js';

test('hashPartition 稳定且落在范围内', () => {
  assert.equal(hashPartition('scheduler.jobs', 't_1', 16), hashPartition('scheduler.jobs', 't_1', 16));
  for (const id of ['t_1', 't_2', 't_3', 't_4']) {
    const p = hashPartition('scheduler.jobs', id, 16);
    assert.ok(p >= 0 && p < 16);
  }
});

test('assignPartitions 轮转均分', () => {
  const map = assignPartitions(['a', 'b', 'c'], 16);
  assert.deepEqual(map.get('a'), [0, 3, 6, 9, 12, 15]);
  assert.deepEqual(map.get('b'), [1, 4, 7, 10, 13]);
  assert.deepEqual(map.get('c'), [2, 5, 8, 11, 14]);
});

test('没有 worker 时返回空 Map', () => {
  assert.equal(assignPartitions([], 16).size, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/scheduler-queue-partition.test.js`
Expected: FAIL，`Cannot find module '../scheduler/queue/partition.js'`

- [ ] **Step 3: 实现**

```js
// server/scheduler/queue/partition.js
export function hashPartition(topic, taskId, count) {
  const s = `${topic}:${taskId}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % Math.max(1, Number(count) || 1);
}

export function assignPartitions(workerIds, count) {
  const out = new Map(workerIds.map((id) => [id, []]));
  if (!workerIds.length) return out;
  for (let p = 0; p < count; p += 1) out.get(workerIds[p % workerIds.length]).push(p);
  return out;
}
```

- [ ] **Step 4: 补共享常量并更新旧断言**

`shared/scheduler.js` 末尾追加：

```js
export const SchedulerQueueS2C = Object.freeze({
  SCHED_JOBS_CHANGED: 'sched-jobs-changed',
});

export const SchedulerJobStatus = Object.freeze({
  QUEUED: 0,
  SUCCESS: 1,
  FAILED: 2,
  RUNNING: 3,
  PENDING: 4,
});

export const SCHED_QUEUE_TOPIC = 'scheduler.jobs';
export const SCHED_PARTITION_COUNT_DEFAULT = 16;
export const SCHED_HEARTBEAT_MS = 10000;
export const SCHED_WORKER_OFFLINE_MS = 30000;
export const SCHED_REPORT_MAX_BYTES = 2 * 1024 * 1024;
```

`server/test/scheduler-const.test.js` 追加导入并断言 `SchedulerJobStatus.QUEUED === 0`、`SCHED_PARTITION_COUNT_DEFAULT === 16`。

- [ ] **Step 5: 跑测试并提交**

Run: `node --test server/test/scheduler-queue-partition.test.js server/test/scheduler-const.test.js`
Expected: PASS

```bash
git add shared/scheduler.js server/scheduler/queue/partition.js server/test/scheduler-queue-partition.test.js server/test/scheduler-const.test.js
git commit -m "feat(scheduler): add queue constants and partition helpers"
```

---

## Task 2: 队列配置（MySQL / SQLite）

**Files:**
- Create: `server/scheduler/queue/config.js`
- Test: `server/test/scheduler-queue-config.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/scheduler-queue-config.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createQueueConfig } from '../scheduler/queue/config.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qcfg-')); }

test('没有配置时默认 SQLite', () => {
  const c = createQueueConfig({ dir: tmp() });
  assert.equal(c.get().backend, 'sqlite');
  assert.equal(c.publicConfig().hasPassword, false);
});

test('保存 MySQL 后密码不回传且可解密', () => {
  const dir = tmp();
  const c = createQueueConfig({ dir });
  const r = c.save({ host: '127.0.0.1', port: 3306, user: 'root', password: 'p@ss', database: 'devflow' });
  assert.equal(r.ok, true);
  const pub = c.publicConfig();
  assert.equal(pub.backend, 'mysql');
  assert.equal(pub.hasPassword, true);
  assert.equal(pub.password, undefined);
  assert.equal(c.openPassword(), 'p@ss');
  assert.equal(fs.readFileSync(c.file, 'utf8').includes('p@ss'), false);
  const reopened = createQueueConfig({ dir });
  assert.equal(reopened.openPassword(), 'p@ss');
});

test('密码 undefined 保留旧密码，空串清除', () => {
  const dir = tmp();
  const c = createQueueConfig({ dir });
  c.save({ host: 'h', user: 'u', password: 'old', database: 'd' });
  c.save({ host: 'h2', user: 'u', database: 'd' });
  assert.equal(c.openPassword(), 'old');
  c.save({ host: 'h2', user: 'u', password: '', database: 'd' });
  assert.equal(c.openPassword(), '');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/scheduler-queue-config.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
// server/scheduler/queue/config.js
import fs from 'node:fs';
import path from 'node:path';
import { createNavicatCrypto } from '../../navicat-crypto.js';

export function createQueueConfig({ dir, logger = console, crypto = null } = {}) {
  const file = path.join(dir, 'queue.json');
  const box = crypto || createNavicatCrypto({ keyFile: path.join(dir, '.queue.key') });

  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }
  function write(data) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }
  function get() {
    const raw = read() || {};
    const mysql = raw.mysql || null;
    return {
      backend: mysql && mysql.host && mysql.database ? 'mysql' : 'sqlite',
      mysql: mysql ? {
        host: String(mysql.host || ''),
        port: Number(mysql.port) || 3306,
        user: String(mysql.user || ''),
        database: String(mysql.database || ''),
        secret: mysql.secret || null,
      } : null,
    };
  }
  function publicConfig() {
    const c = get();
    return {
      backend: c.backend,
      host: c.mysql?.host || '',
      port: c.mysql?.port || 3306,
      user: c.mysql?.user || '',
      database: c.mysql?.database || '',
      hasPassword: !!c.mysql?.secret,
    };
  }
  function save(input = {}) {
    const host = String(input.host || '').trim();
    const database = String(input.database || '').trim();
    if (!host || !database) return { error: 'host/database required' };
    const prev = get();
    const password = input.password === undefined ? null : String(input.password);
    const secret = password === null ? (prev.mysql?.secret || null) : (password ? box.seal(password) : null);
    write({ mysql: { host, port: Number(input.port) || 3306, user: String(input.user || ''), database, secret } });
    return { ok: true, config: publicConfig() };
  }
  function clear() { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } }
  function openPassword() {
    const c = get();
    return c.mysql?.secret ? box.open(c.mysql.secret) : '';
  }
  return { file, get, publicConfig, save, clear, openPassword };
}
```

- [ ] **Step 4: 跑测试并提交**

Run: `node --test server/test/scheduler-queue-config.test.js`
Expected: PASS

```bash
git add server/scheduler/queue/config.js server/test/scheduler-queue-config.test.js
git commit -m "feat(scheduler): add queue config with sealed mysql password"
```

---

## Task 3: 建表 SQL、SQLite driver 与通用 repository

**Files:**
- Create: `server/scheduler/queue/schema.js`
- Create: `server/scheduler/queue/driver-sqlite.js`
- Create: `server/scheduler/queue/repository.js`
- Test: `server/test/scheduler-queue-sqlite.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/scheduler-queue-sqlite.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteDriver } from '../scheduler/queue/driver-sqlite.js';
import { createRepository } from '../scheduler/queue/repository.js';

async function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qsql-')), 'void.db');
  const driver = await createSqliteDriver({ file });
  return { repo: createRepository(driver), driver };
}

function job(id, extra = {}) {
  return {
    jobId: id, parentJobId: null, topic: 'scheduler.jobs', groupName: 'default', taskId: 't1', partitionId: 0,
    uniqueKey: null, activeKey: null, classname: 'scheduler.task', methodName: 'shell',
    paramStr: '{}', result: null, status: 0, weight: 0, runtime: null, maxRunMilliSecond: 1000,
    createIP: 'a:1', workIP: null, traceId: 'tr', createTime: 1, lastUpdateTime: 1,
    createMachineId: 'm1', onlyLocal: 0, ...extra,
  };
}

test('插入 / 领取 / 完成', async () => {
  const { repo, driver } = await setup();
  assert.deepEqual(await repo.insertJob(job('j1')), { ok: true });
  const claimed = await repo.claim({ topic: 'scheduler.jobs', partitionId: 0, machineId: 'm1', hostport: 'w:1', now: 2 });
  assert.equal(claimed.jobId, 'j1');
  assert.equal(claimed.status, 3);
  await repo.updateJob('j1', { status: 1, runtime: 9, workIP: 'w:1', lastUpdateTime: 9 });
  const got = await repo.getJob('j1');
  assert.equal(got.status, 1);
  assert.equal(got.runtime, 9);
  await driver.close();
});

test('activeKey 唯一冲突只在排队时生效', async () => {
  const { repo, driver } = await setup();
  await repo.insertJob(job('j1', { uniqueKey: 'k', activeKey: 'k' }));
  assert.deepEqual(await repo.insertJob(job('j2', { uniqueKey: 'k', activeKey: 'k' })), { error: 'unique-conflict' });
  await repo.updateJob('j1', { status: 3, activeKey: null });
  assert.deepEqual(await repo.insertJob(job('j3', { uniqueKey: 'k', activeKey: 'k' })), { ok: true });
  await driver.close();
});

test('onlyLocal 只允许创建机器领取', async () => {
  const { repo, driver } = await setup();
  await repo.insertJob(job('j1', { onlyLocal: 1, createMachineId: 'm1' }));
  assert.equal(await repo.claim({ topic: 'scheduler.jobs', partitionId: 0, machineId: 'm2', hostport: 'w2:1', now: 2 }), null);
  assert.equal((await repo.claim({ topic: 'scheduler.jobs', partitionId: 0, machineId: 'm1', hostport: 'w1:1', now: 2 })).jobId, 'j1');
  await driver.close();
});

test('列表 / 汇总 / 清理 / 配置 / worker', async () => {
  const { repo, driver } = await setup();
  await repo.insertJob(job('j1', { status: 1 }));
  await repo.insertJob(job('j2', { status: 2 }));
  await repo.insertJob(job('j3', { status: 0 }));
  assert.equal((await repo.listJobs({ limit: 10 })).length, 3);
  assert.equal((await repo.listJobs({ status: 0, limit: 10 })).length, 1);
  assert.equal((await repo.summary()).queued, 1);
  assert.equal((await repo.deleteFinished({})), 2);
  assert.equal((await repo.listJobs({ limit: 10 })).length, 1);
  await repo.setConfig('partitionCount', '16');
  assert.equal(await repo.getConfig('partitionCount'), '16');
  await repo.upsertWorker({ id: 'm1:scheduler.jobs', hostport: 'w:1', status: 1, lastUpdateTime: 5, partitionIds: '[0]', role: 'master', version: 'v', topic: 'scheduler.jobs' });
  assert.equal((await repo.listWorkers('scheduler.jobs'))[0].hostport, 'w:1');
  await driver.close();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/scheduler-queue-sqlite.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 schema**

```js
// server/scheduler/queue/schema.js
export const JOB_COLUMNS = [
  'jobId', 'parentJobId', 'topic', 'groupName', 'taskId', 'partitionId', 'uniqueKey', 'activeKey',
  'classname', 'methodName', 'paramStr', 'result', 'status', 'weight', 'runtime',
  'maxRunMilliSecond', 'createIP', 'workIP', 'traceId', 'createTime', 'lastUpdateTime',
  'createMachineId', 'onlyLocal',
];

export const WORK_COLUMNS = [
  'id', 'hostport', 'status', 'lastUpdateTime', 'partitionIds', 'role', 'version', 'topic',
];

const MYSQL = [
  `CREATE TABLE IF NOT EXISTS t_sched_job (
    jobId VARCHAR(64) NOT NULL PRIMARY KEY,
    parentJobId VARCHAR(64) NULL,
    topic VARCHAR(64) NOT NULL,
    groupName VARCHAR(128) NULL,
    taskId VARCHAR(64) NULL,
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
    KEY idx_task_id (topic, taskId),
    UNIQUE KEY uk_active (activeKey)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS t_work_status (
    id VARCHAR(128) NOT NULL PRIMARY KEY,
    hostport VARCHAR(128) NOT NULL,
    status TINYINT NOT NULL,
    lastUpdateTime BIGINT NOT NULL,
    partitionIds TEXT NULL,
    role VARCHAR(16) NOT NULL,
    version VARCHAR(32) NULL,
    topic VARCHAR(64) NOT NULL,
    KEY idx_topic_status (topic, status, lastUpdateTime)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS t_sched_config (
    k VARCHAR(64) NOT NULL PRIMARY KEY,
    v TEXT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const SQLITE = [
  `CREATE TABLE IF NOT EXISTS t_sched_job (
    jobId TEXT PRIMARY KEY, parentJobId TEXT, topic TEXT NOT NULL, groupName TEXT, taskId TEXT,
    partitionId INTEGER NOT NULL, uniqueKey TEXT, activeKey TEXT,
    classname TEXT NOT NULL, methodName TEXT NOT NULL, paramStr TEXT, result TEXT,
    status INTEGER NOT NULL, weight INTEGER NOT NULL DEFAULT 0, runtime INTEGER,
    maxRunMilliSecond INTEGER NOT NULL, createIP TEXT, workIP TEXT, traceId TEXT,
    createTime INTEGER NOT NULL, lastUpdateTime INTEGER NOT NULL,
    createMachineId TEXT, onlyLocal INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uk_active ON t_sched_job(activeKey)',
  'CREATE INDEX IF NOT EXISTS idx_claim ON t_sched_job(topic, status, partitionId, weight, createTime)',
  'CREATE INDEX IF NOT EXISTS idx_task ON t_sched_job(topic, groupName, createTime)',
  'CREATE INDEX IF NOT EXISTS idx_task_id ON t_sched_job(topic, taskId)',
  `CREATE TABLE IF NOT EXISTS t_work_status (
    id TEXT PRIMARY KEY, hostport TEXT NOT NULL, status INTEGER NOT NULL,
    lastUpdateTime INTEGER NOT NULL, partitionIds TEXT, role TEXT NOT NULL,
    version TEXT, topic TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_topic_status ON t_work_status(topic, status, lastUpdateTime)',
  `CREATE TABLE IF NOT EXISTS t_sched_config (k TEXT PRIMARY KEY, v TEXT)`,
];

export function ddl(dialect) { return dialect === 'mysql' ? MYSQL : SQLITE; }

export async function ensureSchema(driver, dialect) {
  for (const sql of ddl(dialect)) await driver.exec(sql);
}
```

- [ ] **Step 4: 实现 SQLite driver**

```js
// server/scheduler/queue/driver-sqlite.js
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureSchema } from './schema.js';

export async function createSqliteDriver({ file }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  let chain = Promise.resolve();
  const driver = {
    dialect: 'sqlite',
    async exec(sql) { db.exec(sql); },
    async query(sql, params = []) { return db.prepare(sql).all(...params); },
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes || 0), insertId: Number(r.lastInsertRowid || 0) };
    },
    // 单连接必须串行化事务；16 个 partition 循环会并发调用 claim。
    async transaction(fn) {
      const run = chain.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn(driver);
          db.exec('COMMIT');
          return out;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      });
      chain = run.catch(() => {});
      return run;
    },
    isDuplicate(e) { return /UNIQUE constraint failed/i.test(String(e && e.message || e)); },
    async close() { await chain; db.close(); },
  };
  await ensureSchema(driver, 'sqlite');
  return driver;
}
```

- [ ] **Step 5: 实现通用 repository**

```js
// server/scheduler/queue/repository.js
import { JOB_COLUMNS } from './schema.js';

const JOB_FIELDS = new Set(JOB_COLUMNS);
const WORK_FIELDS = new Set(['id', 'hostport', 'status', 'lastUpdateTime', 'partitionIds', 'role', 'version', 'topic']);

function pick(obj, fields) {
  const out = {};
  for (const k of fields) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function createRepository(driver) {
  async function insertJob(job) {
    const row = pick(job, JOB_FIELDS);
    const cols = Object.keys(row);
    const sql = `INSERT INTO t_sched_job (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    try {
      await driver.run(sql, cols.map((c) => row[c]));
      return { ok: true };
    } catch (e) {
      if (driver.isDuplicate(e)) return { error: 'unique-conflict' };
      throw e;
    }
  }

  async function updateJob(jobId, patch) {
    const row = pick(patch, JOB_FIELDS);
    const cols = Object.keys(row).filter((c) => c !== 'jobId');
    if (!cols.length) return { ok: true };
    const sql = `UPDATE t_sched_job SET ${cols.map((c) => `${c}=?`).join(',')} WHERE jobId=?`;
    try {
      const r = await driver.run(sql, [...cols.map((c) => row[c]), jobId]);
      return r.changes ? { ok: true } : { error: 'not-found' };
    } catch (e) {
      if (driver.isDuplicate(e)) return { error: 'unique-conflict' };
      throw e;
    }
  }

  async function getJob(jobId) {
    const rows = await driver.query('SELECT * FROM t_sched_job WHERE jobId=?', [jobId]);
    return rows[0] || null;
  }

  async function listJobs({ topic = null, taskIds = null, status = null, partitionId = null, limit = 500 } = {}) {
    const where = [];
    const params = [];
    if (topic) { where.push('topic=?'); params.push(topic); }
    if (taskIds && taskIds.length) {
      where.push(`taskId IN (${taskIds.map(() => '?').join(',')})`);
      params.push(...taskIds);
    }
    if (status !== null && status !== undefined) {
      const arr = Array.isArray(status) ? status : [status];
      where.push(`status IN (${arr.map(() => '?').join(',')})`);
      params.push(...arr);
    }
    if (partitionId !== null && partitionId !== undefined) { where.push('partitionId=?'); params.push(partitionId); }
    const sql = `SELECT * FROM t_sched_job ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY createTime DESC LIMIT ?`;
    params.push(Math.max(1, Math.min(5000, Number(limit) || 500)));
    return driver.query(sql, params);
  }

  async function claim({ topic, partitionId, machineId, hostport, now }) {
    return driver.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT * FROM t_sched_job
          WHERE topic=? AND partitionId=? AND status=0
            AND (onlyLocal=0 OR createMachineId=?)
          ORDER BY weight DESC, createTime ASC LIMIT 1`,
        [topic, partitionId, machineId],
      );
      const row = rows[0];
      if (!row) return null;
      await tx.run('UPDATE t_sched_job SET status=3, workIP=?, activeKey=NULL, lastUpdateTime=? WHERE jobId=?', [hostport, now, row.jobId]);
      return { ...row, status: 3, workIP: hostport, activeKey: null, lastUpdateTime: now };
    });
  }

  async function summary(topic) {
    const out = { queued: 0, running: 0, pending: 0, success: 0, failed: 0, total: 0 };
    const rows = await driver.query('SELECT status, COUNT(*) AS n FROM t_sched_job WHERE topic=? GROUP BY status', [topic]);
    const key = { 0: 'queued', 1: 'success', 2: 'failed', 3: 'running', 4: 'pending' };
    for (const r of rows) {
      out[key[r.status]] = Number(r.n);
      out.total += Number(r.n);
    }
    return out;
  }

  async function partitionStats(topic, count) {
    const rows = await driver.query('SELECT partitionId, status, COUNT(*) AS n FROM t_sched_job WHERE topic=? GROUP BY partitionId, status', [topic]);
    const out = Array.from({ length: count }, (_, id) => ({ id, queued: 0, running: 0, pending: 0 }));
    for (const r of rows) {
      const p = out[r.partitionId];
      if (!p) continue;
      if (r.status === 0) p.queued = Number(r.n);
      else if (r.status === 3) p.running = Number(r.n);
      else if (r.status === 4) p.pending = Number(r.n);
    }
    return out;
  }

  async function deleteFinished({ topic, partitionId = null }) {
    const params = [topic];
    let sql = 'DELETE FROM t_sched_job WHERE topic=? AND status IN (1,2)';
    if (partitionId !== null && partitionId !== undefined) { sql += ' AND partitionId=?'; params.push(partitionId); }
    const r = await driver.run(sql, params);
    return r.changes;
  }

  async function rehash(topic, count, hashFn) {
    const rows = await driver.query('SELECT jobId, taskId FROM t_sched_job WHERE topic=? AND status IN (0,4)', [topic]);
    for (const r of rows) {
      if (!r.taskId) continue;
      await driver.run('UPDATE t_sched_job SET partitionId=? WHERE jobId=?', [hashFn(topic, r.taskId, count), r.jobId]);
    }
    return rows.length;
  }

  async function upsertWorker(w) {
    const row = pick(w, WORK_FIELDS);
    const cols = Object.keys(row);
    const sql = driver.dialect === 'mysql'
      ? `INSERT INTO t_work_status (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
         ON DUPLICATE KEY UPDATE ${cols.filter((c) => c !== 'id').map((c) => `${c}=VALUES(${c})`).join(',')}`
      : `INSERT INTO t_work_status (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
         ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',')}`;
    await driver.run(sql, cols.map((c) => row[c]));
  }

  async function listWorkers(topic) {
    return driver.query('SELECT * FROM t_work_status WHERE topic=? ORDER BY id', [topic]);
  }

  async function setWorkerPartitions(id, partitionIds, now) {
    await driver.run('UPDATE t_work_status SET partitionIds=?, lastUpdateTime=? WHERE id=?', [partitionIds, now, id]);
  }

  async function markStaleWorkers(topic, cutoff) {
    await driver.run('UPDATE t_work_status SET status=0 WHERE topic=? AND status=1 AND lastUpdateTime<?', [topic, cutoff]);
  }

  async function getConfig(k) {
    const rows = await driver.query('SELECT v FROM t_sched_config WHERE k=?', [k]);
    return rows[0] ? rows[0].v : null;
  }

  async function setConfig(k, v) {
    if (driver.dialect === 'mysql') {
      await driver.run('INSERT INTO t_sched_config (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k, v]);
    } else {
      await driver.run('INSERT INTO t_sched_config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [k, v]);
    }
  }

  return {
    insertJob, updateJob, getJob, listJobs, claim, summary, partitionStats,
    deleteFinished, rehash, upsertWorker, listWorkers, setWorkerPartitions,
    markStaleWorkers, getConfig, setConfig, driver,
  };
}
```

- [ ] **Step 6: 跑测试并提交**

Run: `node --test server/test/scheduler-queue-sqlite.test.js`
Expected: PASS

```bash
git add server/scheduler/queue/schema.js server/scheduler/queue/driver-sqlite.js server/scheduler/queue/repository.js server/test/scheduler-queue-sqlite.test.js
git commit -m "feat(scheduler): add queue schema sqlite driver and repository"
```

---

## Task 4: MySQL driver

**Files:**
- Create: `server/scheduler/queue/driver-mysql.js`
- Test: `server/test/scheduler-queue-mysql.test.js`

- [ ] **Step 1: 写测试（无 MySQL 时只测错误映射）**

```js
// server/test/scheduler-queue-mysql.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isMysqlDuplicate } from '../scheduler/queue/driver-mysql.js';

test('识别 MySQL 唯一键冲突', () => {
  assert.equal(isMysqlDuplicate({ code: 'ER_DUP_ENTRY' }), true);
  assert.equal(isMysqlDuplicate({ errno: 1062 }), true);
  assert.equal(isMysqlDuplicate({ code: 'ECONNREFUSED' }), false);
});

test('MySQL 集成（需 DEVFLOW_TEST_MYSQL）', { skip: !process.env.DEVFLOW_TEST_MYSQL }, async () => {
  const cfg = JSON.parse(process.env.DEVFLOW_TEST_MYSQL);
  const { createMysqlDriver } = await import('../scheduler/queue/driver-mysql.js');
  const { createRepository } = await import('../scheduler/queue/repository.js');
  const driver = await createMysqlDriver(cfg);
  const repo = createRepository(driver);
  const job = {
    jobId: 'j_it_' + Date.now(), parentJobId: null, topic: 'scheduler.jobs', groupName: 'default', taskId: 't_it',
    partitionId: 0, uniqueKey: null, activeKey: null, classname: 'scheduler.task', methodName: 'shell',
    paramStr: '{}', result: null, status: 0, weight: 0, runtime: null, maxRunMilliSecond: 1000,
    createIP: null, workIP: null, traceId: 'tr', createTime: Date.now(), lastUpdateTime: Date.now(),
    createMachineId: 'it', onlyLocal: 0,
  };
  assert.deepEqual(await repo.insertJob(job), { ok: true });
  assert.equal((await repo.getJob(job.jobId)).jobId, job.jobId);
  await repo.updateJob(job.jobId, { status: 2 });
  await driver.run('DELETE FROM t_sched_job WHERE jobId=?', [job.jobId]);
  await driver.close();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/scheduler-queue-mysql.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
// server/scheduler/queue/driver-mysql.js
import { ensureSchema } from './schema.js';

export function isMysqlDuplicate(e) {
  return !!(e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062));
}

export async function createMysqlDriver({ host, port = 3306, user, password, database, logger = console, connectionLimit = 4 }) {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host, port, user, password, database, charset: 'utf8mb4',
    waitForConnections: true, connectionLimit,
  });
  const driver = {
    dialect: 'mysql',
    async exec(sql) { await pool.query(sql); },
    async query(sql, params = []) { const [rows] = await pool.query(sql, params); return rows; },
    async run(sql, params = []) {
      const [r] = await pool.query(sql, params);
      return { changes: Number(r.affectedRows || 0), insertId: Number(r.insertId || 0) };
    },
    async transaction(fn) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const api = {
          async query(sql, params = []) { const [rows] = await conn.query(sql, params); return rows; },
          async run(sql, params = []) {
            const [r] = await conn.query(sql, params);
            return { changes: Number(r.affectedRows || 0), insertId: Number(r.insertId || 0) };
          },
        };
        const out = await fn(api);
        await conn.commit();
        return out;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },
    isDuplicate: isMysqlDuplicate,
    async close() { await pool.end(); },
  };
  await ensureSchema(driver, 'mysql');
  logger?.info?.('scheduler queue mysql ready');
  return driver;
}
```

- [ ] **Step 4: 跑测试并提交**

Run: `node --test server/test/scheduler-queue-mysql.test.js`
Expected: 1 pass，1 skipped（无环境变量时）

```bash
git add server/scheduler/queue/driver-mysql.js server/test/scheduler-queue-mysql.test.js
git commit -m "feat(scheduler): add mysql queue driver"
```

---

## Task 5: 队列业务 service

**Files:**
- Create: `server/scheduler/queue/service.js`
- Test: `server/test/scheduler-queue-service.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/scheduler-queue-service.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteDriver } from '../scheduler/queue/driver-sqlite.js';
import { createRepository } from '../scheduler/queue/repository.js';
import { createQueueService } from '../scheduler/queue/service.js';

const task = {
  id: 't1', name: 'scan', type: 'shell', command: 'echo', enabled: true,
  approvalRequired: false, onlyLocal: false, uniqueKey: null, weight: 0,
  schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } },
};

async function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qsvc-')), 'void.db');
  const driver = await createSqliteDriver({ file });
  const repo = createRepository(driver);
  let t = 1000;
  const svc = createQueueService({ repo, now: () => t, topic: 'scheduler.jobs' });
  return { svc, repo, driver, tick: (n = 1) => { t += n; } };
}

test('定时入队：排队状态、快照、partition', async () => {
  const { svc, driver } = await setup();
  const r = await svc.enqueueTask(task, { trigger: 'schedule', scheduledAt: 1000, createMachineId: 'm1', createIP: 'h:1' });
  assert.equal(r.job.status, 0);
  assert.equal(r.job.methodName, 'shell');
  const snap = JSON.parse(r.job.paramStr);
  assert.equal(snap.task.id, 't1');
  assert.equal(snap.trigger, 'schedule');
  await driver.close();
});

test('需审批任务进入待审；批准恢复 activeKey', async () => {
  const { svc, driver } = await setup();
  const t2 = { ...task, approvalRequired: true, uniqueKey: 'k1' };
  const { job } = await svc.enqueueTask(t2, { trigger: 'schedule', createMachineId: 'm1' });
  assert.equal(job.status, 4);
  assert.equal(job.activeKey, null);
  const ok = await svc.approve(job.jobId);
  assert.equal(ok.job.status, 0);
  assert.equal(ok.job.activeKey, 'k1');
  await driver.close();
});

test('uniqueKey 只在排队时冲突', async () => {
  const { svc, driver } = await setup();
  const t2 = { ...task, uniqueKey: 'same' };
  assert.ok((await svc.enqueueTask(t2, { trigger: 'schedule' })).job);
  assert.equal((await svc.enqueueTask(t2, { trigger: 'schedule' })).error, 'unique-conflict');
  await driver.close();
});

test('领取 → 完成 → 失败重试生成子作业', async () => {
  const { svc, driver } = await setup();
  const { job } = await svc.enqueueTask(task, { trigger: 'schedule' });
  const claimed = await svc.claim({ partitionId: job.partitionId, worker: { id: 'm1:scheduler.jobs', hostport: 'w:1', machineId: 'm1' } });
  assert.equal(claimed.jobId, job.jobId);
  await svc.complete(job.jobId, { status: 2, runtime: 5, workIP: 'w:1', result: { error: 'boom', reason: 'failed' } });
  const retry = await svc.retry(job.jobId, { createMachineId: 'm1', createIP: 'h:1' });
  assert.equal(retry.job.parentJobId, job.jobId);
  assert.equal(retry.job.traceId, job.traceId);
  assert.equal(retry.job.status, 0);
  await driver.close();
});

test('取消 / 删除任务 / 清理', async () => {
  const { svc, driver } = await setup();
  const a = (await svc.enqueueTask(task, { trigger: 'schedule' })).job;
  assert.equal((await svc.cancel(a.jobId)).ok, true);
  const b = (await svc.enqueueTask(task, { trigger: 'schedule' })).job;
  await svc.complete(b.jobId, { status: 1, runtime: 1, workIP: 'w:1', result: {} });
  assert.equal(await svc.cleanupFinished({}), 2);
  const c = (await svc.enqueueTask(task, { trigger: 'schedule' })).job;
  const d = await svc.deleteTaskJobs('t1');
  assert.deepEqual(d.running, []);
  assert.equal((await svc.get(c.jobId)).status, 2);
  await driver.close();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/scheduler-queue-service.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
// server/scheduler/queue/service.js
import crypto from 'node:crypto';
import { hashPartition } from './partition.js';
import {
  SCHED_QUEUE_TOPIC, SCHED_PARTITION_COUNT_DEFAULT, SchedulerJobStatus as S,
} from '@devflow/shared/scheduler';

const DEFAULT_MS = { ai: 1800000, shell: 600000, script: 600000, workflow: 600000 };

function maxRunFor(task) {
  return Number(task.maxRunMilliSecond) > 0 ? Number(task.maxRunMilliSecond) : (DEFAULT_MS[task.type] || 600000);
}

export function buildSnapshot(task, trigger, scheduledAt, createMachineId) {
  return {
    task: {
      id: task.id, name: task.name, type: task.type, enabled: task.enabled !== false,
      projectId: task.projectId || null, cwd: task.cwd || null, filePath: task.filePath || null,
      command: task.command, ai: task.ai, script: task.script, workflow: task.workflow,
      approvalRequired: !!task.approvalRequired, onlyLocal: !!task.onlyLocal,
      uniqueKey: task.uniqueKey || null, weight: Number(task.weight) || 0,
      maxRunMilliSecond: maxRunFor(task), groupName: task.groupName || 'default',
    },
    trigger,
    scheduledAt: scheduledAt || null,
    createMachineId: createMachineId || null,
  };
}

function failedResult(reason, error = null) {
  return JSON.stringify({ exitCode: null, error: error || reason, durationMs: null, reportFile: null, reportMarkdown: null, logPath: null, sessionId: null, reason });
}

export function createQueueService({ repo, topic = SCHED_QUEUE_TOPIC, now = () => Date.now(), logger = console } = {}) {
  async function partitionCount() {
    const n = Number(await repo.getConfig('partitionCount'));
    return n > 0 ? n : SCHED_PARTITION_COUNT_DEFAULT;
  }

  async function enqueueTask(task, { trigger = 'schedule', scheduledAt = null, createIP = null, createMachineId = null, parentJobId = null, traceId = null, useUniqueKey = true } = {}) {
    const count = await partitionCount();
    const at = now();
    const uniqueKey = useUniqueKey ? (task.uniqueKey || null) : null;
    const status = task.approvalRequired ? S.PENDING : S.QUEUED;
    const job = {
      jobId: 'j_' + crypto.randomBytes(8).toString('hex'),
      parentJobId: parentJobId || null,
      topic,
      groupName: task.groupName || 'default',
      taskId: task.id,
      partitionId: hashPartition(topic, task.id, count),
      uniqueKey,
      activeKey: status === S.QUEUED ? uniqueKey : null,
      classname: 'scheduler.task',
      methodName: task.type,
      paramStr: JSON.stringify(buildSnapshot(task, trigger, scheduledAt, createMachineId)),
      result: null,
      status,
      weight: Number(task.weight) || 0,
      runtime: null,
      maxRunMilliSecond: maxRunFor(task),
      createIP: createIP || null,
      workIP: null,
      traceId: traceId || crypto.randomUUID(),
      createTime: at,
      lastUpdateTime: at,
      createMachineId: createMachineId || null,
      onlyLocal: task.onlyLocal ? 1 : 0,
    };
    const r = await repo.insertJob(job);
    if (r.error) return { error: r.error };
    return { job };
  }

  async function approve(jobId) {
    const job = await repo.getJob(jobId);
    if (!job || job.status !== S.PENDING) return { error: 'not-pending' };
    const r = await repo.updateJob(jobId, { status: S.QUEUED, activeKey: job.uniqueKey || null, lastUpdateTime: now() });
    if (r.error) return r;
    return { job: { ...job, status: S.QUEUED, activeKey: job.uniqueKey || null } };
  }

  async function reject(jobId) {
    const job = await repo.getJob(jobId);
    if (!job || job.status !== S.PENDING) return { error: 'not-pending' };
    await repo.updateJob(jobId, { status: S.FAILED, activeKey: null, result: failedResult('rejected'), lastUpdateTime: now() });
    return { ok: true };
  }

  async function cancel(jobId) {
    const job = await repo.getJob(jobId);
    if (!job) return { error: 'not-found' };
    if (job.status === S.RUNNING) return { needsStop: job };
    if (job.status === S.PENDING) return reject(jobId);
    if (job.status !== S.QUEUED) return { error: 'not-cancellable' };
    await repo.updateJob(jobId, { status: S.FAILED, activeKey: null, result: failedResult('cancelled'), lastUpdateTime: now() });
    return { ok: true };
  }

  async function claim({ partitionId, worker }) {
    return repo.claim({ topic, partitionId, machineId: worker.machineId, hostport: worker.hostport, now: now() });
  }

  async function complete(jobId, { status, runtime = null, workIP = null, result = {} }) {
    await repo.updateJob(jobId, {
      status, runtime, workIP, result: JSON.stringify(result || {}), activeKey: null, lastUpdateTime: now(),
    });
  }

  async function retry(jobId, { createIP = null, createMachineId = null } = {}) {
    const job = await repo.getJob(jobId);
    if (!job || job.status !== S.FAILED) return { error: 'not-failed' };
    let snap;
    try { snap = JSON.parse(job.paramStr); } catch { return { error: 'bad-snapshot' }; }
    return enqueueTask(snap.task, {
      trigger: 'retry', createIP, createMachineId,
      parentJobId: job.jobId, traceId: job.traceId, useUniqueKey: false,
    });
  }

  async function cleanupFinished({ partitionId = null } = {}) {
    return repo.deleteFinished({ topic, partitionId });
  }

  async function deleteTaskJobs(taskId) {
    const jobs = await repo.listJobs({ topic, taskIds: [taskId], status: [S.QUEUED, S.RUNNING, S.PENDING], limit: 5000 });
    const running = [];
    for (const job of jobs) {
      if (job.status === S.RUNNING) running.push(job.jobId);
      await repo.updateJob(job.jobId, { status: S.FAILED, activeKey: null, result: failedResult('task-deleted'), lastUpdateTime: now() });
    }
    return { running };
  }

  async function failRunningByWorker(hostport, reason = 'worker-offline') {
    const rows = await repo.listJobs({ topic, status: S.RUNNING, limit: 5000 });
    const hit = rows.filter((j) => j.workIP === hostport);
    for (const job of hit) {
      await repo.updateJob(job.jobId, { status: S.FAILED, activeKey: null, result: failedResult(reason), lastUpdateTime: now() });
    }
    return hit.map((j) => j.jobId);
  }

  async function recoverRunning(hostport) { return failRunningByWorker(hostport, 'interrupted'); }

  async function setPartitionCount(next) {
    const cur = await partitionCount();
    const n = Number(next);
    if (!Number.isInteger(n) || n < 1) return { error: 'bad-count' };
    if (n < cur) return { error: 'cannot-shrink' };
    if (n === cur) return { ok: true, count: n };
    await repo.setConfig('partitionCount', String(n));
    const moved = await repo.rehash(topic, n, hashPartition);
    return { ok: true, count: n, moved };
  }

  return {
    topic, repo, partitionCount, enqueueTask, approve, reject, cancel, claim, complete,
    retry, cleanupFinished, deleteTaskJobs, failRunningByWorker, recoverRunning,
    setPartitionCount,
    getJob: (id) => repo.getJob(id),
    listJobs: (opts) => repo.listJobs({ topic, ...opts }),
    summary: () => repo.summary(topic),
    partitionStats: async () => repo.partitionStats(topic, await partitionCount()),
    parseParam: (job) => JSON.parse(job.paramStr),
  };
}
```

- [ ] **Step 4: 跑测试并提交**

Run: `node --test server/test/scheduler-queue-service.test.js`
Expected: PASS

```bash
git add server/scheduler/queue/service.js server/test/scheduler-queue-service.test.js
git commit -m "feat(scheduler): add job queue service"
```

---

## Task 6: worker 注册与 partition 分配

**Files:**
- Create: `server/scheduler/queue/workers.js`
- Test: `server/test/scheduler-queue-workers.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/scheduler-queue-workers.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerRegistry } from '../scheduler/queue/workers.js';

function fakeRepo(seed = []) {
  const workers = new Map(seed.map((w) => [w.id, { ...w }]));
  return {
    workers,
    async markStaleWorkers() {},
    async upsertWorker(w) { workers.set(w.id, { ...workers.get(w.id), ...w }); },
    async listWorkers() { return [...workers.values()]; },
    async setWorkerPartitions(id, ids, now) { const w = workers.get(id); w.partitionIds = ids; w.lastUpdateTime = now; },
  };
}

test('master 均分 partition 并回调自己的分区', async () => {
  const repo = fakeRepo([{ id: 'a', status: 1, lastUpdateTime: 1 }, { id: 'b', status: 1, lastUpdateTime: 1 }]);
  const got = [];
  let t = 100;
  const reg = createWorkerRegistry({ repo, topic: 'scheduler.jobs', count: 4, now: () => t });
  await reg.tick({ self: { id: 'a', hostport: 'a:1', role: 'master', version: 'v' }, onPartitions: (ids) => got.push(ids) });
  assert.deepEqual(got.at(-1), [0, 2]);
  assert.equal(repo.workers.get('a').partitionIds, '[0,2]');
  assert.equal(repo.workers.get('b').partitionIds, '[1,3]');
});

test('离线 worker 的 partition 重新分配给在线 worker', async () => {
  const repo = fakeRepo([{ id: 'a', status: 1, lastUpdateTime: 100 }, { id: 'b', status: 0, lastUpdateTime: 1 }]);
  const got = [];
  const reg = createWorkerRegistry({ repo, topic: 'scheduler.jobs', count: 4, now: () => 100 });
  await reg.tick({ self: { id: 'a', hostport: 'a:1', role: 'master', version: 'v' }, onPartitions: (ids) => got.push(ids) });
  assert.deepEqual(got.at(-1), [0, 1, 2, 3]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/scheduler-queue-workers.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
// server/scheduler/queue/workers.js
import { assignPartitions } from './partition.js';
import { SCHED_HEARTBEAT_MS, SCHED_WORKER_OFFLINE_MS } from '@devflow/shared/scheduler';

export function createWorkerRegistry({
  repo, topic, count = 16, now = () => Date.now(),
  heartbeatMs = SCHED_HEARTBEAT_MS, offlineMs = SCHED_WORKER_OFFLINE_MS, logger = console,
}) {
  let timer = null;
  let running = false;

  async function tick({ self, onPartitions = () => {}, onOffline = () => {}, count: nextCount = count } = {}) {
    if (!self) return;
    const at = now();
    const before = await repo.listWorkers(topic);
    const stale = before.filter((w) => w.status === 1 && w.lastUpdateTime < at - offlineMs);
    await repo.markStaleWorkers(topic, at - offlineMs);
    for (const w of stale) await onOffline(w.hostport);
    await repo.upsertWorker({
      id: self.id, hostport: self.hostport, status: 1, lastUpdateTime: at,
      partitionIds: null, role: self.role, version: self.version || null, topic,
    });
    const workers = await repo.listWorkers(topic);
    const online = workers.filter((w) => w.status === 1).map((w) => w.id);
    const map = assignPartitions(online, nextCount);
    for (const id of online) {
      await repo.setWorkerPartitions(id, JSON.stringify(map.get(id) || []), at);
    }
    const mine = map.get(self.id) || [];
    onPartitions(mine);
  }

  function start({ self, onPartitions, onOffline, count: nextCount = count }) {
    if (timer) return;
    const run = () => {
      if (running) return;
      running = true;
      tick({ self, onPartitions, onOffline, count: nextCount })
        .catch((e) => logger?.error?.('scheduler worker tick failed', e))
        .finally(() => { running = false; });
    };
    run();
    timer = setInterval(run, heartbeatMs);
    timer.unref?.();
  }

  async function list() {
    const at = now();
    const workers = await repo.listWorkers(topic);
    return workers.map((w) => ({ ...w, online: w.status === 1 && w.lastUpdateTime >= at - offlineMs }));
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  return { start, stop, tick, list };
}
```

- [ ] **Step 4: 跑测试并提交**

Run: `node --test server/test/scheduler-queue-workers.test.js`
Expected: PASS

```bash
git add server/scheduler/queue/workers.js server/test/scheduler-queue-workers.test.js
git commit -m "feat(scheduler): add worker registry and partition assignment"
```

---

## Task 7: 任务 store 新增字段并移除 runs

**Files:**
- Modify: `server/scheduler/store.js`
- Modify: `server/test/scheduler-store.test.js`

- [ ] **Step 1: 更新测试**

在 `server/test/scheduler-store.test.js` 增加：

```js
test('任务支持队列字段', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const r = store.createTask({
    name: 'q', type: 'shell', command: 'echo',
    schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } },
    approvalRequired: true, onlyLocal: true, uniqueKey: 'u1', weight: 5, maxRunMilliSecond: 1234, groupName: 'g1',
  });
  assert.equal(r.task.approvalRequired, true);
  assert.equal(r.task.onlyLocal, true);
  assert.equal(r.task.uniqueKey, 'u1');
  assert.equal(r.task.weight, 5);
  assert.equal(r.task.maxRunMilliSecond, 1234);
  assert.equal(r.task.groupName, 'g1');
});

test('不再写 runs.json', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  store.createTask({ name: 'a', type: 'shell', command: 'echo', schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } } });
  assert.equal(fs.existsSync(path.join(dir, 'runs.json')), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/scheduler-store.test.js`
Expected: FAIL，新字段为 undefined

- [ ] **Step 3: 修改 store**

在 `_buildTask` 返回值中加入：

```js
approvalRequired: !!input.approvalRequired,
onlyLocal: !!input.onlyLocal,
uniqueKey: input.uniqueKey ? String(input.uniqueKey).slice(0, 191) : null,
weight: Number(input.weight) || 0,
maxRunMilliSecond: Number(input.maxRunMilliSecond) > 0 ? Number(input.maxRunMilliSecond) : null,
groupName: input.groupName ? String(input.groupName).slice(0, 128) : 'default',
```

删除构造器里的 `runsFile` / `runs` 读取、`saveRuns`、`addRun`、`listRuns`、`summary`、`getRun`、`updateRun`，以及 `deleteTask` 中删除 runs 的逻辑；保留 `logFileFor/logPath/reportFileFor/contextFileFor/runDirFor/reportPath` 与本地目录清理。

`deleteTask` 改为返回 `{ ok: true, task }`。

- [ ] **Step 4: 跑测试并提交**

Run: `node --test server/test/scheduler-store.test.js`
Expected: PASS

```bash
git add server/scheduler/store.js server/test/scheduler-store.test.js
git commit -m "feat(scheduler): add queue fields and drop runs persistence"
```

---

## Task 8: 调度引擎改为生产者

**Files:**
- Modify: `server/scheduler/engine.js`
- Modify: `server/test/scheduler-engine.test.js`

- [ ] **Step 1: 重写测试**

```js
// server/test/scheduler-engine.test.js（核心断言）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../scheduler/engine.js';

function fakeStore(tasks) {
  return { listTasks: () => tasks, getTask: (id) => tasks.find((t) => t.id === id) || null };
}
function fakeQueue() {
  const enq = [];
  return { enq, async enqueueTask(task, opts) { enq.push({ task, opts }); return { job: { jobId: 'j1' } }; } };
}

test('到点入队而不是直接执行', async () => {
  const task = { id: 't1', name: 'a', enabled: true, schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } } };
  const q = fakeQueue();
  let t = 0;
  const e = createEngine({ store: fakeStore([task]), queue: q, now: () => t });
  e.start();
  t = 3600000;
  await e.tick();
  assert.equal(q.enq.length, 1);
  assert.equal(q.enq[0].opts.trigger, 'schedule');
  e.stopAll();
});

test('manualRun 入队', async () => {
  const task = { id: 't1', name: 'a', enabled: true, schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } } };
  const q = fakeQueue();
  const e = createEngine({ store: fakeStore([task]), queue: q, now: () => 0 });
  const r = await e.manualRun('t1');
  assert.equal(r.job.jobId, 'j1');
  assert.equal(q.enq[0].opts.trigger, 'manual');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/scheduler-engine.test.js`
Expected: FAIL，旧引擎没有 queue 参数

- [ ] **Step 3: 重写 engine**

保留 `scheduleTask/nextAt/refreshAll/reschedule/notifyTasksChanged/onEvent`。删除 `startRun/startWorkflowRun/complete/taskRuns/runner/workflowExecutor/maxConcurrent`。

```js
export function createEngine({ store, queue, logger = console, now = () => Date.now(), tickMs = 1000, onStop = null } = {}) {
  const nextAt = new Map();
  const listeners = new Set();
  let timer = null;
  let ticking = false;

  function emit(evt, payload) { for (const cb of listeners) { try { cb(evt, payload); } catch (e) { logger.error('sched listener', e); } } }
  function onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); }
  function scheduleTask(task, from = now()) {
    const n = computeNextRun(task.schedule, from);
    if (n == null) nextAt.delete(task.id); else nextAt.set(task.id, n);
    return n;
  }
  function nextRunAtOf(id) { return nextAt.has(id) ? nextAt.get(id) : null; }
  function refreshAll() { for (const t of store.listTasks()) scheduleTask(t); }
  function reschedule(task) { scheduleTask(task); }
  function notifyTasksChanged() { emit('tasks-changed', {}); }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const t = now();
      for (const task of store.listTasks()) {
        if (!task.enabled) continue;
        if (!nextAt.has(task.id)) { scheduleTask(task, t); continue; }
        if (nextAt.get(task.id) > t) continue;
        scheduleTask(task, t);
        try {
          const r = await queue.enqueueTask(task, { trigger: 'schedule', scheduledAt: t });
          if (r && r.error && r.error !== 'unique-conflict') logger.warn?.('scheduler enqueue failed', r.error);
        } catch (e) { logger.error('scheduler enqueue failed', e); }
      }
    } finally { ticking = false; }
  }
  function manualRun(taskId) {
    const task = store.getTask(taskId);
    if (!task) return Promise.resolve({ error: 'not-found' });
    return queue.enqueueTask(task, { trigger: 'manual' });
  }
  function stop(taskId) { return onStop ? onStop(taskId) : Promise.resolve(false); }
  function start() { refreshAll(); if (!timer) { timer = setInterval(() => { void tick(); }, tickMs); timer.unref?.(); } }
  function stopAll() { if (timer) { clearInterval(timer); timer = null; } }

  return { start, stopAll, tick, onEvent, manualRun, stop, scheduleTask, reschedule, nextRunAtOf, refreshAll, notifyTasksChanged };
}
```

- [ ] **Step 4: 跑测试并提交**

Run: `node --test server/test/scheduler-engine.test.js`
Expected: PASS

```bash
git add server/scheduler/engine.js server/test/scheduler-engine.test.js
git commit -m "feat(scheduler): make engine enqueue jobs"
```

---

## Task 9: 消费者执行作业

**Files:**
- Create: `server/scheduler/queue/consumer.js`
- Test: `server/test/scheduler-queue-consumer.test.js`

- [ ] **Step 1: 写失败测试**

```js
// server/test/scheduler-queue-consumer.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SchedulerStore } from '../scheduler/store.js';
import { createConsumer } from '../scheduler/queue/consumer.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qcons-')); }

test('领取 shell 作业、执行、写回成功与报告', async () => {
  const dir = tmp();
  const store = new SchedulerStore({ dir });
  const task = store.createTask({
    name: 'a', type: 'shell', command: 'echo', schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } },
  }).task;
  const snap = { task, trigger: 'schedule', scheduledAt: 1, createMachineId: 'm1' };
  let completed = null;
  const queue = {
    claim: async () => ({
      jobId: 'j1', partitionId: 0, paramStr: JSON.stringify(snap), maxRunMilliSecond: 1000,
    }),
    parseParam: (job) => JSON.parse(job.paramStr),
    complete: async (id, r) => { completed = { id, ...r }; },
    listJobs: async () => [],
  };
  const runner = { run: async () => ({ exitCode: 0, timedOut: false, durationMs: 7 }), stop: () => true };
  const c = createConsumer({
    queue, store, runner, workflowExecutor: null, worker: { id: 'm1:scheduler.jobs', hostport: 'w:1', machineId: 'm1' },
    aiPromptLoader: () => '', now: () => 1000, pollMs: 999999,
  });
  await c.runOnce(0);
  assert.equal(completed.status, 1);
  assert.equal(completed.runtime, 7);
  assert.ok(completed.result.reportMarkdown.includes('a'));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/scheduler-queue-consumer.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

```js
// server/scheduler/queue/consumer.js
import fs from 'node:fs';
import { buildSpawnSpec } from '../runner.js';
import { writeRunContext, ensureReport } from '../report.js';
import { SchedulerJobStatus as S, SCHED_REPORT_MAX_BYTES } from '@devflow/shared/scheduler';

function readReport(store, reportFile) {
  if (!reportFile) return '';
  try { return fs.readFileSync(store.reportPath(reportFile), 'utf8'); } catch { return ''; }
}

export function createConsumer({
  queue, store, runner, workflowExecutor, aiPromptLoader = () => '',
  worker, logger = console, now = () => Date.now(), pollMs = 1000,
  aiBin = 'opencode', opencodeDataDir = null, projectResolver = () => null, onEvent = () => {},
}) {
  const loops = new Map();
  const running = new Map();
  let stopped = false;

  async function execute(job) {
    let snap;
    try { snap = queue.parseParam(job); } catch (e) {
      await queue.complete(job.jobId, {
        status: S.FAILED, runtime: 0, workIP: worker.hostport,
        result: { error: 'bad-snapshot', reason: 'failed', reportMarkdown: '' },
      });
      return;
    }
    const task = snap.task;
    const startedAt = now();
    const logFile = store.logFileFor(task.id, job.jobId);
    const run = { id: job.jobId, taskId: task.id, status: 'running', trigger: snap.trigger, startedAt, logFile };
    const ctx = writeRunContext({ store, task, run });
    const cwd = task.cwd || projectResolver(task.projectId) || process.cwd();
    let status = S.FAILED;
    let result = { exitCode: null, error: null, durationMs: null, reason: 'failed' };
    try {
      if (task.type === 'workflow' && workflowExecutor) {
        const statusPromise = new Promise((resolve) => {
          let timer = null;
          const handle = workflowExecutor.start({
            task, runId: job.jobId, logFile, runContextPath: ctx.contextPath,
            onStatus: (s) => {
              if (s.status === 'success' || s.status === 'failed' || s.status === 'aborted') {
                if (timer) clearTimeout(timer);
                resolve(s);
              }
            },
          });
          if (!handle || handle.error) {
            resolve({ status: 'failed', error: (handle && handle.error) || 'executor-error' });
            return;
          }
          running.set(job.jobId, { kind: 'workflow', handle });
          timer = setTimeout(() => {
            try { handle.abort?.(); } catch { /* ignore */ }
            resolve({ status: 'failed', error: 'timeout' });
          }, job.maxRunMilliSecond);
        });
        const res = await statusPromise;
        status = res.status === 'success' ? S.SUCCESS : S.FAILED;
        result = { exitCode: null, error: res.error || null, durationMs: now() - startedAt, sessionId: res.sessionId || null, reason: res.error || res.status };
      } else {
        let prompt = null;
        if (task.type === 'ai') prompt = task.ai?.source === 'command' ? (aiPromptLoader(task.ai.commandName) || '') : (task.ai?.prompt || '');
        const spec = buildSpawnSpec(task, {
          cwd, aiPrompt: prompt, aiBin, opencodeDataDir,
          runContextPath: ctx.contextPath, reportPath: ctx.reportPath, reportDir: ctx.reportDir, progressPath: ctx.progressPath,
        });
        const res = await runner.run({ runId: job.jobId, spec, logPath: store.logPath(logFile), timeoutMs: job.maxRunMilliSecond });
        status = res.spawnError || res.timedOut || res.exitCode !== 0 ? S.FAILED : S.SUCCESS;
        result = {
          exitCode: res.exitCode ?? null, error: res.error || (res.timedOut ? 'timeout' : null),
          durationMs: res.durationMs ?? (now() - startedAt), reason: res.timedOut ? 'timeout' : (res.exitCode === 0 ? 'success' : 'failed'),
        };
      }
    } catch (e) {
      result = { exitCode: null, error: String(e?.message || e), durationMs: now() - startedAt, reason: 'failed' };
    } finally {
      running.delete(job.jobId);
    }
    let info = null;
    try {
      info = ensureReport({ store, task, run: { ...run, status, exitCode: result.exitCode, durationMs: result.durationMs, error: result.error }, result });
    } catch (e) { logger?.error?.('scheduler report failed', e); }
    const reportMarkdown = (readReport(store, info?.reportFile) || '').slice(0, SCHED_REPORT_MAX_BYTES);
    const final = {
      ...result,
      reportFile: info?.reportFile || null,
      reportMarkdown,
      logPath: store.logPath(logFile),
    };
    await queue.complete(job.jobId, { status, runtime: result.durationMs, workIP: worker.hostport, result: final });
    onEvent('run-end', { jobId: job.jobId, taskId: task.id, status });
  }

  async function runOnce(partitionId) {
    const loop = loops.get(partitionId) || {};
    if (stopped || loop.busy) return;
    loop.busy = true;
    loops.set(partitionId, loop);
    try {
      const job = await queue.claim({ partitionId, worker });
      if (job) await execute(job);
    } catch (e) {
      logger?.error?.('scheduler consumer failed', e);
    } finally {
      loop.busy = false;
    }
  }

  function setPartitions(ids) {
    for (const [pid, loop] of loops) {
      if (!ids.includes(pid)) { clearInterval(loop.timer); loops.delete(pid); }
    }
    for (const pid of ids) {
      if (loops.has(pid)) continue;
      const loop = { busy: false, timer: null };
      loops.set(pid, loop);
      loop.timer = setInterval(() => { void runOnce(pid); }, pollMs);
      loop.timer.unref?.();
      void runOnce(pid);
    }
  }

  async function stopTask(taskId) {
    const jobs = await queue.listJobs({ taskIds: [taskId], status: S.RUNNING, limit: 1 });
    const job = jobs[0];
    if (!job) return false;
    const h = running.get(job.jobId);
    if (h) {
      if (h.kind === 'workflow') { try { h.handle?.abort?.(); } catch { /* ignore */ } }
      else runner.stop(job.jobId);
    }
    await queue.complete(job.jobId, { status: S.FAILED, runtime: null, workIP: worker.hostport, result: { error: 'cancelled', reason: 'cancelled' } });
    return true;
  }

  function stop() { stopped = true; for (const loop of loops.values()) clearInterval(loop.timer); loops.clear(); }
  return { execute, runOnce, setPartitions, stopTask, stop };
}
```

- [ ] **Step 4: 跑测试并提交**

Run: `node --test server/test/scheduler-queue-consumer.test.js`
Expected: PASS

```bash
git add server/scheduler/queue/consumer.js server/test/scheduler-queue-consumer.test.js
git commit -m "feat(scheduler): add partition consumer"
```

---

## Task 10: 队列装配与调度器接线

**Files:**
- Create: `server/scheduler/queue/index.js`
- Modify: `server/scheduler/index.js`
- Modify: `server/index.js`
- Modify: `server/scheduler/http-mount.js`（只改签名，Task 11 完成接口）
- Test: `server/test/scheduler-index.test.js`

- [ ] **Step 1: 写测试**

```js
test('createScheduler 暴露 queue/registry/consumer/start/stop', async () => {
  const dir = tmpDir();
  const s = createScheduler({
    dir, manifestRoot: path.join(dir, 'manifests'),
    machineId: 'm1', hostport: 'h:1', role: 'master', version: 'v',
    queueConfigFile: path.join(dir, 'queue.json'),
    dbFile: path.join(dir, 'void.db'),
    startWorkers: false,
  });
  assert.ok(s.queue);
  assert.ok(s.registry);
  assert.ok(s.consumer);
  assert.equal(typeof s.start, 'function');
  await s.start({ startWorkers: false });
  assert.equal(await s.queue.partitionCount(), 16);
  await s.stop();
});
```

- [ ] **Step 2: 实现队列装配**

```js
// server/scheduler/queue/index.js
import path from 'node:path';
import { createQueueConfig } from './config.js';
import { createSqliteDriver } from './driver-sqlite.js';
import { createMysqlDriver } from './driver-mysql.js';
import { createRepository } from './repository.js';
import { createQueueService } from './service.js';

export function createQueue({ dir, dbFile = null, logger = console, now = () => Date.now() }) {
  const config = createQueueConfig({ dir, logger });
  let service = null;
  let driver = null;

  async function init() {
    if (service) return service;
    const c = config.get();
    if (c.backend === 'mysql') {
      driver = await createMysqlDriver({
        host: c.mysql.host, port: c.mysql.port, user: c.mysql.user,
        password: config.openPassword(), database: c.mysql.database, logger,
      });
    } else {
      driver = await createSqliteDriver({ file: dbFile || path.join(dir, '..', 'void.db') });
    }
    const repo = createRepository(driver);
    service = createQueueService({ repo, now, logger });
    return service;
  }

  const proxy = {
    ready: init,
    config,
    topic: 'scheduler.jobs',
    get driver() { return driver; },
    get repo() { return service?.repo || null; },
  };
  for (const name of ['partitionCount', 'enqueueTask', 'approve', 'reject', 'cancel', 'claim', 'complete', 'retry',
    'cleanupFinished', 'deleteTaskJobs', 'failRunningByWorker', 'recoverRunning', 'setPartitionCount',
    'getJob', 'listJobs', 'summary', 'partitionStats', 'parseParam']) {
    proxy[name] = async (...args) => (await init())[name](...args);
  }
  proxy.close = async () => { if (driver) await driver.close(); service = null; driver = null; };
  return proxy;
}
```

`dbFile` 由 `server/index.js` 传入 `usageDbFile`（即运行时数据目录下的 `void.db`）；测试传入临时文件。

- [ ] **Step 3: 改 `server/scheduler/index.js`**

```js
import { SchedulerStore } from './store.js';
import { createEngine } from './engine.js';
import { createRunner } from './runner.js';
import { createSchedulerMount } from './http-mount.js';
import { createJobsMount } from './jobs-mount.js';
import { readAiCommand } from './ai-commands.js';
import { createQueue } from './queue/index.js';
import { createWorkerRegistry } from './queue/workers.js';
import { createConsumer } from './queue/consumer.js';

export function createScheduler({
  dir, projectResolver = () => null, logger = console, runner = null, agentCmd = 'opencode',
  opencodeDataDir = null, manifestRoot = null, workflowExecutor = null,
  machineId = 'local', hostport = '127.0.0.1:22222', role = 'master', version = '',
  dbFile = null, pullQueueConfig = null, onJobEvent = () => {},
}) {
  const store = new SchedulerStore({ dir, logger, ...(manifestRoot ? { manifestRoot } : {}) });
  const queue = createQueue({ dir, dbFile, logger });
  let registry = null;
  let consumer = null;
  let started = false;

  const engine = createEngine({ store, queue, logger, onStop: (id) => consumer?.stopTask(id) });

  async function start({ startWorkers = true } = {}) {
    if (started) return;
    if (role !== 'master' && pullQueueConfig) {
      const c = await pullQueueConfig().catch(() => null);
      if (c) queue.config.save(c);
    }
    await queue.ready();
    if (startWorkers) {
      await queue.recoverRunning(hostport);
      registry = createWorkerRegistry({ repo: queue.repo, topic: queue.topic, count: await queue.partitionCount(), logger });
      consumer = createConsumer({
        queue, store, runner: runner || createRunner(), workflowExecutor,
        aiPromptLoader: (name) => readAiCommand(name), worker: { id: `${machineId}:${queue.topic}`, hostport, machineId },
        aiBin: agentCmd, opencodeDataDir, projectResolver, logger,
        onEvent: (evt, payload) => onJobEvent(evt, payload),
      });
      registry.start({
        self: { id: `${machineId}:${queue.topic}`, hostport, role, version },
        onPartitions: (ids) => consumer.setPartitions(ids),
        onOffline: (deadHostport) => queue.failRunningByWorker(deadHostport),
        count: await queue.partitionCount(),
      });
    }
    engine.start();
    started = true;
  }
  async function stop() { consumer?.stop(); registry?.stop(); engine.stopAll(); await queue.close(); started = false; }
  async function syncQueueConfig() {
    if (!pullQueueConfig) return null;
    const c = await pullQueueConfig().catch(() => null);
    if (c) queue.config.save(c);
    return c;
  }

  const mount = createSchedulerMount({ engine, store, queue, logger });
  const jobsMount = createJobsMount({ queue, registry: () => registry, role, hostport, machineId, logger });
  return {
    store, engine, queue, mount, jobsMount, start, stop, syncQueueConfig,
    getRole: () => role,
    get registry() { return registry; }, get consumer() { return consumer; },
  };
}
```

- [ ] **Step 4: 改 `server/index.js` 启动/停止**

`createScheduler` 调用增加：

```js
machineId: engine.pub.machineId,
hostport: `${HOST}:${port}`,
role: engine.store.listGroups().some((g) => g.hubId === engine.pub.machineId) || !engine.store.listGroups().length ? 'master' : 'slave',
version: VERSION,
dbFile: usageDbFile,
pullQueueConfig: () => engine.pullQueueConfig?.(),
onJobEvent: (evt, payload) => {
  broadcastSched(evt === 'run-end' ? SchedulerS2C.SCHED_RUN_END : SchedulerS2C.SCHED_RUN_START, payload);
},
```

旧的 `scheduler.engine.onEvent` 中按 `payload.run.taskId` 刷新 manifest 的代码删除，只保留任务变更广播：

```js
scheduler.engine.onEvent((evt, payload) => {
  broadcastSched(SchedulerS2C.SCHED_TASKS_CHANGED, payload);
});
```

启动改为非阻塞：

```js
if (!['0', 'off', 'false'].includes(String(process.env.DEVFLOW_SCHEDULER || '').toLowerCase())) {
  ws.scheduler.start().then(() => log.info('scheduler started')).catch((e) => log.error('scheduler start failed', e));
}
```

`runtimeProvider` 改为：

```js
scheduler.store.setRuntimeProvider((id) => ({
  nextRunAt: scheduler.engine.nextRunAtOf(id),
  lastRun: null,
}));
```

（`lastRun` 在 Task 12 接上 `/jobs` 后由前端查询。）

- [ ] **Step 5: 跑测试并提交**

Run: `node --test server/test/scheduler-index.test.js`
Expected: PASS

```bash
git add server/scheduler/queue/index.js server/scheduler/index.js server/index.js server/test/scheduler-index.test.js
git commit -m "feat(scheduler): wire queue workers and consumer"
```

---

## Task 10b: slave 同步 master 的 MySQL 配置

**Files:**
- Modify: `shared/collab.js`
- Modify: `server/collaboration/engine.js`
- Modify: `server/index.js`
- Modify: `server/scheduler/queue/config.js`
- Test: `server/test/collab-queue-config.test.js`

- [ ] **Step 1: 写测试**

```js
// server/test/collab-queue-config.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPairHarness } from '../collaboration/engine.js';

test('QUEUE_CONFIG：成员从 master 拉取队列配置', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    A.setQueueConfigProvider(() => ({ host: 'db', port: 3306, user: 'u', password: 'p', database: 'devflow' }));
    const cfg = await B.pullQueueConfig();
    assert.equal(cfg.host, 'db');
    assert.equal(cfg.password, 'p');
  } finally {
    await h.stop();
  }
});
```

- [ ] **Step 2: 加 peer 消息**

`shared/collab.js` 的 `CollabPeer` 增加：

```js
QUEUE_CONFIG: 'queue-config',
```

`server/collaboration/engine.js`：

1. 在 `handleIncoming` 的 `switch` 中加 `case CollabPeer.QUEUE_CONFIG: return this._inQueueConfig(env);`
2. 增加方法：

```js
setQueueConfigProvider(fn) { this.queueConfigProvider = fn; }

_inQueueConfig(env) {
  const groupId = env.payload && env.payload.groupId;
  const g = this.store.getGroup(groupId);
  if (!g) return { ok: false, error: 'no-group' };
  if (!g.members.find((m) => m.machineId === this.pub.machineId)) return { ok: false, error: 'not-member' };
  if (g.hubId !== this.pub.machineId) return { ok: false, error: 'not-hub' };
  const config = this.queueConfigProvider ? this.queueConfigProvider() : null;
  if (!config) return { ok: false, error: 'no-config' };
  return { ok: true, data: { config } };
}

async pullQueueConfig() {
  for (const g of this.store.listGroups()) {
    const me = g.members.find((m) => m.machineId === this.pub.machineId);
    if (!me || g.hubId === this.pub.machineId) continue;
    const hub = g.members.find((m) => m.machineId === g.hubId);
    if (!hub) continue;
    const res = await this._post(hub.host, hub.port, this._sign(CollabPeer.QUEUE_CONFIG, { groupId: g.id }));
    if (res && res.ok && res.data && res.data.config) return res.data.config;
  }
  return null;
}
```

- [ ] **Step 3: 配置增加同步视图**

`server/scheduler/queue/config.js` 增加：

```js
function syncConfig() {
  const c = get();
  if (c.backend !== 'mysql') return null;
  return {
    host: c.mysql.host, port: c.mysql.port, user: c.mysql.user,
    database: c.mysql.database, password: openPassword(),
  };
}
```

并加入返回对象：`{ ..., syncConfig }`。

- [ ] **Step 4: 接线**

`server/index.js` 创建 scheduler 后（`buildWorkspace` 内，使用局部 `engine` / `scheduler`）：

```js
engine.setQueueConfigProvider?.(() => scheduler.queue.config.syncConfig());
```

`scheduler.start()` 已在 Task 10 里对 slave 调 `pullQueueConfig`。再加 60s 刷新：

```js
const queueCfgTimer = setInterval(() => {
  if (scheduler.getRole?.() === 'slave') scheduler.syncQueueConfig?.().catch(() => { /* ignore */ });
}, 60000);
queueCfgTimer.unref?.();
```

`createScheduler` 增加并返回：

```js
async function syncQueueConfig() {
  if (!pullQueueConfig) return null;
  const c = await pullQueueConfig().catch(() => null);
  if (c) queue.config.save(c);
  return c;
}
// return 里加入 syncQueueConfig, getRole: () => role
```

> 保存后新配置在下次后端启动时生效；队列页提示需重启后端。

- [ ] **Step 5: 跑测试并提交**

Run: `node --test server/test/collab-queue-config.test.js`
Expected: PASS

```bash
git add shared/collab.js server/collaboration/engine.js server/scheduler/queue/config.js server/index.js server/test/collab-queue-config.test.js
git commit -m "feat(scheduler): sync queue config from master"
```

---

## Task 11: 队列 HTTP 接口

**Files:**
- Create: `server/scheduler/jobs-mount.js`
- Modify: `server/scheduler/http-mount.js`
- Test: `server/test/scheduler-jobs-http.test.js`

- [ ] **Step 1: 写测试**

```js
// server/test/scheduler-jobs-http.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createJobsMount } from '../scheduler/jobs-mount.js';

function call(mount, method, url, body) {
  const req = new EventEmitter();
  req.method = method; req.url = url; req.destroy = () => {};
  const res = { status: 0, body: '' };
  const p = new Promise((r) => { res.writeHead = (s) => { res.status = s; }; res.end = (s) => { res.body = s || ''; r(res); }; });
  const ret = mount(req, res);
  if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
  req.emit('end');
  return Promise.resolve(ret).then(() => p);
}

function setup(role = 'master') {
  const q = {
    listJobs: async () => [{ jobId: 'j1', status: 0 }],
    summary: async () => ({ queued: 1, running: 0, pending: 0, success: 0, failed: 0, total: 1 }),
    partitionStats: async () => [{ id: 0, queued: 1, running: 0, pending: 0 }],
    partitionCount: async () => 16,
    getJob: async (id) => ({ jobId: id, status: 4 }),
    approve: async () => ({ ok: true }),
    reject: async () => ({ ok: true }),
    cancel: async () => ({ ok: true }),
    retry: async () => ({ job: { jobId: 'j2' } }),
    cleanupFinished: async () => 1,
    setPartitionCount: async (n) => ({ ok: true, count: n }),
    config: { publicConfig: () => ({ backend: 'sqlite', hasPassword: false }), save: () => ({ ok: true }) },
  };
  return { mount: createJobsMount({ queue: q, role, logger: console }), q };
}

test('GET /api/scheduler/jobs 返回作业与统计', async () => {
  const { mount } = setup();
  const r = await call(mount, 'GET', '/api/scheduler/jobs?status=0&partition=0');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).jobs.length, 1);
});

test('slave 不能审批', async () => {
  const { mount } = setup('slave');
  const r = await call(mount, 'POST', '/api/scheduler/jobs/j1/approve');
  assert.equal(r.status, 403);
});

test('master 审批与重试', async () => {
  const { mount } = setup();
  assert.equal((await call(mount, 'POST', '/api/scheduler/jobs/j1/approve')).status, 200);
  assert.equal((await call(mount, 'POST', '/api/scheduler/jobs/j1/retry')).status, 200);
});
```

- [ ] **Step 2: 实现 jobs-mount**

```js
// server/scheduler/jobs-mount.js
const sendJson = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const readBody = (req, limit = 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let total = 0;
  req.on('data', (c) => { total += c.length; if (total > limit) { reject(new Error('body too large')); req.destroy(); return; } chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

export function createJobsMount({ queue, registry = () => null, role = 'master', logger = console, hostport = '', machineId = '' }) {
  const isMaster = () => role === 'master';
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p === '/api/scheduler/jobs' && req.method === 'GET') {
        const status = url.searchParams.get('status');
        const partition = url.searchParams.get('partition');
        const taskId = url.searchParams.get('taskId');
        const limit = Number(url.searchParams.get('limit')) || 500;
        const jobs = await queue.listJobs({
          status: status === null || status === '' ? null : Number(status),
          partitionId: partition === null || partition === '' ? null : Number(partition),
          taskIds: taskId ? [taskId] : null,
          limit,
        });
        return sendJson(res, 200, {
          jobs, summary: await queue.summary(), partitions: await queue.partitionStats(),
          topic: queue.topic, partitionCount: await queue.partitionCount(),
        });
      }
      const m = p.match(/^\/api\/scheduler\/jobs\/([^/]+)(?:\/(approve|reject|cancel|retry))?$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const action = m[2];
        if (!action && req.method === 'GET') {
          const job = await queue.getJob(id);
          if (!job) return sendJson(res, 404, { error: 'not-found' });
          return sendJson(res, 200, { job, local: job.workIP === hostport });
        }
        if (action === 'approve' || action === 'reject') {
          if (!isMaster()) return sendJson(res, 403, { error: 'master-only' });
          const r = await queue[action](id);
          if (r.error) return sendJson(res, 409, { error: r.error });
          return sendJson(res, 200, r);
        }
        if (action === 'cancel') {
          const r = await queue.cancel(id);
          if (r.error) return sendJson(res, 409, { error: r.error });
          return sendJson(res, 200, r);
        }
        if (action === 'retry') {
          const r = await queue.retry(id, { createMachineId: machineId, createIP: hostport });
          if (r.error) return sendJson(res, 409, { error: r.error });
          return sendJson(res, 200, r);
        }
      }
      if (p === '/api/scheduler/jobs/cleanup' && req.method === 'POST') {
        if (!isMaster()) return sendJson(res, 403, { error: 'master-only' });
        const body = await readBody(req);
        const deleted = await queue.cleanupFinished({ partitionId: body.partitionId ?? null });
        return sendJson(res, 200, { deleted });
      }
      if (p === '/api/scheduler/workers' && req.method === 'GET') {
        const reg = registry();
        return sendJson(res, 200, { workers: reg ? await reg.list() : [] });
      }
      if (p === '/api/scheduler/queue/config' && req.method === 'GET') {
        return sendJson(res, 200, { ...queue.config.publicConfig(), partitionCount: await queue.partitionCount(), role });
      }
      if (p === '/api/scheduler/queue/config' && req.method === 'PUT') {
        if (!isMaster()) return sendJson(res, 403, { error: 'master-only' });
        const r = queue.config.save(await readBody(req));
        if (r.error) return sendJson(res, 400, r);
        return sendJson(res, 200, r);
      }
      if (p === '/api/scheduler/queue/partitions' && req.method === 'PUT') {
        if (!isMaster()) return sendJson(res, 403, { error: 'master-only' });
        const body = await readBody(req);
        const r = await queue.setPartitionCount(body.count);
        if (r.error) return sendJson(res, 400, r);
        return sendJson(res, 200, r);
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      logger.error('scheduler jobs http', e);
      return sendJson(res, 500, { error: 'internal', message: String(e?.message || e) });
    }
  };
}
```

- [ ] **Step 3: 改任务 mount**

- `createSchedulerMount({ engine, store, queue, logger })`。
- `withNext(task)` 改为 `nextRunAt` + `recentJobs: await queue.listJobs({ taskIds: [task.id], limit: 10 })`（`withNext` 变 async，所有 map 改 `Promise.all`）。
- 删除 `/runs`、`/runs/:id/report`、`/runs/:id/log`、`/runs/:id/reveal-report`。
- `/summary` 改为 `await queue.summary()`。
- 手动运行：`const r = await engine.manualRun(id)`，返回 `{ job: r.job }`；`r.error` 映射 409。
- 停止：`const ok = await engine.stop(id)`，返回 `{ ok }`。
- 删除任务前先 `await engine.stop(id)` 停掉执行中的作业，再 `await queue.deleteTaskJobs(id)`，再 `store.deleteTask(id)`。
- `GET /tasks`、`POST /tasks`、`PUT /tasks/:id` 都改成 `await withNext(...)`。
- 更新 `server/test/scheduler-http.test.js`：删除 runs/report/log 用例，改为断言 `/summary` 来自队列、手动运行返回 `job`、删除任务会调用 `queue.deleteTaskJobs`。
- 清理 `server/scheduler/http-mount.js` 顶部不再使用的 `legacyReport/reportDirOf/LOG_TAIL_MAX/REPORT_MAX` 导入与常量。

- [ ] **Step 4: `server/index.js` 路由**

在 `/api/scheduler` 分发前先匹配 jobs：

```js
if (url.pathname.startsWith('/api/scheduler/jobs') || url.pathname === '/api/scheduler/workers' || url.pathname.startsWith('/api/scheduler/queue')) {
  await ws.scheduler.jobsMount(req, res); return;
}
if (url.pathname.startsWith('/api/scheduler')) { await ws.scheduler.mount(req, res); return; }
```

- [ ] **Step 5: 跑测试并提交**

Run: `node --test server/test/scheduler-jobs-http.test.js server/test/scheduler-http.test.js`
Expected: PASS

```bash
git add server/scheduler/jobs-mount.js server/scheduler/http-mount.js server/index.js server/test/scheduler-jobs-http.test.js
git commit -m "feat(scheduler): expose job queue http api"
```

---

## Task 12: 前端数据层 `useJobs`

**Files:**
- Create: `web/src/jobs/useJobs.ts`
- Create: `web/src/jobs/format.ts`
- Test: `web/src/jobs/useJobs.test.ts`
- Test: `web/src/jobs/format.test.ts`

- [ ] **Step 1: 写测试**

```ts
// web/src/jobs/useJobs.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useJobs } from './useJobs';

const calls: Array<{ url: string; method: string }> = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url.startsWith('/api/scheduler/jobs?') || url === '/api/scheduler/jobs') {
      return { ok: true, text: async () => JSON.stringify({ jobs: [{ jobId: 'j1', status: 0 }], summary: { queued: 1 }, partitions: [{ id: 0, queued: 1 }], partitionCount: 16 }) } as any;
    }
    return { ok: true, text: async () => JSON.stringify({ ok: true }) } as any;
  }));
});

describe('useJobs', () => {
  it('refresh 拉取作业与统计', async () => {
    const j = useJobs();
    await j.refresh();
    expect(j.state.jobs.length).toBe(1);
    expect(j.state.summary.queued).toBe(1);
    expect(j.state.partitions[0].id).toBe(0);
  });
  it('动作走后端', async () => {
    const j = useJobs();
    await j.approve('j1');
    await j.reject('j1');
    await j.cancel('j1');
    await j.retry('j1');
    expect(calls.map((c) => c.url)).toContain('/api/scheduler/jobs/j1/approve');
    expect(calls.map((c) => c.url)).toContain('/api/scheduler/jobs/j1/retry');
  });
  it('按 partition 过滤', async () => {
    const j = useJobs();
    j.state.partition = 3;
    await j.refresh();
    expect(calls.some((c) => c.url.includes('partition=3'))).toBe(true);
  });
});
```

- [ ] **Step 2: 实现**

```ts
// web/src/jobs/useJobs.ts
import { reactive } from 'vue';

export interface Job {
  jobId: string; parentJobId?: string | null; topic?: string; groupName?: string | null;
  partitionId: number; status: number; weight?: number; runtime?: number | null;
  createIP?: string | null; workIP?: string | null; traceId?: string | null;
  createTime: number; lastUpdateTime: number; paramStr?: string; result?: string | null;
  maxRunMilliSecond?: number;
}
export interface PartitionStat { id: number; queued: number; running: number; pending: number; }
export interface JobSummary { queued: number; running: number; pending: number; success: number; failed: number; total: number; }

async function api(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function useJobs() {
  const state = reactive({
    jobs: [] as Job[], summary: { queued: 0, running: 0, pending: 0, success: 0, failed: 0, total: 0 } as JobSummary,
    partitions: [] as PartitionStat[], partitionCount: 16, topic: 'scheduler.jobs',
    status: null as number | null, partition: null as number | null, taskId: '', loading: false, error: '',
  });
  async function refresh() {
    state.loading = true;
    try {
      const q = new URLSearchParams();
      if (state.status !== null) q.set('status', String(state.status));
      if (state.partition !== null) q.set('partition', String(state.partition));
      if (state.taskId.trim()) q.set('taskId', state.taskId.trim());
      const d = await api('GET', `/api/scheduler/jobs?${q}`);
      state.jobs = d.jobs || [];
      state.summary = { queued: 0, running: 0, pending: 0, success: 0, failed: 0, total: 0, ...(d.summary || {}) };
      state.partitions = d.partitions || [];
      state.partitionCount = d.partitionCount || 16;
      state.topic = d.topic || 'scheduler.jobs';
      state.error = '';
    } catch (e: any) { state.error = String(e?.message || e); }
    finally { state.loading = false; }
  }
  const action = (name: string) => (id: string) => api('POST', `/api/scheduler/jobs/${encodeURIComponent(id)}/${name}`);
  return {
    state, refresh,
    approve: action('approve'), reject: action('reject'), cancel: action('cancel'), retry: action('retry'),
    cleanup: (partitionId?: number) => api('POST', '/api/scheduler/jobs/cleanup', { partitionId }),
    loadWorkers: () => api('GET', '/api/scheduler/workers'),
    loadConfig: () => api('GET', '/api/scheduler/queue/config'),
    saveConfig: (body: unknown) => api('PUT', '/api/scheduler/queue/config', body),
    setPartitions: (count: number) => api('PUT', '/api/scheduler/queue/partitions', { count }),
  };
}
```

```ts
// web/src/jobs/format.ts
import { t } from '../i18n';

export const JOB_STATUS_LABEL: Record<number, string> = {
  0: 'jobs.status.queued', 1: 'jobs.status.success', 2: 'jobs.status.failed',
  3: 'jobs.status.running', 4: 'jobs.status.pending',
};
export function jobStatusLabel(s: number): string { return t(JOB_STATUS_LABEL[s] || 'jobs.status.failed'); }
export function jobStatusClass(s: number): string {
  return s === 1 ? 'ok' : s === 2 ? 'bad' : s === 3 ? 'run' : s === 4 ? 'wait' : 'queue';
}
```

- [ ] **Step 3: 跑测试并提交**

Run: `npm.cmd --prefix web run test -- src/jobs/useJobs.test.ts`
Expected: PASS

```bash
git add web/src/jobs/useJobs.ts web/src/jobs/format.ts web/src/jobs/useJobs.test.ts
git commit -m "feat(jobs): add queue data layer"
```

---

## Task 13: 作业队列页面

**Files:**
- Create: `web/src/jobs/JobsView.vue`
- Test: `web/src/jobs/JobsView.test.ts`

- [ ] **Step 1: 写测试**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import JobsView from './JobsView.vue';

function ok(data: unknown) { return { ok: true, text: async () => JSON.stringify(data) } as any; }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/scheduler/jobs')) {
      return ok({ jobs: [{ jobId: 'j1', status: 0, partitionId: 0, createTime: 1, lastUpdateTime: 1, paramStr: '{"task":{"name":"scan"}}' }], summary: { queued: 1, running: 0, pending: 0, success: 0, failed: 0, total: 1 }, partitions: Array.from({ length: 16 }, (_, id) => ({ id, queued: id === 0 ? 1 : 0, running: 0, pending: 0 })), partitionCount: 16 });
    }
    if (url === '/api/scheduler/workers') return ok({ workers: [] });
    return ok({});
  }));
});

describe('JobsView', () => {
  it('渲染 16 个 partition 和排队统计', async () => {
    const w = mountC(JobsView);
    await flushPromises();
    expect(w.findAll('.partition-col').length).toBe(16);
    expect(w.find('.sum-queued .num').text()).toBe('1');
    expect(w.text()).toContain('scan');
  });
});
```

- [ ] **Step 2: 实现**

`<script setup>` 使用 `useJobs`，2 秒轮询（`onMounted` 启动、`onUnmounted` 停止）：

```ts
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { t } from '../i18n';
import { useJobs, type Job } from './useJobs';
import { jobStatusLabel, jobStatusClass } from './format';

const jobs = useJobs();
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => { void jobs.refresh(); void loadWorkers(); void loadConfig(); timer = setInterval(() => { void jobs.refresh(); void loadWorkers(); }, 2000); });
onUnmounted(() => { if (timer) clearInterval(timer); });
const detail = ref<Job | null>(null);
const focus = ref<number | null>(null);
const visiblePartitions = computed(() => focus.value === null
  ? jobs.state.partitions
  : jobs.state.partitions.filter((p) => p.id === focus.value));
const workers = ref<any[]>([]);
const isMaster = ref(false);
const configOpen = ref(false);
const config = ref({ backend: 'sqlite', host: '', port: 3306, user: '', database: '', hasPassword: false, password: '' });

async function loadWorkers() {
  try { workers.value = (await jobs.loadWorkers()).workers || []; } catch { workers.value = []; }
}
async function loadConfig() {
  try { const d = await jobs.loadConfig(); config.value = { ...config.value, ...d, password: '' }; isMaster.value = d.role === 'master'; } catch { isMaster.value = false; }
}
async function saveConfig() {
  await jobs.saveConfig(config.value);
  configOpen.value = false;
  alert(t('jobs.config.restart_required'));
}
function taskNameOf(job: Job): string {
  try { return JSON.parse(job.paramStr || '{}').task?.name || '—'; } catch { return '—'; }
}
function reportOf(job: Job): string {
  try { return JSON.parse(job.result || '{}').reportMarkdown || ''; } catch { return ''; }
}
```

模板结构：

```html
<div class="jobs-view">
  <header class="jobs-head">
    <span class="title">{{ $t('jobs.title') }}</span>
    <span class="dim">{{ jobs.state.topic }} · {{ jobs.state.partitionCount }} partitions</span>
    <button @click="jobs.refresh()">{{ $t('sched.refresh') }}</button>
    <select v-model="jobs.state.status" @change="jobs.refresh()">
      <option :value="null">{{ $t('jobs.filter.all') }}</option>
      <option :value="0">{{ $t('jobs.status.queued') }}</option>
      <option :value="3">{{ $t('jobs.status.running') }}</option>
      <option :value="4">{{ $t('jobs.status.pending') }}</option>
      <option :value="1">{{ $t('jobs.status.success') }}</option>
      <option :value="2">{{ $t('jobs.status.failed') }}</option>
    </select>
    <input v-model="jobs.state.taskId" :placeholder="$t('jobs.filter.task')" @keyup.enter="jobs.refresh()" />
    <button @click="focus = null">{{ $t('jobs.filter.all_partitions') }}</button>
    <button v-if="isMaster" @click="jobs.cleanup()">{{ $t('jobs.action.cleanup') }}</button>
    <button v-if="isMaster" @click="configOpen = true; loadConfig()">{{ $t('jobs.config.title') }}</button>
  </header>
  <div class="summary">
    <div class="sum-card sum-queued"><span class="num">{{ jobs.state.summary.queued }}</span><span>{{ $t('jobs.summary.queued') }}</span></div>
    <div class="sum-card sum-running"><span class="num">{{ jobs.state.summary.running }}</span><span>{{ $t('jobs.summary.running') }}</span></div>
    <div class="sum-card sum-pending"><span class="num">{{ jobs.state.summary.pending }}</span><span>{{ $t('jobs.summary.pending') }}</span></div>
    <div class="sum-card sum-success"><span class="num">{{ jobs.state.summary.success }}</span><span>{{ $t('jobs.summary.success') }}</span></div>
    <div class="sum-card sum-failed"><span class="num">{{ jobs.state.summary.failed }}</span><span>{{ $t('jobs.summary.failed') }}</span></div>
  </div>
  <section class="workers">
    <span v-for="w in workers" :key="w.id" class="worker" :class="{ off: !w.online }">
      {{ w.hostport }} · {{ w.role }} · {{ w.online ? $t('jobs.worker.online') : $t('jobs.worker.offline') }} · P{{ w.partitionIds }}
    </span>
  </section>
  <div class="partitions">
    <section v-for="p in visiblePartitions" :key="p.id" class="partition-col" @click="focus = p.id">
      <header>P{{ p.id }} · {{ $t('jobs.partition.queued', { n: p.queued }) }} · {{ $t('jobs.partition.running', { n: p.running }) }}</header>
      <article v-for="job in jobs.state.jobs.filter((j) => j.partitionId === p.id)" :key="job.jobId" class="job-card" @click.stop="detail = job">
        <span class="st" :class="jobStatusClass(job.status)">{{ jobStatusLabel(job.status) }}</span>
        <span class="name">{{ taskNameOf(job) }}</span>
        <span class="ip">{{ job.workIP || job.createIP || '—' }}</span>
      </article>
    </section>
  </div>
  <aside v-if="detail" class="job-drawer">
    <button @click="detail = null">×</button>
    <h3>{{ $t('jobs.detail.title') }}</h3>
    <div>jobId: {{ detail.jobId }}</div>
    <div>parentJobId: {{ detail.parentJobId || '—' }}</div>
    <div>traceId: {{ detail.traceId || '—' }}</div>
    <div>partition: P{{ detail.partitionId }}</div>
    <div>status: {{ jobStatusLabel(detail.status) }}</div>
    <div>workIP: {{ detail.workIP || '—' }}</div>
    <div>runtime: {{ detail.runtime ?? '—' }} ms</div>
    <pre class="report">{{ reportOf(detail) }}</pre>
    <div class="acts">
      <button v-if="detail.status === 4" @click="jobs.approve(detail.jobId)">{{ $t('jobs.action.approve') }}</button>
      <button v-if="detail.status === 4" @click="jobs.reject(detail.jobId)">{{ $t('jobs.action.reject') }}</button>
      <button v-if="detail.status === 0 || detail.status === 3" @click="jobs.cancel(detail.jobId)">{{ $t('jobs.action.cancel') }}</button>
      <button v-if="detail.status === 2" @click="jobs.retry(detail.jobId)">{{ $t('jobs.action.retry') }}</button>
    </div>
  </aside>
  <div v-if="configOpen" class="modal">
    <h3>{{ $t('jobs.config.title') }}</h3>
    <label>host <input v-model="config.host" /></label>
    <label>port <input type="number" v-model.number="config.port" /></label>
    <label>user <input v-model="config.user" /></label>
    <label>database <input v-model="config.database" /></label>
    <label>password <input type="password" v-model="config.password" :placeholder="config.hasPassword ? '******' : ''" /></label>
    <button @click="saveConfig()">{{ $t('sched.save') }}</button>
    <button @click="configOpen = false">{{ $t('sched.cancel') }}</button>
  </div>
</div>
```

- [ ] **Step 3: 跑测试并提交**

Run: `npm.cmd --prefix web run test -- src/jobs/JobsView.test.ts`
Expected: PASS

```bash
git add web/src/jobs/JobsView.vue web/src/jobs/JobsView.test.ts
git commit -m "feat(jobs): add partition job queue view"
```

---

## Task 14: 定时任务页改用作业队列

**Files:**
- Modify: `web/src/scheduler/useScheduler.ts`
- Modify: `web/src/scheduler/SchedulerView.vue`
- Modify: `web/src/scheduler/format.ts`
- Modify: `web/src/scheduler/useScheduler.test.ts`
- Modify: `web/src/scheduler/SchedulerView.test.ts`

- [ ] **Step 1: 更新数据层**

- `runNow` 返回 `{ job }`；`stopTask` 不改。
- `loadRuns` 改名为 `loadJobs(taskId, limit)`，请求 `/api/scheduler/jobs?taskId=...&limit=...`，返回 `d.jobs`。
- 删除 `loadLog/loadReport/openReportDir` 或改为从 job 的 `result` 读取。
- `summary` 改为 `{ queued, running, pending, success, failed, total }`。
- `TaskView` 的 `recentRuns` 改为 `recentJobs`；`format.ts` 的 `runStatusLabel` 改为接收数字状态码（0/1/2/3/4），`recentRunsOf` 改为 `recentJobsOf` 并把 `status` 传给新标签函数。
- 订阅 `sched-run-start` / `sched-run-end` 仍刷新。

测试改为 `/api/scheduler/jobs`、`/api/scheduler/workers`，断言 `runNow` 只 POST `/run`。

- [ ] **Step 2: 任务编辑器新增字段**

在表单类型中增加：

```ts
approvalRequired: false,
onlyLocal: false,
uniqueKey: '',
weight: 0,
maxRunMilliSecond: 0,
groupName: 'default',
```

模板在调度设置附近加入：

```html
<label class="inline"><input type="checkbox" v-model="form.approvalRequired" /> {{ $t('sched.field.approval_required') }}</label>
<label class="inline"><input type="checkbox" v-model="form.onlyLocal" /> {{ $t('sched.field.only_local') }}</label>
<label class="inline">{{ $t('sched.field.unique_key') }} <input v-model="form.uniqueKey" /></label>
<label class="inline">{{ $t('sched.field.weight') }} <input type="number" v-model.number="form.weight" /></label>
<label class="inline">{{ $t('sched.field.max_run_ms') }} <input type="number" v-model.number="form.maxRunMilliSecond" /></label>
```

保存时把空字符串的 `uniqueKey` 转成 `null`。

- [ ] **Step 3: 详情页历史改用 jobs**

`openDetail` 调 `loadJobs(task.id, 50)`；每条显示状态、耗时、执行机器、报告正文（从 `result.reportMarkdown`）。删除「原始日志」按钮，保留「报告」。本机 `workIP` 等于 `window.location.host` 时显示「打开日志目录」。

- [ ] **Step 4: 汇总卡增加排队/待审**

在现有成功/失败/运行中旁增加：

```html
<div class="sum-card sum-queued"><span class="num">{{ sched.state.summary.queued }}</span><span>{{ $t('jobs.summary.queued') }}</span></div>
<div class="sum-card sum-pending"><span class="num">{{ sched.state.summary.pending }}</span><span>{{ $t('jobs.summary.pending') }}</span></div>
```

- [ ] **Step 5: 跑测试并提交**

Run: `npm.cmd --prefix web run test -- src/scheduler/useScheduler.test.ts src/scheduler/SchedulerView.test.ts`
Expected: PASS

```bash
git add web/src/scheduler/useScheduler.ts web/src/scheduler/SchedulerView.vue web/src/scheduler/format.ts web/src/scheduler/useScheduler.test.ts web/src/scheduler/SchedulerView.test.ts
git commit -m "feat(scheduler): use job queue in scheduler ui"
```

---

## Task 15: 活动栏入口、窗口状态与 i18n

**Files:**
- Modify: `web/src/App.vue`
- Modify: `web/src/windowState.ts`
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`
- Test: `web/src/i18n.test.ts`（现有键集合对称测试会自动覆盖）

- [ ] **Step 1: 加 rail**

`windowState.ts` 的 `Rail` 增加 `'jobs'`。

`App.vue`：

```ts
import JobsView from './jobs/JobsView.vue';
const RAILS = ['explorer', 'contacts', 'stat', 'scheduler', 'jobs', 'proxy', 'mobile'];
```

活动栏按钮放在定时任务后面：

```html
<button class="a-btn" :class="{ on: rail === 'jobs' }" :title="$t('nav.jobs')" @click="rail = 'jobs'">🗂</button>
```

内容区：

```html
<template v-else-if="rail === 'jobs'">
  <section class="center"><JobsView /></section>
</template>
```

- [ ] **Step 2: 补 i18n**

中英两文件同时加入以下键（英文自行翻译，键名必须一致）：

```js
'nav.jobs': '作业队列',
'jobs.title': '作业队列',
'jobs.filter.all': '全部状态',
'jobs.filter.task': '按任务搜索',
'jobs.filter.all_partitions': '全部 Partitions',
'jobs.worker.online': '在线',
'jobs.worker.offline': '离线',
'jobs.config.title': '队列设置',
'jobs.config.restart_required': '队列配置已保存，重启后端后生效',
'jobs.config.backend': '存储后端',
'jobs.config.mysql': 'MySQL 连接',
'jobs.config.host': '主机',
'jobs.config.port': '端口',
'jobs.config.user': '用户',
'jobs.config.password': '密码',
'jobs.config.database': '数据库',
'jobs.config.test': '测试连接',
'jobs.config.partition_count': 'Partition 数',
'jobs.summary.queued': '排队',
'jobs.summary.running': '调度中',
'jobs.summary.pending': '待审',
'jobs.summary.success': '成功',
'jobs.summary.failed': '失败',
'jobs.status.queued': '排队中',
'jobs.status.running': '调度中',
'jobs.status.pending': '待审',
'jobs.status.success': '成功',
'jobs.status.failed': '失败',
'jobs.partition.queued': '排队 {n}',
'jobs.partition.running': '执行中 {n}',
'jobs.detail.title': '作业详情',
'jobs.action.approve': '批准',
'jobs.action.reject': '驳回',
'jobs.action.cancel': '取消',
'jobs.action.retry': '重试',
'jobs.action.cleanup': '清空已完成',
'sched.field.approval_required': '需审批',
'sched.field.only_local': '仅本机执行',
'sched.field.unique_key': '唯一键',
'sched.field.weight': '权重',
'sched.field.max_run_ms': '超时（ms）',
```

- [ ] **Step 3: 检查 i18n 与类型**

Run: `npm.cmd run check:i18n`
Expected: PASS

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add web/src/App.vue web/src/windowState.ts shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(jobs): add activity rail and i18n"
```

---

## Task 16: 全量验证

- [ ] **Step 1: 跑全部测试**

Run: `npm.cmd test`
Expected: PASS（server + web）

- [ ] **Step 2: 类型与 i18n**

Run: `npm.cmd run typecheck`
Expected: PASS

Run: `npm.cmd run check:i18n`
Expected: PASS

- [ ] **Step 3: 手动验收（SQLite 单机）**

1. `npm.cmd run dev`。
2. 新建一个每 10 秒触发、执行 `echo` 的 shell 任务，开启「需审批」。
3. 作业队列页应出现待审作业；master 批准后进入排队，随后执行成功。
4. 触发一个执行 30 秒的任务，确认同一 partition 内后续作业排队等待，不被丢弃。
5. 设置 `maxRunMilliSecond=1000`，确认超时后状态为失败且报告含 `timeout`。
6. 删除任务，确认排队/待审作业变成失败，已完成历史仍在。

- [ ] **Step 4: 手动验收（MySQL 双机，可选）**

1. master 配置一台 MySQL，确认队列页后端显示 `MySQL`。
2. 第二台 devflow 作为 slave 加入群，确认 `t_work_status` 出现两条在线记录且 partition 均分。
3. 在两台机器各建一个任务，确认作业可以跨机执行，`workIP` 显示实际执行机器。
4. 关闭一台 worker，等待 30 秒，确认其 partition 被重新分配，运行中作业变为失败。

- [ ] **Step 5: 最终提交**

```bash
git add server shared web docs/superpowers/plans/2026-10-23-scheduler-job-queue.md
git commit -m "feat(scheduler): add distributed job queue"
```

---

## 自检

- 每个设计目标都有对应任务：常量/配置/表/SQLite/MySQL/service/worker/consumer/engine/HTTP/前端/入口/验证。
- 没有 TBD、TODO、`类似 Task N` 占位。
- 关键类型与字段名在任务间保持一致：`jobId/status/partitionId/activeKey/paramStr/result/workIP/maxRunMilliSecond`。
- `uniqueKey` 只在 `status=0` 生效；审批通过时才恢复 `activeKey`。
- 报告正文写 `result.reportMarkdown`，日志留本地；`runs.json` 不再读写。
