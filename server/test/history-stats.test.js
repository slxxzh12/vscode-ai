import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeHistory } from '../message-history.js';
import { summarizeHistory, monthKey, dayKey } from '../history-stats.js';

function tmpFile(name) { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-hstats-')), name); }

test('monthKey/dayKey：按本地时间格式化，0/非法返回空', () => {
  const ts = new Date(2026, 9, 19, 8, 30).getTime();
  assert.equal(monthKey(ts), '2026-10');
  assert.equal(dayKey(ts), '2026-10-19');
  assert.equal(monthKey(0), '');
  assert.equal(dayKey(0), '');
});

test('summarizeHistory：按用户/会话/月/日聚合消息数与字符数', () => {
  const hostFile = tmpFile('host.jsonc');
  const aliceFile = tmpFile('alice.jsonc');
  const t1 = new Date(2026, 8, 30, 10, 0).getTime();
  const t2 = new Date(2026, 9, 1, 11, 0).getTime();
  const t3 = new Date(2026, 9, 1, 12, 0).getTime();
  writeHistory(hostFile, [
    { text: 'host-1', ts: t1, sessionId: 's1' },
    { text: 'host-22', ts: t2, sessionId: 's1' },
  ]);
  writeHistory(aliceFile, [
    { text: 'alice-1', ts: t3, sessionId: 's2', tabName: 'A' },
    { text: 'alice-2', ts: t3 },
  ]);

  const r = summarizeHistory([
    { file: hostFile, userId: '', userName: 'hostuser', projectId: 'p1' },
    { file: aliceFile, userId: 'u1', userName: 'alice', projectId: 'p1' },
  ]);

  assert.deepEqual(r.totals, { messages: 4, chars: 27, sessions: 3, users: 2 });
  const host = r.users.find((u) => u.userId === '');
  assert.equal(host.userName, 'hostuser');
  assert.equal(host.messages, 2);
  assert.equal(host.chars, 13);
  assert.equal(host.sessions, 1);

  const months = Object.fromEntries(r.months.map((m) => [`${m.userId}|${m.month}`, m]));
  assert.equal(months['|2026-09'].messages, 1);
  assert.equal(months['|2026-10'].chars, 7);
  assert.equal(months['u1|2026-10'].messages, 2);
  assert.equal(months['u1|2026-10'].chars, 14);

  const days = Object.fromEntries(r.days.map((d) => [`${d.userId}|${d.day}`, d]));
  assert.equal(days['|2026-10-01'].messages, 1);
  assert.equal(days['u1|2026-10-01'].messages, 2);

  const sessions = r.sessions;
  assert.equal(sessions.length, 3);
  assert.equal(sessions.find((s) => s.sessionId === 's2').tabName, 'A');
});
