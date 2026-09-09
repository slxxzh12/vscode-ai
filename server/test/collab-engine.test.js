import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabEngine, createPairHarness } from '../collaboration/engine.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-eng-')); }

test('好友握手双向登记', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const res = await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    assert.equal(res.code, 'requested');
    // B 侧应出现 pending friend
    assert.equal(B.store.findPendingFriend(A.pub.machineId) !== null, true);
    await B.acceptFriend(A.pub.machineId);
    assert.ok(A.store.findFriend(B.pub.machineId), 'A 已登记 B');
    assert.ok(B.store.findFriend(A.pub.machineId), 'B 已登记 A');
  } finally { await h.stop(); }
});

test('建群+邀请+接受+成员广播', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    await B.acceptFriend(A.pub.machineId);
    const g = await A.createGroup('team');
    await A.inviteMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    const inv = B.store.listPendingInvites()[0];
    assert.ok(inv, 'B 收到群邀请');
    await B.acceptInvite(inv.id);
    const gA = A.store.findGroup(g.id);
    assert.ok(gA.members.find((m) => m.machineId === B.pub.machineId), 'A 群含 B');
    const gB = B.store.findGroup(g.id);
    assert.ok(gB, 'B 也持有群');
    assert.ok(gB.members.find((m) => m.machineId === A.pub.machineId), 'B 群含 A');
  } finally { await h.stop(); }
});

test('角色规则：owner 占 1 管理位；第 2~5 位入群自动为 admin；admin 只能踢 member，owner 可踢任何人', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    await B.acceptFriend(A.pub.machineId);
    const g = await A.createGroup('team');
    // B 是第 2 位（owner 之后第 1 位）→ 应为 admin
    await A.inviteMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    await B.acceptInvite(B.store.listPendingInvites()[0].id);
    let gA = A.store.findGroup(g.id);
    const bRole = gA.members.find((m) => m.machineId === B.pub.machineId).role;
    assert.equal(bRole, 'admin', '第 2 位入群者应为 admin');
    // B(admin) 踢 A(owner) 应被拒
    const badKick = await B.kickMember({ groupId: g.id, targetMachineId: A.pub.machineId });
    assert.equal(badKick.code, 'forbidden', 'admin 不能踢 owner');
    // A(owner) 踢 B(admin) 应成功；B 本地收到 MEMBER_SYNC 后群应移除
    const okKick = await A.kickMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    assert.equal(okKick.code, 'kicked', JSON.stringify(okKick));
    gA = A.store.findGroup(g.id);
    assert.equal(gA.members.find((m) => m.machineId === B.pub.machineId), undefined, 'A 群不再含 B');
    assert.equal(B.store.findGroup(g.id), null, 'B 本地群已退出');
  } finally { await h.stop(); }
});

test('群内分发 skill → 对方 inbox → 安装', async () => {
  const h = await createPairHarness({ skipSkills: false });
  try {
    const [A, B] = h.nodes;
    // 给 A 造一个本机 skill
    const skillDir = path.join(A.skillsRoot, 'demo');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# demo', 'utf8');
    await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    await B.acceptFriend(A.pub.machineId);
    const g = await A.createGroup('team');
    await A.inviteMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    await B.acceptInvite(B.store.listPendingInvites()[0].id);
    const dist = await A.distributeToGroup(g.id, ['demo']);
    assert.equal(dist.failures.length, 0, JSON.stringify(dist.failures));
    const inbox = B.store.listInbox();
    assert.equal(inbox.length, 1, 'B inbox 有一条');
    const item = inbox[0];
    assert.equal(item.skillName, 'demo');
    await B.installInbox(item.id);
    assert.equal(B.store.findInbox(item.id).status, 'installed');
    assert.ok(fs.existsSync(path.join(B.skillsRoot, 'demo', 'SKILL.md')), '已安装到 B 技能目录');
  } finally { await h.stop(); }
});

test('切换工具目录：分发源/安装目标跟所选工具走，upload 留档 + 群系统消息', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const customA = path.join(tmp(), 'custom-a');
    const customB = path.join(tmp(), 'custom-b');
    // A 切到自定义工具目录并造一个 skill；B 也切到另一个自定义目录作安装目标
    assert.equal(A.setTool('custom', customA).root, customA);
    assert.equal(B.setTool('custom', customB).root, customB);
    const skillDir = path.join(A.skillRoot(), 'demo');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# demo', 'utf8');
    await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    await B.acceptFriend(A.pub.machineId);
    const g = await A.createGroup('team');
    await A.inviteMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    await B.acceptInvite(B.store.listPendingInvites()[0].id);
    const dist = await A.distributeToGroup(g.id, ['demo']);
    assert.equal(dist.failures.length, 0, JSON.stringify(dist.failures));
    // upload 目录留档 + outbox 记录
    assert.equal(A.store.listOutbox().length, 1);
    const out = A.store.listOutbox()[0];
    assert.equal(out.kind, 'skill');
    assert.ok(fs.existsSync(path.join(A.uploadDir, out.storedFile)), 'upload 目录存在 zip');
    const rm = A.removeOutbox(out.id);
    assert.equal(rm.code, 'ok');
    assert.equal(A.store.listOutbox().length, 0, '删除后 outbox 清空');
    assert.ok(!fs.existsSync(path.join(A.uploadDir, out.storedFile)), 'upload 留档同步删除');
    // B 收到的 zip 落在 download 目录；安装到 B 所选工具目录
    const item = B.store.listInbox()[0];
    assert.ok(item.zipPath.startsWith(B.downloadDir), 'zip 落 download 目录');
    await B.installInbox(item.id);
    assert.ok(fs.existsSync(path.join(customB, 'demo', 'SKILL.md')), '安装到 B 所选工具目录');
    // 分发后 A 群聊出现系统留痕
    const sys = A.store.listChatMessages(g.id).find((m) => m.kind === 'system');
    assert.ok(sys && sys.text.includes('demo'), '有分发留痕系统消息');
  } finally { await h.stop(); }
});

test('群内发文件：A 推送 → B 落 download 目录，sha256 校验 + 群系统消息', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    await B.acceptFriend(A.pub.machineId);
    const g = await A.createGroup('team');
    await A.inviteMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    await B.acceptInvite(B.store.listPendingInvites()[0].id);
    const payload = Buffer.from('hello-devflow-file', 'utf8');
    const sent = await A.sendFileToGroup(g.id, { fileName: 'notes.txt', data: payload });
    assert.equal(sent.code, 'ok', JSON.stringify(sent));
    assert.equal(sent.failures.length, 0, JSON.stringify(sent.failures));
    const inbox = B.store.listInbox();
    assert.equal(inbox.length, 1);
    const item = inbox[0];
    assert.equal(item.kind, 'file');
    assert.equal(item.fileName, 'notes.txt');
    assert.ok(item.zipPath.startsWith(B.downloadDir), '文件落 download 目录');
    assert.equal(fs.readFileSync(item.zipPath, 'utf8'), 'hello-devflow-file', '内容一致');
    // A 侧 outbox 留档 + upload 目录文件
    const out = A.store.listOutbox()[0];
    assert.equal(out.kind, 'file');
    assert.ok(fs.existsSync(path.join(A.uploadDir, out.storedFile)), 'upload 目录有文件留档');
    // sha256 篡改 → 拒收
    const bad = A._sign('file-push', { groupId: g.id, fileName: 'x.bin', hash: '0'.repeat(64), size: payload.length, b64: payload.toString('base64') });
    const r = await B.handleIncoming(bad);
    assert.equal(r.ok, false);
    assert.equal(B.store.listInbox().length, 1, '篡改文件未被接收');
    // 群系统留痕
    const sys = A.store.listChatMessages(g.id).find((m) => m.kind === 'system');
    assert.ok(sys && sys.text.includes('notes.txt'), '发文件留痕存在');
  } finally { await h.stop(); }
});

test('验签失败的消息被丢弃（伪造信封直接进 inbound）', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [, B] = h.nodes;
    // 用 B 自己的 profile（公钥有效）但签名坏 → 应被拒
    const fake = { type: 'friend-request', from: { ...B.pub }, payload: {}, ts: Date.now(), sig: 'bad' };
    const result = await B.engine.handleIncoming(fake);
    assert.equal(result.ok, false);
  } finally { await h.stop(); }
});

test('pull-sync 拉取对方群与 groupSkills', async () => {
  const h = await createPairHarness({ skipSkills: false });
  try {
    const [A, B] = h.nodes;
    const skillDir = path.join(A.skillsRoot, 'demo');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# demo', 'utf8');
    await A.requestFriend({ host: B.pub.host, port: B.pub.port });
    await B.acceptFriend(A.pub.machineId);
    const g = await A.createGroup('team');
    await A.inviteMember({ groupId: g.id, targetMachineId: B.pub.machineId });
    await B.acceptInvite(B.store.listPendingInvites()[0].id);
    await A.distributeToGroup(g.id, ['demo']);
    // C：新成员视角——B 向 A pull-sync 后应看到群与 skill 清单
    const r = await B.pullSync(A.pub.machineId, { groupIds: [g.id] });
    assert.equal(r.code, 'ok');
    B.applyPull(r.data);
    const gs = B.store.listGroupSkills(g.id);
    assert.ok(gs.some((s) => s.skillName === 'demo'), 'pull 后能看到群内 skill 清单');
  } finally { await h.stop(); }
});
