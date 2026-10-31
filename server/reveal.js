import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

// Windows 下尝试把资源管理器窗口置顶（best-effort，晚 400ms 激活最新 explorer 窗口）。
// 独立成可注入 spawn/延时的工厂，便于单测（单测注入 delayMs=0 + 假 spawn）。
export function makeFocus(spawn, delayMs = 400) {
  return () => {
    setTimeout(() => {
      const focus = spawn('powershell.exe', [
        '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
        `$sh=New-Object -ComObject WScript.Shell; $w=Get-Process explorer | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -Last 1; if ($w) { [void]$sh.AppActivate($w.Id) }`,
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      focus.unref();
    }, delayMs);
  };
}

// 在宿主机上用系统文件管理器展示目标（文件 → 定位选中；目录 → 打开）。
// Windows：直接 spawn explorer（/select 必须作为同一参数），不要用 cmd start（会回退到“文档”）。
// platform/spawn/focus 可注入，便于在非目标平台做纯逻辑单测。
export function revealInOs(abs, isDir, { platform = process.platform, spawn = nodeSpawn, focus } = {}) {
  if (platform === 'win32') {
    const arg = isDir ? abs : `/select,${abs}`;
    const p = spawn('explorer', [arg], { detached: true, stdio: 'ignore' });
    p.unref();
    (focus || makeFocus(spawn))();
    return true;
  }
  if (platform === 'darwin') {
    const p = spawn('open', isDir ? [abs] : ['-R', abs], { detached: true, stdio: 'ignore' });
    p.unref();
    return true;
  }
  if (platform === 'linux') {
    const p = spawn('xdg-open', [isDir ? abs : path.dirname(abs)], { detached: true, stdio: 'ignore' });
    p.unref();
    return true;
  }
  return false;
}
