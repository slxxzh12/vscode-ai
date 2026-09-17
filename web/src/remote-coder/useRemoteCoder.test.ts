import { describe, it, expect, vi } from 'vitest';
import { requestShot, fetchScreenRev, sendRemoteMessage, waitForNewScreen, screenUrl } from './useRemoteCoder';

type Call = { url: string; init?: RequestInit };

function mkFetch(body: unknown) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const b = typeof body === 'function' ? (body as (n: number) => unknown)(calls.length) : body;
    return { ok: true, status: 200, json: async () => b };
  });
  return { fetchFn, calls };
}

describe('useRemoteCoder', () => {
  it('requestShot 发截图命令', async () => {
    const { fetchFn, calls } = mkFetch({ ok: true });
    await requestShot({ fetch: fetchFn as never });
    expect(calls[0].url).toBe('/api/remote-coder/message');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ kind: 'screenshot' });
  });

  it('sendRemoteMessage 发文本消息，失败抛错', async () => {
    const { fetchFn, calls } = mkFetch({ ok: true });
    await sendRemoteMessage('继续', { fetch: fetchFn as never });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ kind: 'message', text: '继续' });

    const bad = mkFetch({});
    bad.fetchFn.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }));
    await expect(sendRemoteMessage('x', { fetch: bad.fetchFn as never })).rejects.toThrow('boom');
  });

  it('fetchScreenRev 取版本号，缺字段或异常返回空串', async () => {
    const { fetchFn } = mkFetch({ rev: 'r1' });
    expect(await fetchScreenRev({ fetch: fetchFn as never })).toBe('r1');
    const empty = mkFetch({});
    expect(await fetchScreenRev({ fetch: empty.fetchFn as never })).toBe('');
    const boom = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchScreenRev({ fetch: boom as never })).toBe('');
  });

  it('waitForNewScreen：rev 变化即返回；超时返回 null', async () => {
    const { fetchFn } = mkFetch((n: number) => (n <= 1 ? { rev: 'r1' } : { rev: 'r2' }));
    expect(await waitForNewScreen('r1', { fetch: fetchFn as never, timeoutMs: 300, intervalMs: 5 })).toEqual({ rev: 'r2' });

    const stuck = mkFetch({ rev: 'r1' });
    expect(await waitForNewScreen('r1', { fetch: stuck.fetchFn as never, timeoutMs: 60, intervalMs: 5 })).toBeNull();
  });

  it('screenUrl 带 rev', () => {
    expect(screenUrl('r1')).toBe('/api/remote-coder/screen.png?v=r1');
    expect(screenUrl('')).toBe('/api/remote-coder/screen.png?v=');
  });
});
