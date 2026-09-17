import { describe, it, expect } from 'vitest';
import { toCsv, csvCell, zipStamp } from './csv';

describe('csvCell', () => {
  it('普通值原样', () => {
    expect(csvCell('a')).toBe('a');
    expect(csvCell(12)).toBe('12');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('含逗号/引号/换行时加引号并双写引号', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });
  it('公式前缀 = + - @ 前置单引号防注入', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });
  it('普通文本不以公式前缀处理', () => {
    expect(csvCell('a+b')).toBe('a+b');
  });
});

describe('toCsv', () => {
  it('带 BOM、CRLF 与表头', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('\uFEFFa,b\r\n1,2\r\n');
  });
  it('空行数组只有表头', () => {
    expect(toCsv(['a'], [])).toBe('\uFEFFa\r\n');
  });
  it('转义生效', () => {
    expect(toCsv(['x'], [['a,b'], ['a"b'], ['a\nb']])).toBe('\uFEFFx\r\n"a,b"\r\n"a""b"\r\n"a\nb"\r\n');
  });
});

describe('zipStamp', () => {
  it('yyyyMMdd-HHmm', () => {
    expect(zipStamp(new Date(2026, 8, 16, 15, 30))).toBe('20260916-1530');
  });
});
