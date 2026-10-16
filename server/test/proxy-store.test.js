import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProxyStore, normalizeRule } from '../proxy-store.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-proxystore-')), 'rules.json'); }

const PORT_RULE = { name: 'web', mode: 'port', listenHost: '127.0.0.1', listenPort: 18080, target: { protocol: 'http', host: '127.0.0.1', port: 5173 }, enabled: true };
const PATH_RULE = { name: 'app', mode: 'path', pathPrefix: '/app1', stripPrefix: true, target: { protocol: 'http', host: '127.0.0.1', port: 8080 }, enabled: true };

function assertEqualsReload(file, n) {
  const s2 = createProxyStore({ file });
  assert.equal(s2.list().length, n);
}

test('normalizeRule：默认值（tlsInsecure=true / capture=false / stripPrefix=true）', () => {
  const r = normalizeRule(PATH_RULE);
  assert.equal(r.tlsInsecure, true);
  assert.equal(r.capture, false);
  assert.equal(r.stripPrefix, true);
  assert.deepEqual(r.headers, []);
});

test('normalizeRule：非法 mode / 端口 / 保留前缀报错', () => {
  assert.throws(() => normalizeRule({ ...PORT_RULE, mode: 'x' }), (e) => e.code === 'bad-request');
  assert.throws(() => normalizeRule({ ...PORT_RULE, listenPort: 0 }), (e) => e.code === 'bad-request');
  assert.throws(() => normalizeRule({ ...PATH_RULE, pathPrefix: '/api/x' }), (e) => e.code === 'bad-request');
  assert.throws(() => normalizeRule({ ...PATH_RULE, pathPrefix: 'app' }), (e) => e.code === 'bad-request');
});

test('create/update/remove：CRUD 且落盘后重载仍在', () => {
  const file = tmpFile();
  const s = createProxyStore({ file });
  const a = s.create(PORT_RULE);
  assert.ok(a.id);
  assert.equal(a.listenPort, 18080);
  const b = s.create({ ...PATH_RULE, pathPrefix: '/app2' });
  assert.equal(s.list().length, 2);
  const up = s.update(a.id, { name: 'web2', capture: true });
  assert.equal(up.name, 'web2');
  assert.equal(up.capture, true);
  assertEqualsReload(file, 2);
  s.remove(b.id);
  assertEqualsReload(file, 1);
});

test('端口冲突（同 host 同端口均启用）报 port-in-use', () => {
  const s = createProxyStore({ file: tmpFile() });
  s.create(PORT_RULE);
  assert.throws(() => s.create({ ...PORT_RULE, name: 'dup' }), (e) => e.code === 'port-in-use');
});

test('路径前缀冲突（互相包含）报 bad-request', () => {
  const s = createProxyStore({ file: tmpFile() });
  s.create({ ...PATH_RULE, pathPrefix: '/app' });
  assert.throws(() => s.create({ ...PATH_RULE, pathPrefix: '/app/sub' }), (e) => e.code === 'bad-request');
});
