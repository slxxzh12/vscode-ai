import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { restartGuard, spawnRestart } from '../port-restart.js';

function tmpApp({ withBat = false, withCommand = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-restart-'));
  if (withBat) fs.writeFileSync(path.join(dir, 'start.bat'), '@echo off\n', 'utf8');
  if (withCommand) fs.writeFileSync(path.join(dir, 'start.command'), '#!/bin/bash\n', 'utf8');
  return dir;
}

test('DEVFLOW_PORT 已设 → env-port-pinned', () => {
  const appDir = tmpApp({ withBat: true });
  const g = restartGuard({ appDir, envPort: '33333', platform: 'win32' });
  assert.equal(g.ok, false);
  assert.equal(g.code, 'env-port-pinned');
  assert.match(g.message, /DEVFLOW_PORT/);
});

test('非绿色包（无 start.bat / start.command）→ not-packaged', () => {
  const appDir = tmpApp();
  assert.equal(restartGuard({ appDir, envPort: '', platform: 'win32' }).code, 'not-packaged');
  assert.equal(restartGuard({ appDir, envPort: '', platform: 'darwin' }).code, 'not-packaged');
});

test('绿色包（有 start.bat）且未设 env → 放行', () => {
  const appDir = tmpApp({ withBat: true });
  const g = restartGuard({ appDir, envPort: '', platform: 'win32' });
  assert.equal(g.ok, true);
  assert.equal(g.launcher, 'start.bat');
});

test('macOS 绿色包（有 start.command）→ 放行', () => {
  const appDir = tmpApp({ withCommand: true });
  const g = restartGuard({ appDir, envPort: '', platform: 'darwin' });
  assert.equal(g.ok, true);
  assert.equal(g.launcher, 'start.command');
});

test('env 为空串/未定义/纯空白视为未设', () => {
  const appDir = tmpApp({ withBat: true });
  assert.equal(restartGuard({ appDir, envPort: undefined, platform: 'win32' }).ok, true);
  assert.equal(restartGuard({ appDir, envPort: '   ', platform: 'win32' }).ok, true);
});

test('spawnRestart：Windows 用等待本进程退出的助手并 detached', () => {
  const calls = [];
  const fakeSpawn = (bin, args, opts) => { calls.push({ bin, args, opts }); return { unref() { calls.push({ unref: true }); } }; };
  spawnRestart({ appDir: 'C:\\app', pid: 4321, platform: 'win32', spawnFn: fakeSpawn });
  assert.equal(calls[0].bin, 'powershell.exe');
  assert.ok(calls[0].args.join(' ').includes('Wait-Process -Id 4321'));
  assert.ok(calls[0].args.join(' ').includes('start.bat'));
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.windowsHide, true);
  assert.deepEqual(calls[1], { unref: true });
});

test('spawnRestart：macOS 轮询进程退出后 open start.command', () => {
  const calls = [];
  const fakeSpawn = (bin, args, opts) => { calls.push({ bin, args, opts }); return { unref() {} }; };
  spawnRestart({ appDir: '/app', pid: 99, platform: 'darwin', spawnFn: fakeSpawn });
  assert.equal(calls[0].bin, 'sh');
  assert.ok(calls[0].args.join(' ').includes('kill -0 99'));
  assert.ok(calls[0].args.join(' ').includes('start.command'));
  assert.equal(calls[0].opts.detached, true);
});
