import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createAiSiteServe } from '../ai-site/serve.js';
import { createAiSiteUsers } from '../ai-site/users.js';
import { createAiSiteRunner } from '../ai-site/runner.js';
import { setLocale } from '../i18n.js';

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
  setTimeout(() => { c.stdout.emit('data', 'ok'); c.emit('close', 0); }, 0);
  return c;
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-aisite-serve-'));
  const pluginRoot = path.join(root, 'plugins');
  const p = path.join(pluginRoot, 'hello');
  fs.mkdirSync(path.join(p, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(p, 'manifest.json'), JSON.stringify({ name: 'Hello', workflow: 'workflow/prompt.md', fields: [{ key: 'x', label: 'X', type: 'text', required: true }] }));
  fs.writeFileSync(path.join(p, 'workflow', 'prompt.md'), 'PROMPT');
  const users = createAiSiteUsers({ file: path.join(root, 'users.json') });
  const runner = createAiSiteRunner({ runsDir: path.join(root, 'runs'), resolveBin: () => 'opencode', spawnFn: () => fakeChild() });
  return { root, pluginRoot, users, runner };
}

function listen(handler) {
  const srv = http.createServer((req, res) => handler(req, res));
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

test('serve：未登录跳登录页，登录后可看插件列表并执行', async () => {
  setLocale('zh-CN');
  const { pluginRoot, users, runner } = setup();
  const config = { pluginRoot, requireAuth: true, sessionSecret: 'k'.repeat(48), pathPrefix: '' };
  const serve = createAiSiteServe({ getConfig: () => config, users, runner, logger: console });
  const { srv, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://x');
    serve.handle(req, res, url, { base: '' });
  });
  try {
    const r1 = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
    assert.equal(r1.status, 200);
    assert.match(await r1.text(), /name="username"/);

    const u = users.create({ username: 'alice' });
    const r2 = await fetch(`http://127.0.0.1:${port}/__login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=alice&token=${encodeURIComponent(u.token)}`,
    });
    assert.equal(r2.status, 302);
    const cookie = String(r2.headers.get('set-cookie')).split(';')[0];

    const r3 = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie } });
    assert.match(await r3.text(), /Hello/);

    const r4 = await fetch(`http://127.0.0.1:${port}/__api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ plugin: 'hello', values: { x: '1' } }),
    });
    assert.equal(r4.status, 200);
    const j = await r4.json();
    assert.ok(j.runId);
    assert.equal(users.list()[0].uses, 1);
  } finally { srv.close(); }
});

test('serve：路径遍历 output 文件被拒绝', async () => {
  setLocale('zh-CN');
  const { pluginRoot, users, runner } = setup();
  const config = { pluginRoot, requireAuth: false, sessionSecret: 'k'.repeat(48), pathPrefix: '' };
  const serve = createAiSiteServe({ getConfig: () => config, users, runner, logger: console });
  const { srv, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://x');
    serve.handle(req, res, url, { base: '' });
  });
  try {
    const run = runner.createRun({ pluginName: 'hello', pluginDir: path.join(pluginRoot, 'hello'), workflowPath: path.join(pluginRoot, 'hello', 'workflow', 'prompt.md'), values: {}, user: '' });
    const r = await fetch(`http://127.0.0.1:${port}/__api/runs/${run.id}/file?path=${encodeURIComponent('../run.json')}`);
    assert.equal(r.status, 400);
  } finally { srv.close(); }
});
