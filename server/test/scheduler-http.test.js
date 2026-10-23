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

function fakeQueue() {
  const jobs = [];
  let seq = 0;
  return {
    jobs,
    async enqueueTask(task, opts = {}) {
      const job = { jobId: `j${++seq}`, taskId: task.id, status: 0, trigger: opts.trigger || 'schedule' };
      jobs.unshift(job);
      return { job };
    },
    async listJobs({ taskIds = null } = {}) {
      return taskIds ? jobs.filter((j) => taskIds.includes(j.taskId)) : jobs.slice();
    },
    async summary() {
      const out = { queued: 0, running: 0, pending: 0, success: 0, failed: 0, total: jobs.length };
      for (const j of jobs) {
        if (j.status === 0) out.queued += 1;
        else if (j.status === 1) out.success += 1;
        else if (j.status === 2) out.failed += 1;
        else if (j.status === 3) out.running += 1;
        else if (j.status === 4) out.pending += 1;
      }
      return out;
    },
    async deleteTaskJobs(taskId) {
      for (const j of jobs) if (j.taskId === taskId) j.status = 2;
      return { running: [] };
    },
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

function setup(pickFolder = undefined) {
  const store = new SchedulerStore({ dir: tmpDir() });
  const queue = fakeQueue();
  const engine = createEngine({ store, queue, now: () => 1000 });
  const mount = createSchedulerMount({ engine, store, queue, pickFolder });
  return { store, engine, queue, mount };
}

test('POST 创建 / GET 列表 / PUT 更新 / DELETE', async () => {
  const { mount, queue, store } = setup();
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

  await queue.enqueueTask(store.getTask(task.id), { trigger: 'manual' });
  const del = await call(mount, 'DELETE', `/api/scheduler/tasks/${task.id}`);
  assert.equal(JSON.parse(del.body).ok, true);
  assert.equal(queue.jobs[0].status, 2);
  assert.equal(JSON.parse((await call(mount, 'GET', '/api/scheduler/tasks')).body).tasks.length, 0);
});

test('创建非法任务返回 400', async () => {
  const { mount } = setup();
  const res = await call(mount, 'POST', '/api/scheduler/tasks', { name: 'a' });
  assert.equal(res.status, 400);
});

test('立即运行返回 job / 列表 / 停止', async () => {
  const { mount, queue } = setup();
  const created = await call(mount, 'POST', '/api/scheduler/tasks', {
    name: 'a', type: 'shell', command: 'echo', schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  });
  const id = JSON.parse(created.body).task.id;
  const run = await call(mount, 'POST', `/api/scheduler/tasks/${id}/run`);
  assert.equal(run.status, 200);
  assert.ok(JSON.parse(run.body).job.jobId);
  assert.equal((await queue.listJobs({ taskIds: [id] })).length, 1);
  const stop = await call(mount, 'POST', `/api/scheduler/tasks/${id}/stop`);
  assert.equal(JSON.parse(stop.body).ok, false);
});

test('未知路由 404', async () => {
  const { mount } = setup();
  const res = await call(mount, 'GET', '/api/scheduler/nope');
  assert.equal(res.status, 404);
});

test('POST /pick-folder 返回所选目录', async () => {
  const { mount } = setup(async () => ({ path: 'C:/some/dir' }));
  const res = await call(mount, 'POST', '/api/scheduler/pick-folder');
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).path, 'C:/some/dir');
});

test('POST /pick-folder 取消与不支持', async () => {
  const cancelled = setup(async () => ({ cancelled: true }));
  assert.equal(JSON.parse((await call(cancelled.mount, 'POST', '/api/scheduler/pick-folder')).body).cancelled, true);
  const unsupported = setup(async () => ({ error: 'unsupported' }));
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

test('GET /summary 来自队列', async () => {
  const { mount, queue } = setup();
  queue.jobs.push(
    { jobId: 'j1', taskId: 't1', status: 1 },
    { jobId: 'j2', taskId: 't1', status: 2 },
    { jobId: 'j3', taskId: 't1', status: 2 },
    { jobId: 'j4', taskId: 't1', status: 3 },
  );
  const res = await call(mount, 'GET', '/api/scheduler/summary');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { total: 4, success: 1, failed: 2, running: 1, queued: 0, pending: 0 });
});

test('导出全部任务并重新导入', async () => {
  const { mount, store } = setup();
  const create = await call(mount, 'POST', '/api/scheduler/tasks', {
    name: 'a', type: 'shell', command: 'echo', schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  });
  const id = JSON.parse(create.body).task.id;
  const exp = await call(mount, 'GET', '/api/scheduler/tasks/export');
  const body = JSON.parse(exp.body);
  assert.equal(body.format, 'devflow_scheduler_tasks');
  assert.equal(body.tasks.length, 1);
  store.deleteTask(id);
  const imp = await call(mount, 'POST', '/api/scheduler/tasks/import-all', { tasks: body.tasks });
  assert.equal(imp.status, 200);
  assert.equal(JSON.parse(imp.body).imported, 1);
  assert.equal(store.listTasks().length, 1);
});
