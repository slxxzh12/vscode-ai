import { spawn } from 'node:child_process';

// 在服务端所在机器弹出系统对话框，返回所选绝对路径。
// 仅在 Windows 可用（服务端与浏览器同机）。返回 { path } / { cancelled:true } / { error }
function runDialog(setupLines, resultExpr, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve({ error: 'unsupported' }); return; }
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$owner = New-Object System.Windows.Forms.Form',
      '$owner.TopMost = $true',
      '$owner.ShowInTaskbar = $false',
      '$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized',
      ...setupLines,
      `if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write(${resultExpr}) }`,
      '$owner.Dispose()',
    ].join('; ');
    let out = '';
    let err = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let child;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true });
    } catch { done({ error: 'spawn-failed' }); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } done({ cancelled: true }); }, timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', () => { clearTimeout(timer); done({ error: 'spawn-failed' }); });
    child.on('close', () => {
      clearTimeout(timer);
      const p = out.trim();
      if (p) done({ path: p });
      else if (err.trim()) done({ error: 'dialog-failed', message: err.trim().slice(0, 500) });
      else done({ cancelled: true });
    });
  });
}

export function pickFile(opts) {
  return runDialog([
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    "$d.Filter = 'Supported|*.md;*.py;*.bat;*.cmd;*.ps1;*.sh|AI command (*.md)|*.md|Scripts|*.py;*.bat;*.cmd;*.ps1;*.sh|All files|*.*'",
  ], '$d.FileName', opts);
}

export function pickAnyFile(opts) {
  return runDialog([
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    "$d.Filter = 'All files|*.*'",
  ], '$d.FileName', opts);
}

export function pickFolder(opts) {
  return runDialog([
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = 'Select a folder'",
  ], '$d.SelectedPath', opts);
}
