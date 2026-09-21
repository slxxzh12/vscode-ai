import { describe, it, expect, vi, afterEach } from 'vitest';
import { projectTreeSource } from './projectTreeSource';

afterEach(() => vi.unstubAllGlobals());

function okJson(body: unknown) { return { ok: true, json: async () => body }; }

describe('projectTreeSource', () => {
  it('loadChildren 调 /api/tree 并映射为节点', async () => {
    const fetchMock = vi.fn(async () => okJson({ items: [{ name: 'src', type: 'dir' }, { name: 'a.txt', type: 'file' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const nodes = await src.loadChildren('');
    expect(fetchMock).toHaveBeenCalledWith('/api/tree?project=p1&path=');
    expect(nodes).toEqual([
      { key: 'src', name: 'src', kind: 'dir' },
      { key: 'a.txt', name: 'a.txt', kind: 'item' },
    ]);
  });

  it('loadChildren 子目录拼接相对路径', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [{ name: 'b.txt', type: 'file' }] })));
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const nodes = await src.loadChildren('src');
    expect(nodes).toEqual([{ key: 'src/b.txt', name: 'b.txt', kind: 'item' }]);
  });

  it('open 触发 onOpenFile(projectId, key, name)', () => {
    const onOpenFile = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile, onDetailFile: vi.fn() });
    src.open({ key: 'src/a.txt', name: 'a.txt', kind: 'item' });
    expect(onOpenFile).toHaveBeenCalledWith('p1', 'src/a.txt', 'a.txt');
  });

  it('detail 触发 onDetailFile', () => {
    const onDetailFile = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile });
    src.detail!({ key: 'a.txt', name: 'a.txt', kind: 'item' });
    expect(onDetailFile).toHaveBeenCalledWith('p1', 'a.txt', 'a.txt');
  });
});
