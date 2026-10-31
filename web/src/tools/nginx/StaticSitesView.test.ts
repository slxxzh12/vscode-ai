// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import { t } from '../../i18n';
import StaticSitesView from './StaticSitesView.vue';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }

const STATIC = {
  id: 's', name: 'site', mode: 'port', enabled: true, listenHost: '127.0.0.1', listenPort: 8080,
  pathPrefix: '', stripPrefix: true, staticDir: 'C:/www', sitePrefix: '/index', target: { protocol: 'http', host: '', port: 0 },
  tlsInsecure: true, headers: [], rewrites: [], capture: false,
};
const PROXY = {
  id: 'p', name: 'api', mode: 'port', enabled: true, listenHost: '127.0.0.1', listenPort: 8081,
  pathPrefix: '', stripPrefix: true, staticDir: '', target: { protocol: 'http', host: 'a.local', port: 1111 },
  tlsInsecure: true, headers: [], rewrites: [], capture: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock = vi.fn((u: string) => {
    if (String(u) === '/api/nginx/rules') return okJson({ items: [STATIC, PROXY], status: { s: { status: 'running', error: null } } });
    return okJson({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('StaticSitesView', () => {
  it('只展示静态网站规则并显示访问地址', async () => {
    const w = mountC(StaticSitesView);
    await flushPromises();
    const cards = w.findAll('.sscard');
    expect(cards).toHaveLength(1);
    const dir = cards[0].find('[data-field="static-dir"]').element as HTMLInputElement;
    const prefix = cards[0].find('[data-field="site-prefix"]').element as HTMLInputElement;
    expect(dir.value).toBe('C:/www');
    expect(prefix.value).toBe('/index');
    expect(cards[0].text()).toContain('http://127.0.0.1:8080/index/');
    w.unmount();
  });

  it('未选择目录时不提交保存', async () => {
    const w = mountC(StaticSitesView);
    await flushPromises();
    await w.find('.ssnew').trigger('click');
    const card = w.find('.sscard');
    expect(card.exists()).toBe(true);
    const saveBtn = card.findAll('.ssactions .ssbtn')[0];
    await saveBtn.trigger('click');
    await flushPromises();
    expect(card.text()).toContain(t('static_site.pick_first'));
    const posts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(0);
    w.unmount();
  });
});
