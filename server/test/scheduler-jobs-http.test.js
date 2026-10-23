import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createJobsMount } from '../scheduler/jobs-mount.js';

function call(mount, method, url, body) {
  const req = new EventEmitter();
  req.method = method; req.url = url; req.destroy = () => {};
  const res = { status: 0, body: '' };
  const p = new Promise((r) => { res.writeHead = (s) => { res.status = s; }; res.end = (s) => { res.body = s || ''; r(res); }; });
  const ret = mount(req, res);
  if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
  req.emit('end');
  return Promise.resolve(ret).then(() => p);
}

function setup(role = 'master') {
  const q = {
    listJobs: async () => [{ jobId: 'j1', status: 0 }],
    summary: async () => ({ queued: 1, running: 0, pending: 0, success: 0, failed: 0, total: 1 }),
    partitionStats: async () => [{ id: 0, queued: 1, running: 0, pending: 0 }],
    partitionCount: async () => 16,
    getJob: async (id) => ({ jobId: id, status: 4 }),
    approve: async () => ({ ok: true }),
    reject: async () => ({ ok: true }),
    cancel: async () => ({ ok: true }),
    retry: async () => ({ job: { jobId: 'j2' } }),
    cleanupFinished: async () => 1,
    setPartitionCount: async (n) => ({ ok: true, count: n }),
    config: { publicConfig: () => ({ backend: 'sqlite', hasPassword: false }), save: () => ({ ok: true }) },
  };
  return { mount: createJobsMount({ queue: q, role, logger: console }), q };
}

test('GET /api/scheduler/jobs 返回作业与统计', async () => {
  const { mount } = setup();
  const r = await call(mount, 'GET', '/api/scheduler/jobs?status=0&partition=0');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).jobs.length, 1);
});

test('slave 不能审批', async () => {
  const { mount } = setup('slave');
  const r = await call(mount, 'POST', '/api/scheduler/jobs/j1/approve');
  assert.equal(r.status, 403);
});

test('master 审批与重试', async () => {
  const { mount } = setup();
  assert.equal((await call(mount, 'POST', '/api/scheduler/jobs/j1/approve')).status, 200);
  assert.equal((await call(mount, 'POST', '/api/scheduler/jobs/j1/retry')).status, 200);
});

test('AI 回调：令牌正确返回 200，错误令牌返回 403', async () => {
  const seen = [];
  const mount = createJobsMount({
    queue: setup().q,
    role: 'slave',
    logger: console,
    onCallback: async (id, token, body) => {
      seen.push({ id, token, body });
      return token === 'good' ? { ok: true } : { error: 'bad-token' };
    },
  });
  assert.equal((await call(mount, 'POST', '/api/scheduler/jobs/j2/callback', { token: 'good', status: 1 })).status, 200);
  assert.equal((await call(mount, 'POST', '/api/scheduler/jobs/j2/callback', { token: 'bad', status: 1 })).status, 403);
  assert.equal(seen.length, 2);
});
