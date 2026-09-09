import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

export interface MarkdownOptions {
  projectId: string;
  fileDir: string;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escLang(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_+.#]/g, '');
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

const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight(code: string, lang: string): string {
    if (!lang) return '';
    try {
      if (!hljs.getLanguage(lang)) return '';
      return `<pre class="hljs"><code class="hljs language-${escLang(lang)}">${hljs.highlight(code, { language: lang }).value}</code></pre>`;
    } catch {
      return '';
    }
  },
});

const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = (token.info || '').trim().split(/\s+/)[0].toLowerCase();
  if (info === 'mermaid') {
    return `<pre class="mermaid" data-processed="false">${escHtml(token.content)}</pre>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

function rewriteTokenAttrs(tokens: unknown[], opt: MarkdownOptions): void {
  for (const t of tokens as Array<{ type: string; children?: unknown[]; attrGet(n: string): string | null; attrSet(n: string, v: string): void }>) {
    if (t.type === 'inline' && t.children) rewriteTokenAttrs(t.children, opt);
    if (t.type === 'image') {
      const src = t.attrGet('src') || '';
      const r = resolveTarget(src, opt.fileDir);
      if (r) t.attrSet('src', buildRaw(opt.projectId, r.rel, r.suffix));
    } else if (t.type === 'link_open') {
      const href = t.attrGet('href') || '';
      const r = resolveTarget(href, opt.fileDir);
      if (r) {
        t.attrSet('href', buildRaw(opt.projectId, r.rel, r.suffix));
        t.attrSet('target', '_blank');
        t.attrSet('rel', 'noopener');
      }
    }
  }
}

md.core.ruler.push('rewrite-assets', (state) => {
  const opt = (state.env && (state.env as { opt?: MarkdownOptions }).opt) || undefined;
  if (opt) rewriteTokenAttrs(state.tokens, opt);
});

export function renderMarkdown(mdText: string, opt: MarkdownOptions): string {
  return md.render(mdText, { opt });
}

export function isMarkdownFile(name: string): boolean {
  const i = name.lastIndexOf('.');
  if (i <= 0) return false;
  const ext = name.slice(i + 1).toLowerCase();
  return ext === 'md' || ext === 'markdown';
}

export async function renderMermaid(container: HTMLElement): Promise<void> {
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
      pre.outerHTML = svg;
    } catch (e) {
      pre.innerHTML = `<div class="mermaid-err">Mermaid 渲染失败：${escHtml(String((e as Error)?.message || e))}</div>`;
    }
  }));
}
