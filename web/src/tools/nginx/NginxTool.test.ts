// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import NginxTool from './NginxTool.vue';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }
const RULE = { id: '1', name: 'web', mode: 'port', enabled: true, listenHost: '127.0.0.1', listenPort: 8081, pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: 5173 }, tlsInsecure: true, headers: [], capture: false };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn((u: string) => {
    const s = String(u);
    if (s === '/api/nginx/rules') return okJson({ items: [RULE], status: { '1': { status: 'running', error: null } } });
    if (s.startsWith('/api/nginx/log')) return okJson({ items: [] });
    if (s.startsWith('/api/nginx/captures')) return okJson({ items: [] });
    return okJson({});
  }));
});

describe('NginxTool', () => {
  it('渲染规则并显示访问地址', async () => {
    const w = mountC(NginxTool);
    await flushPromises();
    expect(w.text()).toContain('web');
    expect(w.text()).toContain('127.0.0.1:8081');
    w.unmount();
  });
});
