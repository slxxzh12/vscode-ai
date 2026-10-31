import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPeerRequest, matchAccessToken } from '../remote-gate.js';

test('isPeerRequest 仅匹配 /api/collab/peer、/api/usage/report 与 /api/usage/multimodal 的 POST', () => {
  assert.equal(isPeerRequest('/api/collab/peer', 'POST'), true);
  assert.equal(isPeerRequest('/api/collab/peer', 'GET'), false);
  assert.equal(isPeerRequest('/api/usage/report', 'POST'), true);
  assert.equal(isPeerRequest('/api/usage/report', 'GET'), false);
  assert.equal(isPeerRequest('/api/usage/multimodal', 'POST'), true);
  assert.equal(isPeerRequest('/api/usage/multimodal', 'GET'), false);
  assert.equal(isPeerRequest('/api/collab/stats', 'POST'), false);
  assert.equal(isPeerRequest('/api/collab/snapshot', 'POST'), false);
});

test('matchAccessToken：正确令牌通过，错误/无邀请不通过', () => {
  const safeEqual = (a, b) => String(a) === String(b);
  const inv = { token: 'abc' };
  assert.equal(matchAccessToken('abc', inv, safeEqual), true);
  assert.equal(matchAccessToken('wrong', inv, safeEqual), false);
  assert.equal(matchAccessToken('abc', null, safeEqual), false);
  assert.equal(matchAccessToken(null, inv, safeEqual), false);
});
