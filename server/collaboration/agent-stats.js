import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MULT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

// 应用根（dev 为仓库根，绿色包为包根）：包内 opencode/、env/ 等约定位置从这里找
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN_EXTS = ['.exe', '.cmd', '.bat', '.ps1'];

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

function baseName(cmd) {
  return path.basename(String(cmd || '')).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

// 在给定目录里找可执行文件（Windows 无扩展名时补 PATHEXT 常见后缀）
function findIn(cmd, dirs, exists) {
  const exts = process.platform === 'win32' && !path.extname(cmd) ? WIN_EXTS : [''];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      if (exists(p)) return p;
    }
  }
  return '';
}

// 解析 agent 可执行文件：显式配置(DEVFLOW_OPENCODE) → 本身是路径 → PATH → 包内 opencode/、env/
// 都找不到时原样返回 cmd，交给 execFile 报 ENOENT（保持旧行为）
export function resolveAgentBin(cmd, { env = process.env, exists = fs.existsSync, appRoot = APP_ROOT } = {}) {
  const name = String(cmd || '').trim();
  if (!name) return name;
  if (baseName(name) === 'opencode') {
    const override = String(env.DEVFLOW_OPENCODE || '').trim();
    if (override && exists(override)) return override;
  }
  if (name.includes('/') || name.includes('\\')) return name;
  const fromPath = findIn(name, String(env.PATH || '').split(path.delimiter), exists);
  if (fromPath) return fromPath;
  const bundled = findIn(name, [path.join(appRoot, 'opencode'), path.join(appRoot, 'env')], exists);
  return bundled || name;
}

// 把解析到的 agent 目录插到 PATH 最前，让本机采集与 pty 终端命中同一份；返回命中的可执行路径
export function ensureAgentOnPath(cmd, { env = process.env, exists = fs.existsSync, appRoot = APP_ROOT } = {}) {
  const bin = resolveAgentBin(cmd, { env, exists, appRoot });
  if (!bin || !path.isAbsolute(bin)) return '';
  const dir = path.dirname(bin);
  const parts = String(env.PATH || '').split(path.delimiter);
  if (!parts.some((p) => p && path.resolve(p).toLowerCase() === path.resolve(dir).toLowerCase())) {
    env.PATH = dir + path.delimiter + (env.PATH || '');
  }
  return bin;
}

export function parseNum(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[$,\s]/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)([KMBT])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2] ? m[2].toUpperCase() : null;
  return u ? Math.round(n * MULT[u]) : n;
}

export function parseStats(text) {
  const t = stripAnsi(text || '');
  const grab = (label) => {
    const m = t.match(new RegExp(label + '\\s+\\$?([\\d.,]+\\s*[KMBT]?)', 'i'));
    return m ? parseNum(m[1]) : null;
  };
  return {
    sessions: grab('Sessions'),
    messages: grab('Messages'),
    days: grab('Days'),
    totalCost: grab('Total Cost'),
    input: grab('Input'),
    output: grab('Output'),
    cacheRead: grab('Cache Read'),
    cacheWrite: grab('Cache Write'),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 采集本机用量。opencode stats 偶发（并发访问数据目录时）非零退出，故默认重试几次；
// 命令不存在（ENOENT）重试无意义，直接返回 error。
export function collectAgentStats({
  cmd = 'opencode', days = 7, timeoutMs = 20000, env = process.env,
  attempts = 3, retryDelayMs = 800, execFileFn = execFile, sleepFn = sleep,
} = {}) {
  const bin = resolveAgentBin(cmd, { env });
  const runOnce = () => new Promise((resolve) => {
    execFileFn(bin, ['stats', '--days', String(days)], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) { resolve({ error: String((err && err.message) || err), code: err && err.code }); return; }
      resolve({ ...parseStats(stdout), collectedAt: Date.now() });
    });
  });
  return (async () => {
    const total = Math.max(1, attempts);
    let last = { error: 'not-run' };
    for (let i = 0; i < total; i += 1) {
      last = await runOnce();
      if (!last.error) return { agent: cmd, days, ...last };
      if (last.code === 'ENOENT') break;
      if (i < total - 1) await sleepFn(retryDelayMs);
    }
    return { agent: cmd, days, error: last.error };
  })();
}
