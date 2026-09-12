import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const METRICS = ['sessions', 'messages', 'input', 'output', 'days', 'cost', 'cacheRead', 'cacheWrite'];
const ALL = ['date', 'memberId', 'agent', ...METRICS, 'receivedAt'];

export function createUsageStore({ file }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS usage (
    date TEXT NOT NULL,
    memberId TEXT NOT NULL,
    agent TEXT NOT NULL,
    sessions INTEGER,
    messages INTEGER,
    input INTEGER,
    output INTEGER,
    days INTEGER,
    cost REAL,
    cacheRead INTEGER,
    cacheWrite INTEGER,
    receivedAt INTEGER,
    PRIMARY KEY (date, memberId, agent)
  )`);
  const placeholders = ALL.map(() => '?').join(',');
  const updates = [...METRICS, 'receivedAt'].map((c) => `${c}=excluded.${c}`).join(', ');
  const insert = db.prepare(
    `INSERT INTO usage (${ALL.join(',')}) VALUES (${placeholders}) ON CONFLICT(date,memberId,agent) DO UPDATE SET ${updates}`,
  );
  return {
    upsert(rec) {
      insert.run(
        rec.date, rec.memberId, rec.agent,
        rec.sessions ?? null, rec.messages ?? null, rec.input ?? null, rec.output ?? null, rec.days ?? null,
        rec.cost ?? null, rec.cacheRead ?? null, rec.cacheWrite ?? null, rec.receivedAt ?? null,
      );
    },
    query({ from, to, memberId, agent } = {}) {
      const where = [];
      const args = [];
      if (from) { where.push('date >= ?'); args.push(from); }
      if (to) { where.push('date <= ?'); args.push(to); }
      if (memberId) { where.push('memberId = ?'); args.push(memberId); }
      if (agent) { where.push('agent = ?'); args.push(agent); }
      const sql = `SELECT ${ALL.join(',')} FROM usage${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, memberId, agent`;
      return db.prepare(sql).all(...args).map((r) => ({ ...r }));
    },
    close() { db.close(); },
  };
}

// 归一化上报 body → 记录（或错误码）；date 缺省用 now 当天本地日期
export function normalizeUsage(body = {}, now = Date.now()) {
  const memberId = String(body.memberId || '').trim();
  if (!memberId) return { error: 'bad-input' };
  let date = typeof body.date === 'string' ? body.date.trim() : '';
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'bad-date' };
  if (!date) {
    const d = new Date(now);
    const p = (n) => String(n).padStart(2, '0');
    date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const num = (v, round) => { const n = Number(v); return Number.isFinite(n) ? (round ? Math.round(n) : n) : null; };
  return {
    record: {
      date, memberId, agent: String(body.agent || ''),
      sessions: num(body.sessions, true), messages: num(body.messages, true),
      input: num(body.input, true), output: num(body.output, true), days: num(body.days, true),
      cost: num(body.cost, false), cacheRead: num(body.cacheRead, true), cacheWrite: num(body.cacheWrite, true),
      receivedAt: now,
    },
  };
}
