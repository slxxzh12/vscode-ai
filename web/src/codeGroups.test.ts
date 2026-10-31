import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { groupSlices } from './codeGroups';

describe('groupSlices', () => {
  it('按成员分组求和并降序', () => {
    const rows = [{ key: 'Ann', value: 10 }, { key: 'Bob', value: 5 }, { key: 'Cat', value: 7 }];
    expect(groupSlices(rows, { Ann: 'A组', Cat: 'A组', Bob: 'B组' })).toEqual([
      { name: 'A组', value: 17 }, { name: 'B组', value: 5 },
    ]);
  });
  it('未归属归到空名并排最后', () => {
    const rows = [{ key: 'Ann', value: 10 }, { key: 'Dan', value: 3 }, { key: 'Eve', value: 1 }];
    expect(groupSlices(rows, { Ann: 'A组' })).toEqual([{ name: 'A组', value: 10 }, { name: '', value: 4 }]);
  });
  it('空输入返回空数组', () => {
    expect(groupSlices([], {})).toEqual([]);
  });
  it('值为 0 的组保留', () => {
    expect(groupSlices([{ key: 'Ann', value: 0 }], { Ann: 'A组' })).toEqual([{ name: 'A组', value: 0 }]);
  });
});

describe('useCodeGroups', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('load 拉取分组；增删改触发去抖上报', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return { ok: true, json: async () => JSON.parse(String(init.body)) };
      return { ok: true, json: async () => ({ groups: ['A'], members: { Ann: 'A' } }) };
    }));
    const { useCodeGroups } = await import('./codeGroups');
    const g = useCodeGroups();
    await g.load();
    expect(g.groups.value).toEqual(['A']);
    expect(g.groupOf('Ann')).toBe('A');

    expect(g.addGroup('  B  ')).toBe(true);
    expect(g.addGroup('B')).toBe(false);
    expect(g.addGroup('   ')).toBe(false);
    expect(g.groups.value).toContain('B');

    g.assign('Bob', 'B');
    expect(g.groupOf('Bob')).toBe('B');
    g.assign('', 'B');
    expect(g.groupOf('')).toBe('');

    g.removeGroup('A');
    expect(g.groups.value).toEqual(['B']);
    expect(g.groupOf('Ann')).toBe('');

    await vi.advanceTimersByTimeAsync(500);
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(true);
  });

  it('load 失败保留现状；force 强制重新拉取', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    const { useCodeGroups } = await import('./codeGroups');
    const g = useCodeGroups();
    await g.load();
    expect(g.groups.value).toEqual([]);
    await g.load(true);
    expect(g.groups.value).toEqual([]);
  });

  it('save 直接上报并回写服务端返回', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ groups: ['Z'], members: {} }) };
      return { ok: true, json: async () => ({ groups: [], members: {} }) };
    }));
    const { useCodeGroups } = await import('./codeGroups');
    const g = useCodeGroups();
    await g.load();
    const r = await g.save();
    expect(r).toEqual({ groups: ['Z'], members: {} });
    expect(g.groups.value).toEqual(['Z']);
  });
});
