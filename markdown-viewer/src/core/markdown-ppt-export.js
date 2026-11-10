// Markdown PPT 导出编排：与具体截图/PPT 库解耦，Web 与静态页共用。
const EXPORT_LABEL = 'Export PPT';

export function pptFileName(name) {
  const base = String(name || '').replace(/\.(md|markdown)$/i, '').trim();
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '-') || 'slides';
  return `${cleaned}.pptx`;
}

export function containRect(imageWidth, imageHeight, boxWidth, boxHeight) {
  const iw = Number(imageWidth) > 0 ? Number(imageWidth) : 1;
  const ih = Number(imageHeight) > 0 ? Number(imageHeight) : 1;
  const scale = Math.min(boxWidth / iw, boxHeight / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: (boxWidth - w) / 2, y: (boxHeight - h) / 2, w, h };
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') { setTimeout(resolve, 0); return; }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function defaultWaitForPaint(doc) {
  await nextFrame();
  if (doc && doc.fonts && typeof doc.fonts.ready?.then === 'function') {
    try { await doc.fonts.ready; } catch { /* ignore font loading failures */ }
  }
  await nextFrame();
}

function normalizeBackground(color) {
  const value = String(color || '').trim();
  return value.startsWith('#') ? value.slice(1) : value;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * @param {{
 *   controller: {
 *     size: () => number,
 *     index: () => number,
 *     renderAt: (i: number) => Promise<void>,
 *     captureEl: () => HTMLElement,
 *     isOpen?: () => boolean,
 *   },
 *   capture: (el: HTMLElement) => Promise<{ dataUrl: string, width: number, height: number }>,
 *   createDeck: () => any,
 *   filename: string,
 *   background?: string,
 *   document?: Document,
 *   waitForPaint?: () => Promise<void> | void,
 *   saveBlob?: (blob: Blob, filename: string) => void,
 *   onProgress?: (done: number, total: number) => void,
 *   isCancelled?: () => boolean,
 * }} options
 */
export async function exportPptx(options) {
  const opts = options || {};
  const controller = opts.controller;
  const total = Number(controller && controller.size && controller.size());
  if (!controller || !Number.isFinite(total) || total <= 0) {
    throw new Error('no slides to export');
  }

  const original = Number(controller.index && controller.index()) || 0;
  const deck = opts.createDeck();
  const filename = pptFileName(opts.filename);
  const background = normalizeBackground(opts.background);
  const slideW = 10;
  const slideH = 5.625;
  const paint = opts.waitForPaint || (() => defaultWaitForPaint(opts.document || (typeof document !== 'undefined' ? document : null)));
  const save = opts.saveBlob || downloadBlob;

  try {
    for (let i = 0; i < total; i++) {
      if (opts.isCancelled && opts.isCancelled()) throw new Error('export cancelled');
      await controller.renderAt(i);
      await paint();
      const shot = await opts.capture(controller.captureEl());
      const rect = containRect(shot.width, shot.height, slideW, slideH);
      const slide = deck.addSlide();
      if (background) slide.background = { color: background };
      slide.addImage({ data: shot.dataUrl, ...rect });
      if (opts.onProgress) opts.onProgress(i + 1, total);
    }
    if (opts.isCancelled && opts.isCancelled()) throw new Error('export cancelled');
    const blob = await deck.write({ outputType: 'blob' });
    save(blob, filename);
    return { filename, total };
  } finally {
    try { await controller.renderAt(original); } catch { /* ignore restore failure */ }
  }
}

export { EXPORT_LABEL };
