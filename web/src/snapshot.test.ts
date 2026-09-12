import { describe, it, expect, vi } from 'vitest';
import { snapshotFileName, snapshotBackground, snapshotFilter, snapshotOptions, captureToPng } from './snapshot';

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

describe('captureToPng', () => {
  it('调用 toPng 并把结果交给 download（文件名符合规范）', async () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#010203' }));
    const calls: { dataUrl: string; filename: string }[] = [];
    let passedEl: HTMLElement | null = null;
    let passedRatio = -1;
    try {
      await captureToPng({} as HTMLElement, {
        toPng: async (target, options) => {
          passedEl = target;
          passedRatio = options.pixelRatio;
          expect(options.backgroundColor).toBe('#010203');
          return 'data:image/png;base64,AAAA';
        },
        download: (dataUrl, filename) => { calls.push({ dataUrl, filename }); },
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(passedEl).not.toBeNull();
    expect(passedRatio).toBeGreaterThanOrEqual(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].dataUrl).toBe('data:image/png;base64,AAAA');
    expect(calls[0].filename).toMatch(/^devflow-\d{8}-\d{6}\.png$/);
  });

  it('toPng 抛错时向上抛出', async () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#000' }));
    try {
      await expect(captureToPng({} as HTMLElement, {
        toPng: async () => { throw new Error('boom'); },
        download: () => { /* not reached */ },
      })).rejects.toThrow('boom');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
