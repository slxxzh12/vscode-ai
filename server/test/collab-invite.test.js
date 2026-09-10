import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeInviteToken, parseInviteToken, INVITE_TTL_MS } from '../collaboration/invite.js';

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
function baseBody(overrides = {}) {
  return {
    groupId: 'g1', groupName: 'team',
    inviter: { machineId: 'm1', username: 'alice', host: '127.0.0.1', port: 3001, publicKey: '' },
    epoch: 0, exp: Date.now() + INVITE_TTL_MS,
    ...overrides,
  };
}

test('邀请 token 可往返解析', () => {
  const k = keyPair();
  const b = baseBody(); b.inviter.publicKey = k.publicKey;
  const token = makeInviteToken(k.privateKey, b);
  const r = parseInviteToken(token);
  assert.equal(r.ok, true);
  assert.equal(r.body.groupId, 'g1');
  assert.equal(r.body.groupName, 'team');
  assert.equal(r.body.inviter.username, 'alice');
  assert.equal(r.body.epoch, 0);
});

test('篡改 body 或签名被拒', () => {
  const k = keyPair();
  const b = baseBody(); b.inviter.publicKey = k.publicKey;
  const token = makeInviteToken(k.privateKey, b);
  const [prefix, payload, sig] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const tampered = JSON.stringify({ ...decoded, groupName: 'hacked' });
  const badBody = `${prefix}.${Buffer.from(tampered).toString('base64url')}.${sig}`;
  assert.equal(parseInviteToken(badBody).ok, false);
  const badSig = `${prefix}.${payload}.${Buffer.from('x').toString('base64url')}`;
  assert.equal(parseInviteToken(badSig).ok, false);
});

test('格式非法被拒', () => {
  assert.equal(parseInviteToken('').ok, false);
  assert.equal(parseInviteToken('dfinv1.onlytwo').ok, false);
  assert.equal(parseInviteToken('wrongprefix.a.b').ok, false);
  assert.equal(parseInviteToken(null).ok, false);
});
