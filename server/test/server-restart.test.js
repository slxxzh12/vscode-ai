import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { restartGuard, RESTART_CODES } from '../port-restart.js';

// 与 index.js 的接线一致：guard 的判定就是接口的 409 条件
test('接口 409 条件：env 钉住', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-srvrestart-'));
  fs.writeFileSync(path.join(dir, 'start.bat'), '', 'utf8');
  const g = restartGuard({ appDir: dir, envPort: '33333', platform: 'win32' });
  assert.equal(g.code, RESTART_CODES.ENV_PINNED);
});

test('接口 409 条件：非绿色包', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-srvrestart-'));
  const g = restartGuard({ appDir: dir, envPort: '', platform: 'win32' });
  assert.equal(g.code, RESTART_CODES.NOT_PACKAGED);
});

test('接口放行条件：有 start.bat 且未设 env → restartable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-srvrestart-'));
  fs.writeFileSync(path.join(dir, 'start.bat'), '@echo off\n', 'utf8');
  assert.equal(restartGuard({ appDir: dir, envPort: '', platform: 'win32' }).ok, true);
});
