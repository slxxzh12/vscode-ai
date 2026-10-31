import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache, cacheKey, normalizeBody } from '../llm-cache.js';

test('normalizeBody 字段顺序无关，非 JSON 退化为 base64', () => {
  assert.equal(normalizeBody(Buffer.from('{"a":1,"b":2}')), normalizeBody(Buffer.from('{ "b": 2, "a": 1 }')));
  assert.equal(normalizeBody(Buffer.from('hello')), Buffer.from('hello').toString('base64'));
});

test('cacheKey 同 provider 同 body（顺序无关）同 key，不同 provider 不同 key', () => {
  const a = cacheKey('p1', 'POST', Buffer.from('{"model":"m","messages":[]}'));
  const b = cacheKey('p1', 'POST', Buffer.from('{"messages":[],"model":"m"}'));
  const c = cacheKey('p2', 'POST', Buffer.from('{"messages":[],"model":"m"}'));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('set/get 命中，TTL 过期后 miss', () => {
  const cache = createCache({ ttlMs: 60000 });
  const v = { status: 200, headers: {}, body: Buffer.from('x') };
  cache.set('k', v);
  assert.deepEqual(cache.get('k'), v);
  const now = Date.now();
  cache.set('k2', v, 10);
  assert.equal(cache.get('k2', { now: now + 1000 }), undefined);
});

test('maxEntries 触发 LRU 淘汰', () => {
  const cache = createCache({ maxEntries: 2 });
  cache.set('a', { status: 200, headers: {}, body: Buffer.from('a') });
  cache.set('b', { status: 200, headers: {}, body: Buffer.from('b') });
  cache.get('a');
  cache.set('c', { status: 200, headers: {}, body: Buffer.from('c') });
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a'));
  assert.ok(cache.get('c'));
});

test('超过 maxBytes 不写入', () => {
  const cache = createCache({ maxBytes: 4 });
  assert.equal(cache.set('big', { status: 200, headers: {}, body: Buffer.from('12345') }), false);
  assert.equal(cache.get('big'), undefined);
});
