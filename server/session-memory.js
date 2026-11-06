import { execFile } from 'node:child_process';

// 活动会话内存：按 PTY 进程树汇总（shell -> agent -> MCP/子进程）。
// Windows 用 Win32_Process.WorkingSetSize；POSIX 用 ps 的 rss（KB）。
const CACHE_MS = 2000;
let cache = { at: 0, platform: '', table: null };

function parseRows(text, factor = 1) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), bytes: Number(m[3]) * factor });
  }
  return rows;
}

export function parseWinProcessTable(text) {
  return parseRows(text, 1);
}

export function parsePsProcessTable(text) {
  return parseRows(text, 1024);   // ps rss 单位 KB
}

function runCollect(cmd, args, execFileFn) {
  return new Promise((resolve) => {
    try {
      execFileFn(cmd, args, { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) return resolve([]);
        resolve(String(stdout || ''));
      });
    } catch {
      resolve('');
    }
  });
}

export async function collectProcessTable({
  platform = process.platform, execFileFn = execFile, now = Date.now, cacheMs = CACHE_MS,
} = {}) {
  if (cacheMs > 0 && cache.table && cache.platform === platform && now() - cache.at < cacheMs) {
    return cache.table;
  }
  let table = [];
  if (platform === 'win32') {
    const cmd = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize)" }';
    table = parseWinProcessTable(await runCollect('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], execFileFn));
  } else {
    table = parsePsProcessTable(await runCollect('ps', ['-eo', 'pid=,ppid=,rss='], execFileFn));
  }
  if (cacheMs > 0) cache = { at: now(), platform, table };
  return table;
}

export function sumSessionMemory(sessions = [], table = []) {
  const byPid = new Map();
  const children = new Map();
  for (const row of Array.isArray(table) ? table : []) {
    if (!row || !Number.isFinite(Number(row.pid))) continue;
    byPid.set(Number(row.pid), row);
    const ppid = Number(row.ppid);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(Number(row.pid));
  }
  const out = {};
  for (const s of Array.isArray(sessions) ? sessions : []) {
    const root = Number(s?.pty?.pid || s?.pid || 0);
    if (!root) continue;
    const seen = new Set();
    const stack = [root];
    let bytes = 0;
    let processes = 0;
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      const row = byPid.get(cur);
      if (!row) continue;
      bytes += Number(row.bytes) || 0;
      processes += 1;
      for (const child of children.get(cur) || []) stack.push(child);
    }
    if (processes) out[s.id] = { bytes, processes };
  }
  return out;
}

export async function collectSessionMemory(sessionManager, opts = {}) {
  const sessions = sessionManager?.live?.() || [];
  if (!sessions.length) return {};
  const table = await collectProcessTable(opts);
  return sumSessionMemory(sessions, table);
}

export function clearSessionMemoryCache() {
  cache = { at: 0, platform: '', table: null };
}
