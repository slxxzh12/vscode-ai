import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInputStats, localDayKey } from '../input-stats.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfinput-')), 'input-stats.json'); }
const tsOf = (y, m, d, h = 10) => new Date(y, m - 1, d, h, 0, 0).getTime();

test('record 逐条累加：相同文本也不去重、不截断', () => {
  const store = createInputStats({ file: tmpFile() });
  const ts = tsOf(2026, 10, 19);
  store.record({ userId: '', userName: 'host', ts, chars: 5 });
  store.record({ userId: '', userName: 'host', ts, chars: 5 });
  store.record({ userId: '', userName: 'host', ts, chars: 5 });
  const s = store.summary();
  assert.equal(s.users[0].messages, 3);
  assert.equal(s.users[0].chars, 15);
  assert.equal(s.days[0].messages, 3);
  assert.equal(s.months[0].month, '2026-10');
});

test('recordMany 批量累加同一天的多条事件', () => {
  const store = createInputStats({ file: tmpFile() });
  const ts = tsOf(2026, 10, 19);
  store.recordMany({ userId: '', userName: 'host', events: [{ ts, chars: 2 }, { ts, chars: 3 }] });
  store.recordMany({ userId: '', userName: 'host', events: [{ ts, chars: 4 }] });
  const s = store.summary();
  assert.equal(s.users[0].messages, 3);
  assert.equal(s.users[0].chars, 9);
});

test('按月/按用户汇总', () => {
  const store = createInputStats({ file: tmpFile() });
  store.record({ userId: '', userName: 'host', ts: tsOf(2026, 9, 30), chars: 1 });
  store.record({ userId: '', userName: 'host', ts: tsOf(2026, 10, 1), chars: 2 });
  store.record({ userId: 'u1', userName: 'alice', ts: tsOf(2026, 10, 19), chars: 3 });
  const s = store.summary();
  const hostOct = s.months.find((m) => m.userId === '' && m.month === '2026-10');
  const hostSep = s.months.find((m) => m.userId === '' && m.month === '2026-09');
  const aliceOct = s.months.find((m) => m.userId === 'u1' && m.month === '2026-10');
  assert.equal(hostOct.messages, 1);
  assert.equal(hostSep.messages, 1);
  assert.equal(aliceOct.messages, 1);
  assert.equal(s.totals.messages, 3);
});

test('seed 只写入一次，重复调用不叠加', () => {
  const store = createInputStats({ file: tmpFile() });
  const days = [{ userId: '', userName: 'host', day: '2026-10-19', messages: 4, chars: 8 }];
  store.seed(days);
  store.seed(days);
  assert.equal(store.summary().totals.messages, 4);
});

test('持久化后可重新加载且继续累加', () => {
  const file = tmpFile();
  const a = createInputStats({ file });
  a.seed([{ userId: '', userName: 'host', day: '2026-10-18', messages: 2, chars: 4 }]);
  a.record({ userId: '', userName: 'host', ts: tsOf(2026, 10, 19), chars: 6 });
  const b = createInputStats({ file });
  b.record({ userId: '', userName: 'host', ts: tsOf(2026, 10, 19), chars: 6 });
  const s = b.summary();
  assert.equal(s.totals.messages, 4);
  assert.equal(s.days.find((d) => d.day === '2026-10-19').messages, 2);
});

test('localDayKey 按本地时区输出', () => {
  assert.equal(localDayKey(tsOf(2026, 10, 19)), '2026-10-19');
  assert.equal(localDayKey(0), '');
});
