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
  const t = 100;
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
