// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import SchedulerView from './SchedulerView.vue';

function ok(data: unknown) { return { ok: true, text: async () => JSON.stringify(data) } as any; }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/scheduler/tasks') return ok({ tasks: [{ id: 't1', name: 'scan', enabled: true, type: 'shell', schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } } }] });
    if (url === '/api/scheduler/summary') return ok({ total: 5, success: 2, failed: 1, running: 0, queued: 1, pending: 1 });
    if (String(url).startsWith('/api/scheduler/jobs?')) return ok({ jobs: [] });
    return ok({});
  }));
});

describe('SchedulerView', () => {
  it('顶部显示总成功/总失败，点任务进入详情', async () => {
    const w = mountC(SchedulerView, { props: { terminal: { on: () => () => {} } } });
    await flushPromises();
    expect(w.find('.sum-success .num').text()).toBe('2');
    expect(w.find('.sum-failed .num').text()).toBe('1');
    await w.find('.row').trigger('click');
    await flushPromises();
    expect(w.find('.report-view').exists()).toBe(true);
  });

  it('没有任务时显示空白提示，可直接新建', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/scheduler/tasks') return ok({ tasks: [] });
      if (url === '/api/scheduler/summary') return ok({ total: 0, success: 0, failed: 0, running: 0, queued: 0, pending: 0 });
      return ok({});
    }));
    const w = mountC(SchedulerView, { props: { terminal: { on: () => () => {} } } });
    await flushPromises();
    expect(w.find('.blank').exists()).toBe(true);
    expect(w.find('.blank-title').exists()).toBe(true);
    expect(w.find('.blank-hint').exists()).toBe(true);
    await w.find('.blank button').trigger('click');
    await flushPromises();
    expect(w.find('.modal').exists()).toBe(true);
  });

  it('脚本任务勾选 EXE 后显示进度文件、报告目录和命令行', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/scheduler/tasks') return ok({ tasks: [] });
      if (url === '/api/scheduler/summary') return ok({ total: 0, success: 0, failed: 0, running: 0, queued: 0, pending: 0 });
      return ok({});
    }));
    const w = mountC(SchedulerView, { props: { terminal: { on: () => () => {} } } });
    await flushPromises();
    await w.find('.blank button').trigger('click');
    await flushPromises();
    await w.findAll('select')[0].setValue('script');
    await w.find('.exe-check').setValue(true);
    expect(w.find('.cmdpreview').text()).toContain('result.json');
    expect(w.find('.cmdpreview').text()).toContain('/report');
  });
});
