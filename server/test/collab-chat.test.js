import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signEnvelope } from '../collaboration/sign.js';
import { createPairHarness } from '../collaboration/engine.js';

async function groupUp(nodes) {
  const [A, B] = nodes;
  await A.requestFriend({ host: B.pub.host, port: B.pub.port });
  await B.acceptFriend(A.pub.machineId);
  const g = await A.createGroup('team');
  await A.inviteMember({ groupId: g.id, targetMachineId: B.pub.machineId });
  await B.acceptInvite(B.store.listPendingInvites()[0].id);
  return g;
}

test('sendChat 双方落历史（seq 单调）', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp([A, B]);
    const r = await A.sendChat({ groupId: g.id, text: '大家好' });
    assert.equal(r.code, 'ok');
    const bmsgs = B.store.listChatMessages(g.id);
    assert.equal(bmsgs.length, 1);
    assert.equal(bmsgs[0].text, '大家好');
    assert.equal(bmsgs[0].fromId, A.pub.machineId);
    const amsgs = A.store.listChatMessages(g.id);
    assert.equal(amsgs.length, 1);
  } finally { await h.stop(); }
});

test('白名单命中自动执行并回结果', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp([A, B]);
    const executed = [];
    B.runner = { execute: async ({ text }) => { executed.push(text); return { stdout: 'OUT', stderr: '', exitCode: 0, timedOut: false, durationMs: 5 }; } };
    B.store.addAllowEntry('安全命令');
    const res = await A.requestRemoteExec({ groupId: g.id, text: '安全命令 跑测试', toId: B.pub.machineId });
    assert.equal(res.code, 'sent');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(executed.length, 1, '白名单自动执行');
    const results = A.store.listChatMessages(g.id).filter((m) => m.kind === 'cmd-result');
    assert.ok(results.length >= 1, 'A 收到 cmd-result');
    assert.equal(results[0].text, 'OUT');
  } finally { await h.stop(); }
});

test('未命中白名单 → B 产生 pending，approve 后执行', async () => {
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
