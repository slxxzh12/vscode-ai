import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validPort, readPortFile, writePortFile, resolvePort, DEFAULT_PORT,
} from '../port-file.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-port-')), 'port.txt'); }

test('validPort 只接受 1-65535 整数', () => {
  assert.equal(validPort(22222), 22222);
  assert.equal(validPort('44444'), 44444);
  assert.equal(validPort(0), null);
  assert.equal(validPort(65536), null);
  assert.equal(validPort('abc'), null);
  assert.equal(validPort('22.5'), null);
  assert.equal(validPort(''), null);
  assert.equal(validPort(null), null);
});

test('readPortFile 缺失/非数字/越界一律 null', () => {
  const f = tmpFile();
  assert.equal(readPortFile(f), null);
  fs.writeFileSync(f, '  44444 \n', 'utf8');
  assert.equal(readPortFile(f), 44444, '应 trim');
  fs.writeFileSync(f, 'abc', 'utf8');
  assert.equal(readPortFile(f), null);
  fs.writeFileSync(f, '70000', 'utf8');
  assert.equal(readPortFile(f), null);
});

test('writePortFile 原子写入并可读回；非法值抛 bad-port', () => {
  const f = tmpFile();
  assert.equal(writePortFile(4100, f), 4100);
  assert.equal(fs.readFileSync(f, 'utf8'), '4100');
  assert.equal(fs.existsSync(f + '.tmp'), false, '不应残留 tmp');
  assert.equal(readPortFile(f), 4100);
  assert.throws(() => writePortFile(0, f), /bad-port|invalid port/);
});

test('resolvePort 优先级：env > 文件 > 默认', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '25000', 'utf8');
  assert.equal(resolvePort({ env: '33333', portFile: f }), 33333);
  assert.equal(resolvePort({ env: '', portFile: f }), 25000);
  assert.equal(resolvePort({ env: 'not-a-port', portFile: f }), 25000, 'env 非法则回落文件');
  assert.equal(resolvePort({ env: '', portFile: tmpFile() }), DEFAULT_PORT);
  assert.equal(DEFAULT_PORT, 22222);
});
