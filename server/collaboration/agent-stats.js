import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wrapCmdBin } from '../win-spawn.js';
import { withAgentEnv } from '../agent-env.js';

const MULT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

// 应用根（dev 为仓库根，绿色包为包根）：包内 opencode/、env/ 等约定位置从这里找
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN_EXTS = ['.exe', '.cmd', '.bat', '.ps1'];

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

function baseName(cmd) {
  return path.basename(String(cmd || '')).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

// 改名的 opencode（如 nga）与 opencode 是同一个 CLI：解析可执行文件时视为等价、互为回退，
// DEVFLOW_OPENCODE 覆盖与包内 opencode/、env/ 查找对它们一视同仁。
const OPENCODE_EQUIVALENTS = ['opencode', 'nga'];

// 待查找的命令名：自身在前，同族等价名在后（保留原写法作为首选）
function binCandidates(name) {
  const base = baseName(name);
  if (!OPENCODE_EQUIVALENTS.includes(base)) return [name];
  return [name, ...OPENCODE_EQUIVALENTS.filter((n) => n !== base)];
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
// opencode 与其改名等价物（如 nga）走同一条链、互为回退；都找不到时原样返回 cmd，
// 交给 execFile 报 ENOENT（保持旧行为）
export function resolveAgentBin(cmd, { env = process.env, exists = fs.existsSync, appRoot = APP_ROOT } = {}) {
  const name = String(cmd || '').trim();
  if (!name) return name;
  const candidates = binCandidates(name);
  if (candidates.some((c) => baseName(c) === 'opencode')) {
    const override = String(env.DEVFLOW_OPENCODE || '').trim();
    if (override && exists(override)) return override;
  }
  if (name.includes('/') || name.includes('\\')) return name;
  const pathDirs = String(env.PATH || '').split(path.delimiter);
  for (const c of candidates) {
    const fromPath = findIn(c, pathDirs, exists);
    if (fromPath) return fromPath;
  }
  const bundledDirs = [path.join(appRoot, 'opencode'), path.join(appRoot, 'env')];
  for (const c of candidates) {
    const bundled = findIn(c, bundledDirs, exists);
    if (bundled) return bundled;
  }
  return name;
}

// 把解析到的 agent 目录插到 PATH 最前，让本机采集与 pty 终端命中同一份；返回命中的可执行路径
// 解析 stats 命令的执行目录：在当前项目路径（或其子目录）里找 .git（目录或 worktree 文件），
// 命中则用该 git 根目录；找不到回退 home。目的：`nga stats` / `opencode stats` 在项目 git 目录下执行才能报出项目级统计。
export function resolveStatsCwd({ startDir = process.cwd(), home = os.homedir(), exists = fs.existsSync, readdir = fs.readdirSync } = {}) {
  const start = path.resolve(String(startDir || '') || process.cwd());
  if (exists(path.join(start, '.git'))) return start;
  return findGitUnder(start, 0, exists, readdir) || home;
}

// 深度优先向下搜索：最多 2 层子目录，返回第一个含 .git 的目录（跳过隐藏目录与 node_modules）
function findGitUnder(dir, depth, exists, readdir) {
  if (depth >= 2) return '';
  let entries;
  try { entries = readdir(dir, { withFileTypes: true }); } catch { return ''; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const sub = path.join(dir, e.name);
    if (exists(path.join(sub, '.git'))) return sub;
    const found = findGitUnder(sub, depth + 1, exists, readdir);
    if (found) return found;
  }
  return '';
}

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

// 解析用量采集命令模板：`<cmd> <args...>`，`{days}` 替换为天数；首段作为可执行文件解析。
// 返回 { bin, args }；模板为空返回 null（调用方回退旧行为 `<cmd> stats --days N`）。
export function parseStatsCmd(template, days, { env = process.env, exists = fs.existsSync, appRoot = APP_ROOT } = {}) {
  const text = String(template == null ? '' : template).trim();
  if (!text) return null;
  const tokens = text.replace(/\{days\}/g, String(days)).split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  return { bin: resolveAgentBin(tokens[0], { env, exists, appRoot }), args: tokens.slice(1) };
}

// —— Claude 系（claudecode / codeagent）：不走 CLI，直接解析本机会话日志 ——
// 参考 claude 的统计方式：会话日志在 ~/.claude/projects/<cwd转义>/<uuid>.jsonl，每行一条消息事件，
// 助手消息带 message.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}。
const CLAUDE_CMDS = new Set(['claudecode', 'codeagent']);

export function isClaudeFamily(cmd) {
  return CLAUDE_CMDS.has(baseName(cmd));
}

export function collectClaudeStats({ days = 60, home = os.homedir(), now = Date.now(), files = fs } = {}) {
  const root = path.join(home, '.claude', 'projects');
  const cutoff = days > 0 ? now - days * 24 * 3600 * 1000 : 0;
  // 递归收集所有 *.jsonl（跳过子 agent 会话 agent-*）
  const jsonl = [];
  const walk = (dir, depth = 0) => {
    if (depth > 6) return;
    let entries;
    try { entries = files.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!e.isFile?.() || !e.name.endsWith('.jsonl')) continue;
      if (e.name.includes('agent-')) continue;
      jsonl.push(p);
    }
  };
  walk(root);

  const byModel = {};
  let sessions = 0, messages = 0, input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  for (const file of jsonl) {
    let st;
    try { st = files.statSync(file); } catch { continue; }
    if (cutoff && Number(st.mtimeMs) < cutoff) continue;
    sessions += 1;   // 每个 jsonl = 一个 session
    let text;
    try { text = files.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of String(text).split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      let obj;
      try { obj = JSON.parse(t); } catch { continue; }
      messages += 1;   // 每行一条 message 事件（user/assistant/tool_use/tool_result）
      if (obj.type !== 'assistant') continue;
      const usage = obj.usage || (obj.message && obj.message.usage);
      if (!usage) continue;
      const i = Number(usage.input_tokens) || 0;
      const o = Number(usage.output_tokens) || 0;
      input += i; output += o;
      cacheRead += Number(usage.cache_read_input_tokens) || 0;
      cacheWrite += Number(usage.cache_creation_input_tokens) || 0;
      const model = obj.model || (obj.message && obj.message.model) || 'unknown';
      const m = byModel[model] || (byModel[model] = { input: 0, output: 0 });
      m.input += i; m.output += o;
    }
  }
  return { sessions, messages, input, output, cacheRead, cacheWrite, totalCost: null, byModel, days, collectedAt: now, source: 'claude-files' };
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
    const re = new RegExp(label + '\\s+\\$?([\\d.,]+\\s*[KMBT]?)', 'gi');
    let m;
    let last = null;
    while ((m = re.exec(t)) !== null) last = m[1];
    return last == null ? null : parseNum(last);
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

// 把采集原文持久化到 statsFile（有输出才覆盖写，无输出保留上次内容），并回读文件内容与最后修改时间。
// 目的：`opencode stats` / `nga stats` 偶发非零退出或输出为空时，仍能从文件里拿到上次的数据，
// 且界面可展示「上次结果时间」（文件 mtime）。
function persistStatsOutput(statsFile, text) {
  if (!statsFile) return { raw: String(text || ''), mtimeMs: null };
  const out = String(text || '');
  try {
    fs.mkdirSync(path.dirname(statsFile), { recursive: true });
    if (out.trim()) fs.writeFileSync(statsFile, out, 'utf8');
    const raw = fs.readFileSync(statsFile, 'utf8');
    return { raw, mtimeMs: fs.statSync(statsFile).mtimeMs };
  } catch {
    return { raw: out.trim() ? out : '', mtimeMs: 0 };
  }
}

// 诊断用探针：只跑一次统计命令，把「命令行 + 原始输出 + 解析结果 + 错误」原样返回。
// 刻意不走重试、不落库，也不并入 collectAgentStats —— 以免 raw 混进上报体。
export function probeAgentStats({
  cmd = 'opencode', statsCmd = '', days = 60, timeoutMs = 20000, env = process.env, execFileFn = execFile,
  cwd = null, resolveCwd = resolveStatsCwd,   // 默认在 git 根目录执行（无 git 回退用户主目录）
  startDir = undefined,                       // 起始目录：从用户选中目录向上找 .git；空则交给 resolveStatsCwd 默认（process.cwd()）
  home = os.homedir(),
  statsFile = null,                           // 采集原文落盘路径（如 <数据目录>/cache/collaboration/stats.txt）
} = {}) {
  // Claude 系：直接解析本机会话日志，不启 CLI
  if (isClaudeFamily(cmd) && !String(statsCmd || '').trim()) {
    const m = collectClaudeStats({ days, home });
    return Promise.resolve({
      agent: cmd, days, cmdline: 'scan ~/.claude/projects/*/*.jsonl',
      ok: true, error: '', code: null,
      raw: `sessions=${m.sessions} messages=${m.messages} input=${m.input} output=${m.output}`,
      stderr: '', parsed: m, bin: '', args: [], durationMs: 0, collectedAt: m.collectedAt,
    });
  }
  const spec = parseStatsCmd(statsCmd, days, { env })
    || { bin: resolveAgentBin(cmd, { env }), args: ['stats', '--days', String(days)] };
  const { bin, args } = wrapCmdBin(spec.bin, spec.args);   // .cmd/.bat 在 Windows 上必须经 cmd.exe
  const runCwd = cwd || resolveCwd({ startDir, home });
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFileFn(bin, args, { cwd: runCwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: withAgentEnv(env) }, (err, stdout, stderr) => {
      const persisted = persistStatsOutput(statsFile, stdout);
      const raw = persisted.raw;
      resolve({
        agent: cmd, days, cmdline: [spec.bin, ...spec.args].join(' '), bin: spec.bin, args: spec.args,
        ok: !err, error: err ? String((err && err.message) || err) : '', code: (err && err.code) || null,
        raw, stderr: String(stderr || ''), parsed: parseStats(raw),
        cwd: runCwd, statsFileMtime: persisted.mtimeMs,
        durationMs: Date.now() - startedAt, collectedAt: Date.now(),
      });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 采集本机用量。命令来自 agent 配置的 statsCmd 模板（每个 agent 一套），未配置时回退 `<cmd> stats --days N`。
// 默认只跑一次（启动即报一次 + 每 4 小时定时）；失败时由 statsFile 落盘回读兜底，不再重复拉起进程（避免弹窗）。
export function collectAgentStats({
  cmd = 'opencode', statsCmd = '', days = 60, timeoutMs = 20000, env = process.env,
  attempts = 1, retryDelayMs = 800, execFileFn = execFile, sleepFn = sleep,
  cwd = null, resolveCwd = resolveStatsCwd,   // 默认在 git 根目录执行（无 git 回退用户主目录）
  startDir = undefined,                       // 起始目录：从用户选中目录向下找 .git；空则交给 resolveStatsCwd 默认（process.cwd()）
  home = os.homedir(),
  statsFile = null,                           // 采集原文落盘路径（如 <数据目录>/cache/collaboration/stats.txt）
} = {}) {
  // Claude 系：直接解析本机会话日志（参考 claude 统计方式），不启 CLI、不闪窗
  if (isClaudeFamily(cmd) && !String(statsCmd || '').trim()) {
    return { agent: cmd, ...collectClaudeStats({ days, home }) };
  }
  const spec = parseStatsCmd(statsCmd, days, { env })
    || { bin: resolveAgentBin(cmd, { env }), args: ['stats', '--days', String(days)] };
  const { bin, args } = wrapCmdBin(spec.bin, spec.args);   // .cmd/.bat 在 Windows 上必须经 cmd.exe
  const cmdline = [spec.bin, ...spec.args].join(' ');
  const runCwd = cwd || resolveCwd({ startDir, home });
  const runOnce = () => new Promise((resolve) => {
    execFileFn(bin, args, { cwd: runCwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: withAgentEnv(env) }, (err, stdout) => {
      const captured = String(stdout || '');
      const persisted = persistStatsOutput(statsFile, captured);
      const raw = persisted.raw;
      if (err && !captured) { resolve({ error: String((err && err.message) || err), code: err && err.code, raw, cmdline, cwd: runCwd, statsFileMtime: persisted.mtimeMs }); return; }
      resolve({ ...parseStats(raw), raw, cmdline, collectedAt: Date.now(), cwd: runCwd, statsFileMtime: persisted.mtimeMs });
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
    return { agent: cmd, days, error: last.error, code: last.code, raw: last.raw || '', cmdline, cwd: last.cwd, statsFileMtime: last.statsFileMtime };
  })();
}
