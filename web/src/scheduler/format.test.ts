import { describe, it, expect } from 'vitest';
import { scheduleSummary, runStatusLabel, formatTime, recentJobsOf, typeLabel } from './format';

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
    expect(runStatusLabel(1)).toBe('成功');
    expect(runStatusLabel(2)).toBe('失败');
    expect(runStatusLabel('timeout')).toBe('超时');
  });
  it('paused 有标签', () => {
    expect(runStatusLabel('paused')).toBeTruthy();
    expect(runStatusLabel('killed')).toBeTruthy();
  });
  it('空时间显示破折号', () => {
    expect(formatTime(null)).toBe('—');
  });
});

describe('typeLabel', () => {
  it('workflow 有标签', () => {
    expect(typeLabel('workflow')).toBe('工作流');
    expect(typeLabel('ai')).toBe('AI');
  });
});

describe('recentJobsOf', () => {
  const job = (id: string, createTime: number, status = 1) => ({ jobId: id, status, createTime });
  const newestFirst = [job('e', 50), job('d', 40), job('c', 30), job('b', 20), job('a', 10), job('z', 0)];

  it('取最新 n 条，并按时间递增返回', () => {
    expect(recentJobsOf(newestFirst, 5).map((r) => r.jobId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(recentJobsOf(newestFirst, 5).map((r) => r.createTime)).toEqual([10, 20, 30, 40, 50]);
  });
  it('不足 n 条时返回全部', () => {
    expect(recentJobsOf([job('b', 20), job('a', 10)], 5).map((r) => r.jobId)).toEqual(['a', 'b']);
  });
  it('n=10 时取最新 10 条并按时间递增', () => {
    const many = Array.from({ length: 12 }, (_, i) => job('r' + (11 - i), (12 - i) * 10));
    const got = recentJobsOf(many, 10);
    expect(got).toHaveLength(10);
    expect(got.map((r) => r.createTime)).toEqual([30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  });
  it('空或未定义返回空数组', () => {
    expect(recentJobsOf([], 5)).toEqual([]);
    expect(recentJobsOf(undefined, 5)).toEqual([]);
  });
});
