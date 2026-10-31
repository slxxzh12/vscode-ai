import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../session-manager.js';
import { makeFakePty, makeFakePtyFactory } from './helpers/fake-pty.js';

const fakeConn = () => ({ sessionId: null });

test('create 返回 running 会话并注册唯一 data 扇出事件', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const dataSeen = [];
  sm.on('data', (s, chunk) => dataSeen.push(chunk));
  const s = await sm.create({ projectId: 'p1', cols: 100, rows: 30 });
  assert.equal(s.state, 'running');
  assert.ok(s.alive);
  assert.equal(s.clients.size, 0);
  instances[0].pty.__emitData('hi\n');
  assert.deepEqual(dataSeen, ['hi\n']);
  assert.equal(s.ring.content, 'hi\n');
});

test('write 仅在 alive 且有 pty 时写入；退出后静默失败', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({});
  assert.equal(sm.write(s.id, 'echo x\r'), true);
  assert.equal(instances[0].pty.writes[0], 'echo x\r');
  instances[0].pty.__emitExit(0);
  assert.equal(s.state, 'exited');
  assert.equal(s.alive, false);
  assert.equal(sm.write(s.id, 'nope\r'), false);
  assert.equal(instances[0].pty.writes.length, 1);
});

test('exit 事件广播且缓冲保留', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const exits = [];
  sm.on('exit', (s) => exits.push(s));
  const s = await sm.create({});
  instances[0].pty.__emitData('last words\n');
  instances[0].pty.__emitExit(1);
  assert.equal(exits.length, 1);
  assert.equal(s.ring.content, 'last words\n');
});

test('kill 从管理器移除并安全 kill pty', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({});
  const conn = fakeConn();
  sm.setActive(s.id, conn);
  assert.equal(conn.sessionId, s.id);
  assert.equal(sm.kill(s.id), true);
  assert.equal(sm.get(s.id), null);
  assert.equal(conn.sessionId, null);
  assert.equal(sm.kill('ghost'), false);
});

test('setActive 换会话时旧会话不再持有 conn', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const a = await sm.create({});
  const b = await sm.create({});
  const conn = fakeConn();
  sm.setActive(a.id, conn);
  sm.setActive(b.id, conn);
  assert.equal(a.clients.has(conn), false);
  assert.equal(b.clients.has(conn), true);
  assert.equal(conn.sessionId, b.id);
});

test('detachAll 移除全部会话对 conn 的引用', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const a = await sm.create({});
  const conn = fakeConn();
  sm.setActive(a.id, conn);
  sm.detachAll(conn);
  assert.equal(a.clients.has(conn), false);
  assert.equal(conn.sessionId, null);
});

test('resize 更新尺寸', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({ cols: 80, rows: 24 });
  assert.equal(sm.resize(s.id, 120, 40), true);
  assert.equal(s.cols, 120);
});

test('list 返回概要并按创建倒序', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const a = await sm.create({ name: 'A' });
  await sm.create({ name: 'B' });
  const l = sm.list();
  assert.equal(l[0].name, 'B');
  assert.equal(l[1].id, a.id);
  assert.equal(typeof l[0].state, 'string');
});

test('projectResolver 决定默认 cwd；缺省回退 process.cwd()', async () => {
  const instances = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-sm-proj-'));
  const override = fs.mkdtempSync(path.join(os.tmpdir(), 'df-sm-over-'));
  const sm = new SessionManager({
    ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }),
    projectResolver: (id) => (id === 'devflow' ? root : null),
  });
  try {
    const withProj = await sm.create({ projectId: 'devflow' });
    assert.equal(withProj.cwd, root);
    const noProj = await sm.create({});
    assert.equal(noProj.cwd, process.cwd());
    const unknown = await sm.create({ projectId: 'ghost' });
    assert.equal(unknown.cwd, process.cwd());
    const explicit = await sm.create({ projectId: 'devflow', cwd: override });
    assert.equal(explicit.cwd, override);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(override, { recursive: true, force: true });
  }
});

test('create 在 cwd 不存在时抛 cwd-missing，且不启动 pty', async () => {
  const instances = [];
  const gone = path.join(os.tmpdir(), `df-sm-gone-${Date.now()}`);
  const sm = new SessionManager({
    ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }),
    projectResolver: (id) => (id === 'gone' ? gone : null),
  });
  await assert.rejects(
    () => sm.create({ projectId: 'gone' }),
    (e) => e && e.code === 'cwd-missing',
  );
  assert.equal(instances.length, 0);
});

test('create 之后调用 onCreated，携带 id/projectId', async () => {
  const instances = [];
  const seen = [];
  const sm = new SessionManager({
    ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }),
    onCreated: (s) => seen.push(s),
  });
  const s = await sm.create({ projectId: 'p1' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, s.id);
  assert.equal(seen[0].projectId, 'p1');
});

test('未传 onCreated 时 create 正常', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({});
  assert.ok(s.id);
  assert.equal(s.projectId, null);
});

test('create 支持显式 id/createdAt 并保留 kind/agentId', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({ id: 's_fixed01', createdAt: 111, kind: 'agent', agentId: 'opencode', agentCmd: 'opencode' });
  assert.equal(s.id, 's_fixed01');
  assert.equal(s.createdAt, 111);
  const sum = sm.summary(s);
  assert.equal(sum.kind, 'agent');
  assert.equal(sum.agentId, 'opencode');
  assert.equal(sum.restored, false);
});

test('create 用 replay 预填 ring，START 重放能看到', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({ replay: 'old-line\n' });
  assert.equal(s.ring.content, 'old-line\n');
});

test('list 按 createdAt 降序保持恢复顺序', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  await sm.create({ id: 's_old00001', createdAt: 100 });
  await sm.create({ id: 's_new00001', createdAt: 200 });
  assert.deepEqual(sm.list().map((s) => s.id), ['s_new00001', 's_old00001']);
});

test('markRestored 置 restored=true 并出现在 summary', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({});
  sm.markRestored(s.id);
  assert.equal(sm.summary(s).restored, true);
});

test('summary 带 resumed（仅恢复时置 true）', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({});
  assert.equal(sm.summary(s).resumed, undefined);
  s.resumed = true;
  assert.equal(sm.summary(s).resumed, true);
});

test('live 返回全部会话对象', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  await sm.create({});
  assert.equal(sm.live().length, 1);
});

test('create 把 env 透传给 ptyFactory', async () => {
  const seen = [];
  const sm = new SessionManager({ ptyFactory: async (opts) => { seen.push(opts); return makeFakePty(); } });
  await sm.create({ env: { DEVFLOW_RUN_CONTEXT: 'C:/ctx.json' } });
  assert.deepEqual(seen[0].env, { DEVFLOW_RUN_CONTEXT: 'C:/ctx.json' });
});
