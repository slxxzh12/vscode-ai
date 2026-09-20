// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useNavicat } from './useNavicat';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }

afterEach(() => vi.unstubAllGlobals());

const PROFILE = { name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', password: 'p' };

describe('useNavicat', () => {
  it('load 拉取 items', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [{ id: '1', name: 'A' }] })));
    const s = useNavicat();
    await s.load();
    expect(s.profiles.value).toHaveLength(1);
  });

  it('save：无 id 走 POST，有 id 走 PATCH', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method]);
      return okJson({ ok: true, item: { id: '1', name: 'A' } });
    }));
    const s = useNavicat();
    await s.save({ ...PROFILE } as any);
    await s.save({ ...PROFILE, id: '1' } as any);
    expect(calls.find((c) => c[1] === 'POST')).toEqual(['/api/navicat/profiles', 'POST']);
    expect(calls.find((c) => c[1] === 'PATCH')).toEqual(['/api/navicat/profiles', 'PATCH']);
  });

  it('exec：needConfirm 透出，确认后返回结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      if (b.confirm) return okJson({ ok: true, result: { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 2 } });
      return okJson({ needConfirm: true, kind: 'write' });
    }));
    const s = useNavicat();
    const a = await s.exec('1', 'INSERT INTO t VALUES (1)');
    expect(a.needConfirm).toBe(true);
    const b = await s.exec('1', 'INSERT INTO t VALUES (1)', true);
    expect(b.result?.rows).toEqual([[1]]);
  });

  it('exec：失败抛 message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(504, { error: 'timeout', message: '执行超时' })));
    const s = useNavicat();
    await expect(s.exec('1', 'SELECT 1')).rejects.toThrow('执行超时');
  });

  it('reveal/connstr/exportNcx 打对应端点', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(String(u));
      if (String(u).endsWith('/reveal')) return okJson({ password: 'p' });
      if (String(u).endsWith('/connstr')) return okJson({ text: 'mysql://u@h/d' });
      return okJson({ xml: '<Connections/>' });
    }));
    const s = useNavicat();
    expect(await s.reveal('1')).toBe('p');
    expect(await s.connstr('1', true)).toBe('mysql://u@h/d');
    expect(await s.exportNcx(['1'])).toContain('Connections');
    expect(urls).toEqual(['/api/navicat/reveal', '/api/navicat/connstr', '/api/navicat/ncx']);
  });
});
