import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProbe, saveProbe, toProbeRecord } from '../usage-probe-store.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-probe-')), 'usage-probe.json');
}

test('saveProbe/loadProbe 往返；缺文件返回 null', () => {
  const f = tmpFile();
  assert.equal(loadProbe(f), null);
  const rec = { cmdline: 'opencode stats', ok: true, raw: 'Sessions 1', parsed: { sessions: 1 } };
  saveProbe(f, rec);
  assert.deepEqual(loadProbe(f), rec);
});

test('toProbeRecord：从采集结果归一化（带原文、ok 由 error 决定）', () => {
  const ok = toProbeRecord({ sessions: 3, messages: 9, raw: 'RAW', cmdline: 'c', collectedAt: 123 }, 999);
  assert.equal(ok.ok, true);
  assert.equal(ok.raw, 'RAW');
  assert.equal(ok.cmdline, 'c');
  assert.equal(ok.collectedAt, 123);
  assert.deepEqual(ok.parsed, { sessions: 3, messages: 9, days: null, totalCost: null, input: null, output: null, cacheRead: null, cacheWrite: null });

  const bad = toProbeRecord({ error: 'ENOENT', code: 'ENOENT', cmdline: 'c' }, 999);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'ENOENT');
  assert.equal(bad.code, 'ENOENT');
  assert.equal(bad.collectedAt, 999);
});
