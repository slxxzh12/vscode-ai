import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseInviteLink, nextDelay, loadReportConfig, saveReportConfig, createUsageReporter,
  MIN_INTERVAL_MS, MAX_INTERVAL_MS,
} from '../usage-report.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-report-')), 'usage-report.json');
}

test('parseInviteLinkï¼šè§£æž master è®¿é—®é“¾æŽ¥çš„ host/port/token', () => {
  assert.deepEqual(parseInviteLink('http://192.168.1.5:22222/?access=abc123'),
    { masterUrl: 'http://192.168.1.5:22222', token: 'abc123' });
  assert.deepEqual(parseInviteLink('  http://127.0.0.1:12345/?access=tk  '),
    { masterUrl: 'http://127.0.0.1:12345', token: 'tk' });
});

test('parseInviteLinkï¼šç¼º token / éž http / ç©ºä¸²éƒ½æŠ¥ bad-link', () => {
  assert.deepEqual(parseInviteLink('http://127.0.0.1:22222/'), { error: 'bad-link' });
  assert.deepEqual(parseInviteLink('ftp://127.0.0.1:22222/?access=tk'), { error: 'bad-link' });
  assert.deepEqual(parseInviteLink(''), { error: 'bad-link' });
  assert.deepEqual(parseInviteLink('éšä¾¿ä¸€ä¸²'), { error: 'bad-link' });
});

test('nextDelay è½åœ¨ 60â€“90 åˆ†é’Ÿé—­åŒºé—´å†…', () => {
  assert.equal(nextDelay(() => 0), MIN_INTERVAL_MS);
  assert.equal(nextDelay(() => 1 - Number.EPSILON), MAX_INTERVAL_MS - 1);
  for (let i = 0; i < 200; i += 1) {
    const d = nextDelay();
    assert.ok(d >= MIN_INTERVAL_MS && d < MAX_INTERVAL_MS, String(d));
  }
  assert.equal(MIN_INTERVAL_MS, 60 * 60 * 1000);
  assert.equal(MAX_INTERVAL_MS, 90 * 60 * 1000);
});

test('loadReportConfig é»˜è®¤å€¼ / saveReportConfig è½ç›˜è¯»å›ž', () => {
  const file = tmpFile();
  assert.deepEqual(loadReportConfig(file), { masterUrl: '', token: '', days: 7 });
  saveReportConfig(file, { masterUrl: 'http://a:1', token: 'tk', days: 3 });
  assert.deepEqual(loadReportConfig(file), { masterUrl: 'http://a:1', token: 'tk', days: 3 });
  fs.writeFileSync(file, 'broken', 'utf8');
  assert.deepEqual(loadReportConfig(file), { masterUrl: '', token: '', days: 7 });
});

test('reportNow£ºÎ´ÅäÖÃÊ±Ö±½ÓÊ§°Ü£¬²»µ÷ÓÃ collect', async () => {
  const file = tmpFile();
  const calls = [];
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    collect: async () => { calls.push('collect'); return {}; },
    fetchFn: async () => { calls.push('fetch'); return { ok: true, json: async () => ({ ok: true }) }; },
  });
  const out = await r.reportNow();
  assert.equal(out.ok, false);
  assert.equal(out.error, 'not-configured');
  assert.deepEqual(calls, []);
});

test('reportNow£º´ø X-DF-Token POST µ½ /api/usage/report£¬body ´ø»úÆ÷Éí·ÝÓëÓÃÁ¿', async () => {
  const file = tmpFile();
  saveReportConfig(file, { masterUrl: 'http://10.0.0.9:22222', token: 'tk', days: 7 });
  const seen = [];
  const r = createUsageReporter({
    file,
    identity: () => ({ machineId: 'm1', employeeId: 'e1', username: 'u1', host: '10.0.0.2', port: 22222 }),
    collect: async ({ cmd, days }) => ({ agent: cmd, days, sessions: 4, messages: 8, input: 1000, output: 100 }),
    fetchFn: async (url, opts) => { seen.push({ url, opts }); return { ok: true, json: async () => ({ ok: true }) }; },
    cmd: 'opencode',
  });
  const out = await r.reportNow();
  assert.equal(out.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'http://10.0.0.9:22222/api/usage/report');
  assert.equal(seen[0].opts.method, 'POST');
  assert.equal(seen[0].opts.headers['X-DF-Token'], 'tk');
  const body = JSON.parse(seen[0].opts.body);
  assert.equal(body.machineId, 'm1');
  assert.equal(body.employeeId, 'e1');
  assert.equal(body.host, '10.0.0.2');
  assert.equal(body.usage.sessions, 4);
  assert.equal(r.status().lastOk, true);
  assert.equal(r.status().lastError, '');
});

test('reportNow£º403 bad-token ¼ÇÈë lastError ÇÒ²»Å×´í', async () => {
  const file = tmpFile();
  saveReportConfig(file, { masterUrl: 'http://10.0.0.9:22222', token: 'bad' });
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 1 }),
    fetchFn: async () => ({ ok: false, status: 403, json: async () => ({ error: 'bad-token' }) }),
  });
  const out = await r.reportNow();
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
  assert.equal(r.status().lastOk, false);
  assert.equal(r.status().lastError, 'bad-token');
});

test('setConfig£º±£´æÅäÖÃ²¢»Ø¶Á', () => {
  const file = tmpFile();
  const r = createUsageReporter({ file, identity: () => ({ machineId: 'm1' }) });
  const cfg = r.setConfig({ masterUrl: 'http://a:22222', token: 'tk', days: 7 });
  assert.deepEqual(cfg, { masterUrl: 'http://a:22222', token: 'tk', days: 7 });
  assert.deepEqual(loadReportConfig(file), cfg);
});

test('start£ºÆô¶¯Á¢¼´ÉÏ±¨Ò»´Î£¬ÏÂÒ»´ÎÑÓ³ÙÂäÔÚ 60¨C90 ·ÖÖÓ', async () => {
  const file = tmpFile();
  saveReportConfig(file, { masterUrl: 'http://a:22222', token: 'tk' });
  const delays = [];
  let reported = 0;
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 1 }),
    fetchFn: async () => { reported += 1; return { ok: true, json: async () => ({ ok: true }) }; },
    random: () => 0,
    scheduleFn: (fn, ms) => { delays.push(ms); return { unref() {} }; },
  });
  r.start();
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(reported, 1);
  assert.deepEqual(delays, [MIN_INTERVAL_MS]);
  r.stop();
});
