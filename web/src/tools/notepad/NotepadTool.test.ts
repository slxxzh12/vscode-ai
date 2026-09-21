// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import NotepadTool from './NotepadTool.vue';
import CodeEditor from '../../components/CodeEditor.vue';
import Base64Panel from '../../components/Base64Panel.vue';
import { encodeB64 } from '../../base64';

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

function stubFiles(name: string, content: string, extra?: (u: string) => unknown) {
  return vi.fn(async (u: string) => {
    if (u.startsWith('/api/files/notepad/tree')) return okJson({ items: [{ id: name, folder: '', name }], folders: [] });
    if (u.startsWith('/api/files/notepad/file?id=')) return okJson({ content });
    const r = extra?.(u);
    if (r) return r;
    return okJson({ ok: true });
  });
}

async function openFirstFile(w: ReturnType<typeof mountC>) {
  await w.find('.ftrow.item .ftname').trigger('click');
  await flushPromises();
}

describe('NotepadTool', () => {
  it('打开文件载入内容，排序按钮就地变换', async () => {
    vi.stubGlobal('fetch', stubFiles('a.txt', 'b\na'));
    const w = mountC(NotepadTool);
    await flushPromises();
    await openFirstFile(w);
    expect(w.findComponent(CodeEditor).props('modelValue')).toBe('b\na');
    await w.findAll('.npbtn')[1].trigger('click');   // 升序
    expect(w.findComponent(CodeEditor).props('modelValue')).toBe('a\nb');
  });

  it('json 文件：压缩可用并压成一行', async () => {
    vi.stubGlobal('fetch', stubFiles('a.json', '{ "a": 1,  "b": [1, 2] }',
      (u) => (u === '/api/format' ? okJson({ content: '{"a":1,"b":[1,2]}' }) : undefined)));
    const w = mountC(NotepadTool);
    await flushPromises();
    await openFirstFile(w);
    const btns = w.findAll('.npbtn');
    expect(btns[7].attributes('disabled')).toBeUndefined();   // 压缩
    await btns[7].trigger('click');
    await flushPromises();
    expect(w.findComponent(CodeEditor).props('modelValue')).toBe('{"a":1,"b":[1,2]}');
  });

  it('txt 文件：压缩与格式化均禁用', async () => {
    vi.stubGlobal('fetch', stubFiles('a.txt', 'x'));
    const w = mountC(NotepadTool);
    await flushPromises();
    await openFirstFile(w);
    const btns = w.findAll('.npbtn');
    expect(btns[7].attributes('disabled')).toBeDefined();
    expect(btns[8].attributes('disabled')).toBeDefined();
  });

  it('Base64 按钮切换面板并实时编码', async () => {
    vi.stubGlobal('fetch', stubFiles('a.txt', 'hello'));
    const w = mountC(NotepadTool);
    await flushPromises();
    await openFirstFile(w);
    expect(w.findComponent(Base64Panel).exists()).toBe(false);
    await w.findAll('.npbtn')[6].trigger('click');
    await flushPromises();
    expect(w.findComponent(Base64Panel).exists()).toBe(true);
    expect(w.find('.b64pre').text()).toBe(encodeB64('hello'));
  });
});
