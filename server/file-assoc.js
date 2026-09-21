import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_DIR } from './port-file.js';
import { restartGuard } from './port-restart.js';

// 文件关联「默认用 Void 打开」的服务端模块：绿色包(win32)专用。
// 真实注册表读写在 launch.ps1（-Assoc apply|remove），这里只做偏好/状态/调用。
export const EXTENSIONS = ['.md', '.markdown', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.json', '.http', '.rest', '.curl'];

export function prefFile(appDir = APP_DIR) {
  return path.join(appDir, 'data', 'file-assoc.json');
}

export function loadPref(appDir = APP_DIR) {
  try {
    const p = JSON.parse(fs.readFileSync(prefFile(appDir), 'utf8'));
    return { enabled: !!p.enabled, prompted: !!p.prompted };
  } catch { return { enabled: false, prompted: false }; }
}

export function savePref(appDir, pref) {
  const file = prefFile(appDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { enabled: !!pref.enabled, prompted: !!pref.prompted };
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// 与「重启后端」同一门槛：win32 + 存在 start.bat（绿色包）+ 未被 DEVFLOW_PORT 钉住
export function available({ appDir = APP_DIR, platform = process.platform, envPort = process.env.DEVFLOW_PORT, exists = fs.existsSync } = {}) {
  if (platform !== 'win32') return { ok: false, launcher: '' };
  const g = restartGuard({ appDir, envPort, platform, exists });
  if (!g.ok) return { ok: false, launcher: '' };
  const launcher = path.join(appDir, 'script', 'launch.ps1');
  return { ok: exists(launcher), launcher };
}

export function parseDefaults(raw) {
  try {
    const o = JSON.parse(String(raw || '').trim() || '{}');
    const out = {};
    for (const [k, v] of Object.entries(o || {})) out[k] = v === true;
    return out;
  } catch { return {}; }
}

function psReadDefaults() {
  const list = EXTENSIONS.map((e) => `'${e}'`).join(',');
  return [
    '$o = @{}',
    `foreach ($e in @(${list})) {`,
    "  $p = (Get-ItemProperty -Path ('HKCU:\\Software\\Classes\\' + $e) -Name '(default)' -ErrorAction SilentlyContinue).'(default)'",
    "  $o[$e] = ($p -eq 'Void')",
    '}',
    '$o | ConvertTo-Json -Compress',
  ].join('; ');
}

function defaultRunPs({ spawnFn = spawn, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    if (platform !== 'win32') return resolve('{}');
    let child;
    try { child = spawnFn('powershell.exe', ['-NoProfile', '-Command', psReadDefaults()], { windowsHide: true }); }
    catch { return resolve('{}'); }
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => resolve('{}'));
    child.on('close', () => resolve(out));
  });
}

export async function getState({ appDir = APP_DIR, platform = process.platform, envPort = process.env.DEVFLOW_PORT, exists = fs.existsSync, runPs = null, spawnFn = spawn } = {}) {
  const avail = available({ appDir, platform, envPort, exists });
  if (!avail.ok) return { available: false, extensions: EXTENSIONS.map((ext) => ({ ext, isDefault: false })) };
  const run = runPs || (() => defaultRunPs({ spawnFn, platform }));
  const defaults = parseDefaults(await run());
  return { available: true, extensions: EXTENSIONS.map((ext) => ({ ext, isDefault: defaults[ext] === true })) };
}

export function runAssoc(appDir, action, { spawnFn = spawn, platform = process.platform } = {}) {
  if (platform !== 'win32') return false;
  const script = path.join(appDir, 'script', 'launch.ps1');
  const child = spawnFn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Assoc', action], { cwd: appDir, detached: true, stdio: 'ignore' });
  if (child && typeof child.unref === 'function') child.unref();
  return true;
}
