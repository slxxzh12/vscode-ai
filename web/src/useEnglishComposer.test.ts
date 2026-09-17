import { describe, it, expect } from 'vitest';
import { isAsciiOnly, mergeComposerPrefs } from './useEnglishComposer';

describe('isAsciiOnly', () => {
  it('字母/数字/空白/ASCII 标点 → true', () => {
    expect(isAsciiOnly('npm run dev')).toBe(true);
    expect(isAsciiOnly('/compact')).toBe(true);
    expect(isAsciiOnly('123  ')).toBe(true);
    expect(isAsciiOnly('git commit -m "x"')).toBe(true);
  });
  it('含中文/其它非 ASCII → false', () => {
    expect(isAsciiOnly('你好')).toBe(false);
    expect(isAsciiOnly('hello 世界')).toBe(false);
    expect(isAsciiOnly('😀')).toBe(false);
  });
});

describe('mergeComposerPrefs', () => {
  it('缺键/类型不符 → 默认 true', () => {
    expect(mergeComposerPrefs(null)).toBe(true);
    expect(mergeComposerPrefs({})).toBe(true);
    expect(mergeComposerPrefs([])).toBe(true);
    expect(mergeComposerPrefs({ autoSend: 'yes' })).toBe(true);
  });
  it('服务端已存值覆盖默认', () => {
    expect(mergeComposerPrefs({ autoSend: false })).toBe(false);
    expect(mergeComposerPrefs({ autoSend: true })).toBe(true);
  });
});
