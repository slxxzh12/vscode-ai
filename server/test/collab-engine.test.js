import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPairHarness } from '../collaboration/engine.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-eng-')); }

// A 开启访问（verifyAccessToken）并建群；B 粘贴链接入群
async function groupUp(A, B) {
  A.verifyAccessToken = (tk) => tk === 'good';
  A.ensureGroup();
  const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
  assert.equal(r.code, 'joined');
  return r.group;
}

test('multi-group: ensureGroup 幂等且成员去重', () => {
  return createPairHarness({ skipSkills: true }).then(async (h) => {
    try {
      const A = h.nodes[0];
      const g1 = A.ensureGroup();
      const g2 = A.ensureGroup();
      assert.equal(g1.id, A.pub.machineId);
      assert.equal(g2.id, A.pub.machineId);
      assert.equal(g1.name, `${A.pub.username}@${A.pub.host}:${A.pub.port}`);
      assert.equal(A.store.getGroup().members.length, 1);
      assert.equal(A.store.getGroup().hubId, A.pub.machineId);
      assert.equal(A.store.listGroups().length, 1);
    } finally { await h.stop(); }
  });
});

test('setAdvertised 刷新自有群名为 工号@IP:端口', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A] = h.nodes;
    A.store.upsertGroup({ id: 'legacy', name: 'test', hubId: A.pub.machineId, createdAt: 1, members: [{ ...A.pub }] });
    A.identity.employeeId = 'E5';
    A.setAdvertised({ host: '10.1.2.3', port: 8888 });
    assert.equal(A.store.findGroup('legacy').name, 'E5@10.1.2.3:8888');
  } finally { await h.stop(); }
});

test('setAdvertised 收到通配 host 时改用真实网卡 IP', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A] = h.nodes;
    A.setAdvertised({ host: '0.0.0.0', port: 22222 });
    assert.notEqual(A.pub.host, '0.0.0.0');
    assert.ok(A.pub.host.length > 0);
  } finally { await h.stop(); }
});

test('multi-group: joinByLink 校验令牌后入群并记录 hub', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    B.ensureGroup();
    const bad = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'bad' });
    assert.equal(bad.code, 'bad-token');
    const ok = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    assert.equal(ok.code, 'joined');
    assert.equal(B.store.findGroup(ok.group.id).members.length, 2);
    assert.equal(B.store.findGroup(ok.group.id).hubId, A.pub.machineId);
    assert.equal(A.store.getGroup().members.length, 2);
    assert.equal(B.store.listGroups().length, 2, 'B 自有群 + 加入的群');
    assert.ok(B.store.ownedGroup(B.pub.machineId), 'B 自有群保留');
    assert.ok(B.store.findGroup(ok.group.id), 'B 含 A 的群');
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
    const g = await groupUp(A, B);
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
    const g = await groupUp(A, B);
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
    const g = await groupUp(A, B);
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
    const fake = { type: 'chat-send', from: { ...B.pub }, payload: {}, ts: Date.now(), sig: 'bad' };
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
    const g = await groupUp(A, B);
    await A.distributeToGroup(g.id, ['demo']);
    // B 向 A pull-sync 后应看到群与 skill 清单
    const r = await B.pullSync(A.pub.machineId, { groupIds: [g.id] });
    assert.equal(r.code, 'ok');
    B.applyPull(r.data);
    const gs = B.store.listGroupSkills(g.id);
    assert.ok(gs.some((s) => s.skillName === 'demo'), 'pull 后能看到群内 skill 清单');
  } finally { await h.stop(); }
});

test('publishUpdate 写 update.json 且只含选中文件；checkUpdate 版本比较', async () => {
  const h = await createPairHarness({ skipSkills: false });
  try {
    const [A, B] = h.nodes;
    await groupUp(A, B);
    A.writeDownload('group.json', Buffer.from('{"x":1}'), 'group');
    A.writeDownload('usage.json', Buffer.from('{"y":2}'), 'usage');
    const pub = A.publishUpdate(['group.json']);
    assert.equal(pub.code, 'ok');
    assert.equal(pub.update.files.length, 1);
    assert.equal(pub.update.files[0].name, 'group.json');
    assert.equal(A.readUpdate().version, pub.update.version);

    const chk = await B.checkUpdate(A.pub.machineId);
    assert.equal(chk.code, 'ok');
    assert.equal(chk.newer, true);
    assert.equal(chk.update.files[0].name, 'group.json');
  } finally { await h.stop(); }
});

test('applyUpdate accept 只拉选中文件；reject 也推进版本且不改文件', async () => {
  const h = await createPairHarness({ skipSkills: false });
  try {
    const [A, B] = h.nodes;
    await groupUp(A, B);
    A.writeDownload('group.json', Buffer.from('G'), 'group');
    A.writeDownload('usage.json', Buffer.from('U'), 'usage');
    A.publishUpdate(['group.json']);

    const acc = await B.applyUpdate({ masterId: A.pub.machineId, action: 'accept' });
    assert.equal(acc.code, 'ok');
    assert.deepEqual(acc.files, ['group.json']);
    assert.ok(fs.existsSync(path.join(B.downloadsDir, 'group.json')));
    assert.ok(!fs.existsSync(path.join(B.downloadsDir, 'usage.json')), '未勾选的不该被拉取');

    const pub2 = A.publishUpdate(['usage.json']);
    const rej = await B.applyUpdate({ masterId: A.pub.machineId, action: 'reject' });
    assert.equal(rej.action, 'reject');
    assert.equal(rej.version, pub2.update.version);
    const chk = await B.checkUpdate(A.pub.machineId);
    assert.equal(chk.newer, false, 'reject 后同版本不再提示');
  } finally { await h.stop(); }
});

test('_inUpdateCheck/_inListDownloads 非成员被拒', () => {
  return createPairHarness({ skipSkills: true }).then(async (h) => {
    try {
      const [A, B] = h.nodes;
      A.ensureGroup();
      assert.equal(A._inUpdateCheck({ from: B.pub, payload: {} }).ok, false);
      assert.equal(A._inListDownloads({ from: B.pub, payload: {} }).ok, false);
    } finally { await h.stop(); }
  });
});
