import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wrapCmdBin } from '../win-spawn.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_PORT = 22222;
const HEALTH_TIMEOUT_MS = 1500;
const START_TIMEOUT_MS = 20000;

function argFlag(name) {
  return process.argv.includes(name);
}

function readPortFile(file) {
  try {
    const n = Number(String(fs.readFileSync(file, 'utf8')).trim());
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
  } catch {
    return null;
  }
}

function portCandidates() {
  const out = [];
  const env = Number(process.env.DEVFLOW_PORT);
  if (Number.isInteger(env) && env > 0 && env < 65536) out.push(env);
  const runtime = readPortFile(path.join(APP_ROOT, 'data', 'runtime-port.txt'));
  if (runtime) out.push(runtime);
  const desired = readPortFile(path.join(APP_ROOT, 'data', 'port.txt'));
  if (desired) out.push(desired);
  out.push(DEFAULT_PORT);
  return [...new Set(out)];
}

export function normalizeRoot(p) {
  const v = path.resolve(String(p || '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? v.toLowerCase() : v;
}

async function fetchJson(url, init = {}, timeout = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = { Connection: 'close', ...(init.headers || {}) };
    const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(port) {
  try {
    const r = await fetchJson(`http://127.0.0.1:${port}/api/version`, {}, HEALTH_TIMEOUT_MS);
    return r.ok ? port : null;
  } catch {
    return null;
  }
}

async function findRunningPort() {
  for (const port of portCandidates()) {
    if (await probe(port)) return port;
  }
  return null;
}

function startServer() {
  const bundled = path.join(APP_ROOT, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  const nodeBin = fs.existsSync(bundled) ? bundled : process.execPath;
  const entry = path.join(APP_ROOT, 'server', 'index.js');
  const env = { ...process.env };
  const logDir = path.join(APP_ROOT, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, 'void-server.log'), 'a');
  const child = spawn(nodeBin, [entry], {
    cwd: APP_ROOT,
    env,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  try { fs.closeSync(out); } catch { /* ignore */ }
  child.unref();
}

async function ensureServer() {
  const running = await findRunningPort();
  if (running) return running;
  startServer();
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 350));
    const port = await findRunningPort();
    if (port) return port;
  }
  return null;
}

async function findOrAddProject(base, cwd) {
  const list = await fetchJson(`${base}/api/projects`);
  const projects = Array.isArray(list.data?.projects) ? list.data.projects : [];
  const found = projects.find((p) => normalizeRoot(p.root) === normalizeRoot(cwd));
  if (found) return found;
  const added = await fetchJson(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: cwd }),
  });
  if (added.ok && added.data?.project) return added.data.project;
  if (added.status === 409) {
    const again = await fetchJson(`${base}/api/projects`);
    const list2 = Array.isArray(again.data?.projects) ? again.data.projects : [];
    return list2.find((p) => normalizeRoot(p.root) === normalizeRoot(cwd)) || null;
  }
  return null;
}

async function defaultAgent(base) {
  const r = await fetchJson(`${base}/api/agents`);
  const agents = Array.isArray(r.data?.agents) ? r.data.agents : [];
  const id = r.data?.default || '';
  const a = agents.find((x) => x.id === id) || agents[0] || null;
  return a ? { id: a.id || '', cmd: String(a.cmd || '') } : null;
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  const bin = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    spawn(bin, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* ignore */ }
}

function agentEnv() {
  const env = { ...process.env };
  const extra = [
    path.join(APP_ROOT, 'opencode'),
    path.join(APP_ROOT, 'env'),
  ].filter((p) => fs.existsSync(p));
  if (extra.length) env.PATH = [...extra, env.PATH || ''].join(path.delimiter);
  return env;
}

function runAgent(cmd, cwd) {
  return new Promise((resolve) => {
    const spec = wrapCmdBin(cmd, []);
    const child = spawn(spec.bin, spec.args, {
      cwd,
      env: agentEnv(),
      stdio: 'inherit',
      windowsHide: false,
    });
    child.on('error', (e) => {
      console.error(`Failed to start agent "${cmd}": ${e.message}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

async function main() {
  if (argFlag('--help') || argFlag('-h')) {
    console.log('Usage: void [--no-open] [--no-agent]');
    console.log('  Adds the current folder to DevFlow, opens the web UI and starts the default agent.');
    return 0;
  }
  const cwd = process.cwd();
  const port = await ensureServer();
  if (!port) {
    console.error('DevFlow server is not running and could not be started.');
    return 1;
  }
  const base = `http://127.0.0.1:${port}`;
  const project = await findOrAddProject(base, cwd);
  if (!project) {
    console.error(`Failed to add "${cwd}" to DevFlow projects.`);
    return 1;
  }
  const agent = await defaultAgent(base);
  const url = `${base}/?voidProject=${encodeURIComponent(project.id)}`;
  if (!argFlag('--no-open')) openBrowser(url);
  console.log(`project: ${project.name} (${project.id})`);
  console.log(`url: ${url}`);
  if (agent?.cmd) console.log(`agent: ${agent.cmd}`);
  if (argFlag('--no-agent') || !agent?.cmd) return 0;
  return runAgent(agent.cmd, cwd);
}

main().then((code) => { process.exitCode = code; }).catch((e) => {
  console.error(String(e?.stack || e));
  process.exitCode = 1;
});
