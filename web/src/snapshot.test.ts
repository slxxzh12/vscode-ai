import { describe, it, expect, vi } from 'vitest';
import {
  snapshotBackground,
  snapshotFilter,
  snapshotOptions,
  captureToPngDataUrl,
  pptBackground,
  captureViewportPng,
} from './snapshot';

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
      expect(o).toMatchObject({ cacheBust: true, includeQueryParams: true, pixelRatio: 2, backgroundColor: '#abcdef' });
      expect(typeof o.filter).toBe('function');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('captureToPngDataUrl', () => {
  it('返回 toPng 结果，并带上背景色等选项', async () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#010203' }));
    try {
      const el = {} as HTMLElement;
      const url = await captureToPngDataUrl(el, {
        toPng: async (target, options) => {
          expect(target).toBe(el);
          expect(options.backgroundColor).toBe('#010203');
          return 'data:image/png;base64,ZZ';
        },
      });
      expect(url).toBe('data:image/png;base64,ZZ');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('pptBackground', () => {
  it('优先取 --bg3，再回退 --bg1/--bg0/兜底色', () => {
    const el = {} as HTMLElement;
    expect(pptBackground(el, styleReader({ '--bg3': '#0e1116', '--bg1': '#111' }))).toBe('#0e1116');
    expect(pptBackground(el, styleReader({ '--bg1': '#111' }))).toBe('#111');
    expect(pptBackground(el, styleReader({}))).toBe('#1e1e1e');
  });
});

describe('captureViewportPng', () => {
  it('按 clientWidth/clientHeight 截可见区域并返回尺寸', async () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#010203' }));
    try {
      const el = { clientWidth: 800, clientHeight: 450 } as HTMLElement;
      const out = await captureViewportPng(el, {
        toPng: async (target, options) => {
          expect(target).toBe(el);
          expect(options.width).toBe(800);
          expect(options.height).toBe(450);
          expect(options.style).toEqual({ overflow: 'hidden' });
          return 'data:image/png;base64,VP';
        },
      });
      expect(out).toEqual({ dataUrl: 'data:image/png;base64,VP', width: 800, height: 450 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
