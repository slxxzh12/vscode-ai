import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavicatExport, csvRow, pickIdColumn, pickIdColumns, safeName, sqlValue } from '../navicat-export.js';

const MYSQL = { id: '1', name: 'C1', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'app' };

function fakeExec() {
  return {
    listDatabases: async () => ['app', 'mysql', 'information_schema', 'performance_schema', 'sys'],
    listTables: async (_p, _pw, db) => (db === 'app' ? ['users'] : []),
    exec: async (_p, _pw, sql) => {
      if (sql.includes('information_schema.columns')) {
        return {
          columns: ['column_name', 'column_type', 'is_nullable', 'column_default', 'column_key', 'ordinal_position'],
          rows: [
            ['id', 'int', 'NO', null, 'PRI', 1],
            ['name', 'varchar(50)', 'NO', null, '', 2],
          ],
        };
      }
      if (sql.startsWith('SHOW CREATE TABLE')) {
        return { columns: ['Table', 'Create Table'], rows: [['users', 'CREATE TABLE `users` (\n  `id` int NOT NULL,\n  `name` varchar(50) NOT NULL,\n  PRIMARY KEY (`id`)\n);']] };
      }
      if (sql.includes('ORDER BY') && sql.includes('DESC')) return { columns: ['id', 'name'], rows: [[4, 'Dora'], [3, 'Carol']] };
      if (sql.includes('ORDER BY')) return { columns: ['id', 'name'], rows: [[1, 'Alice'], [2, 'Bob']] };
      return { columns: [], rows: [] };
    },
  };
}

test('sqlValue：NULL/数字/字符串转义/布尔/日期/二进制', () => {
  assert.equal(sqlValue('mysql', null), 'NULL');
  assert.equal(sqlValue('mysql', 42), '42');
  assert.equal(sqlValue('mysql', "O'Brien"), "'O''Brien'");
  assert.equal(sqlValue('mysql', 'a\\b'), "'a\\\\b'");
  assert.equal(sqlValue('postgres', 'a\\b'), "'a\\b'");
  assert.equal(sqlValue('mysql', true), 'TRUE');
  assert.equal(sqlValue('mysql', new Date('2026-01-02T03:04:05.000Z')), "'2026-01-02T03:04:05.000Z'");
  assert.equal(sqlValue('mysql', Buffer.from([0xab, 0xcd])), "X'abcd'");
  assert.equal(sqlValue('postgres', Buffer.from([0xab, 0xcd])), "'\\xabcd'::bytea");
});

test('csvRow：逗号/引号/换行按 RFC4180 转义', () => {
  assert.equal(csvRow(['a', 'b,c', 'd"e', 'f\ng']), 'a,"b,c","d""e","f\ng"');
});

test('pickIdColumn：单列主键优先，其次 id，再退第一列', () => {
  assert.equal(pickIdColumn([{ name: 'code', pk: true }, { name: 'id' }]), 'code');
  assert.equal(pickIdColumn([{ name: 'a', pk: true }, { name: 'b', pk: true }, { name: 'ID' }]), 'ID');
  assert.equal(pickIdColumn([{ name: 'first' }, { name: 'second' }]), 'first');
  assert.equal(pickIdColumn([]), '');
});

test('safeName：替换非法字符并兜底', () => {
  assert.equal(safeName('a/b:c*?'), 'a_b_c__');
  assert.equal(safeName('   '), 'unnamed');
});

test('build：结构 DDL + 首尾抽样，输出 SQL 与 CSV', async () => {
  const exp = createNavicatExport({ exec: fakeExec() });
  const { files, errors } = await exp.build({ items: [{ profile: MYSQL, password: 'pw' }], n: 2, formats: ['sql', 'csv'] });
  assert.deepEqual(errors, []);
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.data]));

  assert.match(byPath['C1/app/schema.sql'], /CREATE TABLE `users`/);
  assert.match(byPath['C1/app/data.sql'], /INSERT INTO `users` \(`id`, `name`\) VALUES \(1, 'Alice'\);/);
  assert.match(byPath['C1/app/data.sql'], /VALUES \(2, 'Bob'\);/);
  assert.match(byPath['C1/app/data.sql'], /VALUES \(3, 'Carol'\);/);
  assert.match(byPath['C1/app/data.sql'], /VALUES \(4, 'Dora'\);/);

  const schemaCsvText = byPath['C1/app/csv/users.schema.csv'];
  assert.equal(schemaCsvText, undefined, '不再导出 schema CSV');

  const dataCsvText = byPath['C1/app/csv/users.data.csv'];
  const lines = dataCsvText.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(lines[0], 'id,name');
  assert.deepEqual(lines.slice(1), ['1,Alice', '2,Bob', '3,Carol', '4,Dora']);
});

test('build：只选 CSV 时不生成 SQL 文件', async () => {
  const exp = createNavicatExport({ exec: fakeExec() });
  const { files } = await exp.build({ items: [{ profile: MYSQL, password: 'pw' }], n: 30, formats: ['csv'] });
  assert.ok(files.every((f) => !f.path.endsWith('.sql')));
});

test('build：redis 跳过并记入 errors', async () => {
  const exp = createNavicatExport({ exec: fakeExec() });
  const profile = { id: '2', name: 'R', type: 'redis', host: 'h', port: '6379', user: '', database: '0' };
  const { files, errors } = await exp.build({ items: [{ profile, password: '' }], n: 30, formats: ['sql'] });
  assert.deepEqual(files, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /redis/);
});

test('pickIdColumns：联合主键直接使用全部主键列', () => {
  assert.deepEqual(pickIdColumns([{ name: 'a', pk: true }, { name: 'b', pk: true }, { name: 'id' }]), ['a', 'b']);
  assert.deepEqual(pickIdColumns([{ name: 'x' }, { name: 'ID' }]), ['ID']);
  assert.deepEqual(pickIdColumns([]), []);
});

function fakeFullExec() {
  return {
    listDatabases: async () => ['app'],
    listTables: async () => ['users'],
    exec: async (_p, _pw, sql) => {
      if (sql.includes('information_schema.columns')) {
        return { columns: ['column_name', 'column_type', 'is_nullable', 'column_default', 'column_key', 'ordinal_position'],
          rows: [['id', 'int', 'NO', null, 'PRI', 1], ['name', 'varchar(50)', 'NO', null, '', 2]] };
      }
      if (sql.startsWith('SHOW CREATE TABLE')) {
        return { columns: ['Table', 'Create Table'], rows: [['users', 'CREATE TABLE `users` (`id` int NOT NULL, `name` varchar(50) NOT NULL);']] };
      }
      if (sql.includes('SELECT * FROM')) return { columns: ['id', 'name'], rows: [[1, 'A'], [2, 'B'], [3, 'C']] };
      return { columns: [], rows: [] };
    },
  };
}

test('build：不抽样时导出整表（不带 ORDER BY / LIMIT）', async () => {
  const exp = createNavicatExport({ exec: fakeFullExec() });
  const { files, errors } = await exp.build({ items: [{ profile: MYSQL, password: 'pw' }], n: 1, formats: ['sql'], sample: false });
  assert.deepEqual(errors, []);
  const data = files.find((f) => f.path === 'C1/app/data.sql').data;
  assert.match(data, /VALUES \(1, 'A'\);/);
  assert.match(data, /VALUES \(2, 'B'\);/);
  assert.match(data, /VALUES \(3, 'C'\);/);
});

function fakePgExec() {
  return {
    listDatabases: async () => ['app', 'postgres', 'template0', 'template1'],
    listTables: async (_p, _pw, db) => (db === 'app' ? ['users'] : []),
    exec: async (_p, _pw, sql) => {
      if (sql.includes('pg_attribute a')) {
        return { columns: ['attname', 'type', 'notnull', 'def'], rows: [['id', 'integer', true, null], ['name', 'text', true, null]] };
      }
      if (sql.includes('indisprimary')) return { columns: ['attname'], rows: [['id']] };
      if (sql.includes('ORDER BY') && sql.includes('DESC')) return { columns: ['id', 'name'], rows: [[2, 'B']] };
      if (sql.includes('ORDER BY')) return { columns: ['id', 'name'], rows: [[1, 'A']] };
      return { columns: [], rows: [] };
    },
  };
}

test('build：PostgreSQL 未指定库时遍历全部业务库', async () => {
  const PG = { id: '2', name: 'PG', type: 'postgres', host: 'h', port: '5432', user: 'u', database: '' };
  const exp = createNavicatExport({ exec: fakePgExec() });
  const { files, errors } = await exp.build({ items: [{ profile: PG, password: 'pw' }], n: 1, formats: ['sql'] });
  assert.deepEqual(errors, []);
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes('PG/app/schema.sql'));
  assert.ok(!paths.some((p) => p.includes('/postgres/') || p.includes('/template')));
  const data = files.find((f) => f.path === 'PG/app/data.sql').data;
  assert.match(data, /INSERT INTO "users" \("id", "name"\) VALUES \(1, 'A'\);/);
});
