import { describe, it, expect } from 'vitest';
import { detectTextLang } from './textLang';

describe('detectTextLang', () => {
  it('识别常见代码语言', () => {
    expect(detectTextLang('{"a":1}')).toBe('json');
    expect(detectTextLang('const a = 1;\nconsole.log(a)')).toBe('js');
    expect(detectTextLang('def add(a, b):\n  return a + b')).toBe('python');
    expect(detectTextLang('public class A { public static void main(String[] a) {} }')).toBe('java');
    expect(detectTextLang('#include <stdio.h>\nint main() { return 0; }')).toBe('cpp');
    expect(detectTextLang('SELECT id FROM users')).toBe('sql');
    expect(detectTextLang('<html><body>x</body></html>')).toBe('html');
    expect(detectTextLang('a: 1\nb: 2')).toBe('yaml');
    expect(detectTextLang('#!/bin/bash\necho hi')).toBe('shell');
  });

  it('普通文本返回空，由调用方默认按 JS 处理', () => {
    expect(detectTextLang('这是一段普通说明文字')).toBe('');
  });
});
