import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createUsageStore, normalizeUsage } from '../usage-store.js';

function tmpDb() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfusage-')), 'usage.db'); }

test('upsert 后 query 可取到完整字段', () => {
  const store = createUsageStore({ file: tmpDb() });
  store.upsert({ date: '2026-09-12', memberId: 'E1', agent: 'opencode', sessions: 1, messages: 3, input: 10, output: 20, days: 1, cost: 0.5, cacheRead: 2, cacheWrite: 1, receivedAt: 123 });
  const rows = store.query({});
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { date: '2026-09-12', memberId: 'E1', agent: 'opencode', source: 'auto', sessions: 1, messages: 3, input: 10, output: 20, days: 1, cost: 0.5, cacheRead: 2, cacheWrite: 1, receivedAt: 123 });
  store.close();
});

test('source 列：图片识别来源可写入并读回，缺省 auto', () => {
  const store = createUsageStore({ file: tmpDb() });
  store.upsert({ date: '2026-09-12', memberId: 'E1', agent: 'opencode', source: 'image', sessions: 5 });
  store.upsert({ date: '2026-09-13', memberId: 'E1', agent: 'opencode', sessions: 7 });
  const rows = store.query({});
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.date === '2026-09-12').source, 'image');
  assert.equal(rows.find((r) => r.date === '2026-09-13').source, 'auto');
  store.close();
});

test('老库无 source 列时迁移补列，默认 auto', () => {
  const file = tmpDb();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec(`CREATE TABLE usage (
    member_id TEXT NOT NULL, date TEXT NOT NULL, agent TEXT NOT NULL,
    sessions INTEGER, messages INTEGER, input INTEGER, output INTEGER, days INTEGER,
    cost REAL, cache_read INTEGER, cache_write INTEGER, received_at INTEGER,
    PRIMARY KEY (member_id, date, agent))`);
  raw.prepare('INSERT INTO usage (member_id,date,agent,sessions) VALUES (?,?,?,?)').run('E1', '2026-09-12', 'opencode', 3);
  raw.close();
  const store = createUsageStore({ file });
  const rows = store.query({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'auto');
  assert.equal(rows[0].sessions, 3);
  store.close();
});

test('同 key 快照覆盖，行数不变', () => {
  const store = createUsageStore({ file: tmpDb() });
  store.upsert({ date: '2026-09-12', memberId: 'E1', agent: 'a', input: 1, output: 1, messages: 1, sessions: 1, days: 1, receivedAt: 1 });
  store.upsert({ date: '2026-09-12', memberId: 'E1', agent: 'a', input: 9, output: 9, messages: 9, sessions: 9, days: 1, receivedAt: 2 });
  const rows = store.query({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input, 9);
  assert.equal(rows[0].receivedAt, 2);
  store.close();
});

test('不同天/成员/agent 多行 + query 过滤 + date DESC', () => {
  const store = createUsageStore({ file: tmpDb() });
  store.upsert({ date: '2026-09-10', memberId: 'E1', agent: 'a' });
  store.upsert({ date: '2026-09-12', memberId: 'E1', agent: 'a' });
  store.upsert({ date: '2026-09-12', memberId: 'E2', agent: 'b' });
  assert.equal(store.query({}).length, 3);
  assert.deepEqual(store.query({}).map((r) => r.date), ['2026-09-12', '2026-09-12', '2026-09-10']);
  assert.equal(store.query({ memberId: 'E2' }).length, 1);
  assert.equal(store.query({ from: '2026-09-11', to: '2026-09-13' }).length, 2);
  assert.equal(store.query({ agent: 'b' }).length, 1);
  store.close();
});

test('normalizeUsage 校验与归一', () => {
  assert.deepEqual(normalizeUsage({}), { error: 'bad-input' });
  assert.deepEqual(normalizeUsage({ memberId: 'E', date: '2026/09/12' }), { error: 'bad-date' });
  const r = normalizeUsage({ memberId: 'E1', input: '10.6', cost: '0.5' }, new Date(2026, 8, 12, 12, 0, 0).getTime());
  assert.equal(r.record.date, '2026-09-12');
  assert.equal(r.record.input, 11);        // 取整
  assert.equal(r.record.cost, 0.5);        // 浮点
  assert.equal(r.record.messages, null);   // 缺失
  assert.equal(r.record.source, 'auto');   // 缺省 auto
  const img = normalizeUsage({ memberId: 'E1', source: 'image', sessions: 2 });
  assert.equal(img.record.source, 'image');
});
