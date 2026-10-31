import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeCodePrefs, createCodePrefs, emptyPrefs } from '../code-prefs.js';

test('normalizeCodePrefs 只留已知键、文本截断、非布尔丢弃', () => {
  const r = normalizeCodePrefs({
    exts: '.js, .xml',
    excludeDirs: 'node_modules, docs',
    excludeTestFiles: false,
    codeOnly: true,
    hugeCommitLimit: '2000',
    nope: 'x',
    extsBad: 1,
  });
  assert.deepEqual(r, {
    exts: '.js, .xml',
    excludeDirs: 'node_modules, docs',
    excludeTestFiles: false,
    codeOnly: true,
    hugeCommitLimit: '2000',
  });

  assert.deepEqual(normalizeCodePrefs({ excludeTestFiles: 'yes', codeOnly: 1 }), {});
  assert.equal(normalizeCodePrefs({ exts: 'x'.repeat(5000) }).exts.length, 4000);
});

test('normalizeCodePrefs 非法输入 → 空对象', () => {
  assert.deepEqual(normalizeCodePrefs(null), emptyPrefs());
  assert.deepEqual(normalizeCodePrefs('x'), emptyPrefs());
  assert.deepEqual(normalizeCodePrefs([]), emptyPrefs());
});

test('createCodePrefs 读写往返（只覆盖传了的键）+ 坏文件回退空', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfprefs-')), 'code-prefs.json');
  const store = createCodePrefs({ file });
  assert.deepEqual(store.read(), {});

  store.write({ exts: '.js' });
  assert.deepEqual(createCodePrefs({ file }).read(), { exts: '.js' });

  store.write({ exts: '.js', excludeTestFiles: true });
  assert.deepEqual(createCodePrefs({ file }).read(), { exts: '.js', excludeTestFiles: true });

  fs.writeFileSync(file, '{ bad json');
  assert.deepEqual(createCodePrefs({ file }).read(), emptyPrefs());
});

test('createCodePrefs 无 file 时纯内存', () => {
  const store = createCodePrefs({});
  store.write({ codeOnly: false });
  assert.deepEqual(store.read(), { codeOnly: false });
});
