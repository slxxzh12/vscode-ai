import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { CollabEngine } from '../collaboration/engine.js';
import { CollabStore } from '../collaboration/store.js';
import { loadIdentity } from '../collaboration/identity.js';
import { createCollabMount } from '../collaboration/http-mount.js';
import { makePeerClient } from '../collaboration/peer-client.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-http-')); }

async function startNode(name) {
  const dir = path.join(tmp(), name);
  const skillsRoot = path.join(dir, 'skills');
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });
  fs.mkdirSync(skillsRoot, { recursive: true });
  const store = new CollabStore({ file: path.join(dir, 'collab.json') });
  const identity = loadIdentity({ file: path.join(dir, 'identity.json'), username: name, host: '127.0.0.1', port: 0 });
  const engine = new CollabEngine({ store, identity, skillsRoot, inboxDir: path.join(dir, 'inbox') });
  const peer = makePeerClient();
  engine.peer = peer;
  const mount = createCollabMount({ engine, logger: console });
  const server = http.createServer((req, res) => mount(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  engine.setAdvertised({ host: '127.0.0.1', port }); // 用真实端口刷新本机公开身份
  return { name, engine, server, skillsRoot, port };
}
function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}

test('双节点 HTTP 全流程：好友→建群→分发→收件箱→安装', async () => {
  const A = await startNode('alice');
  const B = await startNode('bob');
  const demo = path.join(A.skillsRoot, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(path.join(demo, 'SKILL.md'), '# demo', 'utf8');
  try {
    // 加好友
    const req1 = await post(`http://127.0.0.1:${A.port}/api/collab/friends`, { host: '127.0.0.1', port: B.port });
    assert.equal(req1.status, 200);
    await new Promise((r) => setTimeout(r, 50));
    const pend = B.engine.store.listPendingFriends();
    assert.equal(pend.length, 1);
    await post(`http://127.0.0.1:${B.port}/api/collab/friends/${A.engine.pub.machineId}/accept`, {});
    assert.ok(A.engine.store.findFriend(B.engine.pub.machineId));
    assert.ok(B.engine.store.findFriend(A.engine.pub.machineId));
    // 建群+邀请
    const gRes = await post(`http://127.0.0.1:${A.port}/api/collab/groups`, { name: 'team' });
    assert.equal(gRes.status, 200);
    const gid = gRes.body.group.id;
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/invite`, { machineId: B.engine.pub.machineId });
    await new Promise((r) => setTimeout(r, 50));
    const inv = B.engine.store.listPendingInvites()[0];
    assert.ok(inv);
    await post(`http://127.0.0.1:${B.port}/api/collab/invites/${inv.id}/accept`, {});
    assert.ok(B.engine.store.findGroup(gid));
    // 分发
    const dist = await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/distribute`, { skillNames: ['demo'] });
    assert.equal(dist.status, 200);
    assert.equal(dist.body.failures.length, 0, JSON.stringify(dist.body.failures));
    await new Promise((r) => setTimeout(r, 100));
    const inbox = B.engine.store.listInbox();
    assert.equal(inbox.length, 1);
    // 安装
    await post(`http://127.0.0.1:${B.port}/api/collab/inbox/${inbox[0].id}/install`, {});
    assert.ok(fs.existsSync(path.join(B.skillsRoot, 'demo', 'SKILL.md')));
  } finally {
    A.server.close(); B.server.close();
  }
});

test('snapshot 与 skills 端点返回', async () => {
  const A = await startNode('alice2');
  const demo = path.join(A.skillsRoot, 'demo2');
  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(path.join(demo, 'SKILL.md'), '# demo2', 'utf8');
  try {
    const snap = await fetch(`http://127.0.0.1:${A.port}/api/collab/snapshot`).then((r) => r.json());
    assert.equal(snap.identity.username, 'alice2');
    assert.ok(Array.isArray(snap.friends));
    const sk = await fetch(`http://127.0.0.1:${A.port}/api/collab/skills`).then((r) => r.json());
    assert.ok(sk.skills.some((s) => s.name === 'demo2'));
  } finally { A.server.close(); }
});

test('HTTP 文件推送：头部公钥 + sha256 签名校验（合法通过 / 未知公钥拒收 / 坏签名拒收）', async () => {
  const A = await startNode('alice-f');
  const B = await startNode('bob-f');
  const C = await startNode('mallory');
  const postPeer = async (port, env, extraHeaders = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/collab/peer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(env),
    });
    return r.json();
  };
  try {
    // A↔B 好友并同群
    await post(`http://127.0.0.1:${A.port}/api/collab/friends`, { host: '127.0.0.1', port: B.port });
    await new Promise((r) => setTimeout(r, 50));
    await post(`http://127.0.0.1:${B.port}/api/collab/friends/${A.engine.pub.machineId}/accept`, {});
    const gRes = await post(`http://127.0.0.1:${A.port}/api/collab/groups`, { name: 'team' });
    const gid = gRes.body.group.id;
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/invite`, { machineId: B.engine.pub.machineId });
    await new Promise((r) => setTimeout(r, 50));
    await post(`http://127.0.0.1:${B.port}/api/collab/invites/${B.engine.store.listPendingInvites()[0].id}/accept`, {});
    await new Promise((r) => setTimeout(r, 80));

    const data = Buffer.from('file-http-receipt-check', 'utf8');
    // 1) 合法：A 经 upload 端点推文件（peer-client 自动带头部凭证）→ B 收到
    const up = await fetch(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/files?name=${encodeURIComponent('r.txt')}`, { method: 'POST', body: data });
    assert.equal(up.status, 200);
    const items = B.engine.store.listInbox();
    const got = items.find((i) => i.fileName === 'r.txt');
    assert.ok(got, 'B 已收到文件');
    assert.equal(fs.readFileSync(got.zipPath, 'utf8'), 'file-http-receipt-check');

    // 2) 未知公钥（非好友/非群成员）→ 拒收
    const envU = { type: 'file-push', from: C.engine.pub, payload: { fileName: 'u.bin', hash: 'aa', size: 1, b64: 'YQ==' }, ts: Date.now(), sig: 'x' };
    const rU = await postPeer(B.port, envU, C.engine.fileReceiptHeaders(Buffer.from('z')));
    assert.equal(rU.ok, false);
    assert.equal(rU.error, 'untrusted-pubkey');

    // 3) 公钥可信但 sha256 签名伪造 → 拒收
    const envB = A.engine._sign('file-push', { fileName: 'w.bin', hash: 'ab'.repeat(32), size: 1, b64: 'YQ==' });
    const rB = await postPeer(B.port, envB, {
      'x-df-pub': Buffer.from(A.engine.pub.publicKey, 'utf8').toString('base64'),
      'x-df-sha': 'ab'.repeat(32),
      'x-df-sig': 'AAAA',
    });
    assert.equal(rB.ok, false);
    assert.equal(rB.error, 'bad-sha-signature');
    assert.equal(B.engine.store.listInbox().length, 1, '伪造推送均未入库');
  } finally {
    A.server.close(); B.server.close(); C.server.close();
  }
});

test('群聊与远程执行 REST 冒烟', async () => {
  const A = await startNode('alice');
  const B = await startNode('bob');
  B.engine.runner = { execute: async () => ({ stdout: 'OK', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 }) };
  try {
    // 加好友 + 建群 + 邀请
    await post(`http://127.0.0.1:${A.port}/api/collab/friends`, { host: '127.0.0.1', port: B.port });
    await new Promise((r) => setTimeout(r, 50));
    await post(`http://127.0.0.1:${B.port}/api/collab/friends/${A.engine.pub.machineId}/accept`, {});
    const gRes = await post(`http://127.0.0.1:${A.port}/api/collab/groups`, { name: 'team' });
    const gid = gRes.body.group.id;
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/invite`, { machineId: B.engine.pub.machineId });
    await new Promise((r) => setTimeout(r, 50));
    const inv = B.engine.store.listPendingInvites()[0];
    await post(`http://127.0.0.1:${B.port}/api/collab/invites/${inv.id}/accept`, {});
    // B 白名单加入，A 发普通聊天
    await post(`http://127.0.0.1:${B.port}/api/collab/allowlist`, { prefix: '安全命令' });
    const allow = await fetch(`http://127.0.0.1:${B.port}/api/collab/allowlist`).then((r) => r.json());
    assert.deepEqual(allow.allowlist, ['安全命令']);
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/chat`, { text: 'hello', toId: null });
    await new Promise((r) => setTimeout(r, 80));
    const chat = await fetch(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/chat`).then((r) => r.json());
    assert.ok(chat.messages.some((m) => m.text === 'hello'));
    // A @B 远程执行（命中白名单自动跑）
    const cmd = await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/cmd`, { text: '安全命令 go', toId: B.engine.pub.machineId });
    assert.equal(cmd.body.code, 'sent');
    await new Promise((r) => setTimeout(r, 120));
    const chat2 = await fetch(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/chat`).then((r) => r.json());
    const results = chat2.messages.filter((m) => m.kind === 'cmd-result');
    assert.ok(results.length >= 1, 'A 群内有 cmd-result');
    assert.equal(results[0].text, 'OK');
    // 非白名单命令 → B 有 pending
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/cmd`, { text: '危险命令 干', toId: B.engine.pub.machineId });
    await new Promise((r) => setTimeout(r, 80));
    const pending = await fetch(`http://127.0.0.1:${B.port}/api/collab/cmds`).then((r) => r.json());
    assert.equal(pending.pending.length, 1, 'B 有待确认命令');
    await post(`http://127.0.0.1:${B.port}/api/collab/cmds/${pending.pending[0].id}/approve`, { approve: true });
    await new Promise((r) => setTimeout(r, 80));
    const pending2 = await fetch(`http://127.0.0.1:${B.port}/api/collab/cmds`).then((r) => r.json());
    assert.equal(pending2.pending.length, 0, '确认后 pending 清空');
  } finally { A.server.close(); B.server.close(); }
});

test('邀请链接 REST：签发 → 预览 → 入群 → 撤销失效', async () => {
  const A = await startNode('alice-inv');
  const B = await startNode('bob-inv');
  try {
    const gRes = await post(`http://127.0.0.1:${A.port}/api/collab/groups`, { name: 'team' });
    const gid = gRes.body.group.id;

    const link = await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/invite-link`, { origin: 'http://127.0.0.1:3001' });
    assert.equal(link.status, 200);
    assert.ok(link.body.token.startsWith('dfinv1.'));
    assert.ok(link.body.url.includes('?invite='));
    const token = link.body.token;

    const pv = await fetch(`http://127.0.0.1:${B.port}/api/collab/join/preview?token=${encodeURIComponent(token)}`).then((r) => r.json());
    assert.equal(pv.code, 'ok');
    assert.equal(pv.groupName, 'team');

    const jr = await post(`http://127.0.0.1:${B.port}/api/collab/join`, { token });
    assert.equal(jr.status, 200);
    assert.equal(jr.body.code, 'joined', JSON.stringify(jr.body));
    assert.ok(B.engine.store.findGroup(gid), 'B 已入群');
    assert.ok(A.engine.store.findGroup(gid).members.find((m) => m.machineId === B.engine.pub.machineId), 'A 群含 B');

    // 撤销后旧 token 失效
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/invite-revoke`, {});
    const C = await startNode('carol-inv');
    const jr2 = await post(`http://127.0.0.1:${C.port}/api/collab/join`, { token });
    assert.equal(jr2.body.code, 'invite-revoked', JSON.stringify(jr2.body));
    C.server.close();
  } finally { A.server.close(); B.server.close(); }
});
