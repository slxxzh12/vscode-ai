import { describe, it, expect, vi, afterEach } from 'vitest';
import { useNotepadFiles } from './useNotepadFiles';

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }
afterEach(() => vi.unstubAllGlobals());

describe('useNotepadFiles', () => {
  it('load / read / save 请求路径正确', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      urls.push(`${opt?.method || 'GET'} ${u}`);
      if (u.startsWith('/api/notepad/tree')) return okJson({ items: [{ id: 'a.txt', folder: '', name: 'a.txt' }], folders: [] });
      if (u.startsWith('/api/notepad/file?id=')) return okJson({ content: 'hi', size: 2 });
      return okJson({ ok: true });
    }));
    const n = useNotepadFiles();
    await n.load();
    expect(n.items.value[0].id).toBe('a.txt');
    const c = await n.read('a.txt');
    expect(c).toBe('hi');
    await n.save('a.txt', 'x');
    expect(urls).toContain('PUT /api/notepad/file');
  });

  it('createFile 返回 id 并刷新', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.startsWith('/api/notepad/file') ? okJson({ ok: true, id: 'n.txt' }) : okJson({ items: [], folders: [] }))));
    const n = useNotepadFiles();
    const id = await n.createFile('', 'n.txt');
    expect(id).toBe('n.txt');
  });

  it('失败返回 error 而不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(409, { error: 'exists' })));
    const n = useNotepadFiles();
    const r = await n.createFolder('', 'x');
    expect(r).toEqual({ ok: false, error: 'exists' });
  });
});
