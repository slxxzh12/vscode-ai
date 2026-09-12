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
// A 开启访问（令牌 'good'）建群；B 粘贴链接经 /api/collab/join 入群
async function joinGroup(A, B, token = 'good') {
  A.engine.verifyAccessToken = (tk) => tk === token;
  A.engine.ensureGroup();
  const r = await post(`http://127.0.0.1:${B.port}/api/collab/join`, { host: '127.0.0.1', port: A.port, token });
  assert.equal(r.body.code, 'joined', JSON.stringify(r.body));
  return r.body.group;
}

test('双节点 HTTP 全流程：入群→分发→收件箱→安装', async () => {
  const A = await startNode('alice');
  const B = await startNode('bob');
  const demo = path.join(A.skillsRoot, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(path.join(demo, 'SKILL.md'), '# demo', 'utf8');
  try {
    const g = await joinGroup(A, B);
    // 分发
    const dist = await post(`http://127.0.0.1:${A.port}/api/collab/groups/${g.id}/distribute`, { skillNames: ['demo'] });
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
    assert.equal(snap.group, null);
    assert.deepEqual(snap.groups, []);
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
    const g = await joinGroup(A, B);
    await new Promise((r) => setTimeout(r, 80));

    const data = Buffer.from('file-http-receipt-check', 'utf8');
    // 1) 合法：A 经 upload 端点推文件（peer-client 自动带头部凭证）→ B 收到
    const up = await fetch(`http://127.0.0.1:${A.port}/api/collab/groups/${g.id}/files?name=${encodeURIComponent('r.txt')}`, { method: 'POST', body: data });
    assert.equal(up.status, 200);
    const items = B.engine.store.listInbox();
    const got = items.find((i) => i.fileName === 'r.txt');
    assert.ok(got, 'B 已收到文件');
    assert.equal(fs.readFileSync(got.zipPath, 'utf8'), 'file-http-receipt-check');

    // 2) 未知公钥（非群成员）→ 拒收
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
    const g = await joinGroup(A, B);
    // A 发普通聊天
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${g.id}/chat`, { text: 'hello', toId: null });
    await new Promise((r) => setTimeout(r, 80));
    const chat = await fetch(`http://127.0.0.1:${A.port}/api/collab/groups/${g.id}/chat`).then((r) => r.json());
    assert.ok(chat.messages.some((m) => m.text === 'hello'));
    // A @B 远程执行 → B 产生 pending → approve 后回结果
    const cmd = await post(`http://127.0.0.1:${A.port}/api/collab/groups/${g.id}/cmd`, { text: '安全命令 go', toId: B.engine.pub.machineId });
    assert.equal(cmd.body.code, 'sent');
    await new Promise((r) => setTimeout(r, 120));
    const pending = await fetch(`http://127.0.0.1:${B.port}/api/collab/cmds`).then((r) => r.json());
    assert.equal(pending.pending.length, 1, 'B 有待确认命令');
    await post(`http://127.0.0.1:${B.port}/api/collab/cmds/${pending.pending[0].id}/approve`, { approve: true });
    await new Promise((r) => setTimeout(r, 120));
    const chat2 = await fetch(`http://127.0.0.1:${A.port}/api/collab/groups/${g.id}/chat`).then((r) => r.json());
    const results = chat2.messages.filter((m) => m.kind === 'cmd-result');
    assert.ok(results.length >= 1, 'A 群内有 cmd-result');
    assert.equal(results[0].text, 'OK');
    const pending2 = await fetch(`http://127.0.0.1:${B.port}/api/collab/cmds`).then((r) => r.json());
    assert.equal(pending2.pending.length, 0, '确认后 pending 清空');
  } finally { A.server.close(); B.server.close(); }
});

test('join REST：正确令牌入群 / 错误令牌 bad-token', async () => {
  const A = await startNode('alice-inv');
  const B = await startNode('bob-inv');
  try {
    const ok = await joinGroup(A, B, 'good');
    assert.equal(ok.id, A.engine.pub.machineId);
    assert.ok(A.engine.store.getGroup().members.find((m) => m.machineId === B.engine.pub.machineId), 'A 群含 B');
    const C = await startNode('carol-inv');
    const bad = await post(`http://127.0.0.1:${C.port}/api/collab/join`, { host: '127.0.0.1', port: A.port, token: 'wrong' });
    assert.equal(bad.body.code, 'bad-token');
    C.server.close();
  } finally { A.server.close(); B.server.close(); }
});

test('旧好友/建群路由已删除 404', async () => {
  const A = await startNode('alice-gone');
  try {
    const f = await post(`http://127.0.0.1:${A.port}/api/collab/friends`, { host: 'x', port: 1 });
    assert.equal(f.status, 404);
    const g = await post(`http://127.0.0.1:${A.port}/api/collab/groups`, { name: 'x' });
    assert.equal(g.status, 404);
  } finally { A.server.close(); }
});

test('downloads REST：列表 / 无 master 同步 / 文件路径穿越防护', async () => {
  const A = await startNode('alice-dl');
  try {
    const list = await fetch(`http://127.0.0.1:${A.port}/api/collab/downloads`).then((r) => r.json());
    assert.ok(list.manifest && Array.isArray(list.manifest.files));
    assert.equal(list.group, null);
    assert.deepEqual(list.groups, []);
    const sync = await post(`http://127.0.0.1:${A.port}/api/collab/downloads/sync`, {});
    assert.equal(sync.body.code, 'no-master');
    const bad = await fetch(`http://127.0.0.1:${A.port}/api/collab/downloads/file/..%5Cx`);
    assert.equal(bad.status, 400);
  } finally { A.server.close(); }
});

test('downloads/dir：实时列出共享目录文件并支持下载（含子目录/隐藏索引）', async () => {
  const A = await startNode('alice-dir');
  try {
    A.engine.writeDownload('notes/hello.txt', Buffer.from('hi'), 'file');
    const list = await fetch(`http://127.0.0.1:${A.port}/api/collab/downloads/dir`).then((r) => r.json());
    assert.ok(Array.isArray(list.files));
    const names = list.files.map((f) => f.name);
    assert.ok(names.includes('notes/hello.txt'), '应列出子目录文件');
    assert.ok(!names.includes('manifest.json'), '内部索引不应列出');
    const file = await fetch(`http://127.0.0.1:${A.port}/api/collab/downloads/file/notes%2Fhello.txt`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-disposition') || '', /attachment/);
    assert.equal(await file.text(), 'hi');
  } finally { A.server.close(); }
});
