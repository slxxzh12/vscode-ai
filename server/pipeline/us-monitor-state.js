import fs from 'node:fs';
import path from 'node:path';
import { runGitRaw } from '../git-log.js';
import { US_RE, FEATURE_RE } from './us-detect.js';

// 监控状态文件：方案目录下记录「上次执行完成的时间戳 + 当时文档仓 HEAD」。
export const MONITOR_FILE = '.devflow-monitor.json';

export async function docHeadOf(dir) {
  try {
    const out = await runGitRaw(['-C', dir, 'rev-parse', 'HEAD'], { timeout: 15000 });
    return String(out || '').trim();
  } catch {
    return '';
  }
}

export function readMonitorState(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MONITOR_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export function writeMonitorState(dir, { now = new Date(), commit = '' } = {}) {
  if (!dir) return null;
  const at = now instanceof Date ? now : new Date(now);
  const state = {
    lastRunAt: at.toISOString(),
    lastRunMs: at.getTime(),
    lastCommit: String(commit || ''),
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, MONITOR_FILE);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
  } catch { /* best-effort */ }
  return state;
}

// 从路径解析方案引用：US.../ 或 F0001-特性/US.../
function usRefOfPath(rel) {
  const segs = String(rel || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!segs.length) return '';
  if (US_RE.test(segs[0])) return segs[0];
  if (FEATURE_RE.test(segs[0]) && segs[1] && US_RE.test(segs[1])) return `${segs[0]}/${segs[1]}`;
  return '';
}

// baseCommit..HEAD 之间发生变化的方案目录，按提交先后（旧→新）去重排序。
// 只返回仍然存在的方案目录；git 不可用/提交范围无效时抛错，由调用方回退。
export async function changedUsSince(dir, baseCommit) {
  if (!baseCommit) return [];
  const out = await runGitRaw(
    ['-C', dir, '-c', 'core.quotepath=false', 'log', '--reverse', '--relative', '--name-only', '--pretty=format:__C__', `${baseCommit}..HEAD`, '--', '.'],
    { timeout: 30000 },
  );
  const seen = new Set();
  const list = [];
  for (const raw of String(out || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === '__C__') continue;
    const ref = usRefOfPath(line);
    if (!ref || seen.has(ref)) continue;
    if (!fs.existsSync(path.join(dir, ref))) continue;
    seen.add(ref);
    list.push(ref);
  }
  return list;
}
