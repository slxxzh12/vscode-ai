import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { t } from './i18n.js';

export const RESTART_CODES = { ENV_PINNED: 'env-port-pinned', NOT_PACKAGED: 'not-packaged' };

// 绿色包才能一键重启：非绿色包没有启动器；dev 的端口被 DEVFLOW_PORT 钉住，重启也换不了端口
export function restartGuard({ appDir, envPort = process.env.DEVFLOW_PORT, platform = process.platform, exists = fs.existsSync } = {}) {
  if (envPort != null && String(envPort).trim() !== '') {
    return { ok: false, code: RESTART_CODES.ENV_PINNED, message: t('term.port_restart_pinned') };
  }
  const launcher = platform === 'win32' ? 'start.bat' : 'start.command';
  if (!exists(path.join(appDir, launcher))) {
    return { ok: false, code: RESTART_CODES.NOT_PACKAGED, message: t('term.port_restart_notpackaged') };
  }
  return { ok: true, launcher };
}

// 异步（detached）拉起「等我退出后重启我」的助手；调用方随后应立即 process.exit(0)
// Windows 注意：助手不能带 windowsHide（=CREATE_NO_WINDOW），否则它仍挂在服务的控制台上，
// 服务一退、控制台一关助手就被一起杀掉，导致「旧实例退了、新实例没起」。
// 用 `cmd /c start /min` 让助手跑在独立的新控制台里，从而活过本进程退出。
export function spawnRestart({ appDir, pid = process.pid, platform = process.platform, spawnFn = spawn } = {}) {
  const wait = `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; Start-Process -FilePath '${path.join(appDir, 'start.bat')}'`;
  const child = platform === 'win32'
    ? spawnFn('cmd.exe', [
        '/c', 'start', '""', '/min',
        'powershell.exe', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', wait,
      ], { cwd: appDir, detached: true, stdio: 'ignore' })
    : spawnFn('sh', [
        '-c',
        `while kill -0 ${pid} 2>/dev/null; do sleep 0.3; done; open "${path.join(appDir, 'start.command')}"`,
      ], { cwd: appDir, detached: true, stdio: 'ignore' });
  if (child && typeof child.unref === 'function') child.unref();
  return true;
}
