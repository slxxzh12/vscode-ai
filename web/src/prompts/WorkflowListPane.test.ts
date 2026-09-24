// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import { __resetPromptCollect } from './usePromptCollect';
import WorkflowListPane from './WorkflowListPane.vue';

const WFS = [
  { id: 'w1', label: 'W1', stages: [{ id: 's1', label: 'S1', prompts: ['a', 'b'] }] },
  { id: 'w2', label: 'W2', stages: [] },
];

function mockFetch(list: any[] = WFS) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    if (method === 'GET') return { ok: true, json: async () => ({ workflows: list }) };
    return { ok: true, json: async () => ({ workflows: (body && body.workflows) || [] }) };
  }));
}

describe('WorkflowListPane', () => {
  beforeEach(() => { __resetPromptCollect(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('渲染工作流/阶段/提示词层级', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    expect(w.findAll('.wcard')).toHaveLength(2);
    expect((w.find('.wlabel').element as HTMLInputElement).value).toBe('W1');
    expect(w.findAll('.slabel')).toHaveLength(1);
    expect(w.findAll('.ptext')).toHaveLength(2);
  });

  it('无工作流时显示空态', async () => {
    mockFetch([]);
    const w = mountC(WorkflowListPane);
    await flushPromises();
    expect(w.find('.empty').exists()).toBe(true);
  });

  it('顶部 + 新增工作流', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    await w.find('.wadd').trigger('click');
    await flushPromises();
    expect(w.findAll('.wcard')).toHaveLength(3);
  });

  it('工作流 − 触发删除（确认后）', async () => {
    mockFetch();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const w = mountC(WorkflowListPane);
    await flushPromises();
    await w.find('.wdel').trigger('click');
    await flushPromises();
    expect(w.findAll('.wcard')).toHaveLength(1);
  });

  it('工作流 − 取消确认则不删除', async () => {
    mockFetch();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const w = mountC(WorkflowListPane);
    await flushPromises();
    await w.find('.wdel').trigger('click');
    await flushPromises();
    expect(w.findAll('.wcard')).toHaveLength(2);
  });

  it('阶段 + 新增空提示词', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    await w.find('.sadd').trigger('click');
    await flushPromises();
    expect(w.findAll('.ptext')).toHaveLength(3);
  });

  it('提示词 − 删除一条', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    await w.find('.pdel').trigger('click');
    await flushPromises();
    expect(w.findAll('.ptext')).toHaveLength(1);
  });

  it('工作流名失焦触发 renameWorkflow', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    const input = w.find('.wlabel');
    await input.setValue('NewName');
    await input.trigger('change');
    await flushPromises();
    expect((w.find('.wlabel').element as HTMLInputElement).value).toBe('NewName');
  });

  it('提示词文本失焦触发 setPrompt', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    const ta = w.find('.ptext');
    await ta.setValue('edited');
    await ta.trigger('change');
    await flushPromises();
    expect((w.findAll('.ptext')[0].element as HTMLTextAreaElement).value).toBe('edited');
  });
});
