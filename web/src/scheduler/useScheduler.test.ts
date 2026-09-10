import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useScheduler } from './useScheduler';

const calls: Array<{ url: string; method: string }> = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url === '/api/scheduler/tasks' && (init.method || 'GET') === 'GET') {
      return { ok: true, text: async () => JSON.stringify({ tasks: [{ id: 't1', name: 'a' }] }) } as any;
    }
    return { ok: true, text: async () => JSON.stringify({}) } as any;
  }));
});

describe('useScheduler', () => {
  it('refresh 拉取任务', async () => {
    const s = useScheduler();
    await s.refresh();
    expect(s.state.tasks.length).toBe(1);
    expect(s.state.tasks[0].id).toBe('t1');
  });

  it('createTask 后刷新', async () => {
    const s = useScheduler();
    await s.createTask({ name: 'a' });
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/scheduler/tasks')).toBe(true);
    expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(0);
  });

  it('订阅 WS 事件后自动 refresh', async () => {
    const handlers: Record<string, () => void> = {};
    const terminal = { on: (t: string, h: () => void) => { handlers[t] = h; return () => {}; } };
    const s = useScheduler(terminal);
    handlers['sched-run-end']?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.method === 'GET')).toBe(true);
  });
});
