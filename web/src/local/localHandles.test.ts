import { test, expect, vi, afterEach } from 'vitest';
import { extOf, kindOf, isTooLarge, splitRel, joinRel, isProbablyBinary, supportsHandles, partitionHandles, MAX_TEXT_BYTES } from './localHandles';

afterEach(() => { vi.unstubAllGlobals(); });

test('extOf / kindOf 与 DocViewer 判定一致', () => {
  expect(extOf('a.PNG')).toBe('png');
  expect(extOf('noext')).toBe('');
  expect(kindOf('a.png')).toBe('image');
  expect(kindOf('a.svg')).toBe('image');
  expect(kindOf('a.pdf')).toBe('pdf');
  expect(kindOf('a.md')).toBe('text');
  expect(kindOf('a')).toBe('text');
});

test('splitRel 规范化并阻止越界', () => {
  expect(splitRel('a/b/c.txt')).toEqual(['a', 'b', 'c.txt']);
  expect(splitRel('a\\b')).toEqual(['a', 'b']);
  expect(splitRel('/a//./b')).toEqual(['a', 'b']);
  expect(splitRel('a/../b')).toEqual(['b']);
  expect(splitRel('../x')).toBeNull();
  expect(splitRel('a/../../x')).toBeNull();
  expect(splitRel('')).toEqual([]);
});

test('joinRel 拼接并归一', () => {
  expect(joinRel('docs/sub', 'a.png')).toBe('docs/sub/a.png');
  expect(joinRel('docs', '../a.png')).toBe('a.png');
});

test('isTooLarge 边界', () => {
  expect(isTooLarge(MAX_TEXT_BYTES)).toBe(false);
  expect(isTooLarge(MAX_TEXT_BYTES + 1)).toBe(true);
});

test('isProbablyBinary 检测 NUL', () => {
  expect(isProbablyBinary(new Uint8Array([104, 105]))).toBe(false);
  expect(isProbablyBinary(new Uint8Array([104, 0, 105]))).toBe(true);
});

test('supportsHandles 依据 DataTransferItem', () => {
  vi.stubGlobal('DataTransferItem', undefined);
  expect(supportsHandles()).toBe(false);
  vi.stubGlobal('DataTransferItem', function () {} as unknown);
  expect(supportsHandles()).toBe(false);
  vi.stubGlobal('DataTransferItem', { prototype: { getAsFileSystemHandle() {} } } as unknown);
  expect(supportsHandles()).toBe(true);
});

test('partitionHandles 按 kind 分组并丢弃 null', () => {
  const f = { kind: 'file', name: 'a' };
  const d = { kind: 'directory', name: 'dir' };
  const r = partitionHandles([f, null, d] as unknown as Array<{ kind: string; name: string } | null>);
  expect(r.files.map((x) => x.name)).toEqual(['a']);
  expect(r.dirs.map((x) => x.name)).toEqual(['dir']);
});
