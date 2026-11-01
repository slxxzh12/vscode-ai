// Markdown 样式提取、消毒与作用域注入；不执行任何脚本。

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const STYLE_OPEN_RE = /^\s*<style\b([^>]*)>/i;
const STYLE_END_RE = /<\/style>/i;

export function sanitizeCss(css, opts = {}) {
  let out = String(css || '').replace(/<\/style/gi, '');
  out = out.replace(/<\/?script[^>]*>/gi, '');
  out = out.replace(/expression\s*\(/gi, 'blocked(');
  out = out.replace(/javascript\s*:/gi, 'blocked:');
  out = out.replace(/(^|[;{\s])(behavior|-moz-binding)\s*:/gi, '$1blocked:');
  if (!opts.page) out = out.replace(/@import[^;]*;/gi, '');
  return out.trim();
}

export function sanitizeCssValue(value) {
  return sanitizeCss(value, { page: true });
}

export function extractStyleBlocks(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const blocks = [];
  let fence = '';
  let inStyle = false;
  let page = false;
  let buf = [];

  const pushBlock = (css) => {
    if (String(css).trim()) blocks.push({ css: String(css), page });
    page = false;
    buf = [];
  };

  for (const line of lines) {
    if (!inStyle) {
      const fm = FENCE_RE.exec(line);
      if (fm) {
        const marker = fm[1][0];
        if (!fence) fence = marker;
        else if (fence === marker) fence = '';
        out.push(line);
        continue;
      }
      if (!fence) {
        const m = STYLE_OPEN_RE.exec(line);
        if (m) {
          page = /\bdata-scope\s*=\s*(?:"page"|'page'|page)(?=[\s>]|$)/i.test(m[1]);
          const rest = line.slice(m.index + m[0].length);
          const end = STYLE_END_RE.exec(rest);
          if (end) {
            pushBlock(rest.slice(0, end.index));
            const tail = rest.slice(end.index + end[0].length);
            if (tail.trim()) out.push(tail);
          } else {
            inStyle = true;
            buf = rest ? [rest] : [];
          }
          continue;
        }
      }
      out.push(line);
      continue;
    }
    const end = STYLE_END_RE.exec(line);
    if (end) {
      buf.push(line.slice(0, end.index));
      pushBlock(buf.join('\n'));
      inStyle = false;
      const tail = line.slice(end.index + end[0].length);
      if (tail.trim()) out.push(tail);
    } else {
      buf.push(line);
    }
  }
  if (inStyle) pushBlock(buf.join('\n'));
  return { markdown: out.join('\n'), blocks };
}

export function scopeCss(css, selector) {
  if (!selector) return css;
  return `@scope (${selector}) {\n${css}\n}`;
}

export function renderStyleBlocks(blocks, scopeSelector) {
  const list = Array.isArray(blocks) ? blocks : [];
  const content = list
    .filter((b) => !b.page)
    .map((b) => sanitizeCss(b.css, { page: false }))
    .filter(Boolean)
    .join('\n');
  const page = list
    .filter((b) => b.page)
    .map((b) => sanitizeCss(b.css, { page: true }))
    .filter(Boolean)
    .join('\n');
  return {
    content: content ? `<style>${scopeCss(content, scopeSelector)}</style>` : '',
    page: page ? `<style>${page}</style>` : '',
  };
}

let seq = 0;
export function nextScopeId(prefix = 'md-css') {
  seq += 1;
  return `${prefix}-${seq}`;
}
