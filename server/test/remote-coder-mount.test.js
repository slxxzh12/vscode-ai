import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../projects.js';
import { createHttpApi } from '../http-api.js';
import { SCREEN_FILE } from '../remote-coder-store.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfrc-')); }

function req(server, url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, path: url, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, type: res.headers['content-type'] || '', buf, text: buf.toString('utf8') });
      });
    });
    r.on('error', reject);
    if (data) r.end(data); else r.end();
  });
}

async function start(repoRoot, deps = {}) {
  const server = http.createServer(createHttpApi({ projects: new Projects({ projects: [] }), repoRoot, ...deps }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}
const json = (r) => JSON.parse(r.text);
const png = (s) => `data:image/png;base64,${Buffer.from(s).toString('base64')}`;

test('message 端点：截图命令与文本消息入库，文本为空 400', async (t) => {
  const root = tmpDir();
  const server = await start(root, { remoteCoderGit: async () => '' });
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const shot = json(await req(server, '/api/remote-coder/message', { method: 'POST', body: { kind: 'screenshot' } }));
  assert.equal(shot.ok, true);
  assert.match(shot.id, /^c-/);
  const msg = json(await req(server, '/api/remote-coder/message', { method: 'POST', body: { text: '继续' } }));
  assert.match(msg.id, /^m-/);
  assert.equal((await req(server, '/api/remote-coder/message', { method: 'POST', body: { text: '  ' } })).status, 400);

  const list = json(await req(server, '/api/remote-coder/inbox'));
  assert.deepEqual(list.entries.map((e) => e.kind), ['screenshot', 'message']);
  assert.equal(list.entries[1].text, '继续');
});

test('ack 端点：处理后 inbox 变空', async (t) => {
  const root = tmpDir();
  const server = await start(root, { remoteCoderGit: async () => '' });
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const a = json(await req(server, '/api/remote-coder/message', { method: 'POST', body: { kind: 'screenshot' } }));
  const r = json(await req(server, '/api/remote-coder/ack', { method: 'POST', body: { ids: [a.id] } }));
  assert.deepEqual(r, { ok: true, changed: 1 });
  assert.deepEqual(json(await req(server, '/api/remote-coder/inbox')).entries, []);
});

test('screen 端点：写盘 + commit；state/screen.png 可读；无图 404', async (t) => {
  const root = tmpDir();
  const calls = [];
  const server = await start(root, { remoteCoderGit: async (repo, args) => { calls.push(args); return ''; }, remoteCoderIsGitRepo: () => true });
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

  assert.equal((await req(server, '/api/remote-coder/screen.png')).status, 404);
  assert.deepEqual(json(await req(server, '/api/remote-coder/state')), { rev: '' });

  const r = json(await req(server, '/api/remote-coder/screen', { method: 'POST', body: { dataUrl: png('ONE') } }));
  assert.equal(r.ok, true);
  assert.equal(r.uploaded, true);
  assert.equal(r.reason, '');
  assert.ok(r.rev);
  assert.equal(fs.readFileSync(path.join(root, 'remote_coder', SCREEN_FILE), 'utf8'), 'ONE');
  assert.deepEqual(calls[1], ['commit', '-m', `snapshot(remote): ${SCREEN_FILE}`, '--', `remote_coder/${SCREEN_FILE}`]);

  const img = await req(server, '/api/remote-coder/screen.png');
  assert.equal(img.status, 200);
  assert.equal(img.type, 'image/png');
  assert.equal(img.buf.toString('utf8'), 'ONE');
  assert.equal(json(await req(server, '/api/remote-coder/state')).rev, r.rev);

  await new Promise((r2) => setTimeout(r2, 12));
  const second = json(await req(server, '/api/remote-coder/screen', { method: 'POST', body: { dataUrl: png('TWO') } }));
  assert.equal(fs.readdirSync(path.join(root, 'remote_coder')).filter((f) => f.endsWith('.png')).length, 1);
  assert.notEqual(second.rev, r.rev);
});

test('screen 端点：坏图 400；非 git 只回 reason 仍 200', async (t) => {
  const root = tmpDir();
  const server = await start(root);
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal((await req(server, '/api/remote-coder/screen', { method: 'POST', body: { dataUrl: 'data:image/jpeg;base64,AAAA' } })).status, 400);
  const r = json(await req(server, '/api/remote-coder/screen', { method: 'POST', body: { dataUrl: png('X') } }));
  assert.equal(r.ok, true);
  assert.equal(r.uploaded, false);
  assert.equal(r.reason, 'not-a-repo');
});

test('旧 /api/snapshot 已移除（404）', async (t) => {
  const root = tmpDir();
  const server = await start(root);
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal((await req(server, '/api/snapshot', { method: 'POST', body: { dataUrl: png('X') } })).status, 404);
});
