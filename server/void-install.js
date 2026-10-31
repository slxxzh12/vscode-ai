import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const VOID_CMD = [
  '@echo off',
  'if exist "%~dp0..\\runtime\\node.exe" (',
  '  "%~dp0..\\runtime\\node.exe" "%~dp0..\\server\\cli\\void.js" %*',
  ') else (',
  '  node "%~dp0..\\server\\cli\\void.js" %*',
  ')',
  '',
].join('\r\n');

const VOID_SH = [
  '#!/bin/sh',
  'DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)',
  'if [ -x "$DIR/runtime/node" ]; then',
  '  exec "$DIR/runtime/node" "$DIR/server/cli/void.js" "$@"',
  'fi',
  'exec node "$DIR/server/cli/void.js" "$@"',
  '',
].join('\n');

export function ensureVoidWrapper({ appDir, platform = process.platform } = {}) {
  const binDir = path.join(appDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  if (platform === 'win32') {
    const file = path.join(binDir, 'void.cmd');
    fs.writeFileSync(file, VOID_CMD, 'utf8');
    return { binDir, file };
  }
  const file = path.join(binDir, 'void');
  fs.writeFileSync(file, VOID_SH, 'utf8');
  try { fs.chmodSync(file, 0o755); } catch { /* best-effort */ }
  return { binDir, file };
}

export function mergePath(current, binDir, platform = process.platform) {
  const sep = platform === 'win32' ? ';' : ':';
  const norm = (s) => {
    const v = String(s || '').trim().replace(/[\\/]+$/, '');
    return platform === 'win32' ? v.toLowerCase() : v;
  };
  const target = norm(binDir);
  const parts = String(current || '').split(sep).filter((x) => x.trim() !== '');
  if (parts.some((x) => norm(x) === target)) return { path: parts.join(sep), added: false };
  return { path: [...parts, binDir].join(sep), added: true };
}

function readWindowsUserPath() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(String(r.stderr || 'read PATH failed').trim());
  return String(r.stdout || '').replace(/\r?\n$/, '');
}

function writeWindowsUserPath(next) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-void-path-'));
  const valueFile = path.join(dir, 'path.txt');
  const scriptFile = path.join(dir, 'set-path.ps1');
  fs.writeFileSync(valueFile, String(next || ''), 'utf8');
  fs.writeFileSync(scriptFile, [
    'param([string]$ValueFile)',
    '$v = Get-Content -LiteralPath $ValueFile -Raw -Encoding UTF8',
    "New-ItemProperty -Path 'HKCU:\\Environment' -Name Path -PropertyType ExpandString -Value $v -Force | Out-Null",
    '',
  ].join('\r\n'), 'utf8');
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-ValueFile', valueFile], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (r.status !== 0) throw new Error(String(r.stderr || 'write PATH failed').trim());
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function installVoid({
  appDir,
  platform = process.platform,
  readPath = readWindowsUserPath,
  writePath = writeWindowsUserPath,
} = {}) {
  const wrapper = ensureVoidWrapper({ appDir, platform });
  if (platform !== 'win32') return { ...wrapper, added: false, unsupported: true };
  const cur = readPath();
  const merged = mergePath(cur, wrapper.binDir, platform);
  if (merged.added) writePath(merged.path);
  return { ...wrapper, added: merged.added, unsupported: false };
}
