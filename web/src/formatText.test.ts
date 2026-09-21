import { describe, it, expect } from 'vitest';
import { canFormatExt, formatText } from './formatText';

describe('canFormatExt', () => {
  it('命中的后缀返回 true', () => {
    for (const e of ['js', 'json', 'ts', 'css', 'html', 'md', 'yaml']) expect(canFormatExt(e)).toBe(true);
  });
  it('未命中的后缀返回 false', () => {
    for (const e of ['txt', 'log', '']) expect(canFormatExt(e)).toBe(false);
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
