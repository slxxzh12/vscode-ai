// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import SchedulerJobsView from './SchedulerJobsView.vue';

const tasks = [{ id: 't1', name: 'scan' }] as any;
const jobs = [{
  jobId: 'j1', taskId: 't1', status: 1, createTime: 1, runtime: 5,
  result: JSON.stringify({ reportMarkdown: '# 结果' }),
}] as any;

describe('SchedulerJobsView', () => {
  it('列出执行记录并展示报告', async () => {
    const w = mountC(SchedulerJobsView, {
      props: { tasks, loadJobs: vi.fn(async () => jobs), loadLog: vi.fn(async () => 'log') },
    });
    await flushPromises();
    expect(w.findAll('.job-item').length).toBe(1);
    expect(w.find('.md-body').html()).toContain('<h1>结果</h1>');
  });

  it('切换执行过程时加载日志', async () => {
    const loadLog = vi.fn(async () => 'run log');
    const w = mountC(SchedulerJobsView, { props: { tasks, loadJobs: vi.fn(async () => jobs), loadLog } });
    await flushPromises();
    await w.findAll('.jv-tabs button')[1].trigger('click');
    await flushPromises();
    expect(loadLog).toHaveBeenCalledWith('j1');
    expect(w.find('.jv-log').text()).toBe('run log');
  });
});
