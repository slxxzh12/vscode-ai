import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatVersion, nextVersion, readUpdate, writeUpdate, recordPath, readRecord, writeRecord } from '../collaboration/sync-seed.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-seed-')); }

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
  const dir = tmp();
  assert.deepEqual(readUpdate(dir), { version: '', updatedAt: 0, files: [] });
  writeUpdate(dir, { version: '2026-09-15 10:30:05', updatedAt: 1, files: [{ name: 'a.json', kind: 'group', size: 2, sha256: 'x' }] });
  assert.equal(readUpdate(dir).files[0].name, 'a.json');
});

test('writeRecord/readRecord 按 masterId 分文件且安全命名', () => {
  const dir = tmp();
  assert.equal(readRecord(dir, 'm1'), null);
  writeRecord(dir, 'a/b', { masterId: 'a/b', version: 'v', action: 'reject', checkedAt: 1, update: null });
  assert.equal(readRecord(dir, 'a/b').action, 'reject');
  assert.ok(fs.existsSync(recordPath(dir, 'a/b')));
  assert.ok(!recordPath(dir, 'a/b').includes(path.sep + 'a' + path.sep), '路径分隔符被替换为下划线');
});
