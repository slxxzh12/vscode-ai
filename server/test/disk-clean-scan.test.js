import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskCleanScanner } from '../disk-clean/scan.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfdc-scan-')); }

function waitDone(scanner, id, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const task = scanner.get(id);
      if (!task) return reject(new Error('missing task'));
      if (task.categories.every((c) => c.status === 'done' || c.status === 'error')) return resolve(task);
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

test('扫描：统计大小与文件数，并应用排除', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'aaaa');
  fs.writeFileSync(path.join(dir, 'b.log'), 'bb');
  const scanner = createDiskCleanScanner({
    listCategories: () => [{ id: 'x', group: 'custom', risk: 'safe', defaultChecked: true, needsAdmin: false, minAgeDays: 0 }],
    resolveTargets: () => [{ path: dir, mode: 'contents', minAgeDays: 0 }],
    readSettings: () => ({ exclusions: { dirs: [], patterns: ['*.log'] }, customDirs: [] }),
  });
  const { scanId } = scanner.start();
  const task = await waitDone(scanner, scanId);
  const cat = task.categories[0];
  assert.equal(cat.status, 'done');
  assert.equal(cat.files, 1);
  assert.equal(cat.bytes, 4);
});

test('扫描：过期任务返回 null', () => {
  let now = 0;
  const scanner = createDiskCleanScanner({
    listCategories: () => [{ id: 'x', group: 'custom', risk: 'safe', defaultChecked: true, needsAdmin: false, minAgeDays: 0 }],
    resolveTargets: () => [{ path: tmp(), mode: 'contents', minAgeDays: 0 }],
    readSettings: () => ({ exclusions: { dirs: [], patterns: [] }, customDirs: [] }),
    ttlMs: 10,
    now: () => now,
  });
  const { scanId } = scanner.start();
  now = 100;
  assert.equal(scanner.get(scanId), null);
});
