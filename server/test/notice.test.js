import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotice, NOTICE_URL } from '../notice.js';

const okRes = (body) => ({ ok: true, status: 200, text: async () => body });
const badRes = (status) => ({ ok: false, status, text: async () => '' });

test('NOTICE_URL 指向 vscode-ai-mobile 的 notice/readme.md', () => {
  assert.equal(NOTICE_URL, 'https://gitee.com/slxxzh12/vscode-ai-mobile/raw/master/notice/readme.md');
});

test('首次抓取写缓存，命中缓存不再请求', async () => {
  let calls = 0;
  const notice = createNotice({ fetchImpl: async () => { calls += 1; return okRes('hello'); } });
  const a = await notice.get();
  assert.equal(a.ok, true);
  assert.equal(a.content, 'hello');
  assert.equal(a.cached, false);
  const b = await notice.get();
  assert.equal(b.cached, true);
  assert.equal(calls, 1);
});

test('非 200 且无缓存 -> ok:false', async () => {
  const notice = createNotice({ fetchImpl: async () => badRes(404) });
  const r = await notice.get();
  assert.equal(r.ok, false);
  assert.match(r.error, /404/);
});

test('抓取异常且无缓存 -> ok:false', async () => {
  const notice = createNotice({ fetchImpl: async () => { throw new Error('timeout'); } });
  const r = await notice.get();
  assert.equal(r.ok, false);
  assert.match(r.error, /timeout/);
});

test('抓取失败但有旧缓存 -> 返回旧内容并标 stale', async () => {
  let fail = false;
  const notice = createNotice({
    cacheMs: 0,
    fetchImpl: async () => { if (fail) throw new Error('down'); return okRes('v1'); },
  });
  const first = await notice.get();
  assert.equal(first.content, 'v1');
  fail = true;
  const r = await notice.get();
  assert.equal(r.ok, true);
  assert.equal(r.content, 'v1');
  assert.equal(r.stale, true);
});
