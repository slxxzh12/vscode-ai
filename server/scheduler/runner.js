import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { wrapCmdBin } from '../win-spawn.js';
import { AGENT_ENV } from '../agent-env.js';

export function resolveCwd(task, projectRoot, fallback) {
  return task.cwd || projectRoot || fallback;
}

// 去掉开头的 YAML frontmatter，避免 prompt 以 `---` 开头被当成命令行参数
export function stripFrontmatter(s) {
  return String(s ?? '').replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

export function buildSpawnSpec(task, { cwd, aiBin = 'opencode', aiPrompt = null, opencodeDataDir = null, runContextPath = null, jobCallback = null, promptFilePath = null, jsonFormat = false } = {}) {
  const jsonArgs = jsonFormat ? ['--format', 'json'] : [];
  const ocEnv = {
    ...AGENT_ENV,
    ...(opencodeDataDir ? { XDG_DATA_HOME: opencodeDataDir } : {}),
    ...(jobCallback ? {
      DEVFLOW_JOB_ID: jobCallback.jobId,
      DEVFLOW_JOB_TOKEN: jobCallback.token,
      DEVFLOW_JOB_CALLBACK: jobCallback.url,
    } : {}),
  };
  const withContext = (spec) => {
    if (!runContextPath) return spec;
    return { ...spec, env: { ...(spec.env || {}), DEVFLOW_RUN_CONTEXT: runContextPath } };
  };
  if (task.type === 'shell') {
    if (process.platform === 'win32') return withContext({ bin: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', task.command], cwd });
    return withContext({ bin: '/bin/sh', args: ['-c', task.command], cwd });
  }
  if (task.type === 'ai') {
    if (task.ai && task.ai.source === 'command' && task.ai.commandName) {
      const name = String(task.ai.commandName).replace(/\.md$/i, '');
      return withContext({ bin: aiBin, args: ['run', '--command', name, ...jsonArgs], cwd, env: ocEnv });
    }
    if (task.ai && task.ai.source === 'file' && task.filePath) {
      // 注意：--file 是数组型，会把其后的位置参数也当成文件；消息必须放在 --file 之前
      const msg = String(task.ai.prompt || '').trim();
      const args = ['run'];
      if (msg) args.push(msg);
      args.push('--file', task.filePath, ...jsonArgs);
      return withContext({ bin: aiBin, args, cwd, env: ocEnv });
    }
    if (task.ai && task.ai.source === 'prompt' && promptFilePath) {
      return withContext({ bin: aiBin, args: ['run', '--file', promptFilePath, ...jsonArgs], cwd, env: ocEnv });
    }
    return withContext({ bin: aiBin, args: ['run', stripFrontmatter(aiPrompt ?? ''), ...jsonArgs], cwd, env: ocEnv });
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
      let stdout = '';
      const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killChild(child); finish(null); }, timeoutMs) : null;
      const write = (c) => { stream.write(c); onData?.(String(c)); };
      child.stdout?.on('data', (c) => { stdout += String(c); write(c); });
      child.stderr?.on('data', write);
      const finish = (code, spawnError = false, errMsg = null) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        running.delete(runId);
        const result = { exitCode: code ?? null, timedOut, spawnError, error: errMsg, durationMs: Date.now() - startedAt, stdout };
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
