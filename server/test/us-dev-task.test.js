import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAiViaTask } from '../pipeline/us-dev.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-us-task-'));
}

function fakeScheduler({ status = 1, activeJobs = [] } = {}) {
  const tasks = new Map();
  const enqueued = [];
  const store = {
    getTask: (id) => tasks.get(id) || null,
    ensureTask: (id, input) => { const task = { id, ...input }; tasks.set(id, task); return { task, created: true }; },
    updateTask: (id, input) => { const task = { ...(tasks.get(id) || { id }), ...input, id }; tasks.set(id, task); return { task }; },
    logPath: (file) => file,
    logFileFor: () => 'no-such-task-log.log',
  };
  const queue = {
    topic: 'scheduler.jobs',
    partitionCount: async () => 16,
    listJobs: async () => activeJobs,
    enqueueTask: async (task) => { enqueued.push(task); return { job: { jobId: 'j_test' } }; },
    getJob: async () => ({ status }),
  };
  return { scheduler: { store, queue }, tasks, enqueued };
}

test('us-dev：代码生成改为创建并运行 AI 任务，完成后返回成功', async () => {
  const { scheduler, tasks, enqueued } = fakeScheduler({ status: 1 });
  const cwd = tmpRoot();
  const r = await runAiViaTask({
    scheduler, machineId: 'm1', us: 'US000002-2022-B',
    cwd, prompt: 'implement it', timeoutMs: 3000, logPath: path.join(cwd, 'ai.log'),
    resumeSessionId: 'ses_resume',
  });
  assert.equal(r.ok, true);
  assert.equal(tasks.size, 1);
  assert.equal(enqueued.length, 1);
  const task = enqueued[0];
  assert.equal(task.type, 'ai');
  assert.equal(task.runCwd, cwd);
  assert.equal(task.cwd ?? null, null);
  assert.equal(task.onlyLocal, true);
  assert.equal(task.ai.source, 'prompt');
  assert.equal(task.ai.prompt, 'implement it');
  assert.equal(task.ai.sessionId, 'ses_resume');
  assert.match(task.name, /US000002-2022-B/);
});

test('us-dev：AI 任务失败时返回失败', async () => {
  const { scheduler } = fakeScheduler({ status: 2 });
  const cwd = tmpRoot();
  const r = await runAiViaTask({
    scheduler, machineId: 'm1', us: 'US000003-2022-C',
    cwd, prompt: 'x', timeoutMs: 3000, logPath: path.join(cwd, 'ai.log'),
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ai-failed');
});

test('us-dev：已有活跃 AI 作业时复用，不重复入队', async () => {
  const { scheduler, enqueued } = fakeScheduler({ status: 1, activeJobs: [{ jobId: 'j_active' }] });
  const cwd = tmpRoot();
  const r = await runAiViaTask({
    scheduler, machineId: 'm1', us: 'US000004-2024-D',
    cwd, prompt: 'x', timeoutMs: 3000, logPath: path.join(cwd, 'ai.log'),
  });
  assert.equal(r.ok, true);
  assert.equal(r.jobId, 'j_active');
  assert.equal(enqueued.length, 0);
});
