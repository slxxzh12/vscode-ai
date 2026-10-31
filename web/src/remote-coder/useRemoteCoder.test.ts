import { describe, it, expect, vi } from 'vitest';
import { requestShot, fetchScreenRev, sendRemoteMessage, waitForNewScreen, screenUrl, fetchRemoteInfo, appendMessages } from './useRemoteCoder';

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

  it('appendMessages 提交原始 JSONC 文本，失败抛错', async () => {
    const { fetchFn, calls } = mkFetch({ ok: true, added: 2, ids: ['a', 'b'] });
    const r = await appendMessages('[{"kind":"message","text":"a"}]', { fetch: fetchFn as never });
    expect(calls[0].url).toBe('/api/remote-coder/messages');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ text: '[{"kind":"message","text":"a"}]' });
    expect(r).toEqual({ added: 2, ids: ['a', 'b'] });

    const bad = mkFetch({});
    bad.fetchFn.mockImplementationOnce(async () => ({ ok: false, status: 400, json: async () => ({ message: 'bad-jsonc' }) }));
    await expect(appendMessages('x', { fetch: bad.fetchFn as never })).rejects.toThrow('bad-jsonc');
  });

  it('fetchRemoteInfo 取真实路径，异常回退空串', async () => {
    const info = { dir: 'D:/app/remote_coder', messagesFile: 'D:/app/remote_coder/messages.jsonc' };
    const { fetchFn } = mkFetch(info);
    expect(await fetchRemoteInfo({ fetch: fetchFn as never })).toEqual(info);
    const boom = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchRemoteInfo({ fetch: boom as never })).toEqual({ dir: '', messagesFile: '' });
  });
});
