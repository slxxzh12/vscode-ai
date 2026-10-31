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
