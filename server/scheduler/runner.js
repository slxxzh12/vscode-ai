import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { wrapCmdBin } from '../win-spawn.js';

export function resolveCwd(task, projectRoot, fallback) {
  return task.cwd || projectRoot || fallback;
}

// 去掉开头的 YAML frontmatter，避免 prompt 以 `---` 开头被当成命令行参数
export function stripFrontmatter(s) {
  return String(s ?? '').replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

export function buildSpawnSpec(task, { cwd, aiBin = 'opencode', aiPrompt = null, opencodeDataDir = null } = {}) {
  const ocEnv = opencodeDataDir ? { XDG_DATA_HOME: opencodeDataDir } : undefined;
  if (task.type === 'shell') {
    if (process.platform === 'win32') return { bin: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', task.command], cwd };
    return { bin: '/bin/sh', args: ['-c', task.command], cwd };
  }
  if (task.type === 'ai') {
    if (task.ai && task.ai.source === 'command' && task.ai.commandName) {
      const name = String(task.ai.commandName).replace(/\.md$/i, '');
      return { bin: aiBin, args: ['run', '--command', name], cwd, env: ocEnv };
    }
    if (task.ai && task.ai.source === 'file' && task.filePath) {
      // 注意：--file 是数组型，会把其后的位置参数也当成文件；消息必须放在 --file 之前
      const msg = String(task.ai.prompt || '').trim();
      const args = ['run'];
      if (msg) args.push(msg);
      args.push('--file', task.filePath);
      return { bin: aiBin, args, cwd, env: ocEnv };
    }
    return { bin: aiBin, args: ['run', stripFrontmatter(aiPrompt ?? '')], cwd, env: ocEnv };
  }
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
        const { bin, args } = wrapCmdBin(spec.bin, spec.args);   // .cmd/.bat 在 Windows 上必须经 cmd.exe
        child = spawnFn(bin, args, { cwd: spec.cwd, env: spec.env ? { ...process.env, ...spec.env } : undefined, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
