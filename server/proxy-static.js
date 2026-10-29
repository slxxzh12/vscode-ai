import fs from 'node:fs';
import path from 'node:path';
import { DIR_ICON, fileIcon } from '@devflow/shared/file-icon';
import { isCsvFile, renderCsvDocument } from './csv-page.js';
import { isMarkdownFile, renderMarkdownDocument } from './markdown-page.js';
import { MERMAID_SCRIPT_NAME, readMermaidScript } from './mermaid-asset.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
};

export function staticContentType(file) {
  return MIME[path.extname(String(file || '')).toLowerCase()] || 'application/octet-stream';
}

function mergeHeaders(base, list) {
  const out = { ...base };
  const cookies = Array.isArray(out['set-cookie']) ? out['set-cookie'].slice() : [];
  for (const h of list || []) {
    if (!h || !h.name) continue;
    const name = String(h.name).toLowerCase();
    if (name === 'set-cookie') cookies.push(String(h.value ?? ''));
    else out[name] = String(h.value ?? '');
  }
  if (cookies.length) out['set-cookie'] = cookies;
  return out;
}

function decodePath(urlPath) {
  let s = String(urlPath || '/');
  const qi = s.indexOf('?');
  if (qi >= 0) s = s.slice(0, qi);
  s = decodeURIComponent(s);
  if (s.includes('\0')) throw new Error('bad-path');
  return s.startsWith('/') ? s : `/${s}`;
}

function inside(root, file) {
  return file === root || file.startsWith(root + path.sep);
}

// SPA 回退：无扩展名的路径（客户端路由）或浏览器明确要 HTML 时才回退，避免把缺失的 js/css 也返回成 HTML
function wantsHtmlFallback(req, pathname) {
  const last = String(pathname || '').split('/').pop() || '';
  if (!path.extname(last)) return true;
  return String(req.headers.accept || '').toLowerCase().includes('text/html');
}

function realRoot(root) {
  try { return fs.realpathSync(root); } catch { return path.resolve(root); }
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null) {
    if (end === null) return null;
    start = Math.max(0, size - end);
    end = size - 1;
  } else {
    if (end === null || end >= size) end = size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return { invalid: true };
  return { start, end };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function listDirectory(dir, urlDir) {
  const rows = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((e) => {
      const name = e.name + (e.isDirectory() ? '/' : '');
      const href = encodeURIComponent(e.name) + (e.isDirectory() ? '/' : '');
      return `<li><a href="${href}">${escapeHtml(name)}</a></li>`;
    });
  if (urlDir !== '/') rows.unshift('<li><a href="../">../</a></li>');
  return `<!doctype html><meta charset="utf-8"><title>Index of ${escapeHtml(urlDir)}</title><h3>Index of ${escapeHtml(urlDir)}</h3><ul>${rows.join('')}</ul>`;
}

const TREE_CSS = `
#df-tree{position:fixed;inset:0 auto 0 0;width:260px;overflow:auto;padding:12px 10px;box-sizing:border-box;background:#0e1116;color:#d5dae1;font:13px/1.6 ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif;border-right:1px solid #2a323e;z-index:2147483000}
#df-tree .df-tree-title{font-weight:600;margin:0 0 8px;color:#e6e9ef;word-break:break-all}
#df-tree ul{list-style:none;margin:0;padding-left:14px}
#df-tree>ul{padding-left:0}
#df-tree li{margin:1px 0}
#df-tree summary{cursor:pointer;color:#9aa4b2;user-select:none}
#df-tree a{display:block;color:#c8d0da;text-decoration:none;padding:1px 4px;border-radius:4px;word-break:break-all}
#df-tree a:hover{background:#1f2937;color:#fff}
#df-tree .df-ic{display:inline-block;width:1.35em;text-align:center;margin-right:3px;font-size:12px}
body{margin-left:260px!important}
@media(prefers-color-scheme:light){
  #df-tree{background:#fafbfc;color:#1f2937;border-right-color:#d7dce3}
  #df-tree .df-tree-title{color:#111827}
  #df-tree summary{color:#4b5563}
  #df-tree a{color:#374151}
  #df-tree a:hover{background:#eef1f5;color:#111827}
}
@media(max-width:700px){#df-tree{width:200px}body{margin-left:200px!important}}
`;

function buildTree(rootAbs, base, relDir = '', depth = 0, state = { count: 0 }) {
  if (depth > 10 || state.count > 3000) return '';
  let entries = [];
  try { entries = fs.readdirSync(path.join(rootAbs, relDir), { withFileTypes: true }); } catch { return ''; }
  entries = entries
    .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || e.isFile()))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const rows = [];
  for (const e of entries) {
    if (state.count++ > 3000) break;
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const children = buildTree(rootAbs, base, rel, depth + 1, state);
      rows.push(`<li><details open><summary><span class="df-ic">${DIR_ICON}</span>${escapeHtml(e.name)}</summary>${children}</details></li>`);
    } else {
      const href = `${base}/${rel.split('/').map(encodeURIComponent).join('/')}`;
      rows.push(`<li><a href="${escapeHtml(href)}"><span class="df-ic">${fileIcon(e.name)}</span>${escapeHtml(e.name)}</a></li>`);
    }
  }
  return `<ul>${rows.join('')}</ul>`;
}

function treePanel(rootAbs, treeBase) {
  const base = String(treeBase || '').replace(/\/+$/, '');
  const tree = buildTree(rootAbs, base);
  const title = path.basename(rootAbs) || '/';
  return `<style id="df-tree-style">${TREE_CSS}</style><aside id="df-tree"><div class="df-tree-title">${escapeHtml(title)}</div>${tree}</aside>`;
}

function injectTree(html, panel) {
  if (!panel) return html;
  const i = html.search(/<\/body\s*>/i);
  return i >= 0 ? `${html.slice(0, i)}${panel}${html.slice(i)}` : `${html}${panel}`;
}

export function serveStatic({ root, req, res, urlPath = '/', extraHeaders = [], onEvent = () => {}, logger = null, tag = '', spaFallback = false, showTree = false, treeBase = '', sitePrefix = '', publicBase = '' }) {
  const start = Date.now();
  const done = (status) => onEvent({ method: req.method, url: req.url, status, durationMs: Date.now() - start, kind: 'static' });
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const body = 'Method Not Allowed';
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(Buffer.byteLength(body)), allow: 'GET, HEAD' });
      res.end(req.method === 'HEAD' ? undefined : body);
      done(405);
      return;
    }
    let pathname;
    try { pathname = decodePath(urlPath); } catch {
      const body = 'Bad Request';
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(body.length) });
      res.end(req.method === 'HEAD' ? undefined : body);
      done(400);
      return;
    }
    // 网站前缀：/compute/ → 根路径；/ 与 /compute 跳转到前缀首页，前缀外 404
    const prefix = String(sitePrefix || '');
    if (prefix) {
      const base = String(publicBase || prefix).replace(/\/+$/, '');
      if (pathname === '/' || pathname === prefix) {
        res.writeHead(302, { location: `${base}/` });
        res.end();
        done(302);
        return;
      }
      if (!pathname.startsWith(`${prefix}/`)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : 'Not Found');
        done(404);
        return;
      }
      pathname = pathname.slice(prefix.length) || '/';
    }
    // Markdown 页面用的 Mermaid 脚本：按相对路径请求，不必落在站点目录里
    if (path.basename(pathname) === MERMAID_SCRIPT_NAME) {
      const body = readMermaidScript();
      const headers = mergeHeaders({
        'content-type': 'text/javascript; charset=utf-8',
        'content-length': String(body.length),
        'cache-control': 'public, max-age=86400',
      }, extraHeaders);
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      done(200);
      return;
    }
    const rootAbs = path.resolve(root);
    let treeCache = null;
    const getTreePanel = () => {
      if (!showTree) return '';
      if (treeCache === null) treeCache = treePanel(rootAbs, treeBase);
      return treeCache;
    };
    let displayPath = pathname;
    try { displayPath = new URL(req.url, 'http://localhost').pathname || pathname; } catch { /* keep */ }
    let target = path.resolve(rootAbs, `.${pathname}`);
    if (!inside(rootAbs, target)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'Forbidden');
      done(403);
      return;
    }
    let st = null;
    try { st = fs.statSync(target); } catch { /* missing */ }
    if (!st && spaFallback && wantsHtmlFallback(req, pathname)) {
      const index = path.join(rootAbs, 'index.html');
      try {
        const ist = fs.statSync(index);
        if (ist.isFile()) { target = index; st = ist; }
      } catch { /* no index */ }
    }
    if (!st || !(st.isFile() || st.isDirectory())) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'Not Found');
      done(404);
      return;
    }
    const real = realRoot(rootAbs);
    if (st.isDirectory()) {
      if (!displayPath.endsWith('/')) {
        const loc = `${displayPath}/${urlPath.includes('?') ? urlPath.slice(urlPath.indexOf('?')) : ''}`;
        res.writeHead(301, { location: loc });
        res.end();
        done(301);
        return;
      }
      let index = null;
      for (const name of ['index.html', 'index.htm', 'index.md', 'index.markdown']) {
        const file = path.join(target, name);
        try {
          const ist = fs.statSync(file);
          if (ist.isFile()) { index = { file, st: ist }; break; }
        } catch { /* no index */ }
      }
      if (index) {
        target = index.file;
        st = index.st;
      } else {
        const html = injectTree(listDirectory(target, displayPath), getTreePanel());
        let headers = mergeHeaders({
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(Buffer.byteLength(html)),
          'cache-control': 'no-cache',
        }, extraHeaders);
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : html);
        done(200);
        return;
      }
    }
    let realFile;
    try { realFile = fs.realpathSync(target); } catch { realFile = target; }
    if (!inside(real, realFile) && realFile !== real) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'Forbidden');
      done(403);
      return;
    }
    // Markdown 直接渲染成与「文件预览」一致的 HTML 页面，而不是返回源码
    if (isMarkdownFile(realFile)) {
      const html = renderMarkdownDocument(fs.readFileSync(realFile, 'utf8'), path.basename(realFile), getTreePanel());
      const headers = mergeHeaders({
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(Buffer.byteLength(html)),
        'cache-control': 'no-cache',
        'last-modified': st.mtime.toUTCString(),
      }, extraHeaders);
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : html);
      done(200);
      return;
    }
    // CSV 直接渲染成表格页（与文件预览的表格视图一致）
    if (isCsvFile(realFile) && !req.headers.range) {
      const html = renderCsvDocument(fs.readFileSync(realFile, 'utf8'), path.basename(realFile), getTreePanel());
      const headers = mergeHeaders({
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(Buffer.byteLength(html)),
        'cache-control': 'no-cache',
        'last-modified': st.mtime.toUTCString(),
      }, extraHeaders);
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : html);
      done(200);
      return;
    }
    // HTML 页面注入左侧文件树（Range 请求保持原样直出）
    const htmlExt = path.extname(realFile).toLowerCase();
    const treePanelHtml = (htmlExt === '.html' || htmlExt === '.htm') && !req.headers.range ? getTreePanel() : '';
    if (treePanelHtml) {
      const html = injectTree(fs.readFileSync(realFile, 'utf8'), treePanelHtml);
      const htmlHeaders = mergeHeaders({
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(Buffer.byteLength(html)),
        'cache-control': 'no-cache',
        'last-modified': st.mtime.toUTCString(),
      }, extraHeaders);
      res.writeHead(200, htmlHeaders);
      res.end(req.method === 'HEAD' ? undefined : html);
      done(200);
      return;
    }
    const size = st.size;
    const range = parseRange(req.headers.range, size);
    if (range && range.invalid) {
      res.writeHead(416, { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' });
      res.end();
      done(416);
      return;
    }
    const headers = mergeHeaders({
      'content-type': staticContentType(realFile),
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
      'last-modified': st.mtime.toUTCString(),
    }, extraHeaders);
    if (range) {
      headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`;
      headers['content-length'] = String(range.end - range.start + 1);
      res.writeHead(206, headers);
      if (req.method === 'HEAD') { res.end(); done(206); return; }
      const stream = fs.createReadStream(realFile, { start: range.start, end: range.end });
      stream.on('error', (e) => { logger?.warn?.(`${tag} static stream failed`, (e && e.message) || e); if (!res.writableEnded) res.destroy(e); });
      stream.on('end', () => done(206));
      stream.pipe(res);
      return;
    }
    headers['content-length'] = String(size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); done(200); return; }
    const stream = fs.createReadStream(realFile);
    stream.on('error', (e) => { logger?.warn?.(`${tag} static stream failed`, (e && e.message) || e); if (!res.writableEnded) res.destroy(e); });
    stream.on('end', () => done(200));
    stream.pipe(res);
  } catch (e) {
    logger?.warn?.(`${tag} static serve failed`, (e && e.message) || e);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    } else if (!res.writableEnded) res.destroy();
    done(500);
  }
}
