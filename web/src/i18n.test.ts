import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

function stubEnv(lang: string, store = new Map<string, string>()) {
  vi.stubGlobal('navigator', { language: lang });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  });
  return store;
}

describe('web i18n', () => {
  it('默认按浏览器语言探测', async () => {
    stubEnv('en-US');
    const mod = await import('./i18n');
    expect(mod.locale.value).toBe('en');
  });

  it('无法识别的语言（非中文）默认英文', async () => {
    stubEnv('fr-FR');
    const mod = await import('./i18n');
    expect(mod.locale.value).toBe('en');
  });

  it('localStorage 优先于浏览器语言', async () => {
    stubEnv('en-US', new Map([['devflow-lang', 'zh-CN']]));
    const mod = await import('./i18n');
    expect(mod.locale.value).toBe('zh-CN');
  });

  it('setLocale 切换、持久化并同步服务端', async () => {
    const store = stubEnv('zh-CN');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
    const mod = await import('./i18n');
    expect(mod.locale.value).toBe('zh-CN');
    mod.setLocale('en');
    expect(mod.locale.value).toBe('en');
    expect(store.get('devflow-lang')).toBe('en');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/settings/language');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({ language: 'en' });
  });

  it('t 用当前语言渲染并回退未知 key', async () => {
    stubEnv('en');
    const mod = await import('./i18n');
    expect(mod.t('nav.explorer')).toBe('Explorer');
    expect(mod.t('nope.missing')).toBe('nope.missing');
  });
});
