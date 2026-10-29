import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { escapeHtml, isMarkdownFile, renderMarkdownHtml } from '@devflow/shared/markdown';
import { t } from './i18n.js';
import { MERMAID_SCRIPT_NAME } from './mermaid-asset.js';

export { isMarkdownFile };

// 用包目录拼接 CSS 路径，避免把 .css 当作 ESM 说明符（打包自检会 import 代码里的 @devflow/* 字符串）
const require = createRequire(import.meta.url);
const SHARED_DIR = path.dirname(require.resolve('@devflow/shared'));
const MARKDOWN_CSS = fs.readFileSync(path.join(SHARED_DIR, 'markdown.css'), 'utf8');

// 独立页面的主题变量来自 web/src/styles.css；浅色跟随系统偏好
export const PAGE_THEME_CSS = `
:root {
  color-scheme: dark;
  --bg0: #1e2227; --bg2: #141920; --bg3: #0e1116; --bg4: #222932;
  --bd: #2a323e; --tx: #d5dae1; --tx1: #e6e9ef; --tx2: #9aa4b2;
  --ac: #2f6feb; --ac2: #4c9aff; --errtx: #fca5a5;
  --hlk: #ff7b72; --hls: #a5d6ff; --hlc: #8b949e; --hln: #79c0ff;
  --hlt: #d2a8ff; --hla: #79c0ff; --hlb: #ffa657;
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --bg0: #eef1f5; --bg2: #eef1f5; --bg3: #fafbfc; --bg4: #f0f2f5;
    --bd: #d7dce3; --tx: #1f2937; --tx1: #111827; --tx2: #4b5563;
    --ac: #2563eb; --ac2: #2563eb; --errtx: #b91c1c;
    --hlk: #cf222e; --hls: #0a3069; --hlc: #6e7781; --hln: #0550ae;
    --hlt: #8250df; --hla: #953800; --hlb: #0550ae;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg0); color: var(--tx); }
.md-page { max-width: 920px; margin: 0 auto; padding: 28px 24px 64px; }
`;

const THEME_CSS = PAGE_THEME_CSS;

function jsString(s) {
  return JSON.stringify(String(s)).replace(/</g, '\\u003c');
}

// 独立页面不经过 web 打包，这里直接引用 serveStatic 拦截后直出的 Mermaid 脚本
function mermaidHtml() {
  const errTpl = t('markdown.mermaid_error', { msg: '@@MSG@@' });
  return `<script src="${MERMAID_SCRIPT_NAME}"></script><script>(function(){var mm=window.mermaid;if(!mm)return;var nodes=Array.prototype.slice.call(document.querySelectorAll('pre.mermaid'));if(!nodes.length)return;var light=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches;mm.initialize({startOnLoad:false,securityLevel:'strict',theme:light?'default':'dark'});var errTpl=${jsString(errTpl)};var seq=0;nodes.forEach(function(pre){var id='df-mm-'+Date.now().toString(36)+'-'+(seq++);mm.render(id,pre.textContent||'').then(function(r){var holder=document.getElementById(id);if(holder)holder.remove();pre.outerHTML=r.svg;}).catch(function(e){var holder=document.getElementById(id);if(holder)holder.remove();var box=document.createElement('div');box.className='mermaid-err';box.textContent=errTpl.replace('@@MSG@@',String((e&&e.message)||e));pre.textContent='';pre.appendChild(box);});});})();</script>`;
}

export function renderMarkdownDocument(text, title, extraHtml = '') {
  const body = renderMarkdownHtml(text);
  const scripts = body.includes('class="mermaid"') ? mermaidHtml() : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${THEME_CSS}${MARKDOWN_CSS}</style></head><body><article class="md-body md-page">${body}</article>${scripts}${extraHtml}</body></html>`;
}
