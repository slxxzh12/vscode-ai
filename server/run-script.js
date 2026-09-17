import { spawn as nodeSpawn } from 'node:child_process';

export const RUNNABLE_EXT = new Set(['bat', 'cmd', 'ps1', 'sh']);

// 执行脚本（双击效果：独立进程/独立控制台窗口，不阻塞请求）。
// 平台与 spawn 可注入，便于在非目标平台上做纯逻辑单测。
export function runScript(abs, ext, { platform = process.platform, spawn = nodeSpawn } = {}) {
  if (platform !== 'win32') {
    if (ext === 'sh') {
      const p = spawn('bash', [abs], { detached: true, stdio: 'ignore' });
      p.unref();
      return true;
    }
    return false;
  }
  if (ext === 'bat' || ext === 'cmd') {
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath ${JSON.stringify(abs)}`], { detached: true, stdio: 'ignore', windowsHide: false });
    p.unref();
    return true;
  }
  if (ext === 'ps1') {
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${JSON.stringify(abs)}`], { detached: true, stdio: 'ignore', windowsHide: false });
    p.unref();
    return true;
  }
  return false;
}
