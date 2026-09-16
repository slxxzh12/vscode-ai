import { describe, it, expect } from 'vitest';
import { isOnline, fmtNum, sortPeers, usageCells, ONLINE_WINDOW_MS } from './usagePeers';

const mk = (o: any) => ({ machineId: 'm', username: 'u', host: 'h', port: 1, ...o });

describe('usagePeers', () => {
  it('isOnline：3 小时内算在线', () => {
    expect(ONLINE_WINDOW_MS).toBe(3 * 60 * 60 * 1000);
    expect(isOnline(1000, 1000 + ONLINE_WINDOW_MS - 1)).toBe(true);
    expect(isOnline(1000, 1000 + ONLINE_WINDOW_MS)).toBe(false);
    expect(isOnline(0, 500)).toBe(false);
  });
  it('fmtNum：千/百万缩写，缺失显示 -', () => {
    expect(fmtNum(undefined)).toBe('-');
    expect(fmtNum(999)).toBe('999');
    expect(fmtNum(1500)).toBe('1.5K');
    expect(fmtNum(2_000_000)).toBe('2.0M');
  });
  it('sortPeers：最近上报在前', () => {
    const list = sortPeers({ a: mk({ machineId: 'a', receivedAt: 10 }), b: mk({ machineId: 'b', receivedAt: 30 }) });
    expect(list.map((p) => p.machineId)).toEqual(['b', 'a']);
  });
  it('usageCells：给出 sessions/days/messages/input/output/totalCost 六列文本', () => {
    expect(usageCells(mk({ sessions: 3, days: 7, messages: 9, input: 1500, output: 20, totalCost: 1.5 })))
      .toEqual(['3', '7', '9', '1.5K', '20', '1.5']);
    expect(usageCells(mk({ error: 'boom' }))).toEqual(['-', '-', '-', '-', '-', '-']);
  });
});
