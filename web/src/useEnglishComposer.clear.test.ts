import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEnglishComposer } from './useEnglishComposer';

describe('useEnglishComposer.clear', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('clear() 清空两栏并取消倒计时，不发送', async () => {
    vi.useFakeTimers();
    const sent: Array<{ text: string; sid: string | null }> = [];
    const ec = useEnglishComposer({
      translate: async (text: string) => 'EN:' + text,
      getActiveSessionId: () => 's1',
      send: (text, sid) => { sent.push({ text, sid }); },
      onError: () => { /* ignore */ },
    });

    ec.source.value = 'hello';
    await ec.translateNow();
    expect(ec.translated.value).toBe('hello');
    expect(ec.countdown.value).toBe(3);

    ec.clear();

    expect(ec.source.value).toBe('');
    expect(ec.translated.value).toBe('');
    expect(ec.countdown.value).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(0);
  });
});
