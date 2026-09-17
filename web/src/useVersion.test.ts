import { describe, it, expect, vi, afterEach } from 'vitest';

async function fresh() {
  vi.resetModules();
  return import('./useVersion');
}

describe('useVersion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loadVersion 拉取并缓存版本；已有值不再请求', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls += 1; return { ok: true, json: async () => ({ version: 'v20260101' }) }; }));
    const { useVersion, loadVersion } = await fresh();
    await loadVersion();
    expect(useVersion().version.value).toBe('v20260101');
    await loadVersion();
    expect(calls).toBe(1);
  });

  it('非 2xx → 不设置版本', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const { useVersion, loadVersion } = await fresh();
    await loadVersion();
    expect(useVersion().version.value).toBe('');
  });

  it('请求失败被吞，保持空', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { useVersion, loadVersion } = await fresh();
    await loadVersion();
    expect(useVersion().version.value).toBe('');
  });

  it('并发调用共享同一 pending', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      await gate;
      return { ok: true, json: async () => ({ version: 'v1' }) };
    }));
    const { useVersion, loadVersion } = await fresh();
    const p1 = loadVersion();
    const p2 = loadVersion();
    release();
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
    expect(useVersion().version.value).toBe('v1');
  });
});
