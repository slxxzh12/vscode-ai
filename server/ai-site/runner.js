import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { buildZip } from '../collaboration/zip.js';
import { wrapCmdBin } from '../win-spawn.js';
import { resolveAgentBin } from '../collaboration/agent-stats.js';
import { withAgentEnv } from '../agent-env.js';

const LOG_LIMIT = 1024 * 1024;
const FILE_LIMIT = 5000;

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function inside(root, file) { return file === root || file.startsWith(root + path.sep); }

function walk(dir, base = '', out = { list: [], count: 0 }) {
  if (out.count > FILE_LIMIT) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else if (e.isFile()) {
      out.count += 1;
      if (out.count > FILE_LIMIT) break;
      const st = fs.statSync(path.join(dir, e.name));
      out.list.push({ path: rel, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out;
}

export function createAiSiteRunner({
  runsDir,
  spawnFn = spawn,
  agentCmd = 'opencode',
  timeoutMs = Number(process.env.DEVFLOW_AI_SITE_TIMEOUT_MS || 10 * 60 * 1000),
  keepRuns = 50,
  resolveBin = resolveAgentBin,
  onStateChange = () => {},
} = {}) {
  const runs = new Map();

  function prune() {
    let entries = [];
    try { entries = fs.readdirSync(runsDir, { withFileTypes: true }); } catch { return; }
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => {
      const full = path.join(runsDir, e.name);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
      return { name: e.name, full, mtime };
    }).sort((a, b) => b.mtime - a.mtime);
    for (const d of dirs.slice(keepRuns)) {
      try { fs.rmSync(d.full, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  function publicMeta(meta) {
    return {
      id: meta.id, plugin: meta.plugin, user: meta.user, ip: meta.ip || '', sessionId: meta.sessionId || '',
      startedAt: meta.startedAt, finishedAt: meta.finishedAt,
      exitCode: meta.exitCode, status: meta.status, error: meta.error,
    };
  }

  function emit(run, event) {
    run.events.push(event);
    if (run.events.length > 500) run.events.shift();
    for (const cb of run.listeners) { try { cb(event); } catch { /* ignore */ } }
  }

  function createRun({ pluginName, pluginTitle = pluginName, pluginDir, workflowPath, values = {}, user = '', ip = '' }) {
    const id = crypto.randomUUID();
    const runDir = path.join(runsDir, id);
    fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });
    prune(); // 新目录已存在（mtime 最新），保留最近 keepRuns 个

    let prompt = '';
    try { prompt = fs.readFileSync(workflowPath, 'utf8'); } catch { prompt = ''; }
    const sourceDir = path.dirname(workflowPath);
    if (inside(pluginDir, sourceDir) && fs.existsSync(sourceDir)) {
      fs.cpSync(sourceDir, runDir, { recursive: true });
    }
    fs.writeFileSync(path.join(runDir, 'input.json'), JSON.stringify(values, null, 2), 'utf8');

    const meta = {
      id, plugin: pluginName, user, ip, startedAt: Date.now(), finishedAt: 0,
      exitCode: null, status: 'running', error: null, sessionId: '',
      listeners: new Set(), events: [], log: '',
    };
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(publicMeta(meta), null, 2), 'utf8');
    runs.set(id, meta);
    try { onStateChange({ ...publicMeta(meta), phase: 'start', pluginTitle, runDir }); } catch { /* ignore */ }

    const bin = resolveBin(agentCmd);
    const wrapped = wrapCmdBin(bin, ['run', prompt]);
    const logPath = path.join(runDir, 'run.log');
    fs.writeFileSync(logPath, '', 'utf8');
    let child = null;
    let done = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      try { child?.kill('SIGKILL'); } catch { /* ignore */ }
      meta.error = 'timeout';
    }, timeoutMs) : null;
    timer?.unref?.();

    function finish(exitCode, spawnError = false, errMsg = null) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try { meta.child?.stdin?.end(); } catch { /* ignore */ }
      meta.child = null;
      meta.finishedAt = Date.now();
      meta.exitCode = exitCode;
      meta.status = meta.error === 'timeout' ? 'timeout' : (spawnError || exitCode !== 0 ? 'error' : 'success');
      if (errMsg) meta.error = errMsg;
      try { fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(publicMeta(meta), null, 2), 'utf8'); } catch { /* ignore */ }
      emit(meta, { type: 'done', status: meta.status, exitCode: meta.exitCode, error: meta.error });
      try { onStateChange({ ...publicMeta(meta), phase: 'finish', pluginTitle, runDir }); } catch { /* ignore */ }
    }

    try {
      child = spawnFn(wrapped.bin, wrapped.args, {
        cwd: runDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: withAgentEnv(),
      });
    } catch (e) {
      finish(-1, true, String(e && e.message || e));
      return publicMeta(meta);
    }

    meta.child = child;
    child.stdin?.on?.('error', () => { /* ignore closed stdin */ });
    const onData = (chunk) => {
      const text = String(chunk);
      meta.log = (meta.log + text).slice(-LOG_LIMIT);
      if (!meta.sessionId) {
        const m = meta.log.match(/"sessionID"\s*:\s*"([^"]+)"/);
        if (m) meta.sessionId = m[1];
      }
      try { fs.appendFileSync(logPath, text, 'utf8'); } catch { /* ignore */ }
      emit(meta, { type: 'chunk', data: text });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on?.('error', (e) => finish(-1, true, String(e && e.message || e)));
    child.on?.('close', (code) => finish(code ?? null, false, null));
    return publicMeta(meta);
  }

  function getRun(id) {
    const m = runs.get(String(id || ''));
    return m ? publicMeta(m) : null;
  }

  function snapshot(id) {
    const m = runs.get(String(id || ''));
    return m ? { ...publicMeta(m), log: m.log } : null;
  }

  // 向运行中的进程写入用户输入（终端页底部的输入框）。
  function write(id, text) {
    const m = runs.get(String(id || ''));
    const child = m && m.status === 'running' ? m.child : null;
    if (!child || !child.stdin) return false;
    try { child.stdin.write(String(text)); return true; } catch { return false; }
  }

  function subscribe(id, cb) {
    const m = runs.get(String(id || ''));
    if (!m) return () => {};
    for (const ev of m.events) { try { cb(ev); } catch { /* ignore */ } }
    m.listeners.add(cb);
    return () => m.listeners.delete(cb);
  }

  function outputDir(id) { return path.join(runsDir, String(id || ''), 'output'); }

  function listFiles(id) { return walk(outputDir(id)).list; }

  function readFile(id, rel) {
    const root = path.resolve(outputDir(id));
    const r = String(rel || '');
    if (!r || path.isAbsolute(r) || r.includes('\0')) throw err('bad-path');
    const file = path.resolve(root, r);
    if (!inside(root, file)) throw err('bad-path');
    let st = null;
    try { st = fs.statSync(file); } catch { throw err('not-found'); }
    if (!st.isFile()) throw err('not-found');
    return { data: fs.readFileSync(file), size: st.size };
  }

  function zipOutput(id) {
    const root = outputDir(id);
    const entries = [];
    for (const f of walk(root).list) {
      entries.push({ name: f.path, data: fs.readFileSync(path.join(root, f.path)) });
    }
    return buildZip(entries);
  }

  return { createRun, getRun, snapshot, write, subscribe, listFiles, readFile, zipOutput, prune };
}
