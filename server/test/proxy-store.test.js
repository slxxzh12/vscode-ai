import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProxyStore, normalizeRule, deepseekFlashSample } from '../proxy-store.js';

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
  assert.equal(r.preserveHost, true);
  assert.deepEqual(r.headers, []);
  assert.deepEqual(r.responseReplace, []);
  assert.deepEqual(r.locationReplace, []);
  assert.deepEqual(r.responseHeaders, []);
  assert.equal(r.corsPreflight, false);
  assert.equal(r.directResponse, false);
  assert.equal(r.directStatus, 200);
  assert.equal(r.directContentType, 'application/json; charset=utf-8');
  assert.equal(r.directBody, '');
  assert.equal(normalizeRule({ ...PATH_RULE, preserveHost: false }).preserveHost, false);
  assert.equal(normalizeRule({ ...PATH_RULE, corsPreflight: true }).corsPreflight, true);
  const direct = normalizeRule({ ...PATH_RULE, directResponse: true, directStatus: 404, directContentType: 'text/plain', directBody: 'nope' });
  assert.equal(direct.directResponse, true);
  assert.equal(direct.directStatus, 404);
  assert.equal(direct.directContentType, 'text/plain');
  assert.equal(direct.directBody, 'nope');
  assert.equal(normalizeRule({ ...PATH_RULE, directStatus: 999 }).directStatus, 200);
  const rw = normalizeRule({
    ...PORT_RULE,
    rewrites: [{ from: '/mock', to: '', directResponse: true, directStatus: 201, directContentType: 'text/plain', directBody: 'ok', directHeaders: [{ name: 'Location', value: 'https://x' }, { name: '' }] }],
  }).rewrites[0];
  assert.equal(rw.directResponse, true);
  assert.equal(rw.directStatus, 201);
  assert.equal(rw.directContentType, 'text/plain');
  assert.equal(rw.directBody, 'ok');
  assert.deepEqual(rw.directHeaders, [{ name: 'Location', value: 'https://x' }]);
  assert.deepEqual(normalizeRule({ ...PORT_RULE, rewrites: [{ from: '/x', to: '/y' }] }).rewrites, [{ from: '/x', to: '/y' }]);
  assert.deepEqual(
    normalizeRule({ ...PATH_RULE, responseHeaders: [{ name: 'X-Test', value: '1' }, { name: '' }] }).responseHeaders,
    [{ name: 'X-Test', value: '1' }],
  );
  assert.deepEqual(
    normalizeRule({ ...PATH_RULE, responseHeaders: [{ name: 'Set-Cookie', value: 'a=1; b=2' }] }).responseHeaders,
    [{ name: 'Set-Cookie', value: 'a=1' }, { name: 'Set-Cookie', value: 'b=2' }],
  );
  assert.deepEqual(
    normalizeRule({ ...PATH_RULE, responseHeaders: [{ name: 'Set-Cookie', value: 'a=1; Path=/; HttpOnly' }] }).responseHeaders,
    [{ name: 'Set-Cookie', value: 'a=1; Path=/; HttpOnly' }],
  );
  assert.deepEqual(
    normalizeRule({ ...PATH_RULE, locationReplace: [{ from: 'https://a', to: 'http://b' }, { from: '  ' }] }).locationReplace,
    [{ from: 'https://a', to: 'http://b' }],
  );
  assert.deepEqual(
    normalizeRule({ ...PATH_RULE, responseReplace: [{ from: 'old', to: 'new' }, { from: '  ' }, {}] }).responseReplace,
    [{ from: 'old', to: 'new' }],
  );
});

test('normalizeRule：非法 mode / 端口 / 保留前缀报错', () => {
  assert.throws(() => normalizeRule({ ...PORT_RULE, mode: 'x' }), (e) => e.code === 'bad-request');
  assert.throws(() => normalizeRule({ ...PORT_RULE, listenPort: 0 }), (e) => e.code === 'bad-request');
  assert.throws(() => normalizeRule({ ...PATH_RULE, pathPrefix: '/api/x' }), (e) => e.code === 'bad-request');
  assert.throws(() => normalizeRule({ ...PATH_RULE, pathPrefix: 'app' }), (e) => e.code === 'bad-request');
});

test('normalizeRule：路径改写允许根路径 / 到 /', () => {
  const r = normalizeRule({ ...PORT_RULE, rewrites: [{ from: '/', to: '/' }] });
  assert.deepEqual(r.rewrites, [{ from: '/', to: '' }]);
});

test('normalizeRule：路径改写（两种模式都支持，非法规则报 bad-rewrite）', () => {
  assert.deepEqual(normalizeRule(PORT_RULE).rewrites, []);
  assert.deepEqual(
    normalizeRule({ ...PORT_RULE, rewrites: [{ from: '/app1', to: '/api' }, { from: '/x', to: '' }, { from: '' }] }).rewrites,
    [{ from: '/app1', to: '/api' }, { from: '/x', to: '' }],
  );
  assert.equal(normalizeRule({ ...PORT_RULE, rewrites: [{ from: '/x', to: '/api/' }] }).rewrites[0].to, '/api');
  assert.throws(() => normalizeRule({ ...PORT_RULE, rewrites: [{ from: 'app', to: '/api' }] }), (e) => e.code === 'bad-rewrite');
  assert.throws(() => normalizeRule({ ...PORT_RULE, rewrites: [{ from: '/app', to: 'api' }] }), (e) => e.code === 'bad-rewrite');
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

test('监听地址允许正常 IP；缺省为 0.0.0.0', () => {
  assert.equal(normalizeRule({ ...PORT_RULE, listenHost: '192.168.1.10' }).listenHost, '192.168.1.10');
  assert.equal(normalizeRule({ ...PORT_RULE, listenHost: '' }).listenHost, '0.0.0.0');
});

test('监听端口占用 devflow 自身端口或 LLM 中转端口 → port-in-use', () => {
  const s = createProxyStore({ file: tmpFile(), reservedPorts: [22222, 22223] });
  assert.throws(() => s.create({ ...PORT_RULE, listenPort: 22222 }), (e) => e.code === 'port-in-use');
  assert.throws(() => s.create({ ...PORT_RULE, listenPort: 22223 }), (e) => e.code === 'port-in-use');
});

test('首次创建（文件不存在）写入 DeepSeek 样例，且不会重复 seed', () => {
  const file = tmpFile();
  const s = createProxyStore({ file, seed: [deepseekFlashSample()] });
  const list = s.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'deepseek-flash');
  assert.equal(list[0].enabled, true);
  assert.equal(list[0].listenPort, 22224);
  assert.equal(list[0].tlsInsecure, true);
  assert.equal(list[0].target.host, 'api.deepseek.com');
  assert.equal(list[0].target.protocol, 'https');
  assert.equal(list[0].headers[0].value, 'Bearer ak-123456');
  assert.deepEqual(list[0].rewrites, [{ from: '/rest/v1', to: '/v1' }, { from: '/v2', to: '/v1' }]);
  const s2 = createProxyStore({ file, seed: [deepseekFlashSample()] });
  assert.equal(s2.list().length, 1);
});

test('旧 DeepSeek 样例自动迁移到新默认端口并默认启用', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ items: [{
    id: 'old', name: 'deepseek-flash', mode: 'port', listenHost: '0.0.0.0', listenPort: 18090,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'https', host: 'api.deepseek.com', port: 443 },
    tlsInsecure: false, headers: [{ name: 'Authorization', value: 'Bearer ak-123456' }],
    rewrites: [], capture: false, enabled: false,
  }] }), 'utf8');
  const s = createProxyStore({ file });
  const r = s.list()[0];
  assert.equal(r.listenPort, 22224);
  assert.equal(r.enabled, true);
  assert.equal(r.tlsInsecure, true);
  assert.deepEqual(r.rewrites, [{ from: '/rest/v1', to: '/v1' }, { from: '/v2', to: '/v1' }]);
  assertEqualsReload(file, 1);
});

test('DeepSeek 样例已有的错误 /v1→/v2 改写会替换为 /rest/v1 样例', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ items: [{
    id: 'new', name: 'deepseek-flash', mode: 'port', listenHost: '0.0.0.0', listenPort: 22224,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'https', host: 'api.deepseek.com', port: 443 },
    tlsInsecure: false, headers: [], rewrites: [{ from: '/v1', to: '/v2' }], capture: false, enabled: true,
  }] }), 'utf8');
  const s = createProxyStore({ file });
  assert.deepEqual(s.list()[0].rewrites, [{ from: '/rest/v1', to: '/v1' }, { from: '/v2', to: '/v1' }]);
});

test('新端口的样例只保留部分样例改写时补齐 v2', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ items: [{
    id: 'partial', name: 'deepseek-flash', mode: 'port', listenHost: '0.0.0.0', listenPort: 22224,
    pathPrefix: '', stripPrefix: true, target: { protocol: 'https', host: 'api.deepseek.com', port: 443 },
    tlsInsecure: false, headers: [], rewrites: [{ from: '/rest/v1', to: '/v1' }], capture: false, enabled: true,
  }] }), 'utf8');
  const s = createProxyStore({ file });
  assert.deepEqual(s.list()[0].rewrites, [{ from: '/rest/v1', to: '/v1' }, { from: '/v2', to: '/v1' }]);
});

test('refreshFromDisk：手动改文件且 mtime 更新后重新加载', () => {
  const file = tmpFile();
  const s = createProxyStore({ file });
  const a = s.create(PORT_RULE);
  assert.equal(s.refreshFromDisk(), false);
  fs.writeFileSync(file, JSON.stringify({ items: [{ ...a, name: 'manual' }] }), 'utf8');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(file, future, future);
  assert.equal(s.refreshFromDisk(), true);
  assert.equal(s.list()[0].name, 'manual');
  assert.equal(s.refreshFromDisk(), false);
});

test('路径前缀冲突（互相包含）报 bad-request', () => {
  const s = createProxyStore({ file: tmpFile() });
  s.create({ ...PATH_RULE, pathPrefix: '/app' });
  assert.throws(() => s.create({ ...PATH_RULE, pathPrefix: '/app/sub' }), (e) => e.code === 'bad-request');
});
