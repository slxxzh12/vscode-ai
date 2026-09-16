import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInviteDays, resolveInviteDaysAllowForever, DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS, isPeerRequest, resolveBindHost, hostRestartNeeded, LOOPBACK_HOST, PUBLIC_HOST } from '../remote-gate.js';

test('resolveInviteDaysï¼šé»˜è®¤ 1 å¤©ï¼Œå…è®¸ 1..100ï¼Œ>100 æ”¶æ•›åˆ° 100ï¼Œéžæ³•å›žé€€é»˜è®¤', () => {
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

test('resolveInviteDaysï¼šå…¼å®¹æ—§ hours å­—æ®µ', () => {
  assert.equal(resolveInviteDays({ hours: 48 }), 2);
  assert.equal(resolveInviteDays({ hours: 4 }), 1);
});

test('isPeerRequestï¼špeer ä¸Žç”¨é‡ä¸ŠæŠ¥çš„ POST æ”¾è¡Œï¼Œå…¶ä½™æ‹’ç»', () => {
  assert.equal(isPeerRequest('/api/collab/peer', 'POST'), true);
  assert.equal(isPeerRequest('/api/usage/report', 'POST'), true);
  assert.equal(isPeerRequest('/api/usage/report', 'GET'), false);
  assert.equal(isPeerRequest('/api/collab/downloads', 'POST'), false);
  assert.equal(isPeerRequest('/api/collab/stats', 'POST'), false);
});

test('resolveInviteDaysAllowForeverï¼šdays=0 è¡¨ç¤ºé•¿æœŸï¼Œå…¶å®ƒæ²¿ç”¨ resolveInviteDays', () => {
  assert.equal(resolveInviteDaysAllowForever({ days: 0 }), 0);
  assert.equal(resolveInviteDaysAllowForever({ days: '0' }), 0);
  assert.equal(resolveInviteDaysAllowForever({}), DEFAULT_INVITE_DAYS);
  assert.equal(resolveInviteDaysAllowForever({ days: 7 }), 7);
  assert.equal(resolveInviteDaysAllowForever({ days: 9999 }), MAX_INVITE_DAYS);
});

test('resolveBindHost£ºmaster ¹ØÖ»°ó»Ø»·£¬master ¿ª°ó 0.0.0.0£¬env ¸²¸ÇÓÅÏÈ', () => {
  assert.equal(LOOPBACK_HOST, '127.0.0.1');
  assert.equal(PUBLIC_HOST, '0.0.0.0');
  assert.equal(resolveBindHost({ masterOn: false }), '127.0.0.1');
  assert.equal(resolveBindHost({ masterOn: true }), '0.0.0.0');
  assert.equal(resolveBindHost({ masterOn: false, envHost: '0.0.0.0' }), '0.0.0.0');
  assert.equal(resolveBindHost({ masterOn: true, envHost: '192.168.1.9' }), '192.168.1.9');
  assert.equal(resolveBindHost({ masterOn: false, envHost: '   ' }), '127.0.0.1');
});

test('hostRestartNeeded£ºÇÐ»» master ×´Ì¬Óëµ±Ç°°ó¶¨²»Ò»ÖÂÊ±ÒªÇóÖØÆô', () => {
  assert.equal(hostRestartNeeded({ current: '127.0.0.1', masterOn: true }), true);
  assert.equal(hostRestartNeeded({ current: '0.0.0.0', masterOn: true }), false);
  assert.equal(hostRestartNeeded({ current: '0.0.0.0', masterOn: false }), true);
  assert.equal(hostRestartNeeded({ current: '127.0.0.1', masterOn: false }), false);
  assert.equal(hostRestartNeeded({ current: '127.0.0.1', masterOn: true, envHost: '127.0.0.1' }), false);
});
