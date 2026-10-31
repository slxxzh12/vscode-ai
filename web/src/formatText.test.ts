import { describe, it, expect } from 'vitest';
import { canFormatExt, formatExtFor, formatText, looksLikeJson } from './formatText';

describe('canFormatExt', () => {
  it('命中的后缀返回 true', () => {
    for (const e of ['js', 'json', 'ts', 'css', 'html', 'md', 'yaml']) expect(canFormatExt(e)).toBe(true);
  });
  it('未命中的后缀返回 false', () => {
    for (const e of ['txt', 'log', '']) expect(canFormatExt(e)).toBe(false);
  });
});

describe('looksLikeJson', () => {
  it('合法 JSON 对象/数组返回 true', () => {
    expect(looksLikeJson('{"a":1}')).toBe(true);
    expect(looksLikeJson('  [1, 2]  ')).toBe(true);
  });
  it('普通文本/非法 JSON 返回 false', () => {
    expect(looksLikeJson('hello')).toBe(false);
    expect(looksLikeJson('{a:1}')).toBe(false);
    expect(looksLikeJson('')).toBe(false);
  });
});

describe('formatExtFor', () => {
  it('优先文件后缀', () => {
    expect(formatExtFor('{"a":1}', 'js')).toBe('js');
    expect(formatExtFor('x', 'txt')).toBe('');
  });
  it('后缀不支持但内容是 JSON 时退回 json', () => {
    expect(formatExtFor('{"a":1}', 'txt')).toBe('json');
  });
});

describe('formatText', () => {
  it('格式化 JSON', async () => {
    expect(await formatText('{"a":1,"b":[1,2]}', 'json')).toBe('{ "a": 1, "b": [1, 2] }\n');
  });

  it('不支持的后缀抛错', async () => {
    await expect(formatText('x', 'txt')).rejects.toThrow();
  });
});
