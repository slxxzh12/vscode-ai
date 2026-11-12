import { describe, it, expect, vi, afterEach } from 'vitest';

function stubStorage(store: Record<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  });
}
async function fresh() { vi.resetModules(); return import('./upgradePrefs'); }

describe('upgradePrefs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('默认开启自动检查升级', async () => {
    stubStorage({});
    const m = await fresh();
    expect(m.loadAutoCheckUpgrade()).toBe(true);
    expect(m.autoCheckUpgrade.value).toBe(true);
  });

  it('关闭后落盘，重新加载保持关闭', async () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    const m = await fresh();
    expect(m.setAutoCheckUpgrade(false)).toBe(false);
    expect(store['devflow-upgrade-auto']).toBe('0');
    vi.resetModules();
    const again = await import('./upgradePrefs');
    expect(again.autoCheckUpgrade.value).toBe(false);
  });

  it('默认未征询；用户确认后落盘并保持', async () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    const m = await fresh();
    expect(m.loadUpgradeAsked()).toBe(false);
    expect(m.upgradeAsked.value).toBe(false);
    expect(m.setUpgradeAsked(true)).toBe(true);
    expect(store['devflow-upgrade-asked']).toBe('1');
    vi.resetModules();
    const again = await import('./upgradePrefs');
    expect(again.upgradeAsked.value).toBe(true);
  });

  it('旧版本已有的自动检查选项视为已征询，升级后不再重复弹窗', async () => {
    stubStorage({ 'devflow-upgrade-auto': '0' });
    const m = await fresh();
    expect(m.loadUpgradeAsked()).toBe(true);
    expect(m.autoCheckUpgrade.value).toBe(false);
  });
});
