import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function markdownViewerDistDir() {
  const require = createRequire(import.meta.url);
  const pkgDir = path.dirname(require.resolve('@devflow/markdown-viewer/package.json'));
  return path.join(pkgDir, 'dist', 'standalone');
}

export function isMarkdownViewerAsset(pathname) {
  return pathname === '/_mdv' || pathname.startsWith('/_mdv/');
}

export function serveMarkdownViewerAsset(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }
  const root = markdownViewerDistDir();
  const rel = pathname.replace(/^\/_mdv\/?/, '') || 'index.js';
  const file = path.normalize(path.join(root, decodeURIComponent(rel)));
  if (!file.startsWith(root)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'public, max-age=86400',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}
