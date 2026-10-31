import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signJwt, verifyJwt } from '../llm-jwt.js';

test('签验往返', () => {
  const t = signJwt({ sub: 'E001', jti: 'x' }, 'secret', { now: 1000 * 1000 });
  const p = verifyJwt(t, 'secret', { now: 1000 * 1000 + 1000 });
  assert.equal(p.sub, 'E001');
  assert.equal(p.jti, 'x');
});

test('错密钥验签失败', () => {
  const t = signJwt({ sub: 'a', jti: 'x' }, 'k1', { now: 0 });
  assert.throws(() => verifyJwt(t, 'k2', { now: 0 }), (e) => e.code === 'bad-signature');
});

test('过期失败', () => {
  const t = signJwt({ sub: 'a', jti: 'x', exp: 100 }, 'k', { now: 0 });
  assert.throws(() => verifyJwt(t, 'k', { now: 200 * 1000 }), (e) => e.code === 'expired');
});

test('篡改 payload 失败', () => {
  const t = signJwt({ sub: 'a', jti: 'x' }, 'k', { now: 0 });
  const parts = t.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'b', jti: 'y' })).toString('base64url');
  assert.throws(() => verifyJwt(`${parts[0]}.${forged}.${parts[2]}`, 'k', { now: 0 }), (e) => e.code === 'bad-signature');
});
