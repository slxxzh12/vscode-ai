import { createMarkdown } from './markdown.js';
import { extractStyleBlocks, nextScopeId, renderStyleBlocks, type MarkdownStyleBlock } from './markdown-css.js';
import { sanitizeHtml, sanitizeInlineStyles } from './sanitize';

export interface RenderOptions {
  html?: boolean;
  sanitize?: boolean;
  assetSrc?: (rel: string, suffix: string) => string | null;
  extraStyleBlocks?: MarkdownStyleBlock[];
}

const md = createMarkdown();
const mdHtml = createMarkdown({ html: true });

function splitUrl(raw: string): { rel: string; suffix: string } | null {
  if (/^(https?:|data:|blob:|mailto:|tel:)/i.test(raw)) return null;
  if (raw.startsWith('#') || raw.startsWith('/')) return null;
  const qi = raw.search(/[?#]/);
  const before = qi < 0 ? raw : raw.slice(0, qi);
  if (!before) return null;
  return { rel: before, suffix: qi < 0 ? '' : raw.slice(qi) };
}

function rewrite(root: ParentNode, assetSrc?: RenderOptions['assetSrc']): void {
  if (!assetSrc) return;
  for (const img of Array.from(root.querySelectorAll('img[src]'))) {
    const hit = splitUrl(img.getAttribute('src') || '');
    if (!hit) continue;
    const next = assetSrc(hit.rel, hit.suffix);
    if (next) img.setAttribute('src', next);
  }
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const hit = splitUrl(a.getAttribute('href') || '');
    if (!hit) continue;
    a.setAttribute('data-md-link', hit.rel);
    const next = assetSrc(hit.rel, hit.suffix);
    if (!next) continue;
    a.setAttribute('href', next);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  }
}

export function renderMarkdown(text: string, options: RenderOptions = {}): string {
  if (options.html === false) return md.render(text);
  const { markdown, blocks } = extractStyleBlocks(text);
  const raw = mdHtml.render(markdown);
  const wrapped = `<div data-md-html-root>${raw}</div>`;
  const clean = options.sanitize === false ? wrapped : sanitizeHtml(wrapped);
  if (typeof document === 'undefined') return clean;

  const host = document.createElement('div');
  host.innerHTML = clean;
  const root = host.querySelector('[data-md-html-root]') || host;
  sanitizeInlineStyles(root);
  rewrite(root, options.assetSrc);

  const all = blocks.concat(options.extraStyleBlocks || []).map((b) => ({ ...b, page: false }));
  if (!all.length) return root.innerHTML;
  const scope = nextScopeId();
  const tags = renderStyleBlocks(all, `[data-md-css="${scope}"]`);
  return `<div data-md-css="${scope}">${tags.content}${root.innerHTML}</div>`;
}
