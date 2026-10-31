// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import FilePreview from './FilePreview.vue';

afterEach(() => vi.unstubAllGlobals());

function okJson(body: unknown) { return { ok: true, json: async () => body }; }

describe('FilePreview（项目来源回归）', () => {
  it('加载文本文件：显示文件名与大小，走 /api/file', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okJson({ name: 'a.txt', path: 'a.txt', size: 5, content: 'hello' }));
    vi.stubGlobal('fetch', fetchMock);
    const w = mountC(FilePreview, { props: { projectId: 'p', path: 'a.txt', name: 'a.txt' } });
    await flushPromises();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/file?project=p&path=a.txt'))).toBe(true);
    expect(w.find('.meta').text()).toContain('a.txt');
    w.unmount();
  });

  it('Markdown 表格只渲染一个 Element Plus 表头', async () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (String(u).startsWith('/api/file?')) return okJson({ name: 'a.md', path: 'a.md', size: md.length, content: md });
      return okJson({});
    }));
    const w = mountC(FilePreview, { props: { projectId: 'p', path: 'a.md', name: 'a.md' } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    expect(w.findAll('.md-el-table').length).toBe(1);
    expect(w.findAll('.el-table').length).toBe(1);
    w.unmount();
  });

  it('加载失败显示错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })));
    const w = mountC(FilePreview, { props: { projectId: 'p', path: 'a.txt', name: 'a.txt' } });
    await flushPromises();
    expect(w.find('.note.err').exists()).toBe(true);
    w.unmount();
  });
});
