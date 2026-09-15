import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePortFile, readPortFile } from '../port-file.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-srvport-')); }

test('写端口文件后读回一致，且不残留 tmp', () => {
  const f = path.join(tmpDir(), 'port.txt');
  assert.equal(writePortFile(4100, f), 4100);
  assert.equal(readPortFile(f), 4100);
  assert.equal(fs.existsSync(f + '.tmp'), false);
});

test('非法端口抛 bad-port 且不落文件', () => {
  const f = path.join(tmpDir(), 'port.txt');
  assert.throws(() => writePortFile(99999, f), /bad-port|invalid port/);
  assert.equal(fs.existsSync(f), false);
});

test('目标不可写时抛出（调用方转成 500）', () => {
  const asDir = path.join(tmpDir(), 'port.txt');
  fs.mkdirSync(asDir, { recursive: true });      // 用目录占位，令 rename 必然失败
  assert.throws(() => writePortFile(4100, asDir));
});
