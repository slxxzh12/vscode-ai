import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const METRICS = ['sessions', 'messages', 'input', 'output', 'days', 'cost', 'cacheRead', 'cacheWrite'];
const ALL = ['date', 'memberId', 'agent', 'source', ...METRICS, 'receivedAt'];

// 列名：JS 侧 camelCase（API/前端契约不变），SQL 侧 snake_case
const COL = {
  date: 'date', memberId: 'member_id', agent: 'agent', source: 'source',
  sessions: 'sessions', messages: 'messages', input: 'input', output: 'output', days: 'days',
  cost: 'cost', cacheRead: 'cache_read', cacheWrite: 'cache_write', receivedAt: 'received_at',
};
const COLS = ALL.map((k) => COL[k]);
const UPDATES = ['source', ...METRICS, 'receivedAt'].map((k) => `${COL[k]}=excluded.${COL[k]}`).join(', ');

// 采集来源：'auto'（命令采集）| 'image'（图片识别采集）
export const SOURCE_AUTO = 'auto';
export const SOURCE_IMAGE = 'image';

// 「一台机器一天一条」的合计行用该 agent 哨兵（原 peer_daily 的行）
export const AGENT_TOTAL = '*';
// 趋势图的默认查询窗口：不删数据，只是只读最近这些天
export const DAILY_WINDOW_DAYS = 30;

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

// 老库结构迁移：usage 曾是 (date, memberId, agent) camelCase 主键 → 改成 (member_id, date, agent)
function migrateLegacyUsage(db, logger) {
  if (!tableExists(db, 'usage')) return;
  const cols = db.prepare('PRAGMA table_info(usage)').all().map((c) => c.name);
  if (!cols.includes('memberId')) return;
  db.exec('ALTER TABLE usage RENAME TO usage_legacy');
  logger?.info?.('usage table migrated to snake_case schema');
}

// 老 peer_daily 表并入 usage：agent = AGENT_TOTAL 的合计行
function migratePeerDaily(db, insert, logger) {
  if (!tableExists(db, 'peer_daily')) return;
  const rows = db.prepare('SELECT * FROM peer_daily').all();
  for (const r of rows) {
    insert.run(
      r.day, r.machine_id, AGENT_TOTAL, SOURCE_AUTO,
      r.sessions ?? null, r.messages ?? null, r.input ?? null, r.output ?? null, r.days ?? null,
      r.cost ?? null, r.cache_read ?? null, r.cache_write ?? null, r.at ?? null,
    );
  }
  db.exec('DROP TABLE peer_daily');
  if (rows.length) logger?.info?.(`peer_daily merged into usage: ${rows.length} rows`);
}

export function createUsageStore({ file, logger = console } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  migrateLegacyUsage(db, logger);
  db.exec(`CREATE TABLE IF NOT EXISTS usage (
    member_id TEXT NOT NULL,
    date TEXT NOT NULL,
    agent TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto',
    sessions INTEGER,
    messages INTEGER,
    input INTEGER,
    output INTEGER,
    days INTEGER,
    cost REAL,
    cache_read INTEGER,
    cache_write INTEGER,
    received_at INTEGER,
    PRIMARY KEY (member_id, date, agent)
  )`);
  // 老库补 source 列（图片识别采集来源标记）
  if (!db.prepare('PRAGMA table_info(usage)').all().some((c) => c.name === 'source')) {
    db.exec(`ALTER TABLE usage ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'`);
  }
  const insert = db.prepare(
    `INSERT INTO usage (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})
     ON CONFLICT(member_id,date,agent) DO UPDATE SET ${UPDATES}`,
  );
  // 老 camelCase 表的数据按新结构搬回（列名逐一对应，主键顺序无关）
  if (tableExists(db, 'usage_legacy')) {
    const legacy = db.prepare('SELECT * FROM usage_legacy').all();
    for (const r of legacy) {
      insert.run(
        r.date, r.memberId, r.agent || '', SOURCE_AUTO,
        r.sessions ?? null, r.messages ?? null, r.input ?? null, r.output ?? null, r.days ?? null,
        r.cost ?? null, r.cacheRead ?? null, r.cacheWrite ?? null, r.receivedAt ?? null,
      );
    }
    db.exec('DROP TABLE usage_legacy');
    if (legacy.length) logger?.info?.(`usage_legacy merged: ${legacy.length} rows`);
  }
  migratePeerDaily(db, insert, logger);

  const put = (r) => insert.run(
    r.date, r.memberId, r.agent, r.source ?? SOURCE_AUTO,
    r.sessions ?? null, r.messages ?? null, r.input ?? null, r.output ?? null, r.days ?? null,
    r.cost ?? null, r.cacheRead ?? null, r.cacheWrite ?? null, r.receivedAt ?? null,
  );
  const toRow = (r) => {
    const out = {};
    for (const k of ALL) out[k] = r[COL[k]];
    return out;
  };
  const dailyRow = (r) => ({
    machineId: r.member_id, sessions: r.sessions, days: r.days, messages: r.messages,
    input: r.input, output: r.output, totalCost: r.cost,
    cacheRead: r.cache_read, cacheWrite: r.cache_write, at: r.received_at,
    source: r.source ?? SOURCE_AUTO,
  });
  const dailyOne = db.prepare(`SELECT * FROM usage WHERE member_id = ? AND agent = ? ORDER BY date DESC LIMIT ?`);
  const dailyAll = db.prepare(`SELECT * FROM usage WHERE agent = ? ORDER BY member_id, date`);

  return {
    // 单表两种粒度：agent = AGENT_TOTAL 为该机器当天合计（原 peer_daily），否则为该 agent 的明细
    upsert(rec) {
      put({ ...rec, agent: rec.agent ?? '' });
    },
    upsertDaily(machineId, day, usage = {}, at = Date.now()) {
      put({
        date: day, memberId: String(machineId), agent: AGENT_TOTAL,
        sessions: usage.sessions, messages: usage.messages, input: usage.input, output: usage.output,
        days: usage.days, cost: usage.totalCost, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
        source: usage.source ?? SOURCE_AUTO, receivedAt: at,
      });
    },
    query({ from, to, memberId, agent } = {}) {
      const where = [];
      const args = [];
      if (from) { where.push('date >= ?'); args.push(from); }
      if (to) { where.push('date <= ?'); args.push(to); }
      if (memberId) { where.push('member_id = ?'); args.push(memberId); }
      // 不带 agent 时不返回合计行（/api/usage 只要 agent 明细，行为与合并前一致）
      if (agent) { where.push('agent = ?'); args.push(agent); }
      else { where.push('agent <> ?'); args.push(AGENT_TOTAL); }
      const sql = `SELECT ${COLS.join(',')} FROM usage${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, member_id, agent`;
      return db.prepare(sql).all(...args).map(toRow);
    },
    // 某台机器的每日合计（无参时返回全部机器），只取最近 days 天
    listDaily(machineId, days = DAILY_WINDOW_DAYS) {
      const limit = Number(days) > 0 ? Number(days) : DAILY_WINDOW_DAYS;
      const out = {};
      if (machineId) {
        for (const r of dailyOne.all(String(machineId), AGENT_TOTAL, limit).reverse()) out[r.date] = dailyRow(r);
        return out;
      }
      for (const r of dailyAll.all(AGENT_TOTAL)) (out[r.member_id] = out[r.member_id] || {})[r.date] = dailyRow(r);
      // 每台机器单独裁剪到最近 limit 天（查询已按 date 升序）
      for (const map of Object.values(out)) {
        const keys = Object.keys(map).sort();
        if (keys.length > limit) for (const k of keys.slice(0, keys.length - limit)) delete map[k];
      }
      return out;
    },
    close() { try { db.close(); } catch { /* ignore */ } },
    db,
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
  const source = body.source === SOURCE_IMAGE ? SOURCE_IMAGE : SOURCE_AUTO;
  return {
    record: {
      date, memberId, agent: String(body.agent || ''), source,
      sessions: num(body.sessions, true), messages: num(body.messages, true),
      input: num(body.input, true), output: num(body.output, true), days: num(body.days, true),
      cost: num(body.cost, false), cacheRead: num(body.cacheRead, true), cacheWrite: num(body.cacheWrite, true),
      receivedAt: now,
    },
  };
}
