import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotice, noticeUrl, NOTICE_BASE_URL } from '../notice.js';

const okRes = (body) => ({ ok: true, status: 200, text: async () => body });
const badRes = (status) => ({ ok: false, status, text: async () => '' });

test('noticeUrl 按语言拼接 <lang>/main.md，非法回落 en', () => {
  assert.equal(noticeUrl('zh-CN'), NOTICE_BASE_URL + '/zh-CN/main.md');
  assert.equal(noticeUrl('en'), NOTICE_BASE_URL + '/en/main.md');
  assert.equal(noticeUrl('fr'), NOTICE_BASE_URL + '/en/main.md');
});

test('按语言分别抓取并各自缓存', async () => {
  const urls = [];
  const notice = createNotice({ fetchImpl: async (u) => { urls.push(u); return okRes('c:' + u); } });
  const zh = await notice.get('zh-CN');
  const en = await notice.get('en');
  assert.equal(zh.content, 'c:' + NOTICE_BASE_URL + '/zh-CN/main.md');
  assert.equal(en.content, 'c:' + NOTICE_BASE_URL + '/en/main.md');
  assert.equal(urls.length, 2);
  const zh2 = await notice.get('zh-CN');
  assert.equal(zh2.cached, true);
  assert.equal(urls.length, 2);
});

test('非法语言回落 en 并复用其缓存', async () => {
  const urls = [];
  const notice = createNotice({ fetchImpl: async (u) => { urls.push(u); return okRes('x'); } });
  await notice.get('en');
  const r = await notice.get('xx');
  assert.equal(r.lang, 'en');
  assert.equal(r.cached, true);
  assert.equal(urls.length, 1);
});

test('非 200 且无缓存 -> ok:false', async () => {
  const notice = createNotice({ fetchImpl: async () => badRes(404) });
  const r = await notice.get('en');
  assert.equal(r.ok, false);
  assert.match(r.error, /404/);
});

test('抓取失败但有旧缓存 -> 返回旧内容并标 stale', async () => {
  let fail = false;
  const notice = createNotice({ cacheMs: 0, fetchImpl: async () => { if (fail) throw new Error('down'); return okRes('v1'); } });
  await notice.get('zh-CN');
  fail = true;
  const r = await notice.get('zh-CN');
  assert.equal(r.ok, true);
  assert.equal(r.content, 'v1');
  assert.equal(r.stale, true);
});
