import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureVoidWrapper, mergePath, installVoid } from '../void-install.js';

test('ensureVoidWrapper 写入 Windows void.cmd，包含 runtime 与 cli 路径', () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-void-'));
  const r = ensureVoidWrapper({ appDir, platform: 'win32' });
  assert.equal(r.file, path.join(appDir, 'bin', 'void.cmd'));
  const text = fs.readFileSync(r.file, 'utf8');
  assert.match(text, /runtime\\node\.exe/);
  assert.match(text, /server\\cli\\void\.js/);
  assert.match(text, /%~dp0/);
});

test('ensureVoidWrapper 写入 POSIX void 脚本并可执行', () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-void-'));
  const r = ensureVoidWrapper({ appDir, platform: 'linux' });
  assert.equal(r.file, path.join(appDir, 'bin', 'void'));
  const text = fs.readFileSync(r.file, 'utf8');
  assert.match(text, /server\/cli\/void\.js/);
  if (process.platform !== 'win32') assert.ok((fs.statSync(r.file).mode & 0o111) !== 0);
});

test('mergePath 追加并去重（Windows 分号、大小写/尾斜杠不敏感）', () => {
  const a = mergePath('C:\\Windows;C:\\Tools', 'D:\\App\\bin', 'win32');
  assert.equal(a.added, true);
  assert.equal(a.path, 'C:\\Windows;C:\\Tools;D:\\App\\bin');
  const b = mergePath('C:\\Windows;d:\\app\\BIN\\', 'D:\\App\\bin', 'win32');
  assert.equal(b.added, false);
});

test('installVoid 注入读写函数：首次追加，第二次不重复写', () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-void-'));
  let current = 'C:\\Windows';
  let writes = 0;
  const readPath = () => current;
  const writePath = (next) => { current = next; writes += 1; };
  const first = installVoid({ appDir, platform: 'win32', readPath, writePath });
  assert.equal(first.added, true);
  assert.equal(writes, 1);
  assert.ok(current.includes(first.binDir));
  assert.ok(fs.existsSync(first.file));
  const second = installVoid({ appDir, platform: 'win32', readPath, writePath });
  assert.equal(second.added, false);
  assert.equal(writes, 1);
});

test('installVoid 非 Windows 返回 unsupported 且不改 PATH', () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-void-'));
  let writes = 0;
  const r = installVoid({
    appDir,
    platform: 'linux',
    readPath: () => '/usr/bin',
    writePath: () => { writes += 1; },
  });
  assert.equal(r.unsupported, true);
  assert.equal(writes, 0);
});
