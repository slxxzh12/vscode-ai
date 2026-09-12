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

export interface SnapshotResult {
  file: string;
  rel: string;
  dir: string;
  uploaded: boolean;
  reason: string;
}

export interface UploadInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface UploadDeps {
  fetch: (url: string, init: UploadInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
}

export async function uploadSnapshot(
  dataUrl: string,
  deps: UploadDeps = { fetch: (url, init) => fetch(url, init) },
): Promise<SnapshotResult> {
  const res = await deps.fetch('/api/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  });
  const data = await res.json().catch(() => ({} as { ok?: boolean; file?: string; rel?: string; dir?: string; uploaded?: boolean; reason?: string; error?: string; message?: string }));
  if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return {
    file: data.file || '',
    rel: data.rel || '',
    dir: data.dir || '',
    uploaded: !!data.uploaded,
    reason: data.reason || '',
  };
}
