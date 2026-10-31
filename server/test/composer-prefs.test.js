import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeComposerPrefs, createComposerPrefs, emptyPrefs } from '../composer-prefs.js';

test('normalizeComposerPrefs 只留 autoSend 且仅接受布尔', () => {
  assert.deepEqual(normalizeComposerPrefs({ autoSend: false }), { autoSend: false });
  assert.deepEqual(normalizeComposerPrefs({ autoSend: true, nope: 1 }), { autoSend: true });
  assert.deepEqual(normalizeComposerPrefs({ autoSend: 'yes' }), {});
});

test('normalizeComposerPrefs 非法输入 → 空对象', () => {
  assert.deepEqual(normalizeComposerPrefs(null), emptyPrefs());
  assert.deepEqual(normalizeComposerPrefs('x'), emptyPrefs());
  assert.deepEqual(normalizeComposerPrefs([]), emptyPrefs());
});

test('createComposerPrefs 读写往返 + 坏文件回退空', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfcprefs-')), 'composer-prefs.json');
  const store = createComposerPrefs({ file });
  assert.deepEqual(store.read(), {});

  store.write({ autoSend: false });
  assert.deepEqual(createComposerPrefs({ file }).read(), { autoSend: false });

  fs.writeFileSync(file, '{ bad json');
  assert.deepEqual(createComposerPrefs({ file }).read(), emptyPrefs());
});

test('createComposerPrefs 无 file 时纯内存', () => {
  const store = createComposerPrefs({});
  store.write({ autoSend: false });
  assert.deepEqual(store.read(), { autoSend: false });
});
