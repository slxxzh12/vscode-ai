// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import SchedulerReportView from './SchedulerReportView.vue';

const task = { id: 't1', name: 'scan', enabled: true, type: 'shell', schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } } } as any;
const jobs = [
  { jobId: 'j1', status: 1, createTime: 1, runtime: 5, result: JSON.stringify({ reportMarkdown: '# 报告一' }) },
  { jobId: 'j2', status: 2, createTime: 2, runtime: 7, result: JSON.stringify({ reportMarkdown: '# 报告二' }) },
];

function mountView(over = {}) {
  return mountC(SchedulerReportView, {
    props: {
      task,
      loadJobs: vi.fn(async () => jobs),
      onBack: vi.fn(),
      ...over,
    },
  });
}

describe('SchedulerReportView', () => {
  it('加载历史作业并默认渲染第一条报告', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.findAll('.report-item').length).toBe(2);
    expect(w.find('.md-body').html()).toContain('<h1>报告一</h1>');
  });

  it('切换作业显示对应报告', async () => {
    const w = mountView();
    await flushPromises();
    await w.findAll('.report-item')[1].trigger('click');
    await flushPromises();
    expect(w.find('.md-body').html()).toContain('<h1>报告二</h1>');
  });

  it('空历史显示空状态', async () => {
    const w = mountView({ loadJobs: vi.fn(async () => []) });
    await flushPromises();
    expect(w.find('.rv-empty').exists()).toBe(true);
  });

  it('有 sessionId 时可打开会话', async () => {
    const onOpenSession = vi.fn();
    const w = mountView({
      loadJobs: vi.fn(async () => [{ jobId: 'j1', status: 1, createTime: 1, result: JSON.stringify({ sessionId: 's1', reportMarkdown: '# r' }) }]),
      onOpenSession,
    });
    await flushPromises();
    await w.find('.rv-session').trigger('click');
    expect(onOpenSession).toHaveBeenCalledWith('s1');
  });

  it('点击 AI 任务按 sha256 选中并展示原始提示词与版本', async () => {
    const aiTask = {
      ...task,
      type: 'ai',
      ai: { source: 'prompt', prompt: 'new prompt' },
      promptHash: 'h2',
    } as any;
    const loadPrompts = vi.fn(async () => ({
      prompts: [
        { id: 2, taskId: 't1', prompt: 'new prompt', hash: 'h2', employeeId: 'E2', createIP: '10.0.0.2', createdAt: 200 },
        { id: 1, taskId: 't1', prompt: 'old prompt', hash: 'h1', employeeId: 'E1', createIP: '10.0.0.1', createdAt: 100 },
      ],
      activeId: 2,
    }));
    const w = mountView({ task: aiTask, loadPrompts });
    await flushPromises();
    expect(loadPrompts).toHaveBeenCalledWith('t1', 'h2');
    expect(w.find('.prompt-text').text()).toBe('new prompt');
    expect(w.find('.prompt-hash').text()).toContain('h2');
    expect(w.find('.prompt-meta').text()).toContain('E2');
    expect(w.findAll('.prompt-ver option').length).toBe(2);
  });
});
