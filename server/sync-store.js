import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 同步种子（SQLite，替代 downloads/update.json）与各 master 的同步记录（替代 sync/<masterId>.json）。
export function createSyncStore({ file, logger = console } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS sync_update (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version TEXT,
    updated_at INTEGER,
    files TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS sync_record (
    master_id TEXT PRIMARY KEY,
    version TEXT,
    action TEXT,
    checked_at INTEGER,
    data TEXT
  )`);
  const getUpdateStmt = db.prepare('SELECT version, updated_at, files FROM sync_update WHERE id = 1');
  const putUpdateStmt = db.prepare(`INSERT INTO sync_update (id, version, updated_at, files) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, files = excluded.files`);
  const getRecordStmt = db.prepare('SELECT data FROM sync_record WHERE master_id = ?');
  const putRecordStmt = db.prepare(`INSERT INTO sync_record (master_id, version, action, checked_at, data)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(master_id) DO UPDATE SET version = excluded.version, action = excluded.action,
      checked_at = excluded.checked_at, data = excluded.data`);

  const parse = (s, fallback) => {
    try { const v = JSON.parse(s); return v == null ? fallback : v; } catch { return fallback; }
  };
  return {
    readUpdate() {
      const r = getUpdateStmt.get();
      if (!r) return { version: '', updatedAt: 0, files: [] };
      return { version: r.version || '', updatedAt: Number(r.updated_at) || 0, files: parse(r.files, []) };
    },
    writeUpdate(update) {
      const u = update || {};
      try {
        putUpdateStmt.run(String(u.version || ''), Number(u.updatedAt) || 0, JSON.stringify(Array.isArray(u.files) ? u.files : []));
      } catch (e) { logger?.warn?.('sync update write failed', (e && e.message) || e); }
      return u;
    },
    readRecord(masterId) {
      const r = getRecordStmt.get(String(masterId || ''));
      return r ? parse(r.data, null) : null;
    },
    writeRecord(masterId, record) {
      const rec = record || {};
      try {
        putRecordStmt.run(
          String(masterId || ''), String(rec.version || ''), String(rec.action || ''),
          Number(rec.checkedAt) || 0, JSON.stringify(rec),
        );
      } catch (e) { logger?.warn?.('sync record write failed', (e && e.message) || e); }
      return rec;
    },
    close() { try { db.close(); } catch { /* ignore */ } },
  };
}
