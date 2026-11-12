// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import AiSiteView from './AiSiteView.vue';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }

const CONFIG = { pluginRoot: 'C:/plugins', mode: 'port', listenHost: '0.0.0.0', listenPort: 22300, pathPrefix: '/ai', enabled: true, requireAuth: true, sessionSecret: 'x' };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock = vi.fn((u: string, opt?: RequestInit) => {
    const s = String(u);
    if (s === '/api/ai-site/config') return okJson({ config: CONFIG, status: { status: 'running', error: null } });
    if (s === '/api/ai-site/plugins') return okJson({ items: [{ name: 'p1', title: 'P1', description: 'd' }] });
    if (s === '/api/ai-site/users' && (!opt || opt.method !== 'POST')) return okJson({ items: [{ id: 'u1', username: 'alice', token: 't', enabled: true, uses: 2, lastLoginAt: 0, lastRunAt: 0 }] });
    if (s === '/api/ai-site/users') return okJson({ ok: true, item: { id: 'u2', username: 'bob', token: 't2' } });
    if (s.startsWith('/api/projects/pick')) return okJson({ path: 'C:/plugins' });
    return okJson({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('AiSiteView', () => {
  it('展示配置、插件与用户使用次数', async () => {
    const w = mountC(AiSiteView);
    await flushPromises();
    expect((w.find('[data-field="plugin-root"]').element as HTMLInputElement).value).toBe('C:/plugins');
    expect(w.text()).toContain('P1');
    expect(w.text()).toContain('alice');
    expect(w.text()).toContain('2');
    w.unmount();
  });

  it('新增用户走 POST /api/ai-site/users', async () => {
    const w = mountC(AiSiteView);
    await flushPromises();
    await w.find('[data-field="new-user"]').setValue('bob');
    await w.find('[data-action="add-user"]').trigger('click');
    await flushPromises();
    const post = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/ai-site/users' && (c[1] as RequestInit)?.method === 'POST');
    expect(post).toBeTruthy();
    w.unmount();
  });
});
