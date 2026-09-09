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
