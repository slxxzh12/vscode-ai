// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import TextToolBody from './TextToolBody.vue';
import CodeEditor from '../../components/CodeEditor.vue';

const writeText = vi.fn(async () => {});
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });

afterEach(() => { vi.unstubAllGlobals(); writeText.mockClear(); });

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }

function setIn(w: any, text: string) { w.findAllComponents(CodeEditor)[0].vm.$emit('update:modelValue', text); }
function inVal(w: any) { return w.findAllComponents(CodeEditor)[0].props('modelValue'); }
function outVal(w: any) { return w.findAllComponents(CodeEditor)[1].props('modelValue'); }

describe('TextToolBody（翻译）', () => {
  it('空输入提示；成功后写入输出', async () => {
    const w = mountC(TextToolBody);
    await w.find('.mtbtn.primary').trigger('click');
    expect(w.find('.mtmsg').text()).toBeTruthy();

    vi.stubGlobal('fetch', vi.fn(async () => okJson({ text: 'hello' })));
    setIn(w, '你好');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(outVal(w)).toBe('hello');
  });

  it('失败显示错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(400, { message: 'bad input' })));
    const w = mountC(TextToolBody);
    setIn(w, 'x');
    await w.find('.mtbtn.primary').trigger('click');
    await flushPromises();
    expect(w.find('.mtmsg').text()).toContain('bad input');
  });

  it('复制输出 / 输出转输入 / 清空', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ text: 'hello' })));
    const w = mountC(TextToolBody);
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
