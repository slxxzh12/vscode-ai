import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCollabDb } from '../collab-db.js';

function tmpDb() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-collabdb-')), 'collab.db');
}

test('成员维护表：注册/覆盖同一成员，按群列出', () => {
  const db = createCollabDb({ file: tmpDb(), logger: { warn() {} } });
  db.registerMember({ groupId: 'g1', machineId: 'm1', username: 'u1', host: '10.0.0.1', port: 22222, publicKey: 'PK1' }, 1000);
  db.registerMember({ groupId: 'g1', machineId: 'm2', username: 'u2', host: '10.0.0.2', port: 22222 }, 1001);
  db.registerMember({ groupId: 'g1', machineId: 'm1', username: 'u1', host: '10.0.0.9', port: 33333, publicKey: 'PK1' }, 2000);

  const list = db.listMembers('g1');
  assert.equal(list.length, 2);
  const m1 = list.find((m) => m.machineId === 'm1');
  assert.equal(m1.host, '10.0.0.9', '同一成员被覆盖');
  assert.equal(m1.port, 33333);
  assert.equal(m1.updatedAt, 2000);
  assert.equal(db.listMembers('other').length, 0);
  db.close();
});

test('成员 command：整表覆盖该成员那组，不残留旧命令', () => {
  const db = createCollabDb({ file: tmpDb(), logger: { warn() {} } });
  db.setCommands({ groupId: 'g1', machineId: 'm1', commands: ['dev', 'test'] }, 1000);
  let list = db.listCommands({ groupId: 'g1' });
  assert.deepEqual(list.map((c) => c.name), ['dev', 'test']);
  db.setCommands({ groupId: 'g1', machineId: 'm1', commands: ['dev'] }, 2000);
  list = db.listCommands({ groupId: 'g1', machineId: 'm1' });
  assert.deepEqual(list.map((c) => c.name), ['dev']);
  assert.equal(list[0].updatedAt, 2000);

  db.setCommands({ groupId: 'g1', machineId: 'm2', commands: ['doc'] }, 3000);
  assert.deepEqual(db.listCommands({ groupId: 'g1' }).map((c) => `${c.machineId}:${c.name}`), ['m1:dev', 'm2:doc']);
  db.close();
});

test('消息表：src/target/message/command/update_time 往返，且可增量拉取', () => {
  const db = createCollabDb({ file: tmpDb(), logger: { warn() {} } });
  db.addMessage({ id: 'x1', groupId: 'g1', src: 'm1', target: null, message: 'hi', updateTime: 100 });
  db.addMessage({ id: 'x2', groupId: 'g1', src: 'm2', target: 'm1', message: 'out', command: 'ls -la', updateTime: 200 });
  const all = db.listMessages({ groupId: 'g1' });
  assert.deepEqual(all.map((m) => m.id), ['x1', 'x2']);
  assert.equal(all[1].command, 'ls -la');
  assert.equal(all[1].target, 'm1');
  const inc = db.listMessages({ groupId: 'g1', afterTime: 150 });
  assert.deepEqual(inc.map((m) => m.id), ['x2']);
  db.close();
});

test('消息表：落盘后重新打开仍在', () => {
  const file = tmpDb();
  const a = createCollabDb({ file, logger: { warn() {} } });
  a.addMessage({ id: 'keep', groupId: 'g1', src: 'm1', message: 'k', updateTime: 5 });
  a.close();
  const b = createCollabDb({ file, logger: { warn() {} } });
  assert.equal(b.listMessages({ groupId: 'g1' })[0].message, 'k');
  b.close();
});
