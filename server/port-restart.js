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

// 异步（detached + unref）拉起「等我退出后重启我」的助手；调用方随后应立即 process.exit(0)
export function spawnRestart({ appDir, pid = process.pid, platform = process.platform, spawnFn = spawn } = {}) {
  const child = platform === 'win32'
    ? spawnFn('powershell.exe', [
        '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
        `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; Start-Process -FilePath '${path.join(appDir, 'start.bat')}'`,
      ], { cwd: appDir, detached: true, stdio: 'ignore', windowsHide: true })
    : spawnFn('sh', [
        '-c',
        `while kill -0 ${pid} 2>/dev/null; do sleep 0.3; done; open "${path.join(appDir, 'start.command')}"`,
      ], { cwd: appDir, detached: true, stdio: 'ignore' });
  if (child && typeof child.unref === 'function') child.unref();
  return true;
}
