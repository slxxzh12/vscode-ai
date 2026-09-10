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
function fakeRunner() {
  const calls = [];
  const pending = [];
  let running = 0;
  return {
    calls,
    run(args) { calls.push(args); running++; return new Promise((resolve) => pending.push(() => { running--; const res = { exitCode: 0, timedOut: false, durationMs: 1 }; args.onExit?.(res); resolve(res); })); },
    stop() { return true; },
    isRunning() { return true; },
    count() { return running; },
    finishAll() { while (pending.length) pending.shift()(); },
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
