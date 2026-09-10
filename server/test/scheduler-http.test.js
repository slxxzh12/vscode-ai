import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { SchedulerStore } from '../scheduler/store.js';
import { createEngine } from '../scheduler/engine.js';
import { createSchedulerMount } from '../scheduler/http-mount.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-http-')); }

function fakeRunner() {
  const calls = [];
  const pending = [];
  return {
    calls,
    run(args) { calls.push(args); return new Promise((resolve) => pending.push(() => { const res = { exitCode: 0, timedOut: false, durationMs: 1 }; args.onExit?.(res); resolve(res); })); },
    stop() { return true; }, isRunning() { return false; }, count() { return 0; }, finishAll() { while (pending.length) pending.shift()(); },
  };
}

function call(mount, method, urlStr, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = urlStr;
  req.destroy = () => {};
  const res = { status: 0, headers: null, body: '' };
  const p = new Promise((resolve) => {
    res.writeHead = (s, h) => { res.status = s; res.headers = h; };
    res.end = (s) => { res.body = s || ''; resolve(res); };
  });
  const callP = mount(req, res);
  if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
  req.emit('end');
  return Promise.resolve(callP).then(() => p);
}

function setup(runner = fakeRunner()) {
  const store = new SchedulerStore({ dir: tmpDir() });
  const engine = createEngine({ store, runner, now: () => 1000 });
  const mount = createSchedulerMount({ engine, store });
  return { store, engine, runner, mount };
}

test('POST 创建 / GET 列表 / PUT 更新 / DELETE', async () => {
  const { mount } = setup();
  const create = await call(mount, 'POST', '/api/scheduler/tasks', {
    name: 'a', type: 'shell', command: 'echo', schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  });
  assert.equal(create.status, 200);
  const task = JSON.parse(create.body).task;
  assert.ok(task.id);

  const list = await call(mount, 'GET', '/api/scheduler/tasks');
  assert.equal(JSON.parse(list.body).tasks.length, 1);

  const upd = await call(mount, 'PUT', `/api/scheduler/tasks/${task.id}`, { name: 'b' });
  assert.equal(JSON.parse(upd.body).task.name, 'b');

  const del = await call(mount, 'DELETE', `/api/scheduler/tasks/${task.id}`);
  assert.equal(JSON.parse(del.body).ok, true);
  assert.equal(JSON.parse((await call(mount, 'GET', '/api/scheduler/tasks')).body).tasks.length, 0);
});

test('创建非法任务返回 400', async () => {
  const { mount } = setup();
  const res = await call(mount, 'POST', '/api/scheduler/tasks', { name: 'a' });
  assert.equal(res.status, 400);
});

test('立即运行 / 列表 / 停止', async () => {
  const { mount } = setup();
  const created = await call(mount, 'POST', '/api/scheduler/tasks', {
    name: 'a', type: 'shell', command: 'echo', schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  });
  const id = JSON.parse(created.body).task.id;
  const run = await call(mount, 'POST', `/api/scheduler/tasks/${id}/run`);
  assert.equal(run.status, 200);
  assert.ok(JSON.parse(run.body).run.id);
  const runs = await call(mount, 'GET', `/api/scheduler/runs?taskId=${id}`);
  assert.equal(JSON.parse(runs.body).runs.length, 1);
  const stop = await call(mount, 'POST', `/api/scheduler/tasks/${id}/stop`);
  assert.equal(JSON.parse(stop.body).ok, true);
});

test('运行日志端点返回文本', async () => {
  const { mount, store } = setup();
  store.addRun({ id: 'r1', taskId: 't1', status: 'success', logFile: 't1/r1.log' });
  const p = store.logPath('t1/r1.log');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'hello-log');
  const res = await call(mount, 'GET', '/api/scheduler/runs/r1/log');
  assert.equal(res.body, 'hello-log');
});

test('未知路由 404', async () => {
  const { mount } = setup();
  const res = await call(mount, 'GET', '/api/scheduler/nope');
  assert.equal(res.status, 404);
});
