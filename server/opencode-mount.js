function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

export function createOpencodeMount({ installer, logger = console }) {
  return async function route(req, res, url) {
    const seg = url.pathname.replace(/^\/api\/opencode\/?/, '').split('/').filter(Boolean);
    if (seg.length === 1 && seg[0] === 'status' && req.method === 'GET') {
      return sendJson(res, 200, installer.status());
    }
    if (seg.length === 1 && seg[0] === 'install' && req.method === 'POST') {
      try {
        return sendJson(res, 202, installer.start());
      } catch (err) {
        logger?.warn?.('opencode install start failed', (err && err.message) || err);
        return sendJson(res, 500, { ...installer.status(), error: String((err && err.message) || err) });
      }
    }
    return sendJson(res, 404, { error: 'not-found' });
  };
}
