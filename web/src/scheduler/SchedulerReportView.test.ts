// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import SchedulerReportView from './SchedulerReportView.vue';

const task = { id: 't1', name: 'scan', enabled: true, type: 'shell', schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } } } as any;
const runs = [
  { id: 'r1', taskId: 't1', status: 'success', trigger: 'manual', startedAt: 1, durationMs: 5, logFile: 'a', reportFile: 'x', reportCount: 2 },
  { id: 'r2', taskId: 't1', status: 'failed', trigger: 'schedule', startedAt: 2, durationMs: 7, logFile: 'b', reportFile: 'y', reportCount: 1 },
];

function mountView(over = {}) {
  return mountC(SchedulerReportView, {
    props: {
      task,
      loadRuns: vi.fn(async () => runs),
      loadReport: vi.fn(async (id: string) => (id === 'r1' ? '# 报告一' : '# 报告二')),
      loadLog: vi.fn(async () => 'raw log'),
      onBack: vi.fn(),
      openReportDir: vi.fn(),
      ...over,
    },
  });
}

describe('SchedulerReportView', () => {
  it('加载历史报告并默认渲染第一条 Markdown', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.findAll('.report-item').length).toBe(2);
    expect(w.find('.md-body').html()).toContain('<h1>报告一</h1>');
  });

  it('切换运行与原始日志', async () => {
    const w = mountView();
    await flushPromises();
    await w.findAll('.report-item')[1].trigger('click');
    await flushPromises();
    expect(w.find('.md-body').html()).toContain('<h1>报告二</h1>');
    await w.find('.raw-tab').trigger('click');
    await flushPromises();
    expect(w.find('.raw-log').text()).toBe('raw log');
  });

  it('空历史显示空状态', async () => {
    const w = mountView({ loadRuns: vi.fn(async () => []) });
    await flushPromises();
    expect(w.find('.rv-empty').exists()).toBe(true);
  });

  it('多个报告文件时显示提示，点击报告打开目录', async () => {
    const openReportDir = vi.fn(async () => {});
    const w = mountView({ openReportDir });
    await flushPromises();
    expect(w.find('.multi-hint').exists()).toBe(true);
    await w.find('.md-body').trigger('click');
    expect(openReportDir).toHaveBeenCalledWith('r1');
  });
});
