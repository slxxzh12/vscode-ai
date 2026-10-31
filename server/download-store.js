import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 下载索引（SQLite，替代 downloads/manifest.json）：只存元数据；
// 打包产物 zip 本身仍落在 downloads 目录，元数据一律进 void.db。
export function createDownloadStore({ file, logger = console } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS download (
    name TEXT PRIMARY KEY,
    kind TEXT,
    size INTEGER,
    sha256 TEXT,
    updated_at INTEGER
  )`);
  const upsertStmt = db.prepare(`INSERT INTO download (name, kind, size, sha256, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, size = excluded.size,
      sha256 = excluded.sha256, updated_at = excluded.updated_at`);
  const listStmt = db.prepare('SELECT name, kind, size, sha256, updated_at FROM download ORDER BY updated_at DESC');
  const getStmt = db.prepare('SELECT name, kind, size, sha256, updated_at FROM download WHERE name = ?');
  const delStmt = db.prepare('DELETE FROM download WHERE name = ?');
  const clearStmt = db.prepare('DELETE FROM download');

  const toFile = (r) => (r ? {
    name: r.name,
    kind: r.kind || 'file',
    size: Number(r.size) || 0,
    sha256: r.sha256 || '',
    updatedAt: Number(r.updated_at) || 0,
  } : null);
  function list() { return listStmt.all().map(toFile); }
  function get(name) { return toFile(getStmt.get(String(name))); }
  function upsert(f) {
    if (!f || !f.name) return null;
    try {
      upsertStmt.run(String(f.name), String(f.kind || 'file'), Number(f.size) || 0, String(f.sha256 || ''), Number(f.updatedAt) || Date.now());
    } catch (e) {
      logger?.warn?.('download upsert failed', (e && e.message) || e);
      return null;
    }
    return get(f.name);
  }
  return {
    list,
    get,
    upsert,
    remove(name) { try { delStmt.run(String(name)); } catch { /* ignore */ } },
    replaceAll(files) {
      try { clearStmt.run(); } catch { /* ignore */ }
      for (const f of files || []) upsert(f);
    },
    readManifest() {
      const files = list();
      const updatedAt = files.reduce((m, f) => Math.max(m, f.updatedAt || 0), 0);
      return { version: 1, updatedAt, files };
    },
    close() { try { db.close(); } catch { /* ignore */ } },
  };
}
