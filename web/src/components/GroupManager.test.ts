// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import { useCodeGroups } from '../codeGroups';
import GroupManager from './GroupManager.vue';

// codeGroups 是模块级单例，测试间需复位，避免相互污染。
beforeEach(() => {
  const g = useCodeGroups();
  g.groups.value = [];
  g.members.value = {};
});

function stubApi() {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, json: async () => JSON.parse(String(init.body)) };
    return { ok: true, json: async () => ({ groups: [], members: {} }) };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

async function mount(open = true) {
  const w = mountC(GroupManager, { props: { open }, global: { plugins: [ElementPlus], stubs: { teleport: true } } });
  await flushPromises();
  return w;
}

describe('GroupManager', () => {
  it('新增分组：成功后清空输入；重复或空白提示错误', async () => {
    stubApi();
    const w = await mount();
    await w.find('.ginput').setValue('A组');
    await w.find('.row .btn').trigger('click');
    await flushPromises();
    expect(w.findAll('.glist li')).toHaveLength(1);
    expect((w.find('.ginput').element as HTMLInputElement).value).toBe('');

    await w.find('.ginput').setValue('A组');
    await w.find('.row .btn').trigger('click');
    expect(w.find('.err').exists()).toBe(true);

    await w.find('.ginput').setValue('   ');
    await w.find('.row .btn').trigger('click');
    expect(w.find('.err').exists()).toBe(true);
  });

  it('删除分组后显示空态提示', async () => {
    stubApi();
    const w = await mount();
    await w.find('.ginput').setValue('X');
    await w.find('.row .btn').trigger('click');
    await flushPromises();
    expect(w.findAll('.glist li')).toHaveLength(1);
    await w.find('.glist li .rm').trigger('click');
    expect(w.findAll('.glist li')).toHaveLength(0);
    expect(w.find('.hint').exists()).toBe(true);
  });

  it('保存成功 emit close；失败显示错误', async () => {
    stubApi();
    const w = await mount();
    await w.find('.ginput').setValue('Y');
    await w.find('.row .btn').trigger('click');
    await w.find('.btn.primary').trigger('click');
    await flushPromises();
    expect(w.emitted('close')).toHaveLength(1);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })));
    const w2 = await mount();
    await w2.find('.btn.primary').trigger('click');
    await flushPromises();
    expect(w2.find('.err').exists()).toBe(true);
  });

  it('取消按钮 emit close', async () => {
    stubApi();
    const w = await mount();
    await w.find('.btn.ghost').trigger('click');
    expect(w.emitted('close')).toHaveLength(1);
  });
});
