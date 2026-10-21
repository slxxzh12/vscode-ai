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

test('自定义请求头 Cookie 覆盖客户端发来的 Cookie', () => {
  const req = { headers: { host: 'me:2222', cookie: 'client=1' }, socket: { remoteAddress: '2.2.2.2' } };
  const h = forwardHeaders({ ...RULE, headers: [{ name: 'Cookie', value: 'server=2' }] }, req);
  assert.equal(h.cookie, 'server=2');
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

test('响应头：自定义头直接覆盖，Set-Cookie 不再合并上游', async () => {
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
  assert.deepEqual(result.headers['set-cookie'], ['a=1', 'b=2']);
  engine.stop(rule.id);
  up.srv.close();
});

test('自定义 Set-Cookie 直接覆盖上游全部 Cookie', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': ['sid=old; Path=/', 'keep=1; Path=/'] });
    res.end('ok');
  });
  const rule = {
    id: 'e2e-cookie-override', name: 'cookie-override', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
    responseHeaders: [{ name: 'Set-Cookie', value: 'sid=new; Path=/' }],
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const result = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/' }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ headers: res.headers }));
    });
  });
  assert.deepEqual(result.headers['set-cookie'], ['sid=new; Path=/']);
  engine.stop(rule.id);
  up.srv.close();
});

test('directResponse 直接返回配置结果，不请求上游', async () => {
  let hits = 0;
  const up = await startUpstream((req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('upstream');
  });
  const rule = {
    id: 'e2e-direct', name: 'direct', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
    directResponse: true, directStatus: 201, directContentType: 'text/plain; charset=utf-8',
    directBody: 'mock-body', responseHeaders: [{ name: 'X-Mock', value: 'yes' }],
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const result = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/any' }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ body: s, status: res.statusCode, headers: res.headers }));
    });
  });
  assert.equal(hits, 0);
  assert.equal(result.status, 201);
  assert.equal(result.body, 'mock-body');
  assert.equal(result.headers['x-mock'], 'yes');
  assert.match(String(result.headers['content-type']), /text\/plain/);
  assert.equal(Number(result.headers['content-length']), Buffer.byteLength('mock-body'));
  engine.stop(rule.id);
  up.srv.close();
});

test('响应替换：302 跳转的 Location 也会改写', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(302, { location: 'https://api.example.com/oauth/authorize?x=1' });
    res.end();
  });
  const rule = {
    id: 'e2e-location', name: 'location', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
    responseReplace: [{ from: 'https://api.example.com', to: 'http://127.0.0.1:22224' }],
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const result = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/login' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
  });
  assert.equal(result.status, 302);
  assert.equal(result.headers.location, 'http://127.0.0.1:22224/oauth/authorize?x=1');
  engine.stop(rule.id);
  up.srv.close();
});

test('路径改写上的直接返回只对命中路径生效，其他路径继续转发', async () => {
  let hits = 0;
  const up = await startUpstream((req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`upstream:${req.url}`);
  });
  const rule = {
    id: 'e2e-rewrite-direct', name: 'rewrite-direct', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
    rewrites: [
      { from: '/mock', to: '', directResponse: true, directStatus: 418, directContentType: 'application/json', directBody: '{"mock":true}' },
      { from: '/redirect', to: '', directResponse: true, directStatus: 302, directHeaders: [{ name: 'Location', value: 'https://api.example.com/next' }] },
      { from: '/api', to: '/v1' },
    ],
    responseReplace: [{ from: 'https://api.example.com', to: 'http://proxy.local' }],
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const get = (path) => new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, body: s, headers: res.headers }));
    });
  });
  const mocked = await get('/mock/x');
  assert.equal(mocked.status, 418);
  assert.equal(mocked.body, '{"mock":true}');
  assert.equal(hits, 0);
  const redirect = await get('/redirect');
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.location, 'http://proxy.local/next');
  const proxied = await get('/api/x');
  assert.equal(proxied.status, 200);
  assert.equal(proxied.body, 'upstream:/v1/x');
  assert.equal(hits, 1);
  engine.stop(rule.id);
  up.srv.close();
});

test('302 Location 指向上游自身时自动改为当前代理地址', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${up.port}/next` });
    res.end();
  });
  const rule = {
    id: 'e2e-location-auto', name: 'location-auto', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const result = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/login' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
  });
  assert.equal(result.status, 302);
  assert.equal(result.headers.location, `http://127.0.0.1:${addr.port}/next`);
  engine.stop(rule.id);
  up.srv.close();
});

test('跳转地址替换：locationReplace 专门改写 302 Location', async () => {
  const up = await startUpstream((req, res) => {
    res.writeHead(302, { location: 'https://auth.example.com/sso?next=%2Fhome' });
    res.end();
  });
  const rule = {
    id: 'e2e-location-replace', name: 'location-replace', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
    locationReplace: [{ from: 'https://auth.example.com', to: 'http://127.0.0.1:22224' }],
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const result = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/login' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
  });
  assert.equal(result.status, 302);
  assert.equal(result.headers.location, 'http://127.0.0.1:22224/sso?next=%2Fhome');
  engine.stop(rule.id);
  up.srv.close();
});

test('logRequests=true 时打印完整请求/响应头', async () => {
  const logs = [];
  const logger = { info: (msg) => logs.push(String(msg)), warn: () => {} };
  const up = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'sid=secret' });
    res.end('ok');
  });
  const rule = {
    id: 'e2e-log', name: 'log', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [{ name: 'Authorization', value: 'Bearer secret-token' }],
    capture: false, enabled: true, logRequests: true,
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/x' }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
  });
  const text = logs.join('\n');
  assert.match(text, /request headers/);
  assert.match(text, /response headers/);
  assert.match(text, /Bearer secret-token/);
  assert.match(text, /sid=secret/);
  engine.stop(rule.id);
  up.srv.close();
});

test('CORS 预检直接返回 204，不请求上游', async () => {
  let hits = 0;
  const up = await startUpstream((req, res) => { hits += 1; res.end('upstream'); });
  const rule = {
    id: 'e2e-cors', name: 'cors', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: up.port },
    tlsInsecure: true, headers: [], capture: false, enabled: true, corsPreflight: true,
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const addr = engine._instanceServer(rule.id).address();
  const result = await new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: addr.port, path: '/api/x', method: 'OPTIONS',
      headers: {
        Origin: 'http://ui.local',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, authorization',
      },
    }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s }));
    });
    req.end();
  });
  assert.equal(result.status, 204);
  assert.equal(result.headers['access-control-allow-origin'], 'http://ui.local');
  assert.match(result.headers['access-control-allow-methods'], /POST/);
  assert.equal(result.headers['access-control-allow-headers'], 'content-type, authorization');
  assert.equal(hits, 0);
  engine.stop(rule.id);
  up.srv.close();
});

test('apply 同端口重载：先关闭旧监听再启动，不会 port-in-use', async () => {
  const rule = {
    id: 'e2e-apply', name: 'apply', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: 9 },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
  };
  const store = { list: () => [rule], get: () => rule };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(rule);
  const actual = engine._instanceServer(rule.id).address().port;
  await engine.apply({ ...rule, listenPort: actual, name: 'apply-updated' });
  assert.equal(engine.status()[rule.id].status, 'running');
  engine.stop(rule.id);
});

test('reloadAll：按 store 最新列表重载并移除已删除规则', async () => {
  const a = {
    id: 'reload-a', name: 'a', mode: 'port', listenHost: '127.0.0.1', listenPort: 0,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: 9 },
    tlsInsecure: true, headers: [], capture: false, enabled: true,
  };
  const b = { ...a, id: 'reload-b', name: 'b' };
  const list = [a, b];
  const store = { list: () => list.slice(), get: (id) => list.find((x) => x.id === id) };
  const engine = createProxyEngine({ store, capture: null, logger: console });
  await engine.start(a);
  await engine.start(b);
  list.splice(1, 1);
  await engine.reloadAll();
  assert.equal(engine.status()[a.id].status, 'running');
  assert.equal(engine.status()[b.id], undefined);
  engine.stop(a.id);
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
