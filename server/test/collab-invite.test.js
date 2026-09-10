import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeInviteToken, parseInviteToken, INVITE_TTL_MS } from '../collaboration/invite.js';
import { createPairHarness } from '../collaboration/engine.js';

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

test('owner 生成邀请链接；非成员被拒；撤销后 epoch 自增', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A] = h.nodes;
    const g = await A.createGroup('team');
    assert.equal(A.store.findGroup(g.id).inviteEpoch, 0, '新群 inviteEpoch=0');

    const link = A.createInviteLink({ groupId: g.id });
    assert.equal(link.code, 'ok', JSON.stringify(link));
    assert.equal(typeof link.token, 'string');
    assert.ok(link.token.startsWith('dfinv1.'), 'token 前缀');
    assert.ok(link.expiresAt > Date.now(), 'expiresAt 在未来');

    const notM = A.createInviteLink({ groupId: 'no-such-group' });
    assert.equal(notM.code, 'not-member');

    const rev = await A.revokeInvites(g.id);
    assert.equal(rev.code, 'ok');
    assert.equal(rev.epoch, 1, '撤销后 inviteEpoch=1');
  } finally { await h.stop(); }
});

test('普通成员（member）不能生成邀请链接', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await A.createGroup('team');
    // 给 B 本地造一个“自己是 member”的同群副本（纯权限测试，不依赖入群流程）
    B.store.addGroup({
      id: g.id, name: g.name, ownerId: A.pub.machineId, createdAt: Date.now(), inviteEpoch: 0,
      members: [
        { ...A.pub, role: 'owner' },
        { ...B.pub, role: 'member' },
      ],
    });
    const r = B.createInviteLink({ groupId: g.id });
    assert.equal(r.code, 'forbidden');
  } finally { await h.stop(); }
});
