import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globToRegExp, measureDir, listEntries } from '../disk-clean/fs-walk.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-walk-')); }

test('globToRegExp：* 与 ? 匹配文件名', () => {
  assert.ok(globToRegExp('*.log').test('a.log'));
  assert.ok(globToRegExp('a?.txt').test('ab.txt'));
  assert.equal(globToRegExp('*.log').test('a.txt'), false);
});

test('measureDir：统计文件数与字节，遵守年龄阈值', () => {
  const dir = tmp();
  const old = path.join(dir, 'old.txt');
  const fresh = path.join(dir, 'fresh.txt');
  fs.writeFileSync(old, 'aaaa');
  fs.writeFileSync(fresh, 'bbbb');
  const past = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  fs.utimesSync(old, past, past);
  const all = measureDir(dir);
  assert.equal(all.files, 2);
  assert.equal(all.bytes, 8);
  const aged = measureDir(dir, { minAgeDays: 1 });
  assert.equal(aged.files, 1);
  assert.equal(aged.bytes, 4);
});

test('measureDir：跳过符号链接（无权限时也能返回）', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  try { fs.symlinkSync(path.join(dir, 'a.txt'), path.join(dir, 'link.txt')); } catch { return; }
  const r = measureDir(dir, { recursive: false });
  assert.ok(r.files >= 1);
});

test('measureDir：超过 maxFiles 标记 truncated', () => {
  const dir = tmp();
  for (let i = 0; i < 5; i += 1) fs.writeFileSync(path.join(dir, `f${i}.txt`), 'x');
  const r = measureDir(dir, { maxFiles: 2 });
  assert.equal(r.truncated, true);
});

test('measureDir：skip 命中时不统计也不下钻', () => {
  const dir = tmp();
  const keep = path.join(dir, 'keep');
  fs.mkdirSync(keep);
  fs.writeFileSync(path.join(keep, 'a.txt'), 'aaaa');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'bb');
  const r = measureDir(dir, { skip: (p) => p.toLowerCase().includes('keep') });
  assert.equal(r.files, 1);
  assert.equal(r.bytes, 2);
});

test('listEntries：只返回匹配条目与满足年龄的文件', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.part'), 'aa');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'bb');
  const past = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  fs.utimesSync(path.join(dir, 'a.part'), past, past);
  const r = listEntries(dir, { patterns: ['*.part'], minAgeDays: 1 });
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].path, path.resolve(path.join(dir, 'a.part')));
});
