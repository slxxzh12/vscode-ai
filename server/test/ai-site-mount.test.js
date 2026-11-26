import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiSiteMount } from '../ai-site/mount.js';

function call(mount, { method = 'GET', path: p = '/api/ai-site/config', body = null }) {
  return new Promise((resolve) => {
    const req = {
      method, url: p, headers: {},
      on(ev, cb) {
        if (ev === 'data' && body) cb(Buffer.from(JSON.stringify(body)));
        if (ev === 'end') cb();
      },
    };
    const chunks = [];
    const res = {
      statusCode: 0, headers: {},
      writeHead(s, h) { this.statusCode = s; this.headers = h || {}; },
      end(s) { chunks.push(s || ''); resolve({ status: this.statusCode, body: JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(String(c)))).toString('utf8') || '{}') }); },
    };
    mount(req, res, new URL(p, 'http://x'));
  });
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-mount-'));
  const pluginRoot = path.join(root, 'plugins');
  fs.mkdirSync(path.join(pluginRoot, 'p1'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'p1', 'manifest.json'), JSON.stringify({ name: 'P1', workflow: 'w.md', fields: [{ key: 'x', label: 'X', type: 'text' }] }));
  fs.writeFileSync(path.join(pluginRoot, 'p1', 'w.md'), 'x');
  const applied = [];
  return { root, pluginRoot, applied };
}

test('mount: run endpoint creates a run and exposes meta/files/input', async () => {
  const { root, pluginRoot } = setup();
  const store = {
    cfg: { pluginRoot: '', mode: 'port', listenPort: 22300, pathPrefix: '/ai', enabled: false, requireAuth: true, sessionSecret: 'k'.repeat(48), listenHost: '0.0.0.0' },
    get() { return { ...this.cfg }; },
    save(patch) { this.cfg = { ...this.cfg, ...patch }; return { ...this.cfg }; },
  };
  const { createAiSiteUsers } = await import('../ai-site/users.js');
  const users = createAiSiteUsers({ file: path.join(root, 'users.json'), getSecret: () => 'k'.repeat(48) });
  let created = null;
  const runner = {
    createRun: (args) => { created = args; return { id: 'r1' }; },
    getRun: (id) => (id === 'r1' ? { id: 'r1', status: 'running' } : null),
    snapshot: (id) => (id === 'r1' ? { id: 'r1', status: 'running', log: 'ok' } : null),
    listFiles: () => [{ path: 'a.txt', size: 3 }],
    write: (id) => id === 'r1',
  };
  const mount = createAiSiteMount({
    configStore: store, users, runner, pluginsRoot: () => pluginRoot,
    apply: async () => {}, status: () => ({ status: 'stopped' }),
  });
  const r = await call(mount, { method: 'POST', path: '/api/ai-site/run', body: { plugin: 'p1', values: { x: '1' } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.runId, 'r1');
  assert.equal(created.pluginName, 'p1');
  assert.equal(created.values.x, '1');
  const meta = await call(mount, { path: '/api/ai-site/runs/r1' });
  assert.equal(meta.body.log, 'ok');
  const files = await call(mount, { path: '/api/ai-site/runs/r1/files' });
  assert.equal(files.body.items.length, 1);
  const input = await call(mount, { method: 'POST', path: '/api/ai-site/runs/r1/input', body: { text: 'hi\n' } });
  assert.equal(input.status, 200);
});

test('mount：配置读写、插件预览、用户增删改', async () => {
  const { root, pluginRoot, applied } = setup();
  const store = {
    cfg: { pluginRoot: '', mode: 'port', listenPort: 22300, pathPrefix: '/ai', enabled: false, requireAuth: true, sessionSecret: 'k'.repeat(48), listenHost: '0.0.0.0' },
    get() { return { ...this.cfg }; },
    save(patch) { this.cfg = { ...this.cfg, ...patch }; return { ...this.cfg }; },
  };
  const { createAiSiteUsers } = await import('../ai-site/users.js');
  const users = createAiSiteUsers({ file: path.join(root, 'users.json'), getSecret: () => 'k'.repeat(48) });
  const mount = createAiSiteMount({
    configStore: store, users, pluginsRoot: () => pluginRoot,
    apply: async () => { applied.push(1); }, status: () => ({ status: 'stopped' }),
  });

  const c = await call(mount, { path: '/api/ai-site/config' });
  assert.equal(c.status, 200);
  assert.equal(c.body.config.listenPort, 22300);

  const saved = await call(mount, { method: 'POST', path: '/api/ai-site/config', body: { enabled: true, listenPort: 22301 } });
  assert.equal(saved.status, 200);
  assert.equal(applied.length, 1);

  const pl = await call(mount, { path: '/api/ai-site/plugins' });
  assert.equal(pl.body.items.length, 1);

  const created = await call(mount, { method: 'POST', path: '/api/ai-site/users', body: { username: 'alice' } });
  assert.equal(created.status, 200);
  assert.ok(created.body.item.jwt);
  const id = created.body.item.id;

  const rev = await call(mount, { method: 'POST', path: '/api/ai-site/revoke', body: { username: 'alice' } });
  assert.equal(rev.status, 200);
  assert.deepEqual(rev.body.blacklist, ['alice']);
  const list = await call(mount, { path: '/api/ai-site/users' });
  assert.equal(list.body.items[0].revoked, true);
  const back = await call(mount, { method: 'POST', path: '/api/ai-site/revoke', body: { username: 'alice', revoked: false } });
  assert.deepEqual(back.body.blacklist, []);

  const updated = await call(mount, { method: 'PATCH', path: '/api/ai-site/users', body: { id, enabled: false } });
  assert.equal(updated.body.item.enabled, false);

  const removed = await call(mount, { method: 'DELETE', path: `/api/ai-site/users?id=${id}` });
  assert.equal(removed.body.ok, true);
  assert.equal(users.list().length, 0);
});
