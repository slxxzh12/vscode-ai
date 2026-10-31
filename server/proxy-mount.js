const MAX_BODY = 1 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const STATUS = { 'not-found': 404, 'bad-request': 400, 'port-in-use': 409 };

function sendErr(res, code) {
  const c = code && STATUS[code] ? code : 'bad-request';
  sendJson(res, STATUS[c] || 400, { error: c });
}

export function createProxyMount({ store, engine, capture, logger = console }) {
  async function route(req, res, url) {
    const m = req.method;
    const seg = url.pathname.replace(/^\/api\/nginx\/?/, '').split('/').filter(Boolean);
    const head = seg[0] || '';
    let body = {};
    if (m === 'POST' || m === 'PATCH') {
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
    }

    if (head === 'rules' && seg.length === 1) {
      if (m === 'GET') {
        return sendJson(res, 200, { items: store.list(), status: engine.status() });
      }
      if (m === 'POST') {
        const item = store.create(body);
        await engine.apply(item);
        return sendJson(res, 200, { ok: true, item });
      }
      if (m === 'PATCH') {
        const item = store.update(String(body.id || ''), body);
        await engine.apply(item);
        return sendJson(res, 200, { ok: true, item });
      }
      if (m === 'DELETE') {
        const id = String(url.searchParams.get('id') || '');
        engine.remove(id);
        const ok = store.remove(id);
        return sendJson(res, 200, { ok });
      }
      return sendJson(res, 405, { error: 'method' });
    }

    if (head === 'rules' && seg[1] === 'start' && m === 'POST') {
      const id = String(url.searchParams.get('id') || '');
      const rule = store.get(id);
      await engine.apply({ ...rule, enabled: true });
      const saved = store.update(id, { enabled: true });
      return sendJson(res, 200, { ok: true, status: engine.status(), item: saved });
    }

    if (head === 'rules' && seg[1] === 'stop' && m === 'POST') {
      const id = String(url.searchParams.get('id') || '');
      store.get(id);
      engine.stop(id);
      const saved = store.update(id, { enabled: false });
      return sendJson(res, 200, { ok: true, status: engine.status(), item: saved });
    }

    if (head === 'log' && m === 'GET') {
      const rule = String(url.searchParams.get('rule') || '');
      return sendJson(res, 200, { items: engine.logs(rule) });
    }

    if (head === 'captures' && seg.length === 1 && m === 'GET') {
      const rule = String(url.searchParams.get('rule') || '');
      const limit = Number(url.searchParams.get('limit')) || 200;
      return sendJson(res, 200, { items: capture.list(rule, { limit }) });
    }

    if (head === 'captures' && seg.length === 1 && m === 'DELETE') {
      const rule = String(url.searchParams.get('rule') || '');
      capture.clear(rule);
      return sendJson(res, 200, { ok: true });
    }

    if (head === 'captures' && seg.length === 3 && m === 'GET') {
      const item = capture.read(seg[1], seg[2]);
      return sendJson(res, 200, { item });
    }

    return sendJson(res, 404, { error: 'not-found' });
  }

  return (req, res, url) => {
    const u = url || new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/api/nginx')) return sendJson(res, 404, { error: 'not-found' });
    route(req, res, u).catch((e) => {
      logger?.warn?.('nginx mount error', (e && e.message) || e);
      sendErr(res, (e && e.code) || 'bad-request');
    });
  };
}
