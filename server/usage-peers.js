import fs from 'node:fs';
import path from 'node:path';
import { createUsageStore, DAILY_WINDOW_DAYS, SOURCE_IMAGE, SOURCE_AUTO } from './usage-store.js';

// 趋势图读取窗口（数据不删，只限制读多少天）
export const DAILY_KEEP_DAYS = DAILY_WINDOW_DAYS;

export function emptyPeers() {
  return { updatedAt: 0, peers: {} };
}

// 采集失败（opencode 缺失等）时上报体只有 agent/days/error，没有这些指标 → 用它判断这份上报是否可用
const METRIC_KEYS = ['sessions', 'messages', 'input', 'output', 'totalCost', 'cacheRead', 'cacheWrite', 'chatMessages'];

export function hasMetrics(u) {
  return METRIC_KEYS.some((k) => Number.isFinite(u && u[k]));
}

// 本地日期键 YYYY-MM-DD（按上报方的机器本地时间「每天」归档）
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// master 侧上报库：最新一份快照存 JSON；「每台每天一条」的合计行与 agent 明细同表（usage.agent = '*'）
export class UsagePeersStore {
  constructor({ file, dailyFile, usageStore = null, logger = console } = {}) {
    this.file = file;
    this.log = logger;
    this.data = this._load();
    this.dailyFile = dailyFile || (file ? file.replace(/\.json$/, '.db') : null);
    this.ownStore = !usageStore;
    try {
      this.store = usageStore || (this.dailyFile ? createUsageStore({ file: this.dailyFile, logger }) : null);
    } catch (e) {
      this.log?.warn?.('usage daily store open failed', (e && e.message) || e);
      this.store = null;
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

  // 老版本把每日留存写在 JSON 里：一次性搬进 usage 表，之后 JSON 只留快照
  _migrateLegacyDaily() {
    const legacy = this.data.legacyDaily;
    delete this.data.legacyDaily;
    if (!this.store || !legacy || typeof legacy !== 'object') return;
    let moved = 0;
    for (const [machineId, days] of Object.entries(legacy)) {
      for (const [day, rec] of Object.entries(days || {})) {
        this.store.upsertDaily(machineId, day, rec || {}, Number(rec && rec.at) || Date.now());
        moved += 1;
      }
    }
    if (moved) {
      this.log?.info?.(`peer_daily migrated ${moved} rows from json`);
      this.save();
    }
  }

  upsert(usage, now = Date.now()) {
    const machineId = String((usage && usage.machineId) || '');
    if (!machineId) return null;
    const prev = this.data.peers[machineId];
    const prevIsImage = !!prev && prev.source === SOURCE_IMAGE;
    const usageIsImage = (usage && usage.source) === SOURCE_IMAGE;
    // 截图统计优先于命令行统计：image 覆盖 auto；auto 不得覆盖已有 image
    const merged = (prevIsImage && !usageIsImage) ? { ...usage, ...prev } : { ...prev, ...usage };
    // 新上报缺指标时保留上次好数据，避免采集失败把已有数字覆盖成空
    for (const k of METRIC_KEYS) {
      if (!Number.isFinite(usage && usage[k]) && Number.isFinite(prev && prev[k])) merged[k] = prev[k];
    }
    // 采集来源：只要任一来源是图片识别就标记 image（图片识别优先）
    merged.source = (usageIsImage || prevIsImage) ? SOURCE_IMAGE : SOURCE_AUTO;
    // 成功的一轮（带指标）清掉上次残留的采集错误，避免 error 字段一直挂着旧的 ENOENT
    if (hasMetrics(usage)) delete merged.error;
    const rec = { ...merged, machineId, receivedAt: now };
    this.data.peers[machineId] = rec;
    // 合计行与 agent 明细同表（usage），不再单独维护 peer_daily；没指标不写，保护当天已有行
    if (hasMetrics(merged)) this.store?.upsertDaily?.(machineId, dayKey(now), merged, now);
    this.data.updatedAt = now;
    this.save();
    return rec;
  }

  list() { return this.data.peers; }
  get(machineId) { return this.data.peers[machineId] || null; }

  // 某台机器的每日留存（无参时返回全部机器），默认最近 DAILY_KEEP_DAYS 天
  listDaily(machineId, days = DAILY_KEEP_DAYS) {
    return this.store ? this.store.listDaily(machineId, days) : {};
  }

  upsertChatDay(machineId, day, chatMessages) {
    this.store?.upsertChatDay?.(machineId, day, chatMessages);
  }

  // 群主清理：删除指定机器的快照与历史上报行（usage 表按 member_id）
  remove(machineIds) {
    const ids = (Array.isArray(machineIds) ? machineIds : [machineIds])
      .map((x) => String(x || '')).filter(Boolean);
    let n = 0;
    for (const id of ids) {
      if (this.data.peers[id]) { delete this.data.peers[id]; n += 1; }
      try { this.store?.deleteByMember?.(id); } catch (e) { this.log?.warn?.('peer usage delete failed', (e && e.message) || e); }
    }
    if (n) { this.data.updatedAt = Date.now(); this.save(); }
    return n;
  }

  snapshot() { return { updatedAt: this.data.updatedAt, peers: this.data.peers }; }
  close() {
    // 共享的 store 由装配方（index.js）负责关闭
    if (this.ownStore) { try { this.store?.close?.(); } catch { /* ignore */ } }
    this.store = null;
  }
}
