// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { exportPptx, pptFileName, containRect } from '@devflow/shared/markdown-ppt-export';

function makeDeck() {
  const slides: any[] = [];
  return {
    slides,
    addSlide() {
      const slide = {
        background: null as any,
        images: [] as any[],
        addImage(img: any) { this.images.push(img); },
      };
      slides.push(slide);
      return slide;
    },
    async write() { return new Blob(['pptx']); },
  };
}

function makeController(total = 3, start = 1) {
  const rendered: number[] = [];
  let index = start;
  return {
    rendered,
    size: () => total,
    index: () => index,
    renderAt: async (i: number) => { index = i; rendered.push(i); },
    captureEl: () => ({}) as HTMLElement,
    isOpen: () => true,
  };
}

describe('containRect', () => {
  it('宽图上下留白', () => {
    const r = containRect(1600, 900, 10, 5.625);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(0);
    expect(r.w).toBeCloseTo(10);
    expect(r.h).toBeCloseTo(5.625);
  });

  it('高图左右留白', () => {
    const r = containRect(900, 1600, 10, 5.625);
    expect(r.h).toBeCloseTo(5.625);
    expect(r.w).toBeCloseTo(3.1640625);
    expect(r.x).toBeCloseTo((10 - 3.1640625) / 2);
    expect(r.y).toBeCloseTo(0);
  });
});

describe('pptFileName', () => {
  it('去掉 md 扩展名并清理非法字符', () => {
    expect(pptFileName('a/b:c?.md')).toBe('a-b-c-.pptx');
    expect(pptFileName('notes.markdown')).toBe('notes.pptx');
    expect(pptFileName('')).toBe('slides.pptx');
  });
});

describe('exportPptx', () => {
  it('按顺序导出全部页、上报进度、恢复原页', async () => {
    const controller = makeController(3, 1);
    const deck = makeDeck();
    const progress: Array<[number, number]> = [];
    let saved: { blob: Blob; name: string } | null = null;

    const out = await exportPptx({
      controller,
      capture: async () => ({ dataUrl: 'data:image/png;base64,AA', width: 1600, height: 900 }),
      createDeck: () => deck,
      filename: 'demo.md',
      background: '#0e1116',
      waitForPaint: async () => {},
      saveBlob: (blob: Blob, name: string) => { saved = { blob, name }; },
      onProgress: (done: number, total: number) => progress.push([done, total]),
    });

    expect(controller.rendered).toEqual([0, 1, 2, 1]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(deck.slides).toHaveLength(3);
    expect(deck.slides[0].background).toEqual({ color: '0e1116' });
    expect(deck.slides[0].images[0]).toMatchObject({ w: 10, h: 5.625 });
    expect(saved!.name).toBe('demo.pptx');
    expect(out).toEqual({ filename: 'demo.pptx', total: 3 });
  });

  it('截图失败时仍恢复原页并抛错', async () => {
    const controller = makeController(2, 1);
    const deck = makeDeck();
    let saved = false;
    await expect(exportPptx({
      controller,
      capture: async () => { throw new Error('canvas tainted'); },
      createDeck: () => deck,
      filename: 'x.md',
      waitForPaint: async () => {},
      saveBlob: () => { saved = true; },
    })).rejects.toThrow('canvas tainted');
    expect(controller.rendered).toEqual([0, 1]);
    expect(saved).toBe(false);
  });

  it('没有页时直接抛错', async () => {
    await expect(exportPptx({
      controller: makeController(0),
      capture: async () => ({ dataUrl: '', width: 1, height: 1 }),
      createDeck: () => makeDeck(),
      filename: 'x.md',
      waitForPaint: async () => {},
    })).rejects.toThrow('no slides to export');
  });
});
