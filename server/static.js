import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

export function createStaticServer(rootDir) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const url = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(rootDir, decodeURIComponent(url.pathname)));
    if (!file.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      const ext = path.extname(file);
      if (ext !== '') return next();                // 缺失资源 → 404，不回退 SPA
      file = path.join(rootDir, 'index.html');       // 无扩展名路由 → SPA fallback
    }
    if (!fs.existsSync(file)) return next();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  };
}
