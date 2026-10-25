import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

export function serveStatic({ root, req, res, urlPath = '/', extraHeaders = [], onEvent = () => {}, logger = null, tag = '' }) {
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
    const rootAbs = path.resolve(root);
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
      const index = path.join(target, 'index.html');
      let ist = null;
      try { ist = fs.statSync(index); } catch { /* no index */ }
      if (ist && ist.isFile()) {
        target = index;
        st = ist;
      } else {
        const html = listDirectory(target, displayPath);
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
