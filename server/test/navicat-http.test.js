import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createNavicatCrypto } from '../navicat-crypto.js';
import { createNavicatStore } from '../navicat-store.js';
import { buildNcx, connectionString } from '../navicat-ncx.js';
import { createNavicatMount } from '../navicat-mount.js';

function fakeExec() {
  const calls = [];
  return {
    calls,
    isWrite: (p, s) => String(s).trim().toUpperCase().startsWith('INSERT'),
    exec: async (p, pw, sql) => {
      calls.push({ type: p.type, password: pw, sql, database: p.database });
      return { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 3 };
    },
    test: async (p, pw) => { calls.push({ test: p.type, password: pw }); return { ok: true }; },
    listDatabases: async (p) => { calls.push({ schema: 'databases', type: p.type }); return ['db1', 'db2']; },
    listTables: async (p, pw, db) => { calls.push({ schema: 'tables', db }); return ['t1', 't2']; },
  };
}

async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-nvhttp-'));
  const store = createNavicatStore({ file: path.join(dir, 'profiles.json'), crypto: createNavicatCrypto({ keyFile: path.join(dir, '.key') }) });
  const exec = fakeExec();
  const mount = createNavicatMount({
    store, exec, ncx: { buildNcx, connectionString },
    ...(opts.pickFile ? { pickFile: opts.pickFile } : {}),
  });
  const server = http.createServer((req, res) => mount(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, server, exec, store };
}

function call(port, method, p, body) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

const PROFILE = { name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', password: 'p@ss' };

test('profiles：创建/列表掩码/更新/删除', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const created = await call(A.port, 'POST', '/api/navicat/profiles', PROFILE);
  assert.equal(created.status, 200);
  assert.equal(created.body.item.hasPassword, true);
  const id = created.body.item.id;
  const list = await call(A.port, 'GET', '/api/navicat/profiles');
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].secret, undefined);
  const upd = await call(A.port, 'PATCH', '/api/navicat/profiles', { id, name: 'B' });
  assert.equal(upd.body.item.name, 'B');
  const del = await call(A.port, 'DELETE', `/api/navicat/profiles?id=${id}`);
  assert.equal(del.status, 200);
  assert.equal((await call(A.port, 'GET', '/api/navicat/profiles')).body.items.length, 0);
});

test('reveal / connstr：明文只在服务端拼装/按需返回', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  const rev = await call(A.port, 'POST', '/api/navicat/reveal', { id });
  assert.equal(rev.body.password, 'p@ss');
  const noPw = await call(A.port, 'POST', '/api/navicat/connstr', { id });
  assert.equal(noPw.body.text, 'mysql://u@h:3306/d');
  const withPw = await call(A.port, 'POST', '/api/navicat/connstr', { id, withPassword: true });
  assert.equal(withPw.body.text, 'mysql://u:p%40ss@h:3306/d');
});

test('test：用档案密码测试连接', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  const r = await call(A.port, 'POST', '/api/navicat/test', { id });
  assert.equal(r.status, 200);
  assert.equal(A.exec.calls[0].password, 'p@ss');
});

test('exec：写操作先要 confirm，确认后执行', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  const need = await call(A.port, 'POST', '/api/navicat/exec', { id, sql: 'INSERT INTO t VALUES (1)' });
  assert.equal(need.body.needConfirm, true);
  assert.equal(need.body.kind, 'write');
  assert.equal(A.exec.calls.length, 0);
  const ok = await call(A.port, 'POST', '/api/navicat/exec', { id, sql: 'INSERT INTO t VALUES (1)', confirm: true });
  assert.equal(ok.body.result.rows.length, 1);
  assert.equal(A.exec.calls.length, 1);
  const read = await call(A.port, 'POST', '/api/navicat/exec', { id, sql: 'SELECT 1' });
  assert.equal(read.body.result.columns[0], 'a');
});

test('ncx：返回 XML，密码为密文', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  const r = await call(A.port, 'POST', '/api/navicat/ncx', { ids: [id] });
  assert.match(r.body.xml, /<Connection /);
  assert.doesNotMatch(r.body.xml, /p@ss/);
});

test('错误：404 / 400 bad-type / 未知路径', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  assert.equal((await call(A.port, 'POST', '/api/navicat/reveal', { id: 'nope' })).status, 404);
  assert.equal((await call(A.port, 'POST', '/api/navicat/profiles', { ...PROFILE, type: 'oracle' })).status, 400);
  assert.equal((await call(A.port, 'GET', '/api/navicat/unknown')).status, 404);
});

test('schema：databases/tables 端点', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  const dbs = await call(A.port, 'GET', `/api/navicat/schema/databases?id=${id}`);
  assert.equal(dbs.status, 200);
  assert.deepEqual(dbs.body.items, ['db1', 'db2']);
  const tbs = await call(A.port, 'GET', `/api/navicat/schema/tables?id=${id}&database=db2`);
  assert.deepEqual(tbs.body.items, ['t1', 't2']);
  assert.equal(A.exec.calls.find((c) => c.schema === 'tables').db, 'db2');
});

test('exec：database 覆盖档案并传给执行层', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  await call(A.port, 'POST', '/api/navicat/exec', { id, sql: 'SELECT 1', database: 'other' });
  assert.equal(A.exec.calls.find((c) => c.sql === 'SELECT 1').database, 'other');
});

test('pick-file：返回路径 / 取消 / 不支持', async (t) => {
  const A = await start({ pickFile: async () => ({ path: 'C:\\data\\a.db' }) });
  t.after(() => A.server.close());
  const ok = await call(A.port, 'POST', '/api/navicat/pick-file', {});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.path, 'C:\\data\\a.db');

  const B = await start({ pickFile: async () => ({ cancelled: true }) });
  t.after(() => B.server.close());
  const c = await call(B.port, 'POST', '/api/navicat/pick-file', {});
  assert.equal(c.body.cancelled, true);

  const C = await start({ pickFile: async () => ({ error: 'unsupported' }) });
  t.after(() => C.server.close());
  const e = await call(C.port, 'POST', '/api/navicat/pick-file', {});
  assert.equal(e.body.error, 'unsupported');
});
