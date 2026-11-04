import fs from 'node:fs';
import { collectAgentStats, isClaudeFamily, readStatsFile, refreshStatsOutput } from './collaboration/agent-stats.js';
import { SOURCE_AUTO, SOURCE_IMAGE } from './usage-store.js';
import path from 'node:path';

// 自动采集窗口：每天 13:00-14:00 与 22:00 之后各一次，其他时间不主动调用 stats。
export const REPORT_SLOT_HOURS = [13, 22];
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONFIG = { masterUrl: '', token: '', days: 60, masterPublicKey: '', lastSlot: '' };

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

function localDayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 当前所处的采集窗口 key（13 点窗口为 "<日期>:13"，22 点后为 "<日期>:22"），不在窗口返回 ''。
export function currentSlotKey(ts = Date.now()) {
  const hour = new Date(ts).getHours();
  if (hour === 13) return `${localDayKey(ts)}:13`;
  if (hour >= 22) return `${localDayKey(ts)}:22`;
  return '';
}

// 下一个自动采集点：处于窗口内且本窗口尚未跑过 → 立刻；否则等到下一个 13:00 / 22:00。
// lastSlot 用于避免同一天同一窗口因重启重复采集。
export function nextSlot(ts = Date.now(), lastSlot = '') {
  const cur = currentSlotKey(ts);
  if (cur && cur !== lastSlot) return { key: cur, at: ts };
  const d = new Date(ts);
  const candidates = [];
  for (let offset = 0; offset <= 2; offset += 1) {
    const base = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
    for (const hour of REPORT_SLOT_HOURS) {
      const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, 0, 0, 0).getTime();
      const key = `${localDayKey(at)}:${hour}`;
      if (key !== lastSlot && at >= ts) candidates.push({ key, at });
    }
  }
  candidates.sort((a, b) => a.at - b.at);
  return candidates[0] || { key: '', at: ts + DAY_MS };
}

export function nextDelay(nowMs = Date.now(), lastSlot = '') {
  const slot = nextSlot(nowMs, lastSlot);
  return Math.max(0, slot.at - nowMs);
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
      lastSlot: typeof raw.lastSlot === 'string' ? raw.lastSlot : '',
    };
  } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveReportConfig(file, cfg) {
  const next = {
    masterUrl: String((cfg && cfg.masterUrl) || ''),
    token: String((cfg && cfg.token) || ''),
    days: Number.isFinite(Number(cfg && cfg.days)) && Number(cfg.days) > 0 ? Number(cfg.days) : DEFAULT_CONFIG.days,
    masterPublicKey: String((cfg && cfg.masterPublicKey) || ''),
    lastSlot: String((cfg && cfg.lastSlot) || ''),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// slave 侧上报器：只在每天 13:00-14:00 与 22:00 之后各采集上报一次（先本地落库自己这份，再发给 master）；
// 其他时间不主动调用 stats。手动「立即上报」与图片识别上报不受此限制。
export function createUsageReporter({
  file, identity, peers = null, onLocal = null, onCollected = null, cmd = 'opencode', statsCmd = '', resolveAgent = null, collect = null,
  getStartDir = null,   // () => 用户当前选中目录根；采集时作为 stats 命令的起始目录（无则回退用户主目录）
  statsFile = null,     // 采集原文落盘路径（如 <数据目录>/cache/collaboration/stats.txt），传给采集器
  getChatDaily = null,  // () => { 'YYYY-MM-DD': 当天用户聊天消息数 }（上报前一天），与 agent stats 一起上报
  readStats = readStatsFile,     // 读采集结果文件（消费）
  refresh = refreshStatsOutput,  // 后台刷新采集文件（生产）
  fetchFn = fetch, logger = console,
  now = () => Date.now(), scheduleFn = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  let timer = null;
  let stopped = false;
  let status = { lastAt: 0, lastOk: null, lastError: '', nextAt: 0 };

  const config = () => loadReportConfig(file);
  const statusOf = () => ({ ...status, config: config() });

  const currentAgent = () => {
    const r = typeof resolveAgent === 'function' ? resolveAgent() : null;
    return {
      cmd: (r && r.cmd) || cmd,
      statsCmd: (r && r.statsCmd) || statsCmd,
    };
  };

  // 上报一份已采集的用量（本地落库 + 发给 master）；source 缺省 auto，图片识别显式传 image
  async function submit(usage) {
    const cfg = config();
    const chatDaily = typeof getChatDaily === 'function' ? (getChatDaily() || {}) : {};
    const today = localDayKey(now());
    const todayChat = Number(chatDaily[today]);
    const clean = {
      ...(usage || {}),
      ...(Number.isFinite(todayChat) ? { chatMessages: Math.round(todayChat) } : {}),
      source: (usage && usage.source) === SOURCE_IMAGE ? SOURCE_IMAGE : SOURCE_AUTO,
    };
    const me = (typeof identity === 'function' ? identity() : identity) || {};
    const self = {
      ...clean,
      machineId: me.machineId || '', employeeId: me.employeeId || '', username: me.username || '',
      host: me.host || '', port: me.port || 0,
    };
    // 本机自己也留一份：每台机器的「机器用量」至少能看到自己
    try {
      if (peers && typeof peers.upsert === 'function' && self.machineId) {
        const rec = peers.upsert(self);
        onLocal?.(rec);
      }
      if (peers && typeof peers.upsertChatDay === 'function' && self.machineId) {
        for (const [day, n] of Object.entries(chatDaily)) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Number(n))) peers.upsertChatDay(self.machineId, day, Number(n));
        }
      }
    } catch (e) { logger?.warn?.('usage local upsert failed', (e && e.message) || e); }

    if (!cfg.masterUrl || !cfg.token) {
      status = { ...status, lastAt: now(), lastOk: false, lastError: 'not-configured' };
      return { ok: false, error: 'not-configured' };
    }
    const wire = {
      machineId: self.machineId, employeeId: self.employeeId, username: self.username,
      host: self.host, port: self.port, usage: clean,
      ...(Object.keys(chatDaily).length ? { chatDaily } : {}),
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

  // 默认采集周期：claude 系本机日志同步解析；其余读 stats.txt（消费）+ 触发后台刷新（生产）
  async function collectFromFile(args) {
    if (isClaudeFamily(args.cmd) && !String(args.statsCmd || '').trim()) return collectAgentStats(args);
    const snap = readStats(args.statsFile);
    try { refresh({ cmd: args.cmd, statsCmd: args.statsCmd, days: args.days, startDir: args.startDir, statsFile: args.statsFile }); }
    catch (e) { logger?.warn?.('usage refresh failed', (e && e.message) || e); }
    if (!snap.exists) return { agent: args.cmd, days: args.days, error: 'no-data', raw: '', statsFileMtime: snap.mtimeMs };
    return { agent: args.cmd, days: args.days, ...(snap.parsed || {}), raw: snap.raw, statsFileMtime: snap.mtimeMs };
  }
  const runCollect = typeof collect === 'function' ? collect : collectFromFile;

  async function reportNow() {
    const cfg = config();
    const a = currentAgent();
    let usage;
    try { usage = await runCollect({ cmd: a.cmd, statsCmd: a.statsCmd, days: cfg.days, startDir: (typeof getStartDir === 'function' ? getStartDir() : null) || undefined, statsFile }); }
    catch (e) { usage = { agent: a.cmd, days: cfg.days, error: String((e && e.message) || e) }; }
    // 本机缓存一份带原文的采集结果，供「采集信息」弹窗即时展示
    try { onCollected?.(usage); } catch (e) { logger?.warn?.('usage onCollected failed', (e && e.message) || e); }
    if (usage && usage.error === 'no-data') return { ok: false, error: 'no-data' };
    // raw/cmdline 只留本机，不进 peers/上报体
    const { raw: _raw, cmdline: _cmdline, ...usageClean } = usage || {};
    return submit(usageClean);
  }

  // 图片识别采集：直接把识别出的用量上报（来源标记 image）
  async function reportImage(usage) {
    return submit({ ...(usage || {}), source: SOURCE_IMAGE });
  }

  function markSlot(key) {
    if (!key) return;
    try { saveReportConfig(file, { ...config(), lastSlot: key }); }
    catch (e) { logger?.warn?.('usage report slot mark failed', (e && e.message) || e); }
  }

  function schedule() {
    if (stopped) return;
    const nowTs = now();
    const slot = nextSlot(nowTs, config().lastSlot);
    const delay = Math.max(0, slot.at - nowTs);
    status.nextAt = nowTs + delay;
    timer = scheduleFn(async () => {
      if (stopped) return;
      const current = nextSlot(now(), config().lastSlot);
      await reportNow();
      markSlot(current.key || slot.key);
      schedule();
    }, delay);
    if (timer && timer.unref) timer.unref();
  }

  return {
    config,
    status: statusOf,
    setConfig(patch) { return saveReportConfig(file, { ...config(), ...patch }); },
    reportNow,
    reportImage,
    start() { stopped = false; schedule(); },
    stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
  };
}
