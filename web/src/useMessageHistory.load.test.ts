import { describe, it, expect, vi, afterEach } from 'vitest';

async function fresh() {
  vi.resetModules();
  const mod = await import('./useMessageHistory');
  return mod.useMessageHistory();
}

describe('useMessageHistory 加载与刷盘', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('load 解析字符串/对象消息，过滤非法项', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ messages: ['plain', { text: 'obj', ts: '5', sessionId: 's', tabName: 't' }, 42, { nope: 1 }, null] }),
    })));
    const hook = await fresh();
    await hook.load();
    expect(hook.messages.value.map((m) => m.text)).toEqual(['plain', 'obj']);
    expect(hook.messages.value[1]).toMatchObject({ ts: 5, sessionId: 's', tabName: 't' });
  });

  it('load 请求失败被吞，保持空', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    const hook = await fresh();
    await hook.load();
    expect(hook.messages.value).toEqual([]);
  });

  it('push 空串忽略；连续重复不记录', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ messages: [] }) })));
    const hook = await fresh();
    await hook.push('   ');
    expect(hook.messages.value).toHaveLength(0);
    await hook.push('dup');
    await hook.push('dup');
    expect(hook.messages.value.filter((m) => m.text === 'dup')).toHaveLength(1);
  });

  it('remove/clear 触发防抖刷盘，flush 上报 keepalive', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { json: async () => ({ messages: [] }) };
    }));
    vi.useFakeTimers();
    const hook = await fresh();
    hook.remove({ text: 'x', ts: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    const posts = calls.filter((c) => c.init?.method === 'POST');
    expect(posts.length).toBeGreaterThan(0);
    expect((posts[0].init as RequestInit & { keepalive?: boolean }).keepalive).toBe(true);

    hook.clear();
    await hook.flush();
    expect(hook.messages.value).toEqual([]);
  });

  it('renameTab 无变化不刷盘', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ messages: [] }) })));
    const hook = await fresh();
    hook.renameTab('nope', 'name');
    expect(hook.messages.value).toEqual([]);
  });
});
