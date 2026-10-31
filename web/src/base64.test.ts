import { describe, it, expect } from 'vitest';
import { encodeB64, decodeB64 } from './base64';

describe('base64', () => {
  it('空串编解码', () => {
    expect(encodeB64('')).toBe('');
    expect(decodeB64('')).toBe('');
  });

  it('ASCII 往返', () => {
    expect(encodeB64('hello')).toBe('aGVsbG8=');
    expect(decodeB64('aGVsbG8=')).toBe('hello');
  });

  it('中文往返', () => {
    const src = '你好，世界';
    expect(decodeB64(encodeB64(src))).toBe(src);
  });

  it('emoji 往返', () => {
    const src = 'a😀b';
    expect(decodeB64(encodeB64(src))).toBe(src);
  });

  it('解码忽略首尾空白，非法输入抛错', () => {
    expect(decodeB64('  aGVsbG8=  ')).toBe('hello');
    expect(() => decodeB64('!!!not-base64!!!')).toThrow();
  });
});
