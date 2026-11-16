import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDiskCleanMount } from '../disk-clean/mount.js';

function req(server, url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, path: url, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (data) r.end(data); else r.end();
  });
}

function start(mount) {
  const server = http.createServer((rq, rs) => {
    const url = new URL(rq.url, 'http://127.0.0.1');
    void mount(rq, rs, url);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const json = (r) => JSON.parse(r.text);

test('mount：非 Windows 返回 501', async (t) => {
  const mount = createDiskCleanMount({ platform: 'linux' });
  const server = await start(mount);
  t.after(() => server.close());
  const r = await req(server, '/api/disk-clean/overview');
  assert.equal(r.status, 501);
});

test('mount：settings 读写与非法自定义目录', async (t) => {
  let saved = { exclusions: { dirs: [], patterns: [] }, customDirs: [] };
  const store = {
    readSettings: () => saved,
    writeSettings: (v) => { saved = v; return saved; },
    readHistory: () => [],
    appendHistory: () => {},
  };
  const mount = createDiskCleanMount({
    platform: 'win32',
    store,
    validateCustomDir: () => ({ ok: false, error: 'drive_root' }),
    forbiddenRoots: [],
  });
  const server = await start(mount);
  t.after(() => server.close());
  assert.equal((await req(server, '/api/disk-clean/settings')).status, 200);
  const bad = await req(server, '/api/disk-clean/settings', { method: 'PUT', body: { customDirs: ['C:\\'] } });
  assert.equal(bad.status, 400);
  assert.equal(json(bad).error, 'drive_root');
});

test('mount：scan / clean 参数与状态', async (t) => {
  const scanner = {
    start: () => ({ scanId: 's1' }),
    get: (id) => (id === 's1' ? { id, categories: [] } : null),
  };
  const cleaner = {
    start: () => ({ jobId: 'j1' }),
    get: (id) => (id === 'j1' ? { status: 'done', removed: 1, bytes: 2, failed: [], skipped: 0 } : null),
  };
  const store = { readSettings: () => ({ exclusions: { dirs: [], patterns: [] }, customDirs: [] }), writeSettings: (v) => v, readHistory: () => [] };
  const mount = createDiskCleanMount({ platform: 'win32', store, scanner, cleaner, overview: () => ({ drive: 'C:', total: 100, free: 50 }) });
  const server = await start(mount);
  t.after(() => server.close());
  assert.deepEqual(json(await req(server, '/api/disk-clean/overview')), { drive: 'C:', total: 100, free: 50 });
  assert.deepEqual(json(await req(server, '/api/disk-clean/scan', { method: 'POST', body: {} })), { scanId: 's1' });
  assert.equal((await req(server, '/api/disk-clean/scan/nope')).status, 410);
  assert.deepEqual(json(await req(server, '/api/disk-clean/clean', { method: 'POST', body: { scanId: 's1', categoryIds: ['npm'] } })), { jobId: 'j1' });
  assert.equal((await req(server, '/api/disk-clean/clean/nope')).status, 404);
});
