import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNginx, type NginxRule } from './useNginx';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }

beforeEach(() => vi.restoreAllMocks());

describe('useNginx', () => {
  it('load 读取规则与状态', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((u: string) => { calls.push(String(u)); return okJson({ items: [{ id: '1', name: 'a' }], status: { '1': { status: 'running' } } }); }));
    const api = useNginx();
    await api.load();
    expect(calls[0]).toBe('/api/nginx/rules');
    expect(api.rules.value.length).toBe(1);
    expect(api.status.value['1'].status).toBe('running');
  });

  it('save：无 id 用 POST，有 id 用 PATCH', async () => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => { if (init?.method) methods.push(String(init.method)); return okJson({ ok: true, item: { id: '1' } }); }));
    const api = useNginx();
    await api.save({ name: 'a' } as NginxRule);
    await api.save({ id: '1', name: 'a' } as NginxRule);
    expect(methods).toEqual(['POST', 'PATCH']);
  });

  it('capture 详情读取', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((u: string) => { urls.push(String(u)); return okJson({ item: { record: { id: 'c1' } } }); }));
    const api = useNginx();
    const rec = await api.capture('r1', 'c1');
    expect(urls[0]).toBe('/api/nginx/captures/r1/c1');
    expect(rec.record.id).toBe('c1');
  });
});
