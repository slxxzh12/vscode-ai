import { describe, it, expect } from 'vitest';
import { cmLangFor } from './cmLang';

describe('cmLangFor', () => {
  it('已知扩展名按代码高亮，未知扩展名检测 JSON 内容', () => {
    expect(cmLangFor('a.js')).not.toBeNull();
    expect(cmLangFor('a.md')).not.toBeNull();
    expect(cmLangFor('a.txt')).toBeNull();
    expect(cmLangFor('a.txt', '{"a":1}')).not.toBeNull();
    expect(cmLangFor('a.log', '[1,2,3]')).not.toBeNull();
    expect(cmLangFor('a.log', 'plain log line')).toBeNull();
  });
});
