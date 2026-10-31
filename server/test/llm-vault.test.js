import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVault } from '../llm-vault.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfvault-')), 'llm.vault.json'); }

test('init/unlock/lock 往返，数据可读写', () => {
  const file = tmpFile();
  const v = createVault({ file });
  assert.deepEqual(v.status(), { initialized: false, unlocked: false });
  v.init('pw1');
  assert.equal(v.status().unlocked, true);
  assert.equal(v.getData().enabled, true);
  v.update((d) => { d.jwtSecret = 'S'; d.tokens = [{ id: 'a' }]; });
  v.lock();
  assert.equal(v.status().unlocked, false);
  assert.throws(() => v.getData(), (e) => e.code === 'locked');
  v.unlock('pw1');
  assert.equal(v.getData().jwtSecret, 'S');
  assert.equal(v.getData().tokens.length, 1);
});

test('错口令解锁失败', () => {
  const file = tmpFile();
  const v = createVault({ file });
  v.init('right');
  v.lock();
  assert.throws(() => v.unlock('wrong'), (e) => e.code === 'bad-passphrase');
});

test('密文被篡改则解锁失败', () => {
  const file = tmpFile();
  const v = createVault({ file });
  v.init('pw');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ct = Buffer.from(raw.data.ct, 'base64');
  ct[0] ^= 0xff;
  raw.data.ct = ct.toString('base64');
  fs.writeFileSync(file, JSON.stringify(raw));
  const v2 = createVault({ file });
  assert.throws(() => v2.unlock('pw'), (e) => e.code === 'bad-passphrase');
});

test('改口令后旧口令失效、新口令可解锁', () => {
  const file = tmpFile();
  const v = createVault({ file });
  v.init('old');
  v.update((d) => { d.jwtSecret = 'K'; });
  v.changePassphrase('old', 'new');
  v.lock();
  assert.throws(() => v.unlock('old'), (e) => e.code === 'bad-passphrase');
  v.unlock('new');
  assert.equal(v.getData().jwtSecret, 'K');
});

test('reset 删除密钥库文件并回到未初始化，可重新初始化', () => {
  const file = tmpFile();
  const v = createVault({ file });
  v.init('pw');
  v.update((d) => { d.jwtSecret = 'S'; d.tokens = [{ id: 'a' }]; });
  assert.equal(fs.existsSync(file), true);
  assert.deepEqual(v.reset(), { initialized: false, unlocked: false });
  assert.equal(fs.existsSync(file), false);
  assert.equal(v.status().initialized, false);
  assert.throws(() => v.getData(), (e) => e.code === 'locked');
  v.init('pw2');
  assert.equal(v.status().unlocked, true);
});
