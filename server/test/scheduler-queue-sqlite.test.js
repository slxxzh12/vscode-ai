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
  assert.equal((await repo.summary('scheduler.jobs')).queued, 1);
  assert.equal((await repo.deleteFinished({ topic: 'scheduler.jobs' })), 2);
  assert.equal((await repo.listJobs({ limit: 10 })).length, 1);
  await repo.setConfig('partitionCount', '16');
  assert.equal(await repo.getConfig('partitionCount'), '16');
  await repo.upsertWorker({ id: 'm1:scheduler.jobs', hostport: 'w:1', status: 1, lastUpdateTime: 5, partitionIds: '[0]', role: 'master', version: 'v', topic: 'scheduler.jobs' });
  assert.equal((await repo.listWorkers('scheduler.jobs'))[0].hostport, 'w:1');
  await driver.close();
});
