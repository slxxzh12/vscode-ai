import { describe, it, expect, vi, afterEach } from 'vitest';
import { MAX_RECENT_TABS, MAX_RESTORE_TABS, allowedRestoreIds, clampRestoreTabs, pushRecentTab } from './restorePrefs';

function stubStorage(store: Record<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  });
}
async function fresh() { vi.resetModules(); return import('./restorePrefs'); }

describe('restorePrefs 纯函数', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clampRestoreTabs：非法/小于 1 回退默认 5，超过上限截断，向下取整', () => {
    expect(clampRestoreTabs(undefined)).toBe(5);
    expect(clampRestoreTabs(null)).toBe(5);
    expect(clampRestoreTabs('')).toBe(5);
    expect(clampRestoreTabs(0)).toBe(5);
    expect(clampRestoreTabs(-3)).toBe(5);
    expect(clampRestoreTabs(3.9)).toBe(3);
    expect(clampRestoreTabs(MAX_RESTORE_TABS + 100)).toBe(MAX_RESTORE_TABS);
  });

  it('pushRecentTab：去重后置顶，超上限截断', () => {
    expect(pushRecentTab([], 'a')).toEqual(['a']);
    expect(pushRecentTab(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecentTab(['a'], '')).toEqual(['a']);
    const many = Array.from({ length: MAX_RECENT_TABS }, (_, i) => `t${i}`);
    const out = pushRecentTab(many, 'new');
    expect(out[0]).toBe('new');
    expect(out).toHaveLength(MAX_RECENT_TABS);
  });

  it('allowedRestoreIds：无历史返回 null（不限制）；否则取前 N 个', () => {
    expect(allowedRestoreIds([], 5)).toBeNull();
    expect([...allowedRestoreIds(['a', 'b', 'c'], 2)!]).toEqual(['a', 'b']);
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(allowedRestoreIds(six, 0)!.size).toBe(5);   // 0 → 默认 5
  });
});

describe('restorePrefs 存储', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('读取已存的恢复数，setRestoreTabs 归一化后落盘', async () => {
    const store: Record<string, string> = { 'devflow-restore-tabs': '8' };
    stubStorage(store);
    const m = await fresh();
    expect(m.restoreTabs.value).toBe(8);
    expect(m.setRestoreTabs(0)).toBe(5);
    expect(store['devflow-restore-tabs']).toBe('5');
  });

  it('loadRecentTabs 过滤非字符串；saveRecentTabs 截断落盘', async () => {
    const store: Record<string, string> = { 'devflow-recent-tabs': JSON.stringify(['s:1', 2, '', 'f:a|b']) };
    stubStorage(store);
    const m = await fresh();
    expect(m.loadRecentTabs()).toEqual(['s:1', 'f:a|b']);
    const many = Array.from({ length: MAX_RECENT_TABS + 10 }, (_, i) => `t${i}`);
    m.saveRecentTabs(many);
    expect(JSON.parse(store['devflow-recent-tabs'])).toHaveLength(MAX_RECENT_TABS);
  });
});
