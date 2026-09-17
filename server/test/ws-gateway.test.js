import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { startTestServer } from './helpers/test-server.js';
import { makeFakePtyFactory, makeFakePty } from './helpers/fake-pty.js';
import { C2S, S2C } from '@devflow/shared';

async function makeHarness() {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const t = await startTestServer({ sessionManager: sm });
  return { sm, t, instances };
}

test('连接时服务端 ws.data 初始为 {sessionId:null}', async (t) => {
  const { t: ts } = await makeHarness();
  try {
    const c = await ts.connect();
    const serverConn = [...ts.gateway.conns][0];
    assert.deepEqual(serverConn.ws.data, { sessionId: null });
    assert.equal(serverConn.sessionId, null);
    c.close();
  } finally {
    await ts.stop();
  }
});

test('create 自动 attach 并重放缓冲', async () => {
  const { sm, t, instances } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, { cols: 90, rows: 30 });
  const created = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  const replay = await c.wait((m) => m.type === S2C.REPLAY && m.sessionId === created.session.id);
  assert.ok(replay.data.startsWith('\x1b[2J\x1b[H'));
  const s = sm.get(created.session.id);
  s.ring.push('earlier-line\n');
  c.send(C2S.START, { sessionId: s.id });
  const replay2 = await c.wait((m) => m.type === S2C.REPLAY && m.sessionId === s.id);
  assert.ok(replay2.data.includes('earlier-line'));
  instances[0].pty.__emitData('live\n');
  const out = await c.wait((m) => m.type === S2C.OUTPUT && m.data === 'live\n');
  assert.equal(out.sessionId, s.id);
  await t.stop();
});

test('input 转发到绑定会话 pty', async () => {
  const { t, instances } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  await c.wait((m) => m.type === S2C.SESSION_CREATED);
  c.send(C2S.INPUT, { data: 'ls -la\r' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(instances[0].pty.writes.at(-1), 'ls -la\r');
  await t.stop();
});

test('input 带 sessionId 时写入指定会话而非当前活动会话', async () => {
  const { t, instances } = await makeHarness();
  try {
    const c = await t.connect();
    c.send(C2S.CREATE, {});
    const a = await c.wait((m) => m.type === S2C.SESSION_CREATED);
    c.send(C2S.CREATE, {});
    await c.wait((m) => m.type === S2C.SESSION_CREATED && m.session.id !== a.session.id);
    const ptyA = instances[0].pty;
    const ptyB = instances[1].pty;
    ptyA.writes.length = 0;
    ptyB.writes.length = 0;
    // 当前活动会话是 b（后建的），但仍定向写入 a
    c.send(C2S.INPUT, { data: 'to-a\r', sessionId: a.session.id });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(ptyA.writes, ['to-a\r']);
    assert.deepEqual(ptyB.writes, []);
  } finally {
    await t.stop();
  }
});

test('start 切换会话：旧会话收不到新输出', async () => {
  const { t, instances } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  const a = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  c.send(C2S.CREATE, {});
  const b = await c.wait((m) => m.type === S2C.SESSION_CREATED && m.session.id !== a.session.id);
  c.send(C2S.START, { sessionId: a.session.id });
  await c.wait((m) => m.type === S2C.REPLAY && m.sessionId === a.session.id);
  instances[1].pty.__emitData('from-b\n');
  c.send(C2S.START, { sessionId: b.session.id });
  await c.wait((m) => m.type === S2C.REPLAY && m.sessionId === b.session.id);
  instances[1].pty.__emitData('from-b-2\n');
  const out = await c.wait((m) => m.type === S2C.OUTPUT && m.data === 'from-b-2\n');
  assert.equal(out.sessionId, b.session.id);
  await t.stop();
});

test('socket 关闭后不再有写入：数据仍进 ring 且不抛', async () => {
  const { sm, t, instances } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  const a = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  instances[0].pty.__emitData('tail-before-close\n');
  await c.wait((m) => m.type === S2C.OUTPUT);
  c.close();
  await new Promise((r) => setTimeout(r, 30));
  const s = sm.get(a.session.id);
  instances[0].pty.__emitData('after-close\n');
  assert.equal(s.ring.content.includes('after-close'), true);
  await t.stop();
});

test('stop 解绑但不杀进程；kill 删除会话', async () => {
  const { sm, t } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  const a = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  c.send(C2S.STOP, {});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sm.get(a.session.id).state, 'running');
  c.send(C2S.KILL, { sessionId: a.session.id });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sm.get(a.session.id), null);
  await t.stop();
});

test('ping 回 pong', async () => {
  const { t } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.PING, {});
  const pong = await c.wait((m) => m.type === S2C.PONG);
  assert.ok(pong);
  await t.stop();
});

test('未知会话 start 回 error', async () => {
  const { t } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.START, { sessionId: 'ghost' });
  const err = await c.wait((m) => m.type === S2C.ERROR);
  assert.equal(err.code, 'not-found');
  await t.stop();
});

test('create 透传 kind/agentId/agentCmd 并出现在 summary', async () => {
  const { t } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, { kind: 'agent', agentId: 'opencode', agentCmd: 'opencode' });
  const created = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  assert.equal(created.session.kind, 'agent');
  assert.equal(created.session.agentId, 'opencode');
  assert.equal(created.session.restored, false);
  await t.stop();
});

test('restore：成功 → SESSION_CREATED + REPLAY，summary 带 resumed', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ id: 's_hist01', name: 'hist', kind: 'agent', agentId: 'opencode' });
  session.resumed = true;
  session.ring.push('old-line\n');
  const t = await startTestServer({ sessionManager: sm, restoreSessionById: async (id) => (id === 's_hist01' ? { ok: true, session } : { ok: false, reason: 'not-found' }) });
  try {
    const c = await t.connect();
    c.send(C2S.RESTORE, { sessionId: 's_hist01' });
    const created = await c.wait((m) => m.type === S2C.SESSION_CREATED);
    assert.equal(created.session.id, 's_hist01');
    assert.equal(created.session.resumed, true);
    const replay = await c.wait((m) => m.type === S2C.REPLAY && m.sessionId === 's_hist01');
    assert.ok(replay.data.includes('old-line'));
  } finally {
    await t.stop();
  }
});

test('restore：not-found → ERROR restore-failed', async () => {
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory([])({ cwd: process.cwd() }) });
  const t = await startTestServer({ sessionManager: sm, restoreSessionById: async () => ({ ok: false, reason: 'not-found' }) });
  try {
    const c = await t.connect();
    c.send(C2S.RESTORE, { sessionId: 'ghost' });
    const err = await c.wait((m) => m.type === S2C.ERROR);
    assert.equal(err.code, 'restore-failed');
    assert.equal(err.message, 'not-found');
  } finally {
    await t.stop();
  }
});

test('restore：未注入 restoreSessionById 时回 error', async () => {
  const { t } = await makeHarness();
  try {
    const c = await t.connect();
    c.send(C2S.RESTORE, { sessionId: 'x' });
    const err = await c.wait((m) => m.type === S2C.ERROR);
    assert.equal(err.code, 'restore-failed');
  } finally {
    await t.stop();
  }
});

test('三次防崩溃：pty 写抛异常被吞、服务存活新连接正常', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => {
    const p = makeFakePty();
    const orig = p.write;
    p.write = (s) => { if (instances.length === 0) throw new Error('Socket is closed'); return orig(s); };
    instances.push(p);
    return p;
  } });
  const t = await startTestServer({ sessionManager: sm });
  const c = await t.connect();
  c.send(C2S.CREATE, {});
  const a = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  c.send(C2S.INPUT, { data: 'boom\r' });
  c.send(C2S.KILL, { sessionId: a.session.id });
  await new Promise((r) => setTimeout(r, 20));
  const c2 = await t.connect();
  c2.send(C2S.PING, {});
  const pong = await c2.wait((m) => m.type === S2C.PONG);
  assert.ok(pong);
  await t.stop();
});
