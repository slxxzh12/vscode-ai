import { t } from './i18n.js';

const MAX_BODY = 2 * 1024 * 1024;

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

const STATUS = { 'not-found': 404, 'bad-type': 400, 'bad-request': 400, 'bad-secret': 400, timeout: 504, connect: 502, exec: 502 };

function sendErr(res, code) {
  const c = code && STATUS[code] ? code : 'exec';
  sendJson(res, STATUS[c] || 500, { error: c, message: t(`nv.err.${c.replace(/-/g, '_')}`) });
}

// /api/navicat/*：连接档案 CRUD + 测试/执行 + 连接串/导出
export function createNavicatMount({ store, exec, ncx, logger = console }) {
  async function route(req, res, url) {
    const m = req.method;
    const seg = url.pathname.replace(/^\/api\/navicat\/?/, '').split('/').filter(Boolean);
    const head = seg[0] || '';
    let body = {};
    if (m === 'POST' || m === 'PATCH') {
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
    }

    if (head === 'profiles' && seg.length === 1) {
      if (m === 'GET') return sendJson(res, 200, { items: store.list() });
      if (m === 'POST') return sendJson(res, 200, { ok: true, item: store.create(body) });
      if (m === 'PATCH') return sendJson(res, 200, { ok: true, item: store.update(String(body.id || ''), body) });
      if (m === 'DELETE') return sendJson(res, 200, { ok: store.remove(String(url.searchParams.get('id') || '')) });
      return sendJson(res, 405, { error: 'method' });
    }

    if (head === 'schema' && seg[1] === 'databases' && m === 'GET') {
      const p = store.get(String(url.searchParams.get('id') || ''));
      const items = await exec.listDatabases(p, store.password(p.id));
      return sendJson(res, 200, { items });
    }

    if (head === 'schema' && seg[1] === 'tables' && m === 'GET') {
      const p = store.get(String(url.searchParams.get('id') || ''));
      const database = url.searchParams.get('database') || '';
      const items = await exec.listTables(p, store.password(p.id), database || p.database);
      return sendJson(res, 200, { items });
    }

    if (head === 'reveal' && m === 'POST') {
      return sendJson(res, 200, { password: store.password(String(body.id || '')) });
    }

    if (head === 'connstr' && m === 'POST') {
      const p = store.get(String(body.id || ''));
      const text = ncx.connectionString(p, store.password(p.id), { withPassword: !!body.withPassword });
      return sendJson(res, 200, { text });
    }

    if (head === 'ncx' && m === 'POST') {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const entries = ids.map((id) => {
        const p = store.get(String(id));
        return { ...p, password: store.password(p.id) };
      });
      return sendJson(res, 200, { xml: ncx.buildNcx(entries) });
    }

    if (head === 'test' && m === 'POST') {
      const p = body.profile ? body.profile : store.get(String(body.id || ''));
      const password = body.profile ? String(body.profile.password || '') : store.password(p.id);
      await exec.test(p, password);
      return sendJson(res, 200, { ok: true });
    }

    if (head === 'exec' && m === 'POST') {
      const base = store.get(String(body.id || ''));
      const p = body.database !== undefined && body.database !== null && String(body.database) !== ''
        ? { ...base, database: String(body.database) }
        : base;
      const sql = String(body.sql || '');
      if (!sql.trim()) return sendErr(res, 'bad-request');
      if (exec.isWrite(p, sql) && body.confirm !== true) {
        return sendJson(res, 200, { needConfirm: true, kind: 'write' });
      }
      const result = await exec.exec(p, store.password(p.id), sql);
      return sendJson(res, 200, { ok: true, result });
    }

    return sendJson(res, 404, { error: 'not-found', message: t('nv.err.not_found') });
  }

  return (req, res, url) => {
    const u = url || new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/api/navicat')) return sendJson(res, 404, { error: 'not-found' });
    route(req, res, u).catch((e) => {
      logger?.warn?.('navicat mount error', (e && e.message) || e);
      sendErr(res, (e && e.code) || 'exec');
    });
  };
}
