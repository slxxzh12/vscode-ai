import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseInviteLink, nextDelay, loadReportConfig, saveReportConfig,
  MIN_INTERVAL_MS, MAX_INTERVAL_MS,
} from '../usage-report.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-report-')), 'usage-report.json');
}

test('parseInviteLink：解析 master 访问链接的 host/port/token', () => {
  assert.deepEqual(parseInviteLink('http://192.168.1.5:22222/?access=abc123'),
    { masterUrl: 'http://192.168.1.5:22222', token: 'abc123' });
  assert.deepEqual(parseInviteLink('  http://127.0.0.1:12345/?access=tk  '),
    { masterUrl: 'http://127.0.0.1:12345', token: 'tk' });
});

test('parseInviteLink：缺 token / 非 http / 空串都报 bad-link', () => {
  assert.deepEqual(parseInviteLink('http://127.0.0.1:22222/'), { error: 'bad-link' });
  assert.deepEqual(parseInviteLink('ftp://127.0.0.1:22222/?access=tk'), { error: 'bad-link' });
  assert.deepEqual(parseInviteLink(''), { error: 'bad-link' });
  assert.deepEqual(parseInviteLink('随便一串'), { error: 'bad-link' });
});

test('nextDelay 落在 60–90 分钟闭区间内', () => {
  assert.equal(nextDelay(() => 0), MIN_INTERVAL_MS);
  assert.equal(nextDelay(() => 1 - Number.EPSILON), MAX_INTERVAL_MS - 1);
  for (let i = 0; i < 200; i += 1) {
    const d = nextDelay();
    assert.ok(d >= MIN_INTERVAL_MS && d < MAX_INTERVAL_MS, String(d));
  }
  assert.equal(MIN_INTERVAL_MS, 60 * 60 * 1000);
  assert.equal(MAX_INTERVAL_MS, 90 * 60 * 1000);
});

test('loadReportConfig 默认值 / saveReportConfig 落盘读回', () => {
  const file = tmpFile();
  assert.deepEqual(loadReportConfig(file), { masterUrl: '', token: '', days: 7 });
  saveReportConfig(file, { masterUrl: 'http://a:1', token: 'tk', days: 3 });
  assert.deepEqual(loadReportConfig(file), { masterUrl: 'http://a:1', token: 'tk', days: 3 });
  fs.writeFileSync(file, 'broken', 'utf8');
  assert.deepEqual(loadReportConfig(file), { masterUrl: '', token: '', days: 7 });
});
