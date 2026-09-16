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
  // 增量列：skill / workflow 的更新时间，以及「里面有哪些东西」的明细
  for (const col of ['skills_updated_at INTEGER', 'workflow_updated_at INTEGER', 'detail TEXT']) {
    try { db.exec(`ALTER TABLE seed ADD COLUMN ${col}`); } catch { /* 已存在 */ }
  }
  const insert = db.prepare(`INSERT INTO seed (id, file_name, hash, size, count, skills, command, agent, workflow,
    group_id, sent, created_at, skills_updated_at, workflow_updated_at, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const listStmt = db.prepare('SELECT * FROM seed ORDER BY created_at DESC LIMIT ?');
  const getStmt = db.prepare('SELECT * FROM seed WHERE id = ?');
  const setSent = db.prepare('UPDATE seed SET sent = 1, group_id = ? WHERE id = ?');
  const j = (v) => JSON.stringify(v || []);
  const p = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };
  const row = (r) => (r ? {
    id: r.id, fileName: r.file_name, hash: r.hash, size: r.size, count: r.count,
    skills: p(r.skills), command: p(r.command), agent: p(r.agent), workflow: p(r.workflow),
    groupId: r.group_id, sent: !!r.sent, createdAt: r.created_at,
    skillsUpdatedAt: r.skills_updated_at || 0, workflowUpdatedAt: r.workflow_updated_at || 0,
    detail: (() => { try { return JSON.parse(r.detail || '{}'); } catch { return {}; } })(),
  } : null);
  return {
    add(rec) {
      try {
        insert.run(
          String(rec.id), String(rec.fileName), String(rec.hash || ''), Number(rec.size) || 0, Number(rec.count) || 0,
          j(rec.skills), j(rec.command), j(rec.agent), j(rec.workflow), rec.groupId || null, rec.sent ? 1 : 0, Number(rec.createdAt) || Date.now(),
          Number(rec.skillsUpdatedAt) || 0, Number(rec.workflowUpdatedAt) || 0, JSON.stringify(rec.detail || {}),
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
