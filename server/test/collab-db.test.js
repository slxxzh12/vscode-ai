import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCollabDb } from '../collab-db.js';

function tmpDb() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-collabdb-')), 'collab.db');
}

test('æˆå‘˜ç»´æŠ¤è¡¨ï¼šæ³¨å†Œ/è¦†ç›–åŒä¸€æˆå‘˜ï¼ŒæŒ‰ç¾¤åˆ—å‡º', () => {
  const db = createCollabDb({ file: tmpDb(), logger: { warn() {} } });
  db.registerMember({ groupId: 'g1', machineId: 'm1', username: 'u1', host: '10.0.0.1', port: 22222, publicKey: 'PK1' }, 1000);
  db.registerMember({ groupId: 'g1', machineId: 'm2', username: 'u2', host: '10.0.0.2', port: 22222 }, 1001);
  db.registerMember({ groupId: 'g1', machineId: 'm1', username: 'u1', host: '10.0.0.9', port: 33333, publicKey: 'PK1' }, 2000);

  const list = db.listMembers('g1');
  assert.equal(list.length, 2);
  const m1 = list.find((m) => m.machineId === 'm1');
  assert.equal(m1.host, '10.0.0.9', 'åŒä¸€æˆå‘˜è¢«è¦†ç›–');
  assert.equal(m1.port, 33333);
  assert.equal(m1.updatedAt, 2000);
  assert.equal(db.listMembers('other').length, 0);
  db.close();
});

test('æˆå‘˜ commandï¼šæ•´è¡¨è¦†ç›–è¯¥æˆå‘˜é‚£ç»„ï¼Œä¸æ®‹ç•™æ—§å‘½ä»¤', () => {
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

test('æ¶ˆæ¯è¡¨ï¼šsrc/target/message/command/update_time å¾€è¿”ï¼Œä¸”å¯å¢é‡æ‹‰å–', () => {
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

test('æ¶ˆæ¯è¡¨ï¼šè½ç›˜åé‡æ–°æ‰“å¼€ä»åœ¨', () => {
  const file = tmpDb();
  const a = createCollabDb({ file, logger: { warn() {} } });
  a.addMessage({ id: 'keep', groupId: 'g1', src: 'm1', message: 'k', updateTime: 5 });
  a.close();
  const b = createCollabDb({ file, logger: { warn() {} } });
  assert.equal(b.listMessages({ groupId: 'g1' })[0].message, 'k');
  b.close();
});

test('¹²ÓÃÒ»¸öÊı¾İ¿âÎÄ¼ş£ºusage / peer_daily / seed / member / message ¶¼ÔÚÍ¬Ò»¿â', async () => {
  const { createSeedStore } = await import('../seed-store.js');
  const { UsagePeersStore } = await import('../usage-peers.js');
  const { createUsageStore } = await import('../usage-store.js');
  const file = tmpDb();
  const db = createCollabDb({ file, logger: { warn() {} } });
  const seed = createSeedStore({ file, logger: { warn() {} } });
  const peers = new UsagePeersStore({ file: path.join(path.dirname(file), 'usage-peers.json'), dailyFile: file, logger: { warn() {} } });
  const usage = createUsageStore({ file });

  db.registerMember({ groupId: 'g1', machineId: 'm1', username: 'u1' }, 1);
  db.setCommands({ groupId: 'g1', machineId: 'm1', commands: ['dev'] }, 1);
  db.addMessage({ id: 'x1', groupId: 'g1', src: 'm1', message: 'hi', updateTime: 1 });
  seed.add({ id: 'p1', fileName: 'a.zip', skills: ['demo'], workflow: ['dev'], skillsUpdatedAt: 11, workflowUpdatedAt: 22, detail: { skills: [{ name: 'demo', files: 3 }] }, createdAt: 1 });
  peers.upsert({ machineId: 'm1', messages: 5 }, Date.now());
  usage.upsert({ date: '2026-09-16', memberId: 'm1', agent: 'opencode', input: 1 });

  const tables = db.db.prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name').all('table').map((r) => r.name);
  for (const t of ['usage', 'peer_daily', 'seed', 'member', 'member_command', 'message']) {
    assert.ok(tables.includes(t), `È±ÉÙ±í ${t}£¨ÏÖÓĞ£º${tables.join(',')}£©`);
  }
  // ÖÖ×Ó±í£º¸üĞÂÊ±¼äÓëÃ÷Ï¸Ò²´æ½øÈ¥ÁË
  assert.equal(seed.get('p1').skillsUpdatedAt, 11);
  assert.equal(seed.get('p1').workflowUpdatedAt, 22);
  assert.deepEqual(seed.get('p1').detail.skills, [{ name: 'demo', files: 3 }]);
  peers.close(); usage.close ? usage.close() : null; db.close();
});
