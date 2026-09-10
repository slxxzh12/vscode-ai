# 群邀请链接（URL 点击入群）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让群主/管理员生成带签名的邀请链接，接收者点击后在本机 Devflow UI 预览并确认入群，复用现有 P2P 握手。

**Architecture:** 邀请方用 Ed25519 私钥签发自证 token（含群 id/名、邀请方 profile、epoch、exp）；token 经 URL 传递。接收方本机后端解析 token 后发 `group-join` 信封给邀请方；邀请方验签、校验 exp/epoch、把接收者加入成员表并广播，响应体回全量群。撤销靠群对象 `inviteEpoch` 自增。

**Tech Stack:** Node 24 ESM（`node:crypto` / `node:test`）、Vue 3 + TS + Vite、现有 `server/collaboration/**` 与 `web/src/collaboration/**`。

**参考 spec:** `docs/superpowers/specs/2026-09-10-group-invite-link-design.md`

**环境提醒（来自 AGENTS.md）:** Windows PowerShell 5.1，无 bash，一律 `npm.cmd`；新增功能代码全部落在隔离目录 `server/collaboration/**`、`web/src/collaboration/**`、`shared/collab.js(.d.ts)`；对现有 `engine.js` / `http-mount.js` / `App.vue` / `ContactsView.vue` / `types.ts` / `useCollab.ts` 只做最小接线。

---

## File Structure

- Create: `server/collaboration/invite.js` — 邀请 token 签发/校验（复用 `sign.js` 的 `canonicalize`）。
- Create: `server/test/collab-invite.test.js` — token 单测 + 引擎入群流程测试。
- Modify: `shared/collab.js` / `shared/collab.d.ts` — 新增 `GROUP_JOIN`。
- Modify: `server/collaboration/engine.js` — 群 `inviteEpoch`、`createInviteLink` / `revokeInvites` / `previewInvite` / `joinByInvite` / `_inGroupJoin`、`handleIncoming` 分支、测试 harness 透传 `data`。
- Modify: `server/collaboration/http-mount.js` — 4 个 REST 端点。
- Modify: `server/test/collab-http.test.js` — 新端点集成测试。
- Modify: `web/src/collaboration/types.ts` — `CollabGroup.inviteEpoch` + `CollabInvitePreview`。
- Modify: `web/src/collaboration/useCollab.ts` — 4 个 API 方法。
- Create: `web/src/collaboration/JoinInviteCard.vue` — 预览+加入卡片（粘贴流与全局弹窗复用）。
- Modify: `web/src/collaboration/ContactsView.vue` — 生成/复制/重置链接 + 粘贴邀请码入口。
- Modify: `web/src/App.vue` — 全局 `?invite=` 遮罩 + 入群后切到通讯录。

---

## Task 1: shared 常量新增 `GROUP_JOIN`

**Files:**
- Modify: `shared/collab.js:10-24`
- Modify: `shared/collab.d.ts:9-23`

- [ ] **Step 1: 在 `shared/collab.js` 的 `CollabPeer` 中新增常量**

把 `CollabPeer` 改为（在 `GROUP_ACCEPT` 后加一行）：

```js
export const CollabPeer = Object.freeze({
  FRIEND_REQUEST: 'friend-request',
  FRIEND_ACCEPT: 'friend-accept',
  GROUP_INVITE: 'group-invite',
  GROUP_ACCEPT: 'group-accept',
  GROUP_JOIN: 'group-join',
  MEMBER_SYNC: 'member-sync',
  SKILL_PUSH: 'skill-push',
  FILE_PUSH: 'file-push',
  PULL_SYNC: 'pull-sync',
  CHAT_SEND: 'chat-send',
  CMD_REQ: 'cmd-req',
  CMD_CONFIRM: 'cmd-confirm',
  CMD_RESULT: 'cmd-result',
  CHAT_PULL: 'chat-pull',
});
```

- [ ] **Step 2: 在 `shared/collab.d.ts` 的 `CollabPeer` 声明中同步新增**

在 `GROUP_ACCEPT: 'group-accept';` 后加：

```ts
  GROUP_JOIN: 'group-join';
```

- [ ] **Step 3: 跑现有常量测试确认未破坏**

Run: `node --test "server/test/collab-const.test.js"`
Expected: PASS（全部通过）

- [ ] **Step 4: Commit**

```powershell
git add shared/collab.js shared/collab.d.ts
git commit -m "feat(collab): 新增 GROUP_JOIN peer 信封常量"
```

---

## Task 2: 邀请 token 模块 `invite.js`

**Files:**
- Create: `server/collaboration/invite.js`
- Test: `server/test/collab-invite.test.js`

- [ ] **Step 1: 写失败测试 `server/test/collab-invite.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeInviteToken, parseInviteToken, INVITE_TTL_MS } from '../collaboration/invite.js';

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/collab-invite.test.js"`
Expected: FAIL —— `Cannot find module '../collaboration/invite.js'`

- [ ] **Step 3: 实现 `server/collaboration/invite.js`**

```js
import crypto from 'node:crypto';
import { canonicalize } from './sign.js';

const PREFIX = 'dfinv1';
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toB64url(v) { return Buffer.from(v).toString('base64url'); }
function fromB64url(s) { return Buffer.from(s, 'base64url'); }

// 用邀请方私钥签发自证 token：dfinv1.<b64url(body)>.<b64url(sig)>
export function makeInviteToken(privateKeyPem, body) {
  const payload = {
    groupId: body.groupId,
    groupName: body.groupName,
    inviter: body.inviter,
    epoch: body.epoch ?? 0,
    exp: body.exp,
    jti: body.jti ?? crypto.randomUUID(),
  };
  const sig = crypto.sign(null, Buffer.from(canonicalize(payload), 'utf8'), privateKeyPem);
  return `${PREFIX}.${toB64url(JSON.stringify(payload))}.${toB64url(sig)}`;
}

// 解析并验签；只用 body 内嵌的 inviter.publicKey 自证（与信封一致）
export function parseInviteToken(token) {
  if (typeof token !== 'string') return { ok: false, error: 'bad-token' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, error: 'bad-token' };
  let body;
  try { body = JSON.parse(fromB64url(parts[1]).toString('utf8')); } catch { return { ok: false, error: 'bad-token' }; }
  if (!body || typeof body !== 'object' || !body.inviter || typeof body.inviter.publicKey !== 'string') {
    return { ok: false, error: 'bad-token' };
  }
  let sig;
  try { sig = fromB64url(parts[2]); } catch { return { ok: false, error: 'bad-token' }; }
  try {
    const valid = crypto.verify(null, Buffer.from(canonicalize(body), 'utf8'), body.inviter.publicKey, sig);
    if (!valid) return { ok: false, error: 'bad-token' };
  } catch { return { ok: false, error: 'bad-token' }; }
  return { ok: true, body };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/collab-invite.test.js"`
Expected: PASS（3 个测试全过）

- [ ] **Step 5: Commit**

```powershell
git add server/collaboration/invite.js server/test/collab-invite.test.js
git commit -m "feat(collab): 邀请 token 签发与验签模块"
```

---

## Task 3: 引擎签发/撤销邀请链接

**Files:**
- Modify: `server/collaboration/engine.js`（import、`createGroup`、群方法区）
- Test: `server/test/collab-invite.test.js`（追加）

- [ ] **Step 1: 追加失败测试到 `server/test/collab-invite.test.js` 末尾**

```js
import { createPairHarness } from '../collaboration/engine.js';

test('owner 生成邀请链接；非管理员被拒；撤销后 epoch 自增', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await A.createGroup('team');
    assert.equal(A.store.findGroup(g.id).inviteEpoch, 0, '新群 inviteEpoch=0');

    const link = A.createInviteLink({ groupId: g.id });
    assert.equal(link.code, 'ok', JSON.stringify(link));
    assert.equal(typeof link.token, 'string');
    assert.ok(link.token.startsWith('dfinv1.'), 'token 前缀');
    assert.ok(link.expiresAt > Date.now(), 'expiresAt 在未来');

    // 非成员生成 → not-member；普通成员 → forbidden（B 先入群为 admin，再手动降为 member 验证）
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/collab-invite.test.js"`
Expected: FAIL —— `A.createInviteLink is not a function`

- [ ] **Step 3: 在 `engine.js` 顶部新增 import**

在 `import { signEnvelope, verifyEnvelope, signHash, verifyHash } from './sign.js';` 下一行加：

```js
import { makeInviteToken, parseInviteToken, INVITE_TTL_MS } from './invite.js';
```

- [ ] **Step 4: 在 `engine.js` 的 `createGroup` 中加 `inviteEpoch: 0`**

把 `createGroup` 内的 `g` 对象改为：

```js
  async createGroup(name) {
    const g = {
      id: crypto.randomUUID(), name, ownerId: this.pub.machineId, createdAt: Date.now(),
      members: [{ ...this.pub, role: 'owner' }], inviteEpoch: 0,
    };
    this.store.addGroup(g);
    this._emit('synced', {});
    return g;
  }
```

- [ ] **Step 5: 在 `engine.js` 群方法区（`kickMember` 之后、`// ---- skill 分发 ----` 之前）插入签发/撤销方法**

```js
  // ---- 邀请链接 ----
  _inviteRole(groupId) {
    const g = this.store.findGroup(groupId);
    const me = g && g.members.find((m) => m.machineId === this.pub.machineId);
    if (!g || !me) return { code: 'not-member', group: null };
    if (me.role !== 'owner' && me.role !== 'admin') return { code: 'forbidden', group: g };
    return { code: 'ok', group: g };
  }
  createInviteLink({ groupId, ttlMs } = {}) {
    const r = this._inviteRole(groupId);
    if (r.code !== 'ok') return { code: r.code };
    const exp = Date.now() + (typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : INVITE_TTL_MS);
    const jti = crypto.randomUUID();
    const token = makeInviteToken(this.identity.privateKey, {
      groupId: r.group.id, groupName: r.group.name, inviter: this.pub,
      epoch: r.group.inviteEpoch || 0, exp, jti,
    });
    return { code: 'ok', token, expiresAt: exp, jti };
  }
  async revokeInvites(groupId) {
    const r = this._inviteRole(groupId);
    if (r.code !== 'ok') return { code: r.code };
    r.group.inviteEpoch = (r.group.inviteEpoch || 0) + 1;
    this.store.saveGroup(r.group);
    await this._broadcastMemberSync(r.group);
    this._emit('synced', {});
    return { code: 'ok', epoch: r.group.inviteEpoch };
  }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test "server/test/collab-invite.test.js"`
Expected: PASS（5 个测试全过）

- [ ] **Step 7: Commit**

```powershell
git add server/collaboration/engine.js server/test/collab-invite.test.js
git commit -m "feat(collab): 引擎签发/撤销群邀请链接（inviteEpoch）"
```

---

## Task 4: 引擎入群流程（preview / join / `_inGroupJoin`）

**Files:**
- Modify: `server/collaboration/engine.js`（`handleIncoming`、群方法区、`createPairHarness`）
- Test: `server/test/collab-invite.test.js`（追加）

- [ ] **Step 1: 追加端到端失败测试**

```js
test('B 通过邀请链接入群：双方成员表一致、角色正确', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await A.createGroup('team');
    const link = A.createInviteLink({ groupId: g.id });

    const pv = B.previewInvite(link.token);
    assert.equal(pv.code, 'ok');
    assert.equal(pv.groupName, 'team');
    assert.equal(pv.inviter.machineId, A.pub.machineId);
    assert.equal(pv.alreadyMember, false);

    const jr = await B.joinByInvite(link.token);
    assert.equal(jr.code, 'joined', JSON.stringify(jr));
    const gA = A.store.findGroup(g.id);
    const gB = B.store.findGroup(g.id);
    assert.ok(gB, 'B 本地已建群');
    assert.ok(gA.members.find((m) => m.machineId === B.pub.machineId), 'A 群含 B');
    assert.ok(gB.members.find((m) => m.machineId === A.pub.machineId), 'B 群含 A');
    const role = gA.members.find((m) => m.machineId === B.pub.machineId).role;
    assert.equal(role, 'admin', '第 2 位入群者为 admin');

    // 重复加入幂等
    const again = await B.joinByInvite(link.token);
    assert.equal(again.code, 'already-member');
  } finally { await h.stop(); }
});

test('过期 token 预览/加入被拒', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await A.createGroup('team');
    const link = A.createInviteLink({ groupId: g.id, ttlMs: -1 });
    // ttlMs<=0 走默认 TTL；构造一个已过期 token 用 makeInviteToken 直接签
    const past = makeInviteToken(A.identity.privateKey, {
      groupId: g.id, groupName: 'team', inviter: A.pub, epoch: 0, exp: Date.now() - 1000, jti: 'j',
    });
    assert.equal(B.previewInvite(past).code, 'expired');
    const jr = await B.joinByInvite(past);
    assert.equal(jr.code, 'expired');
    void link;
  } finally { await h.stop(); }
});

test('撤销后旧 token 被拒（invite-revoked）', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await A.createGroup('team');
    const link = A.createInviteLink({ groupId: g.id });
    await A.revokeInvites(g.id);
    const jr = await B.joinByInvite(link.token);
    assert.equal(jr.code, 'invite-revoked', JSON.stringify(jr));
    assert.equal(B.store.findGroup(g.id), null, 'B 未入群');
  } finally { await h.stop(); }
});

test('篡改 token 加入被拒', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await A.createGroup('team');
    const link = A.createInviteLink({ groupId: g.id });
    const jr = await B.joinByInvite(link.token.slice(0, -4) + 'AAAA');
    assert.equal(jr.code, 'bad-token');
  } finally { await h.stop(); }
});

test('邀请方不可达 → unreachable', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await A.createGroup('team');
    const link = A.createInviteLink({ groupId: g.id });
    // 把 A 的 peer 指向失败
    A.peer = { post: async () => ({ ok: false, error: 'http-503' }) };
    // B 发往 A（harness 里 B.peer 直投 A.handleIncoming，这里改成失败 transport）
    B.peer = { post: async () => ({ ok: false, error: 'connect-failed' }) };
    const jr = await B.joinByInvite(link.token);
    assert.equal(jr.code, 'unreachable');
  } finally { await h.stop(); }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/collab-invite.test.js"`
Expected: FAIL —— `B.previewInvite is not a function`

- [ ] **Step 3: 在 `engine.js` 的 `handleIncoming` switch 中加分支**

在 `case CollabPeer.GROUP_ACCEPT: return this._inGroupAccept(env);` 下一行加：

```js
      case CollabPeer.GROUP_JOIN: return this._inGroupJoin(env);
```

- [ ] **Step 4: 在 `revokeInvites` 之后插入 preview/join/_inGroupJoin**

```js
  previewInvite(token) {
    const r = parseInviteToken(token);
    if (!r.ok) return { code: 'bad-token' };
    const b = r.body;
    if (typeof b.exp !== 'number' || Date.now() > b.exp) return { code: 'expired' };
    const local = this.store.findGroup(b.groupId);
    const alreadyMember = !!(local && local.members.find((m) => m.machineId === this.pub.machineId));
    return { code: 'ok', groupId: b.groupId, groupName: b.groupName, inviter: b.inviter, expiresAt: b.exp, alreadyMember };
  }
  async joinByInvite(token) {
    const r = parseInviteToken(token);
    if (!r.ok) return { code: 'bad-token' };
    const b = r.body;
    if (typeof b.exp !== 'number' || Date.now() > b.exp) return { code: 'expired' };
    const local = this.store.findGroup(b.groupId);
    if (local && local.members.find((m) => m.machineId === this.pub.machineId)) {
      return { code: 'already-member', group: local };
    }
    const res = await this._post(b.inviter.host, b.inviter.port, this._sign(CollabPeer.GROUP_JOIN, { token }));
    if (!res.ok) {
      const code = res.error === 'invite-revoked' ? 'invite-revoked' : 'unreachable';
      return { code, error: res.error };
    }
    const group = res.data && res.data.group;
    if (!group) return { code: 'unreachable' };
    this.store.upsertGroup(group);
    this._emit('synced', {});
    return { code: 'joined', group };
  }
  async _inGroupJoin(env) {
    const token = env.payload && env.payload.token;
    const r = parseInviteToken(token);
    if (!r.ok) return { ok: false, error: 'bad-token' };
    const b = r.body;
    if (!b.inviter || b.inviter.machineId !== this.pub.machineId) return { ok: false, error: 'not-inviter' };
    if (typeof b.exp !== 'number' || Date.now() > b.exp) return { ok: false, error: 'expired' };
    const g = this.store.findGroup(b.groupId);
    const me = g && g.members.find((m) => m.machineId === this.pub.machineId);
    if (!g || !me) return { ok: false, error: 'no-group' };
    if (b.epoch !== (g.inviteEpoch || 0)) return { ok: false, error: 'invite-revoked' };
    const p = env.from;
    if (g.members.find((m) => m.machineId === p.machineId)) return { ok: true, data: { group: g } };
    g.members.push({ ...p, role: this._assignRole(g) });
    this.store.saveGroup(g);
    await this._broadcastMemberSync(g);
    this._emit('synced', {});
    return { ok: true, data: { group: g } };
  }
```

- [ ] **Step 5: 修改测试 harness 让 `forward` 透传 `data`**

在 `engine.js` 的 `createPairHarness` 内，把：

```js
  const forward = async (eng, host, port, envelope) => {
    const r = await eng.handleIncoming(JSON.parse(JSON.stringify(envelope)));
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };
```

改为：

```js
  const forward = async (eng, host, port, envelope) => {
    const r = await eng.handleIncoming(JSON.parse(JSON.stringify(envelope)));
    return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
  };
```

- [ ] **Step 6: 运行邀请测试确认通过**

Run: `node --test "server/test/collab-invite.test.js"`
Expected: PASS（全部通过）

- [ ] **Step 7: 运行全套 server 测试确认未回归**

Run: `npm.cmd test:server`
Expected: PASS（`collab-engine` / `collab-chat` / `collab-http` 等全绿）

- [ ] **Step 8: Commit**

```powershell
git add server/collaboration/engine.js server/test/collab-invite.test.js
git commit -m "feat(collab): 引擎入群流程 preview/join/_inGroupJoin + 测试 harness 透传 data"
```

---

## Task 5: HTTP 端点

**Files:**
- Modify: `server/collaboration/http-mount.js:120-132`（groups 路由区）
- Test: `server/test/collab-http.test.js`（追加）

- [ ] **Step 1: 追加失败集成测试到 `server/test/collab-http.test.js` 末尾**

```js
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
    const link2 = await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/invite-link`, {});
    // 用一个新节点的旧 token 场景：直接用 link（旧 epoch）让另一个节点入群失败
    const C = await startNode('carol-inv');
    const jr2 = await post(`http://127.0.0.1:${C.port}/api/collab/join`, { token });
    assert.equal(jr2.body.code, 'invite-revoked', JSON.stringify(jr2.body));
    C.server.close();
    void link2;
  } finally { A.server.close(); B.server.close(); }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/collab-http.test.js"`
Expected: FAIL —— 新测试返回 404（`not found`）

- [ ] **Step 3: 在 `http-mount.js` 的 groups 路由区插入端点**

在 `if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'invite' && m === 'POST') { ... }` 之后加：

```js
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'invite-link' && m === 'POST') {
        const r = engine.createInviteLink({ groupId: seg[1], ttlMs: body.ttlMs });
        if (r.code !== 'ok') return ok(res, r);
        const origin = (typeof body.origin === 'string' && body.origin) ? body.origin.replace(/\/+$/, '') : 'http://127.0.0.1:3001';
        return ok(res, { token: r.token, url: `${origin}/?invite=${encodeURIComponent(r.token)}`, expiresAt: r.expiresAt, jti: r.jti });
      }
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'invite-revoke' && m === 'POST') {
        const r = await engine.revokeInvites(seg[1]);
        return ok(res, r);
      }
```

再在 invites 路由区（`if (seg[0] === 'invites' ...)`）附近加入 join 端点：

```js
      // join（邀请链接入群）
      if (seg[0] === 'join' && seg.length === 2 && seg[1] === 'preview' && m === 'GET') {
        const token = url.searchParams.get('token') || '';
        return ok(res, engine.previewInvite(token));
      }
      if (seg[0] === 'join' && seg.length === 1 && m === 'POST') {
        const r = await engine.joinByInvite(body.token);
        return ok(res, r);
      }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/collab-http.test.js"`
Expected: PASS（全部通过）

- [ ] **Step 5: Commit**

```powershell
git add server/collaboration/http-mount.js server/test/collab-http.test.js
git commit -m "feat(collab): 邀请链接 REST 端点（invite-link/invite-revoke/join）"
```

---

## Task 6: Web 类型与 API 客户端

**Files:**
- Modify: `web/src/collaboration/types.ts:4`
- Modify: `web/src/collaboration/useCollab.ts:14-120`

- [ ] **Step 1: 修改 `types.ts`：`CollabGroup` 加字段 + 新增 `CollabInvitePreview`**

把第 4 行改为：

```ts
export interface CollabGroup { id: string; name: string; ownerId: string | null; createdAt: number; members: CollabMember[]; inviteEpoch?: number; }
```

在文件末尾（`CollabPendingCmd` 之后）加：

```ts
export interface CollabInvitePreview {
  code: string; error?: string;
  groupId?: string; groupName?: string;
  inviter?: CollabProfile; expiresAt?: number; alreadyMember?: boolean;
}
```

- [ ] **Step 2: 修改 `useCollab.ts` 的 import 与返回对象**

把顶部 import 改为：

```ts
import type { CollabSnapshot, CollabChatMessage, CollabPendingCmd, CollabInvitePreview, CollabGroup } from './types';
```

在返回对象中 `rejectInvite` 之后插入：

```ts
    createInviteLink: (groupId: string, origin?: string) =>
      post<{ token: string; url: string; expiresAt: number; jti: string }>(`/api/collab/groups/${groupId}/invite-link`, { origin }),
    revokeInvites: (groupId: string) =>
      post<{ code: string; epoch: number }>(`/api/collab/groups/${groupId}/invite-revoke`),
    previewInvite: (token: string) =>
      http<CollabInvitePreview>(`/api/collab/join/preview?token=${encodeURIComponent(token)}`),
    async joinByInvite(token: string) {
      const r = await post<{ code: string; group?: CollabGroup }>('/api/collab/join', { token });
      await refresh();
      return r;
    },
```

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（无新增 TS 错误）

- [ ] **Step 4: Commit**

```powershell
git add web/src/collaboration/types.ts web/src/collaboration/useCollab.ts
git commit -m "feat(collab): web 邀请链接类型与 API 客户端"
```

---

## Task 7: `JoinInviteCard.vue`

**Files:**
- Create: `web/src/collaboration/JoinInviteCard.vue`

- [ ] **Step 1: 创建组件**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { CollabApi } from './useCollab';
import type { CollabInvitePreview, CollabGroup } from './types';

const props = defineProps<{ collab: CollabApi; token: string }>();
const emit = defineEmits<{ (e: 'joined', group: CollabGroup | undefined): void; (e: 'cancel'): void }>();

const preview = ref<CollabInvitePreview | null>(null);
const loading = ref(false);
const joining = ref(false);
const error = ref('');

async function load(t: string) {
  error.value = ''; preview.value = null; loading.value = true;
  try {
    const r = await props.collab.previewInvite(t);
    if (r.code !== 'ok') error.value = r.code === 'expired' ? '邀请链接已过期' : '邀请码无效或已损坏';
    else preview.value = r;
  } catch (e) { error.value = String((e as Error).message || e); }
  finally { loading.value = false; }
}
watch(() => props.token, (t) => { if (t) load(t); }, { immediate: true });

function joinErrorText(code: string): string {
  switch (code) {
    case 'expired': return '邀请链接已过期';
    case 'invite-revoked': return '邀请链接已失效';
    case 'no-group': return '该群已不存在';
    case 'bad-token': return '邀请码无效';
    default: return '无法连接邀请方，可能不在线';
  }
}
async function join() {
  joining.value = true; error.value = '';
  try {
    const r = await props.collab.joinByInvite(props.token);
    if (r.code === 'joined' || r.code === 'already-member') emit('joined', r.group);
    else error.value = joinErrorText(r.code);
  } catch (e) { error.value = String((e as Error).message || e); }
  finally { joining.value = false; }
}
function fmt(ts?: number) { return ts ? new Date(ts).toLocaleString() : ''; }
</script>

<template>
  <div class="jcard">
    <div class="jtitle">入群邀请</div>
    <div v-if="loading" class="jsub">正在读取邀请…</div>
    <template v-else-if="preview">
      <div class="jgroup">{{ preview.groupName }}</div>
      <div class="jsub">邀请人：{{ preview.inviter?.username }} · {{ preview.inviter?.host }}:{{ preview.inviter?.port }}</div>
      <div class="jsub">有效期至：{{ fmt(preview.expiresAt) }}</div>
      <div v-if="preview.alreadyMember" class="jok">你已在该群</div>
      <div v-if="error" class="jerr">{{ error }}</div>
      <div class="jbtns">
        <button :disabled="joining" @click="join">{{ joining ? '处理中…' : (preview.alreadyMember ? '打开群' : '加入') }}</button>
        <button class="ghost" @click="emit('cancel')">取消</button>
      </div>
    </template>
    <template v-else>
      <div class="jerr">{{ error || '无法读取邀请' }}</div>
      <div class="jbtns"><button class="ghost" @click="emit('cancel')">关闭</button></div>
    </template>
  </div>
</template>

<style scoped>
.jcard { width: 360px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 10px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
.jtitle { font-size: 12px; text-transform: uppercase; color: var(--tx6); letter-spacing: .5px; }
.jgroup { font-size: 20px; font-weight: 700; color: var(--tx1); margin: 10px 0 6px; }
.jsub { font-size: 12px; color: var(--tx2); margin: 3px 0; }
.jok { font-size: 12px; color: var(--ac2); margin-top: 6px; }
.jerr { font-size: 12px; color: var(--err); margin-top: 8px; }
.jbtns { display: flex; gap: 8px; margin-top: 16px; }
.jbtns button { flex: 1; background: var(--ac); color: var(--onac); border: none; border-radius: 6px; padding: 8px; cursor: pointer; }
.jbtns button.ghost { flex: none; background: none; border: 1px solid var(--bd); color: var(--tx2); }
.jbtns button:disabled { opacity: .6; cursor: default; }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```powershell
git add web/src/collaboration/JoinInviteCard.vue
git commit -m "feat(collab): 入群邀请预览卡片组件"
```

---

## Task 8: `ContactsView.vue` 集成

**Files:**
- Modify: `web/src/collaboration/ContactsView.vue:1-103`（script）与成员列/添加区（template）

- [ ] **Step 1: 修改 script：import 与新状态/方法**

在第 6 行 `import GroupChatView from './GroupChatView.vue';` 后加：

```ts
import JoinInviteCard from './JoinInviteCard.vue';
```

在 `const myRole = ...` 之后加状态：

```ts
const canInvite = computed(() => myRole.value === 'owner' || myRole.value === 'admin');
const inviteUrl = ref('');
const inviteErr = ref('');
const pasteInvite = ref('');
const pasteToken = ref('');
```

在群动作区末尾（`function roleLabel(...)` 之前）加：

```ts
async function genInviteLink() {
  const g = activeGroup.value; if (!g) return;
  inviteErr.value = '';
  try {
    const r = await props.collab.createInviteLink(g.id, window.location.origin);
    inviteUrl.value = (r as { url?: string }).url || '';
  } catch (e) { inviteErr.value = String((e as Error).message || e); }
}
async function resetInviteLink() {
  const g = activeGroup.value; if (!g) return;
  if (!confirm('重置邀请链接？旧链接将立即失效')) return;
  inviteErr.value = '';
  try { await props.collab.revokeInvites(g.id); await genInviteLink(); }
  catch (e) { inviteErr.value = String((e as Error).message || e); }
}
async function copyInvite() {
  if (!inviteUrl.value) return;
  try { await navigator.clipboard.writeText(inviteUrl.value); } catch { /* ignore */ }
}
function extractToken(s: string): string {
  const t = s.trim();
  const m = t.match(/[?&]invite=([^&\s]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  return t;
}
function openPaste() { const t = pasteInvite.value.trim(); if (t) pasteToken.value = extractToken(t); }
async function onPasteJoined(g: CollabGroup | undefined) {
  pasteToken.value = ''; pasteInvite.value = '';
  await props.collab.refresh();
  if (g) { activeGroupId.value = g.id; activeFriendId.value = null; }
}
```

把顶部类型 import 第 5 行改为：

```ts
import type { CollabFriend, CollabMember, CollabGroup } from './types';
```

- [ ] **Step 2: 在「添加」区加入粘贴入口**

在模板 `<div class="addrow"> ... ＋友</button> </div>` 之后、`<div v-if="ferr" class="err">{{ ferr }}</div>` 之前插入：

```html
        <div class="addrow">
          <input v-model="pasteInvite" placeholder="粘贴邀请链接/邀请码" @keyup.enter="openPaste" />
          <button title="预览邀请" @click="openPaste">预览</button>
        </div>
```

- [ ] **Step 3: 在成员列加入生成链接区**

在成员列 `<div v-if="merr" class="merr">{{ merr }}</div>` 之后插入：

```html
          <div v-if="canInvite" class="invlink">
            <button class="genbtn" @click="genInviteLink">生成邀请链接</button>
            <div v-if="inviteUrl" class="linkrow">
              <input :value="inviteUrl" readonly @focus="($event.target as HTMLInputElement).select()" />
              <button @click="copyInvite">复制</button>
            </div>
            <button v-if="inviteUrl" class="ghost resetlink" @click="resetInviteLink">重置链接</button>
            <div v-if="inviteErr" class="merr">{{ inviteErr }}</div>
          </div>
```

- [ ] **Step 4: 在 right 区加粘贴预览遮罩**

在模板最外层 `.cw` 结束前（`</section>` 之后、`</div>` 之前）加入：

```html
    <div v-if="pasteToken" class="joinmask" @click.self="pasteToken = ''">
      <JoinInviteCard :collab="collab" :token="pasteToken" @joined="onPasteJoined" @cancel="pasteToken = ''" />
    </div>
```

- [ ] **Step 5: 追加样式到 `<style scoped>` 末尾**

```css
.invlink { padding: 4px 14px 10px; display: flex; flex-direction: column; gap: 6px; }
.invlink .genbtn { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.linkrow { display: flex; gap: 6px; }
.linkrow input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 4px 6px; font-size: 11px; box-sizing: border-box; }
.linkrow button { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; }
.resetlink { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; }
.joinmask { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
```

- [ ] **Step 6: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```powershell
git add web/src/collaboration/ContactsView.vue
git commit -m "feat(collab): 联系人页生成/复制/重置邀请链接与粘贴入群"
```

---

## Task 9: `App.vue` 全局 `?invite=` + 最终验证

**Files:**
- Modify: `web/src/App.vue:1-33`（script）与模板根部

- [ ] **Step 1: 修改 script：import 与状态/处理**

在 `import CollaborationView from './collaboration/CollaborationView.vue';` 后加：

```ts
import JoinInviteCard from './collaboration/JoinInviteCard.vue';
import { useCollab } from './collaboration/useCollab';
import type { CollabGroup } from './collaboration/types';
```

在 `const rail = ref<...>('explorer');` 之后加：

```ts
const inviteCollab = useCollab();
const inviteToken = ref('');
```

在 `onMounted(() => {` 内的第一行前加：

```ts
  const sp = new URLSearchParams(window.location.search);
  const it = sp.get('invite');
  if (it) inviteToken.value = it;
```

在 `onMounted` 之后加：

```ts
function clearInvite() {
  inviteToken.value = '';
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('invite');
    window.history.replaceState({}, '', u.pathname + (u.search ? u.search : ''));
  } catch { /* ignore */ }
}
function onInviteJoined(_g?: CollabGroup) {
  clearInvite();
  rail.value = 'contacts';
}
```

- [ ] **Step 2: 在模板根 `.app` 内、`</div>`（`.main` 之后）加全局遮罩**

在 `</div>`（`.main` 的结束）之后、`.app` 的 `</div>` 之前插入：

```html
    <div v-if="inviteToken" class="joinmask" @click.self="clearInvite()">
      <JoinInviteCard :collab="inviteCollab" :token="inviteToken" @joined="onInviteJoined" @cancel="clearInvite" />
    </div>
```

- [ ] **Step 3: 追加样式**

在 `<style scoped>` 末尾加：

```css
.joinmask { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
```

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 5: 全量测试**

Run: `npm.cmd test`
Expected: server `node --test` 全绿 + web vitest 全绿

- [ ] **Step 6: 手动联调（可选但推荐）**

1. 起两个实例（不同端口/数据目录），A 建群、生成链接。
2. 复制链接到 B 的浏览器打开 → 预览卡片显示群名/邀请人 → 点“加入”。
3. 两端通讯录均显示该群，B 为 admin（第 2 位）。
4. A 点“重置链接”，旧链接再点 → 提示“邀请链接已失效”。

- [ ] **Step 7: Commit**

```powershell
git add web/src/App.vue
git commit -m "feat(collab): 全局 ?invite= 链接入群遮罩"
```

---

## Self-Review 记录

- **Spec 覆盖**：token 格式→Task 2；`inviteEpoch`→Task 3；`GROUP_JOIN`→Task 1/4；REST 4 端点→Task 5；引擎 4 方法→Task 3/4；Web UI（生成/粘贴/全局）→Task 7/8/9；错误码→Task 4/5/7；测试与验收→Task 4/5/9。
- **占位符扫描**：无 TBD/TODO，所有代码步骤均给出完整代码。
- **类型一致性**：`createInviteLink`/`revokeInvites`/`previewInvite`/`joinByInvite` 命名在 server 引擎、HTTP 端点、web API 客户端、卡片组件中一致；返回 `code` 字段贯穿一致；`inviteEpoch` 在 engine/store/web types 一致。
- **已知取舍**：链接中本机 UI 端口用 `location.origin`（生成方）拼出，跨端口场景由“粘贴邀请码”兜底（spec §9）。
