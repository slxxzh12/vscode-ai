// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createPptPresenter } from '@devflow/shared/markdown-ppt';
import { exportPptx } from '@devflow/shared/markdown-ppt-export';

let ppt: ReturnType<typeof createPptPresenter> | null = null;

afterEach(() => { ppt?.destroy(); ppt = null; });

describe('PPT export content', () => {
  it('captures a different slide for each exported page', async () => {
    ppt = createPptPresenter({
      document: window.document,
      mount: document.body,
      showOpenButton: false,
      slideCount: () => 3,
      slideTitle: (i) => `S${i}`,
      renderSlide: async (i) => {
        await new Promise((r) => setTimeout(r, 5));
        return `<p>slide ${i}</p>`;
      },
      enhance: async () => {
        await new Promise((r) => setTimeout(r, 5));
      },
    });
    ppt.open(0);
    await flushPromises();

    const seen: string[] = [];
    const deck = {
      slides: [] as any[],
      addSlide() {
        const slide = { background: null, images: [] as any[], addImage(img: any) { this.images.push(img); } };
        this.slides.push(slide);
        return slide;
      },
      async write() { return new Blob(['pptx']); },
    };
    await exportPptx({
      controller: ppt,
      capture: async (el) => {
        seen.push((el.querySelector('.df-ppt-body') as HTMLElement)?.textContent || '');
        return { dataUrl: 'data:image/png;base64,AA', width: 1600, height: 900 };
      },
      createDeck: () => deck,
      filename: 'x.md',
      saveBlob: () => {},
    });

    expect(seen).toEqual(['slide 0', 'slide 1', 'slide 2']);
  });
});
