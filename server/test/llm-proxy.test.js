import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolveTarget, extractToken, injectUpstreamAuth, createProxyHandler } from '../llm-proxy.js';
import { signJwt } from '../llm-jwt.js';
import { createCache } from '../llm-cache.js';

test('resolveTarget 拼接 basePath（缺失则补、已含则用）', () => {
  assert.equal(resolveTarget('https://gw/v1', '/chat', '?a=1').toString(), 'https://gw/v1/chat?a=1');
  assert.equal(resolveTarget('https://gw/v1', '/v1/chat', '').toString(), 'https://gw/v1/chat');
  assert.equal(resolveTarget('https://gw', '/chat', '').toString(), 'https://gw/chat');
});

test('extractToken 支持 Bearer 与 x-api-key', () => {
  assert.equal(extractToken({ authorization: 'Bearer abc' }), 'abc');
  assert.equal(extractToken({ 'x-api-key': 'k' }), 'k');
  assert.equal(extractToken({}), '');
});

test('injectUpstreamAuth 覆盖鉴权头', () => {
  const h = injectUpstreamAuth({ authorization: 'Bearer client', 'x-api-key': 'client', 'content-type': 'application/json', host: 'x' }, 'UP');
  assert.equal(h.authorization, 'Bearer UP');
  assert.equal(h['x-api-key'], 'UP');
  assert.equal(h['content-type'], 'application/json');
  assert.equal(h.host, undefined);
});

test('createProxyHandler 校验 JWT 并透传上游', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ got: req.headers['x-api-key'], path: req.url }));
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;

  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  const handler = createProxyHandler({ vault, getProvider: () => ({ baseURL, apiKey: 'UPKEY' }), isEnabled: () => true });
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');

  const front = http.createServer((req, res) => handler(req, res, { providerId: 'corp', rest: req.url, query: '' }));
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  t.after(() => front.close());

  const r = await fetch(`http://127.0.0.1:${front.address().port}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.got, 'UPKEY');
  assert.equal(j.path, '/v1/chat/completions');
});

test('createProxyHandler 停用时 404', async () => {
  const handler = createProxyHandler({ vault: { getData: () => ({ jwtSecret: 'S', tokens: [] }) }, getProvider: () => ({ baseURL: 'http://x/v1', apiKey: '' }), isEnabled: () => false });
  const fakeRes = { code: 0, writeHead(c) { this.code = c; }, end() {} };
  await handler({ method: 'GET', headers: {}, pipe() {} }, fakeRes, { providerId: 'corp', rest: '/x', query: '' });
  assert.equal(fakeRes.code, 404);
});

async function startProxy({ vault, getProvider, isEnabled, cache, plugins }) {
  const handler = createProxyHandler({ vault, getProvider, isEnabled, cache, plugins, logger: { warn() {} } });
  const front = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    handler(req, res, { providerId: 'corp', rest: u.pathname, query: u.search.replace(/^\?/, '') });
  });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  return front;
}

test('非流式同 body 二次请求命中缓存', async (t) => {
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    calls += 1;
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ n: calls, body: b })); });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  const front = await startProxy({ vault, getProvider: () => ({ baseURL, apiKey: 'UP' }), isEnabled: () => true, cache: createCache() });
  t.after(() => front.close());
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
  const url = `http://127.0.0.1:${front.address().port}/chat`;
  const opts = { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"model":"m"}' };
  const r1 = await fetch(url, opts);
  assert.equal(r1.headers.get('x-devflow-cache'), null);
  assert.equal((await r1.json()).n, 1);
  const r2 = await fetch(url, opts);
  assert.equal(r2.headers.get('x-devflow-cache'), 'HIT');
  assert.equal((await r2.json()).n, 1);
  assert.equal(calls, 1);
});

test('流式请求不缓冲、不缓存、不跑 onResponse', async (t) => {
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    calls += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: 1\n\n');
    res.end('data: 2\n\n');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  let onResp = 0;
  const plugins = [{ name: 'r', onResponse: () => { onResp += 1; } }];
  const front = await startProxy({ vault, getProvider: () => ({ baseURL, apiKey: 'UP' }), isEnabled: () => true, cache: createCache(), plugins });
  t.after(() => front.close());
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
  const url = `http://127.0.0.1:${front.address().port}/chat`;
  const opts = { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"stream":true}' };
  const r1 = await fetch(url, opts);
  assert.equal(r1.headers.get('x-devflow-cache'), null);
  await r1.text();
  const r2 = await fetch(url, opts);
  await r2.text();
  assert.equal(calls, 2);
  assert.equal(onResp, 0);
});

test('onCacheKey 返回 null 绕过缓存', async (t) => {
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    calls += 1;
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  const plugins = [{ name: 'k', onCacheKey: () => null }];
  const front = await startProxy({ vault, getProvider: () => ({ baseURL, apiKey: 'UP' }), isEnabled: () => true, cache: createCache(), plugins });
  t.after(() => front.close());
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
  const url = `http://127.0.0.1:${front.address().port}/chat`;
  const opts = { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"model":"m"}' };
  await (await fetch(url, opts)).text();
  const r2 = await fetch(url, opts);
  assert.equal(r2.headers.get('x-devflow-cache'), null);
  await r2.text();
  assert.equal(calls, 2);
});

test('onRequest 可改写 providerId 实现按内容路由', async (t) => {
  const hits = [];
  const mk = (name) => http.createServer((req, res) => {
    hits.push(name);
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ up: name })); });
  });
  const upA = mk('A');
  const upB = mk('B');
  await new Promise((r) => upA.listen(0, '127.0.0.1', r));
  await new Promise((r) => upB.listen(0, '127.0.0.1', r));
  t.after(() => { upA.close(); upB.close(); });
  const providers = {
    a: { baseURL: `http://127.0.0.1:${upA.address().port}/v1`, apiKey: 'A' },
    b: { baseURL: `http://127.0.0.1:${upB.address().port}/v1`, apiKey: 'B' },
  };
  const vault = { getData: () => ({ jwtSecret: 'S', tokens: [{ jti: 'j1', revoked: false }] }) };
  const plugins = [{ name: 'route', onRequest: (c) => ({ providerId: c.json && c.json.model === 'b' ? 'b' : 'a' }) }];
  const handler = createProxyHandler({ vault, getProvider: (id) => providers[id], isEnabled: () => true, plugins, logger: { warn() {} } });
  const front = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); handler(req, res, { providerId: 'a', rest: u.pathname, query: '' }); });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  t.after(() => front.close());
  const token = signJwt({ sub: 'e', jti: 'j1' }, 'S');
  const url = `http://127.0.0.1:${front.address().port}/chat`;
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"model":"b"}' });
  assert.equal((await r.json()).up, 'B');
  assert.deepEqual(hits, ['B']);
});
