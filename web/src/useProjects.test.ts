import { describe, it, expect, vi, afterEach } from 'vitest';
import { useProjects } from './useProjects';

function okJson(data: unknown) { return { ok: true, status: 200, json: async () => data }; }
function errJson(status: number, data: unknown) { return { ok: false, status, json: async () => data }; }
function errNoJson(status: number) { return { ok: false, status, json: async () => { throw new Error('not json'); } }; }

describe('useProjects', () => {
  afterEach(() => vi.unstubAllGlobals());
  const api = useProjects();

  it('读接口走 GET 并按路径解析字段', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u);
      if (u === '/api/projects') return okJson({ projects: [{ id: 'a', name: 'A', root: '/a' }] });
      if (u.startsWith('/api/tree')) return okJson({ items: [{ name: 'f', type: 'file' }] });
      if (u.startsWith('/api/file?')) return okJson({ name: 'f', path: 'f', size: 1, content: 'x' });
      if (u.startsWith('/api/file/meta')) return okJson({ name: 'f', path: 'f', abs: '/a/f', size: 1, mtime: 2, isDir: false });
      if (u.startsWith('/api/file/hash')) return okJson({ md5: 'm', sha256: 's' });
      return okJson({});
    }));
    expect(await api.list()).toEqual([{ id: 'a', name: 'A', root: '/a' }]);
    expect(await api.tree('a', 'src')).toEqual([{ name: 'f', type: 'file' }]);
    expect(urls[1]).toBe('/api/tree?project=a&path=src');
    expect((await api.text('a', 'f')).content).toBe('x');
    expect((await api.fileMeta('a', 'f')).isDir).toBe(false);
    expect(await api.fileHash('a', 'f')).toEqual({ md5: 'm', sha256: 's' });
  });

  it('GET 非 2xx 抛带状态与路径的错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(404, {})));
    await expect(api.list()).rejects.toThrow('/api/projects');
  });

  it('写接口成功返回 body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ project: { id: 'b', name: 'B', root: '/b' } })));
    expect((await api.add('/b')).id).toBe('b');

    vi.stubGlobal('fetch', vi.fn(async () => okJson({ project: { id: 'b', name: 'B', root: '/b', temp: true }, rel: 'f' })));
    expect((await api.openPath('/b/f')).rel).toBe('f');

    vi.stubGlobal('fetch', vi.fn(async () => okJson({ path: '/c' })));
    expect((await api.pickFolder()).path).toBe('/c');

    vi.stubGlobal('fetch', vi.fn(async () => okJson({ name: 'f', path: 'f', size: 1, content: 'y' })));
    const picked = await api.pickTextFile();
    expect('content' in picked && picked.content).toBe('y');

    vi.stubGlobal('fetch', vi.fn(async () => okJson({ size: 3 })));
    expect(await api.write('a', 'f', 'xyz')).toEqual({ size: 3 });
    expect(await api.createFile('a', 'g')).toEqual({ size: 3 });
    expect(await api.createDir('a', 'd')).toEqual({ size: 3 });

    vi.stubGlobal('fetch', vi.fn(async () => okJson({ ok: true, platform: 'win32' })));
    expect((await api.reveal('a', 'f')).ok).toBe(true);
    expect((await api.runScript('a', 'f')).platform).toBe('win32');

    vi.stubGlobal('fetch', vi.fn(async () => okJson({ content: 'z', size: 1 })));
    expect((await api.format('f.js', 'x')).content).toBe('z');
  });

  it('写接口非 2xx 抛错；json 不可解析时回退 HTTP 状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(400, { error: 'bad' })));
    await expect(api.add('/a')).rejects.toThrow('bad');
    await expect(api.openPath('/a')).rejects.toThrow('bad');
    await expect(api.pickTextFile()).rejects.toThrow('bad');
    await expect(api.write('a', 'f', 'x')).rejects.toThrow('bad');
    await expect(api.createFile('a', 'f')).rejects.toThrow('bad');
    await expect(api.createDir('a', 'f')).rejects.toThrow('bad');
    await expect(api.reveal('a', 'f')).rejects.toThrow('bad');
    await expect(api.runScript('a', 'f')).rejects.toThrow('bad');

    vi.stubGlobal('fetch', vi.fn(async () => errNoJson(500)));
    await expect(api.add('/a')).rejects.toThrow('HTTP 500');

    vi.stubGlobal('fetch', vi.fn(async () => errJson(500, {})));
    await expect(api.format('f.js', 'x')).rejects.toThrow('format failed');
  });

  it('openPath 优先 message、add 优先 error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(409, { error: 'already added' })));
    await expect(api.add('/a')).rejects.toThrow('already added');
    vi.stubGlobal('fetch', vi.fn(async () => errJson(404, { message: 'not found' })));
    await expect(api.openPath('/a')).rejects.toThrow('not found');
  });

  it('rawUrl 对项目与路径做编码', () => {
    expect(api.rawUrl('a b', 'x y/z.txt')).toBe('/api/raw?project=a%20b&path=x%20y%2Fz.txt');
  });
});
