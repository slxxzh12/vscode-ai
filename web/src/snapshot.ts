import { toPng } from 'html-to-image';

export function snapshotFileName(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ymd = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const hms = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `devflow-${ymd}-${hms}.png`;
}

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

export interface SnapshotDeps {
  toPng: (el: HTMLElement, options: SnapshotOptions) => Promise<string>;
  download: (dataUrl: string, filename: string) => void;
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function captureToPng(
  el: HTMLElement,
  deps: SnapshotDeps = { toPng, download: downloadDataUrl },
): Promise<void> {
  const dataUrl = await deps.toPng(el, snapshotOptions(el));
  deps.download(dataUrl, snapshotFileName());
}
