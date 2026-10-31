import { describe, it, expect, vi, afterEach } from 'vitest';

function fresh() { vi.resetModules(); return import('./useUpgrade'); }
afterEach(() => vi.unstubAllGlobals());

describe('useUpgrade', () => {
  it('loadUpgrade 拉 /api/upgrade 并填充', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return { ok: true, json: async () => ({ ok: true, current: 'v1', latest: 'v2', hasUpdate: true, url: 'http://d' }) }; }));
    const { loadUpgrade, useUpgrade } = await fresh();
    await loadUpgrade();
    expect(calls[0]).toBe('/api/upgrade');
    expect(useUpgrade().upgrade.value?.hasUpdate).toBe(true);
  });

  it('checkNow 强制刷新（?refresh=1）', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return { ok: true, json: async () => ({ ok: true, current: 'v1', latest: 'v3', hasUpdate: true, url: 'http://d' }) }; }));
    const { checkNow, useUpgrade } = await fresh();
    await checkNow();
    expect(calls[0]).toBe('/api/upgrade?refresh=1');
    expect(useUpgrade().upgrade.value?.latest).toBe('v3');
  });

  it('shouldPopup：跳过版本/10 天内不弹/满足条件弹', async () => {
    const { shouldPopup } = await fresh();
    const info = { ok: true, current: 'v1', latest: 'v2', hasUpdate: true, url: '', checkedAt: 0 };
    const DAY = 24 * 3600 * 1000;
    expect(shouldPopup(info, 1000, {})).toBe(true);
    expect(shouldPopup(info, 1000, { skip: 'v2' })).toBe(false);
    expect(shouldPopup(info, 1000, { popupAt: 1000 })).toBe(false);
    expect(shouldPopup(info, 1000, { popupAt: 1000 - 15 * DAY })).toBe(true);
    expect(shouldPopup(info, 1000, { popupAt: 1000 - 15 * DAY + 1 })).toBe(false);
    expect(shouldPopup(null, 1000, {})).toBe(false);
    expect(shouldPopup({ ...info, hasUpdate: false }, 1000, {})).toBe(false);
  });
});
