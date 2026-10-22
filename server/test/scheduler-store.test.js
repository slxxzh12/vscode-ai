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
  assert.equal(validateTask(shellTask({ type: 'x' })).error, 'type must be shell|ai|script|workflow');
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
  fs.mkdirSync(cwd, { recursive: true });
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
  store.setRuntimeProvider((id) => ({ nextRunAt: 555, lastRun: store.listRuns({ taskId: id, limit: 1 })[0] || null }));
  const { task } = store.createTask(shellTask({ cwd }));
  store.addRun({ id: 'r1', taskId: task.id, status: 'success', startedAt: 1, exitCode: 0, durationMs: 2, logFile: 'x' });
  store.syncManifest(task.id);
  const m = JSON.parse(fs.readFileSync(path.join(cwd, 'void_manifest.json'), 'utf8'));
  assert.equal(m.runtime.nextRunAt, 555);
  assert.equal(m.runtime.lastRun.status, 'success');
});

test('validateTask 支持 workflow 类型', () => {
  const base = { name: 'w', type: 'workflow', schedule: { mode: 'interval', interval: { every: 1, unit: 'day' } } };
  assert.equal(validateTask(base).error, 'workflowId required');
  assert.equal(validateTask({ ...base, workflow: { workflowId: 'dev' } }).error, 'agentId required');
  assert.ok(validateTask({ ...base, workflow: { workflowId: 'dev', agentId: 'opencode' } }).ok);
});

test('createTask 保存 workflow 字段并可重新加载', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask({ name: 'wf', type: 'workflow', workflow: { workflowId: 'dev', agentId: 'opencode' },
    schedule: { mode: 'interval', interval: { every: 1, unit: 'day' } } });
  assert.deepEqual(task.workflow, { workflowId: 'dev', agentId: 'opencode' });
  assert.equal(task.command, undefined);
  assert.equal(new SchedulerStore({ dir }).getTask(task.id).workflow.workflowId, 'dev');
});

test('报告路径按 taskId/runId 归档', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  assert.equal(store.reportFileFor('t1', 'r1'), path.join('t1', 'r1', 'report.md'));
  assert.equal(store.reportFileFor('t1', 'r1', true), path.join('t1', 'r1', 'report', 'report.md'));
  assert.equal(store.contextFileFor('t1', 'r1'), path.join('t1', 'r1', 'run.json'));
  assert.equal(store.reportPath(store.reportFileFor('t1', 'r1')), path.join(store.dir, 'tasks', 't1', 'r1', 'report.md'));
});

test('summary 统计成功、失败、运行中', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  store.addRun({ id: 'r1', taskId: 't1', status: 'success' });
  store.addRun({ id: 'r2', taskId: 't1', status: 'failed' });
  store.addRun({ id: 'r3', taskId: 't1', status: 'timeout' });
  store.addRun({ id: 'r4', taskId: 't1', status: 'killed' });
  store.addRun({ id: 'r5', taskId: 't1', status: 'running' });
  store.addRun({ id: 'r6', taskId: 't1', status: 'paused' });
  assert.deepEqual(store.summary(), { total: 6, success: 1, failed: 3, running: 2 });
});

test('默认保留全部运行记录', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  for (let i = 0; i < 60; i += 1) store.addRun({ id: `r${i}`, taskId: 't1', status: 'success' });
  assert.equal(store.listRuns({ taskId: 't1' }).length, 60);
});

test('显式 runLimit 时连带删除报告目录', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir, runLimit: 1 });
  const { task } = store.createTask(shellTask());
  const reportFile = store.reportFileFor(task.id, 'r1');
  fs.mkdirSync(path.dirname(store.reportPath(reportFile)), { recursive: true });
  fs.writeFileSync(store.reportPath(reportFile), '# r1');
  store.addRun({ id: 'r1', taskId: task.id, status: 'success', reportFile });
  store.addRun({ id: 'r2', taskId: task.id, status: 'success' });
  assert.equal(store.listRuns({ taskId: task.id }).length, 1);
  assert.equal(fs.existsSync(path.dirname(store.reportPath(reportFile))), false);
});

test('deleteTask 连带删除报告目录', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask(shellTask());
  const reportFile = store.reportFileFor(task.id, 'r1');
  fs.mkdirSync(path.dirname(store.reportPath(reportFile)), { recursive: true });
  fs.writeFileSync(store.reportPath(reportFile), '# r1');
  store.addRun({ id: 'r1', taskId: task.id, status: 'success', reportFile });
  store.deleteTask(task.id);
  assert.equal(fs.existsSync(path.join(dir, 'tasks', task.id)), false);
});
