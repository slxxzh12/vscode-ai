import { describe, it, expect } from 'vitest';
import { resolveRelPath, makeReadAsset } from './markdownAssets';
import type { DocSource } from './tools/doc/docSource';

describe('resolveRelPath', () => {
  it('按文件目录拼接并处理 ./ ../', () => {
    expect(resolveRelPath('docs', './a.csv')).toBe('docs/a.csv');
    expect(resolveRelPath('docs/sub', '../a.csv')).toBe('docs/a.csv');
    expect(resolveRelPath('', 'a.csv')).toBe('a.csv');
  });

  it('拒绝绝对路径与外部 URL', () => {
    expect(resolveRelPath('docs', '/a.csv')).toBeNull();
    expect(resolveRelPath('docs', 'https://x/a.csv')).toBeNull();
  });
});

describe('makeReadAsset', () => {
  it('读取相对路径对应的文件', async () => {
    const src = { read: async (p: string) => ({ name: p, content: `c:${p}`, size: 0 }) } as unknown as DocSource;
    const read = makeReadAsset(src, 'docs/a.md');
    expect(await read('./b.csv')).toBe('c:docs/b.csv');
  });
});
