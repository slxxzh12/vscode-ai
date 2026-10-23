// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import JobsView from './JobsView.vue';

function ok(data: unknown) { return { ok: true, text: async () => JSON.stringify(data) } as any; }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/scheduler/jobs')) {
      return ok({ jobs: [{ jobId: 'j1', status: 0, partitionId: 0, createTime: 1, lastUpdateTime: 1, paramStr: '{"task":{"name":"scan"}}' }], summary: { queued: 1, running: 0, pending: 0, success: 0, failed: 0, total: 1 }, partitions: Array.from({ length: 16 }, (_, id) => ({ id, queued: id === 0 ? 1 : 0, running: 0, pending: 0 })), partitionCount: 16 });
    }
    if (url === '/api/scheduler/workers') return ok({ workers: [] });
    return ok({});
  }));
});

describe('JobsView', () => {
  it('渲染 16 个 partition 和排队统计', async () => {
    const w = mountC(JobsView);
    await flushPromises();
    expect(w.findAll('.partition-col').length).toBe(16);
    expect(w.find('.sum-queued .num').text()).toBe('1');
    expect(w.text()).toContain('scan');
  });
});
