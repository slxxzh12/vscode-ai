import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createUsageStore, AGENT_TOTAL } from '../usage-store.js';

function tmpDb() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfusage-merge-')), 'void.db'); }

function tables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
}

test('老 camelCase usage 表自动迁到 snake_case 结构，数据不丢', () => {
  const file = tmpDb();
  const legacy = new DatabaseSync(file);
  legacy.exec(`CREATE TABLE usage (
    date TEXT NOT NULL, memberId TEXT NOT NULL, agent TEXT NOT NULL,
    sessions INTEGER, messages INTEGER, input INTEGER, output INTEGER, days INTEGER,
    cost REAL, cacheRead INTEGER, cacheWrite INTEGER, receivedAt INTEGER,
    PRIMARY KEY (date, memberId, agent)
  )`);
  legacy.prepare('INSERT INTO usage VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('2026-09-10', 'E1', 'opencode', 1, 2, 3, 4, 1, 0.5, 6, 7, 111);
  legacy.close();

  const store = createUsageStore({ file, logger: { info() {}, warn() {} } });
  const rows = store.query({});
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    date: '2026-09-10', memberId: 'E1', agent: 'opencode',
    sessions: 1, messages: 2, input: 3, output: 4, days: 1, cost: 0.5, cacheRead: 6, cacheWrite: 7, receivedAt: 111,
  });
  assert.ok(!tables(store.db).includes('usage_legacy'), '临时表应删掉');
  store.close();
});

test('老 peer_daily 表并入 usage（agent=* 合计行）并删表', () => {
  const file = tmpDb();
  const legacy = new DatabaseSync(file);
  legacy.exec(`CREATE TABLE peer_daily (
    machine_id TEXT NOT NULL, day TEXT NOT NULL,
    sessions INTEGER, days INTEGER, messages INTEGER, input INTEGER, output INTEGER,
    cost REAL, cache_read INTEGER, cache_write INTEGER, at INTEGER,
    PRIMARY KEY (machine_id, day)
  )`);
  legacy.prepare('INSERT INTO peer_daily VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('m1', '2026-09-12', 2, 7, 5, 100, 200, 1.25, 11, 12, 999);
  legacy.close();

  const store = createUsageStore({ file, logger: { info() {}, warn() {} } });
  assert.ok(!tables(store.db).includes('peer_daily'), 'peer_daily 应被删掉');

  const daily = store.listDaily('m1');
  assert.deepEqual(Object.keys(daily), ['2026-09-12']);
  assert.equal(daily['2026-09-12'].sessions, 2);
  assert.equal(daily['2026-09-12'].messages, 5);
  assert.equal(daily['2026-09-12'].totalCost, 1.25);
  assert.equal(daily['2026-09-12'].cacheRead, 11);
  assert.equal(daily['2026-09-12'].at, 999);

  // 合计行不混进 agent 明细查询
  assert.equal(store.query({}).length, 0);
  assert.equal(store.query({ agent: AGENT_TOTAL }).length, 1);
  store.close();
});

test('agent 明细与机器合并在同一表：主键 (member_id, date, agent) 各自独立', () => {
  const store = createUsageStore({ file: tmpDb(), logger: { info() {}, warn() {} } });
  store.upsert({ date: '2026-09-12', memberId: 'm1', agent: 'opencode', messages: 3 });
  store.upsertDaily('m1', '2026-09-12', { messages: 8, totalCost: 0.1 }, 1000);
  assert.equal(store.query({}).length, 1, '明细 1 行');
  assert.equal(store.query({ agent: AGENT_TOTAL }).length, 1, '合计 1 行');
  assert.equal(store.query({ from: '2026-09-12', to: '2026-09-12', agent: AGENT_TOTAL })[0].date, '2026-09-12');
  assert.equal(store.listDaily('m1')['2026-09-12'].messages, 8);
  store.close();
});

test('listDaily 默认只看最近 30 天（数据保留，不删）', () => {
  const file = tmpDb();
  const store = createUsageStore({ file, logger: { info() {}, warn() {} } });
  for (let i = 0; i < 35; i += 1) {
    const d = new Date(Date.UTC(2026, 6, 1) + i * 86400_000);
    const p = (n) => String(n).padStart(2, '0');
    store.upsertDaily('m1', `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, { messages: i }, 1000 + i);
  }
  const daily = store.listDaily('m1');
  assert.equal(Object.keys(daily).length, 30);
  assert.equal(store.query({ agent: AGENT_TOTAL }).length, 35, '35 天数据都还在');
  store.close();
});
