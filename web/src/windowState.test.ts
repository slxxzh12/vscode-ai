import { describe, it, expect, vi, afterEach } from 'vitest';
import { toSavedTabs, fileTabsOf, planRestore, saveWindowState, flushWindowState } from './windowState';
import type { WindowState } from './windowState';
import type { CenterTab } from './useCenter';

const tab = (over: Partial<CenterTab> = {}): CenterTab => ({ id: 'f:p1|a.ts', kind: 'file', label: 'a.ts', projectId: 'p1', path: 'a.ts', ...over });

describe('toSavedTabs', () => {
  it('只取文件页签并保序', () => {
    const tabs: CenterTab[] = [
      tab({ id: 's:1', kind: 'session', label: 'agent', projectId: undefined, path: undefined }),
      tab({ id: 'f:p1|a.ts', path: 'a.ts', label: 'a.ts' }),
      tab({ id: 'f:p2|b.ts', projectId: 'p2', path: 'b.ts', label: 'b.ts' }),
      tab({ id: 'f:p3|c.ts', projectId: 'p3', path: 'c.ts', label: '' as string }),   // label 空 → 用 path
    ];
    expect(toSavedTabs(tabs)).toEqual([
      { projectId: 'p1', path: 'a.ts', label: 'a.ts' },
      { projectId: 'p2', path: 'b.ts', label: 'b.ts' },
      { projectId: 'p3', path: 'c.ts', label: 'c.ts' },
    ]);
  });

  it('本地来源与工具页签不写入存档', () => {
    const tabs: CenterTab[] = [
      tab({ id: 'l:root', kind: 'local', label: 'proj', projectId: undefined, path: undefined }),
      tab({ id: 'l:f:1', kind: 'local', label: 'f.txt', projectId: undefined, path: undefined }),
      tab({ id: 't:notepad', kind: 'tool', label: 'notepad', projectId: undefined, path: undefined }),
      tab({ id: 'f:p1|a.ts', path: 'a.ts', label: 'a.ts' }),
    ];
    expect(toSavedTabs(tabs)).toEqual([{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }]);
  });
});

describe('fileTabsOf', () => {
  it('容错各种非法输入', () => {
    expect(fileTabsOf(null)).toEqual([]);
    expect(fileTabsOf({})).toEqual([]);
    expect(fileTabsOf({ tabs: 'nope' } as unknown as WindowState)).toEqual([]);
    expect(fileTabsOf({ tabs: [
      { projectId: 'p1', path: 'a.ts' },
      { projectId: '', path: 'x.ts' },
      { projectId: 'p', path: '' },
      null,
    ] } as unknown as WindowState)).toEqual([{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }]);
  });
});

describe('planRestore', () => {
  const base = {
    tabs: [
      { projectId: 'p1', path: 'a.ts', label: 'a.ts' },
      { projectId: 'gone', path: 'x.ts', label: 'x.ts' },
    ],
    activeTab: 'f:p1|a.ts',
  };

  it('过滤失效项目并恢复激活页签', () => {
    const plan = planRestore(base, { projectIds: ['p1'], hashRail: null, hashHistoryTab: null, deepLinkOpened: false });
    expect(plan.tabs).toEqual([{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }]);
    expect(plan.activeFileTab).toBe('f:p1|a.ts');
  });

  it('hash 已指定 rail/historyTab 时不返回对应字段；只指定 rail 时 historyTab 仍回填', () => {
    const st = { rail: 'explorer' as const, historyTab: 'files' as const, msgFilter: false };
    const a = planRestore(st, { projectIds: [], hashRail: 'history', hashHistoryTab: 'messages', deepLinkOpened: false });
    expect(a.rail).toBeUndefined();
    expect(a.historyTab).toBeUndefined();
    expect(a.msgFilter).toBe(false);

    const b = planRestore(st, { projectIds: [], hashRail: 'history', hashHistoryTab: null, deepLinkOpened: false });
    expect(b.rail).toBeUndefined();
    expect(b.historyTab).toBe('files');
  });

  it('deepLinkOpened 为真时不恢复激活页签', () => {
    const plan = planRestore(base, { projectIds: ['p1'], hashRail: null, hashHistoryTab: null, deepLinkOpened: true });
    expect(plan.activeFileTab).toBeUndefined();
  });

  it('activeTab 指不到恢复出来的文件页签时不返回它', () => {
    const plan = planRestore({ ...base, activeTab: 's:deadbeef' }, { projectIds: ['p1'], hashRail: null, hashHistoryTab: null, deepLinkOpened: false });
    expect(plan.activeFileTab).toBeUndefined();
  });

  it('state 为 null 时全部走兜底', () => {
    const plan = planRestore(null, { projectIds: ['p1'], hashRail: null, hashHistoryTab: null, deepLinkOpened: false });
    expect(plan).toEqual({ tabs: [] });
  });

  it('新窗口默认落在 messages，不继承存档子页', () => {
    const st = { rail: 'explorer' as const, historyTab: 'files' as const };
    const plan = planRestore(st, { projectIds: [], hashRail: null, hashHistoryTab: null, deepLinkOpened: false, newWindow: true });
    expect(plan.historyTab).toBe('messages');
    expect(plan.rail).toBe('explorer');
  });

  it('新窗口无存档时也给 messages；hash 指定子页时以 hash 为准', () => {
    expect(planRestore(null, { projectIds: [], hashRail: null, hashHistoryTab: null, deepLinkOpened: false, newWindow: true }).historyTab).toBe('messages');
    const plan = planRestore({ historyTab: 'files' }, { projectIds: [], hashRail: null, hashHistoryTab: 'tree', deepLinkOpened: false, newWindow: true });
    expect(plan.historyTab).toBeUndefined();
  });

  it('恢复合法的 msgAllStyle，忽略非法值', () => {
    const opts = { projectIds: [], hashRail: null, hashHistoryTab: null, deepLinkOpened: false };
    expect(planRestore({ msgAllStyle: 'flat' }, opts).msgAllStyle).toBe('flat');
    expect(planRestore({ msgAllStyle: 'tree' }, opts).msgAllStyle).toBe('tree');
    expect(planRestore({ msgAllStyle: 'nope' } as unknown as WindowState, opts).msgAllStyle).toBeUndefined();
    expect(planRestore({}, opts).msgAllStyle).toBeUndefined();
  });
});

describe('saveWindowState / flushWindowState', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('去抖合并写，flush 立即写', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({}) };
    }));
    vi.useFakeTimers();

    saveWindowState({ msgFilter: true });
    saveWindowState({ msgFilter: false });
    expect(calls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(700);
    expect(calls.length).toBe(1);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ msgFilter: false });

    await flushWindowState({ msgFilter: true });
    expect(calls.length).toBe(2);
    expect(calls[1].url).toBe('/api/window-state');
    expect(calls[1].init?.method).toBe('POST');
  });

  it('写失败静默', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    await expect(flushWindowState({})).resolves.toBeUndefined();
  });
});
