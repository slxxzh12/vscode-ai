import http from 'node:http';
import https from 'node:https';
import { WsFrameParser } from './proxy-ws-frames.js';
import { serveStatic } from './proxy-static.js';

const LOG_LIMIT = 500;
const REPLACE_MAX_BODY = 20 * 1024 * 1024;

export function isTextualResponse(headers) {
  const ct = String(headers?.['content-type'] || '').toLowerCase();
  if (ct.startsWith('text/')) return true;
  return ct.includes('javascript') || ct.includes('json') || ct.includes('xml') || ct.includes('svg');
}

export function applyResponseReplacements(body, replacements) {
  let s = body.toString('utf8');
  for (const r of replacements || []) {
    if (!r || !r.from) continue;
    s = s.split(r.from).join(r.to ?? '');
  }
  return Buffer.from(s, 'utf8');
}

export function applyLocationReplacements(headers, replacements, ctx = null) {
  if (!headers || !headers.location) return headers;
  const rule = ctx?.rule;
  const req = ctx?.req;
  const apply = (v) => {
    let s = String(v);
    if (rule && req) {
      const reqHost = String(req.headers?.host || '');
      const target = rule.target || {};
      const sameHost = (u) => u.host === `${target.host}:${target.port}`
        || u.host === target.host
        || (u.hostname === target.host && (!u.port || Number(u.port) === Number(target.port)));
      let absolute = null;
      try { absolute = new URL(s); } catch { /* relative or scheme-relative */ }
      if (absolute && sameHost(absolute) && reqHost) {
        const proto = String(req.headers?.['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http'));
        absolute.protocol = `${proto}:`;
        absolute.host = reqHost;
        if (rule.mode === 'path' && rule.pathPrefix && !matchPrefix(rule.pathPrefix, absolute.pathname)) {
          absolute.pathname = rule.pathPrefix + absolute.pathname;
        }
        s = absolute.toString();
      } else if (!absolute && rule.mode === 'path' && rule.pathPrefix && s.startsWith('/') && !matchPrefix(rule.pathPrefix, s.split('?')[0])) {
        s = rule.pathPrefix + s;
      }
    }
    for (const r of replacements || []) {
      if (!r || !r.from) continue;
      s = s.split(r.from).join(r.to ?? '');
    }
    return s;
  };
  headers.location = Array.isArray(headers.location) ? headers.location.map(apply) : apply(headers.location);
  return headers;
}

export function applyResponseHeaders(headers, list) {
  const out = { ...headers };
  const customCookies = [];
  for (const h of list || []) {
    if (!h || !h.name) continue;
    const name = String(h.name).toLowerCase();
    const value = String(h.value ?? '');
    if (name === 'set-cookie') { customCookies.push(value); continue; }
    out[name] = value;
  }
  if (customCookies.length) out['set-cookie'] = customCookies;
  return out;
}

export function matchPrefix(prefix, pathname) {
  if (!prefix) return false;
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function applyRewrites(rewrites, pathname) {
  for (const rw of rewrites || []) {
    if (!rw || !rw.from || !matchPrefix(rw.from, pathname)) continue;
    let rest = pathname.slice(rw.from.length);
    const to = rw.to || '';
    if (rest === '') return to || '/';
    if (!rest.startsWith('/')) rest = '/' + rest;
    return to ? to + rest : rest;
  }
  return null;
}

export function buildForwardPath(rule, reqUrl) {
  const url = reqUrl || '/';
  const qi = url.indexOf('?');
  const pathPart = qi >= 0 ? url.slice(0, qi) : url;
  const search = qi >= 0 ? url.slice(qi) : '';
  const rewritten = applyRewrites(rule.rewrites, pathPart);
  if (rewritten !== null) return rewritten + search;
  if (rule.mode !== 'path' || !rule.stripPrefix || !rule.pathPrefix) return url;
  let rest = pathPart.slice(rule.pathPrefix.length);
  if (!rest.startsWith('/')) rest = '/' + rest;
  if (rest === '') rest = '/';
  return rest + search;
}

export function forwardHeaders(rule, req) {
  const out = { ...req.headers };
  delete out.host;
  const xff = req.headers['x-forwarded-for'];
  const ip = (req.socket && req.socket.remoteAddress) || '';
  out['x-forwarded-for'] = xff ? `${xff}, ${ip}` : ip;
  out['x-forwarded-proto'] = rule.target.protocol === 'https' ? 'https' : 'http';
  out['x-forwarded-host'] = req.headers.host || '';
  for (const h of rule.headers || []) if (h.name) out[h.name.toLowerCase()] = h.value;
  return out;
}

export function proxyHttp({ rule, req, res, capture, emit = () => {}, logger = null }) {
  const target = rule.target;
  const isHttps = target.protocol === 'https';
  const mod = isHttps ? https : http;
  const start = Date.now();
  const logOn = !!rule.logRequests;
  const tag = `[nginx:${rule.name || rule.id}]`;
  const replacements = (rule.responseReplace || []).filter((r) => r && r.from);
  const locationReplacements = [...(rule.locationReplace || []), ...replacements].filter((r) => r && r.from);

  const sendDirect = (status, contentType, payload, extraHeaders = []) => {
    const code = Number(status) || 200;
    const body = Buffer.from(String(payload ?? ''), 'utf8');
    let headers = applyResponseHeaders({
      'content-type': contentType || 'application/json; charset=utf-8',
      'content-length': String(body.length),
    }, rule.responseHeaders);
    if (Array.isArray(extraHeaders) && extraHeaders.length) headers = applyResponseHeaders(headers, extraHeaders);
    headers = applyLocationReplacements(headers, locationReplacements);
    if (logOn) logger?.info?.(`${tag} direct ${code} response headers=${JSON.stringify(headers)} body=${payload}`);
    res.writeHead(code, headers);
    res.end(body);
    emit({ method: req.method, url: req.url, status: code, durationMs: Date.now() - start, kind: 'http' });
  };

  if (rule.directResponse) {
    sendDirect(rule.directStatus, rule.directContentType, rule.directBody);
    return;
  }

  const pathname = String(req.url || '/').split('?')[0];
  const rewrite = (rule.rewrites || []).find((rw) => rw && rw.from && matchPrefix(rw.from, pathname));
  if (rewrite?.directResponse) {
    sendDirect(rewrite.directStatus, rewrite.directContentType, rewrite.directBody, rewrite.directHeaders);
    return;
  }

  if (rule.corsPreflight && req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
    const origin = String(req.headers.origin || '');
    const reqMethod = String(req.headers['access-control-request-method'] || '');
    const reqHeaders = String(req.headers['access-control-request-headers'] || '');
    const out = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': reqMethod
        ? `${reqMethod}, GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD`
        : 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': reqHeaders || 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      'Content-Length': '0',
    };
    if (origin) out['Access-Control-Allow-Credentials'] = 'true';
    const headers = applyResponseHeaders(out, rule.responseHeaders);
    if (logOn) logger?.info?.(`${tag} CORS preflight 204 headers=${JSON.stringify(headers)}`);
    res.writeHead(204, headers);
    res.end();
    emit({ method: req.method, url: req.url, status: 204, durationMs: Date.now() - start, kind: 'http' });
    return;
  }
  const cap = rule.capture && capture ? capture.begin(rule.id, { method: req.method, url: req.url, headers: req.headers, kind: 'http' }) : null;

  if (rule.staticDir) {
    const staticPath = buildForwardPath(rule, req.url);
    serveStatic({
      root: rule.staticDir, req, res, urlPath: staticPath,
      extraHeaders: rule.responseHeaders, logger, tag,
      onEvent: (e) => { if (cap) cap.finish({ status: e.status, durationMs: e.durationMs }); emit(e); },
    });
    return;
  }

  const headers = forwardHeaders(rule, req);
  if (!headers.host) headers.host = rule.preserveHost !== false && req.headers.host ? req.headers.host : `${target.host}:${target.port}`;
  if (replacements.length) headers['accept-encoding'] = 'identity';
  const forwardPath = buildForwardPath(rule, req.url);
  const forwardUrl = `${target.protocol}://${target.host}:${target.port}${forwardPath}`;
  if (cap) cap.forward(forwardUrl, headers);
  if (logOn) logger?.info?.(`${tag} -> ${req.method} ${forwardUrl} request headers=${JSON.stringify(headers)}`);
  const opts = { method: req.method, host: target.host, port: target.port, path: forwardPath, headers };
  if (isHttps) opts.rejectUnauthorized = !rule.tlsInsecure;

  const upstreamReq = mod.request(opts, (up) => {
    const status = up.statusCode || 502;
    let kind = 'http';
    if (cap) cap.resHeaders(up.headers);
    if (logOn) logger?.info?.(`${tag} <- ${status} response headers=${JSON.stringify(up.headers)}`);
    if (String(up.headers['content-type'] || '').includes('text/event-stream')) kind = 'sse';
    const canReplace = replacements.length > 0 && kind !== 'sse'
      && isTextualResponse(up.headers) && !up.headers['content-encoding'];

    const finishLog = (durationMs) => {
      if (cap) cap.finish({ status, durationMs });
      emit({ method: req.method, url: req.url, status, durationMs, kind });
    };
    const fail = (e) => {
      const durationMs = Date.now() - start;
      finishLog(durationMs);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          error: 'bad-gateway',
          message: e && e.message ? e.message : 'upstream error',
          target: `${target.protocol}//${target.host}:${target.port}`,
        }));
      } else if (!res.writableEnded) res.end();
    };

    if (!canReplace) {
      res.writeHead(status, applyLocationReplacements(applyResponseHeaders(up.headers, rule.responseHeaders), locationReplacements, { rule, req }));
      up.on('data', (chunk) => {
        if (cap) cap.resBody(chunk);
        if (!res.writableEnded) res.write(chunk);
      });
      up.on('end', () => {
        finishLog(Date.now() - start);
        if (!res.writableEnded) res.end();
      });
      up.on('error', fail);
      return;
    }

    const chunks = [];
    let size = 0;
    let overflow = false;
    up.on('data', (chunk) => {
      if (cap) cap.resBody(chunk);
      if (overflow) { if (!res.writableEnded) res.write(chunk); return; }
      size += chunk.length;
      if (size > REPLACE_MAX_BODY) {
        overflow = true;
        res.writeHead(status, applyLocationReplacements(applyResponseHeaders(up.headers, rule.responseHeaders), locationReplacements, { rule, req }));
        for (const c of chunks) res.write(c);
        chunks.length = 0;
        if (!res.writableEnded) res.write(chunk);
        return;
      }
      chunks.push(chunk);
    });
    up.on('end', () => {
      const durationMs = Date.now() - start;
      if (overflow) {
        finishLog(durationMs);
        if (!res.writableEnded) res.end();
        return;
      }
      const body = applyResponseReplacements(Buffer.concat(chunks), replacements);
      const out = applyLocationReplacements(applyResponseHeaders(up.headers, rule.responseHeaders), locationReplacements, { rule, req });
      delete out['content-encoding'];
      delete out['transfer-encoding'];
      delete out.etag;
      delete out['last-modified'];
      delete out['content-md5'];
      out['content-length'] = String(body.length);
      res.writeHead(status, out);
      res.end(body);
      finishLog(durationMs);
    });
    up.on('error', fail);
  });

  upstreamReq.on('error', (e) => {
    const durationMs = Date.now() - start;
    if (cap) cap.finish({ status: 502, durationMs });
    emit({ method: req.method, url: req.url, status: 502, durationMs, kind: 'http' });
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        error: 'bad-gateway',
        message: e.message,
        target: `${target.protocol}//${target.host}:${target.port}`,
      }));
    } else if (!res.writableEnded) res.end();
  });

  req.on('data', (chunk) => { if (cap) cap.reqBody(chunk); upstreamReq.write(chunk); });
  req.on('end', () => upstreamReq.end());
  req.on('error', () => upstreamReq.destroy());
  res.on('close', () => { if (!upstreamReq.destroyed) upstreamReq.destroy(); });
}
export function proxyWs({ rule, req, socket, head, capture, logger = null }) {
  const target = rule.target;
  const isHttps = target.protocol === 'https';
  const mod = isHttps ? https : http;
  const logOn = !!rule.logRequests;
  const tag = `[nginx:${rule.name || rule.id}]`;
  const cap = rule.capture && capture ? capture.begin(rule.id, { method: 'GET', url: req.url, headers: req.headers, kind: 'ws' }) : null;

  const headers = forwardHeaders(rule, req);
  if (!headers.host) headers.host = rule.preserveHost !== false && req.headers.host ? req.headers.host : `${target.host}:${target.port}`;
  headers.connection = 'Upgrade';
  headers.upgrade = req.headers.upgrade || 'websocket';
  for (const k of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
    if (req.headers[k]) headers[k] = req.headers[k];
  }
  const forwardPath = buildForwardPath(rule, req.url);
  const forwardUrl = `${target.protocol}://${target.host}:${target.port}${forwardPath}`;
  if (cap) cap.forward(forwardUrl, headers);
  if (logOn) logger?.info?.(`${tag} -> GET ${forwardUrl} request headers=${JSON.stringify(headers)}`);
  const opts = { method: 'GET', host: target.host, port: target.port, path: forwardPath, headers };
  if (isHttps) opts.rejectUnauthorized = !rule.tlsInsecure;

  const upstreamReq = mod.request(opts);
  const start = Date.now();

  upstreamReq.on('upgrade', (upRes, upSocket, upHead) => {
    if (logOn) logger?.info?.(`${tag} <- ${upRes.statusCode} response headers=${JSON.stringify(upRes.headers)}`);
    const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}`];
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (Array.isArray(v)) for (const vv of v) lines.push(`${k}: ${vv}`);
      else lines.push(`${k}: ${v}`);
    }
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (upHead && upHead.length) socket.write(upHead);

    const c2s = cap ? new WsFrameParser(true) : null;
    const s2c = cap ? new WsFrameParser(false) : null;
    socket.on('data', (chunk) => {
      if (cap) for (const f of c2s.push(chunk)) cap.frame('c2s', f.opcode, f.payload);
      if (!upSocket.destroyed) upSocket.write(chunk);
    });
    upSocket.on('data', (chunk) => {
      if (cap) for (const f of s2c.push(chunk)) cap.frame('s2c', f.opcode, f.payload);
      if (!socket.destroyed) socket.write(chunk);
    });
    const done = () => {
      if (cap) cap.finish({ status: upRes.statusCode || 101, durationMs: Date.now() - start });
      socket.destroy(); upSocket.destroy();
    };
    socket.on('close', done); socket.on('error', done);
    upSocket.on('close', done); upSocket.on('error', done);
    if (head && head.length) socket.write(head);
  });

  upstreamReq.on('error', () => {
    if (cap) cap.finish({ status: 502, durationMs: Date.now() - start });
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  });
  upstreamReq.end();
}

export function createProxyEngine({ store, capture = null, logger = console, httpServer = null, onEvent = () => {}, rulesPollMs = 60_000 }) {
  const instances = new Map(); // id -> { rule, server, status, error }
  const logs = new Map();      // id -> entry[]

  function pushLog(ruleId, entry) {
    const full = { ts: Date.now(), ...entry };
    const arr = logs.get(ruleId) || [];
    arr.push(full);
    if (arr.length > LOG_LIMIT) arr.splice(0, arr.length - LOG_LIMIT);
    logs.set(ruleId, arr);
    onEvent({ kind: 'log', ruleId, entry: full });
  }

  function emitStatus(ruleId) {
    const e = instances.get(ruleId);
    onEvent({ kind: 'status', ruleId, status: e ? e.status : 'stopped', error: e ? e.error : null });
  }

  function findPathRule(pathname) {
    let best = null;
    for (const { rule } of instances.values()) {
      if (rule.mode !== 'path' || !rule.enabled) continue;
      if (matchPrefix(rule.pathPrefix, pathname)) {
        if (!best || rule.pathPrefix.length > best.pathPrefix.length) best = rule;
      }
    }
    return best;
  }

  function matchPath(pathname) { return !!findPathRule(pathname); }

  function handleHttp(req, res, url) {
    const rule = findPathRule(url.pathname);
    if (!rule) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not-found' })); return; }
    proxyHttp({ rule, req, res, capture, logger, emit: (e) => pushLog(rule.id, e) });
  }

  function onUpgrade(req, socket, head) {
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* default */ }
    const rule = findPathRule(pathname);
    if (!rule) return;
    socket.__proxied = true;
    if (rule.staticDir) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    proxyWs({ rule, req, socket, head, capture, logger });
  }

  function listen(rule) {
    const srv = http.createServer((req, res) => proxyHttp({ rule, req, res, capture, logger, emit: (e) => pushLog(rule.id, e) }));
    srv.on('upgrade', (req, socket, head) => {
      if (rule.staticDir) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      proxyWs({ rule, req, socket, head, capture, logger });
    });
    return new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(rule.listenPort, rule.listenHost, () => { srv.off('error', reject); resolve(srv); });
    });
  }

  async function start(rule) {
    const entry = { rule, server: null, status: 'stopped', error: null };
    instances.set(rule.id, entry);
    if (!rule.enabled) { emitStatus(rule.id); return; }
    try {
      if (rule.mode === 'port') entry.server = await listen(rule);
      entry.status = 'running';
    } catch (e) {
      entry.status = 'error';
      entry.error = e && e.code === 'EADDRINUSE' ? 'port-in-use' : String((e && e.message) || e);
      logger.warn?.(`proxy rule ${rule.id} failed: ${entry.error}`);
    }
    emitStatus(rule.id);
  }

  function stop(id) {
    const entry = instances.get(id);
    if (!entry) return;
    if (entry.server) { try { entry.server.close(); } catch { /* ignore */ } }
    instances.delete(id);
    emitStatus(id);
  }

  async function apply(rule) { stop(rule.id); await start(rule); }
  function remove(id) { stop(id); logs.delete(id); if (capture) capture.removeRule(id); }

  function status() {
    const out = {};
    for (const [id, e] of instances) out[id] = { status: e.status, error: e.error };
    return out;
  }

  async function startEnabled() {
    for (const rule of store.list()) {
      if (rule.enabled) await start(rule);
    }
  }

  async function reloadAll() {
    const list = store.list();
    const ids = new Set(list.map((r) => r.id));
    for (const id of [...instances.keys()]) if (!ids.has(id)) stop(id);
    for (const rule of list) await apply(rule);
  }

// Reload rules.json by mtime (checked every 60s by default).
  if (typeof store.refreshFromDisk === 'function') {
    const timer = setInterval(() => {
      try {
        if (!store.refreshFromDisk()) return;
        logger.info?.('proxy rules changed on disk; reloading');
        void reloadAll().catch((e) => logger.warn?.('proxy rules reload failed', (e && e.message) || e));
      } catch (e) {
        logger.warn?.('proxy rules refresh failed', (e && e.message) || e);
      }
    }, rulesPollMs);
    timer.unref?.();
  }

  if (httpServer) httpServer.on('upgrade', onUpgrade);

  return {
    start, stop, apply, remove, status, matchPath, handleHttp, onUpgrade, startEnabled, reloadAll,
    logs: (id) => logs.get(id) || [],
    _instanceServer: (id) => (instances.get(id) || {}).server,
  };
}
