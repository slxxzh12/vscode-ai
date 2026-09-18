// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import { t } from '../i18n';

vi.mock('../components/TerminalView.vue', () => ({
  default: {
    name: 'TerminalView',
    props: ['terminal', 'center', 'projectId', 'phone'],
    template: '<div class="tv-stub" />',
  },
}));

import PhoneView from './PhoneView.vue';

class FakeWS {
  readyState = 0;
  private listeners: Record<string, Array<(e: any) => void>> = {};
  constructor(public url: string) {}
  addEventListener(type: string, cb: (e: any) => void) { (this.listeners[type] ||= []).push(cb); }
  send() { /* noop */ }
  close() { /* noop */ }
}

type Call = { url: string; init?: RequestInit };

function stubFetch(state = { rev: 'r1' }) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit): Promise<any> => {
    calls.push({ url, init });
    if (url.startsWith('/api/remote-coder/state')) {
      return { ok: true, status: 200, json: async () => ({ rev: state.rev }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, rev: state.rev }) };
  });
  vi.stubGlobal('fetch', fetchFn);
  return { fetchFn, calls, state };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('PhoneView', () => {
  it('以 phone=true 渲染 TerminalView，且没有图片/文本框', async () => {
    stubFetch();
    vi.stubGlobal('WebSocket', FakeWS as any);
    const w = mountC(PhoneView);
    await flushPromises();
    const tv = w.findComponent({ name: 'TerminalView' });
    expect(tv.exists()).toBe(true);
    expect(tv.props('phone')).toBe(true);
    expect(w.find('img').exists()).toBe(false);
    expect(w.find('textarea').exists()).toBe(false);
  });

  it('点「截图」发截图命令并提示已更新', async () => {
    const s = stubFetch({ rev: 'r1' });
    vi.stubGlobal('WebSocket', FakeWS as any);
    const w = mountC(PhoneView);
    await flushPromises();
    s.state.rev = 'r2';                        // 桌面端截完图后的新版本
    await w.find('.shot').trigger('click');
    await flushPromises();
    const shotCall = s.calls.find((c) => c.url === '/api/remote-coder/message');
    expect(JSON.parse(String(shotCall?.init?.body))).toEqual({ kind: 'screenshot' });
    expect(w.find('.st').text()).toContain(t('remote.shot_done', { time: '' }).trim());
  });
});
