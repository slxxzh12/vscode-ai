// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import AppMarketView from './AppMarketView.vue';
import { locale } from '../i18n';
import { MARKET_CLIENTS } from '../marketApps';

function mount() {
  return mountC(AppMarketView, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  locale.value = 'zh-CN';
});

describe('AppMarketView', () => {
  it('公告有内容时渲染 Markdown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: true, content: '## 公告标题' }) })));
    const w = mount();
    await flushPromises();
    expect(w.find('.nbody h2').exists()).toBe(true);
    expect(w.find('.nbody').text()).toContain('公告标题');
  });

  it('公告为空时显示空态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: true, content: '   ' }) })));
    const w = mount();
    await flushPromises();
    expect(w.find('.nbody').exists()).toBe(false);
    expect(w.find('.hint').exists()).toBe(true);
  });

  it('请求失败时显示空态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    const w = mount();
    await flushPromises();
    expect(w.find('.hint').exists()).toBe(true);
  });

  it('渲染客户端卡片与内嵌小工具', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: false }) })));
    const w = mount();
    await flushPromises();
    expect(w.findAll('.card')).toHaveLength(MARKET_CLIENTS.length);
    expect(w.findAll('.dl')).toHaveLength(1);
    expect(w.findAll('.card.soon')).toHaveLength(MARKET_CLIENTS.length - 1);
    expect(w.findAll('.mticon')).toHaveLength(6);
  });

  it('无扩展时显示空态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const w = mount();
    await flushPromises();
    expect(w.find('.exts').exists()).toBe(false);
    expect(w.find('.empty').exists()).toBe(true);
  });

  it('扩展列表可安装', async () => {
    locale.value = 'zh-CN';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/collab/downloads') && (!init || init.method !== 'POST')) {
        return { ok: true, json: async () => ({ manifest: { files: [{ name: 'a.zip', kind: 'skill', size: 1024, updatedAt: 1 }] } }) };
      }
      if (url === '/api/collab/downloads/install') {
        return { ok: true, json: async () => ({ code: 'ok' }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const w = mount();
    await flushPromises();
    expect(w.findAll('.ext')).toHaveLength(1);
    const btn = w.find('.einstall');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/collab/downloads/install', expect.objectContaining({ method: 'POST' }));
    expect(w.text()).toContain('已安装');
  });

  it('切换语言会重新拉取公告', async () => {
    const fetchMock = vi.fn(async (_url?: string) => ({ json: async () => ({ ok: true, content: 'x' }) }));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    await flushPromises();
    const before = fetchMock.mock.calls.length;
    locale.value = 'en';
    await flushPromises();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('lang=en');
  });
});
