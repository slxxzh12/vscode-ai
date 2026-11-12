import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAiSite } from './useAiSite';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock = vi.fn((u: string) => {
    if (String(u) === '/api/ai-site/config') return okJson({ config: { pluginRoot: 'C:/p', mode: 'port', listenPort: 22300, pathPrefix: '/ai', enabled: true, requireAuth: true, listenHost: '0.0.0.0', sessionSecret: 'x' }, status: { status: 'running' } });
    if (String(u) === '/api/ai-site/plugins') return okJson({ items: [{ name: 'p1', title: 'P1' }] });
    if (String(u) === '/api/ai-site/users') return okJson({ items: [{ id: 'u1', username: 'alice', uses: 2 }] });
    return okJson({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('useAiSite', () => {
  it('load 读取配置/插件/用户', async () => {
    const api = useAiSite();
    await api.load();
    expect(api.config.value?.pluginRoot).toBe('C:/p');
    expect(api.status.value?.status).toBe('running');
    expect(api.plugins.value[0].name).toBe('p1');
    expect(api.users.value[0].username).toBe('alice');
  });

  it('save/start/stop 走 POST', async () => {
    const api = useAiSite();
    await api.save({ enabled: true });
    await api.start();
    await api.stop();
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
    expect(methods).toContain('POST');
  });

  it('pickFolder 调项目选择接口', async () => {
    fetchMock.mockImplementation(() => okJson({ path: 'C:/plugins' }));
    const api = useAiSite();
    const r = await api.pickFolder();
    expect(r.path).toBe('C:/plugins');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects/pick');
  });
});
