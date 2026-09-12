import http from 'node:http';
import https from 'node:https';
import { verifyJwt } from './llm-jwt.js';
import { runRequestPlugins, runResponsePlugins, pluginCacheKeyOverride } from './relay-plugins.js';

const REQUEST_LIMIT = 32 * 1024 * 1024;
const RESPONSE_LIMIT = 64 * 1024 * 1024;

export function resolveTarget(baseURL, rest, query = '') {
  const u = new URL(baseURL);
  const basePath = u.pathname.replace(/\/+$/, '');
  let p = rest.startsWith('/') ? rest : '/' + rest;
  if (basePath && p !== basePath && !p.startsWith(basePath + '/')) p = basePath + p;
  const out = new URL(u.origin + p);
  out.search = query || '';
  return out;
}

export function extractToken(headers) {
  const auth = headers['authorization'] || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const k = headers['x-api-key'];
  return typeof k === 'string' ? k : '';
}

export function injectUpstreamAuth(headers, apiKey) {
  const out = { ...headers };
  delete out.host;
  delete out['content-length'];
  if (apiKey) { out.authorization = `Bearer ${apiKey}`; out['x-api-key'] = apiKey; }
  else { delete out.authorization; delete out['x-api-key']; }
  return out;
}

function deny(res, code, error) {
  if (res.headersSent) { try { res.destroy(); } catch { /* ignore */ } return; }
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error }));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        const e = new Error('body-too-large');
        e.code = 'body-too-large';
        reject(e);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function toJson(ctx) {
  if (ctx.json !== undefined) return ctx.json;
  if (!Buffer.isBuffer(ctx.body)) return undefined;
  try { return JSON.parse(ctx.body.toString('utf8')); } catch { return undefined; }
}

function isStreaming(ctx) {
  const json = toJson(ctx);
  if (json && json.stream === true) return true;
  return String(ctx.headers.accept || '').toLowerCase().includes('text/event-stream');
}

function upstreamRequest(target, method, headers, onResponse) {
  const mod = target.protocol === 'https:' ? https : http;
  return mod.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method,
    path: target.pathname + target.search,
    headers,
  }, onResponse);
}

function pipeUpstream(res, target, method, headers, body) {
  const preq = upstreamRequest(target, method, headers, (pres) => {
    res.writeHead(pres.statusCode || 502, pres.headers);
    pres.pipe(res);
  });
  preq.on('error', () => deny(res, 502, 'upstream error'));
  if (body && body.length) preq.end(body); else preq.end();
}

function bufferUpstream(res, target, method, headers, body, limit) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const preq = upstreamRequest(target, method, headers, (pres) => {
      const chunks = [];
      let size = 0;
      let overflow = false;
      pres.on('data', (c) => {
        if (overflow) return;
        size += c.length;
        if (size > limit) {
          overflow = true;
          res.writeHead(pres.statusCode || 502, pres.headers);
          for (const chunk of chunks) res.write(chunk);
          res.write(c);
          pres.pipe(res);
          return;
        }
        chunks.push(c);
      });
      pres.on('end', () => {
        if (settled) return;
        settled = true;
        if (overflow) resolve({ streamed: true });
        else resolve({ status: pres.statusCode || 502, headers: pres.headers, body: Buffer.concat(chunks) });
      });
      pres.on('error', (e) => {
        if (settled) return;
        settled = true;
        try { res.destroy(); } catch { /* ignore */ }
        reject(e);
      });
    });
    preq.on('error', () => {
      if (settled) return;
      settled = true;
      deny(res, 502, 'upstream error');
      reject(new Error('upstream-error'));
    });
    if (body && body.length) preq.end(body); else preq.end();
  });
}

export function createProxyHandler({ vault, getProvider, isEnabled, cache = null, plugins = [], logger = console }) {
  let activePlugins = plugins;
  let activeCache = cache;

  async function handle(req, res, { providerId, rest, query }) {
    if (!isEnabled()) return deny(res, 404, 'proxy disabled');
    let data;
    try { data = vault.getData(); } catch { return deny(res, 401, 'locked'); }
    if (!data.jwtSecret) return deny(res, 401, 'no secret');
    const token = extractToken(req.headers);
    if (!token) return deny(res, 401, 'no token');
    let payload;
    try { payload = verifyJwt(token, data.jwtSecret); } catch { return deny(res, 401, 'invalid token'); }
    const rec = (data.tokens || []).find((t) => t.jti === payload.jti && !t.revoked);
    if (!rec) return deny(res, 401, 'revoked');

    let body;
    try {
      body = await readBody(req, REQUEST_LIMIT);
    } catch (e) {
      return deny(res, e.code === 'body-too-large' ? 413 : 400, 'bad body');
    }

    const ctx = {
      providerId,
      method: req.method,
      path: rest,
      query,
      headers: { ...req.headers },
      body,
      json: undefined,
      provider: null,
    };
    try { ctx.json = JSON.parse(body.toString('utf8')); } catch { ctx.json = undefined; }
    const initial = getProvider(providerId);
    if (initial) ctx.provider = { id: providerId, name: initial.name, baseURL: initial.baseURL, hasKey: !!initial.apiKey };

    try {
      await runRequestPlugins(activePlugins, ctx, logger);
    } catch {
      return deny(res, 502, 'plugin error');
    }

    const provider = getProvider(ctx.providerId);
    if (!provider || !provider.baseURL) return deny(res, 404, 'provider not found');

    let target;
    try { target = resolveTarget(provider.baseURL, ctx.path, ctx.query); } catch { return deny(res, 502, 'bad upstream'); }

    const headers = injectUpstreamAuth(ctx.headers, provider.apiKey);
    if (Buffer.isBuffer(ctx.body) && ctx.body.length) headers['content-length'] = String(ctx.body.length);

    if (isStreaming(ctx) || !activeCache) {
      return pipeUpstream(res, target, ctx.method, headers, ctx.body);
    }

    let key = activeCache.keyFor(ctx.providerId, ctx.method, ctx.body);
    let ttl;
    try {
      const override = pluginCacheKeyOverride(activePlugins, ctx, logger);
      if (override === null) key = null;
      else if (override) {
        if (override.key) key = override.key;
        if (override.ttlMs) ttl = override.ttlMs;
      }
    } catch {
      return deny(res, 502, 'plugin error');
    }

    if (key) {
      const hit = activeCache.get(key);
      if (hit) {
        res.writeHead(hit.status, { ...hit.headers, 'x-devflow-cache': 'HIT' });
        return res.end(hit.body);
      }
    }

    let out;
    try {
      out = await bufferUpstream(res, target, ctx.method, headers, ctx.body, RESPONSE_LIMIT);
    } catch {
      return;
    }
    if (out.streamed) return;

    const rctx = { ...ctx, status: out.status, headers: { ...out.headers }, body: out.body };
    try {
      await runResponsePlugins(activePlugins, rctx, logger);
    } catch {
      return deny(res, 502, 'plugin error');
    }

    if (key && rctx.status === 200) {
      activeCache.set(key, { status: rctx.status, headers: rctx.headers, body: rctx.body }, ttl);
    }
    res.writeHead(rctx.status, rctx.headers);
    res.end(rctx.body);
  }

  handle.setPlugins = (next) => { activePlugins = next || []; };
  handle.setCache = (next) => { activeCache = next || null; };
  return handle;
}
