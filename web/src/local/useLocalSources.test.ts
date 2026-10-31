import { test, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLocalSources, MAX_DROP_FILES } from './useLocalSources';

const dirHandle = (name: string) => ({ kind: 'directory', name }) as unknown as FileSystemDirectoryHandle;
const fileHandle = (name: string) => ({ kind: 'file', name }) as unknown as FileSystemFileHandle;
const fakeFile = (name: string) => ({ name }) as unknown as File;

beforeEach(() => { useLocalSources().clearAll(); });
afterEach(() => { vi.unstubAllGlobals(); });

test('mountFolder 替换旧根并清 activePath，保留单文件条目', () => {
  const s = useLocalSources();
  s.mountFolder(dirHandle('a'));
  s.activePath.value = 'x.md';
  const { keys } = s.addFiles([{ name: 'f.txt', handle: fileHandle('f.txt'), file: null }]);
  s.mountFolder(dirHandle('b'));
  expect(s.root.value?.name).toBe('b');
  expect(s.activePath.value).toBe('');
  expect(s.files.value.has(keys[0])).toBe(true);
});

test('addFiles 返回 key，超上限截断', () => {
  const s = useLocalSources();
  const many = Array.from({ length: MAX_DROP_FILES + 3 }, (_, i) => ({ name: `f${i}.txt`, handle: fileHandle(`f${i}.txt`), file: null }));
  const r = s.addFiles(many);
  expect(r.keys).toHaveLength(MAX_DROP_FILES);
  expect(r.truncated).toBe(3);
  expect(s.files.value.size).toBe(MAX_DROP_FILES);
});

test('unmountRoot 与 removeFile 互不影响', () => {
  const s = useLocalSources();
  s.mountFolder(dirHandle('a'));
  const { keys } = s.addFiles([{ name: 'f.txt', handle: null, file: fakeFile('f.txt') }]);
  s.unmountRoot();
  expect(s.root.value).toBeNull();
  expect(s.files.value.size).toBe(1);
  s.removeFile(keys[0]);
  expect(s.files.value.size).toBe(0);
});

test('状态是模块级单例（多次调用共享）', () => {
  const a = useLocalSources();
  a.mountFolder(dirHandle('shared'));
  const b = useLocalSources();
  expect(b.root.value?.name).toBe('shared');
});
