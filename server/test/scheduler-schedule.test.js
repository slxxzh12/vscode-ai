import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextRun, intervalMs } from '../scheduler/schedule.js';

const DAY = 86400000;

test('intervalMs 按单位换算', () => {
  assert.equal(intervalMs({ interval: { every: 30, unit: 'minute' } }), 1800000);
  assert.equal(intervalMs({ interval: { every: 2, unit: 'hour' } }), 7200000);
  assert.equal(intervalMs({ interval: { every: 1, unit: 'day' } }), DAY);
});

test('interval 模式 next = now + 间隔', () => {
  const now = 1000;
  assert.equal(computeNextRun({ mode: 'interval', interval: { every: 5, unit: 'minute' } }, now), now + 300000);
});

test('daily 每天：当天时刻未到取当天，已过取次日', () => {
  const base = new Date('2026-09-10T08:00:00');   // 周四
  const at = { mode: 'daily', daily: { at: '09:30', weekdays: [] } };
  const n1 = computeNextRun(at, base.getTime());
  assert.equal(new Date(n1).getDate(), 10);
  assert.equal(new Date(n1).getHours(), 9);
  const n2 = computeNextRun(at, new Date('2026-09-10T10:00:00').getTime());
  assert.equal(new Date(n2).getDate(), 11);
});

test('daily 仅工作日：周六顺延到周一', () => {
  const sat = new Date('2026-09-12T08:00:00');    // 周六
  const n = computeNextRun({ mode: 'daily', daily: { at: '09:00', weekdays: [1, 2, 3, 4, 5] } }, sat.getTime());
  assert.equal(new Date(n).getDay(), 1);          // 周一
});

test('daily 仅某天：跨周找到下一个选中日', () => {
  const wed = new Date('2026-09-09T08:00:00');    // 周三
  const n = computeNextRun({ mode: 'daily', daily: { at: '09:00', weekdays: [1] } }, wed.getTime());
  assert.equal(new Date(n).getDay(), 1);          // 下周一
});

test('无 schedule 返回 null', () => {
  assert.equal(computeNextRun(null, Date.now()), null);
});
