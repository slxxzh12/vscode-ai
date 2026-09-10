import { describe, it, expect } from 'vitest';
import { scheduleSummary, runStatusLabel, formatTime } from './format';

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
