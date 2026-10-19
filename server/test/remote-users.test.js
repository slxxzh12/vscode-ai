import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemoteUsers, normalizeUsername, normalizeUserToken } from '../remote-users.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-users-')), 'collab', 'users.json'); }

test('remote users：创建/落盘/重载/列表', () => {
  const file = tmpFile();
  const s = createRemoteUsers({ file });
  const a = s.create({ username: 'alice', token: 'token-alice' });
  assert.ok(a.id);
  assert.equal(a.username, 'alice');
  assert.equal(a.enabled, true);
  assert.equal(s.list().length, 1);
  const s2 = createRemoteUsers({ file });
  assert.equal(s2.list()[0].username, 'alice');
  assert.equal(s2.list()[0].token, 'token-alice');
});

test('remote users：缺省令牌自动生成；用户名/令牌唯一（用户名不区分大小写）', () => {
  const s = createRemoteUsers({ file: tmpFile() });
  const a = s.create({ username: 'bob' });
  assert.ok(a.token.length >= 16);
  assert.throws(() => s.create({ username: 'BOB', token: 'x-token-1' }), (e) => e.code === 'duplicate-username');
  assert.throws(() => s.create({ username: 'carol', token: a.token }), (e) => e.code === 'duplicate-token');
  assert.throws(() => s.create({ username: '', token: 'x-token-1' }), (e) => e.code === 'bad-username');
  assert.throws(() => s.create({ username: 'dave', token: 'x' }), (e) => e.code === 'bad-token');
});

test('remote users：登录校验、停用、改令牌、删除', () => {
  const s = createRemoteUsers({ file: tmpFile() });
  const a = s.create({ username: 'alice', token: 'token-alice' });
  assert.equal(s.findByLogin('alice', 'token-alice').id, a.id);
  assert.equal(s.findByLogin('ALICE', 'token-alice').id, a.id);
  assert.equal(s.findByLogin('alice', 'wrong'), null);
  assert.equal(s.findByToken('token-alice').id, a.id);

  s.update(a.id, { enabled: false });
  assert.equal(s.findByLogin('alice', 'token-alice'), null);
  assert.equal(s.findByToken('token-alice'), null);

  const b = s.update(a.id, { enabled: true, token: 'token-alice-2' });
  assert.equal(b.enabled, true);
  assert.equal(s.findByToken('token-alice'), null);
  assert.equal(s.findByToken('token-alice-2').id, a.id);

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
