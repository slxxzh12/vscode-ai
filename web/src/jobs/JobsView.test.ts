// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import JobsView from './JobsView.vue';

function ok(data: unknown) { return { ok: true, text: async () => JSON.stringify(data) } as any; }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/scheduler/jobs')) {
      return ok({ jobs: [
        { jobId: 'old', status: 0, partitionId: 0, createTime: 1, lastUpdateTime: 1, paramStr: '{"task":{"name":"scan"}}' },
        { jobId: 'new', status: 1, partitionId: 3, createTime: 100, lastUpdateTime: 100, paramStr: '{"task":{"name":"report"}}' },
      ], summary: { queued: 1, running: 0, pending: 0, success: 1, failed: 0, total: 2 }, partitions: Array.from({ length: 16 }, (_, id) => ({ id, queued: id === 0 ? 1 : 0, running: 0, pending: 0 })), partitionCount: 16 });
    }
    if (url === '/api/scheduler/workers') return ok({ workers: [] });
    return ok({});
  }));
});

describe('JobsView', () => {
  it('平铺渲染作业并按时间倒序', async () => {
    const w = mountC(JobsView);
    await flushPromises();
    expect(w.findAll('.partition-col').length).toBe(0);
    const rows = w.findAll('.job-row');
    expect(rows.length).toBe(2);
    expect(rows[0].text()).toContain('report');
    expect(rows[1].text()).toContain('scan');
    expect(w.find('.sum-queued .num').text()).toBe('1');
  });
});
