import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { UsagePeersStore } from '../usage-peers.js';
import { createUsageReporter } from '../usage-report.js';
import { createUsageMount } from '../usage-mount.js';

function tmp(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-umount-')), name);
}

async function start({ token = 'good', peers, reporter, onReport, pullFromHub } = {}) {
  const p = peers || new UsagePeersStore({ file: tmp('usage-peers.json') });
  const r = reporter || createUsageReporter({
    file: tmp('usage-report.json'), identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 1 }), fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  });
  const mount = createUsageMount({ peers: p, reporter: r, checkToken: (tk) => tk === token, onReport, pullFromHub });
  const server = http.createServer((req, res) => mount(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  return { peers: p, reporter: r, port: server.address().port, server };
}

function call(port, method, p, { headers = {}, body } = {}) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

test('POST /api/usage/report：正确令牌 → 落库 + 触发 onReport', async (t) => {
  const seen = [];
  const A = await start({ onReport: (rec) => seen.push(rec) });
  t.after(() => A.server.close());
  const r = await call(A.port, 'POST', '/api/usage/report', {
    headers: { 'X-DF-Token': 'good' },
    body: { machineId: 'slave1', username: 'u1', host: '10.0.0.2', port: 22222, usage: { sessions: 3, days: 7, messages: 9, input: 111, output: 22 } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(A.peers.get('slave1').sessions, 3);
  assert.equal(A.peers.get('slave1').input, 111);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].machineId, 'slave1');
  assert.ok(A.peers.get('slave1').receivedAt > 0);
});

test('POST /api/usage/report：错误令牌 → 403 bad-token，不落库', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const r = await call(A.port, 'POST', '/api/usage/report', { headers: { 'X-DF-Token': 'bad' }, body: { machineId: 'x', usage: {} } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'bad-token');
  assert.deepEqual(A.peers.snapshot().peers, {});
});

test('POST /api/usage/report：缺 machineId 或 usage 非对象 → 400 bad-body', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const a = await call(A.port, 'POST', '/api/usage/report', { headers: { 'X-DF-Token': 'good' }, body: { usage: { sessions: 1 } } });
  assert.equal(a.status, 400);
  assert.equal(a.body.error, 'bad-body');
  const b = await call(A.port, 'POST', '/api/usage/report', { headers: { 'X-DF-Token': 'good' }, body: { machineId: 'm', usage: 'nope' } });
  assert.equal(b.status, 400);
  assert.equal(b.body.error, 'bad-body');
});

test('GET /api/usage/peers：返回 updatedAt 与 peers', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  await call(A.port, 'POST', '/api/usage/report', { headers: { 'X-DF-Token': 'good' }, body: { machineId: 'm9', usage: { sessions: 7 } } });
  const r = await call(A.port, 'GET', '/api/usage/peers');
  assert.equal(r.status, 200);
  assert.equal(r.body.peers.m9.sessions, 7);
  assert.ok(r.body.updatedAt > 0);
});

test('GET/POST /api/usage/reporter：配置读取、链接写入、坏链接 400', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const before = await call(A.port, 'GET', '/api/usage/reporter');
  assert.equal(before.status, 200);
  assert.equal(before.body.config.masterUrl, '');

  const bad = await call(A.port, 'POST', '/api/usage/reporter', { body: { link: 'nope' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad-link');

  const ok = await call(A.port, 'POST', '/api/usage/reporter', { body: { link: 'http://10.0.0.9:22222/?access=tk' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.config.masterUrl, 'http://10.0.0.9:22222');
  assert.equal(ok.body.config.token, 'tk');

  const after = await call(A.port, 'GET', '/api/usage/reporter');
  assert.equal(after.body.config.masterUrl, 'http://10.0.0.9:22222');
});

test('POST /api/usage/reporter/now：立即上报并回状态', async (t) => {
  const reporter = createUsageReporter({
    file: tmp('usage-report.json'), identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 2 }),
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  });
  reporter.setConfig({ masterUrl: 'http://a:22222', token: 'tk' });
  const A = await start({ reporter });
  t.after(() => A.server.close());
  const r = await call(A.port, 'POST', '/api/usage/reporter/now');
  assert.equal(r.status, 200);
  assert.equal(r.body.status.lastOk, true);
});

test('未知 /api/usage/* 路径 → 404', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const r = await call(A.port, 'GET', '/api/usage/nope');
  assert.equal(r.status, 404);
});

test('GET /api/usage/daily������ÿ�����棨��ѡ���������ˣ�', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  await call(A.port, 'POST', '/api/usage/report', { headers: { 'X-DF-Token': 'good' }, body: { machineId: 'm1', usage: { messages: 3, output: 9 } } });
  const all = await call(A.port, 'GET', '/api/usage/daily');
  assert.equal(all.status, 200);
  assert.equal(Object.keys(all.body.daily).length, 1);
  const one = await call(A.port, 'GET', '/api/usage/daily?machineId=m1');
  const days = Object.keys(one.body.daily.m1);
  assert.equal(days.length, 1);
  assert.equal(one.body.daily.m1[days[0]].messages, 3);
  assert.equal(one.body.daily.m1[days[0]].output, 9);
  const none = await call(A.port, 'GET', '/api/usage/daily?machineId=nope');
  assert.deepEqual(none.body.daily, {});
});

test('GET /api/usage/peers?fresh=1：成功返回群主汇总', async (t) => {
  const A = await start({ pullFromHub: async () => ({ code: 'ok', updatedAt: 123, members: { m2: { machineId: 'm2', messages: 9 } } }) });
  t.after(() => A.server.close());
  const r = await call(A.port, 'GET', '/api/usage/peers?fresh=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.peers.m2.messages, 9);
  assert.equal(r.body.stale, undefined);
});

test('GET /api/usage/peers?fresh=1：群主不可达回退本地并带 stale', async (t) => {
  const p = new UsagePeersStore({ file: tmp('usage-peers.json') });
  p.upsert({ machineId: 'm1', messages: 2 });
  const A = await start({ peers: p, pullFromHub: async () => ({ code: 'unreachable' }) });
  t.after(() => A.server.close());
  const r = await call(A.port, 'GET', '/api/usage/peers?fresh=1&masterId=M');
  assert.equal(r.body.peers.m1.messages, 2);
  assert.equal(r.body.stale, true);
});

test('GET /api/usage/peers?fresh=1：成功后缓存，失败回退缓存', async (t) => {
  let ok = true;
  const pull = async () => (ok ? { code: 'ok', updatedAt: 1, members: { m2: { machineId: 'm2', messages: 9 } } } : { code: 'unreachable' });
  const A = await start({ pullFromHub: pull });
  t.after(() => A.server.close());
  const a = await call(A.port, 'GET', '/api/usage/peers?fresh=1&masterId=M');
  assert.equal(a.body.peers.m2.messages, 9);
  ok = false;
  const b = await call(A.port, 'GET', '/api/usage/peers?fresh=1&masterId=M');
  assert.equal(b.body.peers.m2.messages, 9);
  assert.equal(b.body.stale, true);
});
