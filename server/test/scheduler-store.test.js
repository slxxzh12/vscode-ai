import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SchedulerStore, validateTask } from '../scheduler/store.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-store-')); }
function shellTask(over = {}) {
  return { name: 'a', enabled: true, type: 'shell', command: 'echo hi',
    schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } }, ...over };
}

test('validateTask 校验各字段', () => {
  assert.ok(validateTask(shellTask()).ok);
  assert.equal(validateTask({}).error, 'name required');
  assert.equal(validateTask(shellTask({ type: 'x' })).error, 'type must be shell|ai|script');
  assert.equal(validateTask(shellTask({ type: 'ai', ai: { source: 'command' } })).error, 'ai.commandName required');
  assert.equal(validateTask(shellTask({ schedule: { mode: 'daily', daily: { at: 'x' } } })).error, 'daily.at must be HH:MM');
  assert.equal(validateTask(shellTask({ schedule: { mode: 'interval', interval: { every: 0, unit: 'minute' } } })).error, 'interval.every must be > 0');
  assert.ok(validateTask(shellTask({ type: 'ai', ai: { source: 'file' }, filePath: 'C:/x/run.md' })).ok);
  assert.equal(validateTask(shellTask({ type: 'ai', ai: { source: 'file' } })).error, 'ai.filePath required');
});

test('createTask 生成 id 并持久化', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask(shellTask());
  assert.match(task.id, /^t_/);
  const store2 = new SchedulerStore({ dir });
  assert.equal(store2.listTasks().length, 1);
  assert.equal(store2.getTask(task.id).command, 'echo hi');
});

test('updateTask 合并并刷新 updatedAt；未知 id 返回 not-found', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const { task } = store.createTask(shellTask());
  const r = store.updateTask(task.id, { name: 'b', enabled: false });
  assert.equal(r.task.name, 'b');
  assert.equal(r.task.enabled, false);
  assert.equal(store.updateTask('nope', {}).error, 'not-found');
});

test('filePath / script.path 记录为绝对路径', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const cwd = path.join(os.tmpdir(), 'sched-cwd');
  const { task } = store.createTask({ name: 's', enabled: true, type: 'script', cwd,
    filePath: 'sub/y.py', script: { path: 'sub/y.py' },
    schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } } });
  assert.equal(task.filePath, path.resolve(cwd, 'sub/y.py'));
  assert.equal(task.script.path, path.resolve(cwd, 'sub/y.py'));
  const upd = store.updateTask(task.id, { filePath: 'z.py' });
  assert.equal(upd.task.filePath, path.resolve(cwd, 'z.py'));
});

test('deleteTask 连带删除运行记录与日志文件', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask(shellTask());
  const logFile = store.logFileFor(task.id, 'r_x');
  fs.mkdirSync(path.dirname(store.logPath(logFile)), { recursive: true });
  fs.writeFileSync(store.logPath(logFile), 'out');
  store.addRun({ id: 'r_x', taskId: task.id, status: 'success', logFile });
  store.deleteTask(task.id);
  assert.equal(store.listTasks().length, 0);
  assert.equal(store.getRun('r_x'), null);
  assert.equal(fs.existsSync(store.logPath(logFile)), false);
});

test('addRun 超过 runLimit 淘汰最旧并删除日志', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir, runLimit: 2 });
  const { task } = store.createTask(shellTask());
  for (const id of ['r1', 'r2', 'r3']) {
    const logFile = store.logFileFor(task.id, id);
    fs.mkdirSync(path.dirname(store.logPath(logFile)), { recursive: true });
    fs.writeFileSync(store.logPath(logFile), id);
    store.addRun({ id, taskId: task.id, status: 'success', logFile });
  }
  assert.deepEqual(store.listRuns({ taskId: task.id }).map((r) => r.id), ['r3', 'r2']);
  assert.equal(fs.existsSync(store.logPath(store.logFileFor(task.id, 'r1'))), false);
});

test('updateRun 修改并持久化', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  store.addRun({ id: 'r1', taskId: 't1', status: 'running' });
  const r = store.updateRun('r1', { status: 'success', exitCode: 0 });
  assert.equal(r.status, 'success');
  assert.equal(new SchedulerStore({ dir: store.dir }).getRun('r1').exitCode, 0);
});
