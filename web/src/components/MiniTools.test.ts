// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import MiniTools from './MiniTools.vue';
import PostmanTool from '../tools/postman/PostmanTool.vue';
import NotepadTool from '../tools/notepad/NotepadTool.vue';
import { pendingTool, clearPendingTool } from '../uiIntents';

const writeText = vi.fn(async () => {});
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });

afterEach(() => { vi.unstubAllGlobals(); writeText.mockClear(); clearPendingTool(); });

function mount() {
  return mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
}

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }

describe('MiniTools', () => {
  it('渲染 6 个工具；点击打开全屏面板、点 × 关闭', async () => {
    const w = mount();
    const btns = w.findAll('.mticon');
    expect(btns).toHaveLength(6);
    expect(w.find('.ttbody').exists()).toBe(false);
    await btns[3].trigger('click');   // 翻译（catalog 顺序：记事本/Postman/Navicat/翻译/YAML/JS）
    await flushPromises();
    expect(w.find('.ttbody').exists()).toBe(true);
    expect(w.find('.el-dialog').classes()).toContain('is-fullscreen');
    await w.find('.el-dialog__headerbtn').trigger('click');
    await flushPromises();
    expect((w.find('.el-overlay').element as HTMLElement).style.display).toBe('none');
  });

  it('记事本：渲染 NotepadTool 子组件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
    const w = mount();
    await w.findAll('.mticon')[0].trigger('click');
    await flushPromises();
    expect(w.findComponent(NotepadTool).exists()).toBe(true);
    expect(w.find('.npbody').exists()).toBe(true);
  });

  it('YAML 校验/格式化与错误提示', async () => {
    const w = mount();
    await w.findAll('.mticon')[4].trigger('click');
    await w.findAll('textarea')[0].setValue('a: [1, ');
    await w.findAll('.mtbtn')[1].trigger('click');
    expect(w.find('.mtmsg').exists()).toBe(true);

    await w.findAll('textarea')[0].setValue('b: 2\na: 1');
    await w.findAll('.mtbtn')[2].trigger('click');
    expect(w.find('.mtmsg').text()).toBeTruthy();
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toContain('a: 1');
  });

  it('翻译：空输入提示；成功后写入输出', async () => {
    const w = mount();
    await w.findAll('.mticon')[3].trigger('click');
    await w.find('.mtbtn.primary').trigger('click');
    expect(w.find('.mtmsg').text()).toBeTruthy();

    vi.stubGlobal('fetch', vi.fn(async () => okJson({ text: 'hello' })));
    await w.findAll('textarea')[0].setValue('你好');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toBe('hello');
  });

  it('翻译失败显示错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(400, { message: 'bad input' })));
    const w = mount();
    await w.findAll('.mticon')[3].trigger('click');
    await w.findAll('textarea')[0].setValue('x');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(w.find('.mtmsg').text()).toContain('bad input');
  });

  it('JS 压缩走 /api/format', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return okJson({ content: 'const a=1;' }); }));
    const w = mount();
    await w.findAll('.mticon')[5].trigger('click');
    await w.findAll('textarea')[0].setValue('const a = 1;');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(urls).toContain('/api/format');
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toBe('const a=1;');
  });

  it('Postman：渲染 PostmanTool 子组件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
    const w = mount();
    await w.findAll('.mticon')[1].trigger('click');
    await flushPromises();
    expect(w.findComponent(PostmanTool).exists()).toBe(true);
    expect(w.find('.pmbody').exists()).toBe(true);
  });

  it('Navicat：渲染 NavicatTool 子组件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [] })));
    // teleport stub 会让 ElSelect 递归更新（happy-dom 下的已知问题），此用例只验证面板挂载，直接 stub 掉 ElSelect。
    const w = mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true, ElSelect: true } } });
    await w.findAll('.mticon')[2].trigger('click');
    await flushPromises();
    expect(w.find('.nvbody').exists()).toBe(true);
  });

  it('pendingTool 置值时自动打开对应工具', async () => {
    pendingTool.value = 'yaml';
    const w = mount();
    await flushPromises();
    expect(w.find('.ttbody').exists()).toBe(true);
  });

  it('复制输出 / 输出转输入 / 清空', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ content: 'a\nb' })));
    const w = mount();
    await w.findAll('.mticon')[5].trigger('click');   // JS 压缩
    await w.findAll('textarea')[0].setValue('b\na');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    const out = () => (w.findAll('textarea')[1].element as HTMLTextAreaElement).value;
    expect(out()).toBe('a\nb');

    const mini = () => w.findAll('.mtmini');
    await mini()[0].trigger('click');   // copy
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('a\nb');

    await mini()[1].trigger('click');   // to input
    expect((w.findAll('textarea')[0].element as HTMLTextAreaElement).value).toBe('a\nb');
    expect(out()).toBe('');

    await mini()[2].trigger('click');   // clear
    expect((w.findAll('textarea')[0].element as HTMLTextAreaElement).value).toBe('');
  });

});
