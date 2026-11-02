import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { escapeHtml, isMarkdownFile, renderMarkdownRawHtml } from '@devflow/shared/markdown';
import { extractStyleBlocks, renderStyleBlocks } from '@devflow/shared/markdown-css';
import { splitMarkdownSlides } from '@devflow/shared/markdown-slides';
import { sanitizeMarkdownHtml } from './markdown-sanitize.js';
import { t } from './i18n.js';
import {
  ECHARTS_SCRIPT_NAME, FLOW_X6_SCRIPT_NAME, HTML_TO_IMAGE_SCRIPT_NAME, MARKDOWN_CLIENT_SCRIPT_NAME,
  MERMAID_SCRIPT_NAME, PPTXGEN_SCRIPT_NAME,
} from './mermaid-asset.js';

export { isMarkdownFile };

// 用包目录拼接 CSS 路径，避免把 .css 当作 ESM 说明符（打包自检会 import 代码里的 @devflow/* 字符串）
const require = createRequire(import.meta.url);
const SHARED_DIR = path.dirname(require.resolve('@devflow/shared'));
// 每次渲染都读一次（文件很小），避免开发时改完 shared/markdown.css 后静态页仍用进程启动时的旧样式
function markdownCss() {
  return fs.readFileSync(path.join(SHARED_DIR, 'markdown.css'), 'utf8');
}
// PPT 浮层样式与 Web 端共用同一份文件（web 直接 import，静态页这里内联）
function pptCss() {
  return fs.readFileSync(path.join(SHARED_DIR, 'markdown-ppt.css'), 'utf8');
}

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

function jsString(s) {
  return JSON.stringify(String(s)).replace(/</g, '\\u003c');
}

// 独立页面不经过 web 打包，但复用同一份 @devflow/shared/markdown-client 增强代码
function hasChartSyntax(text) {
  return /(^|\n)\s*(xychart-beta|pie|gantt|timeline|flowchart|graph)\b/i.test(text);
}

function scriptsHtml(text, body, title, slides) {
  // 注意不能写成 body.includes('class="mermaid"')：```mermaid row``` 渲染出的
  // class 是 "mermaid mermaid-side"，严格子串匹配会漏掉，导致 Mermaid 本体脚本不加载。
  const hasMermaid = /<pre class="[^"]*\bmermaid\b/.test(body);
  const hasFlowchart = /<pre class="[^"]*\bmermaid\b[^>]*>\s*(?:flowchart|graph)\b/i.test(body);
  const hasData = /<pre class="[^"]*\bmermaid-data\b/.test(body);
  const hasCharts = hasChartSyntax(text);
  const dynamic = hasMermaid || hasCharts || hasData;
  const errTpl = jsString(t('markdown.mermaid_error', { msg: '@@MSG@@' }));
  const dataErrTpl = jsString(t('markdown.data_error', { msg: '@@MSG@@' }));
  const slidesJson = JSON.stringify(slides).replace(/</g, '\\u003c');
  const tags = [];
  if (hasMermaid || hasData) tags.push(`<script src="${MERMAID_SCRIPT_NAME}"></script>`);
  if (hasCharts || hasData) tags.push(`<script src="${ECHARTS_SCRIPT_NAME}"></script>`);
  tags.push(
    `<script type="module">import { createPptPresenter, enhanceMarkdown, enhanceSimpleTables, exportPptx } from './${MARKDOWN_CLIENT_SCRIPT_NAME}';(async()=>{`
      + 'const waitGlobal=async(n,ms)=>{const s=Date.now();while(!window[n]&&Date.now()-s<ms){await new Promise(r=>setTimeout(r,50));}return window[n]||null;};'
      + 'const dt=document.documentElement.dataset.theme;'
      + 'const light=dt?dt===\'light\':(window.matchMedia&&window.matchMedia(\'(prefers-color-scheme: light)\').matches);'
      + (hasCharts ? 'const echarts=await waitGlobal(\'echarts\',8000);' : 'const echarts=window.echarts||null;')
      + (hasMermaid ? 'const mermaid=await waitGlobal(\'mermaid\',8000);' : 'const mermaid=window.mermaid||null;')
      + `const errTpl=${errTpl};`
      + `const dataErrTpl=${dataErrTpl};`
      + 'const opts={echarts:echarts,mermaid:mermaid,theme:light?\'default\':\'dark\',dark:!light,'
      + (hasFlowchart ? `loadFlowX6:()=>import('./${FLOW_X6_SCRIPT_NAME}'),` : '')
      + 'errorText:(msg)=>errTpl.replace(\'@@MSG@@\',String(msg||\'\')),'
      + 'dataErrorText:(msg)=>dataErrTpl.replace(\'@@MSG@@\',String(msg||\'\'))};'
      + 'const enhance=async(root)=>{const items=await enhanceMarkdown(root,opts);enhanceSimpleTables(root);root.__dfItems=items;return items;};'
      + 'const dispose=(root)=>{const items=root.__dfItems||[];for(const it of items){try{it.dispose&&it.dispose();}catch(e){}}root.__dfItems=null;};'
      + 'window.__dfEnhance=enhance;'
      + 'const article=document.querySelector(\'article.md-page\');'
      + 'try{if(article)await enhance(article);}finally{if(article)article.removeAttribute(\'data-df-pending\');}'
      + `const slides=${slidesJson};`
      + 'const loadScript=(src)=>new Promise((resolve,reject)=>{const old=document.querySelector("script[data-df-src=\\""+src+"\\"]");if(old){resolve();return;}const s=document.createElement("script");s.src=src;s.dataset.dfSrc=src;s.onload=()=>resolve();s.onerror=()=>reject(new Error("load failed: "+src));document.head.appendChild(s);});'
      + 'const exportSlides=async(progress)=>{await loadScript(' + jsString(HTML_TO_IMAGE_SCRIPT_NAME) + ');await loadScript(' + jsString(PPTXGEN_SCRIPT_NAME) + ');const h=window.htmlToImage;const P=window.PptxGenJS;if(!h||!P)throw new Error("export libs missing");const css=getComputedStyle(ppt.captureEl());const bg=(css.getPropertyValue("--bg3")||css.getPropertyValue("--bg1")||"#1e1e1e").trim();await exportPptx({controller:ppt,capture:(el)=>h.toPng(el,{cacheBust:true,pixelRatio:(window.devicePixelRatio||1),width:el.clientWidth,height:el.clientHeight,style:{overflow:"hidden"},backgroundColor:bg}).then((dataUrl)=>({dataUrl,width:el.clientWidth,height:el.clientHeight})),createDeck:()=>new P(),filename:' + jsString(title) + ',background:bg,onProgress:progress,isCancelled:()=>!ppt.isOpen()});};'
      + 'const ppt=createPptPresenter({showOpenButton:true,filename:' + jsString(title) + ','
      + 'slideCount:()=>slides.length,'
      + 'slideTitle:(i)=>(slides[i]&&slides[i].title)||\'\','
      + 'renderSlide:(i)=>((slides[i]&&slides[i].html)||\'\'),'
      + 'enhance:enhance,dispose:dispose,'
      + 'labels:{open:' + jsString(t('fp.ppt')) + ',close:' + jsString(t('common.close'))
      + ',prev:' + jsString('← ' + t('fp.ppt.prev')) + ',next:' + jsString(t('fp.ppt.next') + ' →')
      + ',hide:' + jsString(t('fp.ppt.hide_nav'))
      + ',export:' + jsString(t('fp.ppt.export')) + ',exporting:' + jsString(t('fp.ppt.exporting')) + '},'
      + 'onExport:exportSlides,onExportError:(e)=>{try{const d=document.createElement("div");d.textContent=' + jsString(t('fp.ppt.export_failed', { msg: '@@MSG@@' })) + '.replace("@@MSG@@",String(e&&e.message||e));d.style.cssText="position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;background:#7f1d1d;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;max-width:80vw";document.body.appendChild(d);setTimeout(()=>d.remove(),5000);}catch(_){}},'
      + 'renderError:(e)=>\'<p class="note err">\'+String(e&&e.message||e||\'\')+\'</p>\'});'
      + 'window.__dfPpt=ppt;'
      + 'try{const q=new URLSearchParams(location.search);if(q.get(\'ppt\')===\'1\')ppt.open(Math.max(0,Number(q.get(\'slide\'))||0));}catch(e){}'
      + '})();</script>',
  );
  // JS 不可用 / 模块加载失败时，别让正文一直隐藏
  if (dynamic) {
    tags.push(
      `<noscript><style>.md-body[data-df-pending]{visibility:visible!important}</style></noscript>`
        + '<script>setTimeout(function(){var a=document.querySelector(\'article.md-page\');if(a)a.removeAttribute(\'data-df-pending\');},12000);</script>',
    );
  }
  return tags.join('');
}

export function renderMarkdownDocument(text, title, extraHtml = '') {
  const { markdown, blocks } = extractStyleBlocks(text);
  const body = sanitizeMarkdownHtml(renderMarkdownRawHtml(markdown));
  const slides = splitMarkdownSlides(markdown).map((s) => ({
    title: s.title,
    html: sanitizeMarkdownHtml(renderMarkdownRawHtml(s.content)),
  }));
  const styles = renderStyleBlocks(blocks, '.md-body');
  const hasMermaid = /<pre class="[^"]*\bmermaid\b/.test(body);
  const hasData = /<pre class="[^"]*\bmermaid-data\b/.test(body);
  const dynamic = hasMermaid || hasChartSyntax(markdown) || hasData;
  const scripts = scriptsHtml(markdown, body, title, slides);
  const pending = dynamic ? ' data-df-pending="1"' : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><script>${THEME_INIT_SCRIPT}</script><style>${THEME_CSS}${markdownCss()}${pptCss()}</style>${styles.content}${styles.page}</head><body><article class="md-body md-page"${pending}>${body}</article>${scripts}${extraHtml}</body></html>`;
}
