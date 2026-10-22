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

function setup(runner = fakeRunner(), pickFolder = undefined) {
  const store = new SchedulerStore({ dir: tmpDir() });
  const engine = createEngine({ store, runner, now: () => 1000 });
  const mount = createSchedulerMount({ engine, store, pickFolder });
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

test('POST /pick-folder 返回所选目录', async () => {
  const { mount } = setup(fakeRunner(), async () => ({ path: 'C:/some/dir' }));
  const res = await call(mount, 'POST', '/api/scheduler/pick-folder');
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).path, 'C:/some/dir');
});

test('POST /pick-folder 取消与不支持', async () => {
  const cancelled = setup(fakeRunner(), async () => ({ cancelled: true }));
  assert.equal(JSON.parse((await call(cancelled.mount, 'POST', '/api/scheduler/pick-folder')).body).cancelled, true);
  const unsupported = setup(fakeRunner(), async () => ({ error: 'unsupported' }));
  assert.equal(JSON.parse((await call(unsupported.mount, 'POST', '/api/scheduler/pick-folder')).body).error, 'unsupported');
});

test('POST /import 扫描目录导入并汇总', async () => {
  const { mount, store } = setup();
  const root = tmpDir();
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'void_manifest.json'), JSON.stringify({
    format: 'void_manifest', version: 1, name: 'i', type: 'shell', enabled: true,
    command: 'echo', schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  }));
  const res = await call(mount, 'POST', '/api/scheduler/import', { dir: root });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).imported, 1);
  assert.equal(store.listTasks().length, 1);
});

test('POST /import 非法目录返回 400', async () => {
  const { mount } = setup();
  assert.equal((await call(mount, 'POST', '/api/scheduler/import', { dir: '' })).status, 400);
  assert.equal((await call(mount, 'POST', '/api/scheduler/import', { dir: path.join(tmpDir(), 'nope') })).status, 400);
});

test('GET /summary 返回成功/失败/运行中总数', async () => {
  const { mount, store } = setup();
  store.addRun({ id: 'r1', taskId: 't1', status: 'success' });
  store.addRun({ id: 'r2', taskId: 't1', status: 'failed' });
  store.addRun({ id: 'r3', taskId: 't1', status: 'timeout' });
  store.addRun({ id: 'r4', taskId: 't1', status: 'running' });
  const res = await call(mount, 'GET', '/api/scheduler/summary');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { total: 4, success: 1, failed: 2, running: 1 });
});

test('GET /runs/:id/report 返回 Markdown', async () => {
  const { mount, store } = setup();
  const reportFile = store.reportFileFor('t1', 'r1');
  fs.mkdirSync(path.dirname(store.reportPath(reportFile)), { recursive: true });
  fs.writeFileSync(store.reportPath(reportFile), '# 报告\n\nok');
  store.addRun({ id: 'r1', taskId: 't1', status: 'success', reportFile });
  const res = await call(mount, 'GET', '/api/scheduler/runs/r1/report');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.equal(res.body, '# 报告\n\nok');
});

test('GET /runs/:id/report 对旧记录即时兜底', async () => {
  const { mount, store } = setup();
  store.addRun({ id: 'r2', taskId: 't1', status: 'failed', error: 'x' });
  const res = await call(mount, 'GET', '/api/scheduler/runs/r2/report');
  assert.equal(res.status, 200);
  assert.match(res.body, /# t1/);
  assert.match(res.body, /失败/);
});

test('GET /runs 不传 limit 返回全部', async () => {
  const { mount, store } = setup();
  for (let i = 0; i < 60; i += 1) store.addRun({ id: `r${i}`, taskId: 't1', status: 'success' });
  const res = await call(mount, 'GET', '/api/scheduler/runs?taskId=t1');
  assert.equal(JSON.parse(res.body).runs.length, 60);
});
