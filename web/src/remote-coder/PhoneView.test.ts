// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import { t } from '../i18n';
import PhoneView from './PhoneView.vue';

type Call = { url: string; init?: RequestInit };

function stubFetch(state = { rev: 'r1' }) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit): Promise<any> => {
    calls.push({ url, init });
    if (url.startsWith('/api/remote-coder/state')) {
      return { ok: true, status: 200, json: async () => ({ rev: state.rev }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, rev: state.rev, uploaded: true, reason: '' }) };
  });
  vi.stubGlobal('fetch', fetchFn);
  return { fetchFn, calls, state };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('PhoneView', () => {
  it('无图时显示占位，有 rev 时显示图片', async () => {
    stubFetch({ rev: '' });
    const w = mountC(PhoneView);
    await flushPromises();
    expect(w.find('.empty').text()).toBe(t('remote.no_screen'));
    expect(w.find('img').exists()).toBe(false);

    stubFetch({ rev: 'r9' });
    const w2 = mountC(PhoneView);
    await flushPromises();
    expect(w2.find('img').attributes('src')).toContain('v=r9');
  });

  it('点「截图」：发命令并等到新 rev 后换图', async () => {
    const s = stubFetch({ rev: 'r1' });
    const w = mountC(PhoneView);
    await flushPromises();
    expect(w.find('img').attributes('src')).toContain('v=r1');

    s.state.rev = 'r2';                        // 桌面端截完图后的新版本
    await w.find('.shot').trigger('click');
    await flushPromises();
    const shotCall = s.calls.find((c) => c.url === '/api/remote-coder/message');
    expect(JSON.parse(String(shotCall?.init?.body))).toEqual({ kind: 'screenshot' });
    expect(w.find('img').attributes('src')).toContain('v=r2');
    expect(w.find('.st').text()).toContain(t('remote.shot_done', { time: '' }).trim());
  });

  it('发送消息成功：清空输入并提示；失败提示原因', async () => {
    const s = stubFetch({ rev: 'r1' });
    const w = mountC(PhoneView);
    await flushPromises();
    await w.find('.inp').setValue('继续');
    await w.find('.send').trigger('click');
    await flushPromises();
    const call = s.calls.find((c) => c.url === '/api/remote-coder/message');
    expect(JSON.parse(String(call?.init?.body))).toEqual({ kind: 'message', text: '继续' });
    expect((w.find('.inp').element as HTMLTextAreaElement).value).toBe('');
    expect(w.find('.st').text()).toBe(t('remote.sent'));

    s.fetchFn.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({ message: 'bad' }) }));
    await w.find('.inp').setValue('x');
    await w.find('.send').trigger('click');
    await flushPromises();
    expect(w.find('.st').text()).toBe(t('remote.send_failed', { msg: 'bad' }));
  });
});
