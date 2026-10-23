import fs from 'node:fs';
import path from 'node:path';
import { createNavicatCrypto } from '../../navicat-crypto.js';

export function createQueueConfig({ dir, crypto = null } = {}) {
  const file = path.join(dir, 'queue.json');
  const box = crypto || createNavicatCrypto({ keyFile: path.join(dir, '.queue.key') });

  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }
  function write(data) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }
  function get() {
    const raw = read() || {};
    const mysql = raw.mysql || null;
    return {
      backend: mysql && mysql.host && mysql.database ? 'mysql' : 'sqlite',
      mysql: mysql ? {
        host: String(mysql.host || ''),
        port: Number(mysql.port) || 3306,
        user: String(mysql.user || ''),
        database: String(mysql.database || ''),
        secret: mysql.secret || null,
      } : null,
    };
  }
  function publicConfig() {
    const c = get();
    return {
      backend: c.backend,
      host: c.mysql?.host || '',
      port: c.mysql?.port || 3306,
      user: c.mysql?.user || '',
      database: c.mysql?.database || '',
      hasPassword: !!c.mysql?.secret,
    };
  }
  function save(input = {}) {
    const host = String(input.host || '').trim();
    const database = String(input.database || '').trim();
    if (!host || !database) return { error: 'host/database required' };
    const prev = get();
    const password = input.password === undefined ? null : String(input.password);
    const secret = password === null ? (prev.mysql?.secret || null) : (password ? box.seal(password) : null);
    write({ mysql: { host, port: Number(input.port) || 3306, user: String(input.user || ''), database, secret } });
    return { ok: true, config: publicConfig() };
  }
  function clear() { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } }
  function openPassword() {
    const c = get();
    return c.mysql?.secret ? box.open(c.mysql.secret) : '';
  }
  function syncConfig() {
    const c = get();
    if (c.backend !== 'mysql') return null;
    return {
      host: c.mysql.host, port: c.mysql.port, user: c.mysql.user,
      database: c.mysql.database, password: openPassword(),
    };
  }
  return { file, get, publicConfig, save, clear, openPassword, syncConfig };
}
