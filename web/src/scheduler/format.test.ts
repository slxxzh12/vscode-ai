import { describe, it, expect } from 'vitest';
import { scheduleSummary, runStatusLabel, formatTime, recentRunsOf } from './format';

describe('scheduleSummary', () => {
  it('间隔', () => {
    expect(scheduleSummary({ mode: 'interval', interval: { every: 30, unit: 'minute' } })).toBe('每 30 分钟');
  });
  it('每天', () => {
    expect(scheduleSummary({ mode: 'daily', daily: { at: '09:30', weekdays: [] } })).toBe('每天 09:30');
  });
  it('工作日', () => {
    expect(scheduleSummary({ mode: 'daily', daily: { at: '09:30', weekdays: [1, 2, 3, 4, 5] } })).toBe('工作日 09:30');
  });
  it('指定星期', () => {
    expect(scheduleSummary({ mode: 'daily', daily: { at: '08:00', weekdays: [1, 3] } })).toBe('周一、周三 08:00');
  });
});

describe('runStatusLabel / formatTime', () => {
  it('状态中文', () => {
    expect(runStatusLabel('success')).toBe('成功');
    expect(runStatusLabel('timeout')).toBe('超时');
  });
  it('空时间显示破折号', () => {
    expect(formatTime(null)).toBe('—');
  });
});

describe('recentRunsOf', () => {
  const run = (id: string, startedAt: number, status = 'success') => ({ id, status, startedAt });
  const newestFirst = [run('e', 50), run('d', 40), run('c', 30), run('b', 20), run('a', 10), run('z', 0)];

  it('取最新 n 条，并按时间递增返回', () => {
    expect(recentRunsOf(newestFirst, 5).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(recentRunsOf(newestFirst, 5).map((r) => r.startedAt)).toEqual([10, 20, 30, 40, 50]);
  });
  it('不足 n 条时返回全部', () => {
    expect(recentRunsOf([run('b', 20), run('a', 10)], 5).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('n=10 时取最新 10 条并按时间递增', () => {
    const many = Array.from({ length: 12 }, (_, i) => run('r' + (11 - i), (12 - i) * 10));
    const got = recentRunsOf(many, 10);
    expect(got).toHaveLength(10);
    expect(got.map((r) => r.startedAt)).toEqual([30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  });
  it('空或未定义返回空数组', () => {
    expect(recentRunsOf([], 5)).toEqual([]);
    expect(recentRunsOf(undefined, 5)).toEqual([]);
  });
});
