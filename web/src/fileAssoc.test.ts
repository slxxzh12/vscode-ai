import { describe, it, expect, vi, afterEach } from 'vitest';
import { getFileAssoc, setFileAssoc } from './fileAssoc';

afterEach(() => { vi.unstubAllGlobals(); });

describe('fileAssoc api', () => {
  it('getFileAssoc 返回状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ available: true, enabled: false, prompted: false, extensions: [] }) })));
    const r = await getFileAssoc();
    expect(r?.available).toBe(true);
    expect(r?.prompted).toBe(false);
  });

  it('getFileAssoc 网络异常返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('x'); }));
    expect(await getFileAssoc()).toBeNull();
  });

  it('setFileAssoc 发 POST 并带 enabled 与 selected', async () => {
    const fn = vi.fn(async (_u: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ available: true, enabled: true, prompted: true, extensions: [] }) }));
    vi.stubGlobal('fetch', fn);
    const r = await setFileAssoc(true, ['.pdf', '.md']);
    expect(fn.mock.calls[0][0]).toBe('/api/file-assoc');
    expect((fn.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect((fn.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ enabled: true, selected: ['.pdf', '.md'] }));
    expect(r?.enabled).toBe(true);
  });

  it('setFileAssoc 非 2xx 返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) })));
    expect(await setFileAssoc(false, [])).toBeNull();
  });
});
