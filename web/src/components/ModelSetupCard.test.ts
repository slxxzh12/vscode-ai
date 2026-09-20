// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import { locale } from '../i18n';
import ModelSetupCard from './ModelSetupCard.vue';

function mount() { return mountC(ModelSetupCard, {}); }

function cfg(provider: Record<string, unknown>) {
  return { path: 'x', exists: true, format: 'json', raw: '', config: { provider } };
}

beforeEach(() => { locale.value = 'zh-CN'; });
afterEach(() => { vi.unstubAllGlobals(); locale.value = 'zh-CN'; });

describe('ModelSetupCard', () => {
  it('回显已配置 provider（含自定义）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => cfg({
      deepseek: { options: { apiKey: 'K' }, models: { 'deepseek-v4-flash': {} } },
      corp: { name: 'Corp', options: { baseURL: 'https://gw/v1', apiKey: 'C' }, models: { a: {} } },
    }) })));
    const w = mount();
    await flushPromises();
    expect(w.findAll('.prov')).toHaveLength(2);
    expect(w.text()).toContain('deepseek');
    const custom = w.findAll('.prov')[1];
    expect((custom.find('input').element as HTMLInputElement).value).toBe('Corp');
    expect(custom.text()).toContain('https://gw/v1');
  });

  it('空配置时不平铺预设', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => cfg({}) })));
    const w = mount();
    await flushPromises();
    expect(w.findAll('.prov')).toHaveLength(0);
    expect(w.text()).toContain('暂无已配置的 provider');
  });

  it('下拉添加自定义 provider 出现编辑框', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => cfg({}) })));
    const w = mount();
    await flushPromises();
    await w.find('[data-test="add"]').setValue('__custom__');
    await flushPromises();
    expect(w.findAll('.prov')).toHaveLength(1);
    expect(w.find('.prov input[placeholder="Provider ID"]').exists()).toBe(true);
    expect(w.find('.prov input[placeholder="Base URL"]').exists()).toBe(true);
  });

  it('移除已配置 provider 并在保存时提交 remove', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ ok: true, skipped: [] }) };
      return { ok: true, json: async () => cfg({ corp: { options: { baseURL: 'https://gw/v1', apiKey: 'C' }, models: { a: {} } } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const w = mount();
    await flushPromises();
    const rm = w.findAll('button').find((b) => b.text() === '移除')!;
    await rm.trigger('click');
    await flushPromises();
    const saveBtn = w.findAll('button').find((b) => b.text() === '保存')!;
    await saveBtn.trigger('click');
    await flushPromises();
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    const body = JSON.parse(String((post[1] as RequestInit).body));
    expect(body.remove).toEqual(['corp']);
  });
});
