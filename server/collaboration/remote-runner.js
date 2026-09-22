import { spawn } from 'node:child_process';
import { wrapCmdBin } from '../win-spawn.js';

// 封装 spawn 一次性命令：默认跑 `opencode run "<text>"`。
export function createOpenCodeRunner({
  bin = 'opencode',
  opencodePrefix = ['run'],
  timeoutMs = Number(process.env.OPENCODE_RUN_TIMEOUT_MS || 300000),
  maxBytes = Number(process.env.OPENCODE_RESULT_MAX_BYTES || 200 * 1024),
  spawnFn = spawn,
} = {}) {
  function truncate(buf) {
    if (buf.length <= maxBytes) return buf.toString('utf8');
    return buf.toString('utf8', 0, maxBytes) + '...[truncated]';
  }
  function execute({ text = null, args = null, cwd = process.cwd() }) {
    const argv = args ? args.slice() : [...opencodePrefix, text ?? ''];
    const { bin: runBin, args: runArgs } = wrapCmdBin(bin, argv);   // .cmd/.bat 在 Windows 上必须经 cmd.exe
    return new Promise((resolve) => {
      let child;
      try { child = spawnFn(runBin, runArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { return resolve({ exitCode: -1, stdout: '', stderr: String(e && e.message || e), timedOut: false, durationMs: 0, spawnError: true }); }
      const out = []; const errBuf = [];
      let done = false;
      const startedAt = Date.now();
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* noop */ }
        if (!done) { done = true; resolve({ exitCode: null, stdout: truncate(Buffer.concat(out)), stderr: truncate(Buffer.concat(errBuf)), timedOut: true, durationMs: Date.now() - startedAt, spawnError: false }); }
      }, timeoutMs);
      child.stdout.on('data', (c) => out.push(Buffer.from(c)));
      child.stderr.on('data', (c) => errBuf.push(Buffer.from(c)));
      child.on('error', (e) => {
        if (done) return; done = true; clearTimeout(timer);
        resolve({ exitCode: -1, stdout: truncate(Buffer.concat(out)), stderr: truncate(Buffer.concat(errBuf)) || String(e && e.message || e), timedOut: false, durationMs: Date.now() - startedAt, spawnError: true });
      });
      child.on('close', (code) => {
        if (done) return; done = true; clearTimeout(timer);
        resolve({ exitCode: code ?? null, stdout: truncate(Buffer.concat(out)), stderr: truncate(Buffer.concat(errBuf)), timedOut: false, durationMs: Date.now() - startedAt, spawnError: false });
      });
    });
  }
  return { execute, bin, timeoutMs, maxBytes };
}
