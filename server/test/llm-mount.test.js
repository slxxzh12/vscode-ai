import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVault } from '../llm-vault.js';
import { createLlmMount } from '../llm-mount.js';

function tmpVault() { return createVault({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-')), 'llm.vault.json') }); }

async function start(vault) {
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://x'); mount(req, res, url); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}
function jpost(server, url, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', reject); req.end(data);
  });
}
function jget(server, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject);
  });
}

test('init/secret/token 流程', async (t) => {
  const vault = tmpVault();
  const server = await start(vault);
  t.after(() => server.close());
  assert.equal((await jpost(server, '/api/llm-admin/vault/init', { passphrase: 'pw' })).status, 200);
  assert.equal((await jpost(server, '/api/llm-admin/secret', {})).status, 200);
  const tok = await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 30 });
  assert.equal(tok.status, 200);
  const rec = JSON.parse(tok.body).token;
  assert.equal(rec.jwt.split('.').length, 3);
  const st = await jget(server, '/api/llm-admin/tokens');
  assert.equal(JSON.parse(st.body).tokens.length, 1);
});

test('未解锁时受保护接口 423，status 可读', async (t) => {
  const vault = tmpVault();
  vault.init('pw');
  vault.lock();
  const server = await start(vault);
  t.after(() => server.close());
  assert.equal((await jget(server, '/api/llm-admin/status')).status, 200);
  assert.equal((await jget(server, '/api/llm-admin/tokens')).status, 423);
});

test('重置密钥库：锁定态也可重置并回到未初始化', async (t) => {
  const vault = tmpVault();
  vault.init('pw');
  vault.update((d) => { d.jwtSecret = 'S'; });
  vault.lock();
  const server = await start(vault);
  t.after(() => server.close());
  const r = await jpost(server, '/api/llm-admin/vault/reset', {});
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).vault, { initialized: false, unlocked: false });
  assert.equal((await jget(server, '/api/llm-admin/tokens')).status, 423);
  assert.equal((await jpost(server, '/api/llm-admin/vault/init', { passphrase: 'pw2' })).status, 200);
});
