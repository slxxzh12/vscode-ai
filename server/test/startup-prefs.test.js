import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeStartupPrefs, createStartupPrefs, emptyStartupPrefs } from '../startup-prefs.js';

test('startup prefs：默认隐藏；只接受布尔 hide', () => {
  assert.deepEqual(emptyStartupPrefs(), { hide: true });
  assert.deepEqual(normalizeStartupPrefs({}), { hide: true });
  assert.deepEqual(normalizeStartupPrefs({ hide: false }), { hide: false });
  assert.deepEqual(normalizeStartupPrefs({ hide: 'no' }), { hide: true });
});

test('startup prefs：落盘读回，缺文件回默认', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-startup-')), 'startup-prefs.json');
  const store = createStartupPrefs({ file, logger: { warn() {} } });
  assert.deepEqual(store.read(), { hide: true });
  assert.deepEqual(store.write({ hide: false }), { hide: false });
  assert.deepEqual(createStartupPrefs({ file }).read(), { hide: false });
});
