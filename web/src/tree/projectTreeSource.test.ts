import { describe, it, expect, vi, afterEach } from 'vitest';
import { projectTreeSource } from './projectTreeSource';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('projectTreeSource.search', () => {
  it('按 project/q/case 请求 /api/search 并返回结果', async () => {
    const payload = { nameHits: [{ path: 'a.txt', name: 'a.txt' }], contentHits: [], truncated: false, scanned: 3 };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }));
    vi.stubGlobal('fetch', fetchMock);
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const r = await src.search!('target', { caseSensitive: true });
    expect(r).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/search?project=p1&q=target&case=1');
  });

  it('请求失败抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })));
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    await expect(src.search!('x', { caseSensitive: false })).rejects.toThrow('boom');
  });
});

describe('projectTreeSource.openHit', () => {
  it('有 onOpenFileAt 时带上 line', () => {
    const onOpenFileAt = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn(), onOpenFileAt });
    src.openHit!({ path: 'src/a.js', name: 'a.js', line: 7 });
    expect(onOpenFileAt).toHaveBeenCalledWith('p1', 'src/a.js', 'a.js', 7);
  });

  it('无 onOpenFileAt 时回退到 onOpenFile', () => {
    const onOpenFile = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile, onDetailFile: vi.fn() });
    src.openHit!({ path: 'a.txt', name: 'a.txt' });
    expect(onOpenFile).toHaveBeenCalledWith('p1', 'a.txt', 'a.txt');
  });
});
