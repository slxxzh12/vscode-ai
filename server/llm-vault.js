import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const KDF = { name: 'scrypt', N: 32768, r: 8, p: 1 };
const MAXMEM = 64 * 1024 * 1024;

function b64(buf) { return Buffer.from(buf).toString('base64'); }
function unb64(s) { return Buffer.from(s, 'base64'); }
function deriveKek(passphrase, salt) {
  return crypto.scryptSync(Buffer.from(passphrase, 'utf8'), salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: MAXMEM });
}
function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv: b64(iv), tag: b64(c.getAuthTag()), ct: b64(ct) };
}
function decrypt(key, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, unb64(box.iv));
  d.setAuthTag(unb64(box.tag));
  return Buffer.concat([d.update(unb64(box.ct)), d.final()]);
}
function vaultErr(code, message) { const e = new Error(message || code); e.code = code; return e; }

export function createVault({ file }) {
  let dek = null;
  let data = null;
  function read() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
  function write(obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, file);
  }
  function persist() { const raw = read(); raw.data = encrypt(dek, Buffer.from(JSON.stringify(data), 'utf8')); write(raw); }
  const api = {
    status() { const raw = read(); return { initialized: !!raw, unlocked: !!dek }; },
    init(passphrase) {
      if (read()) throw vaultErr('exists', 'vault already initialized');
      const salt = crypto.randomBytes(16);
      const kek = deriveKek(passphrase, salt);
      dek = crypto.randomBytes(32);
      data = { enabled: true, jwtSecret: '', tokens: [] };
      const raw = { v: 1, salt: b64(salt), kdf: { ...KDF }, wrappedDek: encrypt(kek, dek), data: null };
      raw.data = encrypt(dek, Buffer.from(JSON.stringify(data), 'utf8'));
      write(raw);
      return api.status();
    },
    unlock(passphrase) {
      const raw = read();
      if (!raw) throw vaultErr('not-init', 'vault not initialized');
      let dekBuf;
      try { dekBuf = decrypt(deriveKek(passphrase, unb64(raw.salt)), raw.wrappedDek); }
      catch { throw vaultErr('bad-passphrase', 'bad passphrase'); }
      try { data = JSON.parse(decrypt(dekBuf, raw.data).toString('utf8')); }
      catch { throw vaultErr('bad-passphrase', 'bad passphrase'); }
      dek = dekBuf;
      return api.status();
    },
    lock() { dek = null; data = null; return api.status(); },
    reset() {
      try { fs.unlinkSync(file); } catch { /* already gone */ }
      try { fs.unlinkSync(file + '.tmp'); } catch { /* ignore */ }
      dek = null; data = null;
      return api.status();
    },
    getData() { if (!data) throw vaultErr('locked', 'vault locked'); return data; },
    update(fn) { if (!data) throw vaultErr('locked', 'vault locked'); fn(data); persist(); return data; },
    changePassphrase(oldP, newP) {
      const raw = read();
      if (!raw) throw vaultErr('not-init', 'vault not initialized');
      let dekBuf;
      try { dekBuf = decrypt(deriveKek(oldP, unb64(raw.salt)), raw.wrappedDek); }
      catch { throw vaultErr('bad-passphrase', 'bad passphrase'); }
      const salt = crypto.randomBytes(16);
      raw.salt = b64(salt);
      raw.wrappedDek = encrypt(deriveKek(newP, salt), dekBuf);
      write(raw);
      if (dek) dek = dekBuf;
      return api.status();
    },
  };
  return api;
}
