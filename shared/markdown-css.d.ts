export interface MarkdownStyleBlock {
  css: string;
  page: boolean;
}

export function sanitizeCss(css: string, opts?: { page?: boolean }): string;
export function sanitizeCssValue(value: string): string;
export function extractStyleBlocks(md: string): { markdown: string; blocks: MarkdownStyleBlock[] };
export function scopeCss(css: string, selector?: string): string;
export function renderStyleBlocks(
  blocks: MarkdownStyleBlock[],
  scopeSelector?: string,
): { content: string; page: string };
export function nextScopeId(prefix?: string): string;
