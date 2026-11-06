import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemoteUsers, normalizeUsername, normalizeUserToken } from '../remote-users.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-users-')), 'collab', 'users.json'); }

test('remote users：创建只用系统生成令牌，落盘/重载/列表', () => {
  const file = tmpFile();
  const s = createRemoteUsers({ file });
  const a = s.create({ username: 'alice', token: 'my-weak-password' });
  assert.ok(a.id);
  assert.equal(a.username, 'alice');
  assert.equal(a.enabled, true);
  assert.notEqual(a.token, 'my-weak-password');
  assert.match(a.token, /^[0-9a-f]{48}$/);
  assert.equal(s.list().length, 1);
  const s2 = createRemoteUsers({ file });
  assert.equal(s2.list()[0].username, 'alice');
  assert.equal(s2.list()[0].token, a.token);
});

test('remote users：用户名唯一（不区分大小写）', () => {
  const s = createRemoteUsers({ file: tmpFile() });
  const a = s.create({ username: 'bob' });
  assert.match(a.token, /^[0-9a-f]{48}$/);
  const b = s.create({ username: 'carol' });
  assert.notEqual(a.token, b.token);
  assert.throws(() => s.create({ username: 'BOB' }), (e) => e.code === 'duplicate-username');
  assert.throws(() => s.create({ username: '' }), (e) => e.code === 'bad-username');
});

test('remote users：登录校验、停用、忽略自定义令牌、删除', () => {
  const s = createRemoteUsers({ file: tmpFile() });
  const a = s.create({ username: 'alice' });
  assert.equal(s.findByLogin('alice', a.token).id, a.id);
  assert.equal(s.findByLogin('ALICE', a.token).id, a.id);
  assert.equal(s.findByLogin('alice', 'wrong'), null);
  assert.equal(s.findByToken(a.token).id, a.id);

  s.update(a.id, { enabled: false });
  assert.equal(s.findByLogin('alice', a.token), null);
  assert.equal(s.findByToken(a.token), null);

  const b = s.update(a.id, { enabled: true, token: 'my-weak-password' });
  assert.equal(b.enabled, true);
  assert.equal(b.token, a.token);
  assert.equal(s.findByToken('my-weak-password'), null);
  assert.equal(s.findByToken(a.token).id, a.id);

  assert.equal(s.remove(a.id), true);
  assert.equal(s.list().length, 0);
  assert.equal(s.remove(a.id), false);
});

test('remote users：用户名/令牌规范化', () => {
  assert.equal(normalizeUsername('  alice  '), 'alice');
  assert.throws(() => normalizeUsername('a\nb'), (e) => e.code === 'bad-username');
  assert.equal(normalizeUserToken('  abcdef  '), 'abcdef');
  assert.throws(() => normalizeUserToken('has space'), (e) => e.code === 'bad-token');
});
