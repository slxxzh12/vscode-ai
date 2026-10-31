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
