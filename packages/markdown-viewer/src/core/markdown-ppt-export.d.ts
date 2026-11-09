export interface PptExportController {
  size: () => number;
  index: () => number;
  renderAt: (index: number) => Promise<void>;
  captureEl: () => HTMLElement;
  isOpen?: () => boolean;
}

export interface PptExportCapture {
  dataUrl: string;
  width: number;
  height: number;
}

export interface PptExportOptions {
  controller: PptExportController;
  capture: (el: HTMLElement) => Promise<PptExportCapture>;
  createDeck: () => any;
  filename: string;
  background?: string;
  document?: Document;
  waitForPaint?: () => Promise<void> | void;
  saveBlob?: (blob: Blob, filename: string) => void;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}

export function pptFileName(name: string): string;
export function containRect(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number): { x: number; y: number; w: number; h: number };
export function exportPptx(options: PptExportOptions): Promise<{ filename: string; total: number }>;
export const EXPORT_LABEL: string;
