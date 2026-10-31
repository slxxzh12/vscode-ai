import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { mergePrefs, defaultPrefs } from './codePrefs';

describe('mergePrefs', () => {
  it('缺键/类型不符 → 用默认值', () => {
    const base = defaultPrefs();
    expect(mergePrefs(null, base)).toEqual(base);
    expect(mergePrefs({ exts: 42, excludeTestFiles: 'yes', nope: 1 }, base)).toEqual(base);
  });
  it('已保存的值覆盖默认值', () => {
    const base = defaultPrefs();
    const r = mergePrefs({ exts: '.js', excludeTestFiles: false, codeOnly: false, hugeCommitLimit: '500' }, base);
    expect(r.exts).toBe('.js');
    expect(r.excludeTestFiles).toBe(false);
    expect(r.codeOnly).toBe(false);
    expect(r.hugeCommitLimit).toBe('500');
    expect(r.excludeDirs).toBe(base.excludeDirs);
  });
});

describe('defaultPrefs', () => {
  it('默认含 sql/xml 后缀与 node_modules 排除目录', () => {
    const p = defaultPrefs();
    expect(p.exts).toContain('.sql');
    expect(p.exts).toContain('.xml');
    expect(p.excludeDirs).toContain('node_modules');
    expect(p.excludeTestFiles).toBe(true);
    expect(p.codeOnly).toBe(true);
  });
});

describe('useCodePrefs', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('load 合并服务端已存配置；修改触发去抖保存；saveNow 立即上报', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return { ok: true, json: async () => JSON.parse(String(init.body)) };
      return { ok: true, json: async () => ({ exts: '.js' }) };
    }));
    const { useCodePrefs } = await import('./codePrefs');
    const { prefs, load, saveNow } = useCodePrefs();
    await load();
    expect(prefs.value.exts).toBe('.js');

    prefs.value = { ...prefs.value, codeOnly: false };
    await nextTick();
    await vi.advanceTimersByTimeAsync(600);
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(true);

    const r = await saveNow();
    expect(r.codeOnly).toBe(false);
  });

  it('load 失败回退默认值；二次 load 不再请求', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls += 1; return { ok: false, status: 500 }; }));
    const mod = await import('./codePrefs');
    const { prefs, load } = mod.useCodePrefs();
    await load();
    expect(prefs.value).toEqual(mod.defaultPrefs());
    await load();
    expect(calls).toBe(1);
  });
});
