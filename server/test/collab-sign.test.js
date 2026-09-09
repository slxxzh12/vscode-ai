import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { canonicalize, signEnvelope, verifyEnvelope } from '../collaboration/sign.js';

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

test('canonicalize 键排序稳定', () => {
  const a = canonicalize({ b: 1, a: [2, { d: 3, c: 4 }], z: null });
  const b = canonicalize({ z: null, a: [2, { c: 4, d: 3 }], b: 1 });
  assert.equal(a, b);
});

test('正确密钥验签通过，错误密钥/篡改失败', () => {
  const k1 = keyPair();
  const k2 = keyPair();
  const env = signEnvelope(k1.privateKey, 'ping', {
    machineId: 'm1', username: 'u', host: 'h', port: 1, publicKey: k1.publicKey,
  }, { hello: 'world' });
  assert.equal(verifyEnvelope(k1.publicKey, env), true);
  assert.equal(verifyEnvelope(k2.publicKey, env), false);          // 错公钥
  const tampered = { ...env, payload: { ...env.payload, hello: 'x' } };
  assert.equal(verifyEnvelope(k1.publicKey, tampered), false);     // 篡改
});

test('时间戳超窗拒绝', () => {
  const k = keyPair();
  const pastTs = Date.now() - 10 * 60 * 1000;
  const env = signEnvelope(k.privateKey, 'ping', {
    machineId: 'm', username: 'u', host: 'h', port: 1, publicKey: k.publicKey,
  }, {}, pastTs);
  assert.equal(verifyEnvelope(k.publicKey, env, { now: Date.now(), skewMs: 5 * 60 * 1000 }), false);
});

test('缺少字段的包被拒', () => {
  assert.equal(verifyEnvelope('pub', null), false);
  assert.equal(verifyEnvelope('pub', { type: 'x' }), false);
});
