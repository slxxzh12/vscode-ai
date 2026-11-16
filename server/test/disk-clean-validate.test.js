import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCustomDir, isExcluded } from '../disk-clean/validate.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-val-')); }

test('validateCustomDir：接受普通目录并返回绝对路径', () => {
  const dir = tmp();
  const r = validateCustomDir(dir, { home: tmp() });
  assert.equal(r.ok, true);
  assert.equal(r.path, path.resolve(dir));
});

test('validateCustomDir：拒绝相对路径/不存在/文件/盘符根/系统目录/用户主目录', () => {
  const base = tmp();
  const file = path.join(base, 'a.txt');
  fs.writeFileSync(file, 'x');
  assert.equal(validateCustomDir('relative/path', { home: base }).ok, false);
  assert.equal(validateCustomDir(path.join(base, 'missing'), { home: base }).ok, false);
  assert.equal(validateCustomDir(file, { home: base }).ok, false);
  assert.equal(validateCustomDir(path.parse(base).root, { home: base }).ok, false);
  assert.equal(validateCustomDir(base, { home: tmp(), forbidden: [base] }).ok, false);
});

test('isExcluded：目录前缀与文件名通配', () => {
  const ex = { dirs: ['C:/keep/cache'], patterns: ['*.log'] };
  assert.equal(isExcluded('C:\\keep\\cache\\a.bin', ex), true);
  assert.equal(isExcluded('C:\\keep\\other\\a.log', ex), true);
  assert.equal(isExcluded('C:\\keep\\other\\a.bin', ex), false);
});
