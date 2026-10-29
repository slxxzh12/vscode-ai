import { createMarkdown, escapeHtml as escHtml, isMarkdownFile } from '@devflow/shared/markdown';
import { t } from './i18n';

export interface MarkdownOptions {
  projectId: string;
  fileDir: string;
  assetMap?: Map<string, string>;
}

function buildRaw(projectId: string, rel: string, suffix: string): string {
  return `/api/raw?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(rel)}${suffix}`;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function resolveTarget(raw: string, dir: string): { rel: string; suffix: string } | null {
  if (/^(https?:|data:|mailto:)/i.test(raw)) return null;
  if (raw.startsWith('#')) return null;
  const qi = raw.search(/[?#]/);
  const before = qi < 0 ? raw : raw.slice(0, qi);
  const suffix = qi < 0 ? '' : raw.slice(qi);
  if (!before) return null;
  const segs = dir.split('/').filter(Boolean);
  for (const part of safeDecode(before).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  return { rel: segs.join('/'), suffix };
}

const md = createMarkdown();

function rewriteTokenAttrs(tokens: unknown[], opt: MarkdownOptions): void {
  for (const t of tokens as Array<{ type: string; children?: unknown[]; attrGet(n: string): string | null; attrSet(n: string, v: string): void }>) {
    if (t.type === 'inline' && t.children) rewriteTokenAttrs(t.children, opt);
    if (t.type === 'image') {
      const src = t.attrGet('src') || '';
      const r = resolveTarget(src, opt.fileDir);
      if (r) {
        const mapped = opt.assetMap?.get(r.rel);
        if (mapped) t.attrSet('src', mapped);
        else if (opt.projectId) t.attrSet('src', buildRaw(opt.projectId, r.rel, r.suffix));
      }
    } else if (t.type === 'link_open') {
      const href = t.attrGet('href') || '';
      const r = resolveTarget(href, opt.fileDir);
      if (r) {
        t.attrSet('data-md-link', r.rel);
        const mapped = opt.assetMap?.get(r.rel);
        if (mapped) {
          t.attrSet('href', mapped);
          t.attrSet('target', '_blank');
          t.attrSet('rel', 'noopener');
        } else if (opt.projectId) {
          t.attrSet('href', buildRaw(opt.projectId, r.rel, r.suffix));
          t.attrSet('target', '_blank');
          t.attrSet('rel', 'noopener');
        }
      }
    }
  }
}

md.core.ruler.push('rewrite-assets', (state) => {
  const opt = (state.env && (state.env as { opt?: MarkdownOptions }).opt) || undefined;
  if (opt) rewriteTokenAttrs(state.tokens, opt);
});

// 抽取 markdown 里的相对资源引用（图片/链接），供本地来源预解析成 blob URL。
export function collectAssetRefs(mdText: string, fileDir: string): { rel: string; suffix: string }[] {
  const found = new Map<string, { rel: string; suffix: string }>();
  const walk = (tokens: unknown[]): void => {
    for (const tok of tokens as Array<{ type: string; children?: unknown[]; attrGet(n: string): string | null }>) {
      if (tok.type === 'inline' && tok.children) { walk(tok.children); continue; }
      if (tok.type !== 'image' && tok.type !== 'link_open') continue;
      const raw = (tok.type === 'image' ? tok.attrGet('src') : tok.attrGet('href')) || '';
      const r = resolveTarget(raw, fileDir);
      if (r) found.set(r.rel, r);
    }
  };
  walk(md.parse(mdText, {}));
  return [...found.values()];
}

export function renderMarkdown(mdText: string, opt: MarkdownOptions): string {
  return md.render(mdText, { opt });
}

// 渲染远端 Markdown（如公告）：不做相对路径改写，外链新标签打开
export function renderRemoteMarkdown(mdText: string): string {
  return md.render(mdText).replace(/<a href="(https?:[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"');
}

export { isMarkdownFile };

const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: #fff; color: #1f2937; font-family: ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; line-height: 1.7; }
.md-body { word-wrap: break-word; }
.md-body > :first-child { margin-top: 0; }
.md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6 { margin: 1.2em 0 0.6em; line-height: 1.3; font-weight: 600; color: #111827; }
.md-body h1 { font-size: 1.7em; padding-bottom: 0.3em; border-bottom: 1px solid #e5e7eb; }
.md-body h2 { font-size: 1.4em; padding-bottom: 0.25em; border-bottom: 1px solid #e5e7eb; }
.md-body h3 { font-size: 1.2em; }
.md-body h4 { font-size: 1.05em; }
.md-body p { margin: 0.7em 0; }
.md-body a { color: #2563eb; text-decoration: none; }
.md-body ul, .md-body ol { margin: 0.7em 0; padding-left: 1.8em; }
.md-body li { margin: 0.25em 0; }
.md-body blockquote { margin: 0.8em 0; padding: 0.1em 1em; color: #4b5563; border-left: 3px solid #2563eb; background: #f6f8fa; border-radius: 0 6px 6px 0; }
.md-body hr { margin: 1.4em 0; border: none; border-top: 1px solid #e5e7eb; }
.md-body table { border-collapse: collapse; margin: 0.9em 0; display: block; max-width: 100%; overflow: auto; }
.md-body th, .md-body td { border: 1px solid #d7dce3; padding: 6px 12px; }
.md-body th { background: #f0f2f5; font-weight: 600; }
.md-body tr:nth-child(2n) td { background: #f6f8fa; }
.md-body code { font-family: ui-monospace, Consolas, monospace; font-size: 0.88em; background: #f0f2f5; padding: 0.15em 0.4em; border-radius: 4px; color: #0550ae; }
.md-body pre { background: #fafbfc; border: 1px solid #e5e7eb; border-radius: 6px; overflow: auto; margin: 0.9em 0; }
.md-body pre code { background: transparent; padding: 0; color: #1f2937; font-size: 12.5px; line-height: 1.55; display: block; }
.md-body pre.hljs { padding: 12px 14px; }
.md-body code.hljs { padding: 0; }
.md-body img { max-width: 100%; border-radius: 6px; }
.md-body .mermaid { display: flex; justify-content: center; background: #fafbfc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; margin: 0.9em 0; }
.md-body .mermaid svg { max-width: 100%; }
.md-body .mermaid-err { color: #b91c1c; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; padding: 8px 12px; }
.hljs { background: transparent; color: inherit; }
.md-body .hljs-keyword, .md-body .hljs-selector-tag, .md-body .hljs-name { color: #cf222e; }
.md-body .hljs-string, .md-body .hljs-regexp, .md-body .hljs-addition { color: #0a3069; }
.md-body .hljs-comment, .md-body .hljs-quote { color: #6e7781; font-style: italic; }
.md-body .hljs-number, .md-body .hljs-literal { color: #0550ae; }
.md-body .hljs-title, .md-body .hljs-function .hljs-title, .md-body .hljs-title.class_ { color: #8250df; }
.md-body .hljs-attr, .md-body .hljs-attribute, .md-body .hljs-variable, .md-body .hljs-template-variable { color: #953800; }
.md-body .hljs-built_in, .md-body .hljs-type, .md-body .hljs-symbol, .md-body .hljs-bullet { color: #0550ae; }
pre, table, blockquote, img, .mermaid { break-inside: avoid; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
`;

function buildPrintDoc(html: string, title: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title><style>${PRINT_CSS}</style></head><body><article class="md-body">${html}</article></body></html>`;
}

// 将已渲染的 markdown HTML 送入新窗口并调起打印（仅打印文档内容，无应用边框）
export function printMarkdown(html: string, title: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.open();
  win.document.write(buildPrintDoc(html, title));
  win.document.close();
  win.focus();

  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    try { win.focus(); win.print(); } catch { /* ignore */ }
  };
  const imgs = Array.from(win.document.images);
  if (imgs.length === 0) { fire(); return; }
  let remaining = imgs.filter((img) => !img.complete).length;
  if (remaining === 0) { fire(); return; }
  for (const img of imgs) {
    if (img.complete) continue;
    const dec = () => { remaining--; if (remaining <= 0) fire(); };
    img.addEventListener('load', dec, { once: true });
    img.addEventListener('error', dec, { once: true });
  }
  setTimeout(fire, 8000);
}

// ```mermaid row 标记的连续图块自动并排（外层 flex 容器）
export function groupMermaidSides(container: HTMLElement): void {
  for (const pre of Array.from(container.querySelectorAll<HTMLElement>('pre.mermaid.mermaid-side'))) {
    if (pre.closest('.mermaid-row')) continue;
    const group: HTMLElement[] = [pre];
    let next = pre.nextElementSibling;
    while (next && next.matches('pre.mermaid.mermaid-side')) {
      group.push(next as HTMLElement);
      next = next.nextElementSibling;
    }
    if (group.length < 2) continue;
    const wrap = document.createElement('div');
    wrap.className = 'mermaid-row';
    pre.before(wrap);
    for (const item of group) wrap.appendChild(item);
  }
}

export async function renderMermaid(container: HTMLElement): Promise<void> {
  groupMermaidSides(container);
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed="true"])'));
  if (nodes.length === 0) return;
  const mod = await import('mermaid');
  const mm = mod.default;
  mm.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
  let seq = 0;
  await Promise.all(nodes.map(async (pre) => {
    const code = pre.textContent || '';
    const id = `df-mm-${Date.now().toString(36)}-${seq++}`;
    try {
      const { svg } = await mm.render(id, code);
      const holder = document.getElementById(id);
      if (holder) holder.remove();
      pre.outerHTML = svg;
    } catch (e) {
      pre.innerHTML = `<div class="mermaid-err">${escHtml(t('markdown.mermaid_error', { msg: String((e as Error)?.message || e) }))}</div>`;
    }
  }));
}
