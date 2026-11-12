import crypto from 'node:crypto';
import path from 'node:path';
import { loginPage, listPage, formPage, runPage } from './pages.js';
import { listPlugins, readPlugin, readLogo } from './plugins.js';
import { staticContentType } from '../proxy-static.js';

const COOKIE = 'df_ai_auth';

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0; const chunks = [];
    req.on('data', (c) => { total += c.length; if (total > limit) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sign(secret, userId) {
  return crypto.createHmac('sha256', secret).update(userId).digest('hex');
}
function cookieFor(secret, userId, base) {
  return `${COOKIE}=${encodeURIComponent(`${userId}.${sign(secret, userId)}`)}; HttpOnly; SameSite=Lax; Path=${base || '/'}`;
}
function clearCookie(base) {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=${base || '/'}; Max-Age=0`;
}
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || (req.socket && req.socket.remoteAddress) || '';
  return String(ip).replace(/^::ffff:/, '');
}

export function createAiSiteServe({ getConfig, users, runner, logger = console }) {
  function authUser(req) {
    const cfg = getConfig();
    if (!cfg.requireAuth) return { id: '', username: 'anonymous' };
    const raw = parseCookies(req)[COOKIE];
    if (!raw) return null;
    const dot = raw.lastIndexOf('.');
    if (dot <= 0) return null;
    const userId = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expect = sign(cfg.sessionSecret, userId);
    if (sig.length !== expect.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const u = users.get(userId);
    if (!u || !u.enabled) return null;
    if (users.isExpired && users.isExpired(u)) return null;
    if (users.isRevoked && users.isRevoked(u.username)) return null;
    return u;
  }

  async function handle(req, res, url, { base = '' } = {}) {
    const cfg = getConfig();
    const method = req.method || 'GET';
    const p = url.pathname;

    if (p === '/__login' && method === 'POST') {
      let body = '';
      try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'bad-request' }); }
      const form = new URLSearchParams(body);
      const u = users.findByJwt(form.get('token') || '');
      if (!u) return sendHtml(res, 401, loginPage({ base, error: true }));
      res.writeHead(302, { 'Set-Cookie': cookieFor(cfg.sessionSecret, u.id, base), Location: `${base}/` });
      res.end();
      return;
    }
    if (p === '/__logout') {
      res.writeHead(302, { 'Set-Cookie': clearCookie(base), Location: `${base}/` });
      res.end();
      return;
    }

    if (cfg.requireAuth) {
      const access = url.searchParams.get('access');
      if (access) {
        const u = users.findByToken(access);
        if (u) {
          res.writeHead(302, { 'Set-Cookie': cookieFor(cfg.sessionSecret, u.id, base), Location: `${base}/` });
          res.end();
          return;
        }
      }
    }

    const user = authUser(req);
    if (!user) return sendHtml(res, 200, loginPage({ base }));

    if (p === '/' && method === 'GET') {
      return sendHtml(res, 200, listPage({ base, plugins: listPlugins(cfg.pluginRoot), authenticated: cfg.requireAuth }));
    }

    const logoMatch = p.match(/^\/__assets\/logo\/([^/]+)$/);
    if (logoMatch && method === 'GET') {
      const logo = readLogo(cfg.pluginRoot, decodeURIComponent(logoMatch[1]));
      if (!logo) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': logo.contentType, 'Cache-Control': 'no-cache' });
      res.end(logo.data);
      return;
    }

    const formMatch = p.match(/^\/p\/([^/]+)$/);
    if (formMatch && method === 'GET') {
      let plugin;
      try { plugin = readPlugin(cfg.pluginRoot, decodeURIComponent(formMatch[1])); } catch { res.writeHead(404); res.end('Not Found'); return; }
      return sendHtml(res, 200, formPage({ base, plugin }));
    }

    // 执行终端：独立页签展示实时输出，不再挤在表单页里。
    const runPageMatch = p.match(/^\/__run\/([^/]+)$/);
    if (runPageMatch && method === 'GET') {
      const runId = decodeURIComponent(runPageMatch[1]);
      if (!runner.getRun(runId)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found'); return; }
      return sendHtml(res, 200, runPage({ base, runId }));
    }

    if (p === '/__api/run' && method === 'POST') {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'bad-json' }); }
      let plugin;
      try { plugin = readPlugin(cfg.pluginRoot, String(body.plugin || '')); } catch { return sendJson(res, 404, { error: 'not-found' }); }
      const values = body.values && typeof body.values === 'object' ? body.values : {};
      const missing = plugin.fields.filter((f) => f.required && !String(values[f.key] ?? '').trim());
      if (missing.length) return sendJson(res, 400, { error: 'required', fields: missing.map((f) => f.key) });
      const allowed = new Set(plugin.fields.map((f) => f.key));
      const clean = {};
      for (const k of Object.keys(values)) if (allowed.has(k)) clean[k] = String(values[k] ?? '');
      let run;
      try {
        run = runner.createRun({
          pluginName: plugin.name, pluginTitle: plugin.title, pluginDir: plugin.dir,
          workflowPath: path.join(plugin.dir, plugin.workflow),
          values: clean, user: user.username || user.id || 'anonymous', ip: clientIp(req),
        });
      } catch (e) {
        logger?.warn?.('ai-site run failed', (e && e.message) || e);
        return sendJson(res, 500, { error: 'run-failed' });
      }
      if (user.id) users.recordUse(user.id);
      return sendJson(res, 200, { runId: run.id });
    }

    const streamMatch = p.match(/^\/__api\/stream\/([^/]+)$/);
    if (streamMatch && method === 'GET') {
      const runId = decodeURIComponent(streamMatch[1]);
      const run = runner.getRun(runId);
      if (!run) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.flushHeaders?.();
      const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      const off = runner.subscribe(runId, (ev) => send(ev.type, ev.type === 'chunk' ? { data: ev.data } : ev));
      const keep = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
      keep.unref?.();
      req.on('close', () => { clearInterval(keep); off(); if (!res.writableEnded) res.end(); });
      return;
    }

    const runMetaMatch = p.match(/^\/__api\/runs\/([^/]+)$/);
    if (runMetaMatch && method === 'GET') {
      const runId = decodeURIComponent(runMetaMatch[1]);
      const run = runner.snapshot(runId);
      if (!run) return sendJson(res, 404, { error: 'not-found' });
      return sendJson(res, 200, run);
    }

    const filesMatch = p.match(/^\/__api\/runs\/([^/]+)\/files$/);
    if (filesMatch && method === 'GET') {
      const runId = decodeURIComponent(filesMatch[1]);
      if (!runner.getRun(runId)) return sendJson(res, 404, { error: 'not-found' });
      return sendJson(res, 200, { items: runner.listFiles(runId) });
    }

    const fileMatch = p.match(/^\/__api\/runs\/([^/]+)\/file$/);
    if (fileMatch && method === 'GET') {
      const runId = decodeURIComponent(fileMatch[1]);
      const filePath = url.searchParams.get('path') || '';
      let file;
      try { file = runner.readFile(runId, filePath); }
      catch (e) { return sendJson(res, e.code === 'bad-path' ? 400 : 404, { error: e.code || 'not-found' }); }
      const ext = String(filePath).slice(String(filePath).lastIndexOf('.')).toLowerCase();
      const inlineImg = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf'].includes(ext);
      const ct = inlineImg ? staticContentType(filePath) : 'text/plain; charset=utf-8';
      const headers = { 'Content-Type': ct, 'Cache-Control': 'no-cache', 'Content-Length': String(file.size) };
      if (url.searchParams.get('download') === '1' || !inlineImg) headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(String(filePath).split('/').pop())}"`;
      res.writeHead(200, headers);
      res.end(file.data);
      return;
    }

    const zipMatch = p.match(/^\/__api\/runs\/([^/]+)\/zip$/);
    if (zipMatch && method === 'GET') {
      const runId = decodeURIComponent(zipMatch[1]);
      if (!runner.getRun(runId)) return sendJson(res, 404, { error: 'not-found' });
      const zip = runner.zipOutput(runId);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="output-${runId}.zip"`, 'Content-Length': String(zip.length) });
      res.end(zip);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }

  return { handle };
}
