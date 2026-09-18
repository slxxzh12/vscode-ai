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

test('parseInviteLink：解析 master 访问链接的 host/port/token，并解出 pk 里的群主公钥', () => {
  assert.deepEqual(parseInviteLink('http://192.168.1.5:22222/?access=abc123'),
    { masterUrl: 'http://192.168.1.5:22222', token: 'abc123', masterPublicKey: '' });
  assert.deepEqual(parseInviteLink('  http://127.0.0.1:12345/?access=tk  '),
    { masterUrl: 'http://127.0.0.1:12345', token: 'tk', masterPublicKey: '' });
  const pem = '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----';
  const pk = Buffer.from(pem, 'utf8').toString('base64url');
  assert.deepEqual(parseInviteLink(`http://127.0.0.1:12345/?access=tk&pk=${pk}`),
    { masterUrl: 'http://127.0.0.1:12345', token: 'tk', masterPublicKey: pem });
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
  assert.deepEqual(loadReportConfig(file), { masterUrl: '', token: '', days: 7, masterPublicKey: '' });
  saveReportConfig(file, { masterUrl: 'http://a:1', token: 'tk', days: 3 });
  assert.deepEqual(loadReportConfig(file), { masterUrl: 'http://a:1', token: 'tk', days: 3, masterPublicKey: '' });
  fs.writeFileSync(file, 'broken', 'utf8');
  assert.deepEqual(loadReportConfig(file), { masterUrl: '', token: '', days: 7, masterPublicKey: '' });
});

test('未配置 master 时：仍采集并本地落库自己那份，但不 POST', async () => {
  const file = tmpFile();
  const local = [];
  const calls = [];
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1', username: 'u1', host: '10.0.0.2', port: 33333 }),
    peers: { upsert: (u) => { local.push(u); return u; } },
    collect: async ({ cmd, days }) => ({ agent: cmd, days, sessions: 9, input: 500 }),
    fetchFn: async () => { calls.push('fetch'); return { ok: true, json: async () => ({ ok: true }) }; },
  });
  const out = await r.reportNow();
  assert.equal(out.ok, false);
  assert.equal(out.error, 'not-configured');
  assert.deepEqual(calls, []);
  assert.equal(local.length, 1);
  assert.equal(local[0].machineId, 'm1');
  assert.equal(local[0].host, '10.0.0.2');
  assert.equal(local[0].sessions, 9);
  assert.equal(local[0].input, 500);
});

test('reportNow：把 agent 的 statsCmd 原样传给采集器', async () => {
  const file = tmpFile();
  let seenArgs = null;
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    cmd: 'nga.cmd', statsCmd: 'nga.cmd stats --days {days}',
    collect: async (args) => { seenArgs = args; return { sessions: 1 }; },
  });
  await r.reportNow();
  assert.equal(seenArgs.cmd, 'nga.cmd');
  assert.equal(seenArgs.statsCmd, 'nga.cmd stats --days {days}');
});

test('onLocal：本地落库后回调（供写快照/广播）', async () => {
  const file = tmpFile();
  const seen = [];
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    peers: { upsert: (u) => u },
    onLocal: (rec) => seen.push(rec && rec.machineId),
    collect: async () => ({ sessions: 1 }),
  });
  await r.reportNow();
  assert.deepEqual(seen, ['m1']);
});

test('reportNow：带 X-DF-Token POST 到 /api/usage/report，body 带机器身份与用量，同时本地落库', async () => {
  const file = tmpFile();
  saveReportConfig(file, { masterUrl: 'http://10.0.0.9:22222', token: 'tk', days: 7 });
  const seen = [];
  const local = [];
  const r = createUsageReporter({
    file,
    identity: () => ({ machineId: 'm1', employeeId: 'e1', username: 'u1', host: '10.0.0.2', port: 22222 }),
    peers: { upsert: (u) => { local.push(u); return u; } },
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
  assert.equal(local.length, 1);
  assert.equal(local[0].sessions, 4);
  assert.equal(r.status().lastOk, true);
  assert.equal(r.status().lastError, '');
});

test('reportNow：403 bad-token 记入 lastError 且不抛错', async () => {
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

test('setConfig：保存配置并回读', () => {
  const file = tmpFile();
  const r = createUsageReporter({ file, identity: () => ({ machineId: 'm1' }) });
  const cfg = r.setConfig({ masterUrl: 'http://a:22222', token: 'tk', days: 7 });
  assert.deepEqual(cfg, { masterUrl: 'http://a:22222', token: 'tk', days: 7, masterPublicKey: '' });
  assert.deepEqual(loadReportConfig(file), cfg);
});

test('start：启动立即上报一次，下一次延迟落在 60–90 分钟', async () => {
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

test('reportNow：resolveAgent 提供时每次上报动态取默认 agent', async () => {
  const file = tmpFile();
  const seen = [];
  let current = { cmd: 'opencode', statsCmd: 'opencode stats --days {days}' };
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    resolveAgent: () => current,
    collect: async (args) => { seen.push(args); return { sessions: 1 }; },
  });
  await r.reportNow();
  current = { cmd: 'codeagent', statsCmd: 'codeagent stats --days {days}' };
  await r.reportNow();
  assert.equal(seen.length, 2);
  assert.equal(seen[0].cmd, 'opencode');
  assert.equal(seen[0].statsCmd, 'opencode stats --days {days}');
  assert.equal(seen[1].cmd, 'codeagent');
  assert.equal(seen[1].statsCmd, 'codeagent stats --days {days}');
});
