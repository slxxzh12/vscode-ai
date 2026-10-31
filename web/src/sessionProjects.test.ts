import { describe, it, expect, vi, afterEach } from 'vitest';

async function fresh() {
  vi.resetModules();
  const mod = await import('./sessionProjects');
  return mod;
}

describe('sessionProjects', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('normalizeMap 只保留非空字符串值', async () => {
    const mod = await fresh();
    expect(mod.normalizeMap({ a: 'p1', b: '', c: 1, d: null })).toEqual({ a: 'p1' });
    expect(mod.normalizeMap(null)).toEqual({});
    expect(mod.normalizeMap([])).toEqual({});
  });

  it('load 拉取后填入 map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ s_1: 'p1', bad: 5 }) })));
    const mod = await fresh();
    const hook = mod.useSessionProjects();
    await hook.load();
    expect(hook.map.value).toEqual({ s_1: 'p1' });
  });

  it('请求失败/非 2xx 时保持空，不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    const mod = await fresh();
    const hook = mod.useSessionProjects();
    await hook.load();
    expect(hook.map.value).toEqual({});

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const mod2 = await fresh();
    const hook2 = mod2.useSessionProjects();
    await hook2.load();
    expect(hook2.map.value).toEqual({});
  });

  it('load 只请求一次（单例）', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ s_1: 'p1' }) }));
    vi.stubGlobal('fetch', f);
    const mod = await fresh();
    const hook = mod.useSessionProjects();
    await hook.load();
    await hook.load();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
