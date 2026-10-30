export interface PptLabels {
  open?: string;
  close?: string;
  prev?: string;
  next?: string;
}

export interface PptOptions {
  document?: Document;
  mount?: HTMLElement;
  filename?: string | (() => string);
  slideCount: () => number;
  slideTitle?: (index: number) => string;
  renderSlide: (index: number) => string | Promise<string>;
  enhance?: (body: HTMLElement) => Promise<unknown> | unknown;
  dispose?: (body: HTMLElement) => void;
  renderError?: (error: unknown) => string;
  labels?: PptLabels;
  showOpenButton?: boolean;
  onOpen?: () => void;
  onClose?: (restore: boolean) => void;
}

export interface PptPresenter {
  element: HTMLElement;
  isOpen: () => boolean;
  open: (startIndex?: number) => void;
  close: (restore?: boolean) => void;
  toggle: (startIndex?: number) => void;
  next: () => void;
  prev: () => void;
  refresh: () => void;
  destroy: () => void;
}

export function createPptPresenter(options: PptOptions): PptPresenter;
