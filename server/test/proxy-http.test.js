import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProxyMount } from '../proxy-mount.js';

function makeFakes() {
  const rules = [];
  const applied = [];
  const store = {
    list: () => rules.slice(),
    get: (id) => { const r = rules.find((x) => x.id === id); if (!r) { const e = new Error('nf'); e.code = 'not-found'; throw e; } return r; },
    create: (input) => { const r = { id: String(rules.length + 1), mode: 'port', enabled: false, target: { host: 'h', port: 1, protocol: 'http' }, ...input }; rules.push(r); return r; },
    update: (id, patch) => { const r = store.get(id); Object.assign(r, patch); return r; },
    remove: (id) => { const i = rules.findIndex((x) => x.id === id); if (i < 0) return false; rules.splice(i, 1); return true; },
  };
  const engine = { apply: async (r) => applied.push(r.id), remove: () => {}, start: async () => {}, stop: () => {}, status: () => ({}), logs: () => [] };
  const capture = { list: () => [{ id: 'c1' }], read: () => ({ record: { id: 'c1' } }), clear: () => {} };
  return { store, engine, capture, applied };
}

function call(mount, method, url, body) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => mount(req, res, new URL(req.url, 'http://x')));
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: data ? { 'content-type': 'application/json' } : {} }, (res) => {
        let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { srv.close(); resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }); });
      });
      if (data) req.write(data);
      req.end();
    });
  });
}

test('rules GET/POST/PATCH/DELETE', async () => {
  const { store, engine, capture, applied } = makeFakes();
  const mount = createProxyMount({ store, engine, capture });
  const created = await call(mount, 'POST', '/api/nginx/rules', { name: 'a', mode: 'port', listenPort: 18080, target: { protocol: 'http', host: '127.0.0.1', port: 1 } });
  assert.equal(created.status, 200);
  assert.equal(created.body.item.name, 'a');
  assert.deepEqual(applied, [created.body.item.id]);
  const list = await call(mount, 'GET', '/api/nginx/rules');
  assert.equal(list.body.items.length, 1);
  const patched = await call(mount, 'PATCH', '/api/nginx/rules', { id: created.body.item.id, name: 'b' });
  assert.equal(patched.body.item.name, 'b');
  const del = await call(mount, 'DELETE', `/api/nginx/rules?id=${created.body.item.id}`);
  assert.equal(del.body.ok, true);
});

test('start/stop 端点', async () => {
  const { store, engine, capture } = makeFakes();
  const mount = createProxyMount({ store, engine, capture });
  const r = await call(mount, 'POST', '/api/nginx/rules', { name: 'a', mode: 'port', listenPort: 18081, target: { protocol: 'http', host: '127.0.0.1', port: 1 } });
  const started = await call(mount, 'POST', `/api/nginx/rules/start?id=${r.body.item.id}`);
  assert.equal(started.body.ok, true);
});

test('captures 列表/详情/清空', async () => {
  const { store, engine, capture } = makeFakes();
  const mount = createProxyMount({ store, engine, capture });
  const l = await call(mount, 'GET', '/api/nginx/captures?rule=r1');
  assert.equal(l.body.items.length, 1);
  const d = await call(mount, 'GET', '/api/nginx/captures/r1/c1');
  assert.equal(d.body.item.record.id, 'c1');
  const c = await call(mount, 'DELETE', '/api/nginx/captures?rule=r1');
  assert.equal(c.body.ok, true);
});

test('未知路径 404', async () => {
  const { store, engine, capture } = makeFakes();
  const mount = createProxyMount({ store, engine, capture });
  const r = await call(mount, 'GET', '/api/nginx/nope');
  assert.equal(r.status, 404);
});
