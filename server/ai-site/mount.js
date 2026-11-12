import { listPlugins } from './plugins.js';

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

export function createAiSiteMount({ configStore, users, apply, status, pluginsRoot }) {
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
