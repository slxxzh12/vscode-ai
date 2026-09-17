import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';

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
  const root = 'D:\\projects\\devflow';
  const sm = new SessionManager({
    ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }),
    projectResolver: (id) => (id === 'devflow' ? root : null),
  });
  const withProj = await sm.create({ projectId: 'devflow' });
  assert.equal(withProj.cwd, root);
  const noProj = await sm.create({});
  assert.equal(noProj.cwd, process.cwd());
  const unknown = await sm.create({ projectId: 'ghost' });
  assert.equal(unknown.cwd, process.cwd());
  const explicit = await sm.create({ projectId: 'devflow', cwd: 'C:\\override' });
  assert.equal(explicit.cwd, 'C:\\override');
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
