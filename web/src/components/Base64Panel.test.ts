// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import Base64Panel from './Base64Panel.vue';
import CodeEditor from './CodeEditor.vue';

describe('Base64Panel', () => {
  it('挂载即显示 getText 的编码结果，refresh 跟随更新', async () => {
    let src = 'hello';
    const w = mountC(Base64Panel, { props: { getText: () => src } });
    await flushPromises();
    expect(w.findAll('.b64pre')[0].text()).toBe('aGVsbG8=');
    src = 'hi';
    (w.vm as any).refresh();
    await flushPromises();
    expect(w.findAll('.b64pre')[0].text()).toBe('aGk=');
  });

  it('解码框输入合法 base64 出结果，非法出错误', async () => {
    const w = mountC(Base64Panel, { props: { getText: () => 'x' } });
    await flushPromises();
    const ed = w.findComponent(CodeEditor);
    ed.vm.$emit('update:modelValue', 'aGVsbG8=');
    await flushPromises();
    expect(w.findAll('.b64pre')[1].text()).toBe('hello');

    ed.vm.$emit('update:modelValue', '!!!not-base64!!!');
    await flushPromises();
    expect(w.find('.b64err').exists()).toBe(true);
  });

  it('编码结果→解码 按钮把编码写入解码框', async () => {
    const w = mountC(Base64Panel, { props: { getText: () => 'hello' } });
    await flushPromises();
    await w.findAll('.b64b')[1].trigger('click');
    await flushPromises();
    expect(w.findAll('.b64pre')[1].text()).toBe('hello');
  });
});
