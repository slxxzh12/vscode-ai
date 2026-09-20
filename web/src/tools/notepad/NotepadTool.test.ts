// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import NotepadTool from './NotepadTool.vue';

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('NotepadTool', () => {
  it('打开文件载入内容，排序按钮就地变换', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.startsWith('/api/notepad/tree')) return okJson({ items: [{ id: 'a.txt', folder: '', name: 'a.txt' }], folders: [] });
      if (u.startsWith('/api/notepad/file?id=')) return okJson({ content: 'b\na' });
      return okJson({ ok: true });
    }));
    const w = mountC(NotepadTool);
    await flushPromises();
    await w.find('.ftrow.item .ftname').trigger('click');
    await flushPromises();
    expect((w.find('.nparea').element as HTMLTextAreaElement).value).toBe('b\na');
    await w.findAll('.npbtn')[1].trigger('click');   // 升序
    expect((w.find('.nparea').element as HTMLTextAreaElement).value).toBe('a\nb');
  });
});
