import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInviteDays, DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS } from '../remote-gate.js';

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
