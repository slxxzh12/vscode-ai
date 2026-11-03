import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escapeLang(s) {
  return String(s).replace(/[^a-zA-Z0-9-_+.#]/g, '');
}

function highlightCode(code, lang) {
  if (!lang) return '';
  try {
    if (!hljs.getLanguage(lang)) return '';
    return `<pre class="hljs"><code class="hljs language-${escapeLang(lang)}">${hljs.highlight(code, { language: lang }).value}</code></pre>`;
  } catch {
    return '';
  }
}

const TABLE_WIDTH_COMMENT = /^\s*<!--\s*(?:df-table\s+width\s*=|table-width\s*:)\s*([^>]+?)\s*-->\s*$/i;
const TABLE_WIDTH_VALUE = /^(?:\d+(?:\.\d+)?(?:px|%|em|rem|vw|vh|ch|pt|cm|mm|in)|auto|fit-content|max-content|min-content)$/i;
const IMAGE_SIZE_ATTRS = /(?:^|[\s,;])(width|height)\s*=\s*([0-9]+(?:\.[0-9]+)?(?:px|%)?)/gi;

function parseImageSize(text) {
  const out = {};
  IMAGE_SIZE_ATTRS.lastIndex = 0;
  let m;
  while ((m = IMAGE_SIZE_ATTRS.exec(String(text || '')))) {
    out[m[1].toLowerCase()] = m[2].replace(/px$/i, '');
  }
  return Object.keys(out).length ? out : null;
}

export function createMarkdown(opts = {}) {
  const md = new MarkdownIt({ html: opts.html === true, linkify: true, highlight: highlightCode });
  md.core.ruler.after('inline', 'df_image_size', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !Array.isArray(token.children)) continue;
      const next = [];
      for (let i = 0; i < token.children.length; i++) {
        const child = token.children[i];
        next.push(child);
        if (child.type !== 'image') continue;
        const tail = token.children[i + 1];
        if (!tail || tail.type !== 'text') continue;
        const m = /^\s*\{([^}]*)\}\s*/.exec(tail.content);
        if (!m) continue;
        const attrs = parseImageSize(m[1]);
        if (!attrs) continue;
        for (const [k, v] of Object.entries(attrs)) child.attrSet(k, v);
        tail.content = tail.content.slice(m[0].length);
        if (!tail.content) i += 1;
      }
      token.children = next;
    }
  });
  md.core.ruler.after('block', 'df_table_width', (state) => {
    const out = [];
    let pending = null;
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type === 'html_block') {
        const m = TABLE_WIDTH_COMMENT.exec(token.content);
        if (m && TABLE_WIDTH_VALUE.test(m[1].trim())) {
          pending = m[1].trim();
          continue;
        }
        pending = null;
        out.push(token);
        continue;
      }
      if (token.type === 'paragraph_open') {
        const inline = state.tokens[i + 1];
        const close = state.tokens[i + 2];
        if (inline && inline.type === 'inline' && close && close.type === 'paragraph_close') {
          const m = TABLE_WIDTH_COMMENT.exec(inline.content);
          if (m && TABLE_WIDTH_VALUE.test(m[1].trim())) {
            pending = m[1].trim();
            i += 2;
            continue;
          }
        }
      }
      if (token.type === 'table_open') {
        if (pending) token.attrSet('data-md-table-width', pending);
        pending = null;
        out.push(token);
        continue;
      }
      pending = null;
      out.push(token);
    }
    state.tokens = out;
  });
  // ԭʼ���񵥶����ǣ���ʽֻ������ Markdown ���񣬲�Ӱ�� Element Plus �����ڲ��� <table>
  const defaultTableOpen = md.renderer.rules.table_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrJoin('class', 'md-table');
    const width = tokens[idx].attrGet('data-md-table-width');
    if (width) tokens[idx].attrJoin('style', `width:${width};max-width:100%`);
    return defaultTableOpen(tokens, idx, options, env, self);
  };
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const parts = (token.info || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (parts[0] === 'mermaid-data') {
      return `<pre class="mermaid-data" data-processed="false">${escapeHtml(token.content)}</pre>\n`;
    }
    if (parts[0] === 'mermaid') {
      const side = parts.includes('row') ? ' mermaid-side' : '';
      return `<pre class="mermaid${side}" data-processed="false">${escapeHtml(token.content)}</pre>\n`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };
  return md;
}

export function isMarkdownFile(name) {
  const s = String(name || '');
  const i = s.lastIndexOf('.');
  if (i <= 0) return false;
  const ext = s.slice(i + 1).toLowerCase();
  return ext === 'md' || ext === 'markdown';
}

export const markdown = createMarkdown();
export const markdownHtml = createMarkdown({ html: true });

export function renderMarkdownHtml(text) {
  return markdown.render(String(text || ''));
}

export function renderMarkdownRawHtml(text) {
  return markdownHtml.render(String(text || ''));
}
