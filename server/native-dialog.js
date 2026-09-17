import { spawn } from 'node:child_process';

// 在服务端所在机器弹出系统对话框，返回所选绝对路径。
// 仅在 Windows 可用（服务端与浏览器同机）。返回 { path } / { cancelled:true } / { error }
function runDialog(setupLines, resultExpr, { timeoutMs = 300000, platform = process.platform, spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    if (platform !== 'win32') { resolve({ error: 'unsupported' }); return; }
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
      child = spawnFn('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true });
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

// 端口占用对话框：三选一（结束进程重启 / 换端口 / 取消）。
// 返回 { action:'kill' } | { action:'switch', port:n } | { action:'cancel' } | { error }
// 文案经环境变量传给 PowerShell，避免中英文引号/换行在 -Command 中转义出错。
export function askPortConflict({
  port,
  candidates = [],
  title = '',
  message = '',
  killLabel = '',
  switchLabel = '',
  warnLabel = '',
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  timeoutMs = 120000,
  platform = process.platform,
  spawnFn = spawn,
} = {}) {
  return new Promise((resolve) => {
    if (platform !== 'win32') { resolve({ error: 'unsupported' }); return; }
    const env = {
      ...process.env,
      DF_PC_TITLE: String(title),
      DF_PC_MESSAGE: String(message),
      DF_PC_KILL: String(killLabel),
      DF_PC_SWITCH: String(switchLabel),
      DF_PC_WARN: String(warnLabel),
      DF_PC_OK: String(okLabel),
      DF_PC_CANCEL: String(cancelLabel),
      DF_PC_CANDIDATES: JSON.stringify((candidates || []).map(String)),
    };
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$f = New-Object System.Windows.Forms.Form',
      '$f.Text = $env:DF_PC_TITLE',
      '$f.TopMost = $true',
      '$f.StartPosition = "CenterScreen"',
      '$f.FormBorderStyle = "FixedDialog"',
      '$f.MaximizeBox = $false; $f.MinimizeBox = $false',
      '$f.Width = 520; $f.Height = 262',
      '$msg = New-Object System.Windows.Forms.Label',
      '$msg.Text = $env:DF_PC_MESSAGE; $msg.SetBounds(16,12,480,22)',
      '$kill = New-Object System.Windows.Forms.RadioButton',
      '$kill.Text = $env:DF_PC_KILL; $kill.SetBounds(16,44,480,24); $kill.Checked = $true',
      '$sw = New-Object System.Windows.Forms.RadioButton',
      '$sw.Text = $env:DF_PC_SWITCH; $sw.SetBounds(16,76,480,24)',
      '$cb = New-Object System.Windows.Forms.ComboBox',
      '$cb.DropDownStyle = "DropDown"; $cb.SetBounds(36,106,160,24)',
      '$cands = ConvertFrom-Json $env:DF_PC_CANDIDATES',
      'foreach ($c in $cands) { [void]$cb.Items.Add([string]$c) }',
      'if ($cb.Items.Count -gt 0) { $cb.Text = [string]$cb.Items[0] }',
      '$warn = New-Object System.Windows.Forms.Label',
      '$warn.Text = $env:DF_PC_WARN; $warn.SetBounds(16,138,480,46); $warn.ForeColor = "Firebrick"',
      '$ok = New-Object System.Windows.Forms.Button; $ok.Text = $env:DF_PC_OK; $ok.SetBounds(300,190,90,28); $ok.DialogResult = "OK"',
      '$cx = New-Object System.Windows.Forms.Button; $cx.Text = $env:DF_PC_CANCEL; $cx.SetBounds(400,190,90,28); $cx.DialogResult = "Cancel"',
      '$f.Controls.AddRange(@($msg,$kill,$sw,$cb,$warn,$ok,$cx))',
      '$f.AcceptButton = $ok; $f.CancelButton = $cx',
      '$r = $f.ShowDialog()',
      'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { if ($kill.Checked) { [Console]::Out.Write("kill") } else { [Console]::Out.Write("switch:" + $cb.Text) } }',
      '$f.Dispose()',
    ].join('; ');
    let out = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let child;
    try {
      child = spawnFn('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true, env });
    } catch { done({ error: 'spawn-failed' }); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } done({ action: 'cancel' }); }, timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => { clearTimeout(timer); done({ error: 'spawn-failed' }); });
    child.on('close', () => {
      clearTimeout(timer);
      const p = out.trim();
      if (p === 'kill') return done({ action: 'kill' });
      if (p.startsWith('switch:')) {
        const n = Number(p.slice('switch:'.length));
        if (Number.isInteger(n) && n >= 1 && n <= 65535) return done({ action: 'switch', port: n });
        return done({ error: 'bad-port' });
      }
      done({ action: 'cancel' });
    });
  });
}
