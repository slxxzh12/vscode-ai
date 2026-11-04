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

const TABLE_DIRECTIVE = /^\s*<!--\s*(df-table|table-width)\b([^>]*)-->\s*$/i;
const TABLE_WIDTH_VALUE = /^(?:\d+(?:\.\d+)?(?:px|%|em|rem|vw|vh|ch|pt|cm|mm|in)|auto|fit-content|max-content|min-content)$/i;
const COLOR_PRESETS = {
  blue: '#1e40af',
  darkblue: '#172554',
  'dark-blue': '#172554',
  gray: '#4b5563',
  grey: '#4b5563',
  darkred: '#7f1d1d',
  'dark-red': '#7f1d1d',
  red: '#b91c1c',
  green: '#15803d',
  orange: '#c2410c',
  purple: '#6b21a8',
  black: '#111827',
  white: '#ffffff',
};
const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)|hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/i;
const IMAGE_SIZE_ATTRS = /(?:^|[\s,;])(width|height)\s*=\s*([0-9]+(?:\.[0-9]+)?(?:px|%)?)/gi;

function normalizeColor(value) {
  const s = String(value || '').trim().toLowerCase();
  if (COLOR_PRESETS[s]) return COLOR_PRESETS[s];
  if (COLOR_VALUE.test(s)) return s;
  return null;
}

function contrastColor(bg) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(bg || ''));
  if (!m) return '#ffffff';
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111827' : '#ffffff';
}

function parseTableDirective(text) {
  const m = TABLE_DIRECTIVE.exec(String(text || ''));
  if (!m) return null;
  if (m[1].toLowerCase() === 'table-width') {
    const wm = /^\s*[:=]\s*(\S+)\s*$/i.exec(m[2] || '');
    const width = wm && TABLE_WIDTH_VALUE.test(wm[1]) ? wm[1] : null;
    return width ? { width } : null;
  }
  const out = {};
  const re = /(?:^|\s)([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/gi;
  let am;
  while ((am = re.exec(m[2] || ''))) {
    const key = am[1].toLowerCase();
    const value = (am[3] ?? am[4] ?? am[5] ?? '').trim();
    if (!value) continue;
    if (key === 'width' && TABLE_WIDTH_VALUE.test(value)) out.width = value;
    else if (key === 'head-bg' || key === 'header-bg') {
      const color = normalizeColor(value);
      if (color) out.headBg = color;
    } else if (key === 'head-color' || key === 'header-color') {
      const color = normalizeColor(value);
      if (color) out.headColor = color;
    }
  }
  if (!out.width && !out.headBg && !out.headColor) return null;
  if (out.headBg && !out.headColor) out.headColor = contrastColor(out.headBg);
  return out;
}

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
  md.core.ruler.after('block', 'df_table_style', (state) => {
    const out = [];
    let pending = null;
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type === 'html_block') {
        const parsed = parseTableDirective(token.content);
        if (parsed) {
          pending = parsed;
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
          const parsed = parseTableDirective(inline.content);
          if (parsed) {
            pending = parsed;
            i += 2;
            continue;
          }
        }
      }
      if (token.type === 'table_open') {
        if (pending) {
          if (pending.width) token.attrSet('data-md-table-width', pending.width);
          if (pending.headBg) token.attrSet('data-md-table-head-bg', pending.headBg);
          if (pending.headColor) token.attrSet('data-md-table-head-color', pending.headColor);
        }
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
    const headBg = tokens[idx].attrGet('data-md-table-head-bg');
    const headColor = tokens[idx].attrGet('data-md-table-head-color');
    const styles = [];
    if (width) styles.push(`width:${width}`, 'max-width:100%');
    if (headBg) styles.push(`--md-table-head-bg:${headBg}`);
    if (headColor) styles.push(`--md-table-head-color:${headColor}`);
    if (styles.length) tokens[idx].attrJoin('style', styles.join(';'));
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
