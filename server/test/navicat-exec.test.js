import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNavicatExec, isWriteSql, isWriteRedis, tokenizeRedis } from '../navicat-exec.js';

test('isWriteSql：读/写/多语句/WITH', () => {
  assert.equal(isWriteSql('SELECT * FROM t'), false);
  assert.equal(isWriteSql('  \n-- c\n show tables'), false);
  assert.equal(isWriteSql('PRAGMA table_info(t)'), false);
  assert.equal(isWriteSql('INSERT INTO t VALUES (1)'), true);
  assert.equal(isWriteSql('drop table t'), true);
  assert.equal(isWriteSql('WITH x AS (SELECT 1) SELECT * FROM x'), false);
  assert.equal(isWriteSql('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x'), true);
  assert.equal(isWriteSql('SELECT 1; UPDATE t SET a=1'), true);
  assert.equal(isWriteSql(''), false);
});

test('isWriteRedis：白名单读/写/子命令', () => {
  assert.equal(isWriteRedis(['GET', 'k']), false);
  assert.equal(isWriteRedis(['SCAN', '0']), false);
  assert.equal(isWriteRedis(['CONFIG', 'GET', 'maxmemory']), false);
  assert.equal(isWriteRedis(['SET', 'k', 'v']), true);
  assert.equal(isWriteRedis(['FLUSHALL']), true);
  assert.equal(isWriteRedis([]), false);
});

test('tokenizeRedis：引号与转义', () => {
  assert.deepEqual(tokenizeRedis('SET k "a b"'), ['SET', 'k', 'a b']);
  assert.deepEqual(tokenizeRedis("SET k 'a\\nb'"), ['SET', 'k', 'a\\nb']);
  assert.deepEqual(tokenizeRedis('  GET   k  '), ['GET', 'k']);
  assert.deepEqual(tokenizeRedis('SET k "a\\"b"'), ['SET', 'k', 'a"b']);
});

test('exec：SQLite 建表/插入/查询 + 截断 + 写识别', async () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-nvexec-')), 'a.db');
  const exec = createNavicatExec({ maxRows: 2 });
  const profile = { type: 'sqlite', database: dbFile };
  const ddl = await exec.exec(profile, '', 'CREATE TABLE t(a INTEGER, b TEXT)');
  assert.equal(exec.isWrite(profile, 'CREATE TABLE t(a)'), true);
  assert.ok(ddl.affected >= 0);
  await exec.exec(profile, '', "INSERT INTO t VALUES (1,'x')");
  await exec.exec(profile, '', "INSERT INTO t VALUES (2,'y')");
  await exec.exec(profile, '', "INSERT INTO t VALUES (3,'z')");
  const r = await exec.exec(profile, '', 'SELECT a, b FROM t ORDER BY a');
  assert.deepEqual(r.columns, ['a', 'b']);
  assert.equal(r.rows.length, 2);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.rows[0], [1, 'x']);
  assert.equal(exec.isWrite(profile, 'SELECT 1'), false);
});

test('exec：SQLite 不存在的目录/文件报错', async () => {
  const exec = createNavicatExec({});
  await assert.rejects(() => exec.exec({ type: 'sqlite', database: '' }, '', 'SELECT 1'));
});

test('schema：SQLite 列库/列表，Redis 数字库', async () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-nvschema-')), 'a.db');
  const exec = createNavicatExec({});
  const sqlite = { type: 'sqlite', database: dbFile };
  await exec.exec(sqlite, '', 'CREATE TABLE users(a INTEGER)');
  await exec.exec(sqlite, '', 'CREATE VIEW v_users AS SELECT * FROM users');
  assert.deepEqual(await exec.listDatabases(sqlite, ''), []);
  assert.deepEqual(await exec.listTables(sqlite, '', dbFile), ['users', 'v_users']);

  const redis = { type: 'redis', host: '127.0.0.1', port: '6379' };
  assert.deepEqual(await exec.listDatabases(redis, ''), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15']);
  assert.deepEqual(await exec.listTables(redis, '', '0'), []);
});
