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
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = (token.info || '').trim().split(/\s+/)[0].toLowerCase();
    if (info === 'mermaid') {
      return `<pre class="mermaid" data-processed="false">${escapeHtml(token.content)}</pre>\n`;
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
