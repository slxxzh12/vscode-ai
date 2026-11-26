import path from 'node:path';
import { listPlugins, readPlugin } from './plugins.js';
import { staticContentType } from '../proxy-static.js';

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function sendErr(res, code) {
  const status = code === 'not-found' ? 404 : code === 'duplicate-username' ? 409 : 400;
  sendJson(res, status, { error: code || 'bad-request' });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => { chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8')));
    req.on('error', reject);
  });
}

export function createAiSiteMount({ configStore, users, apply, status, pluginsRoot, runner }) {
  return async function mount(req, res, url) {
    const seg = url.pathname.replace(/^\/api\/ai-site\/?/, '').split('/').filter(Boolean);
    const head = seg[0] || '';
    const method = req.method;
    let body = {};
    try {
      if (method === 'POST' || method === 'PATCH') {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      }
    } catch { body = {}; }

    try {
      if (head === 'config' && !seg[1]) {
        if (method === 'GET') return sendJson(res, 200, { config: configStore.get(), status: status() });
        if (method === 'POST') {
          const saved = configStore.save(body);
          await apply(saved);
          return sendJson(res, 200, { ok: true, config: saved, status: status() });
        }
      }
      if (head === 'start' && method === 'POST') {
        const saved = configStore.save({ enabled: true });
        await apply(saved);
        return sendJson(res, 200, { ok: true, config: saved, status: status() });
      }
      if (head === 'stop' && method === 'POST') {
        const saved = configStore.save({ enabled: false });
        await apply(saved);
        return sendJson(res, 200, { ok: true, config: saved, status: status() });
      }
      if (head === 'plugins' && method === 'GET') {
        return sendJson(res, 200, { items: listPlugins(pluginsRoot()) });
      }
      if (head === 'run' && method === 'POST') {
        const plugin = readPlugin(pluginsRoot(), String(body.plugin || ''));
        const values = body.values && typeof body.values === 'object' ? body.values : {};
        const missing = plugin.fields.filter((f) => f.required && !String(values[f.key] ?? '').trim());
        if (missing.length) return sendJson(res, 400, { error: 'required', fields: missing.map((f) => f.key) });
        const clean = {};
        for (const f of plugin.fields) if (values[f.key] !== undefined) clean[f.key] = String(values[f.key] ?? '');
        const run = runner.createRun({
          pluginName: plugin.name, pluginTitle: plugin.title, pluginDir: plugin.dir,
          workflowPath: path.join(plugin.dir, plugin.workflow), values: clean, user: 'local', ip: '',
        });
        return sendJson(res, 200, { ok: true, runId: run.id });
      }
      if (head === 'runs' && seg[1]) {
        const id = decodeURIComponent(seg[1]);
        const sub = seg[2] || '';
        if (method === 'GET' && !sub) {
          const run = runner.snapshot(id);
          if (!run) return sendJson(res, 404, { error: 'not-found' });
          return sendJson(res, 200, run);
        }
        if (method === 'GET' && sub === 'files') {
          if (!runner.getRun(id)) return sendJson(res, 404, { error: 'not-found' });
          return sendJson(res, 200, { items: runner.listFiles(id) });
        }
        if (method === 'GET' && sub === 'file') {
          const filePath = url.searchParams.get('path') || '';
          let file;
          try { file = runner.readFile(id, filePath); }
          catch (e) { return sendJson(res, e.code === 'bad-path' ? 400 : 404, { error: e.code || 'not-found' }); }
          const ext = String(filePath).slice(String(filePath).lastIndexOf('.')).toLowerCase();
          const inlineImg = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf'].includes(ext);
          const headers = { 'Content-Type': inlineImg ? staticContentType(filePath) : 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' };
          if (url.searchParams.get('download') === '1' || !inlineImg) headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(String(filePath).split('/').pop())}"`;
          res.writeHead(200, headers);
          return res.end(file.data);
        }
        if (method === 'GET' && sub === 'zip') {
          if (!runner.getRun(id)) return sendJson(res, 404, { error: 'not-found' });
          const zip = runner.zipOutput(id);
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="output-${id}.zip"` });
          return res.end(zip);
        }
        if (method === 'POST' && sub === 'input') {
          const text = String(body.text ?? '');
          if (!text) return sendJson(res, 400, { error: 'empty' });
          return runner.write(id, text)
            ? sendJson(res, 200, { ok: true })
            : sendJson(res, 409, { error: 'not-running' });
        }
      }
      if (head === 'users' && !seg[1]) {
        if (method === 'GET') return sendJson(res, 200, { items: users.list(), blacklist: users.blacklist() });
        if (method === 'POST') return sendJson(res, 200, { ok: true, item: users.create(body) });
        if (method === 'PATCH') return sendJson(res, 200, { ok: true, item: users.update(String(body.id || ''), body) });
        if (method === 'DELETE') {
          const id = String(url.searchParams.get('id') || '');
          return sendJson(res, 200, { ok: users.remove(id) });
        }
      }
      if (head === 'revoke' && method === 'POST') {
        const out = users.revoke(String(body.username || ''), body.revoked !== false);
        return sendJson(res, 200, { ok: true, ...out });
      }
      return sendJson(res, 404, { error: 'not-found' });
    } catch (e) {
      return sendErr(res, (e && e.code) || 'bad-request');
    }
  };
}
