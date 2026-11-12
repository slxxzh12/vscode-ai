import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGKILL');
    }
  } catch { /* ignore */ }
}

export function runCommand({ cwd, command, logPath, timeoutMs = 600000 }) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const stream = fs.createWriteStream(logPath, { flags: 'a' });
    stream.write(`\n$ ${command}\n`);
    let child;
    try {
      child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      stream.end();
      return resolve({ ok: false, exitCode: null, timedOut: false, error: String(e && e.message || e) });
    }
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs) : null;
    child.stdout.on('data', (c) => stream.write(c));
    child.stderr.on('data', (c) => stream.write(c));
    const done = (exitCode, error = null) => {
      if (timer) clearTimeout(timer);
      stream.end();
      resolve({ ok: exitCode === 0 && !timedOut && !error, exitCode, timedOut, error });
    };
    child.on('error', (e) => done(null, String(e && e.message || e)));
    child.on('close', (code) => done(code ?? null));
  });
}
