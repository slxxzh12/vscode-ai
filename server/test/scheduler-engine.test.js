import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SchedulerStore } from '../scheduler/store.js';
import { createEngine } from '../scheduler/engine.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-eng-')); }
function task(over = {}) {
  return { name: 'a', enabled: true, type: 'shell', command: 'echo hi',
    schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } }, ...over };
}
function fakeRunner(onSpawn) {
  const calls = [];
  const pending = [];
  let running = 0;
  return {
    calls,
    run(args) {
      calls.push(args);
      running += 1;
      onSpawn?.(args);
      return new Promise((resolve) => pending.push((code = 0) => {
        running -= 1;
        const res = { exitCode: code, timedOut: false, durationMs: 1 };
        args.onExit?.(res);
        resolve(res);
      }));
    },
    stop() { return true; },
    isRunning() { return true; },
    count() { return running; },
    finishAll(code = 0) { while (pending.length) pending.shift()(code); },
  };
}
const HOUR = 3600000;

test('到期触发一次并 emit run-start/run-end', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const events = [];
  const now = { v: 1000 };
  const engine = createEngine({ store, runner, now: () => now.v });
  engine.onEvent((e) => events.push(e));
  store.createTask(task());
  engine.refreshAll();
  now.v += HOUR;
  engine.tick();
  assert.equal(runner.calls.length, 1);
  runner.finishAll();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(events, ['run-start', 'run-end']);
});

test('禁用任务不触发', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const now = { v: 1000 };
  const engine = createEngine({ store, runner, now: () => now.v });
  store.createTask(task({ enabled: false }));
  engine.refreshAll();
  now.v += HOUR * 2;
  engine.tick();
  assert.equal(runner.calls.length, 0);
});

test('无论启用与否都算出下次运行时间', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const engine = createEngine({ store, runner: fakeRunner(), now: () => 1000 });
  const { task: a } = store.createTask(task());
  const { task: b } = store.createTask(task({ enabled: false }));
  engine.refreshAll();
  assert.equal(engine.nextRunAtOf(a.id), 1000 + HOUR);
  assert.equal(engine.nextRunAtOf(b.id), 1000 + HOUR, '禁用任务也应有下次运行时间');
});

test('运行中不重叠（跳过本次）', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const now = { v: 1000 };
  const engine = createEngine({ store, runner, now: () => now.v });
  store.createTask(task());
  engine.refreshAll();
  now.v += HOUR; engine.tick();
  now.v += HOUR; engine.tick();
  assert.equal(runner.calls.length, 1);
});

test('并发上限：到上限时跳过', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const now = { v: 1000 };
  const engine = createEngine({ store, runner, now: () => now.v, maxConcurrent: 1 });
  store.createTask(task({ name: 'a' }));
  store.createTask(task({ name: 'b' }));
  engine.refreshAll();
  now.v += HOUR; engine.tick();
  assert.equal(runner.calls.length, 1);
});

test('manualRun 立即执行；未知任务返回 not-found', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const engine = createEngine({ store, runner, now: () => 1000 });
  const { task: t } = store.createTask(task());
  const r = engine.manualRun(t.id);
  assert.equal(r.run.trigger, 'manual');
  assert.equal(engine.manualRun('nope').error, 'not-found');
});

test('command 来源任务：prompt loader 抛错不阻断运行', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const engine = createEngine({ store, runner, now: () => 1000 });
  engine.setAiPromptLoader(() => { throw new Error('ENOENT'); });
  const { task: t } = store.createTask(task({ name: 'cmd', type: 'ai', ai: { source: 'command', commandName: 'code-review' } }));
  const r = engine.manualRun(t.id);
  assert.ok(r.run && r.run.id, '应正常开始一次运行');
  assert.equal(runner.calls.length, 1);
  assert.deepEqual(runner.calls[0].spec.args, ['run', '--command', 'code-review']);
});

function wfTask(over = {}) {
  return { name: 'wf', enabled: true, type: 'workflow', workflow: { workflowId: 'dev', agentId: 'opencode' },
    schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } }, ...over };
}
function fakeExecutor() {
  const calls = [];
  const handles = new Map();
  return {
    calls, handles,
    start(args) {
      calls.push(args);
      let cb = args.onStatus;
      let aborted = false;
      const handle = {
        abort() { aborted = true; cb?.({ status: 'aborted' }); },
        get aborted() { return aborted; },
        emit: (s) => cb?.(s),
      };
      handles.set(args.runId, handle);
      return handle;
    },
  };
}

test('workflow 任务：触发时调用 executor 不 spawn 进程', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const executor = fakeExecutor();
  const events = [];
  const now = { v: 1000 };
  const engine = createEngine({ store, runner, workflowExecutor: executor, now: () => now.v });
  engine.onEvent((e) => events.push(e));
  store.createTask(wfTask());
  engine.refreshAll();
  now.v += HOUR;
  engine.tick();
  assert.equal(runner.calls.length, 0);
  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0].task.workflow.workflowId, 'dev');
  assert.equal(store.listRuns({ taskId: store.listTasks()[0].id }).length, 1);
  assert.deepEqual(events, ['run-start']);
});

test('workflow 任务：executor onStatus success → run success，可再次触发', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const executor = fakeExecutor();
  const now = { v: 1000 };
  const engine = createEngine({ store, runner: fakeRunner(), workflowExecutor: executor, now: () => now.v });
  const { task } = store.createTask(wfTask());
  engine.refreshAll();
  now.v += HOUR; engine.tick();
  const runId = executor.calls[0].runId;
  executor.handles.get(runId).emit({ status: 'success', sessionId: 'sess1' });
  const run = store.getRun(runId);
  assert.equal(run.status, 'success');
  assert.equal(run.sessionId, 'sess1');
  assert.equal(engine.isRunning(task.id), false);
});

test('workflow 任务：stop 调 executor.abort', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const executor = fakeExecutor();
  const now = { v: 1000 };
  const engine = createEngine({ store, runner: fakeRunner(), workflowExecutor: executor, now: () => now.v });
  const { task } = store.createTask(wfTask());
  engine.refreshAll();
  now.v += HOUR; engine.tick();
  const runId = executor.calls[0].runId;
  assert.equal(engine.stop(task.id), true);
  assert.equal(executor.handles.get(runId).aborted, true);
  assert.equal(store.getRun(runId).status, 'killed');
});

test('workflow 任务：未注入 executor → 立即 failed', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const engine = createEngine({ store, runner: fakeRunner(), now: () => 1000 });
  const { task } = store.createTask(wfTask());
  const r = engine.manualRun(task.id);
  assert.equal(r.run.status, 'failed');
  assert.equal(r.run.error, 'executor-unavailable');
});

test('运行前写 run.json 并注入 DEVFLOW_RUN_CONTEXT；成功后归档任务报告', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner((args) => {
    const ctx = JSON.parse(fs.readFileSync(args.spec.env.DEVFLOW_RUN_CONTEXT, 'utf8'));
    assert.equal(ctx.runId, args.runId);
    assert.equal(ctx.taskId, store.listTasks()[0].id);
    fs.writeFileSync(ctx.reportPath, '# 扫描报告\n\n全部通过');
  });
  const { task: t } = store.createTask(task());
  const engine = createEngine({ store, runner, now: () => 1000 });
  const r = engine.manualRun(t.id);
  runner.finishAll(0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const run = store.getRun(r.run.id);
  assert.equal(run.status, 'success');
  assert.equal(run.reportFile, store.reportFileFor(t.id, r.run.id));
  assert.match(fs.readFileSync(store.reportPath(run.reportFile), 'utf8'), /扫描报告/);
});

test('失败时生成兜底报告并去掉 ANSI', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner((args) => {
    fs.mkdirSync(path.dirname(args.logPath), { recursive: true });
    fs.writeFileSync(args.logPath, '\u001b[31mboom\u001b[0m');
  });
  const { task: t } = store.createTask(task());
  const engine = createEngine({ store, runner, now: () => 1000 });
  const r = engine.manualRun(t.id);
  runner.finishAll(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const run = store.getRun(r.run.id);
  assert.equal(run.status, 'failed');
  assert.ok(run.reportFile);
  const text = fs.readFileSync(store.reportPath(run.reportFile), 'utf8');
  assert.match(text, /失败/);
  assert.match(text, /boom/);
  assert.equal(text.includes('\u001b'), false);
});

test('workflow 任务拿到 runContextPath，结束后生成兜底报告', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const executor = fakeExecutor();
  const engine = createEngine({ store, runner: fakeRunner(), workflowExecutor: executor, now: () => 1000 });
  const { task } = store.createTask(wfTask());
  const r = engine.manualRun(task.id);
  assert.ok(executor.calls[0].runContextPath);
  const ctx = JSON.parse(fs.readFileSync(executor.calls[0].runContextPath, 'utf8'));
  assert.equal(ctx.runId, r.run.id);
  executor.handles.get(r.run.id).emit({ status: 'success', sessionId: 's1' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const run = store.getRun(r.run.id);
  assert.ok(run.reportFile);
  assert.match(fs.readFileSync(store.reportPath(run.reportFile), 'utf8'), /成功/);
});

test('executor 不可用时立即失败也有报告', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const engine = createEngine({ store, runner: fakeRunner(), now: () => 1000 });
  const { task } = store.createTask(wfTask());
  const r = engine.manualRun(task.id);
  const run = store.getRun(r.run.id);
  assert.equal(run.status, 'failed');
  assert.ok(run.reportFile);
  assert.ok(fs.existsSync(store.reportPath(run.reportFile)));
});
