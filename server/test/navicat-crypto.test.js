import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNavicatCrypto } from '../navicat-crypto.js';

function tmpKey() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-nvcrypt-')), '.key'); }

test('seal/open：往返得到原文', () => {
  const c = createNavicatCrypto({ keyFile: tmpKey() });
  const box = c.seal('p@ss word');
  assert.equal(box.v, 1);
  assert.equal(c.open(box), 'p@ss word');
});

test('seal：空密码返回 null；open(null) 返回空串', () => {
  const c = createNavicatCrypto({ keyFile: tmpKey() });
  assert.equal(c.seal(''), null);
  assert.equal(c.open(null), '');
});

test('密钥文件首次自动生成，二次实例仍能解开旧密文', () => {
  const keyFile = tmpKey();
  const a = createNavicatCrypto({ keyFile });
  const box = a.seal('secret');
  assert.ok(fs.existsSync(keyFile));
  assert.equal(fs.readFileSync(keyFile).length, 32);
  const b = createNavicatCrypto({ keyFile });
  assert.equal(b.open(box), 'secret');
});

test('open：篡改 tag 抛 bad-secret（认证失败）', () => {
  const c = createNavicatCrypto({ keyFile: tmpKey() });
  const box = c.seal('secret');
  const bad = { ...box, tag: Buffer.from('x'.repeat(16)).toString('base64') };
  assert.throws(() => c.open(bad), (e) => e.code === 'bad-secret');
});

test('open：换密钥后旧密文抛 bad-secret', () => {
  const a = createNavicatCrypto({ keyFile: tmpKey() });
  const box = a.seal('secret');
  const b = createNavicatCrypto({ keyFile: tmpKey() });
  assert.throws(() => b.open(box), (e) => e.code === 'bad-secret');
});
