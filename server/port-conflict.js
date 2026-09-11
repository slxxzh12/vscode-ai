import net from 'node:net';
import { execFile } from 'node:child_process';

// 从 netstat 文本解析指定端口处于 LISTENING 的 PID（IPv4 / IPv6）。
export function parseListeningPids(output, port) {
  const want = Number(port);
  const pids = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (!m) continue;
    if (Number(m[2]) !== want) continue;
    pids.add(Number(m[3]));
  }
  return [...pids];
}

function run(cmd, args, execFn) {
  return new Promise((resolve) => {
    execFn(cmd, args, { windowsHide: true }, (err, stdout) => resolve({ err, stdout: stdout || '' }));
  });
}

export async function findPidsOnPort(port, { exec = execFile } = {}) {
  const { err, stdout } = await run('netstat', ['-ano', '-p', 'tcp'], exec);
  if (err) return [];
  return parseListeningPids(stdout, port);
}

export async function killPids(pids, { exec = execFile } = {}) {
  const killed = [];
  for (const raw of pids || []) {
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const { err } = await run('taskkill', ['/F', '/T', '/PID', String(pid)], exec);
    if (!err) killed.push(pid);
  }
  return killed;
}

// 探测 host:port 是否可监听（EADDRINUSE / 其他绑定错误 / 超时 => false）。
export function isPortFree(host, port, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { srv.close(); } catch { /* ignore */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    srv.once('error', () => finish(false));
    srv.once('listening', () => finish(true));
    try { srv.listen(port, host); } catch { finish(false); }
  });
}
