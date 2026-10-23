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

  it('类型只有普通命令和 AI 命令，普通命令提示会交给 AI', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/scheduler/tasks') return ok({ tasks: [] });
      if (url === '/api/scheduler/summary') return ok({ total: 0, success: 0, failed: 0, running: 0, queued: 0, pending: 0 });
      return ok({});
    }));
    const w = mountC(SchedulerView, { props: { terminal: { on: () => () => {} } } });
    await flushPromises();
    await w.find('.blank button').trigger('click');
    await flushPromises();
    const typeSelect = w.find('.modal').findAll('select')[0];
    const values = typeSelect.findAll('option').map((o) => o.attributes('value'));
    expect(values).toEqual(['shell', 'ai']);
    await typeSelect.setValue('shell');
    expect(w.find('.shell-hint').exists()).toBe(true);
  });

  it('新增任务入口打开聊天页，发送提示词创建 AI 任务并执行', async () => {
    const calls: Array<{ url: string; method: string; body?: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
      const method = init.method || 'GET';
      calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
      if (url === '/api/scheduler/tasks' && method === 'GET') return ok({ tasks: [] });
      if (url === '/api/scheduler/tasks' && method === 'POST') {
        return ok({ task: { id: 't1', name: 'x', type: 'ai', ai: { source: 'prompt', prompt: 'hello' }, schedule: { mode: 'interval', interval: { every: 1, unit: 'day' } } } });
      }
      if (url === '/api/scheduler/tasks/t1/run') return ok({ job: { jobId: 'j1', status: 0 } });
      if (String(url).startsWith('/api/scheduler/jobs?')) return ok({ jobs: [{ jobId: 'j1', status: 3, result: null }] });
      if (String(url).endsWith('/log')) return { ok: true, text: async () => 'running log' } as any;
      if (url === '/api/scheduler/summary') return ok({ total: 0, success: 0, failed: 0, running: 0, queued: 0, pending: 0 });
      return ok({});
    }));
    const w = mountC(SchedulerView, { props: { terminal: { on: () => () => {} } } });
    await flushPromises();
    await w.find('.new-task-entry').trigger('click');
    expect(w.find('.chat-overlay').exists()).toBe(true);
    await w.find('.chat-input textarea').setValue('hello');
    await w.find('.chat-input button').trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.url === '/api/scheduler/tasks' && c.method === 'POST' && c.body.type === 'ai')).toBe(true);
    expect(calls.some((c) => c.url === '/api/scheduler/tasks/t1/run' && c.method === 'POST')).toBe(true);
    expect(w.find('.chat-msg.user .bubble').text()).toBe('hello');
    await w.find('.chat-back').trigger('click');
    expect(w.find('.chat-overlay').exists()).toBe(false);
    w.unmount();
  });

  it('可在定时任务与任务队列两个页签之间切换', async () => {
    const w = mountC(SchedulerView, { props: { terminal: { on: () => () => {} } } });
    await flushPromises();
    expect(w.find('.body').exists()).toBe(true);
    await w.findAll('.main-tabs button')[1].trigger('click');
    await flushPromises();
    expect(w.find('.jobs-view').exists()).toBe(true);
    await w.findAll('.main-tabs button')[0].trigger('click');
    expect(w.find('.body').exists()).toBe(true);
  });
});
