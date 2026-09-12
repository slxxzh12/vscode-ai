import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadIdentity } from '../collaboration/identity.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-id-'));
  return path.join(dir, 'identity.json');
}

test('首次生成 identity 并持久化；二次加载复用', () => {
  const f = tmpFile();
  const a = loadIdentity({ file: f, username: 'alice', host: '192.168.1.5', port: 3001 });
  assert.ok(a.machineId);
  assert.equal(a.username, 'alice');
  assert.ok(a.publicKey.includes('PUBLIC KEY'));
  assert.ok(a.privateKey.includes('PRIVATE KEY'));
  const b = loadIdentity({ file: f, username: 'alice', host: '192.168.1.5', port: 3001 });
  assert.equal(b.machineId, a.machineId);
  assert.equal(b.publicKey, a.publicKey);
  assert.equal(b.privateKey, a.privateKey);
});

test('用户名/host/port 更新会被刷新', () => {
  const f = tmpFile();
  loadIdentity({ file: f, username: 'alice', host: '192.168.1.5', port: 3001 });
  const c = loadIdentity({ file: f, username: 'bob', host: '0.0.0.0', port: 3999 });
  assert.equal(c.username, 'bob');
  assert.equal(c.host, '0.0.0.0');
  assert.equal(c.port, 3999);
});

test('工号 employeeId 持久化；未探测到时不覆盖已存值', () => {
  const f = tmpFile();
  loadIdentity({ file: f, username: 'alice', employeeId: 'E123', host: '192.168.1.5', port: 3001 });
  const again = loadIdentity({ file: f, username: 'alice', host: '192.168.1.5', port: 3001 });
  assert.equal(again.employeeId, 'E123');
  const explicit = loadIdentity({ file: f, username: 'alice', employeeId: 'E999', host: '192.168.1.5', port: 3001 });
  assert.equal(explicit.employeeId, 'E999');
});

test('缺 username 时回退系统用户名', () => {
  const f = tmpFile();
  const id = loadIdentity({ file: f, host: '127.0.0.1', port: 3001 });
  assert.ok(id.username.length > 0);
});
