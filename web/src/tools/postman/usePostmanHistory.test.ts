// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { usePostmanHistory } from './usePostmanHistory';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }

afterEach(() => vi.unstubAllGlobals());

describe('usePostmanHistory', () => {
  it('load 拉取 items/folders', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [{ id: 'a.json', command: 'curl a' }], folders: ['foo'] })));
    const s = usePostmanHistory();
    await s.load();
    expect(s.history.value).toHaveLength(1);
    expect(s.folders.value).toEqual(['foo']);
  });

  it('createFolder 拼父路径并 POST', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method, init?.body ? JSON.parse(String(init.body)) : undefined]);
      return okJson({ ok: true, folder: 'foo/bar' });
    }));
    const s = usePostmanHistory();
    const res = await s.createFolder('foo', 'bar');
    expect(res).toEqual({ ok: true, path: 'foo/bar' });
    expect(calls[0]).toEqual(['/api/postman/folder', 'POST', { path: 'foo/bar' }]);
  });

  it('createFolder 根目录不带斜杠', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method, JSON.parse(String(init.body))]);
      return okJson({ ok: true });
    }));
    const s = usePostmanHistory();
    await s.createFolder('', 'top');
    expect(calls[0][2]).toEqual({ path: 'top' });
  });

  it('renameFolder 用 PATCH 并返回新路径', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method, JSON.parse(String(init.body))]);
      return okJson({ ok: true, path: 'foo2' });
    }));
    const s = usePostmanHistory();
    const res = await s.renameFolder('foo', 'foo2');
    expect(calls[0]).toEqual(['/api/postman/folder', 'PATCH', { path: 'foo', name: 'foo2' }]);
    expect(res).toEqual({ ok: true, path: 'foo2' });
  });

  it('renameFolder 冲突返回 error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(400, { error: 'exists' })));
    const s = usePostmanHistory();
    expect(await s.renameFolder('a', 'b')).toEqual({ ok: false, error: 'exists' });
  });

  it('renameRecord 用 PATCH /api/postman/history', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method, JSON.parse(String(init.body))]);
      return okJson({ ok: true });
    }));
    const s = usePostmanHistory();
    const res = await s.renameRecord('a.json', 'My A');
    expect(calls[0]).toEqual(['/api/postman/history', 'PATCH', { id: 'a.json', title: 'My A' }]);
    expect(res.ok).toBe(true);
  });

  it('runCurl 返回结果并在失败时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/curl'
      ? okJson({ ok: true, code: 0, stdout: 'hi', stderr: '', timedOut: false })
      : okJson({ items: [], folders: [] }))));
    const s = usePostmanHistory();
    const j = await s.runCurl('curl x', '');
    expect(j.stdout).toBe('hi');

    vi.stubGlobal('fetch', vi.fn(async () => errJson(400, { message: 'bad' })));
    await expect(s.runCurl('bad', '')).rejects.toThrow('bad');
  });
});
