import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVault } from '../llm-vault.js';
import { createLlmMount } from '../llm-mount.js';
import { readZip } from '../collaboration/zip.js';

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

test('插件目录列表与重载接口', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpl-'));
  fs.writeFileSync(path.join(dir, 'p.mjs'), 'export default { name: "p", priority: 5 };');
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, pluginsDir: dir });
  await mount.ready;
  const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://x'); mount(req, res, url); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const list = JSON.parse((await jget(server, '/api/llm-admin/plugins')).body);
  assert.equal(list.dir, dir);
  assert.deepEqual(list.entries.map((e) => e.name), ['p']);
  const r = await jpost(server, '/api/llm-admin/plugins/reload', {});
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).entries.map((e) => e.name), ['p']);
});

test('未解锁时重载插件 423、列表仍可读', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpl-'));
  const vault = tmpVault();
  vault.init('pw');
  vault.lock();
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, pluginsDir: dir });
  await mount.ready;
  const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://x'); mount(req, res, url); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  assert.equal((await jget(server, '/api/llm-admin/plugins')).status, 200);
  assert.equal((await jpost(server, '/api/llm-admin/plugins/reload', {})).status, 423);
});

function startMount(mount) {
  const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://x'); mount(req, res, url); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('插件示例模板与一键生成（重名顺延）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpl-'));
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, pluginsDir: dir });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  const list = JSON.parse((await jget(server, '/api/llm-admin/plugins')).body);
  assert.match(list.template, /my-plugin/);
  const r1 = await jpost(server, '/api/llm-admin/plugins/example', {});
  assert.equal(r1.status, 200);
  assert.equal(JSON.parse(r1.body).file, 'my-plugin.mjs');
  assert.deepEqual(JSON.parse(r1.body).entries.map((e) => e.name), ['my-plugin']);
  const r2 = await jpost(server, '/api/llm-admin/plugins/example', {});
  assert.equal(JSON.parse(r2.body).file, 'my-plugin-2.mjs');
});

test('打开插件目录调用 reveal；无目录 400', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpl-'));
  const vault = tmpVault();
  vault.init('pw');
  const calls = [];
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, pluginsDir: dir, reveal: (abs, isDir) => { calls.push([abs, isDir]); return true; } });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  const r = await jpost(server, '/api/llm-admin/plugins/reveal', {});
  assert.equal(r.status, 200);
  assert.deepEqual(calls, [[dir, true]]);

  const mount2 = createLlmMount({ vault, host: '127.0.0.1', port: 1234, pluginsDir: null });
  await mount2.ready;
  const server2 = await startMount(mount2);
  t.after(() => server2.close());
  assert.equal((await jpost(server2, '/api/llm-admin/plugins/example', {})).status, 400);
  assert.equal((await jpost(server2, '/api/llm-admin/plugins/reveal', {})).status, 400);
});

test('provider-keys 返回指定 provider 的明文 key（单个/轮询）', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfpk-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    provider: {
      corp: { options: { baseURL: 'https://gw/v1', apiKey: 'SECRET-KEY' } },
      rot: { options: { baseURL: 'https://rot/v1', apiKeys: ['A', 'B'] } },
    },
  }));
  const prev = process.env.DEVFLOW_OPENCODE_CONFIG;
  process.env.DEVFLOW_OPENCODE_CONFIG = oc;
  t.after(() => { if (prev === undefined) delete process.env.DEVFLOW_OPENCODE_CONFIG; else process.env.DEVFLOW_OPENCODE_CONFIG = prev; });
  const vault = tmpVault();
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, opencodeDir: oc });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  const one = JSON.parse((await jget(server, '/api/llm-admin/provider-keys?provider=corp')).body);
  assert.equal(one.apiKey, 'SECRET-KEY');
  assert.deepEqual(one.apiKeys, ['SECRET-KEY']);
  const rot = JSON.parse((await jget(server, '/api/llm-admin/provider-keys?provider=rot')).body);
  assert.deepEqual(rot.apiKeys, ['A', 'B']);
  assert.equal((await jget(server, '/api/llm-admin/provider-keys?provider=nope')).status, 404);
});

test('opencode-config 支持 pid/model 过滤（多 provider）', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    provider: {
      corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { a: {}, b: {}, c: {} } },
      glm: { options: { baseURL: 'https://glm/v1', apiKey: 'G' }, models: { g1: {}, g2: {} } },
    },
  }));
  const prev = process.env.DEVFLOW_OPENCODE_CONFIG;
  process.env.DEVFLOW_OPENCODE_CONFIG = oc;
  t.after(() => { if (prev === undefined) delete process.env.DEVFLOW_OPENCODE_CONFIG; else process.env.DEVFLOW_OPENCODE_CONFIG = prev; });

  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  assert.equal((await jpost(server, '/api/llm-admin/secret', {})).status, 200);
  const tok = JSON.parse((await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 1 })).body).token;

  const filtered = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?token=${tok.id}&pid=corp&model=a&pid=corp&model=c`)).body);
  assert.deepEqual(Object.keys(JSON.parse(filtered.config).provider['devflow-corp'].models), ['a', 'c']);

  const all = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?token=${tok.id}&pid=corp`)).body);
  assert.deepEqual(Object.keys(JSON.parse(all.config).provider['devflow-corp'].models), ['a', 'b', 'c']);

  const manual = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?token=${tok.id}&pid=corp&model=x&pid=corp&model=y`)).body);
  assert.deepEqual(Object.keys(JSON.parse(manual.config).provider['devflow-corp'].models), ['x', 'y']);

  const multi = JSON.parse((await jget(server, `/api/llm-admin/opencode-config?token=${tok.id}&pid=corp&model=a&pid=glm&model=g1`)).body);
  assert.deepEqual(Object.keys(JSON.parse(multi.config).provider).sort(), ['devflow-corp', 'devflow-glm']);
});

test('签名密钥一次配置后持久、空保存不覆盖、可重新生成', async (t) => {
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());

  let st = JSON.parse((await jget(server, '/api/llm-admin/status')).body);
  assert.equal(st.hasSecret, false);

  const r1 = await jpost(server, '/api/llm-admin/secret', {});
  assert.equal(r1.status, 200);
  const first = vault.getData().jwtSecret;
  assert.ok(first);
  assert.equal(JSON.parse(r1.body).changed, true);

  st = JSON.parse((await jget(server, '/api/llm-admin/status')).body);
  assert.equal(st.hasSecret, true);

  const r2 = await jpost(server, '/api/llm-admin/secret', {});
  assert.equal(JSON.parse(r2.body).changed, false);
  assert.equal(vault.getData().jwtSecret, first);

  await jpost(server, '/api/llm-admin/secret', { secret: 'MYKEY' });
  assert.equal(vault.getData().jwtSecret, 'MYKEY');

  const r3 = await jpost(server, '/api/llm-admin/secret/regenerate', {});
  assert.equal(r3.status, 200);
  assert.notEqual(vault.getData().jwtSecret, 'MYKEY');
});

test('重新生成会吊销全部已签发 token', async (t) => {
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());

  await jpost(server, '/api/llm-admin/secret', { secret: 'S' });
  const tok = JSON.parse((await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 1 })).body).token;
  assert.equal(vault.getData().tokens.find((x) => x.id === tok.id).revoked, false);

  const r = await jpost(server, '/api/llm-admin/secret/regenerate', {});
  assert.equal(r.status, 200);
  assert.notEqual(vault.getData().jwtSecret, 'S');
  assert.equal(vault.getData().tokens.every((x) => x.revoked), true);
});

function getBuffer(server, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('opencode-bundle 返回含 opencode.json 与 Install.bat 的 zip', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { a: {}, b: {}, c: {} } } },
  }));
  const prev = process.env.DEVFLOW_OPENCODE_CONFIG;
  process.env.DEVFLOW_OPENCODE_CONFIG = oc;
  t.after(() => { if (prev === undefined) delete process.env.DEVFLOW_OPENCODE_CONFIG; else process.env.DEVFLOW_OPENCODE_CONFIG = prev; });

  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());

  await jpost(server, '/api/llm-admin/secret', { secret: 'S' });
  const tok = JSON.parse((await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 1 })).body).token;

  const r = await getBuffer(server, `/api/llm-admin/opencode-bundle?token=${tok.id}&pid=corp&model=a`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/zip');
  const entries = readZip(r.body);
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['Install.bat', 'opencode.json']);
  const cfg = JSON.parse(entries.find((e) => e.name === 'opencode.json').data.toString('utf8'));
  assert.deepEqual(Object.keys(cfg.provider['devflow-corp'].models), ['a']);
  const bat = entries.find((e) => e.name === 'Install.bat').data.toString('utf8');
  assert.match(bat, /\.config\\opencode/);
  assert.match(bat, /opencode\.json\.bak/);

  assert.equal((await getBuffer(server, '/api/llm-admin/opencode-bundle?token=nope&pid=corp')).status, 404);
  assert.equal((await getBuffer(server, `/api/llm-admin/opencode-bundle?token=${tok.id}&pid=nope&model=x`)).status, 404);
});

test('test-example 返回流式/非流式 curl；test-script 写 bat', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    provider: { corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { a: {}, b: {} } } },
  }));
  const prev = process.env.DEVFLOW_OPENCODE_CONFIG;
  process.env.DEVFLOW_OPENCODE_CONFIG = oc;
  const prevHome = process.env.DEVFLOW_DATA_HOME;
  process.env.DEVFLOW_DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dfhome-'));
  t.after(() => {
    if (prev === undefined) delete process.env.DEVFLOW_OPENCODE_CONFIG; else process.env.DEVFLOW_OPENCODE_CONFIG = prev;
    if (prevHome === undefined) delete process.env.DEVFLOW_DATA_HOME; else process.env.DEVFLOW_DATA_HOME = prevHome;
  });

  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234 });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  await jpost(server, '/api/llm-admin/secret', { secret: 'S' });
  const tok = JSON.parse((await jpost(server, '/api/llm-admin/tokens', { employeeId: 'E1', days: 1 })).body).token;

  const ex = JSON.parse((await jget(server, `/api/llm-admin/test-example?token=${tok.id}&pid=corp&model=a`)).body);
  assert.match(ex.nonStream, /chat\/completions/);
  assert.ok(ex.nonStream.includes(tok.jwt), 'curl 带真实 token');
  assert.match(ex.nonStream, /Authorization: Bearer/);
  assert.ok(!ex.nonStream.includes('\n'), '单行可直接执行');
  assert.ok(ex.stream.includes('\\"stream\\":true'));
  assert.match(ex.stream, /-N /);

  const r = await jpost(server, '/api/llm-admin/test-script', { token: tok.id, pid: 'corp', model: 'a', stream: true });
  assert.equal(r.status, 200);
  const p = JSON.parse(r.body).path;
  assert.ok(fs.existsSync(p));
  const bat = fs.readFileSync(p, 'utf8');
  assert.match(bat, /curl/);
  assert.match(bat, /pause/);

  assert.equal((await jget(server, '/api/llm-admin/test-example?token=nope&pid=corp&model=a')).status, 404);
  assert.equal((await jget(server, `/api/llm-admin/test-example?token=${tok.id}&pid=nope&model=a`)).status, 404);
});

test('opencode 配置 GET/POST：预设选择写盘、保留其余顶层键与非预设 provider', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    agent: { a: {} },
    provider: {
      corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { m1: {} } },
      deepseek: { options: { baseURL: 'old', apiKey: 'OLD' }, models: { 'deepseek-v4-flash': { name: 'Legacy' } } },
    },
    model: 'corp/m1',
  }));
  const vault = tmpVault();
  vault.init('pw');
  vault.lock();
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, opencodeDir: oc });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());

  const g = await jget(server, '/api/llm-admin/opencode');
  assert.equal(g.status, 200);
  assert.equal(JSON.parse(g.body).config.provider.corp.options.apiKey, 'K');

  const r = await jpost(server, '/api/llm-admin/opencode', {
    providers: [
      { id: 'deepseek', apiKey: '', models: ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'] },
      { id: 'qwen', apiKey: '', models: ['qwen3-max'] },
    ],
    model: 'deepseek/deepseek-v4-flash',
  });
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.deepEqual(body.skipped, ['qwen']);

  const saved = JSON.parse(fs.readFileSync(path.join(oc, 'opencode.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.provider).sort(), ['corp', 'deepseek']);
  assert.equal(saved.provider.corp.options.apiKey, 'K');
  assert.equal(saved.provider.deepseek.options.baseURL, 'https://api.deepseek.com/v1');
  assert.equal(saved.provider.deepseek.options.apiKey, 'OLD');
  assert.equal(saved.provider.deepseek.models['deepseek-v4-flash'].name, 'Legacy');
  assert.equal(saved.provider.deepseek.models['deepseek-v4-flash-vision-exp'].attachment, true);
  assert.equal(saved.model, 'deepseek/deepseek-v4-flash');
  assert.deepEqual(saved.agent, { a: {} });
});

test('opencode 配置 POST 非法体 400、坏文件 400', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), '{ broken');
  const vault = tmpVault();
  vault.init('pw');
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, opencodeDir: oc });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());
  assert.equal((await jpost(server, '/api/llm-admin/opencode', { providers: 'x', model: '' })).status, 400);
  assert.equal((await jpost(server, '/api/llm-admin/opencode', { providers: [{ id: 'nope', models: [] }], model: '' })).status, 400);
  assert.equal((await jpost(server, '/api/llm-admin/opencode', { providers: [{ id: 'my-ai', models: [] }], model: '' })).status, 400);
});

test('opencode 配置 POST：写自定义 provider、按 remove 删除', async (t) => {
  const oc = fs.mkdtempSync(path.join(os.tmpdir(), 'dfoc-'));
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({
    provider: {
      corp: { options: { baseURL: 'https://gw/v1', apiKey: 'K' }, models: { m1: {} } },
      dead: { options: { baseURL: 'https://dead/v1', apiKey: 'D' }, models: { x: {} } },
    },
    model: '',
  }));
  const vault = tmpVault();
  vault.init('pw');
  vault.lock();
  const mount = createLlmMount({ vault, host: '127.0.0.1', port: 1234, opencodeDir: oc });
  await mount.ready;
  const server = await startMount(mount);
  t.after(() => server.close());

  const r = await jpost(server, '/api/llm-admin/opencode', {
    providers: [{ id: 'my-ai', name: 'MyAI', baseURL: 'https://my.ai/v1', apiKey: 'MK', models: ['my-model', 'my-vl'] }],
    remove: ['dead'],
    model: '',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).skipped, []);

  const saved = JSON.parse(fs.readFileSync(path.join(oc, 'opencode.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.provider).sort(), ['corp', 'my-ai']);
  assert.equal(saved.provider['my-ai'].name, 'MyAI');
  assert.equal(saved.provider['my-ai'].options.baseURL, 'https://my.ai/v1');
  assert.equal(saved.provider['my-ai'].options.apiKey, 'MK');
  assert.equal(saved.provider['my-ai'].models['my-vl'].attachment, true);
  assert.equal(saved.provider.corp.options.apiKey, 'K');
});
