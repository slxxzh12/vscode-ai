import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInviteActive, loadInvite, saveInvite, clearInvite } from '../remote-invite.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-invite-')), 'collab', 'invite.json');
}

test('saveInvite 落盘、loadInvite 读回（含自动建目录）', () => {
  const file = tmpFile();
  assert.equal(loadInvite(file), null);
  saveInvite(file, { token: 'tk', password: 'pw', expiresAt: 123 });
  assert.deepEqual(loadInvite(file), { token: 'tk', password: 'pw', expiresAt: 123 });
});

test('clearInvite 删除文件且不抛错', () => {
  const file = tmpFile();
  saveInvite(file, { token: 'tk', password: 'pw', expiresAt: 0 });
  clearInvite(file);
  assert.equal(loadInvite(file), null);
  clearInvite(file);   // 幂等
});

test('isInviteActive：expiresAt=0 永久有效；过期/无 token 无效', () => {
  assert.equal(isInviteActive({ token: 'tk', expiresAt: 0 }, 9e12), true);
  assert.equal(isInviteActive({ token: 'tk', expiresAt: 1000 }, 999), true);
  assert.equal(isInviteActive({ token: 'tk', expiresAt: 1000 }, 1001), false);
  assert.equal(isInviteActive(null, 1), false);
  assert.equal(isInviteActive({ expiresAt: 0 }, 1), false);
});

test('文件损坏时 loadInvite 返回 null', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json', 'utf8');
  assert.equal(loadInvite(file), null);
});
