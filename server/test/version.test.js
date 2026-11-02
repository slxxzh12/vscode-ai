import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import versionMod from '@devflow/shared/version.cjs';
import { resolveVersion } from '../version.js';

const { todayVersion } = versionMod;

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-ver-')); }

function withoutEnv(fn) {
  const prev = process.env.DEVFLOW_VERSION;
  delete process.env.DEVFLOW_VERSION;
  try { return fn(); } finally {
    if (prev !== undefined) process.env.DEVFLOW_VERSION = prev;
  }
}

test('todayVersion 精确到秒、补零且带 v 前缀', () => {
  assert.equal(todayVersion(new Date(2026, 8, 14, 15, 30, 12)), 'v20260914153012');
  assert.equal(todayVersion(new Date(2026, 0, 3, 4, 5, 6)), 'v20260103040506');
});

test('resolveVersion：DEVFLOW_VERSION 优先', () => {
  const prev = process.env.DEVFLOW_VERSION;
  process.env.DEVFLOW_VERSION = 'v20990101';
  try {
    assert.equal(resolveVersion(tmpRoot()), 'v20990101');
  } finally {
    if (prev === undefined) delete process.env.DEVFLOW_VERSION;
    else process.env.DEVFLOW_VERSION = prev;
  }
});

test('resolveVersion：读取冻结的 version.txt', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'version.txt'), 'v20260914\n', 'utf8');
  assert.equal(withoutEnv(() => resolveVersion(root)), 'v20260914');
});

test('resolveVersion：无 version.txt 回退当天', () => {
  withoutEnv(() => {
    assert.match(resolveVersion(tmpRoot()), /^v\d{14}$/);
    assert.equal(resolveVersion(tmpRoot()), todayVersion());
  });
});
