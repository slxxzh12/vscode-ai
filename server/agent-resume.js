import { exec } from 'node:child_process';

// 按 agent 的续会话适配器：opencode 内建；其它 agent 通过 XML resumeCmd/resumeDiscover 配置。
const DEFAULT_DISCOVER_MS = 20000;

const normDir = (s) => String(s || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function buildResumeCommand({ agent, agentSessionId } = {}) {
  if (!agent) return null;
  const id = typeof agentSessionId === 'string' ? agentSessionId : '';
  const configured = typeof agent.resumeCmd === 'string' ? agent.resumeCmd.trim() : '';
  if (configured) {
    if (configured.includes('{id}')) return id ? configured.replace(/\{id\}/g, id) : null;
    return configured;
  }
  if (agent.id === 'opencode' || agent.cmd === 'opencode') {
    return id ? `opencode --session ${id}` : null;
  }
  return null;
}

export function parseSessionList(text) {
  try {
    const arr = JSON.parse(String(text || ''));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function pickOpencodeSession(items, { cwd, since, slackMs = 60000, now = Date.now() } = {}) {
  const dir = normDir(cwd);
  let best = null;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== 'string' || !it.id) continue;
    if (normDir(it.directory) !== dir) continue;
    const created = Number(it.created);
    if (!Number.isFinite(created)) continue;
    if (created < since - slackMs || created > now + slackMs) continue;
    const d = Math.abs(created - since);
    if (!best || d < best.d) best = { id: it.id, d };
  }
  return best ? best.id : null;
}

function defaultRun(command, { cwd, timeoutMs = DEFAULT_DISCOVER_MS } = {}) {
  return new Promise((resolve) => {
    try {
      exec(command, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        resolve(err && !stdout ? null : String(stdout || ''));
      });
    } catch { resolve(null); }
  });
}

export async function discoverAgentSessionId({ agent, cwd, since, run = defaultRun } = {}) {
  if (!agent) return null;
  if (typeof agent.resumeDiscover === 'string' && agent.resumeDiscover.trim()) {
    const out = await run(agent.resumeDiscover.trim(), { cwd });
    const id = out == null ? '' : String(out).trim();
    return id || null;
  }
  if (agent.id === 'opencode' || agent.cmd === 'opencode') {
    const out = await run('opencode session list --format json -n 30', { cwd });
    if (out == null) return null;
    return pickOpencodeSession(parseSessionList(out), { cwd, since });
  }
  return null;
}
