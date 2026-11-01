// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import WorkflowEditor from './WorkflowEditor.vue';

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
afterEach(() => vi.unstubAllGlobals());

describe('WorkflowEditor', () => {
  it('点击遮罩/空白处不关闭，只有右上角 × 才关闭', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ workflows: [] })));
    const w = mountC(WorkflowEditor);
    await flushPromises();
    await w.find('.weoverlay').trigger('click');
    expect(w.emitted('close')).toBeFalsy();
    await w.find('.wex').trigger('click');
    expect(w.emitted('close')).toBeTruthy();
  });

  it('点击「打开提示词目录」调用 reveal 根目录', async () => {
    const calls: Array<{ url: string; opt?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opt?: RequestInit) => {
      calls.push({ url: String(url), opt });
      return okJson({ workflows: [] });
    }));
    const w = mountC(WorkflowEditor);
    await flushPromises();
    await w.find('.weopen').trigger('click');
    await flushPromises();
    const call = calls.find((c) => c.url === '/api/workflows-reveal');
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call!.opt!.body))).toEqual({ path: '', local: true });
  });

  it('点击「从文件刷新」重新加载工作流列表', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return okJson({ workflows: [] });
    }));
    const w = mountC(WorkflowEditor);
    await flushPromises();
    const before = calls.filter((u) => u === '/api/workflows-xml?local=1').length;
    await w.find('.wrefresh').trigger('click');
    await flushPromises();
    expect(calls.filter((u) => u === '/api/workflows-xml?local=1').length).toBe(before + 1);
  });

  it('轮询自动刷新工作流列表', async () => {
    vi.useFakeTimers();
    let phase = 0;
    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      workflows: phase === 0 ? [] : [{ id: '100_开发交付', label: '开发交付', stages: [] }],
    })));
    const w = mountC(WorkflowEditor);
    await flushPromises();
    expect(w.findAll('.wnitem').length).toBe(0);
    phase = 1;
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    expect(w.findAll('.wnitem').length).toBe(1);
    w.unmount();
    vi.useRealTimers();
  });
});
