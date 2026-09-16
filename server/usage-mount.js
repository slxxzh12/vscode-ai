import { parseInviteLink } from './usage-report.js';

const MAX_BODY = 1024 * 1024;   // 上报体只放用量数字，1MB 足够

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

// /api/usage/* 的 HTTP 面：远端收上报（令牌），本机界面看汇总/配上报器
export function createUsageMount({ peers, reporter, checkToken, onReport, logger = console }) {
  async function route(req, res, url) {
    const m = req.method;
    const seg = url.pathname.replace(/^\/api\/usage\/?/, '').split('/').filter(Boolean);

    if (seg[0] === 'report' && seg.length === 1 && m === 'POST') {
      const tk = String(req.headers['x-df-token'] || '');
      if (!checkToken || !checkToken(tk)) return sendJson(res, 403, { error: 'bad-token' });
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
      if (!body || typeof body.machineId !== 'string' || !body.machineId || !body.usage || typeof body.usage !== 'object' || Array.isArray(body.usage)) {
        return sendJson(res, 400, { error: 'bad-body' });
      }
      const rec = peers.upsert({
        ...body.usage,
        machineId: body.machineId,
        employeeId: typeof body.employeeId === 'string' ? body.employeeId : '',
        username: typeof body.username === 'string' ? body.username : '',
        host: typeof body.host === 'string' ? body.host : '',
        port: Number(body.port) || 0,
      });
      try { onReport?.(rec); } catch (e) { logger?.warn?.('usage onReport failed', (e && e.message) || e); }
      return sendJson(res, 200, { ok: true });
    }

    if (seg[0] === 'peers' && seg.length === 1 && m === 'GET') return sendJson(res, 200, peers.snapshot());

    if (seg[0] === 'reporter' && seg.length === 1 && m === 'GET') {
      return sendJson(res, 200, { config: reporter.config(), status: reporter.status() });
    }
    if (seg[0] === 'reporter' && seg.length === 1 && m === 'POST') {
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
      if (typeof body.link === 'string' && body.link.trim()) {
        const parsed = parseInviteLink(body.link);
        if (parsed.error) return sendJson(res, 400, { error: parsed.error });
        reporter.setConfig({ masterUrl: parsed.masterUrl, token: parsed.token, days: body.days });
      } else {
        reporter.setConfig({ masterUrl: body.masterUrl, token: body.token, days: body.days });
      }
      return sendJson(res, 200, { config: reporter.config(), status: reporter.status() });
    }
    if (seg[0] === 'reporter' && seg[1] === 'now' && seg.length === 2 && m === 'POST') {
      await reporter.reportNow();
      return sendJson(res, 200, { status: reporter.status() });
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  return (req, res, url) => {
    const u = url || new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/api/usage/')) return sendJson(res, 404, { error: 'not found' });
    route(req, res, u).catch((e) => {
      logger?.error?.('usage mount error', e);
      sendJson(res, 500, { error: 'internal' });
    });
  };
}
