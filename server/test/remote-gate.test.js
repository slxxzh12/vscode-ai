import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInviteDays, resolveInviteDaysAllowForever, DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS, isPeerRequest } from '../remote-gate.js';

test('resolveInviteDays：默认 1 天，允许 1..100，>100 收敛到 100，非法回退默认', () => {
  assert.equal(resolveInviteDays({}), DEFAULT_INVITE_DAYS);
  assert.equal(resolveInviteDays({ days: 1 }), 1);
  assert.equal(resolveInviteDays({ days: 7 }), 7);
  assert.equal(resolveInviteDays({ days: 30 }), 30);
  assert.equal(resolveInviteDays({ days: MAX_INVITE_DAYS }), MAX_INVITE_DAYS);
  assert.equal(resolveInviteDays({ days: 101 }), MAX_INVITE_DAYS);
  assert.equal(resolveInviteDays({ days: 9999 }), MAX_INVITE_DAYS);
  assert.equal(resolveInviteDays({ days: 0 }), DEFAULT_INVITE_DAYS);
  assert.equal(resolveInviteDays({ days: -3 }), DEFAULT_INVITE_DAYS);
  assert.equal(resolveInviteDays({ days: 'x' }), DEFAULT_INVITE_DAYS);
  assert.equal(resolveInviteDays({ days: 2.6 }), 3);
});

test('resolveInviteDays：兼容旧 hours 字段', () => {
  assert.equal(resolveInviteDays({ hours: 48 }), 2);
  assert.equal(resolveInviteDays({ hours: 4 }), 1);
});

test('isPeerRequest：peer 与用量上报的 POST 放行，其余拒绝', () => {
  assert.equal(isPeerRequest('/api/collab/peer', 'POST'), true);
  assert.equal(isPeerRequest('/api/usage/report', 'POST'), true);
  assert.equal(isPeerRequest('/api/usage/report', 'GET'), false);
  assert.equal(isPeerRequest('/api/collab/downloads', 'POST'), false);
  assert.equal(isPeerRequest('/api/collab/stats', 'POST'), false);
});

test('resolveInviteDaysAllowForever：days=0 表示长期，其它沿用 resolveInviteDays', () => {
  assert.equal(resolveInviteDaysAllowForever({ days: 0 }), 0);
  assert.equal(resolveInviteDaysAllowForever({ days: '0' }), 0);
  assert.equal(resolveInviteDaysAllowForever({}), DEFAULT_INVITE_DAYS);
  assert.equal(resolveInviteDaysAllowForever({ days: 7 }), 7);
  assert.equal(resolveInviteDaysAllowForever({ days: 9999 }), MAX_INVITE_DAYS);
});
