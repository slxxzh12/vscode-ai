import { describe, it, expect, vi, afterEach } from 'vitest';

function fresh() { vi.resetModules(); return import('./useUpgrade'); }
function stubStorage(store: Record<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  });
}
const ASKED = { 'devflow-upgrade-asked': '1' };
afterEach(() => vi.unstubAllGlobals());

describe('useUpgrade', () => {
  it('loadUpgrade 拉 /api/upgrade 并填充', async () => {
    stubStorage({ ...ASKED });
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

  it('refreshUpgrade 打开升级入口时强制重新获取最新版本', async () => {
    stubStorage({ ...ASKED });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return { ok: true, json: async () => ({ ok: true, current: 'v1', latest: 'v9', hasUpdate: true, url: 'http://d' }) }; }));
    const { refreshUpgrade, useUpgrade } = await fresh();
    await refreshUpgrade();
    expect(calls[0]).toBe('/api/upgrade?refresh=1');
    expect(useUpgrade().upgrade.value?.latest).toBe('v9');
  });

  it('升级图标展示最新版本号', async () => {
    const { upgradeBadgeText } = await fresh();
    expect(upgradeBadgeText({ latest: 'v20261110202807' }, '新版本')).toBe('新版本 v20261110202807');
    expect(upgradeBadgeText({ latest: '' }, '新版本')).toBe('新版本');
    expect(upgradeBadgeText(null, '新版本')).toBe('新版本');
  });

  it('打开升级入口用 releases 页面，不固定到某个版本的下载地址', async () => {
    const { upgradeOpenTarget } = await fresh();
    const url = 'https://gitee.com/slxxzh12/vscode-ai/releases';
    const downloadUrl = 'https://gitee.com/slxxzh12/vscode-ai/releases/download/v20260101/x.zip';
    expect(upgradeOpenTarget({ url, downloadUrl })).toBe(url);
    expect(upgradeOpenTarget(null)).toBe('');
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

  it('关闭自动检查后不联网；手动 checkNow 仍可强制检查', async () => {
    stubStorage({ 'devflow-upgrade-auto': '0', 'devflow-upgrade-asked': '1' });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return { ok: true, json: async () => ({ ok: true, current: 'v1', latest: 'v3', hasUpdate: true, url: 'http://d' }) }; }));
    const { loadUpgrade, refreshUpgrade, checkNow } = await fresh();
    await loadUpgrade();
    expect(calls.length).toBe(0);
    await refreshUpgrade();
    expect(calls.length).toBe(0);
    await refreshUpgrade(true);
    expect(calls[0]).toBe('/api/upgrade?refresh=1');
    await checkNow();
    expect(calls.length).toBe(2);
  });

  it('用户确认前不联网；确认后才自动检查', async () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return { ok: true, json: async () => ({ ok: true, current: 'v1', latest: 'v3', hasUpdate: true, url: 'http://d' }) }; }));
    const { loadUpgrade, refreshUpgrade } = await fresh();
    await loadUpgrade();
    await refreshUpgrade();
    expect(calls.length).toBe(0);
    const prefs = await import('./upgradePrefs');
    prefs.setUpgradeAsked(true);
    await loadUpgrade();
    expect(calls[0]).toBe('/api/upgrade');
    await refreshUpgrade();
    expect(calls[1]).toBe('/api/upgrade?refresh=1');
  });
});
