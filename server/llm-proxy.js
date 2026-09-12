import http from 'node:http';
import https from 'node:https';
import { verifyJwt } from './llm-jwt.js';

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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error }));
}

export function createProxyHandler({ vault, getProvider, isEnabled }) {
  return async function handle(req, res, { providerId, rest, query }) {
    if (!isEnabled()) return deny(res, 404, 'proxy disabled');
    const provider = getProvider(providerId);
    if (!provider || !provider.baseURL) return deny(res, 404, 'provider not found');
    let data;
    try { data = vault.getData(); } catch { return deny(res, 401, 'locked'); }
    if (!data.jwtSecret) return deny(res, 401, 'no secret');
    const token = extractToken(req.headers);
    if (!token) return deny(res, 401, 'no token');
    let payload;
    try { payload = verifyJwt(token, data.jwtSecret); } catch { return deny(res, 401, 'invalid token'); }
    const rec = (data.tokens || []).find((t) => t.jti === payload.jti && !t.revoked);
    if (!rec) return deny(res, 401, 'revoked');
    let target;
    try { target = resolveTarget(provider.baseURL, rest, query); } catch { return deny(res, 502, 'bad upstream'); }
    const mod = target.protocol === 'https:' ? https : http;
    const headers = injectUpstreamAuth(req.headers, provider.apiKey);
    const preq = mod.request({
      protocol: target.protocol, hostname: target.hostname, port: target.port,
      method: req.method, path: target.pathname + target.search, headers,
    }, (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    });
    preq.on('error', () => { try { deny(res, 502, 'upstream error'); } catch { /* ignore */ } });
    req.pipe(preq);
  };
}
