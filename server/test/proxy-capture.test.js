import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProxyCapture } from '../proxy-capture.js';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-proxycap-')); }
const RID = '11111111-1111-1111-1111-111111111111';

test('begin/finish：写入记录并可从 list 读到摘要', () => {
  const cap = createProxyCapture({ rootDir: tmpRoot() });
  const h = cap.begin(RID, { method: 'GET', url: '/x', headers: { host: 'h' } });
  h.resHeaders({ 'content-type': 'text/plain' });
  h.resBody(Buffer.from('hello'));
  h.finish({ status: 200, durationMs: 5 });
  const list = cap.list(RID);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 200);
  assert.equal(list[0].kind, 'http');
  assert.equal(list[0].resBodySize, 5);
  assert.equal(list[0].resHeaders, undefined, '摘要不含 headers');
});

test('read：取到完整记录与正文', () => {
  const cap = createProxyCapture({ rootDir: tmpRoot() });
  const h = cap.begin(RID, { method: 'POST', url: '/p', headers: {} });
  h.reqBody(Buffer.from('body'));
  h.resHeaders({ 'content-type': 'text/event-stream' });
  h.resBody(Buffer.from('data: 1\n\n'));
  h.finish({ status: 200, durationMs: 9 });
  const id = cap.list(RID)[0].id;
  const rec = cap.read(RID, id);
  assert.equal(rec.record.kind, 'sse');
  assert.equal(rec.reqBody, 'body');
  assert.equal(rec.resBody, 'data: 1\n\n');
});

test('WS：帧写入并在 read 中返回', () => {
  const cap = createProxyCapture({ rootDir: tmpRoot() });
  const h = cap.begin(RID, { method: 'GET', url: '/ws', headers: {}, kind: 'ws' });
  h.frame('c2s', 0x1, Buffer.from('hi'));
  h.frame('s2c', 0x2, Buffer.from([1, 2]));
  h.finish({ status: 101, durationMs: 1 });
  const id = cap.list(RID)[0].id;
  const rec = cap.read(RID, id);
  assert.equal(rec.record.kind, 'ws');
  assert.equal(rec.frames.length, 2);
  assert.equal(rec.frames[0].data, 'hi');
});

test('超过 maxBody 的正文标 truncated 且不再增长', () => {
  const cap = createProxyCapture({ rootDir: tmpRoot(), maxBody: 4 });
  const h = cap.begin(RID, { method: 'GET', url: '/b', headers: {} });
  h.resHeaders({});
  h.resBody(Buffer.from('123456789'));
  h.finish({ status: 200, durationMs: 1 });
  const id = cap.list(RID)[0].id;
  const rec = cap.read(RID, id);
  assert.equal(rec.record.truncated, true);
  assert.equal(rec.resBody, '1234');
});

test('clear / removeRule 清目录', () => {
  const root = tmpRoot();
  const cap = createProxyCapture({ rootDir: root });
  const h = cap.begin(RID, { method: 'GET', url: '/', headers: {} });
  h.finish({ status: 200, durationMs: 1 });
  cap.clear(RID);
  assert.equal(cap.list(RID).length, 0);
  const h2 = cap.begin(RID, { method: 'GET', url: '/', headers: {} });
  h2.finish({ status: 200, durationMs: 1 });
  cap.removeRule(RID);
  assert.equal(fs.existsSync(path.join(root, RID)), false);
});
