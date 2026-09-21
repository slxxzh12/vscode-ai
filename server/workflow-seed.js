import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function hashWorkflow(w) {
  const norm = {
    id: w.id,
    label: w.label,
    ...(Number.isFinite(Number(w.priority)) && Number(w.priority) ? { priority: Number(w.priority) } : {}),
    stages: (w.stages || []).map((s) => ({ id: s.id, label: s.label, group: s.group || '', prompts: s.prompts || [] })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

// 工作流 hash 目录（SQLite，替代 downloads/workflows.seed.json）：记录每个工作流的 hash 与更新时间。
export function createWorkflowSeedStore({ file, logger = console } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_seed (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER,
    updated_at INTEGER,
    workflows TEXT
  )`);
  const getStmt = db.prepare('SELECT version, updated_at, workflows FROM workflow_seed WHERE id = 1');
  const putStmt = db.prepare(`INSERT INTO workflow_seed (id, version, updated_at, workflows) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, workflows = excluded.workflows`);

  function read() {
    const r = getStmt.get();
    if (!r) return { version: 0, updatedAt: 0, workflows: [] };
    let workflows = [];
    try { const v = JSON.parse(r.workflows); if (Array.isArray(v)) workflows = v; } catch { /* ignore */ }
    return { version: Number(r.version) || 0, updatedAt: Number(r.updated_at) || 0, workflows };
  }
  function write(seed) {
    try {
      putStmt.run(Number(seed.version) || 0, Number(seed.updatedAt) || 0, JSON.stringify(seed.workflows || []));
    } catch (e) { logger?.warn?.('workflow seed write failed', (e && e.message) || e); }
    return seed;
  }
  return {
    read,
    update(workflows, { now = Date.now() } = {}) {
      const prev = read();
      const prevById = new Map((prev.workflows || []).map((w) => [w.id, w]));
      const catalog = (workflows || []).map((w) => {
        const hash = hashWorkflow(w);
        const old = prevById.get(w.id);
        return { id: w.id, label: w.label, hash, updatedAt: old && old.hash === hash ? (old.updatedAt || 0) : now };
      });
      const sig = (list) => JSON.stringify(list.map((w) => [w.id, w.hash]));
      const changed = sig(catalog) !== sig(prev.workflows || []);
      return write({
        version: (prev.version || 0) + (changed ? 1 : 0),
        updatedAt: changed ? now : (prev.updatedAt || 0),
        workflows: catalog,
      });
    },
    close() { try { db.close(); } catch { /* ignore */ } },
  };
}
