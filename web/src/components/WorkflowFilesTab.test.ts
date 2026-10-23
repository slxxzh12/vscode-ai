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
      if (String(url).startsWith('/api/workflows-file')) return { ok: true, text: async () => '# 技能' } as any;
      return { ok: false, json: async () => ({}) } as any;
    }));
    const w = mountC(WorkflowFilesTab, { props: { workflowId: '100_A' } });
    await flushPromises();
    expect(w.findAll('.wf-row').length).toBe(3);
    await w.find('.wf-row.file').trigger('click');
    await flushPromises();
    expect(w.find('.md-body').html()).toContain('<h1>技能</h1>');
  });

  it('没有 workflowId 时显示空状态', async () => {
    const w = mountC(WorkflowFilesTab, { props: { workflowId: '' } });
    await flushPromises();
    expect(w.find('.wf-empty').exists()).toBe(true);
  });
});
