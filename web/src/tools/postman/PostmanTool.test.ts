// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import PostmanTool from './PostmanTool.vue';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const REC = (id: string, command: string) => ({ id, command, folder: '', result: {}, updatedAt: '2026-09-01T00:00:00.000Z' });

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('PostmanTool', () => {
  it('执行 curl 显示输出并提示退出码', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/postman/history'
      ? okJson({ items: [], folders: [] })
      : okJson({ ok: true, code: 0, stdout: 'hi', stderr: '', timedOut: false }))));
    const w = mountC(PostmanTool);
    await flushPromises();
    await w.find('.pmcurl').setValue('curl -s https://a.com');
    await w.find('.pmrun').trigger('click');
    await flushPromises();
    expect((w.find('.pmout').element as HTMLTextAreaElement).value).toBe('hi');
    expect(w.find('.pmmsg').exists()).toBe(true);
  });

  it('点击记录载入命令', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [REC('a.json', 'curl old')], folders: [] })));
    const w = mountC(PostmanTool);
    await flushPromises();
    await w.find('.pmrow.record .pmname').trigger('click');
    expect((w.find('.pmcurl').element as HTMLTextAreaElement).value).toBe('curl old');
  });
});
