import { spawn } from 'node:child_process';

// 在服务端所在机器弹出系统对话框，返回所选绝对路径。
// 仅在 Windows 可用（服务端与浏览器同机）。返回 { path } / { cancelled:true } / { error }
function execPs(ps, { timeoutMs = 300000, platform = process.platform, spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    if (platform !== 'win32') { resolve({ error: 'unsupported' }); return; }
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

function runDialog(setupLines, resultExpr, opts = {}) {
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    // 重定向的 stdout 默认按控制台 OEM 代码页（如 936/GBK）编码，Node 按 UTF-8 解码会乱码。
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized',
    ...setupLines,
    `if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write(${resultExpr}) }`,
    '$owner.Dispose()',
  ].join('; ');
  return execPs(ps, opts);
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

export function pickSqliteFile(opts) {
  return runDialog([
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    "$d.Filter = 'SQLite|*.db;*.sqlite;*.sqlite3;*.db3|All files|*.*'",
  ], '$d.FileName', opts);
}

// Vista+ 原生文件夹选择器（带可编辑地址栏/文件夹名输入框），可手动输入或粘贴路径；
// 旧版 FolderBrowserDialog 只能一级一级点，已替换。
const FOLDER_PICKER_CS = `
using System;
using System.Runtime.InteropServices;

public static class FolderPicker {
    const uint FOS_PICKFOLDERS = 0x20;
    const uint FOS_FORCEFILESYSTEM = 0x40;
    const uint FOS_PATHMUSTEXIST = 0x800;
    const uint SIGDN_FILESYSPATH = 0x80058000;

    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    class FileOpenDialog { }

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint c, IntPtr f);
        void SetFileTypeIndex(uint i);
        void GetFileTypeIndex(out uint i);
        void Advise(IntPtr p, out uint c);
        void Unadvise(uint c);
        void SetOptions(uint fos);
        void GetOptions(out uint fos);
        void SetDefaultFolder(IShellItem i);
        void SetFolder(IShellItem i);
        void GetFolder(out IShellItem i);
        void GetCurrentSelection(out IShellItem i);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string s);
        void GetFileName(out IntPtr s);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string s);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string s);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string s);
        void GetResult(out IShellItem i);
        void AddPlace(IShellItem i, int f);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string s);
        void Close(int hr);
        void SetClientGuid(ref Guid g);
        void ClearClientData();
        void SetFilter(IntPtr f);
        void GetResults(out IntPtr p);
        void GetSelectedItems(out IntPtr p);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem i);
        void GetDisplayName(uint sigdn, out IntPtr p);
        void GetAttributes(uint mask, out uint attrs);
        void Compare(IShellItem i, uint hint, out int order);
    }

    public static string Pick(IntPtr owner, string title) {
        var d = (IFileOpenDialog)new FileOpenDialog();
        uint opts;
        d.GetOptions(out opts);
        d.SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
        if (title != null && title.Length > 0) d.SetTitle(title);
        if (d.Show(owner) != 0) return null;
        IShellItem item;
        d.GetResult(out item);
        IntPtr p;
        item.GetDisplayName(SIGDN_FILESYSPATH, out p);
        if (p == IntPtr.Zero) return null;
        string s = Marshal.PtrToStringUni(p);
        Marshal.FreeCoTaskMem(p);
        return s;
    }
}
`;

export async function pickFolder(opts) {
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized',
    'Add-Type -TypeDefinition @"',
    FOLDER_PICKER_CS,
    '"@',
    "$p = [FolderPicker]::Pick($owner.Handle, 'Select a folder')",
    '$owner.Dispose()',
    'if ($p) { [Console]::Out.Write($p) }',
  ].join('\n');
  const r = await execPs(ps, opts);
  // 仅当新版选择器初始化/调用失败（Add-Type/COM 异常）时回退旧版，避免通用对话框错误被吞掉。
  const comFailed = r && r.error === 'dialog-failed'
    && /Add-Type|TypeDefinition|IFileOpenDialog|FolderPicker|ShellItem/i.test(String(r.message || ''));
  if (comFailed) {
    return runDialog([
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$d.Description = 'Select a folder'",
    ], '$d.SelectedPath', opts);
  }
  return r;
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
