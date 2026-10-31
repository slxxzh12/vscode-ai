import { describe, it, expect } from 'vitest';
import { locale } from '../i18n';
import { jobStatusClass, jobStatusLabel } from './format';

describe('jobs format', () => {
  it('状态映射', () => {
    locale.value = 'zh-CN';
    expect(jobStatusLabel(0)).toBe('排队中');
    expect(jobStatusLabel(1)).toBe('成功');
    expect(jobStatusLabel(4)).toBe('待审');
    expect(jobStatusClass(3)).toBe('run');
    expect(jobStatusClass(2)).toBe('bad');
  });
});
