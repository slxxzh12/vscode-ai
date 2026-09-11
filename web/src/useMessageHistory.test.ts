import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMessageHistory } from './useMessageHistory';

describe('useMessageHistory', () => {
  const hook = useMessageHistory();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      void url;
      return { json: async () => ({ messages: [] }) } as any;
    }));
    hook.clear();
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
});
