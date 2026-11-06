import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withAgentEnv } from './agent-env.js';

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

// 内建 Claude 适配器（claudecode / codeagent 等）：会话记录在 ~/.claude/projects/<cwd转义>/<uuid>.jsonl，
// 续接用 `<cmd> --resume <id>`。用 resume="claude" 显式启用（不影响其它 agent）。
export function isClaudeAgent(agent) {
  return !!agent && typeof agent.resume === 'string' && agent.resume.trim().toLowerCase() === 'claude';
}

function claudeBin(agent) {
  return (typeof agent.cmd === 'string' && agent.cmd.trim()) || 'claudecode';
}

// 内建 Pi 适配器（resume="pi"，或 id/cmd 本身就是 pi）：会话文件在
// ~/.pi/agent/sessions/--<cwd转义>--/<timestamp>_<session-id>.jsonl，续接用 `<cmd> --session <id>`。
export function isPiAgent(agent) {
  if (!agent) return false;
  if (typeof agent.resume === 'string' && agent.resume.trim().toLowerCase() === 'pi') return true;
  return agent.id === 'pi' || baseName(agent.cmd) === 'pi';
}

function piBin(agent) {
  return (typeof agent.cmd === 'string' && agent.cmd.trim()) || 'pi';
}

// Pi 的会话目录名：去掉前导分隔符后把 / \ : 换成 -，再包一层 --<slug>--
export function piSessionDirName(cwd) {
  const slug = String(cwd || '').replace(/^[\\/]+/, '').replace(/[\\/:]/g, '-');
  return slug ? `--${slug}--` : '';
}

export function pickPiSession(entries, { since = 0, slackMs = 60000, now = Date.now(), exclude = null } = {}) {
  const skip = exclude instanceof Set ? exclude : new Set(Array.isArray(exclude) ? exclude : []);
  let best = null;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.id !== 'string' || !e.id || skip.has(e.id)) continue;
    const t = Number(e.timestamp);
    if (!Number.isFinite(t)) continue;
    if (since && (t < since - slackMs || t > now + slackMs)) continue;
    const d = Math.abs(t - since);
    if (!best || d < best.d) best = { id: e.id, d };
  }
  return best ? best.id : null;
}

function piAgentDir({ home = os.homedir(), env = process.env } = {}) {
  return String(env.PI_CODING_AGENT_DIR || '').trim() || path.join(home, '.pi', 'agent');
}

// 只读文件头：Pi 会话可能很大，发现时没必要整份读入
function readFirstLine(file, files) {
  try {
    if (typeof files.openSync === 'function' && typeof files.readSync === 'function') {
      const fd = files.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(8192);
        const n = files.readSync(fd, buf, 0, buf.length, 0);
        return buf.subarray(0, n).toString('utf8').split(/\r?\n/, 1)[0];
      } finally {
        try { files.closeSync(fd); } catch { /* ignore */ }
      }
    }
    return String(files.readFileSync(file, 'utf8')).split(/\r?\n/, 1)[0];
  } catch { return ''; }
}

export function discoverPiSessionId({ cwd, since = 0, home = os.homedir(), env = process.env, files = fs, now = Date.now(), slackMs = 60000, exclude = null } = {}) {
  const name = piSessionDirName(cwd);
  if (!name) return null;
  const dir = path.join(piAgentDir({ home, env }), 'sessions', name);
  let names;
  try { names = files.readdirSync(dir); } catch { return null; }
  const entries = [];
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const file = path.join(dir, n);
    let header = null;
    try { header = JSON.parse(readFirstLine(file, files)); } catch { /* 无头信息时退回文件名里的 id */ }
    const fileId = n.slice(0, -'.jsonl'.length).split('_').slice(1).join('_');
    const id = (header && typeof header.id === 'string' && header.id) || fileId;
    if (!id) continue;
    if (header && header.cwd && normDir(header.cwd) !== normDir(cwd)) continue;
    let timestamp = header && header.timestamp ? Date.parse(header.timestamp) : NaN;
    if (!Number.isFinite(timestamp)) {
      try { timestamp = files.statSync(file).mtimeMs; } catch { timestamp = NaN; }
    }
    entries.push({ id, timestamp });
  }
  return pickPiSession(entries, { since, slackMs, now, exclude });
}

// cwd → 项目目录名候选（不同版本转义方式略有差异，逐个试存在的）
export function claudeProjectSlugs(cwd) {
  const c = String(cwd || '');
  const out = [];
  for (const re of [/[\\/:]/g, /[\\/]/g]) {
    const s = c.replace(re, '-');
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

// 从 [{ id, mtime }] 里按「最接近 since 且在时间窗内」选一个
export function pickClaudeSession(entries, { since = 0, slackMs = 60000, now = Date.now() } = {}) {
  let best = null;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.id !== 'string' || !e.id) continue;
    const t = Number(e.mtime);
    if (!Number.isFinite(t)) continue;
    if (since && (t < since - slackMs || t > now + slackMs)) continue;
    const d = Math.abs(t - since);
    if (!best || d < best.d) best = { id: e.id, d };
  }
  return best ? best.id : null;
}

export function discoverClaudeSessionId({ cwd, since = 0, home = os.homedir(), files = fs, now = Date.now(), slackMs = 60000 } = {}) {
  const root = path.join(home, '.claude', 'projects');
  for (const slug of claudeProjectSlugs(cwd)) {
    const dir = path.join(root, slug);
    let names;
    try { names = files.readdirSync(dir); } catch { continue; }
    const entries = [];
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      try { entries.push({ id: n.slice(0, -'.jsonl'.length), mtime: files.statSync(path.join(dir, n)).mtimeMs }); } catch { /* skip */ }
    }
    const id = pickClaudeSession(entries, { since, slackMs, now });
    if (id) return id;
  }
  return null;
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
  if (isClaudeAgent(agent)) {
    return id ? `${claudeBin(agent)} --resume ${id}` : null;
  }
  if (isPiAgent(agent)) {
    return id ? `${piBin(agent)} --session ${id}` : null;
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
      exec(command, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: withAgentEnv() }, (err, stdout) => {
        resolve(err && !stdout ? null : String(stdout || ''));
      });
    } catch { resolve(null); }
  });
}

export async function discoverAgentSessionId({ agent, cwd, since, run = defaultRun, exclude = null, home } = {}) {
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
  if (isClaudeAgent(agent)) {
    return discoverClaudeSessionId(home ? { cwd, since, home } : { cwd, since });
  }
  if (isPiAgent(agent)) {
    return discoverPiSessionId({ cwd, since, home, exclude });
  }
  return null;
}
