import { describe, it, expect } from 'vitest';
import { isPhoneEntry } from './entry';

describe('isPhoneEntry', () => {
  it('识别 ?phone=1（含其它参数、hash）', () => {
    expect(isPhoneEntry('?phone=1')).toBe(true);
    expect(isPhoneEntry('?access=abc&phone=1')).toBe(true);
    expect(isPhoneEntry('?phone=1#x')).toBe(true);
  });

  it('其它情况为 false', () => {
    for (const s of ['', '?phone=0', '?phone', '?foo=1', '?phonenumber=1']) expect(isPhoneEntry(s)).toBe(false);
  });
});
