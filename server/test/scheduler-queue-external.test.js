import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteDriver } from '../scheduler/queue/driver-sqlite.js';
import { createRepository } from '../scheduler/queue/repository.js';
import { createQueueService } from '../scheduler/queue/service.js';

async function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qexternal-')), 'void.db');
  const driver = await createSqliteDriver({ file });
  const repo = createRepository(driver);
  return { repo, driver, svc: createQueueService({ repo }) };
}

test('外部触发作业：running 入表、worker 不领取、按 groupName 列表、完成更新', async () => {
  const { svc, repo, driver } = await setup();
  const r = await svc.enqueueExternalJob({
    jobId: 'ai_1', groupName: 'ai-site', taskId: 'run-1', classname: 'ai-site', methodName: 'run',
    paramStr: { task: { name: '翻译助手' }, user: 'alice' }, result: { logPath: 'a.log' },
    status: 3, createTime: 100, workIP: 'h:1',
  });
  assert.ok(r.job);
  assert.equal(r.job.status, 3);
  assert.equal(typeof r.job.paramStr, 'string');

  const claimed = await repo.claim({ topic: 'scheduler.jobs', partitionId: r.job.partitionId, machineId: 'm', hostport: 'w', now: 2 });
  assert.equal(claimed, null);

  const list = await svc.listJobs({ groupName: 'ai-site' });
  assert.equal(list.length, 1);
  assert.equal(list[0].jobId, 'ai_1');

  await svc.updateExternalJob('ai_1', { status: 1, runtime: 5, result: { logPath: 'a.log', error: null } });
  const got = await repo.getJob('ai_1');
  assert.equal(got.status, 1);
  assert.equal(got.runtime, 5);
  assert.equal(JSON.parse(got.result).logPath, 'a.log');

  const summary = await svc.summary();
  assert.equal(summary.success, 1);
  await driver.close();
});
