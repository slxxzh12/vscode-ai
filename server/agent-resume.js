import { exec } from 'node:child_process';

// 按 agent 的续会话适配器：opencode 内建（含 resume="opencode" 的改名 opencode）；其它 agent 通过 XML resumeCmd/resumeDiscover 配置。
const DEFAULT_DISCOVER_MS = 20000;

const normDir = (s) => String(s || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const baseName = (cmd) => String(cmd || '').trim().replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();

// 内建 opencode 适配器适用范围：显式配置 resume="opencode"，或 agent 的 id/cmd 本身就是 opencode。
// 改名的 opencode（如 cmd="nga"）加 resume="opencode" 即可复用同一套「发现 id + --session 续接」。
export function isOpencodeAgent(agent) {
  if (!agent) return false;
  if (typeof agent.resume === 'string' && agent.resume.trim().toLowerCase() === 'opencode') return true;
  return agent.id === 'opencode' || baseName(agent.cmd) === 'opencode';
}

// 续会话/发现命令使用的可执行名：优先 agent.cmd（可能是改名的 opencode），缺省退回 opencode。
function opencodeBin(agent) {
  return (typeof agent.cmd === 'string' && agent.cmd.trim()) || 'opencode';
}

export function buildResumeCommand({ agent, agentSessionId } = {}) {
  if (!agent) return null;
  const id = typeof agentSessionId === 'string' ? agentSessionId : '';
  const configured = typeof agent.resumeCmd === 'string' ? agent.resumeCmd.trim() : '';
  if (configured) {
    if (configured.includes('{id}')) return id ? configured.replace(/\{id\}/g, id) : null;
    return configured;
  }
  if (isOpencodeAgent(agent)) {
    return id ? `${opencodeBin(agent)} --session ${id}` : null;
  }
  return null;
}

export function parseSessionList(text) {
  try {
    const arr = JSON.parse(String(text || ''));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function pickOpencodeSession(items, { cwd, since, slackMs = 60000, now = Date.now(), exclude = null } = {}) {
  const dir = normDir(cwd);
  const skip = exclude instanceof Set ? exclude : new Set(Array.isArray(exclude) ? exclude : []);
  let best = null;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== 'string' || !it.id) continue;
    if (skip.has(it.id)) continue;
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

export async function discoverAgentSessionId({ agent, cwd, since, run = defaultRun, exclude = null } = {}) {
  if (!agent) return null;
  if (typeof agent.resumeDiscover === 'string' && agent.resumeDiscover.trim()) {
    const out = await run(agent.resumeDiscover.trim(), { cwd });
    const id = out == null ? '' : String(out).trim();
    return id || null;
  }
  if (isOpencodeAgent(agent)) {
    const out = await run(`${opencodeBin(agent)} session list --format json -n 30`, { cwd });
    if (out == null) return null;
    return pickOpencodeSession(parseSessionList(out), { cwd, since, exclude });
  }
  return null;
}
