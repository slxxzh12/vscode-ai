import fs from 'node:fs';
import { collectAgentStats } from './collaboration/agent-stats.js';
import path from 'node:path';

export const MIN_INTERVAL_MS = 60 * 60 * 1000;   // 60 分钟
export const MAX_INTERVAL_MS = 90 * 60 * 1000;   // 90 分钟
const DEFAULT_CONFIG = { masterUrl: '', token: '', days: 7, masterPublicKey: '' };

// 解析 master 的访问链接：http://<host>:<port>/?access=<token>
export function parseInviteLink(link) {
  let u;
  try { u = new URL(String(link || '').trim()); } catch { return { error: 'bad-link' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'bad-link' };
  const token = u.searchParams.get('access') || '';
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (!u.hostname || !port || !token) return { error: 'bad-link' };
  // pk = 群主公钥（PEM 的 base64url），作为身份锚点钉住：群主换 IP 后仍是同一台机器
  const pkB64 = u.searchParams.get('pk') || '';
  let masterPublicKey = '';
  if (pkB64) { try { masterPublicKey = Buffer.from(pkB64, 'base64url').toString('utf8'); } catch { masterPublicKey = ''; } }
  return { masterUrl: `${u.protocol}//${u.hostname}:${port}`, token, masterPublicKey };
}

export function nextDelay(random = Math.random) {
  return MIN_INTERVAL_MS + Math.floor(random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS));
}

export function loadReportConfig(file) {
  if (!file || !fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      masterUrl: typeof raw.masterUrl === 'string' ? raw.masterUrl : '',
      token: typeof raw.token === 'string' ? raw.token : '',
      days: Number.isFinite(Number(raw.days)) && Number(raw.days) > 0 ? Number(raw.days) : DEFAULT_CONFIG.days,
      masterPublicKey: typeof raw.masterPublicKey === 'string' ? raw.masterPublicKey : '',
    };
  } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveReportConfig(file, cfg) {
  const next = {
    masterUrl: String((cfg && cfg.masterUrl) || ''),
    token: String((cfg && cfg.token) || ''),
    days: Number.isFinite(Number(cfg && cfg.days)) && Number(cfg.days) > 0 ? Number(cfg.days) : DEFAULT_CONFIG.days,
    masterPublicKey: String((cfg && cfg.masterPublicKey) || ''),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// slave 侧上报器：启动即报一次（先本地落库自己这份，再发给 master），之后 60–90 分钟随机再报
export function createUsageReporter({
  file, identity, peers = null, onLocal = null, cmd = 'opencode', collect = collectAgentStats,
  fetchFn = fetch, logger = console, random = Math.random,
  now = () => Date.now(), scheduleFn = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  let timer = null;
  let stopped = false;
  let status = { lastAt: 0, lastOk: null, lastError: '', nextAt: 0 };

  const config = () => loadReportConfig(file);
  const statusOf = () => ({ ...status, config: config() });

  async function reportNow() {
    const cfg = config();
    let usage;
    try { usage = await collect({ cmd, days: cfg.days }); }
    catch (e) { usage = { agent: cmd, days: cfg.days, error: String((e && e.message) || e) }; }
    const me = (typeof identity === 'function' ? identity() : identity) || {};
    const self = {
      ...usage,
      machineId: me.machineId || '', employeeId: me.employeeId || '', username: me.username || '',
      host: me.host || '', port: me.port || 0,
    };
    // 本机自己也留一份：每台机器的「机器用量」至少能看到自己
    try {
      if (peers && typeof peers.upsert === 'function' && self.machineId) {
        const rec = peers.upsert(self);
        onLocal?.(rec);
      }
    } catch (e) { logger?.warn?.('usage local upsert failed', (e && e.message) || e); }

    if (!cfg.masterUrl || !cfg.token) {
      status = { ...status, lastAt: now(), lastOk: false, lastError: 'not-configured' };
      return { ok: false, error: 'not-configured' };
    }
    const wire = {
      machineId: self.machineId, employeeId: self.employeeId, username: self.username,
      host: self.host, port: self.port, usage,
    };
    try {
      const res = await fetchFn(`${cfg.masterUrl}/api/usage/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DF-Token': cfg.token },
        body: JSON.stringify(wire),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      status = { ...status, lastAt: now(), lastOk: true, lastError: '' };
      return { ok: true };
    } catch (e) {
      const msg = String((e && e.message) || e);
      status = { ...status, lastAt: now(), lastOk: false, lastError: msg };
      logger?.warn?.('usage report failed', msg);
      return { ok: false, error: msg };
    }
  }

  function schedule() {
    if (stopped) return;
    const delay = nextDelay(random);
    status.nextAt = now() + delay;
    timer = scheduleFn(async () => { await reportNow(); schedule(); }, delay);
    if (timer && timer.unref) timer.unref();
  }

  return {
    config,
    status: statusOf,
    setConfig(patch) { return saveReportConfig(file, { ...config(), ...patch }); },
    reportNow,
    start() { stopped = false; reportNow().then(schedule); },
    stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
  };
}
