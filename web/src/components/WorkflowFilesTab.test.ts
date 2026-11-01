// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import WorkflowFilesTab from './WorkflowFilesTab.vue';

const tree = [{
  name: '100_A', type: 'dir', path: '100_A', children: [{
    name: '100_G', type: 'dir', path: '100_A/100_G', children: [
      { name: '100_skill.md', type: 'file', path: '100_A/100_G/100_skill.md' },
    ],
  }],
}];

afterEach(() => vi.unstubAllGlobals());

describe('WorkflowFilesTab', () => {
  it('显示文件夹树并打开技能 Markdown', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/workflows-tree')) return { ok: true, json: async () => ({ tree }) } as any;
      if (String(url).startsWith('/api/workflows-file?')) return { ok: true, text: async () => '# 技能' } as any;
      return { ok: false, json: async () => ({}) } as any;
    }));
    const w = mountC(WorkflowFilesTab, { props: { workflowId: '100_A' } });
    await flushPromises();
    expect(w.findAll('.wf-row').length).toBe(3);
    await w.find('.wf-row.file').trigger('click');
    await flushPromises();
    expect(w.find('.md-body').html()).toContain('<h1>技能</h1>');
  });

  it('删除技能文件：确认后调用删除接口并刷新树', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).startsWith('/api/workflows-tree')) return { ok: true, json: async () => ({ tree }) } as any;
      if (String(url).startsWith('/api/workflows-file-delete')) return { ok: true, json: async () => ({ ok: true }) } as any;
      if (String(url).startsWith('/api/workflows-file?')) return { ok: true, text: async () => 'x' } as any;
      return { ok: false, json: async () => ({}) } as any;
    }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const w = mountC(WorkflowFilesTab, { props: { workflowId: '100_A' } });
    await flushPromises();
    await w.find('.wf-del').trigger('click');
    await flushPromises();
    expect(calls).toContain('/api/workflows-file-delete');
    expect(w.emitted('deleted')).toHaveLength(1);
    confirmSpy.mockRestore();
  });

  it('拖动技能文件到另一个阶段目录并调用移动接口', async () => {
    const tree3 = [{
      name: '100_A', type: 'dir', path: '100_A', children: [{
        name: '100_G', type: 'dir', path: '100_A/100_G', children: [
          { name: '100_S1', type: 'dir', path: '100_A/100_G/100_S1', children: [
            { name: '100_a.md', type: 'file', path: '100_A/100_G/100_S1/100_a.md' },
          ] },
          { name: '200_S2', type: 'dir', path: '100_A/100_G/200_S2', children: [] },
        ],
      }],
    }];
    const calls: Array<{ url: string; opt?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opt?: RequestInit) => {
      calls.push({ url: String(url), opt });
      if (String(url).startsWith('/api/workflows-tree')) return { ok: true, json: async () => ({ tree: tree3 }) } as any;
      if (String(url).startsWith('/api/workflows-file-move')) return { ok: true, json: async () => ({ ok: true }) } as any;
      return { ok: false, json: async () => ({}) } as any;
    }));
    const w = mountC(WorkflowFilesTab, { props: { workflowId: '100_A' } });
    await flushPromises();
    const rows = w.findAll('.wf-row');
    await w.find('.wf-row.file').trigger('dragstart');
    await rows[rows.length - 1].trigger('drop');
    await flushPromises();
    const call = calls.find((c) => c.url === '/api/workflows-file-move');
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call!.opt!.body))).toEqual({
      from: '100_A/100_G/100_S1/100_a.md',
      to: '100_A/100_G/200_S2/100_a.md',
      local: true,
    });
  });

  it('轮询自动刷新树与已打开文件内容', async () => {
    vi.useFakeTimers();
    let phase = 0;
    const tree2 = [{
      name: '100_A', type: 'dir', path: '100_A', children: [{
        name: '100_G', type: 'dir', path: '100_A/100_G', children: [
          { name: '100_skill.md', type: 'file', path: '100_A/100_G/100_skill.md' },
          { name: '200_new.md', type: 'file', path: '100_A/100_G/200_new.md' },
        ],
      }],
    }];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/workflows-tree')) {
        return { ok: true, json: async () => ({ tree: phase === 0 ? tree : tree2 }) } as any;
      }
      if (String(url).startsWith('/api/workflows-file?')) {
        return { ok: true, text: async () => (phase === 0 ? '# old' : '# new') } as any;
      }
      return { ok: false, json: async () => ({}) } as any;
    }));
    const w = mountC(WorkflowFilesTab, { props: { workflowId: '100_A' } });
    await flushPromises();
    expect(w.findAll('.wf-row').length).toBe(3);
    await w.find('.wf-row.file').trigger('click');
    await flushPromises();
    expect(w.find('.md-body').text()).toContain('old');
    phase = 1;
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    expect(w.findAll('.wf-row').length).toBe(4);
    expect(w.find('.md-body').text()).toContain('new');
    w.unmount();
    vi.useRealTimers();
  });

  it('没有 workflowId 时显示空状态', async () => {
    const w = mountC(WorkflowFilesTab, { props: { workflowId: '' } });
    await flushPromises();
    expect(w.find('.wf-empty').exists()).toBe(true);
  });
});
