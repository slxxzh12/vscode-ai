export interface MermaidLike {
  initialize(options: { startOnLoad: boolean; securityLevel: string; theme: string }): void;
  render(id: string, code: string): Promise<{ svg: string }>;
}

export { enhanceCharts, parseMermaidChart } from './markdown-charts';
export type { ChartSpec, ChartHandle, EChartsLike } from './markdown-charts';
export { enhanceSimpleTables } from './markdown-table-sort';

export function groupMermaidSides(container: HTMLElement): void;
export function enhanceDataCharts(
  container: HTMLElement,
  options?: { readAsset?: (rel: string) => Promise<string>; dataErrorText?: (msg: string) => string },
): Promise<void>;
export function renderMermaidBlocks(
  container: HTMLElement,
  mermaid: MermaidLike | null | undefined,
  options?: { theme?: string; errorText?: (msg: string) => string },
): Promise<void>;

export interface EnhanceItem {
  host: HTMLElement;
  dispose(): void;
}

export interface EnhanceMarkdownOptions {
  echarts?: EChartsLike | null;
  loadEcharts?: () => EChartsLike | Promise<EChartsLike | null> | null;
  mermaid?: MermaidLike | null;
  loadMermaid?: () => MermaidLike | Promise<MermaidLike | null> | null;
  theme?: string;
  dark?: boolean;
  errorText?: (msg: string) => string;
  dataErrorText?: (msg: string) => string;
  readAsset?: (rel: string) => Promise<string>;
  enhanceTables?: (container: HTMLElement) => EnhanceItem[] | Promise<EnhanceItem[] | void> | void;
}

export function enhanceMarkdown(
  container: HTMLElement,
  options?: EnhanceMarkdownOptions,
): Promise<EnhanceItem[]>;
