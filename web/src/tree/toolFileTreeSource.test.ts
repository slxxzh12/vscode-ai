import { describe, it, expect, vi, afterEach } from 'vitest';
import { toolFileTreeSource } from './toolFileTreeSource';
import { useToolFiles } from '../tools/files/useToolFiles';

afterEach(() => vi.unstubAllGlobals());
function okJson(body: unknown) { return { ok: true, json: async () => body }; }

describe('toolFileTreeSource', () => {
  it('loadChildren 读 /api/files/<tool>/tree 并按目录只取直接子级', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okJson({
      folders: ['sub', 'sub/deep'],
      items: [
        { id: 'a.txt', folder: '', name: 'a.txt' },
        { id: 'sub/b.txt', folder: 'sub', name: 'b.txt' },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const files = useToolFiles('notepad');
    const src = toolFileTreeSource(files, { onOpen: vi.fn() });

    expect(await src.loadChildren('')).toEqual([
      { key: 'sub', name: 'sub', kind: 'dir' },
      { key: 'a.txt', name: 'a.txt', kind: 'item', time: '', status: undefined },
    ]);
    expect(await src.loadChildren('sub')).toEqual([
      { key: 'sub/deep', name: 'deep', kind: 'dir' },
      { key: 'sub/b.txt', name: 'b.txt', kind: 'item', time: '', status: undefined },
    ]);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/files/notepad/tree'))).toBe(true);
  });

  it('open 回调、rename 按类型分派', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ folders: [], items: [] })));
    const files = useToolFiles('yaml');
    const onOpen = vi.fn();
    const src = toolFileTreeSource(files, { onOpen });
    src.open({ key: 'x.yaml', name: 'x.yaml', kind: 'item' });
    expect(onOpen).toHaveBeenCalledWith({ key: 'x.yaml', name: 'x.yaml', kind: 'item' });

    const patch = vi.fn(async (_url: string, _init?: RequestInit) => okJson({ ok: true }));
    vi.stubGlobal('fetch', patch);
    await src.rename!({ key: 'x.yaml', name: 'x.yaml', kind: 'item' }, 'y.yaml');
    expect(patch.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(true);
  });
});
