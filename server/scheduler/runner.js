import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function resolveCwd(task, projectRoot, fallback) {
  return task.cwd || projectRoot || fallback;
}

export function buildSpawnSpec(task, { cwd, aiBin = 'opencode', aiPrompt = null }) {
  if (task.type === 'shell') {
    if (process.platform === 'win32') return { bin: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', task.command], cwd };
    return { bin: '/bin/sh', args: ['-c', task.command], cwd };
  }
  if (task.type === 'ai') return { bin: aiBin, args: ['run', aiPrompt ?? ''], cwd };
  if (task.type === 'script') {
    const abs = path.isAbsolute(task.script.path) ? task.script.path : path.join(cwd, task.script.path);
    const ext = path.extname(abs).toLowerCase();
    if (ext === '.ps1') return { bin: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', abs], cwd };
    if (ext === '.bat' || ext === '.cmd') return { bin: 'cmd.exe', args: ['/c', abs], cwd };
    if (ext === '.sh') return { bin: 'bash', args: [abs], cwd };
    if (ext === '.py') return { bin: 'python', args: [abs], cwd };
    throw Object.assign(new Error('unsupported script type'), { code: 'unsupported-script' });
  }
  throw Object.assign(new Error('unknown task type'), { code: 'bad-task' });
}

function defaultKill(child) {
  if (!child) return;
  try {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else child.kill('SIGKILL');
  } catch { /* ignore */ }
}

export function createRunner({ spawnFn = spawn, killChild = defaultKill } = {}) {
  const running = new Map();

  function run({ runId, spec, logPath, timeoutMs = 0, onData, onExit }) {
    return new Promise((resolve) => {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const stream = fs.createWriteStream(logPath, { flags: 'a' });
      let child;
      try {
        child = spawnFn(spec.bin, spec.args, { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch (e) {
        stream.end();
        const result = { exitCode: -1, timedOut: false, spawnError: true, error: String(e && e.message || e), durationMs: 0 };
        onExit?.(result);
        return resolve(result);
      }
      running.set(runId, child);
      const startedAt = Date.now();
      let done = false;
      let timedOut = false;
      const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killChild(child); finish(null); }, timeoutMs) : null;
      const write = (c) => { stream.write(c); onData?.(String(c)); };
      child.stdout?.on('data', write);
      child.stderr?.on('data', write);
      const finish = (code, spawnError = false, errMsg = null) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        running.delete(runId);
        const result = { exitCode: code ?? null, timedOut, spawnError, error: errMsg, durationMs: Date.now() - startedAt };
        onExit?.(result);
        stream.end(() => resolve(result));
      };
      child.on('error', (e) => finish(-1, true, String(e && e.message || e)));
      child.on('close', (code) => finish(code, false, null));
    });
  }

  function stop(runId) {
    const child = running.get(runId);
    if (!child) return false;
    killChild(child);
    return true;
  }
  return { run, stop, isRunning: (id) => running.has(id), count: () => running.size };
}
