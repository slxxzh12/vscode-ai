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
  assert.equal(validateTask(shellTask({ type: 'x' })).error, 'type must be shell|ai');
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

test('filePath 记录为绝对路径', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const cwd = path.join(os.tmpdir(), 'sched-cwd');
  fs.mkdirSync(cwd, { recursive: true });
  const { task } = store.createTask({ name: 's', enabled: true, type: 'ai', cwd,
    ai: { source: 'file' }, filePath: 'sub/y.md',
    schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } } });
  assert.equal(task.filePath, path.resolve(cwd, 'sub/y.md'));
  const upd = store.updateTask(task.id, { filePath: 'z.md' });
  assert.equal(upd.task.filePath, path.resolve(cwd, 'z.md'));
});

test('deleteTask 连带删除日志与任务目录', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask(shellTask());
  const logFile = store.logFileFor(task.id, 'r_x');
  fs.mkdirSync(path.dirname(store.logPath(logFile)), { recursive: true });
  fs.writeFileSync(store.logPath(logFile), 'out');
  fs.mkdirSync(store.runDirFor(task.id, 'r_x'), { recursive: true });
  const r = store.deleteTask(task.id);
  assert.equal(store.listTasks().length, 0);
  assert.equal(r.task.id, task.id);
  assert.equal(fs.existsSync(store.logPath(logFile)), false);
  assert.equal(fs.existsSync(store.runDirFor(task.id, 'r_x')), false);
});

test('任务支持队列字段', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const r = store.createTask(shellTask({
    approvalRequired: true, onlyLocal: true, uniqueKey: 'u1', weight: 5, maxRunMilliSecond: 1234, groupName: 'g1',
  }));
  assert.equal(r.task.approvalRequired, true);
  assert.equal(r.task.onlyLocal, true);
  assert.equal(r.task.uniqueKey, 'u1');
  assert.equal(r.task.weight, 5);
  assert.equal(r.task.maxRunMilliSecond, 1234);
  assert.equal(r.task.groupName, 'g1');
});

test('不再写 runs.json', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  store.createTask(shellTask());
  assert.equal(fs.existsSync(path.join(dir, 'runs.json')), false);
});

test('createTask/updateTask/deleteTask 同步 void_manifest.json', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const cwd = tmpDir();
  const { task } = store.createTask(shellTask({ cwd }));
  const mf = path.join(cwd, 'void_manifest.json');
  assert.ok(fs.existsSync(mf));
  assert.equal(JSON.parse(fs.readFileSync(mf, 'utf8')).command, 'echo hi');

  store.updateTask(task.id, { name: 'b' });
  assert.equal(JSON.parse(fs.readFileSync(mf, 'utf8')).name, 'b');

  store.deleteTask(task.id);
  assert.equal(fs.existsSync(mf), false);
});

test('无 cwd 的任务清单落到 manifests/<id>，删除时整目录清掉', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask(shellTask());
  const mf = path.join(dir, 'manifests', task.id, 'void_manifest.json');
  assert.ok(fs.existsSync(mf));
  store.deleteTask(task.id);
  assert.equal(fs.existsSync(path.dirname(mf)), false);
});

test('cwd 不存在返回 cwd-missing 且不落库', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const r = store.createTask(shellTask({ cwd: path.join(os.tmpdir(), 'nope-' + Date.now()) }));
  assert.equal(r.error, 'cwd-missing');
  assert.equal(store.listTasks().length, 0);
});

test('同目录第二个任务返回 dir-taken', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const cwd = tmpDir();
  assert.ok(store.createTask(shellTask({ cwd })).task);
  assert.equal(store.createTask(shellTask({ cwd, name: 'b' })).error, 'dir-taken');
});

test('改 cwd 时旧目录清单删除、新目录写入', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const a = tmpDir();
  const b = tmpDir();
  const { task } = store.createTask(shellTask({ cwd: a }));
  store.updateTask(task.id, { cwd: b });
  assert.equal(fs.existsSync(path.join(a, 'void_manifest.json')), false);
  assert.ok(fs.existsSync(path.join(b, 'void_manifest.json')));
});

test('syncManifest 写入 runtime（nextRunAt / lastRun）', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const cwd = tmpDir();
  store.setRuntimeProvider(() => ({ nextRunAt: 555, lastRun: { id: 'r1', status: 'success', startedAt: 1, exitCode: 0, durationMs: 2, logFile: 'x' } }));
  const { task } = store.createTask(shellTask({ cwd }));
  store.syncManifest(task.id);
  const m = JSON.parse(fs.readFileSync(path.join(cwd, 'void_manifest.json'), 'utf8'));
  assert.equal(m.runtime.nextRunAt, 555);
  assert.equal(m.runtime.lastRun.status, 'success');
});

test('只允许 shell / ai，旧 script/workflow 任务启动时删除', () => {
  const dir = tmpDir();
  const schedule = { mode: 'interval', interval: { every: 1, unit: 'day' } };
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify([
    { id: 't_keep', name: 'keep', type: 'shell', command: 'echo', schedule },
    { id: 't_script', name: 'old', type: 'script', script: { path: 'x.py' }, schedule },
    { id: 't_wf', name: 'old', type: 'workflow', workflow: { workflowId: 'dev', agentId: 'opencode' }, schedule },
  ]));
  const store = new SchedulerStore({ dir });
  assert.deepEqual(store.listTasks().map((t) => t.id), ['t_keep']);
  assert.deepEqual(store.removedTaskIds, ['t_script', 't_wf']);
  assert.equal(validateTask({ name: 'w', type: 'workflow', schedule }).error, 'type must be shell|ai');
  assert.equal(validateTask({ name: 's', type: 'script', schedule }).error, 'type must be shell|ai');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).map((t) => t.id), ['t_keep']);
});

test('报告路径按 taskId/runId 归档', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  assert.equal(store.reportFileFor('t1', 'r1'), path.join('t1', 'r1', 'report.md'));
  assert.equal(store.contextFileFor('t1', 'r1'), path.join('t1', 'r1', 'run.json'));
  assert.equal(store.reportPath(store.reportFileFor('t1', 'r1')), path.join(store.dir, 'tasks', 't1', 'r1', 'report.md'));
});

test('deleteTask 连带删除报告目录', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask(shellTask());
  const reportFile = store.reportFileFor(task.id, 'r1');
  fs.mkdirSync(path.dirname(store.reportPath(reportFile)), { recursive: true });
  fs.writeFileSync(store.reportPath(reportFile), '# r1');
  store.deleteTask(task.id);
  assert.equal(fs.existsSync(path.join(dir, 'tasks', task.id)), false);
});

test('AI 提示词变化时回调新记录，未变化不回调；删除任务回调清理', () => {
  const calls = [];
  const deletes = [];
  const dir = tmpDir();
  const store = new SchedulerStore({
    dir,
    onPromptChange: (task, prompt, meta) => calls.push({ taskId: task.id, prompt, meta }),
    onPromptDelete: (taskId) => deletes.push(taskId),
  });
  const schedule = { mode: 'interval', interval: { every: 1, unit: 'day' } };
  const { task } = store.createTask({
    name: 'ai', type: 'ai', ai: { source: 'prompt', prompt: 'hello' }, schedule,
  }, { createIP: '1.2.3.4', employeeId: 'E1' });
  assert.deepEqual(calls, [{ taskId: task.id, prompt: 'hello', meta: { createIP: '1.2.3.4', employeeId: 'E1' } }]);

  store.updateTask(task.id, { name: 'renamed' });
  assert.equal(calls.length, 1);
  assert.match(store.promptHashOf(task), /^[0-9a-f]{64}$/);

  store.updateTask(task.id, { ai: { source: 'prompt', prompt: 'changed' } }, { createIP: '5.6.7.8', employeeId: 'E2' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].prompt, 'changed');

  store.updateTask(task.id, { ai: { source: 'prompt', prompt: 'changed' } });
  assert.equal(calls.length, 2);

  store.deleteTask(task.id);
  assert.deepEqual(deletes, [task.id]);
});
