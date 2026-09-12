import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabStore } from '../collaboration/store.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-store-'));
  return path.join(dir, 'collab.json');
}

test('空文件初始化默认结构', () => {
  const s = new CollabStore({ file: tmpFile() });
  assert.deepEqual(s.data.identity, null);
  assert.deepEqual(s.data.groups, []);
  assert.deepEqual(s.data.skillsInbox, []);
  assert.deepEqual(s.data.groupSkills, []);
});

test('旧结构群组迁移：ownerId→hubId 并去掉 role', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({
    groups: [{ id: 'legacy', name: 'test', ownerId: 'me', createdAt: 1, members: [{ machineId: 'me', username: 'u', host: 'h', port: 1, publicKey: 'k', role: 'owner' }] }],
  }));
  const s = new CollabStore({ file: f });
  const g = s.findGroup('legacy');
  assert.equal(g.hubId, 'me');
  assert.equal(g.ownerId, undefined);
  assert.equal(g.members[0].role, undefined);
  assert.equal(s.ownedGroup('me').id, 'legacy');
});

test('多群 ensure/get/addMember/persist', () => {
  const f = tmpFile();
  const s = new CollabStore({ file: f });
  const self = { machineId: 'me', username: 'u', host: 'h', port: 1, publicKey: 'k' };
  const g = s.ensureGroup({ name: 'shared', hubId: 'me', self });
  assert.equal(g.id, 'me');
  assert.equal(g.members.length, 1);
  assert.equal(s.getGroup().id, 'me');
  assert.equal(s.ownedGroup('me').id, 'me');
  s.addGroupMember('me', { machineId: 'peer', username: 'p', host: 'h2', port: 2, publicKey: 'k2' });
  assert.equal(s.getGroup().members.length, 2);
  s.addGroupMember('me', { machineId: 'peer', username: 'p', host: 'h2', port: 2, publicKey: 'k2' });
  assert.equal(s.getGroup().members.length, 2, '去重');
  s.upsertGroup({ id: 'other', name: 'g2', hubId: 'hub2', createdAt: 1, members: [] });
  assert.equal(s.listGroups().length, 2);
  assert.equal(s.findGroup('other').name, 'g2');
  s.save();
  const s2 = new CollabStore({ file: f });
  assert.equal(s2.getGroup().members.length, 2);
  assert.equal(s2.listGroups().length, 2);
});

test('chat 增删查 + 全局单调 seq', () => {
  const s = new CollabStore({ file: tmpFile() });
  s.addChatMessage({ id: 'm1', groupId: 'g', kind: 'text', fromId: 'a', text: 'hi', toId: null, ts: 1 });
  s.addChatMessage({ id: 'm2', groupId: 'g', kind: 'text', fromId: 'b', text: 'yo', toId: 'a', ts: 2 });
  const msgs = s.listChatMessages('g');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].seq, 1);
  assert.equal(msgs[1].seq, 2);
  assert.equal(msgs[0].groupId, 'g');
  // afterSeq 过滤
  const after = s.listChatMessages('g', { afterSeq: 1 });
  assert.equal(after.length, 1);
  assert.equal(after[0].id, 'm2');
  // 每机全局 seq 单调
  assert.equal(s.nextChatSeq(), 3);
  assert.equal(s.nextChatSeq(), 4);
  s.addChatMessage({ id: 'm3', groupId: 'g2', kind: 'system', fromId: 'a', text: 'sys', toId: null, ts: 3 });
  assert.equal(s.listChatMessages('g2')[0].seq, 5);
});

test('pendingCmds', () => {
  const s = new CollabStore({ file: tmpFile() });
  s.addPendingCmd({ id: 'r1', groupId: 'g', fromId: 'a', text: 'ls', receivedAt: 1 });
  assert.equal(s.listPendingCmds().length, 1);
  assert.ok(s.findPendingCmd('r1'));
  s.removePendingCmd('r1');
  assert.equal(s.listPendingCmds().length, 0);
});

test('本地历史 cap 每群 500', () => {
  const s = new CollabStore({ file: tmpFile() });
  for (let i = 0; i < 502; i++) s.addChatMessage({ id: `m${i}`, groupId: 'g', kind: 'text', fromId: 'a', text: String(i), toId: null, ts: i });
  const msgs = s.listChatMessages('g');
  assert.equal(msgs.length, 500);
  assert.equal(msgs[0].id, 'm2'); // 最旧两条被裁
});

test('heartbeats 表 upsert / list', () => {
  const s = new CollabStore({ file: tmpFile() });
  assert.deepEqual(s.listHeartbeats(), {});
  s.setHeartbeat('m1', { agent: 'opencode', input: 1, receivedAt: 10 });
  s.setHeartbeat('m1', { agent: 'opencode', input: 2, receivedAt: 20 });
  assert.equal(s.listHeartbeats().m1.input, 2);
  assert.equal(s.listHeartbeats().m1.receivedAt, 20);
});
