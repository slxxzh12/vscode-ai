import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiSiteUsers, isExpired } from '../ai-site/users.js';

const SECRET = 'k'.repeat(48);
const DAY = 86400000;

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-users-')), 'ai-site', 'users.json');
}
function mock() {
  return createAiSiteUsers({ file: tmpFile(), getSecret: () => SECRET });
}

test('users：签发 JWT、登录校验、唯一、落盘', () => {
  const file = tmpFile();
  const s = createAiSiteUsers({ file, getSecret: () => SECRET });
  const a = s.create({ username: 'alice', expiresAt: Date.now() + DAY });
  assert.equal(a.jwt.split('.').length, 3);
  assert.equal(a.jti.length > 0, true);
  assert.ok(a.exp * 1000 > Date.now());
  assert.equal(a.revoked, false);
  assert.throws(() => s.create({ username: 'ALICE' }), (e) => e.code === 'duplicate-username');

  assert.equal(s.findByJwt(a.jwt).id, a.id);
  assert.equal(s.findByToken(a.jwt).id, a.id);
  assert.equal(s.findByJwt('not-a-jwt'), null);
  assert.equal(s.findByJwt(a.jwt + 'x'), null);
  // 换密钥后签名不匹配
  const other = createAiSiteUsers({ file, getSecret: () => 'o'.repeat(48) });
  assert.equal(other.findByJwt(a.jwt), null);
  // 重新加载后仍可登录
  const again = createAiSiteUsers({ file, getSecret: () => SECRET });
  assert.equal(again.list()[0].username, 'alice');
  assert.equal(again.findByJwt(a.jwt).id, a.id);
});

test('users：过期用户不可登录，isExpired 判定', () => {
  const s = mock();
  const u = s.create({ username: 'old', expiresAt: Date.now() - 1000 });
  assert.equal(isExpired(u, Date.now()), true);
  assert.equal(s.findByJwt(u.jwt), null);
});

test('users：黑名单吊销后不可登录，解除后恢复', () => {
  const s = mock();
  const u = s.create({ username: 'bob', expiresAt: Date.now() + DAY });
  assert.deepEqual(s.blacklist(), []);
  s.revoke('bob');
  assert.deepEqual(s.blacklist(), ['bob']);
  assert.equal(s.get(u.id).revoked, true);
  assert.equal(s.findByJwt(u.jwt), null);
  s.revoke('BOB', false);
  assert.equal(s.get(u.id).revoked, false);
  assert.equal(s.findByJwt(u.jwt).id, u.id);
});

test('users：修改有效日期会重签 JWT，旧 JWT 失效', () => {
  const s = mock();
  const a = s.create({ username: 'carol', expiresAt: Date.now() + DAY });
  const b = s.update(a.id, { expiresAt: Date.now() + 2 * DAY });
  assert.notEqual(b.jwt, a.jwt);
  assert.notEqual(b.jti, a.jti);
  assert.equal(s.findByJwt(b.jwt).id, a.id);
  assert.equal(s.findByJwt(a.jwt), null);
});

test('users：停用不可登录，recordUse 累加，删除', () => {
  const s = mock();
  const a = s.create({ username: 'dave' });
  const u = s.recordUse(a.id, 1000);
  assert.equal(u.uses, 1);
  assert.equal(u.lastRunAt, 1000);
  s.update(a.id, { enabled: false });
  assert.equal(s.findByJwt(a.jwt), null);
  s.update(a.id, { enabled: true });
  assert.equal(s.recordUse(a.id, 2000).uses, 2);
  assert.equal(s.remove(a.id), true);
  assert.equal(s.list().length, 0);
});
