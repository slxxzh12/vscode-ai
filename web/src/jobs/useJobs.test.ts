import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useJobs } from './useJobs';

const calls: Array<{ url: string; method: string }> = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url.startsWith('/api/scheduler/jobs?') || url === '/api/scheduler/jobs') {
      return { ok: true, text: async () => JSON.stringify({ jobs: [{ jobId: 'j1', status: 0 }], summary: { queued: 1 }, partitions: [{ id: 0, queued: 1 }], partitionCount: 16 }) } as any;
    }
    return { ok: true, text: async () => JSON.stringify({ ok: true }) } as any;
  }));
});

describe('useJobs', () => {
  it('refresh 拉取作业与统计', async () => {
    const j = useJobs();
    await j.refresh();
    expect(j.state.jobs.length).toBe(1);
    expect(j.state.summary.queued).toBe(1);
    expect(j.state.partitions[0].id).toBe(0);
  });
  it('动作走后端', async () => {
    const j = useJobs();
    await j.approve('j1');
    await j.reject('j1');
    await j.cancel('j1');
    await j.retry('j1');
    expect(calls.map((c) => c.url)).toContain('/api/scheduler/jobs/j1/approve');
    expect(calls.map((c) => c.url)).toContain('/api/scheduler/jobs/j1/retry');
  });
  it('按 partition 过滤', async () => {
    const j = useJobs();
    j.state.partition = 3;
    await j.refresh();
    expect(calls.some((c) => c.url.includes('partition=3'))).toBe(true);
  });
});
