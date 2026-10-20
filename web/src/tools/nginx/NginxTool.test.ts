// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import NginxTool from './NginxTool.vue';
import { pendingToolTab, clearPendingToolTab } from '../../uiIntents';
import { usePostmanWorkbench } from '../postman/usePostmanWorkbench';

function okJson(body: unknown) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response); }

const RULE_A = {
  id: 'a', name: 'web', mode: 'port', enabled: true, listenHost: '127.0.0.1', listenPort: 8081,
  pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: 'a.local', port: 1111 },
  tlsInsecure: true, headers: [], rewrites: [], capture: false,
};
const RULE_B = {
  id: 'b', name: 'api', mode: 'path', enabled: true, listenHost: '0.0.0.0', listenPort: 0,
  pathPrefix: '/app', stripPrefix: true, target: { protocol: 'https', host: 'b.local', port: 2222 },
  tlsInsecure: false, headers: [{ name: 'X-B', value: '2' }], rewrites: [], capture: true,
};
const RULE_C = {
  id: 'c', name: 'deepseek-flash', mode: 'port', enabled: true, listenHost: '0.0.0.0', listenPort: 22224,
  pathPrefix: '', stripPrefix: true, target: { protocol: 'https', host: 'api.deepseek.com', port: 443 },
  tlsInsecure: false, headers: [], rewrites: [{ from: '/rest/v1', to: '/v1' }], capture: false,
};

afterEach(() => clearPendingToolTab());

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn((u: string) => {
    const s = String(u);
    if (s === '/api/nginx/rules') return okJson({ items: [RULE_A, RULE_B, RULE_C], status: { a: { status: 'running', error: null }, c: { status: 'running', error: null } } });
    if (s.startsWith('/api/nginx/log')) return okJson({ items: [] });
    if (s.startsWith('/api/nginx/captures')) return okJson({ items: [] });
    return okJson({});
  }));
});

describe('NginxTool', () => {
  it('进入时所有规则各自展开，表单互不填充', async () => {
    const w = mountC(NginxTool);
    await flushPromises();
    const cards = w.findAll('.ngcard');
    expect(cards).toHaveLength(3);
    expect(cards[0].find('.ngcard-body').exists()).toBe(true);
    expect(cards[1].find('.ngcard-body').exists()).toBe(true);
    expect(cards[2].find('.ngcard-body').exists()).toBe(true);
    expect(cards[2].classes()).toContain('sample');

    const hostA = cards[0].find('[data-field="target-host"]');
    const hostB = cards[1].find('[data-field="target-host"]');
    expect((hostA.element as HTMLInputElement).value).toBe('a.local');
    expect((hostB.element as HTMLInputElement).value).toBe('b.local');

    await hostA.setValue('changed.local');
    expect((hostA.element as HTMLInputElement).value).toBe('changed.local');
    expect((hostB.element as HTMLInputElement).value).toBe('b.local');
    w.unmount();
  });

  it('每条规则显示自己的访问地址', async () => {
    const w = mountC(NginxTool);
    await flushPromises();
    const cards = w.findAll('.ngcard');
    expect(cards[0].text()).toContain('http://127.0.0.1:8081/');
    expect(cards[1].text()).toContain('/app/');
    w.unmount();
  });

  it('样例提供 /rest/v1 测试 curl，点击跳到 Postman 并填入', async () => {
    const w = mountC(NginxTool);
    await flushPromises();
    const sample = w.findAll('.ngcard')[2];
    expect(sample.text()).toContain('/rest/v1/chat/completions');
    const btns = sample.findAll('.ngtest button');
    expect(btns).toHaveLength(2);

    await btns[0].trigger('click');
    expect(pendingToolTab.value).toBe('postman');
    const cmd = usePostmanWorkbench().curlCmd.value;
    expect(cmd).toContain('http://127.0.0.1:22224/rest/v1/chat/completions');
    expect(cmd).toContain('deepseek-chat');
    expect(cmd).not.toContain('stream');

    await btns[1].trigger('click');
    const streamCmd = usePostmanWorkbench().curlCmd.value;
    expect(streamCmd).toContain(' -N ');
    expect(streamCmd).toContain('stream');
    w.unmount();
  });
});
