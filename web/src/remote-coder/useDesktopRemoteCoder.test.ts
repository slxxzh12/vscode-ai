// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { startDesktopRemoteCoder } from './useDesktopRemoteCoder';

type Call = { url: string; init?: RequestInit };

function mkFetch(responses: unknown[]) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = responses.shift() ?? { entries: [] };
    return { ok: true, status: 200, json: async () => body };
  });
  return { fetchFn, calls };
}

function tick(ms = 0) { return new Promise((r) => setTimeout(r, ms)); }

describe('startDesktopRemoteCoder', () => {
  it('拉 inbox → 先 ack，再按 kind 派发事件', async () => {
    const { fetchFn, calls } = mkFetch([
      { entries: [{ id: 'm1', kind: 'message', text: '继续' }, { id: 'c1', kind: 'screenshot' }] },
    ]);
    const events: Array<{ name: string; detail?: unknown }> = [];
    const stop = startDesktopRemoteCoder({
      fetch: fetchFn as never,
      visibility: () => 'visible',
      dispatch: (name, detail) => events.push({ name, detail }),
      intervalMs: 5,
    });
    await tick(20);
    stop();
    expect(calls[0].url).toBe('/api/remote-coder/inbox');
    const ack = calls.find((c) => c.url === '/api/remote-coder/ack');
    expect(JSON.parse(String(ack?.init?.body))).toEqual({ ids: ['m1', 'c1'] });
    expect(events).toEqual([
      { name: 'df-remote-send', detail: { text: '继续' } },
      { name: 'df-remote-screen', detail: undefined },
    ]);
  });

  it('页面不可见时不请求也不 ack', async () => {
    const { fetchFn, calls } = mkFetch([]);
    const stop = startDesktopRemoteCoder({ fetch: fetchFn as never, visibility: () => 'hidden', dispatch: () => {}, intervalMs: 5 });
    await tick(20);
    stop();
    expect(calls).toHaveLength(0);
  });

  it('空 inbox 只拉取，不 ack', async () => {
    const { fetchFn, calls } = mkFetch([{ entries: [] }, { entries: [] }]);
    const stop = startDesktopRemoteCoder({ fetch: fetchFn as never, visibility: () => 'visible', dispatch: () => {}, intervalMs: 5 });
    await tick(20);
    stop();
    expect(calls.every((c) => c.url === '/api/remote-coder/inbox')).toBe(true);
  });

  it('请求失败不抛出，下一轮继续', async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
      return { ok: true, status: 200, json: async () => ({ entries: [] }) };
    });
    const stop = startDesktopRemoteCoder({ fetch: fetchFn as never, visibility: () => 'visible', dispatch: () => {}, intervalMs: 5 });
    await tick(25);
    stop();
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
  });

  it('stop() 后不再请求', async () => {
    const { fetchFn, calls } = mkFetch([]);
    const stop = startDesktopRemoteCoder({ fetch: fetchFn as never, visibility: () => 'visible', dispatch: () => {}, intervalMs: 5 });
    await tick(12);
    stop();
    const seen = calls.length;
    await tick(20);
    expect(calls.length).toBe(seen);
  });
});
