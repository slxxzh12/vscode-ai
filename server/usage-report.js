import fs from 'node:fs';
import path from 'node:path';

export const MIN_INTERVAL_MS = 60 * 60 * 1000;   // 60 分钟
export const MAX_INTERVAL_MS = 90 * 60 * 1000;   // 90 分钟
const DEFAULT_CONFIG = { masterUrl: '', token: '', days: 7 };

// 解析 master 的访问链接：http://<host>:<port>/?access=<token>
export function parseInviteLink(link) {
  let u;
  try { u = new URL(String(link || '').trim()); } catch { return { error: 'bad-link' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'bad-link' };
  const token = u.searchParams.get('access') || '';
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (!u.hostname || !port || !token) return { error: 'bad-link' };
  return { masterUrl: `${u.protocol}//${u.hostname}:${port}`, token };
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
    };
  } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveReportConfig(file, cfg) {
  const next = {
    masterUrl: String((cfg && cfg.masterUrl) || ''),
    token: String((cfg && cfg.token) || ''),
    days: Number.isFinite(Number(cfg && cfg.days)) && Number(cfg.days) > 0 ? Number(cfg.days) : DEFAULT_CONFIG.days,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
