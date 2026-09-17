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
    const handlers: Record<string, (msg: any) => void> = {};
    const terminal = { on: (t: string, h: (msg: any) => void) => { handlers[t] = h; return () => {}; } };
    const s = useScheduler(terminal);
    handlers['sched-run-end']?.({});
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.method === 'GET')).toBe(true);
  });

  it('updateTask/removeTask 走 PUT/DELETE（id 编码）并刷新', async () => {
    const s = useScheduler();
    await s.updateTask('t/1', { name: 'b' });
    await s.removeTask('t/1');
    expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/scheduler/tasks/t%2F1')).toBe(true);
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/scheduler/tasks/t%2F1')).toBe(true);
  });

  it('runNow/stopTask 打到 run/stop', async () => {
    const s = useScheduler();
    await s.runNow('t1');
    await s.stopTask('t1');
    expect(calls.map((c) => c.url)).toContain('/api/scheduler/tasks/t1/run');
    expect(calls.map((c) => c.url)).toContain('/api/scheduler/tasks/t1/stop');
  });

  it('loadRuns/loadLog/pickFile 走对应路由', async () => {
    const s = useScheduler();
    expect(await s.loadRuns('t1', 5)).toEqual([]);
    expect(calls.some((c) => c.url === '/api/scheduler/runs?taskId=t1&limit=5')).toBe(true);
    expect(await s.loadLog('r1')).toBe('{}');
    expect(calls.some((c) => c.url === '/api/scheduler/runs/r1/log')).toBe(true);
    await s.pickFile();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/scheduler/pick-file')).toBe(true);
  });

  it('loadAiCommands 成功写入 / 失败清空', async () => {
    const s = useScheduler();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ commands: [{ name: 'c' }] }) })));
    await s.loadAiCommands();
    expect(s.state.aiCommands).toHaveLength(1);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await s.loadAiCommands();
    expect(s.state.aiCommands).toEqual([]);
  });

  it('refresh 失败写入 error 并复位 loading', async () => {
    const s = useScheduler();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    await s.refresh();
    expect(s.state.error).toContain('boom');
    expect(s.state.loading).toBe(false);
  });

  it('dispose 取消所有 WS 订阅', () => {
    const unsubs: number[] = [];
    let n = 0;
    const terminal = { on: (_t: string, _h: (msg: any) => void) => { const i = n++; return () => { unsubs[i] = 1; }; } };
    const s = useScheduler(terminal);
    s.dispose();
    expect(unsubs).toHaveLength(3);
    expect(unsubs.every((v) => v === 1)).toBe(true);
  });
});
