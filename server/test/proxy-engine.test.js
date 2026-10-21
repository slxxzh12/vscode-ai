import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildForwardPath, forwardHeaders, matchPrefix, createProxyEngine } from '../proxy-engine.js';

const RULE = {
  id: 'r1', name: 'r', mode: 'path', listenHost: '127.0.0.1', listenPort: 0,
  pathPrefix: '/app1', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: 9 },
  tlsInsecure: true, headers: [{ name: 'X-Custom', value: 'v' }], capture: false, enabled: true,
};

test('buildForwardPath：去前缀', () => {
  assert.equal(buildForwardPath(RULE, '/app1/foo?x=1'), '/foo?x=1');
  assert.equal(buildForwardPath(RULE, '/app1'), '/');
  assert.equal(buildForwardPath({ ...RULE, stripPrefix: false }, '/app1/foo'), '/app1/foo');
  assert.equal(buildForwardPath({ ...RULE, mode: 'port' }, '/foo'), '/foo');
});

test('buildForwardPath：路径改写按顺序命中第一条', () => {
  const r = { ...RULE, mode: 'port', rewrites: [{ from: '/app1', to: '/api' }] };
  assert.equal(buildForwardPath(r, '/app1/foo?x=1'), '/api/foo?x=1');
  assert.equal(buildForwardPath(r, '/app1'), '/api');
  assert.equal(buildForwardPath(r, '/app1/'), '/api/');
  assert.equal(buildForwardPath(r, '/app10/x'), '/app10/x');
  assert.equal(buildForwardPath({ ...r, rewrites: [{ from: '/app1', to: '' }] }, '/app1/foo'), '/foo');
  const multi = { ...r, rewrites: [{ from: '/app1', to: '/api' }, { from: '/app1/deep', to: '/other' }] };
  assert.equal(buildForwardPath(multi, '/app1/deep/x'), '/api/deep/x');
  assert.equal(buildForwardPath({ ...RULE, rewrites: [{ from: '/app1', to: '/api' }] }, '/app1/foo'), '/api/foo');
});

test('forwardHeaders：加 X-Forwarded-* 且应用自定义头', () => {
  const req = { headers: { host: 'me:2222', 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '2.2.2.2' } };
  const h = forwardHeaders(RULE, req);
  assert.equal(h['x-forwarded-for'], '1.1.1.1, 2.2.2.2');
  assert.equal(h['x-forwarded-proto'], 'http');
  assert.equal(h['x-forwarded-host'], 'me:2222');
  assert.equal(h['x-custom'], 'v');
  assert.equal(h.host, undefined);
});

test('matchPrefix', () => {
  assert.equal(matchPrefix('/app1', '/app1/foo'), true);
  assert.equal(matchPrefix('/app1', '/app1'), true);
  assert.equal(matchPrefix('/app1', '/app10'), false);
});

function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))); }
async function startUpstream(handler) {
  const srv = http.createServer(handler);
  const port = await listen(srv);
  return { srv, port };
}

test('端到端：端口规则 HTTP 转发 + 头改写', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(JSON.stringify({ url: req.url, host: req.headers.host, xf: req.headers['x-forwarded-for'], custom: req.headers['x-custom'] }));
  });
  const rule = {
    id: 'e2e1', name: 'e2e', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [{ name: 'X-Custom', value: 'z' }], capture: false, enabled: true,
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const body = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/x/y' }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(s));
    });
  });
  const j = JSON.parse(body);
  assert.equal(j.url, '/x/y');
  assert.equal(j.xf.includes('127.0.0.1'), true);
  assert.equal(j.custom, 'z');
  engine.stop(rule.id);
  up.srv.close();
});

test('Host 默认保留访问地址', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(JSON.stringify({ host: req.headers.host }));
  });
  const rule = {
    id: 'e2e-host', name: 'host', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const body = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/', headers: { Host: 'nginx.local:22224' } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(s));
    });
  });
  assert.equal(JSON.parse(body).host, 'nginx.local:22224');
  engine.stop(rule.id);
  up.srv.close();
});

test('preserveHost=false 时 Host 使用上游地址', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(JSON.stringify({ host: req.headers.host }));
  });
  const rule = {
    id: 'e2e-host-off', name: 'host-off', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true, preserveHost: false,
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const body = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/', headers: { Host: 'nginx.local:22224' } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(s));
    });
  });
  assert.equal(JSON.parse(body).host, `127.0.0.1:${up.port}`);
  engine.stop(rule.id);
  up.srv.close();
});

test('自定义 Host 头优先于 preserveHost', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(JSON.stringify({ host: req.headers.host }));
  });
  const rule = {
    id: 'e2e-host-custom', name: 'host-custom', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [{ name: 'Host', value: 'fixed.example:1234' }], capture: false, enabled: true, preserveHost: true,
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const body = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/', headers: { Host: 'nginx.local:22224' } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(s));
    });
  });
  assert.equal(JSON.parse(body).host, 'fixed.example:1234');
  engine.stop(rule.id);
  up.srv.close();
});

test('响应替换：文本响应全局替换并重算长度', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><script src="/old.js"></script></html>');
  });
  const rule = {
    id: 'e2e-replace', name: 'replace', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
    responseReplace: [{ from: '/old.js', to: '/new.js' }],
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const result = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/index.html' }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ body: s, headers: res.headers }));
    });
  });
  assert.match(result.body, /\/new\.js/);
  assert.doesNotMatch(result.body, /\/old\.js/);
  assert.equal(Number(result.headers['content-length']), Buffer.byteLength(result.body));
  engine.stop(rule.id);
  up.srv.close();
});

test('响应头：自定义头与 Set-Cookie 追加', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'up=1', 'x-up': '1' });
    res.end('ok');
  });
  const rule = {
    id: 'e2e-res-header', name: 'res-header', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
    responseHeaders: [
      { name: 'X-Custom', value: 'yes' },
      { name: 'Set-Cookie', value: 'a=1' },
      { name: 'Set-Cookie', value: 'b=2' },
    ],
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const result = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/' }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ body: s, headers: res.headers }));
    });
  });
  assert.equal(result.headers['x-custom'], 'yes');
  assert.deepEqual(result.headers['set-cookie'], ['up=1', 'a=1', 'b=2']);
  engine.stop(rule.id);
  up.srv.close();
});

test('端口被占 → 状态 error（不崩）', async () => {
  const up = await startUpstream(() => {});
  const rule = {
    id: 'e2e2', name: 'busy', mode: 'port', listenHost: '127.0.0.1', listenPort: up.port,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  assert.equal(engine.status()[rule.id].status, 'error');
  up.srv.close();
});
