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
