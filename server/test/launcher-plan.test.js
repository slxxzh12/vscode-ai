import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeLaunchPs1 } = require('../../scripts/launcher.js');

const isWin = process.platform === 'win32';

// 起一个一次性 TCP 监听，用来制造「端口存活」
function listen(port) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

function writeLauncher({ desired, running }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-plan-'));
  fs.mkdirSync(path.join(root, 'script'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  // 必须带 BOM：PowerShell 5.1 对无 BOM 的 UTF-8 .ps1 会按 ANSI 解码，含中文即语法错误
  fs.writeFileSync(path.join(root, 'script', 'launch.ps1'), '\uFEFF' + makeLaunchPs1({ port: 22222 }), 'utf8');
  if (desired != null) fs.writeFileSync(path.join(root, 'data', 'port.txt'), String(desired), 'utf8');
  if (running != null) fs.writeFileSync(path.join(root, 'data', 'runtime-port.txt'), String(running), 'utf8');
  return path.join(root, 'script', 'launch.ps1');
}

function runPlan(script) {
  return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Plan', '-NoBrowser', '-NoShortcut'], { encoding: 'utf8' });
}

test('desired == running 且存活 → action=open', { skip: !isWin }, async () => {
  const p = await freePort();
  const srv = await listen(p);
  try {
    const out = runPlan(writeLauncher({ desired: p, running: p }));
    assert.match(out, new RegExp(`PLAN desired=${p} running=${p} alive=1 action=open`));
  } finally { srv.close(); }
});

test('desired != running 且 running 存活 → action=restart', { skip: !isWin }, async () => {
  const running = await freePort();
  const desired = await freePort();
  const srv = await listen(running);
  try {
    const out = runPlan(writeLauncher({ desired, running }));
    assert.match(out, new RegExp(`PLAN desired=${desired} running=${running} alive=1 action=restart`));
  } finally { srv.close(); }
});

test('running 不存活 → action=start', { skip: !isWin }, async () => {
  const running = await freePort();   // 拿到就关掉了，没人监听
  const desired = await freePort();
  const out = runPlan(writeLauncher({ desired, running }));
  assert.match(out, new RegExp(`PLAN desired=${desired} running=${running} alive=0 action=start`));
});

test('缺 port.txt → desired 回落到构建默认端口', { skip: !isWin }, async () => {
  const running = await freePort();
  const out = runPlan(writeLauncher({ running }));
  assert.match(out, /PLAN desired=22222 /);
});
