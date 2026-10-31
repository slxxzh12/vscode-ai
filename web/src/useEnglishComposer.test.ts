import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { isAsciiOnly, mergeComposerPrefs, useEnglishComposer, type EnglishComposerDeps } from './useEnglishComposer';

describe('isAsciiOnly', () => {
  it('å­—æ¯/æ•°å­—/ç©ºç™½/ASCII æ ‡ç‚¹ â†’ true', () => {
    expect(isAsciiOnly('npm run dev')).toBe(true);
    expect(isAsciiOnly('/compact')).toBe(true);
    expect(isAsciiOnly('123  ')).toBe(true);
    expect(isAsciiOnly('git commit -m "x"')).toBe(true);
  });
  it('å«ä¸­æ–‡/å…¶å®ƒéž ASCII â†’ false', () => {
    expect(isAsciiOnly('ä½ å¥½')).toBe(false);
    expect(isAsciiOnly('hello ä¸–ç•Œ')).toBe(false);
    expect(isAsciiOnly('ðŸ˜€')).toBe(false);
  });
});

describe('mergeComposerPrefs', () => {
  it('ç¼ºé”®/ç±»åž‹ä¸ç¬¦ â†’ é»˜è®¤ true', () => {
    expect(mergeComposerPrefs(null)).toBe(true);
    expect(mergeComposerPrefs({})).toBe(true);
    expect(mergeComposerPrefs([])).toBe(true);
    expect(mergeComposerPrefs({ autoSend: 'yes' })).toBe(true);
  });
  it('æœåŠ¡ç«¯å·²å­˜å€¼è¦†ç›–é»˜è®¤', () => {
    expect(mergeComposerPrefs({ autoSend: false })).toBe(false);
    expect(mergeComposerPrefs({ autoSend: true })).toBe(true);
  });
});

function setup(overrides: Partial<EnglishComposerDeps> = {}) {
  const sent: Array<{ text: string; sid: string | null }> = [];
  const history: Array<{ text: string; sid: string | null }> = [];
  let active: string | null = 's1';
  const ec = useEnglishComposer({
    translate: async (text: string) => 'EN:' + text,
    getActiveSessionId: () => active,
    send: (text, sid) => { sent.push({ text, sid }); },
    recordHistory: (text, sid) => { history.push({ text, sid }); },
    onError: () => { /* ignore */ },
    ...overrides,
  });
  return { ec, sent, history, setActive: (v: string | null) => { active = v; } };
}

describe('useEnglishComposer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('º¬ÖÐÎÄ£ºµ÷·­Òë½Ó¿Ú ¡ú ÌîÓÒÀ¸ ¡ú 3 Ãëºó×Ô¶¯·¢ËÍ', async () => {
    const { ec, sent } = setup();
    ec.source.value = 'ÅÜ²âÊÔ';
    await ec.translateNow();
    expect(ec.translated.value).toBe('EN:ÅÜ²âÊÔ');
    expect(ec.countdown.value).toBe(3);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([{ text: 'EN:ÅÜ²âÊÔ', sid: 's1' }]);
    expect(ec.source.value).toBe('');
    expect(ec.translated.value).toBe('');
    expect(ec.countdown.value).toBeNull();
  });

  it('´¿ ASCII£º²»µ÷·­Òë½Ó¿Ú£¬Ô­ÑùÌîÓÒÀ¸ºó×Ô¶¯·¢ËÍ', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return { ok: true, json: async () => ({}) }; }));
    const { ec, sent } = setup({ translate: undefined });
    ec.source.value = '/compact';
    await ec.translateNow();
    expect(calls.filter((u) => u.includes('/api/translate'))).toHaveLength(0);
    expect(ec.translated.value).toBe('/compact');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([{ text: '/compact', sid: 's1' }]);
  });

  it('ÀúÊ·¼ÇÂ¼ÖÐÎÄÔ­ÎÄ£¬ÖÕ¶ËÊÕµ½Ó¢ÎÄ', async () => {
    const { ec, history, sent } = setup();
    ec.source.value = 'ÄãºÃ';
    await ec.translateNow();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent[0].text).toBe('EN:ÄãºÃ');
    expect(history).toEqual([{ text: 'ÄãºÃ', sid: 's1' }]);
  });

  it('Î´¹´Ñ¡×Ô¶¯·¢ËÍ£º²»Æô¶¯µ¹¼ÆÊ±£¬ÊÖ¶¯·¢ËÍ²ÅËÍ³ö', async () => {
    const { ec, sent } = setup();
    ec.autoSend.value = false;
    ec.source.value = 'ÄãºÃ';
    await ec.translateNow();
    expect(ec.countdown.value).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(0);
    await ec.sendAction();
    expect(sent).toEqual([{ text: 'EN:ÄãºÃ', sid: 's1' }]);
  });

  it('µ¹¼ÆÊ±ÆÚ¼ä¸Ä×óÀ¸ ¡ú È¡Ïû·¢ËÍÇÒ²»ÖØÒë', async () => {
    const { ec, sent } = setup();
    ec.source.value = 'ÄãºÃ';
    await ec.translateNow();
    ec.source.value = 'ÄãºÃ°¡';
    await nextTick();
    expect(ec.countdown.value).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(0);
  });

  it('µ¹¼ÆÊ±ÆÚ¼ä¸ÄÓÒÀ¸ ¡ú ±£Áô±à¼­²¢ÖØÖÃ 3 Ãë', async () => {
    const { ec, sent } = setup();
    ec.source.value = 'ÄãºÃ';
    await ec.translateNow();
    await vi.advanceTimersByTimeAsync(2000);
    ec.translated.value = 'HELLO';
    await nextTick();
    expect(ec.countdown.value).toBe(3);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([{ text: 'HELLO', sid: 's1' }]);
  });

  it('µ¹¼ÆÊ±ÆÚ¼ä»î¶¯»á»°±äÁË ¡ú ÈÔ·¢µ½ÌîÒëÎÄÊ±µÄ»á»°', async () => {
    const { ec, sent, setActive } = setup();
    ec.source.value = 'ÄãºÃ';
    await ec.translateNow();
    setActive('s2');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([{ text: 'EN:ÄãºÃ', sid: 's1' }]);
  });

  it('Á½À¸¶¼¿Õ£º·¢ËÍ°´Å¥/×óÀ¸»Ø³µ¶¼Ö±½Ó·¢ ok', async () => {
    const a = setup();
    await a.ec.sendAction();
    expect(a.sent).toEqual([{ text: 'ok', sid: 's1' }]);
    const b = setup();
    await b.ec.onLeftEnter();
    expect(b.sent).toEqual([{ text: 'ok', sid: 's1' }]);
  });

  it('ÓÒÀ¸¿Õ¡¢×óÀ¸ÓÐÄÚÈÝ£º·¢ËÍ°´Å¥ÏÈ·­ÒëÔÙÁ¢¼´·¢ËÍ£¨²»µÈ 3 Ãë£©', async () => {
    const { ec, sent } = setup();
    ec.source.value = 'ÄãºÃ';
    await ec.sendAction();
    expect(sent).toEqual([{ text: 'EN:ÄãºÃ', sid: 's1' }]);
    expect(ec.countdown.value).toBeNull();
  });

  it('µ¹¼ÆÊ±ÖÐÓÒÀ¸»Ø³µ ¡ú Á¢¼´·¢ËÍ²¢Çå¼ÆÊ±', async () => {
    const { ec, sent } = setup();
    ec.source.value = 'ÄãºÃ';
    await ec.translateNow();
    await ec.sendAction();
    expect(sent).toEqual([{ text: 'EN:ÄãºÃ', sid: 's1' }]);
    expect(ec.countdown.value).toBeNull();
  });

  it('·­ÒëÊ§°Ü£º×ß onError¡¢²»·¢ËÍ¡¢²»µ¹¼ÆÊ±', async () => {
    const errs: string[] = [];
    const { ec, sent } = setup({
      translate: async () => { const e = new Error('boom') as Error & { code?: string }; e.code = 'no-key'; throw e; },
      onError: (key: string) => { errs.push(key); },
    });
    ec.source.value = 'ÄãºÃ';
    expect(await ec.translateNow()).toBe(false);
    expect(errs).toEqual(['et.no_key']);
    expect(ec.countdown.value).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('load ¶Á·þÎñ¶Ë autoSend£»¸Ä¶¯È¥¶¶ POST', async () => {
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return { ok: true, json: async () => posts.at(-1) }; }
      return { ok: true, json: async () => ({ autoSend: false }) };
    }));
    const { ec } = setup();
    await ec.load();
    expect(ec.autoSend.value).toBe(false);
    ec.autoSend.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(600);
    expect(posts.at(-1)).toEqual({ autoSend: true });
  });
});
