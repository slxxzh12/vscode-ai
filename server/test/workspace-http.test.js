import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProfile, createWorkspaceService } from '../workspace.js';
import { createWorkspaceHttp } from '../workspace-http.js';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-wsh-')); }

async function start(service) {
  const handler = createWorkspaceHttp({ service });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    Promise.resolve(handler(req, res, url)).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

function get(server, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url, agent: false }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
  });
}

function post(server, url, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject); req.end(data);
  });
}

function closeServer(server) {
  server.closeAllConnections?.();
  server.close();
}

test('state 列出档案与项目数', async () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  fs.writeFileSync(path.join(root, 'ports', 'a', 'projects.json'), JSON.stringify({ projects: [{ id: 'x' }] }), 'utf8');
  const service = createWorkspaceService({ root, listenPort: 22222, onProfile: () => {} });
  const server = await start(service);
  const r = await get(server, '/api/workspace/state');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.needSelect, true);
  assert.equal(j.profiles[0].id, 'a');
  assert.equal(j.profiles[0].projectCount, 1);
  closeServer(server);
});

test('select 写映射并触发 onProfile', async () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  let ready = null;
  const service = createWorkspaceService({ root, listenPort: 22222, onProfile: (paths) => { ready = paths.id; } });
  const server = await start(service);
  const r = await post(server, '/api/workspace/select', { id: 'a' });
  assert.equal(r.status, 200);
  assert.equal(ready, 'a');
  const st = JSON.parse(fs.readFileSync(path.join(root, 'ports-state.json'), 'utf8'));
  assert.equal(st.byListenPort['22222'], 'a');
  closeServer(server);
});

test('select 不存在 -> 404', async () => {
  const root = tmpRoot();
  const service = createWorkspaceService({ root, listenPort: 22222, onProfile: () => {} });
  const server = await start(service);
  const r = await post(server, '/api/workspace/select', { id: 'nope' });
  assert.equal(r.status, 404);
  closeServer(server);
});

test('create 以监听端口为 id 新建', async () => {
  const root = tmpRoot();
  const service = createWorkspaceService({ root, listenPort: 33333, onProfile: () => {} });
  const server = await start(service);
  const r = await post(server, '/api/workspace/create', { name: '工作区' });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).profile.id, '33333');
  closeServer(server);
});
