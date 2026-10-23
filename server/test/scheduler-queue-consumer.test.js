import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SchedulerStore } from '../scheduler/store.js';
import { createConsumer } from '../scheduler/queue/consumer.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qcons-')); }

test('普通命令：输出作为 prompt 再执行 AI，并写回成功与报告', async () => {
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
  const specs = [];
  const runner = {
    run: async ({ spec, onData }) => {
      specs.push(spec);
      if (specs.length === 2) {
        onData?.('{"type":"error","sessionID":"ses_test_1"}\n');
        onData?.('{"type":"text","sessionID":"ses_test_1","part":{"text":"# 结果"}}\n');
      }
      return specs.length === 1
        ? { exitCode: 0, timedOut: false, durationMs: 3, stdout: 'collected output' }
        : { exitCode: 0, timedOut: false, durationMs: 4, stdout: 'ai done' };
    },
    stop: () => true,
  };
  const c = createConsumer({
    queue, store, runner, worker: { id: 'm1:scheduler.jobs', hostport: 'w:1', machineId: 'm1' },
    aiPromptLoader: () => '', now: () => 1000, pollMs: 999999,
  });
  await c.runOnce(0);
  assert.equal(specs.length, 2);
  const fi = specs[1].args.indexOf('--file');
  assert.ok(fi > 0);
  const promptPath = specs[1].args[fi + 1];
  assert.match(fs.readFileSync(promptPath, 'utf8'), /collected output/);
  assert.equal(completed.status, 1);
  assert.equal(completed.result.shellExitCode, 0);
  assert.equal(completed.result.aiExitCode, 0);
  assert.equal(completed.result.ngaSessionId, 'ses_test_1');
  assert.ok(completed.result.reportMarkdown.includes('结果'));
  const resultJson = JSON.parse(fs.readFileSync(store.reportPath(path.join(task.id, 'j1', 'result.json')), 'utf8'));
  assert.equal(resultJson.status, 1);
  assert.equal(resultJson.statusText, 'success');
  assert.equal(resultJson.ngaSessionId, 'ses_test_1');
});

test('AI 命令通过回调回写最终状态与结果', async () => {
  const dir = tmp();
  const store = new SchedulerStore({ dir });
  const task = store.createTask({
    name: 'ai', type: 'ai', ai: { source: 'prompt', prompt: 'do it' }, schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } },
  }).task;
  const snap = { task, trigger: 'manual', scheduledAt: 1, createMachineId: 'm1' };
  let callbackStatus = null;
  let callbackResult = null;
  let completed = null;
  const queue = {
    claim: async () => ({ jobId: 'j2', partitionId: 0, paramStr: JSON.stringify(snap), maxRunMilliSecond: 1000 }),
    parseParam: async (job) => JSON.parse(job.paramStr),
    complete: async (id, r) => { completed = { id, ...r }; },
    listJobs: async () => [],
    getJob: async () => ({ jobId: 'j2', status: callbackStatus ?? 3, result: callbackResult }),
    applyCallback: async (_id, patch) => { callbackStatus = patch.status ?? callbackStatus; callbackResult = patch.result ?? callbackResult; return { ok: true }; },
  };
  let consumer = null;
  const runner = {
    run: async ({ spec }) => {
      const fi = spec.args.indexOf('--file');
      assert.ok(fi > 0);
      assert.match(fs.readFileSync(spec.args[fi + 1], 'utf8'), /do it/);
      await consumer.handleCallback('j2', spec.env.DEVFLOW_JOB_TOKEN, { status: 'success', result: { reportMarkdown: '# ai report' } });
      return { exitCode: 0, timedOut: false, durationMs: 4, stdout: '' };
    },
    stop: () => true,
  };
  consumer = createConsumer({
    queue, store, runner, worker: { id: 'm1:scheduler.jobs', hostport: 'w:1', machineId: 'm1' },
    aiPromptLoader: () => '', now: () => 1000, pollMs: 999999,
  });
  await consumer.runOnce(0);
  assert.equal(callbackStatus, 1);
  assert.ok(callbackResult.includes('ai report'));
  assert.equal(completed, null);
});
