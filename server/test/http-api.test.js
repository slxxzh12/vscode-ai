import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../projects.js';
import { createHttpApi } from '../http-api.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfapi-')); }

async function request(server, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function start(projects) {
  const server = http.createServer(createHttpApi({ projects }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

test('/api/projects 返回列表', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/projects');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).projects, [{ id: 'a', name: 'A', root: dir }]);
});

test('/api/tree 正常返回 items', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'f.txt'), '');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/tree?project=a&path=');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { items: [{ name: 'f.txt', type: 'file' }] });
});

test('/api/tree 越界返回 403', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/tree?project=a&path=..%2F..%2F..');
  assert.equal(r.status, 403);
});

test('/api/tree 未知项目返回 404', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/tree?project=nope&path=');
  assert.equal(r.status, 404);
});

test('非 /api 路由返回 404 json', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/nope');
  assert.equal(r.status, 404);
});
