import { escapeHtml, isMarkdownFile, renderMarkdownRawHtml } from '@devflow/shared/markdown';
import { extractStyleBlocks, renderStyleBlocks } from '@devflow/shared/markdown-css';
import { splitMarkdownSlides } from '@devflow/shared/markdown-slides';
import { sanitizeMarkdownHtml } from './markdown-sanitize.js';
import { getLocale } from './i18n.js';

export { isMarkdownFile };

// 独立页面的主题变量来自 web/src/styles.css；浅色跟随系统偏好
export const PAGE_THEME_CSS = `
:root {
  color-scheme: dark;
  --bg0: #1e2227; --bg1: #181d24; --bg2: #141920; --bg3: #0e1116; --bg4: #222932; --bg5: #262c34;
  --bd: #2a323e; --tx: #d5dae1; --tx1: #e6e9ef; --tx2: #9aa4b2;
  --ac: #2f6feb; --ac2: #4c9aff; --errtx: #fca5a5;
  --hlk: #ff7b72; --hls: #a5d6ff; --hlc: #8b949e; --hln: #79c0ff;
  --hlt: #d2a8ff; --hla: #79c0ff; --hlb: #ffa657;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --bg0: #eef1f5; --bg1: #f4f6f9; --bg2: #eef1f5; --bg3: #fafbfc; --bg4: #f0f2f5; --bg5: #e3e7ec;
    --bd: #d7dce3; --tx: #1f2937; --tx1: #111827; --tx2: #4b5563;
    --ac: #2563eb; --ac2: #2563eb; --errtx: #b91c1c;
    --hlk: #cf222e; --hls: #0a3069; --hlc: #6e7781; --hln: #0550ae;
    --hlt: #8250df; --hla: #953800; --hlb: #0550ae;
  }
}
/* 与 Web 端主题开关保持一致：同源静态页优先读 localStorage 的 devflow-theme */
:root[data-theme="light"] {
  color-scheme: light;
  --bg0: #eef1f5; --bg1: #f4f6f9; --bg2: #eef1f5; --bg3: #fafbfc; --bg4: #f0f2f5; --bg5: #e3e7ec;
  --bd: #d7dce3; --tx: #1f2937; --tx1: #111827; --tx2: #4b5563;
  --ac: #2563eb; --ac2: #2563eb; --errtx: #b91c1c;
  --hlk: #cf222e; --hls: #0a3069; --hlc: #6e7781; --hln: #0550ae;
  --hlt: #8250df; --hla: #953800; --hlb: #0550ae;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg0); color: var(--tx); }
.md-page { max-width: 920px; margin: 0 auto; padding: 28px 24px 64px; }
`;

const THEME_CSS = PAGE_THEME_CSS;

// 同源时沿用 Web 端主题开关（localStorage.devflow-theme）；否则交给 prefers-color-scheme。
// 放在 <head> 里先于样式执行，避免先闪一下系统主题再切换。
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('devflow-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();`;

// 独立页面不经过 web 打包，由 @devflow/markdown-viewer 的 standalone 入口统一增强。
function scriptsHtml(text, slides) {
  const ppt = slides.length > 1;
  const config = JSON.stringify({
    theme: 'auto',
    locale: getLocale(),
    ppt,
    content: ppt ? text : undefined,
  }).replace(/</g, '\\u003c');
  return [
    '<link rel="stylesheet" href="/_mdv/style.css">',
    `<script type="application/json" id="mdv-config">${config}</script>`,
    '<script type="module" src="/_mdv/index.js"></script>',
  ].join('');
}

export function renderMarkdownDocument(text, title, extraHtml = '') {
  const { markdown, blocks } = extractStyleBlocks(text);
  const body = sanitizeMarkdownHtml(renderMarkdownRawHtml(markdown));
  const slides = splitMarkdownSlides(markdown).map((s) => ({
    title: s.title,
    html: sanitizeMarkdownHtml(renderMarkdownRawHtml(s.content)),
  }));
  const styles = renderStyleBlocks(blocks, '.md-body');
  const scripts = scriptsHtml(markdown, slides);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><script>${THEME_INIT_SCRIPT}</script><style>${THEME_CSS}</style>${styles.content}${styles.page}</head><body><article class="md-body md-page" data-mdv>${body}</article>${scripts}${extraHtml}</body></html>`;
}
