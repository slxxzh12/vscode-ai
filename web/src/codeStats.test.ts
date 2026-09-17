import { describe, it, expect } from 'vitest';
import { sumCodeTotals, ratioText } from './codeStats';

describe('sumCodeTotals', () => {
  it('逐字段累加', () => {
    expect(sumCodeTotals([
      { files: 2, real: 10, total: 20 },
      { files: 1, real: 5, total: 15 },
    ])).toEqual({ files: 3, real: 15, total: 35 });
  });
  it('空数组全零', () => {
    expect(sumCodeTotals([])).toEqual({ files: 0, real: 0, total: 0 });
  });
});

describe('ratioText', () => {
  it('实代码行 / 总行数 百分比，保留一位小数', () => {
    expect(ratioText(1, 3)).toBe('33.3%');
    expect(ratioText(2, 2)).toBe('100.0%');
  });
  it('总行数为 0 返回 —', () => {
    expect(ratioText(0, 0)).toBe('—');
  });
});
