import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadIdentity } from '../collaboration/identity.js';
import { saveInvite, clearInvite } from '../remote-invite.js';

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

test('开关 master 模式（邀请落盘/清除）不重置公钥/私钥与 machineId', () => {
  const idFile = tmpFile();
  const inviteFile = path.join(path.dirname(idFile), 'invite.json');
  const before = loadIdentity({ file: idFile, host: '127.0.0.1', port: 3001 });

  saveInvite(inviteFile, { token: 'tk', password: 'pw', expiresAt: 0 });   // 开启
  const opened = loadIdentity({ file: idFile, host: '0.0.0.0', port: 3001 });
  assert.equal(opened.machineId, before.machineId);
  assert.equal(opened.publicKey, before.publicKey);
  assert.equal(opened.privateKey, before.privateKey);

  clearInvite(inviteFile);                                                // 关闭
  const closed = loadIdentity({ file: idFile, host: '127.0.0.1', port: 3001 });
  assert.equal(closed.machineId, before.machineId);
  assert.equal(closed.publicKey, before.publicKey);
  assert.equal(closed.privateKey, before.privateKey);
});

test('keyFile 让不同端口复用同一 machineId/公私钥（端口各自保留 host/port）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-id-'));
  const keyFile = path.join(dir, 'identity.json');
  const a = loadIdentity({ file: path.join(dir, 'ports', '111', 'identity.json'), keyFile, host: '127.0.0.1', port: 111 });
  const b = loadIdentity({ file: path.join(dir, 'ports', '222', 'identity.json'), keyFile, host: '127.0.0.1', port: 222 });
  assert.equal(b.machineId, a.machineId);
  assert.equal(b.publicKey, a.publicKey);
  assert.equal(b.privateKey, a.privateKey);
  assert.equal(a.port, 111);
  assert.equal(b.port, 222);
});

test('旧实例（端口文件已有密钥）首次启动回填 keyFile，实现一次性迁移', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-id-'));
  const keyFile = path.join(dir, 'identity.json');
  const legacy = loadIdentity({ file: path.join(dir, 'ports', '22222', 'identity.json'), host: '127.0.0.1', port: 22222 });
  assert.equal(fs.existsSync(keyFile), false);
  const again = loadIdentity({ file: path.join(dir, 'ports', '22222', 'identity.json'), keyFile, host: '0.0.0.0', port: 22222 });
  assert.equal(again.publicKey, legacy.publicKey);
  const seeded = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  assert.equal(seeded.publicKey, legacy.publicKey);
  const other = loadIdentity({ file: path.join(dir, 'ports', '33333', 'identity.json'), keyFile, host: '127.0.0.1', port: 33333 });
  assert.equal(other.machineId, legacy.machineId);
  assert.equal(other.publicKey, legacy.publicKey);
});

test('已有 keyFile 不被端口自有身份覆盖', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-id-'));
  const keyFile = path.join(dir, 'identity.json');
  const first = loadIdentity({ file: path.join(dir, 'ports', '1', 'identity.json'), keyFile, host: '127.0.0.1', port: 1 });
  const own = loadIdentity({ file: path.join(dir, 'ports', '2', 'identity.json'), host: '127.0.0.1', port: 2 });
  assert.notEqual(own.publicKey, first.publicKey);
  const port2 = loadIdentity({ file: path.join(dir, 'ports', '2', 'identity.json'), keyFile, host: '127.0.0.1', port: 2 });
  assert.equal(port2.publicKey, own.publicKey);
  const seeded = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  assert.equal(seeded.publicKey, first.publicKey);
  const fresh = loadIdentity({ file: path.join(dir, 'ports', '3', 'identity.json'), keyFile, host: '127.0.0.1', port: 3 });
  assert.equal(fresh.publicKey, first.publicKey);
});
