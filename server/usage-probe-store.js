import fs from 'node:fs';
import path from 'node:path';

// 「采集信息」弹窗的本地缓存：只存本机，供点击机器名时即时展示上次采集的命令行原文/解析结果。
// 采集侧（周期上报）与探针（手动重新采集）都会更新它。
export function loadProbe(file) {
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function saveProbe(file, rec) {
  if (!file || !rec || typeof rec !== 'object') return rec || null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rec, null, 2), 'utf8');
  } catch { /* 缓存写失败不影响主流程 */ }
  return rec;
}

const METRICS = ['sessions', 'messages', 'days', 'totalCost', 'input', 'output', 'cacheRead', 'cacheWrite'];

// 把一次采集结果（collectAgentStats 的返回）归一化成探针记录形状
export function toProbeRecord(u = {}, now = Date.now()) {
  const src = u && typeof u === 'object' ? u : {};
  const parsed = {};
  for (const k of METRICS) parsed[k] = Number.isFinite(src[k]) ? src[k] : null;
  return {
    cmdline: typeof src.cmdline === 'string' ? src.cmdline : '',
    ok: !src.error,
    error: src.error ? String(src.error) : '',
    code: src.code || null,
    raw: typeof src.raw === 'string' ? src.raw : '',
    stderr: '',
    parsed,
    collectedAt: Number(src.collectedAt) || now,
  };
}
