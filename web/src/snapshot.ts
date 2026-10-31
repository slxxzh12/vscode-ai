import { toPng } from 'html-to-image';

export type StyleReader = (el: HTMLElement) => { getPropertyValue(name: string): string };

export function snapshotBackground(
  el: HTMLElement,
  getStyle: StyleReader = (e) => getComputedStyle(e),
): string {
  const s = getStyle(el);
  return (s.getPropertyValue('--bg1') || '').trim()
    || (s.getPropertyValue('--bg0') || '').trim()
    || '#1e1e1e';
}

export interface SnapshotOptions {
  cacheBust: boolean;
  pixelRatio: number;
  backgroundColor: string;
  filter: (node: HTMLElement) => boolean;
}

export function snapshotFilter(node: HTMLElement): boolean {
  return !(node && typeof node.hasAttribute === 'function' && node.hasAttribute('data-snapshot-skip'));
}

export function snapshotOptions(
  el: HTMLElement,
  pixelRatio: number = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1,
): SnapshotOptions {
  return {
    cacheBust: true,
    pixelRatio,
    backgroundColor: snapshotBackground(el),
    filter: snapshotFilter,
  };
}

export interface CaptureDeps {
  toPng: (el: HTMLElement, options: SnapshotOptions) => Promise<string>;
}

export async function captureToPngDataUrl(
  el: HTMLElement,
  deps: CaptureDeps = { toPng },
): Promise<string> {
  return deps.toPng(el, snapshotOptions(el));
}
