import { test, expect } from 'vitest';
import {
  decideMobileLanding, readMobileLanding, writeMobileLanding,
  FIRST_SEEN_KEY, LAST_MOBILE_KEY, type StorageLike,
} from './mobileLanding';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 14, 10, 0, 0).getTime(); // 本地 2026-09-14 10:00

function fakeStorage(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

test('首次使用：记录 firstSeen 且不跳手机页', () => {
  const r = decideMobileLanding({ firstSeen: null, lastMobileDate: null, now: NOW });
  expect(r.firstSeen).toBe(NOW);
  expect(r.openMobile).toBe(false);
  expect(r.lastMobileDate).toBe('');
});

test('未满 3 天不跳', () => {
  expect(decideMobileLanding({ firstSeen: NOW - 2 * DAY, lastMobileDate: null, now: NOW }).openMobile).toBe(false);
});

test('满 3 天即跳（第 4 天起）', () => {
  expect(decideMobileLanding({ firstSeen: NOW - 3 * DAY, lastMobileDate: null, now: NOW }).openMobile).toBe(true);
});

test('满 3 天但今天已跳转过则不重复跳', () => {
  const today = decideMobileLanding({ firstSeen: NOW - 3 * DAY, lastMobileDate: null, now: NOW });
  expect(today.openMobile).toBe(true);
  const again = decideMobileLanding({ firstSeen: NOW - 3 * DAY, lastMobileDate: today.lastMobileDate, now: NOW + 3600_000 });
  expect(again.openMobile).toBe(false);
});

test('昨天跳转过、今天首次打开再跳', () => {
  const r = decideMobileLanding({ firstSeen: NOW - 4 * DAY, lastMobileDate: '2026-09-13', now: NOW });
  expect(r.openMobile).toBe(true);
  expect(r.lastMobileDate).toBe('2026-09-14');
});

test('read/write 往返（含非法 firstSeen 视为首次）', () => {
  const s = fakeStorage({ [FIRST_SEEN_KEY]: 'oops' });
  const r = readMobileLanding(s, NOW);
  expect(r.firstSeen).toBe(NOW);
  writeMobileLanding(s, r);
  expect(s.data[FIRST_SEEN_KEY]).toBe(String(NOW));

  const s2 = fakeStorage({ [FIRST_SEEN_KEY]: String(NOW - 3 * DAY) });
  const r2 = readMobileLanding(s2, NOW);
  expect(r2.openMobile).toBe(true);
  writeMobileLanding(s2, r2);
  expect(s2.data[LAST_MOBILE_KEY]).toBe('2026-09-14');
});
