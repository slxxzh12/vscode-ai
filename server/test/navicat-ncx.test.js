import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navicatEncrypt, navicatDecrypt, buildNcx, connectionString, NAVICAT_CONN_TYPE } from '../navicat-ncx.js';

test('navicatEncrypt：已知向量（AES-128-CBC, libcckeylibcckey/libcciv libcciv）', () => {
  assert.equal(navicatEncrypt('test'), 'E7D6D10725AD2445AA63C211943D447D');
  assert.equal(navicatEncrypt('df-pass'), '02C09B731700162E2D11CF31E9AD2B38');
  assert.equal(navicatEncrypt('p@ss word'), 'D76F8E8230DDC0D216E06324E7B58236');
});

test('navicatDecrypt：往返', () => {
  for (const p of ['', 'abc', 'p@ss word', '中文密码']) {
    assert.equal(navicatDecrypt(navicatEncrypt(p)), p);
  }
});

test('buildNcx：结构正确且密码为密文、文本被转义', () => {
  const xml = buildNcx([{ name: 'A & "B"', type: 'mysql', host: 'h', port: '3306', database: 'd', user: 'u', password: 'test' }]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<Connections>/);
  assert.match(xml, /ConnectionName="A &amp; &quot;B&quot;"/);
  assert.match(xml, new RegExp(`ConnType="${NAVICAT_CONN_TYPE.mysql}"`));
  assert.match(xml, /Password="E7D6D10725AD2445AA63C211943D447D"/);
  assert.match(xml, /<\/Connections>/);
});

test('connectionString：四类格式 + 可含/不含密码', () => {
  const base = { host: 'h', port: '3306', user: 'u', database: 'd' };
  assert.equal(connectionString({ ...base, type: 'mysql' }, 'p', { withPassword: true }), 'mysql://u:p@h:3306/d');
  assert.equal(connectionString({ ...base, type: 'mysql' }, 'p'), 'mysql://u@h:3306/d');
  assert.equal(connectionString({ ...base, type: 'postgres', port: '5432' }, 'p', { withPassword: true }), 'postgresql://u:p@h:5432/d');
  assert.equal(connectionString({ type: 'redis', host: 'h', port: '6379', user: '', database: '2' }, 'p', { withPassword: true }), 'redis://:p@h:6379/2');
  assert.equal(connectionString({ type: 'sqlite', database: 'C:/tmp/a.db' }, ''), 'C:/tmp/a.db');
});
