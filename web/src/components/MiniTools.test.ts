// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import MiniTools from './MiniTools.vue';
import CodeEditor from './CodeEditor.vue';
import PostmanTool from '../tools/postman/PostmanTool.vue';
import { pendingTool, clearPendingTool, pendingToolTab, clearPendingToolTab } from '../uiIntents';

const writeText = vi.fn(async () => {});
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });

afterEach(() => { vi.unstubAllGlobals(); writeText.mockClear(); clearPendingTool(); clearPendingToolTab(); });

function mount() {
  return mountC(MiniTools, { global: { plugins: [ElementPlus], stubs: { teleport: true } } });
}

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }

function setIn(w: any, text: string) { w.findAllComponents(CodeEditor)[0].vm.$emit('update:modelValue', text); }
function inVal(w: any) { return w.findAllComponents(CodeEditor)[0].props('modelValue'); }
function outVal(w: any) { return w.findAllComponents(CodeEditor)[1].props('modelValue'); }

describe('MiniTools', () => {
  it('渲染 5 个工具；点击翻译打开全屏面板、点 × 关闭', async () => {
    const w = mount();
    const btns = w.findAll('.mticon');
    expect(btns).toHaveLength(5);
    expect(w.find('.ttbody').exists()).toBe(false);
    await btns[3].trigger('click');   // 翻译（catalog 顺序：记事本/Postman/Navicat/翻译/YAML）
    await flushPromises();
    expect(w.find('.ttbody').exists()).toBe(true);
    expect(w.find('.el-dialog').classes()).toContain('is-fullscreen');
    await w.find('.el-dialog__headerbtn').trigger('click');
    await flushPromises();
    expect((w.find('.el-overlay').element as HTMLElement).style.display).toBe('none');
  });

  it('记事本 / YAML 磁贴改为请求主区工具页签（不开弹窗）', async () => {
    const w = mount();
    await w.findAll('.mticon')[0].trigger('click');   // 记事本
    expect(pendingToolTab.value).toBe('notepad');
    expect(w.find('.ttbody').exists()).toBe(false);
    clearPendingToolTab();
    await w.findAll('.mticon')[4].trigger('click');   // YAML
    expect(pendingToolTab.value).toBe('yaml');
    expect(w.find('.ttbody').exists()).toBe(false);
  });

  it('翻译：空输入提示；成功后写入输出', async () => {
    const w = mount();
    await w.findAll('.mticon')[3].trigger('click');
    await w.find('.mtbtn.primary').trigger('click');
    expect(w.find('.mtmsg').text()).toBeTruthy();

    vi.stubGlobal('fetch', vi.fn(async () => okJson({ text: 'hello' })));
    setIn(w, '你好');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(outVal(w)).toBe('hello');
  });

  it('翻译失败显示错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(400, { message: 'bad input' })));
    const w = mount();
    await w.findAll('.mticon')[3].trigger('click');
    setIn(w, 'x');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(w.find('.mtmsg').text()).toContain('bad input');
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
    pendingTool.value = 'translate';
    const w = mount();
    await flushPromises();
    expect(w.find('.ttbody').exists()).toBe(true);
  });

  it('pendingTool 置为记事本时改为请求工具页签', async () => {
    pendingTool.value = 'notepad';
    const w = mount();
    await flushPromises();
    expect(pendingToolTab.value).toBe('notepad');
    expect(w.find('.ttbody').exists()).toBe(false);
  });

  it('工具操作按钮 Teleport 到弹窗标题行右侧', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
    // 不 stub teleport：验证按钮真的被挂到 #mtdlg-actions 里
    const w = mountC(MiniTools, { global: { plugins: [ElementPlus] } });
    await w.findAll('.mticon')[1].trigger('click');   // Postman
    await flushPromises();
    const actions = document.querySelector('#mtdlg-actions');
    expect(actions?.querySelector('.pmactsbar')).toBeTruthy();
    expect(document.querySelector('.pmmain .pmactsbar')).toBeNull();
    w.unmount();
  });

  it('翻译：复制输出 / 输出转输入 / 清空', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ text: 'hello' })));
    const w = mount();
    await w.findAll('.mticon')[3].trigger('click');   // 翻译
    setIn(w, '你好');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    const out = outVal(w);
    expect(out).toBe('hello');

    const mini = () => w.findAll('.mtmini');
    await mini()[0].trigger('click');   // copy
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(out);

    await mini()[1].trigger('click');   // to input
    expect(inVal(w)).toBe(out);
    expect(outVal(w)).toBe('');

    await mini()[2].trigger('click');   // clear
    expect(inVal(w)).toBe('');
  });
});
