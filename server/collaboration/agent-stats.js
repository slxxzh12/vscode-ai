import { execFile } from 'node:child_process';

const MULT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

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

export function collectAgentStats({ cmd = 'opencode', days = 7, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, ['stats', '--days', String(days)], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) { resolve({ agent: cmd, days, error: String((err && err.message) || err) }); return; }
      resolve({ agent: cmd, days, ...parseStats(stdout), collectedAt: Date.now() });
    });
  });
}
