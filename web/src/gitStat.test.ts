import { describe, it, expect } from 'vitest';
import { statusLabel, statusClass, defaultRange } from './gitStat';

describe('statusLabel', () => {
  it('返回中文标签', () => {
    expect(statusLabel('added')).toBe('新增');
    expect(statusLabel('modified')).toBe('修改');
    expect(statusLabel('deleted')).toBe('删除');
    expect(statusLabel('renamed')).toBe('重命名');
  });
});

describe('statusClass', () => {
  it('统一加 st- 前缀', () => {
    expect(statusClass('added')).toBe('st-added');
    expect(statusClass('renamed')).toBe('st-renamed');
  });
});

describe('defaultRange', () => {
  it('默认近 7 天（含今天）', () => {
    const r = defaultRange(new Date(2026, 8, 10)); // 2026-09-10
    expect(r.until).toBe('2026-09-10');
    expect(r.since).toBe('2026-09-04');
  });
});
