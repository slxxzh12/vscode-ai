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

export function createMarkdown() {
  const md = new MarkdownIt({ html: false, linkify: true, highlight: highlightCode });
  // 原始表格单独打标记：样式只作用于 Markdown 表格，不影响 Element Plus 表格内部的 <table>
  const defaultTableOpen = md.renderer.rules.table_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrJoin('class', 'md-table');
    return defaultTableOpen(tokens, idx, options, env, self);
  };
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const parts = (token.info || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
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

export function renderMarkdownHtml(text) {
  return markdown.render(String(text || ''));
}
