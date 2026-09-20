// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import MiniTools from './MiniTools.vue';
import PostmanTool from '../tools/postman/PostmanTool.vue';

const writeText = vi.fn(async () => {});
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });

afterEach(() => { vi.unstubAllGlobals(); writeText.mockClear(); });

function mount() {
  return mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
}

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }

describe('MiniTools', () => {
  it('渲染 5 个工具；点击打开全屏面板、点 × 关闭', async () => {
    const w = mount();
    const btns = w.findAll('.mticon');
    expect(btns).toHaveLength(5);
    expect(w.find('.mtbody').exists()).toBe(false);
    await btns[0].trigger('click');
    await flushPromises();
    expect(w.find('.mtbody').exists()).toBe(true);
    expect(w.find('.el-dialog').classes()).toContain('is-fullscreen');
    await w.find('.el-dialog__headerbtn').trigger('click');
    await flushPromises();
    expect((w.find('.el-overlay').element as HTMLElement).style.display).toBe('none');
  });

  it('排序/去重为纯前端计算', async () => {
    const w = mount();
    await w.findAll('.mticon')[3].trigger('click');
    const input = w.findAll('textarea')[0];
    await input.setValue('b\na\nc');
    const btns = w.findAll('.mtbtn');
    expect(btns).toHaveLength(5);
    await btns[0].trigger('click');   // asc
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toBe('a\nb\nc');
    await input.setValue('a\nb\na');
    await btns[4].trigger('click');   // 去重
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toBe('a\nb');
  });

  it('YAML 校验/格式化与错误提示', async () => {
    const w = mount();
    await w.findAll('.mticon')[1].trigger('click');
    await w.findAll('textarea')[0].setValue('a: [1, ');
    await w.findAll('.mtbtn')[0].trigger('click');
    expect(w.find('.mtmsg').exists()).toBe(true);

    await w.findAll('textarea')[0].setValue('b: 2\na: 1');
    await w.findAll('.mtbtn')[1].trigger('click');
    expect(w.find('.mtmsg').text()).toBeTruthy();
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toContain('a: 1');
  });

  it('翻译：空输入提示；成功后写入输出', async () => {
    const w = mount();
    await w.findAll('.mticon')[0].trigger('click');
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
    await w.findAll('.mticon')[0].trigger('click');
    await w.findAll('textarea')[0].setValue('x');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(w.find('.mtmsg').text()).toContain('bad input');
  });

  it('JS 压缩走 /api/format', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return okJson({ content: 'const a=1;' }); }));
    const w = mount();
    await w.findAll('.mticon')[2].trigger('click');
    await w.findAll('textarea')[0].setValue('const a = 1;');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(urls[0]).toBe('/api/format');
    expect((w.findAll('textarea')[1].element as HTMLTextAreaElement).value).toBe('const a=1;');
  });

  it('Postman：渲染 PostmanTool 子组件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
    const w = mount();
    await w.findAll('.mticon')[4].trigger('click');
    await flushPromises();
    expect(w.findComponent(PostmanTool).exists()).toBe(true);
    expect(w.find('.pmbody').exists()).toBe(true);
  });

  it('复制输出 / 输出转输入 / 清空', async () => {
    const w = mount();
    await w.findAll('.mticon')[3].trigger('click');
    await w.findAll('textarea')[0].setValue('b\na');
    await w.findAll('.mtbtn')[0].trigger('click');   // asc
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
