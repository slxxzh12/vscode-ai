// @vitest-environment happy-dom
import { test, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLocalSources } from './useLocalSources';
import { localRootDocSource, localFileDocSource } from './localDocSource';
import { resetBlobs } from './localBlobs';

function fakeFile(name: string, content: string | Uint8Array): File {
  const body: BlobPart[] = [typeof content === 'string' ? content : (content.buffer as ArrayBuffer)];
  return new File(body, name);
}

function fakeFileHandle(file: File, perm: 'granted' | 'denied' = 'granted') {
  const h: any = {
    kind: 'file',
    name: file.name,
    written: null as string | null,
    getFile: async () => file,
    queryPermission: async () => perm,
    requestPermission: async () => perm,
    createWritable: async () => ({
      write: async (c: string) => { h.written = c; },
      close: async () => { /* done */ },
    }),
    getDirectoryHandle: async () => { throw new Error('not-a-dir'); },
  };
  return h as any;
}

function fakeDirHandle(name: string, entries: Record<string, any>) {
  const h: any = {
    kind: 'directory',
    name,
    getFileHandle: async (n: string) => { if (!entries[n]) throw new Error('missing'); return entries[n]; },
    getDirectoryHandle: async (n: string) => {
      const e = entries[n];
      if (!e || e.kind !== 'directory') throw new Error('missing');
      return e;
    },
    *values() { for (const [k, v] of Object.entries(entries)) yield { name: k, kind: v.kind }; },
  };
  return h as any;
}

beforeEach(() => {
  useLocalSources().clearAll();
  resetBlobs();
  let n = 0;
  vi.stubGlobal('URL', {
    createObjectURL: () => `blob:obj-${++n}`,
    revokeObjectURL: () => {},
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

test('根来源：读文本文件', async () => {
  const fileHandle = fakeFileHandle(fakeFile('a.txt', 'hello'));
  const s = useLocalSources();
  s.mountFolder(fakeDirHandle('proj', { 'a.txt': fileHandle }));
  const r = await localRootDocSource().read('a.txt');
  expect(r).toMatchObject({ name: 'a.txt', content: 'hello', size: 5 });
});

test('根来源：二进制文件返回 binary', async () => {
  const fileHandle = fakeFileHandle(fakeFile('a.bin', new Uint8Array([1, 0, 2])));
  useLocalSources().mountFolder(fakeDirHandle('proj', { 'a.bin': fileHandle }));
  const r = await localRootDocSource().read('a.bin');
  expect(r.binary).toBe(true);
});

test('根来源：图片返回 blob URL 且 rawUrl 同步可得', async () => {
  const fileHandle = fakeFileHandle(fakeFile('a.png', new Uint8Array([137, 80])));
  useLocalSources().mountFolder(fakeDirHandle('proj', { 'a.png': fileHandle }));
  const src = localRootDocSource();
  const r = await src.read('a.png');
  expect(r.binary).toBe(true);
  expect(src.rawUrl!('a.png')).toBe('blob:obj-1');
});

test('根来源：超过 10MB 文本拒绝', async () => {
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  const fileHandle = fakeFileHandle(fakeFile('big.txt', big));
  useLocalSources().mountFolder(fakeDirHandle('proj', { 'big.txt': fileHandle }));
  await expect(localRootDocSource().read('big.txt')).rejects.toThrow(/超过|exceeds/);
});

test('根来源：写回调用 createWritable', async () => {
  const fileHandle = fakeFileHandle(fakeFile('a.txt', 'old'));
  useLocalSources().mountFolder(fakeDirHandle('proj', { 'a.txt': fileHandle }));
  await localRootDocSource().write('a.txt', 'new');
  expect(fileHandle.written).toBe('new');
});

test('写回被拒：抛出授权提示', async () => {
  const fileHandle = fakeFileHandle(fakeFile('a.txt', 'old'), 'denied');
  useLocalSources().mountFolder(fakeDirHandle('proj', { 'a.txt': fileHandle }));
  await expect(localRootDocSource().write('a.txt', 'new')).rejects.toThrow(/授权|permission/i);
});

test('单文件来源：无句柄（降级）时读 File、写抛不支持', async () => {
  const s = useLocalSources();
  const { keys } = s.addFiles([{ name: 'f.txt', handle: null, file: fakeFile('f.txt', 'ro') }]);
  const src = localFileDocSource(keys[0]);
  expect((await src.read('f.txt')).content).toBe('ro');
  await expect(src.write('f.txt', 'x')).rejects.toThrow(/写回|write/i);
});

test('根来源：解析 markdown 相对资源为 blob URL', async () => {
  const img = fakeFileHandle(fakeFile('logo.png', new Uint8Array([1, 2])));
  useLocalSources().mountFolder(fakeDirHandle('proj', { assets: fakeDirHandle('assets', { 'logo.png': img }) }));
  const m = await localRootDocSource().resolveMarkdownAssets!([{ rel: 'assets/logo.png', suffix: '' }]);
  expect(m.get('assets/logo.png')).toBe('blob:obj-1');
});
