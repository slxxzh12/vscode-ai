import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DAILY_KEEP_DAYS = 30;

export function emptyPeers() {
  return { updatedAt: 0, peers: {} };
}

// 本地日期键 YYYY-MM-DD（按上报方的机器本地时间「每天」归档）
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAILY_COLS = {
  sessions: 'sessions', days: 'days', messages: 'messages', input: 'input', output: 'output',
  totalCost: 'cost', cacheRead: 'cache_read', cacheWrite: 'cache_write',
};

function openDailyDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS peer_daily (
    machine_id TEXT NOT NULL,
    day TEXT NOT NULL,
    sessions INTEGER, days INTEGER, messages INTEGER, input INTEGER, output INTEGER,
    cost REAL, cache_read INTEGER, cache_write INTEGER,
    at INTEGER,
    PRIMARY KEY (machine_id, day)
  )`);
  return db;
}

// master 侧上报库：最新一份快照存 JSON；「每台每天一条」的历史存 SQLite（peer_daily）
export class UsagePeersStore {
  constructor({ file, dailyFile, logger = console } = {}) {
    this.file = file;
    this.log = logger;
    this.data = this._load();
    this.dailyFile = dailyFile || (file ? file.replace(/\.json$/, '.db') : null);
    try {
      this.db = this.dailyFile ? openDailyDb(this.dailyFile) : null;
    } catch (e) {
      this.log?.warn?.('peer_daily open failed', (e && e.message) || e);
      this.db = null;
    }
    this._migrateLegacyDaily();
  }

  _load() {
    if (!this.file || !fs.existsSync(this.file)) return emptyPeers();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const peers = raw && typeof raw.peers === 'object' && raw.peers ? raw.peers : {};
      return { updatedAt: Number(raw && raw.updatedAt) || 0, peers, legacyDaily: raw && raw.daily };
    } catch (e) {
      this.log?.warn?.('usage-peers load failed', (e && e.message) || e);
      return emptyPeers();
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ updatedAt: this.data.updatedAt, peers: this.data.peers }, null, 2), 'utf8');
    } catch (e) {
      this.log?.warn?.('usage-peers save failed', (e && e.message) || e);
    }
    return this.data;
  }

  // 老版本把每日留存写在 JSON 里：一次性搬进 SQLite，之后 JSON 只留快照
  _migrateLegacyDaily() {
    const legacy = this.data.legacyDaily;
    delete this.data.legacyDaily;
    if (!this.db || !legacy || typeof legacy !== 'object') return;
    let moved = 0;
    for (const [machineId, days] of Object.entries(legacy)) {
      for (const [day, rec] of Object.entries(days || {})) {
        this._insertDaily(machineId, day, rec || {}, Number(rec && rec.at) || Date.now());
        moved += 1;
      }
    }
    if (moved) {
      this.log?.info?.(`peer_daily migrated ${moved} rows from json`);
      this.data.legacyDaily = undefined;
      this.save();
    }
  }

  _insertDaily(machineId, day, usage, at) {
    if (!this.db) return;
    const cols = ['machine_id', 'day', ...Object.values(DAILY_COLS), 'at'];
    const vals = [machineId, day,
      usage.sessions ?? null, usage.days ?? null, usage.messages ?? null, usage.input ?? null, usage.output ?? null,
      usage.totalCost ?? null, usage.cacheRead ?? null, usage.cacheWrite ?? null, at];
    const placeholders = cols.map(() => '?').join(',');
    const updates = [...Object.values(DAILY_COLS), 'at'].map((c) => `${c}=excluded.${c}`).join(', ');
    this.db.prepare(`INSERT INTO peer_daily (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(machine_id,day) DO UPDATE SET ${updates}`).run(...vals);
  }

  // 每台机器只保留最近 DAILY_KEEP_DAYS 天
  _pruneDaily(machineId) {
    if (!this.db) return;
    const cutoff = this.db.prepare('SELECT day FROM peer_daily WHERE machine_id = ? ORDER BY day DESC LIMIT 1 OFFSET ?')
      .get(machineId, DAILY_KEEP_DAYS - 1);
    if (cutoff && cutoff.day) this.db.prepare('DELETE FROM peer_daily WHERE machine_id = ? AND day < ?').run(machineId, cutoff.day);
  }

  upsert(usage, now = Date.now()) {
    const machineId = String((usage && usage.machineId) || '');
    if (!machineId) return null;
    const rec = { ...usage, machineId, receivedAt: now };
    this.data.peers[machineId] = rec;
    if (this.db) {
      this._insertDaily(machineId, dayKey(now), usage, now);
      this._pruneDaily(machineId);
    }
    this.data.updatedAt = now;
    this.save();
    return rec;
  }

  list() { return this.data.peers; }
  get(machineId) { return this.data.peers[machineId] || null; }

  _dailyRow(r) {
    return {
      machineId: r.machine_id, sessions: r.sessions, days: r.days, messages: r.messages,
      input: r.input, output: r.output, totalCost: r.cost, cacheRead: r.cache_read, cacheWrite: r.cache_write, at: r.at,
    };
  }

  // 某台机器的每日留存（无参时返回全部机器）
  listDaily(machineId) {
    if (!this.db) return machineId ? {} : {};
    if (machineId) {
      const out = {};
      for (const r of this.db.prepare('SELECT * FROM peer_daily WHERE machine_id = ? ORDER BY day').all(String(machineId))) out[r.day] = this._dailyRow(r);
      return out;
    }
    const all = {};
    for (const r of this.db.prepare('SELECT * FROM peer_daily ORDER BY machine_id, day').all()) {
      (all[r.machine_id] = all[r.machine_id] || {})[r.day] = this._dailyRow(r);
    }
    return all;
  }

  snapshot() { return { updatedAt: this.data.updatedAt, peers: this.data.peers }; }
  close() { try { this.db?.close(); } catch { /* ignore */ } this.db = null; }
}
