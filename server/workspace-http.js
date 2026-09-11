// /api/workspace/* 路由。handler 返回 true 表示已处理。
export function createWorkspaceHttp({ service }) {
  const send = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) => new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
  return async function handle(req, res, url) {
    if (url.pathname === '/api/workspace/state' && req.method === 'GET') {
      send(res, 200, service.state());
      return true;
    }
    if (url.pathname === '/api/workspace/select' && req.method === 'POST') {
      const body = await readBody(req);
      try { send(res, 200, service.select(String(body.id || ''))); }
      catch (e) { send(res, e.code === 'not-found' ? 404 : 400, { error: 'select failed', message: String(e && e.message || e) }); }
      return true;
    }
    if (url.pathname === '/api/workspace/create' && req.method === 'POST') {
      const body = await readBody(req);
      try { send(res, 200, service.create(typeof body.name === 'string' ? body.name : undefined)); }
      catch (e) { send(res, 400, { error: 'create failed', message: String(e && e.message || e) }); }
      return true;
    }
    return false;
  };
}
