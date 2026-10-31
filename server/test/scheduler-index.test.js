import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScheduler } from '../scheduler/index.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-idx-')); }

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
  assert.equal(typeof s.start, 'function');
  await s.start({ startWorkers: false });
  assert.equal(await s.queue.partitionCount(), 16);
  await s.stop();
});

test('创建/修改 AI 提示词写入 t_sched_prompt，可按 sha256 查回', async () => {
  const dir = tmpDir();
  const s = createScheduler({
    dir, manifestRoot: path.join(dir, 'manifests'),
    machineId: 'm1', hostport: 'h:1', role: 'master', version: 'v',
    dbFile: path.join(dir, 'void.db'),
    defaultOperator: { createIP: '127.0.0.1', employeeId: 'E0' },
  });
  await s.start({ startWorkers: false });
  const schedule = { mode: 'interval', interval: { every: 1, unit: 'day' } };
  const { task } = s.store.createTask({
    name: 'ai', type: 'ai', ai: { source: 'prompt', prompt: 'v1' }, schedule,
  }, { createIP: '10.0.0.1', employeeId: 'E1' });
  const waitFor = async (fn) => {
    for (let i = 0; i < 50; i += 1) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 20));
    }
    return null;
  };
  const first = await waitFor(async () => (await s.queue.listPrompts(task.id))[0]);
  assert.equal(first.prompt, 'v1');
  assert.equal(first.createIP, '10.0.0.1');
  assert.equal(first.employeeId, 'E1');
  assert.equal(s.store.promptHashOf(task), first.hash);

  s.store.updateTask(task.id, { ai: { source: 'prompt', prompt: 'v2' } }, { createIP: '10.0.0.2', employeeId: 'E2' });
  const latest = await waitFor(async () => {
    const list = await s.queue.listPrompts(task.id);
    return list.find((x) => x.prompt === 'v2');
  });
  assert.ok(latest);
  assert.equal((await s.queue.listPrompts(task.id)).length, 2);
  assert.equal((await s.queue.getPromptByHash(task.id, first.hash)).id, first.id);
  await s.stop();
});
