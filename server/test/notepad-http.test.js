import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHttpApi } from '../http-api.js';
import { createNotepadStore } from '../notepad-store.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-np-http-')); }

async function start(fileStores) {
  const notepadStore = createNotepadStore({ dir: tmpDir() });
  const projects = { listProjects: () => [], resolveAbsolute: () => ({ project: 'p', rel: 'r' }) };
  const api = createHttpApi({ projects, notepadStore, fileStores });
  const server = http.createServer(api);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  return { store: notepadStore, port: server.address().port, server };
}
function call(port, method, p, body) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

test('notepad：新建文件/写/读/树/重命名/移动/删除', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const create = await call(A.port, 'POST', '/api/notepad/file', { folder: '', name: 'a.txt' });
  assert.equal(create.status, 200);
  assert.equal(create.body.id, 'a.txt');

  const put = await call(A.port, 'PUT', '/api/notepad/file', { id: 'a.txt', content: 'hi' });
  assert.equal(put.status, 200);
  const get = await call(A.port, 'GET', '/api/notepad/file?id=a.txt');
  assert.equal(get.body.content, 'hi');

  const tree = await call(A.port, 'GET', '/api/notepad/tree');
  assert.equal(tree.body.items[0].id, 'a.txt');

  const mk = await call(A.port, 'POST', '/api/notepad/folder', { path: 'd' });
  assert.equal(mk.status, 200);
  const mv = await call(A.port, 'POST', '/api/notepad/move', { id: 'a.txt', folder: 'd' });
  assert.equal(mv.status, 200);
  const ren = await call(A.port, 'PATCH', '/api/notepad/file', { id: 'd/a.txt', name: 'b.txt' });
  assert.equal(ren.body.id, 'd/b.txt');
  const del = await call(A.port, 'DELETE', '/api/notepad/file?id=d/b.txt');
  assert.equal(del.status, 200);
});

test('notepad：已存在 → 409，非法路径 → 400，不存在 → 404', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  await call(A.port, 'POST', '/api/notepad/file', { folder: '', name: 'x.txt' });
  const dup = await call(A.port, 'POST', '/api/notepad/file', { folder: '', name: 'x.txt' });
  assert.equal(dup.status, 409);
  const bad = await call(A.port, 'PUT', '/api/notepad/file', { id: '../x.txt', content: 'z' });
  assert.equal(bad.status, 400);
  const missing = await call(A.port, 'GET', '/api/notepad/file?id=nope.txt');
  assert.equal(missing.status, 404);
});

test('files：每个 tool 独立目录，互不可见，未知 tool 404', async (t) => {
  const stores = {
    notepad: createNotepadStore({ dir: tmpDir() }),
    yaml: createNotepadStore({ dir: tmpDir() }),
    js: createNotepadStore({ dir: tmpDir() }),
  };
  const A = await start(stores);
  t.after(() => A.server.close());
  await call(A.port, 'POST', '/api/files/yaml/file', { folder: '', name: 'a.yaml' });
  const yamlTree = await call(A.port, 'GET', '/api/files/yaml/tree');
  assert.equal(yamlTree.body.items.length, 1);
  const jsTree = await call(A.port, 'GET', '/api/files/js/tree');
  assert.equal(jsTree.body.items.length, 0);
  const unknown = await call(A.port, 'GET', '/api/files/nope/tree');
  assert.equal(unknown.status, 404);
});

function callText(port, p) {
  return fetch(`http://127.0.0.1:${port}${p}`).then(async (res) => ({
    status: res.status,
    ctype: res.headers.get('content-type') || '',
    text: await res.text(),
  }));
}

test('notepad：/api/notepad/search 流式返回 NDJSON 事件', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  await call(A.port, 'POST', '/api/notepad/file', { folder: '', name: 'target.txt' });
  await call(A.port, 'PUT', '/api/notepad/file', { id: 'target.txt', content: 'target line\nother\n' });
  const r = await callText(A.port, '/api/notepad/search?q=target&name=1&content=1');
  assert.equal(r.status, 200);
  assert.match(r.ctype, /application\/x-ndjson/);
  const evs = r.text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(evs.some((e) => e.type === 'name' && e.hits.some((h) => h.path === 'target.txt')));
  assert.ok(evs.some((e) => e.type === 'content' && e.path === 'target.txt'));
  assert.equal(evs.at(-1).type, 'done');

  const bad = await callText(A.port, '/api/notepad/search?q=');
  assert.equal(bad.status, 400);
});
