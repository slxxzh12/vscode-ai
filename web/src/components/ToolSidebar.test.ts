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
});
