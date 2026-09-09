import fs from 'node:fs';
import path from 'node:path';

export const requireAuthHttp = async () => true; // TODO(安全): 认证暂缓，接入反代/Token 后在此实现

const RAW_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

export function createHttpApi({ projects }) {
  const sendJson = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const readJsonBody = (req, limit = 4 * 1024 * 1024) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      req.on('data', (c) => {
        total += c.length;
        if (total > limit) { const e = new Error('body too large'); e.code = 'too-large'; reject(e); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) { resolve({}); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  return async (req, res) => {
    if (!(await requireAuthHttp(req, res))) { sendJson(res, 401, { error: 'unauthorized' }); return; }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/projects' && req.method === 'GET') {
        sendJson(res, 200, { projects: projects.listProjects() });
        return;
      }
      if (url.pathname === '/api/tree' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const items = projects.tree(project, rel);
        sendJson(res, 200, { items });
        return;
      }
      if (url.pathname === '/api/file' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const f = projects.readText(project, rel);
        sendJson(res, 200, f);
        return;
      }
      if (url.pathname === '/api/file' && req.method === 'POST') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const body = await readJsonBody(req);
        if (typeof body.content !== 'string') return sendJson(res, 400, { error: 'content required' });
        const f = projects.writeText(project, rel, body.content);
        sendJson(res, 200, f);
        return;
      }
      if (url.pathname === '/api/raw' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        const { file, size, name } = projects.rawFile(project, rel);
        const ext = path.extname(name).toLowerCase();
        res.writeHead(200, {
          'Content-Type': RAW_MIME[ext] || 'application/octet-stream',
          'Content-Length': size,
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(file).pipe(res);
        return;
      }
    } catch (err) {
      if (err.code === 'forbidden') return sendJson(res, 403, { error: 'forbidden' });
      if (err.code === 'not-found') return sendJson(res, 404, { error: 'not found' });
      if (err.code === 'not-file') return sendJson(res, 400, { error: 'not a file' });
      if (err.code === 'too-large') return sendJson(res, 413, { error: 'file too large' });
      sendJson(res, 500, { error: 'internal', message: String(err && err.message || err) });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  };
}
