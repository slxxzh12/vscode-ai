import { describe, it, expect } from 'vitest';
import { cmLangFor } from './cmLang';

describe('cmLangFor', () => {
  it('已知扩展名按代码高亮，未知扩展名检测 JSON 内容', () => {
    expect(cmLangFor('a.js')).not.toBeNull();
    expect(cmLangFor('a.md')).not.toBeNull();
    expect(cmLangFor('a.log', '[1,2,3]')).not.toBeNull();
    expect(cmLangFor('a.log', 'plain log line')).toBeNull();
  });

  it('txt 按内容识别语言，识别不出时默认 JS', () => {
    expect(cmLangFor('a.txt')).not.toBeNull();
    expect(cmLangFor('a.txt', '{"a":1}')).not.toBeNull();
    expect(cmLangFor('a.txt', 'const a = 1')).not.toBeNull();
    expect(cmLangFor('a.txt', 'public class A { public static void main(String[] a) {} }')).not.toBeNull();
    expect(cmLangFor('a.txt', 'def add(a, b):\n  return a + b')).not.toBeNull();
    expect(cmLangFor('a.txt', '#include <stdio.h>\nint main() { return 0; }')).not.toBeNull();
  });
});
