import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 种子表：记录每次「打包分发」产出的 zip（技能/命令/Agent/工作流），供查询与后续发布
export function createSeedStore({ file, logger = console } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS seed (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    hash TEXT,
    size INTEGER,
    count INTEGER,
    skills TEXT,
    command TEXT,
    agent TEXT,
    workflow TEXT,
    group_id TEXT,
    sent INTEGER DEFAULT 0,
    created_at INTEGER
  )`);
  const insert = db.prepare(`INSERT INTO seed (id, file_name, hash, size, count, skills, command, agent, workflow, group_id, sent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const listStmt = db.prepare('SELECT * FROM seed ORDER BY created_at DESC LIMIT ?');
  const getStmt = db.prepare('SELECT * FROM seed WHERE id = ?');
  const setSent = db.prepare('UPDATE seed SET sent = 1, group_id = ? WHERE id = ?');
  const j = (v) => JSON.stringify(v || []);
  const p = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };
  const row = (r) => (r ? {
    id: r.id, fileName: r.file_name, hash: r.hash, size: r.size, count: r.count,
    skills: p(r.skills), command: p(r.command), agent: p(r.agent), workflow: p(r.workflow),
    groupId: r.group_id, sent: !!r.sent, createdAt: r.created_at,
  } : null);
  return {
    add(rec) {
      try {
        insert.run(
          String(rec.id), String(rec.fileName), String(rec.hash || ''), Number(rec.size) || 0, Number(rec.count) || 0,
          j(rec.skills), j(rec.command), j(rec.agent), j(rec.workflow), rec.groupId || null, rec.sent ? 1 : 0, Number(rec.createdAt) || Date.now(),
        );
      } catch (e) { logger?.warn?.('seed insert failed', (e && e.message) || e); }
      return rec;
    },
    list(limit = 50) { return listStmt.all(limit).map(row); },
    get(id) { return row(getStmt.get(String(id))); },
    markSent(id, groupId) { try { setSent.run(groupId || null, String(id)); } catch { /* ignore */ } },
    close() { try { db.close(); } catch { /* ignore */ } },
  };
}
