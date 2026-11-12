import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiSiteUsers } from '../ai-site/users.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-users-')), 'ai-site', 'users.json');
}

test('users：创建/唯一/落盘/登录', () => {
  const file = tmpFile();
  const s = createAiSiteUsers({ file });
  const a = s.create({ username: 'alice' });
  assert.match(a.token, /^[0-9a-f]{48}$/);
  assert.equal(a.uses, 0);
  assert.throws(() => s.create({ username: 'ALICE' }), (e) => e.code === 'duplicate-username');
  assert.equal(s.findByLogin('alice', a.token).id, a.id);
  assert.equal(s.findByLogin('alice', 'wrong'), null);
  assert.equal(s.findByToken(a.token).id, a.id);
  const s2 = createAiSiteUsers({ file });
  assert.equal(s2.list()[0].username, 'alice');
});

test('users：停用后不可登录，recordUse 累加', () => {
  const s = createAiSiteUsers({ file: tmpFile() });
  const a = s.create({ username: 'bob' });
  const u = s.recordUse(a.id, 1000);
  assert.equal(u.uses, 1);
  assert.equal(u.lastRunAt, 1000);
  s.update(a.id, { enabled: false });
  assert.equal(s.findByLogin('bob', a.token), null);
  assert.equal(s.findByToken(a.token), null);
  s.update(a.id, { enabled: true });
  assert.equal(s.recordUse(a.id, 2000).uses, 2);
  assert.equal(s.remove(a.id), true);
  assert.equal(s.list().length, 0);
});
