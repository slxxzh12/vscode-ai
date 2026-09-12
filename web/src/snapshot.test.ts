import { describe, it, expect, vi } from 'vitest';
import { snapshotFileName, snapshotBackground, snapshotFilter, snapshotOptions } from './snapshot';

describe('snapshotFileName', () => {
  it('固定日期 → devflow-YYYYMMDD-HHmmss.png（各段补零）', () => {
    const d = new Date(2026, 8, 12, 9, 30, 5);
    expect(snapshotFileName(d)).toBe('devflow-20260912-093005.png');
  });

  it('月在个位时补零', () => {
    const d = new Date(2026, 0, 3, 0, 0, 0);
    expect(snapshotFileName(d)).toBe('devflow-20260103-000000.png');
  });
});

type FakeStyle = { getPropertyValue(name: string): string };
function styleReader(vars: Record<string, string>) {
  return (): FakeStyle => ({ getPropertyValue: (name: string) => vars[name] ?? '' });
}

describe('snapshotBackground', () => {
  it('优先取 --bg1', () => {
    const el = {} as HTMLElement;
    const get = styleReader({ '--bg1': '#282c34', '--bg0': '#111111' });
    expect(snapshotBackground(el, get)).toBe('#282c34');
  });

  it('--bg1 为空时回退 --bg0', () => {
    const el = {} as HTMLElement;
    const get = styleReader({ '--bg1': '  ', '--bg0': '#111111' });
    expect(snapshotBackground(el, get)).toBe('#111111');
  });

  it('都为空时回退兜底色 #1e1e1e', () => {
    const el = {} as HTMLElement;
    const get = styleReader({});
    expect(snapshotBackground(el, get)).toBe('#1e1e1e');
  });
});

describe('snapshotFilter', () => {
  it('带 data-snapshot-skip 的节点被跳过', () => {
    const node = { hasAttribute: (n: string) => n === 'data-snapshot-skip' } as unknown as HTMLElement;
    expect(snapshotFilter(node)).toBe(false);
  });

  it('普通节点保留', () => {
    const node = { hasAttribute: () => false } as unknown as HTMLElement;
    expect(snapshotFilter(node)).toBe(true);
  });

  it('无 hasAttribute 的对象也保留（不抛错）', () => {
    expect(snapshotFilter({} as unknown as HTMLElement)).toBe(true);
  });
});

describe('snapshotOptions', () => {
  it('组合 cacheBust / pixelRatio / backgroundColor / filter', () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (n: string) => (n === '--bg1' ? '#abcdef' : '') }));
    try {
      const o = snapshotOptions({} as HTMLElement, 2);
      expect(o).toMatchObject({ cacheBust: true, pixelRatio: 2, backgroundColor: '#abcdef' });
      expect(typeof o.filter).toBe('function');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
