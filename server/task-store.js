import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 本机任务表：分发通知（kind:'dist'）在成员侧落成的待办；游标表记录「已扫到哪条群消息」
// 与 seed-store.js 同构：同一个 <数据目录>/void.db，自己建自己的表
export function createTaskStore({ file, logger = console } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      hub_id TEXT,
      kind TEXT NOT NULL,
      hash TEXT NOT NULL,
      name TEXT,
      url TEXT,
      payload TEXT,
      status TEXT NOT NULL,
      message_id TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE (group_id, kind, hash)
    );
    CREATE TABLE IF NOT EXISTS task_cursor (
      group_id TEXT PRIMARY KEY,
      last_ts INTEGER,
      last_id TEXT,
      updated_at INTEGER
    );
  `);

  // 冲突时只刷新展示/来源字段：status 原地保留（done / ignored / failed 不会被拉回 pending）
  const upsertStmt = db.prepare(`INSERT INTO task
    (id, group_id, hub_id, kind, hash, name, url, payload, status, message_id, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(group_id, kind, hash) DO UPDATE SET
      hub_id=excluded.hub_id, name=excluded.name, url=excluded.url, payload=excluded.payload,
      message_id=excluded.message_id, updated_at=excluded.updated_at`);
  const findStmt = db.prepare('SELECT * FROM task WHERE group_id = ? AND kind = ? AND hash = ?');
  const getStmt = db.prepare('SELECT * FROM task WHERE id = ?');
  const listStmt = db.prepare('SELECT * FROM task');
  const setStmt = db.prepare('UPDATE task SET status = ?, payload = COALESCE(?, payload), updated_at = ? WHERE id = ?');
  const getCursorStmt = db.prepare('SELECT * FROM task_cursor WHERE group_id = ?');
  const setCursorStmt = db.prepare(`INSERT INTO task_cursor (group_id, last_ts, last_id, updated_at)
    VALUES (?,?,?,?) ON CONFLICT(group_id) DO UPDATE SET last_ts=excluded.last_ts, last_id=excluded.last_id, updated_at=excluded.updated_at`);

  const row = (r) => (r ? {
    id: r.id, groupId: r.group_id, hubId: r.hub_id, kind: r.kind, hash: r.hash,
    name: r.name, url: r.url, payload: (() => { try { return JSON.parse(r.payload || '{}'); } catch { return {}; } })(),
    status: r.status, messageId: r.message_id, createdAt: r.created_at, updatedAt: r.updated_at,
  } : null);
  const cursorRow = (r) => (r ? { groupId: r.group_id, lastTs: r.last_ts || 0, lastId: r.last_id || '', updatedAt: r.updated_at } : null);

  return {
    // 幂等：同 (group,kind,hash) 更新原行；返回 { task, created }
    upsert(rec) {
      const key = [String(rec.groupId), String(rec.kind), String(rec.hash)];
      const before = findStmt.get(...key);
      const id = before ? before.id : String(rec.id);
      try {
        upsertStmt.run(
          id, key[0], rec.hubId || null, key[1], key[2], rec.name || null, rec.url || null,
          JSON.stringify(rec.payload || {}), rec.status || 'pending', rec.messageId || null,
          Number(rec.createdAt) || Date.now(), Number(rec.updatedAt) || Date.now(),
        );
      } catch (e) { logger?.warn?.('task upsert failed', (e && e.message) || e); }
      return { task: row(getStmt.get(id)), created: !before };
    },
    get(id) { return row(getStmt.get(String(id))); },
    list({ status = null, kind = null, groupId = null } = {}) {
      return listStmt.all().map(row)
        .filter((t) => (!status || t.status === status) && (!kind || t.kind === kind) && (!groupId || t.groupId === groupId))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    setStatus(id, status, patch = {}) {
      try {
        setStmt.run(String(status), patch.payload ? JSON.stringify(patch.payload) : null, Date.now(), String(id));
      } catch (e) { logger?.warn?.('task setStatus failed', (e && e.message) || e); }
      return row(getStmt.get(String(id)));
    },
    getCursor(groupId) { return cursorRow(getCursorStmt.get(String(groupId))); },
    advanceCursor(groupId, ts, id) {
      const cur = cursorRow(getCursorStmt.get(String(groupId)));
      const next = Number(ts) || 0;
      if (cur && (cur.lastTs > next || (cur.lastTs === next && cur.lastId === String(id || '')))) return cur;
      try { setCursorStmt.run(String(groupId), next, String(id || ''), Date.now()); } catch { /* ignore */ }
      return cursorRow(getCursorStmt.get(String(groupId)));
    },
    close() { try { db.close(); } catch { /* ignore */ } },
    db,
  };
}
