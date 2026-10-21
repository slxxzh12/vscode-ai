import http from 'node:http';
import https from 'node:https';
import { WsFrameParser } from './proxy-ws-frames.js';

const LOG_LIMIT = 500;

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

export function proxyHttp({ rule, req, res, capture, emit = () => {} }) {
  const target = rule.target;
  const isHttps = target.protocol === 'https';
  const mod = isHttps ? https : http;
  const start = Date.now();
  const cap = rule.capture && capture ? capture.begin(rule.id, { method: req.method, url: req.url, headers: req.headers, kind: 'http' }) : null;

  const headers = forwardHeaders(rule, req);
  if (!headers.host) headers.host = rule.preserveHost !== false && req.headers.host ? req.headers.host : `${target.host}:${target.port}`;
  const opts = { method: req.method, host: target.host, port: target.port, path: buildForwardPath(rule, req.url), headers };
  if (isHttps) opts.rejectUnauthorized = !rule.tlsInsecure;

  const upstreamReq = mod.request(opts, (up) => {
    let kind = 'http';
    if (cap) cap.resHeaders(up.headers);
    if (String(up.headers['content-type'] || '').includes('text/event-stream')) kind = 'sse';
    res.writeHead(up.statusCode || 502, up.headers);
    up.on('data', (chunk) => {
      if (cap) cap.resBody(chunk);
      if (!res.writableEnded) res.write(chunk);
    });
    up.on('end', () => {
      const durationMs = Date.now() - start;
      if (cap) cap.finish({ status: up.statusCode || 502, durationMs });
      emit({ method: req.method, url: req.url, status: up.statusCode || 502, durationMs, kind });
      if (!res.writableEnded) res.end();
    });
    up.on('error', () => {
      const durationMs = Date.now() - start;
      if (cap) cap.finish({ status: up.statusCode || 502, durationMs });
      emit({ method: req.method, url: req.url, status: up.statusCode || 502, durationMs, kind });
      if (!res.writableEnded) res.end();
    });
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

export function proxyWs({ rule, req, socket, head, capture }) {
  const target = rule.target;
  const isHttps = target.protocol === 'https';
  const mod = isHttps ? https : http;
  const cap = rule.capture && capture ? capture.begin(rule.id, { method: 'GET', url: req.url, headers: req.headers, kind: 'ws' }) : null;

  const headers = forwardHeaders(rule, req);
  if (!headers.host) headers.host = rule.preserveHost !== false && req.headers.host ? req.headers.host : `${target.host}:${target.port}`;
  headers.connection = 'Upgrade';
  headers.upgrade = req.headers.upgrade || 'websocket';
  for (const k of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
    if (req.headers[k]) headers[k] = req.headers[k];
  }
  const opts = { method: 'GET', host: target.host, port: target.port, path: buildForwardPath(rule, req.url), headers };
  if (isHttps) opts.rejectUnauthorized = !rule.tlsInsecure;

  const upstreamReq = mod.request(opts);
  const start = Date.now();

  upstreamReq.on('upgrade', (upRes, upSocket, upHead) => {
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

export function createProxyEngine({ store, capture = null, logger = console, httpServer = null, onEvent = () => {} }) {
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
    proxyHttp({ rule, req, res, capture, emit: (e) => pushLog(rule.id, e) });
  }

  function onUpgrade(req, socket, head) {
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* default */ }
    const rule = findPathRule(pathname);
    if (!rule) return;
    socket.__proxied = true;
    proxyWs({ rule, req, socket, head, capture });
  }

  function listen(rule) {
    const srv = http.createServer((req, res) => proxyHttp({ rule, req, res, capture, emit: (e) => pushLog(rule.id, e) }));
    srv.on('upgrade', (req, socket, head) => proxyWs({ rule, req, socket, head, capture }));
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

  if (httpServer) httpServer.on('upgrade', onUpgrade);

  return {
    start, stop, apply, remove, status, matchPath, handleHttp, onUpgrade, startEnabled,
    logs: (id) => logs.get(id) || [],
    _instanceServer: (id) => (instances.get(id) || {}).server,
  };
}
