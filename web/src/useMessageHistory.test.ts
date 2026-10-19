import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMessageHistory } from './useMessageHistory';

describe('useMessageHistory', () => {
  const hook = useMessageHistory();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      void url;
      return { ok: true, json: async () => ({ messages: [] }) } as any;
    }));
    await hook.flush();
    hook.clear();
    hook.setNames({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('push 记录 sessionId 与页签名', async () => {
    await hook.push('hello', { sessionId: 's1', tabName: 'foo' });
    expect(hook.messages.value[0]).toMatchObject({ text: 'hello', sessionId: 's1', tabName: 'foo' });
  });

  it('renameTab 把该会话下所有历史消息的页签名一并更新', async () => {
    await hook.push('a', { sessionId: 's1', tabName: 'foo' });
    await hook.push('b', { sessionId: 's1', tabName: 'foo' });
    await hook.push('c', { sessionId: 's2', tabName: 'bar' });
    hook.renameTab('s1', 'renamed');
    const byText = Object.fromEntries(hook.messages.value.map((m) => [m.text, m.tabName]));
    expect(byText).toEqual({ a: 'renamed', b: 'renamed', c: 'bar' });
  });

  it('重复文本也逐条记录输入事件（统计不去重）', async () => {
    const fetchMock = vi.fn(async (_url: unknown, opts?: any) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({}) } as any;
      return { ok: true, json: async () => ({ messages: [] }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    await hook.push('same');
    await hook.push('same');
    await vi.advanceTimersByTimeAsync(900);
    const posts = fetchMock.mock.calls.filter((c) => (c[1] as any)?.method === 'POST');
    expect(posts.length).toBeGreaterThan(0);
    const body = JSON.parse((posts[posts.length - 1][1] as any).body);
    expect(body.events).toHaveLength(2);
  });

  it('renameTab 记录会话自定义名，setNames 批量写入', async () => {
    await hook.push('x', { sessionId: 's1', tabName: 'foo' });
    hook.renameTab('s1', '新名');
    expect(hook.names.value.s1).toBe('新名');
    hook.setNames({ s9: '九' });
    expect(hook.names.value).toEqual({ s9: '九' });
  });
});
