import fs from 'node:fs';
import path from 'node:path';

export function emptyPeers() {
  return { updatedAt: 0, peers: {}, daily: {} };
}

export const DAILY_KEEP_DAYS = 30;

// 本地日期键 YYYY-MM-DD（按上报方的机器本地时间「每天」归档）
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// master 侧上报库：每台机器只留最新一份（按 machineId upsert）
export class UsagePeersStore {
  constructor({ file, logger = console }) {
    this.file = file;
    this.log = logger;
    this.data = this._load();
  }

  _load() {
    if (!this.file || !fs.existsSync(this.file)) return emptyPeers();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const peers = raw && typeof raw.peers === 'object' && raw.peers ? raw.peers : {};
      const daily = raw && typeof raw.daily === 'object' && raw.daily ? raw.daily : {};
      return { updatedAt: Number(raw && raw.updatedAt) || 0, peers, daily };
    } catch (e) {
      this.log?.warn?.('usage-peers load failed', (e && e.message) || e);
      return emptyPeers();
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      this.log?.warn?.('usage-peers save failed', (e && e.message) || e);
    }
    return this.data;
  }

  upsert(usage, now = Date.now()) {
    const machineId = String((usage && usage.machineId) || '');
    if (!machineId) return null;
    const rec = { ...usage, machineId, receivedAt: now };
    this.data.peers[machineId] = rec;
    // 每天一条归档：同一天覆盖，只保留最近 30 天
    const day = dayKey(now);
    const byDay = this.data.daily[machineId] || (this.data.daily[machineId] = {});
    byDay[day] = { ...usage, machineId, at: now };
    const keys = Object.keys(byDay).sort();
    while (keys.length > DAILY_KEEP_DAYS) delete byDay[keys.shift()];
    this.data.updatedAt = now;
    this.save();
    return rec;
  }

  list() { return this.data.peers; }
  get(machineId) { return this.data.peers[machineId] || null; }
  // 某台机器的每日留存（无参时返回全部机器）
  listDaily(machineId) {
    if (machineId) return this.data.daily[machineId] || {};
    return this.data.daily;
  }
  snapshot() { return { updatedAt: this.data.updatedAt, peers: this.data.peers }; }
}
