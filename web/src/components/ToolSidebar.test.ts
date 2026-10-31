// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import ToolSidebar from './ToolSidebar.vue';

afterEach(() => vi.unstubAllGlobals());
function okJson(body: unknown) { return { ok: true, json: async () => body }; }

describe('ToolSidebar', () => {
  it('渲染工具的固定目录树（读 /api/files/<tool>/tree）', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okJson({
      folders: [],
      items: [{ id: 'a.txt', folder: '', name: 'a.txt' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const w = mountC(ToolSidebar, { props: { tool: 'notepad' } });
    await flushPromises();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/files/notepad/tree'))).toBe(true);
    expect(w.find('.ftv').exists()).toBe(true);
    expect(w.text()).toContain('a.txt');
  });

  it('postman：渲染批量执行条与树', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u) === '/api/postman/history'
      ? okJson({ items: [], folders: [] })
      : okJson({}))));
    const w = mountC(ToolSidebar, { props: { tool: 'postman' } });
    await flushPromises();
    expect(w.find('.pmsb-run').exists()).toBe(true);
    expect(w.find('.ftv').exists()).toBe(true);
  });

  it('navicat：渲染新建连接条与树', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u) === '/api/navicat/profiles' ? okJson({ items: [] }) : okJson({}))));
    const w = mountC(ToolSidebar, { props: { tool: 'navicat' } });
    await flushPromises();
    expect(w.find('.nvsb-new').exists()).toBe(true);
    expect(w.find('.ftv').exists()).toBe(true);
  });
});
