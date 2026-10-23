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
    parseParam: async (job) => JSON.parse(job.paramStr),
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
