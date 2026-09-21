import { test, expect, beforeEach, vi } from 'vitest';
import { useLocalSources } from './useLocalSources';
import { localTreeSource } from './localTreeSource';

function fakeDir(name: string, entries: Record<string, any>): any {
  return {
    kind: 'directory',
    name,
    getDirectoryHandle: async (n: string) => {
      const e = entries[n];
      if (!e || e.kind !== 'directory') throw new Error('missing');
      return e;
    },
    getFileHandle: async (n: string) => { if (!entries[n]) throw new Error('missing'); return entries[n]; },
    *values() { for (const [k, v] of Object.entries(entries)) yield { name: k, kind: v.kind }; },
  };
}

const fileIn = (n: string) => ({ kind: 'file', name: n });

beforeEach(() => { useLocalSources().clearAll(); });

test('loadChildren 目录在前、文件在后并按名排序', async () => {
  useLocalSources().mountFolder(fakeDir('proj', {
    'z.txt': fileIn('z.txt'),
    'a.txt': fileIn('a.txt'),
    sub: fakeDir('sub', {}),
    b: fakeDir('b', {}),
  }));
  const src = localTreeSource(vi.fn());
  const rows = await src.loadChildren('');
  expect(rows.map((r) => `${r.kind}:${r.name}`)).toEqual(['dir:b', 'dir:sub', 'item:a.txt', 'item:z.txt']);
});

test('loadChildren 子目录用相对路径 key', async () => {
  useLocalSources().mountFolder(fakeDir('proj', { sub: fakeDir('sub', { 'x.md': fileIn('x.md') }) }));
  const rows = await localTreeSource(vi.fn()).loadChildren('sub');
  expect(rows).toEqual([{ key: 'sub/x.md', name: 'x.md', kind: 'item' }]);
});

test('越界/不存在的目录返回空；无根返回空', async () => {
  expect(await localTreeSource(vi.fn()).loadChildren('../x')).toEqual([]);
  useLocalSources().mountFolder(fakeDir('proj', {}));
  expect(await localTreeSource(vi.fn()).loadChildren('nope')).toEqual([]);
});

test('open 只对 item 回调', () => {
  const cb = vi.fn();
  const src = localTreeSource(cb);
  src.open({ key: 'a.txt', name: 'a.txt', kind: 'item' });
  expect(cb).toHaveBeenCalledWith({ key: 'a.txt', name: 'a.txt', kind: 'item' });
  src.open({ key: 'sub', name: 'sub', kind: 'dir' });
  expect(cb).toHaveBeenCalledTimes(1);
});
