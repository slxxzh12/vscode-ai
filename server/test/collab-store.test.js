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
  assert.deepEqual(s.data.friends, []);
  assert.deepEqual(s.data.groups, []);
  assert.deepEqual(s.data.skillsInbox, []);
  assert.deepEqual(s.data.groupSkills, []);
});

test('持久化与重载一致', () => {
  const f = tmpFile();
  const s = new CollabStore({ file: f });
  s.data.friends.push({ machineId: 'x', username: 'u', host: 'h', port: 1, publicKey: 'k' });
  s.save();
  const s2 = new CollabStore({ file: f });
  assert.equal(s2.data.friends.length, 1);
  assert.equal(s2.data.friends[0].machineId, 'x');
});

test('list/find/upsert 助手', () => {
  const s = new CollabStore({ file: tmpFile() });
  const f = { machineId: 'a', username: 'u', host: 'h', port: 1, publicKey: 'k' };
  s.addFriend(f);
  assert.equal(s.listFriends().length, 1);
  assert.equal(s.findFriend('a').machineId, 'a');
  assert.equal(s.findFriend('zz'), null);
  s.upsertFriend({ ...f, username: 'u2' });
  assert.equal(s.findFriend('a').username, 'u2');
  s.removeFriend('a');
  assert.equal(s.listFriends().length, 0);
});
