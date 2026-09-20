import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const KEY_BYTES = 32;

function b64(buf) { return Buffer.from(buf).toString('base64'); }
function unb64(s) { return Buffer.from(s, 'base64'); }

// 机器密钥：随机 32B，首次使用时落盘（数据目录内，不进版本库）
function loadOrCreateKey(keyFile) {
  try {
    const raw = fs.readFileSync(keyFile);
    if (raw.length === KEY_BYTES) return raw;
  } catch { /* 不存在或损坏，重建 */ }
  const key = crypto.randomBytes(KEY_BYTES);
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, key);
  try { fs.chmodSync(keyFile, 0o600); } catch { /* Windows 上尽力而为 */ }
  return key;
}

// 第 1 层加密：本机落盘的密码字段。AES-256-GCM，篡改即解密失败
export function createNavicatCrypto({ keyFile }) {
  let key = null;
  const getKey = () => (key ??= loadOrCreateKey(keyFile));
  return {
    seal(plaintext) {
      if (plaintext === undefined || plaintext === null || plaintext === '') return null;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
      const ct = Buffer.concat([c.update(Buffer.from(String(plaintext), 'utf8')), c.final()]);
      return { v: 1, iv: b64(iv), tag: b64(c.getAuthTag()), ct: b64(ct) };
    },
    open(box) {
      if (!box) return '';
      const e = new Error('bad secret');
      e.code = 'bad-secret';
      try {
        const d = crypto.createDecipheriv('aes-256-gcm', getKey(), unb64(box.iv));
        d.setAuthTag(unb64(box.tag));
        return Buffer.concat([d.update(unb64(box.ct)), d.final()]).toString('utf8');
      } catch { throw e; }
    },
  };
}
