// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import HistoryList from '../components/HistoryList.vue';
import { __resetPromptCollect } from './usePromptCollect';

describe('HistoryList prompt collect click', () => {
  beforeEach(() => __resetPromptCollect());
  afterEach(() => vi.unstubAllGlobals());

  it('clicks the + and POSTs the prompt to /api/workflows', async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      const method = (init && init.method) || 'GET';
      const body = init && init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url: String(url), method, body });
      if (method === 'GET') return { ok: true, json: async () => ({ workflows: [] }) };
      return { ok: true, json: async () => ({ workflows: body.workflows }) };
    }));

    const w = mountC(HistoryList, {
      props: { items: [], tab: 'messages', messages: [{ text: 'collect me', ts: 1, tabName: 't' }] },
      global: { plugins: [ElementPlus] },
    });
    await w.vm.$nextTick();
    const add = w.find('.mrow .pcadd');
    expect(add.exists()).toBe(true);
    await add.trigger('click');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.map((c) => c.method)).toContain('POST');
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body.workflows[0].stages[0].prompts).toContain('collect me');
  });
});
