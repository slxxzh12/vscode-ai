import { withAgentEnv } from './agent-env.js';

export function pickShell() {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: [] };
  return { file: process.env.SHELL || '/bin/bash', args: [] };
}

// 把 node-pty 原始对象归一化为内部 PseudoPty 接口。
export function makePseudoPty(raw, shell) {
  const state = { dataCb: null, exitCb: null };
  raw.onData((data) => { if (state.dataCb) state.dataCb(String(data)); });
  raw.onExit((info) => { if (state.exitCb) state.exitCb(info && typeof info === 'object' ? info.exitCode : info); });
  return {
    pid: raw.pid,
    shell,
    onData(cb) { if (state.dataCb) throw new Error('onData already registered'); state.dataCb = cb; },
    onExit(cb) { if (state.exitCb) throw new Error('onExit already registered'); state.exitCb = cb; },
    write(s) { raw.write(String(s)); },
    resize(c, r) { raw.resize(c, r); },
    kill() { raw.kill(); },
  };
}

export async function createPty({ cwd = process.cwd(), cols = 80, rows = 24, env = null } = {}) {
  // 动态 import：避免在单测进程里强行加载原生模块（单测只走 fake pty）
  const { spawn } = await import('node-pty');
  const shell = pickShell();
  const raw = spawn(shell.file, shell.args, {
    name: 'xterm-256color', cols, rows, cwd,
    env: withAgentEnv(env ? { ...process.env, ...env } : process.env),
  });
  return makePseudoPty(raw, process.platform === 'win32' ? 'win' : 'unix');
}

export function buildMarkerCmd(cmd, runId, idx, shell) {
  // 注意：PowerShell 5.1 不解析 "\u001b"，必须用 [char]27 构造真正的 ESC。
  if (shell === 'win') {
    return `${cmd}; [Console]::Write(([char]27) + ']777;dfdone;${runId}_${idx}' + ([char]7))`;
  }
  return `${cmd}; printf '\\x1b]777;dfdone;${runId}_${idx}\\x07'`;
}
