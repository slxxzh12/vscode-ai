import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signEnvelope } from '../collaboration/sign.js';
import { createPairHarness } from '../collaboration/engine.js';

async function groupUp(nodes) {
  const [A, B] = nodes;
  A.verifyAccessToken = (tk) => tk === 'good';
  A.ensureGroup();
  const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
  assert.equal(r.code, 'joined');
  return r.group;
}

test('sendChat：成员发给群主，群主落库；群主发的由成员拉取', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp([A, B]);
    // 成员 B 发消息 → 只发给群主 A，A 落库；B 本地留缓存；不广播
    const r = await B.sendChat({ groupId: g.id, text: '大家好' });
    assert.equal(r.code, 'ok');
    const amsgs = A.store.listChatMessages(g.id);
    assert.equal(amsgs.length, 1, '群主落库');
    assert.equal(amsgs[0].text, '大家好');
    assert.equal(amsgs[0].fromId, B.pub.machineId);
    assert.equal(B.store.listChatMessages(g.id).length, 1, '成员本地缓存');
    // 群主再发一条：成员进聊天时从群主拉取（含对方）+ 本地去重
    await A.sendChat({ groupId: g.id, text: '收到' });
    const pulled = await B.pullChatFrom(A.pub.machineId, { groupId: g.id });
    assert.equal(pulled.code, 'ok');
    B.applyChatPull({ groupId: g.id, messages: pulled.messages });
    const bmsgs = B.store.listChatMessages(g.id);
    assert.ok(bmsgs.some((m) => m.text === '收到'), '拉到群主的新消息');
    assert.equal(bmsgs.filter((m) => m.id === amsgs[0].id).length, 1, '同 id 不重复');
  } finally { await h.stop(); }
});

test('sendImage：成员发图 → 群主落库（含 base64 meta）；非法 mime/空图被拒', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp([A, B]);
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const r = await B.sendImage({ groupId: g.id, name: 'shot.png', mime: 'image/png', data: png });
    assert.equal(r.code, 'ok');
    const amsgs = A.store.listChatMessages(g.id);
    assert.equal(amsgs.length, 1, '群主落库');
    assert.equal(amsgs[0].kind, 'image');
    assert.equal(amsgs[0].text, 'shot.png');
    assert.equal(amsgs[0].meta.name, 'shot.png');
    assert.equal(amsgs[0].meta.mime, 'image/png');
    assert.equal(amsgs[0].meta.b64, png.toString('base64'));
    assert.equal(B.store.listChatMessages(g.id).length, 1, '成员本地缓存');
    assert.equal((await B.sendImage({ groupId: g.id, name: 'x', mime: 'text/plain', data: png })).code, 'bad-image');
    assert.equal((await B.sendImage({ groupId: g.id, name: 'x', mime: 'image/png', data: Buffer.alloc(0) })).code, 'empty-image');
  } finally { await h.stop(); }
});

test('远程命令 → B 产生 pending，approve 后执行', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp([A, B]);
    const executed = [];
    B.runner = { execute: async ({ text }) => { executed.push(text); return { stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 }; } };
    const res = await A.requestRemoteExec({ groupId: g.id, text: '危险命令 删除', toId: B.pub.machineId });
    assert.equal(res.code, 'sent');
    await new Promise((r) => setTimeout(r, 20));
    const pend = B.store.listPendingCmds();
    assert.equal(pend.length, 1, 'B 产生 pending');
    await B.approveCmd({ reqId: pend[0].id, approve: true });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(executed.length, 1, 'approve 后执行');
    assert.equal(B.store.listPendingCmds().length, 0);
  } finally { await h.stop(); }
});

test('越权：非群成员发 CMD_REQ 被拒', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp([A, B]);
    // 把 A 从 B 侧群成员移除，A 仍是 B 好友（签名仍可验证）→ 群成员鉴权应拒绝
    const gB = B.store.findGroup(g.id);
    gB.members = gB.members.filter((m) => m.machineId !== A.pub.machineId);
    B.store.saveGroup(gB);
    const env = signEnvelope(A.identity.privateKey, 'cmd-req', A.pub,
      { groupId: g.id, text: 'x', toId: B.pub.machineId, reqId: 'r-fake' });
    const res = await B.engine.handleIncoming(env);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'not-member');
  } finally { await h.stop(); }
});
