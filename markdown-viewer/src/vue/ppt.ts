import { createPptPresenter, type PptPresenter } from '../core/markdown-ppt.js';
import { exportPptx, pptFileName } from '../core/markdown-ppt-export.js';
import { splitMarkdownSlides } from '../core/markdown-slides.js';
import { renderMarkdown } from '../core/render';
import type { MarkdownLocale, MarkdownMessages } from '../core/i18n';
import { enhanceElementMarkdown, disposeElementMarkdown } from './enhance';

export interface PptControllerOptions {
  content: string;
  title: string;
  locale: MarkdownLocale;
  messages: MarkdownMessages;
  theme: 'dark' | 'light';
  readAsset?: (rel: string) => Promise<string>;
  onError?: (e: unknown) => void;
}

export function createPptController(options: PptControllerOptions): PptPresenter | null {
  const slides = splitMarkdownSlides(options.content).map((s) => ({
    title: s.title,
    html: renderMarkdown(s.content, { html: true, sanitize: true }),
  }));
  if (!slides.length) return null;

  const enhance = (body: HTMLElement) =>
    enhanceElementMarkdown(body, {
      locale: options.locale,
      messages: options.messages,
      theme: options.theme,
      readAsset: options.readAsset,
    });

  const ppt = createPptPresenter({
    showOpenButton: true,
    filename: options.title,
    slideCount: () => slides.length,
    slideTitle: (i) => slides[i]?.title || '',
    renderSlide: (i) => slides[i]?.html || '',
    enhance,
    dispose: (body) => disposeElementMarkdown(body),
    labels: {
      open: options.messages['ppt.open'],
      close: options.messages['ppt.close'],
      prev: `‹ ${options.messages['ppt.prev']}`,
      next: `${options.messages['ppt.next']} ›`,
      hide: options.messages['ppt.hide_nav'],
      export: options.messages['ppt.export'],
      exporting: options.messages['ppt.exporting'],
    },
    onExport: async (progress: (done: number, total: number) => void) => {
      const [htmlToImageMod, pptxMod] = await Promise.all([
        import('html-to-image'),
        import('pptxgenjs'),
      ]);
      const htmlToImage = ((htmlToImageMod as { default?: unknown }).default || htmlToImageMod) as {
        toPng: (el: HTMLElement, opts: Record<string, unknown>) => Promise<string>;
      };
      const PptxGenJS = ((pptxMod as { default?: unknown }).default || pptxMod) as new () => unknown;
      const el = ppt.captureEl();
      const css = getComputedStyle(el);
      const bg = (css.getPropertyValue('--mdv-bg') || css.getPropertyValue('--bg3') || '#1e1e1e').trim();
      await exportPptx({
        controller: ppt,
        capture: (target) =>
          htmlToImage
            .toPng(target, {
              cacheBust: true,
              includeQueryParams: true,
              pixelRatio: window.devicePixelRatio || 1,
              width: target.clientWidth,
              height: target.clientHeight,
              style: { overflow: 'hidden' },
              backgroundColor: bg,
            })
            .then((dataUrl) => ({ dataUrl, width: target.clientWidth, height: target.clientHeight })),
        createDeck: () => new PptxGenJS(),
        filename: pptFileName(options.title),
        background: bg,
        onProgress: progress,
        isCancelled: () => !ppt.isOpen(),
      });
    },
    onExportError: options.onError,
    renderError: (e) => `<p class="note err">${String((e && (e as Error).message) || e)}</p>`,
  });
  return ppt;
}
