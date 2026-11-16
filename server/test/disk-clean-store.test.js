import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskCleanStore } from '../disk-clean/store.js';

test('store：默认设置与写入回读', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-store-'));
  const s = createDiskCleanStore({ dir });
  assert.deepEqual(s.readSettings(), { exclusions: { dirs: [], patterns: [] }, customDirs: [] });
  s.writeSettings({ exclusions: { dirs: ['C:\\x'], patterns: ['*.log'] }, customDirs: ['C:\\tmp'] });
  assert.deepEqual(s.readSettings(), { exclusions: { dirs: ['C:\\x'], patterns: ['*.log'] }, customDirs: ['C:\\tmp'] });
  assert.ok(fs.existsSync(path.join(dir, 'exclusions.json')));
  assert.ok(fs.existsSync(path.join(dir, 'custom.json')));
});

test('store：历史追加与读取上限', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-store-h-'));
  const s = createDiskCleanStore({ dir });
  for (let i = 0; i < 5; i += 1) s.appendHistory({ ts: i, removed: i, bytes: 10 });
  const list = s.readHistory(3);
  assert.equal(list.length, 3);
  assert.equal(list[2].ts, 4);
});
