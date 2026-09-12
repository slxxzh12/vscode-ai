import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyPool } from '../llm-keypool.js';

test('按 providerId 独立轮询并循环', () => {
  const pool = createKeyPool();
  assert.equal(pool.next('p', ['a', 'b']), 'a');
  assert.equal(pool.next('p', ['a', 'b']), 'b');
  assert.equal(pool.next('p', ['a', 'b']), 'a');
  assert.equal(pool.next('q', ['a', 'b']), 'a');
});

test('空池与空数组返回空串', () => {
  const pool = createKeyPool();
  assert.equal(pool.next('p', []), '');
  assert.equal(pool.next('p', undefined), '');
});

test('冷却中的 key 被跳过，到期恢复', () => {
  let t = 0;
  const pool = createKeyPool({ cooldownMs: 1000, now: () => t });
  assert.equal(pool.next('p', ['a', 'b']), 'a');
  pool.cool('p', 'a');
  assert.equal(pool.isCooling('p', 'a'), true);
  assert.equal(pool.next('p', ['a', 'b']), 'b');
  assert.equal(pool.next('p', ['a', 'b']), 'b');
  t = 1000;
  assert.equal(pool.isCooling('p', 'a'), false);
});

test('全部冷却时取最早到期', () => {
  let t = 0;
  const pool = createKeyPool({ cooldownMs: 1000, now: () => t });
  pool.cool('p', 'a', 1000);
  pool.cool('p', 'b', 5000);
  assert.equal(pool.next('p', ['a', 'b']), 'a');
});

test('自定义冷却时长与 clear', () => {
  let t = 0;
  const pool = createKeyPool({ now: () => t });
  pool.cool('p', 'a', 500);
  assert.equal(pool.isCooling('p', 'a'), true);
  t = 500;
  assert.equal(pool.isCooling('p', 'a'), false);
  pool.cool('p', 'a');
  pool.clear();
  assert.equal(pool.isCooling('p', 'a'), false);
});
