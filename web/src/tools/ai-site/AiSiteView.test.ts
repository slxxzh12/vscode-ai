// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../../test-utils';
import AiSiteView from './AiSiteView.vue';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }

const CONFIG = { pluginRoot: 'C:/plugins', pluginRootDefault: false, pluginRootDefaultPath: 'C:/app/demo_plugins', mode: 'port', listenHost: '0.0.0.0', listenPort: 22300, pathPrefix: '/ai', enabled: true, requireAuth: true, sessionSecret: 'x' };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock = vi.fn((u: string, opt?: RequestInit) => {
    const s = String(u);
    if (s === '/api/ai-site/config') return okJson({ config: CONFIG, status: { status: 'running', error: null } });
    if (s === '/api/ai-site/plugins') return okJson({ items: [{ name: 'p1', title: 'P1', description: 'd' }] });
    if (s === '/api/ai-site/users' && opt?.method === 'POST') return okJson({ ok: true, item: { id: 'u2', username: 'bob', jwt: 'a.b.c', jti: 'j2', iat: 1, exp: Math.floor(Date.now() / 1000) + 86400, revoked: false, enabled: true, uses: 0, lastLoginAt: 0, lastRunAt: 0 } });
    if (s === '/api/ai-site/users') return okJson({ items: [{ id: 'u1', username: 'alice', jwt: 'a.b.c', jti: 'j1', iat: 1, exp: Math.floor(Date.now() / 1000) + 86400, revoked: false, enabled: true, uses: 2, lastLoginAt: 0, lastRunAt: 0 }] });
    if (s.startsWith('/api/projects/pick')) return okJson({ path: 'C:/plugins' });
    return okJson({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('AiSiteView', () => {
  it('展示配置、插件与用户使用次数', async () => {
    const w = mountC(AiSiteView, { global: { plugins: [ElementPlus] } });
    await flushPromises();
    expect((w.find('[data-field="plugin-root"]').element as HTMLInputElement).value).toBe('C:/plugins');
    expect(w.text()).toContain('P1');
    expect(w.text()).toContain('alice');
    expect(w.text()).toContain('2');
    w.unmount();
  });

  it('新增用户走 POST /api/ai-site/users', async () => {
    const w = mountC(AiSiteView, { global: { plugins: [ElementPlus] } });
    await flushPromises();
    expect(w.find('[data-field="new-expiry"]').exists()).toBe(true);
    await w.find('[data-field="new-user"]').setValue('bob');
    await w.find('[data-action="add-user"]').trigger('click');
    await flushPromises();
    const post = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/ai-site/users' && (c[1] as RequestInit)?.method === 'POST');
    expect(post).toBeTruthy();
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body.username).toBe('bob');
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    w.unmount();
  });
});
