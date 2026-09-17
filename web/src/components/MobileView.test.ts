// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import MobileView from './MobileView.vue';
import { locale } from '../i18n';

afterEach(() => {
  vi.unstubAllGlobals();
  locale.value = 'zh-CN';
});

describe('MobileView', () => {
  it('公告有内容时渲染 Markdown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: true, content: '## 公告标题' }) })));
    const w = mountC(MobileView);
    await flushPromises();
    expect(w.find('.nbody h2').exists()).toBe(true);
    expect(w.find('.nbody').text()).toContain('公告标题');
  });

  it('公告为空时显示空态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: true, content: '   ' }) })));
    const w = mountC(MobileView);
    await flushPromises();
    expect(w.find('.nbody').exists()).toBe(false);
    expect(w.find('.hint').exists()).toBe(true);
  });

  it('请求失败时显示空态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    const w = mountC(MobileView);
    await flushPromises();
    expect(w.find('.hint').exists()).toBe(true);
  });

  it('渲染下载卡片与内嵌小工具', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: false }) })));
    const w = mountC(MobileView);
    await flushPromises();
    expect(w.findAll('.card')).toHaveLength(2);
    expect(w.find('.qr').exists()).toBe(true);
    expect(w.findAll('.mticon')).toHaveLength(6);
    expect(w.find('.col-tools').exists()).toBe(true);
  });

  it('切换语言会重新拉取公告', async () => {
    const fetchMock = vi.fn(async (_url?: string) => ({ json: async () => ({ ok: true, content: 'x' }) }));
    vi.stubGlobal('fetch', fetchMock);
    mountC(MobileView);
    await flushPromises();
    const before = fetchMock.mock.calls.length;
    locale.value = 'en';
    await flushPromises();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('lang=en');
  });
});
