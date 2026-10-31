import { describe, it, expect, vi, afterEach } from 'vitest';
import { useToolFiles } from './useToolFiles';

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }
afterEach(() => vi.unstubAllGlobals());

describe('useToolFiles', () => {
  it('load / read / save 请求按 tool 分组路径正确', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      urls.push(`${opt?.method || 'GET'} ${u}`);
      if (u.startsWith('/api/files/yaml/tree')) return okJson({ items: [{ id: 'a.yaml', folder: '', name: 'a.yaml' }], folders: [] });
      if (u.startsWith('/api/files/yaml/file?id=')) return okJson({ content: 'hi', size: 2 });
      return okJson({ ok: true });
    }));
    const n = useToolFiles('yaml');
    await n.load();
    expect(n.items.value[0].id).toBe('a.yaml');
    const c = await n.read('a.yaml');
    expect(c).toBe('hi');
    await n.save('a.yaml', 'x');
    expect(urls).toContain('PUT /api/files/yaml/file');
  });

  it('createFile 返回 id 并刷新', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.startsWith('/api/files/js/file') ? okJson({ ok: true, id: 'n.js' }) : okJson({ items: [], folders: [] }))));
    const n = useToolFiles('js');
    const id = await n.createFile('', 'n.js');
    expect(id).toBe('n.js');
  });

  it('失败返回 error 而不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(409, { error: 'exists' })));
    const n = useToolFiles('translate');
    const r = await n.createFolder('', 'x');
    expect(r).toEqual({ ok: false, error: 'exists' });
  });
});
