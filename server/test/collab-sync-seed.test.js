import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatVersion, nextVersion } from '../collaboration/sync-seed.js';
import { createSyncStore } from '../sync-store.js';

function tmpDb() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'collab-seed-')), 'void.db'); }
const logger = { warn() {} };

test('formatVersion 定长 YYYY-MM-DD HH:mm:ss', () => {
  const v = formatVersion(new Date(2026, 8, 15, 10, 30, 5));
  assert.equal(v, '2026-09-15 10:30:05');
  assert.equal(v.length, 19);
});

test('nextVersion 同秒 +1s，且严格大于上一次', () => {
  const now = new Date(2026, 8, 15, 10, 30, 5);
  const v1 = nextVersion('', now);
  assert.equal(v1, '2026-09-15 10:30:05');
  const v2 = nextVersion(v1, now);
  assert.equal(v2, '2026-09-15 10:30:06');
  assert.ok(v2 > v1);
});

test('writeUpdate/readUpdate 往返；缺失返回空', () => {
  const store = createSyncStore({ file: tmpDb(), logger });
  assert.deepEqual(store.readUpdate(), { version: '', updatedAt: 0, files: [] });
  store.writeUpdate({ version: '2026-09-15 10:30:05', updatedAt: 1, files: [{ name: 'a.json', kind: 'group', size: 2, sha256: 'x' }] });
  assert.equal(store.readUpdate().files[0].name, 'a.json');
  store.close();
});

test('writeRecord/readRecord 按 masterId 隔离', () => {
  const store = createSyncStore({ file: tmpDb(), logger });
  assert.equal(store.readRecord('m1'), null);
  store.writeRecord('a/b', { masterId: 'a/b', version: 'v', action: 'reject', checkedAt: 1, update: null });
  assert.equal(store.readRecord('a/b').action, 'reject');
  assert.equal(store.readRecord('other'), null);
  store.close();
});
