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
