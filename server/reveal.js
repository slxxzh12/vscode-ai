import path from 'node:path';
import { spawn } from 'node:child_process';

// 在宿主机上用系统文件管理器展示目标（文件 → 定位选中；目录 → 打开）。
// Windows：直接 spawn explorer（/select 必须作为同一参数），不要用 cmd start（会回退到“文档”）。
export function revealInOs(abs, isDir) {
  if (process.platform === 'win32') {
    const arg = isDir ? abs : `/select,${abs}`;
    const p = spawn('explorer', [arg], { detached: true, stdio: 'ignore' });
    p.unref();
    // 尝试把资源管理器窗口置顶（best-effort，晚 400ms 激活最新 explorer 窗口）
    setTimeout(() => {
      const focus = spawn('powershell.exe', [
        '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
        `$sh=New-Object -ComObject WScript.Shell; $w=Get-Process explorer | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -Last 1; if ($w) { [void]$sh.AppActivate($w.Id) }`,
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      focus.unref();
    }, 400);
    return true;
  }
  if (process.platform === 'darwin') {
    const p = spawn('open', isDir ? [abs] : ['-R', abs], { detached: true, stdio: 'ignore' });
    p.unref();
    return true;
  }
  if (process.platform === 'linux') {
    const p = spawn('xdg-open', [isDir ? abs : path.dirname(abs)], { detached: true, stdio: 'ignore' });
    p.unref();
    return true;
  }
  return false;
}
