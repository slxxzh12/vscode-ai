# 单一群组 + 远程访问 实施计划（P1 / 3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把协作收敛为「单一隐式群组 + 远程访问」，群组页签成为唯一入口，加入靠粘贴带令牌链接；删除好友/多群/邀请/角色。

**Architecture:** 数据层把 `friends/groups[]/pendingInvites` 换成单例 `group`；引擎删除 friend/group-invite 分支，新增 `ensureGroup()` 与 `joinByLink()`；远程门禁对 `/api/collab/peer` 豁免、支持 `?access=<token>` 免密；前端删除 `ContactsView`，新增 `GroupView`，远程面板自设置迁入。

**Tech Stack:** Node ESM、node:test、Vue3 + Vite + TS、vitest。

**前置：** spec `docs/superpowers/specs/2026-09-11-single-group-remote-heartbeat-design.md`。P2/P3 依赖本计划产出的单例群组与 hub 概念。

---

## 文件结构

**改：**
- `shared/collab.js` — 协议常量精简
- `shared/collab.d.ts` — 类型同步
- `server/collaboration/store.js` — 单例群组，删好友/邀请
- `server/collaboration/engine.js` — 删 friend/group-invite；加 ensureGroup/joinByLink/_inJoin/verifyAccessToken
- `server/collaboration/http-mount.js` — 路由增删
- `server/index.js` — 门禁豁免 + `?access` + `verifyAccessToken` 注入 + 邀请时 ensureGroup
- `server/test/collab-{store,engine,chat,http,index}.test.js` — 改造
- `web/src/collaboration/{types.ts,useCollab.ts,CollaborationView.vue,GroupChatView.vue,TasksView.vue,SkillDistributor.vue,useCollab.test.ts}`
- `web/src/components/TerminalView.vue` — 删远程 UI
- `web/src/App.vue` — 删 `?invite=` 卡片
- `shared/i18n/{zh-CN,en}.js`

**新建：**
- `web/src/collaboration/GroupView.vue`

**删除：**
- `server/collaboration/invite.js`
- `web/src/collaboration/ContactsView.vue`
- `web/src/collaboration/JoinInviteCard.vue`
- `server/test/collab-invite.test.js`（旧签名邀请用例，改造进 `collab-http.test.js`）

---

## Task 1: 协议常量精简

**Files:**
- Modify: `shared/collab.js`
- Modify: `shared/collab.d.ts`

- [ ] **Step 1: 改写 `shared/collab.js`**

```js
// 协作子系统独立常量（勿并入 shared/index.js）
export const CollabS2C = Object.freeze({
  COLLAB_INBOX: 'collab-inbox',
  COLLAB_SYNCED: 'collab-synced',
  COLLAB_CHAT: 'collab-chat',
  COLLAB_CMD_PENDING: 'collab-cmd-pending',
});
export const CollabPeer = Object.freeze({
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

- [ ] **Step 2: 同步 `shared/collab.d.ts`**

打开 `shared/collab.d.ts`，删除 `COLLAB_FRIEND_REQ`、`COLLAB_GROUP_INVITE`、`FRIEND_REQUEST`、`FRIEND_ACCEPT`、`GROUP_INVITE`、`GROUP_ACCEPT` 的声明；保持其余键与 `collab.js` 一致（若 d.ts 为 `typeof` 引用则无需改）。

- [ ] **Step 3: 全仓搜索残留引用（预期仍有引擎代码引用，后续 Task 修）**

Run: `rg -n "FRIEND_REQUEST|FRIEND_ACCEPT|GROUP_INVITE|GROUP_ACCEPT|COLLAB_FRIEND_REQ|COLLAB_GROUP_INVITE" server web shared`
Expected: 命中 `engine.js`、`index.js`、`web/src/collaboration/*`。记下清单，Task 3/5/7 逐一清除。

- [ ] **Step 4: Commit**

```bash
git add shared/collab.js shared/collab.d.ts
git commit -m "refactor(collab): 精简协议常量，删除好友/群邀请类型"
```

---

## Task 2: Store 单例群组

**Files:**
- Modify: `server/collaboration/store.js`
- Test: `server/test/collab-store.test.js`

- [ ] **Step 1: 改写测试（先失败）**

替换 `server/test/collab-store.test.js` 前 3 个用例与相关断言：

```js
test('空文件初始化默认结构', () => {
  const s = new CollabStore({ file: tmpFile() });
  assert.deepEqual(s.data.identity, null);
  assert.equal(s.data.group, null);
  assert.deepEqual(s.data.skillsInbox, []);
  assert.deepEqual(s.data.groupSkills, []);
});

test('单例群组 ensure/get/addMember/persist', () => {
  const f = tmpFile();
  const s = new CollabStore({ file: f });
  const self = { machineId: 'me', username: 'u', host: 'h', port: 1, publicKey: 'k' };
  const g = s.ensureGroup({ name: 'shared', hubId: 'me', self });
  assert.equal(g.id, 'shared');
  assert.equal(g.members.length, 1);
  assert.equal(s.getGroup().id, 'shared');
  s.addGroupMember({ machineId: 'peer', username: 'p', host: 'h2', port: 2, publicKey: 'k2' });
  assert.equal(s.getGroup().members.length, 2);
  s.addGroupMember({ machineId: 'peer', username: 'p', host: 'h2', port: 2, publicKey: 'k2' });
  assert.equal(s.getGroup().members.length, 2, '去重');
  s.save();
  const s2 = new CollabStore({ file: f });
  assert.equal(s2.getGroup().members.length, 2);
  assert.equal(s2.findGroup('shared').id, 'shared');
  assert.equal(s2.listGroups().length, 1);
});
```

保留 chat / pendingCmds / cap 三个用例不改。

- [ ] **Step 2: 运行，确认失败**

Run: `node --test "server/test/collab-store.test.js"`
Expected: FAIL（`ensureGroup is not a function`）

- [ ] **Step 3: 改 `defaultData()` 与群组方法**

`defaultData()` 改为：

```js
export function defaultData() {
  return {
    identity: null,
    group: null,          // { id:'shared', name, createdAt, hubId, members:[profile] }
    skillsInbox: [],
    groupSkills: [],
    outbox: [],
    tool: { kind: 'opencode', customRoot: null },
    chatSeq: 0,
    chatMessages: [],
    pendingCmds: [],
    commandAllowlist: [],
  };
}
```

删除 friends / pendingFriends / groups / pendingInvites 全部方法，替换为：

```js
// ---- 单例群组 ----
getGroup() { return this.data.group; }
findGroup(id) { return this.data.group && this.data.group.id === id ? this.data.group : null; }
listGroups() { return this.data.group ? [this.data.group] : []; }
ensureGroup({ name, hubId, self }) {
  if (this.data.group) return this.data.group;
  this.data.group = { id: 'shared', name, createdAt: Date.now(), hubId, members: [{ ...self }] };
  this.save();
  return this.data.group;
}
setGroup(group) { this.data.group = group; this.save(); return group; }
saveGroup(group) { this.data.group = group; this.save(); return group; }
upsertGroup(group) { this.data.group = group; this.save(); return group; }
addGroupMember(profile) {
  const g = this.data.group;
  if (!g) return null;
  if (!g.members.find((m) => m.machineId === profile.machineId)) g.members.push({ ...profile });
  this.save();
  return g;
}
```

`skillsInbox` 的 `addInbox` 中字段 `groupId: null` 仍存在，保留。

- [ ] **Step 4: 运行测试通过**

Run: `node --test "server/test/collab-store.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/store.js server/test/collab-store.test.js
git commit -m "refactor(collab): store 改为单例群组，删除好友/邀请"
```

---

## Task 3: 引擎删除好友/多群，新增 ensureGroup / joinByLink

**Files:**
- Modify: `server/collaboration/engine.js`
- Delete: `server/collaboration/invite.js`（在 Task 5 路由改完后删）
- Test: `server/test/collab-engine.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-engine.test.js` 末尾追加（该文件顶部已 import `createPairHarness`）：

```js
test('single-group: ensureGroup 幂等且成员去重', () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const A = h.nodes[0];
    const g1 = A.ensureGroup();
    const g2 = A.ensureGroup();
    assert.equal(g1.id, 'shared');
    assert.equal(g2.id, 'shared');
    assert.equal(A.store.getGroup().members.length, 1);
    assert.equal(A.store.getGroup().hubId, A.pub.machineId);
  } finally { await h.stop(); }
});

test('single-group: joinByLink 校验令牌后入群并记录 hub', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    const bad = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'bad' });
    assert.equal(bad.code, 'bad-token');
    const ok = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    assert.equal(ok.code, 'joined');
    assert.equal(B.store.getGroup().members.length, 2);
    assert.equal(B.store.getGroup().hubId, A.pub.machineId);
    assert.equal(A.store.getGroup().members.length, 2);
  } finally { await h.stop(); }
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test "server/test/collab-engine.test.js"`
Expected: FAIL（`ensureGroup is not a function` / `joinByLink is not a function`）

- [ ] **Step 3: 删除方法块**

在 `engine.js` 删除以下方法及其调用分支：
- `requestFriend`、`_inFriendRequest`、`acceptFriend`、`_inFriendAccept`
- `createGroup`、`inviteMember`、`_inGroupInvite`、`acceptInvite`、`_assignRole`、`_inGroupAccept`
- `createInviteLink`、`revokeInvites`、`previewInvite`、`joinByInvite`、`_inviteRole`、`_inGroupJoin`（旧签名 token 版）
- `_broadcastMemberSync` 保留（成员变更一次性同步）
- import：删除 `makeInviteToken, parseInviteToken` 与 `INVITE_TTL_MS` 的 import

`handleIncoming` 的 `switch` 删除 `FRIEND_REQUEST/FRIEND_ACCEPT/GROUP_INVITE/GROUP_ACCEPT` 分支，保留 `MEMBER_SYNC/SKILL_PUSH/FILE_PUSH/PULL_SYNC/CHAT_SEND/CMD_*/CHAT_PULL`，`GROUP_JOIN` 指向新的 `_inJoin`。

`_knownProfile` / `profileByPublicKey` 改为只看单例群组：

```js
_knownProfile(machineId) {
  if (!machineId) return null;
  const g = this.store.getGroup();
  return g ? (g.members.find((m) => m.machineId === machineId) || null) : null;
}
profileByPublicKey(pem) {
  if (!pem) return null;
  const g = this.store.getGroup();
  return g ? (g.members.find((m) => m.publicKey === pem) || null) : null;
}
```

- [ ] **Step 4: 新增 ensureGroup / joinByLink / _inJoin**

```js
// ---- 单例群组（hub = 开启远程访问并分享链接者）----
ensureGroup() {
  const g = this.store.ensureGroup({ name: t('collab.group.default_name'), hubId: this.pub.machineId, self: this.pub });
  this._emit('synced', {});
  return g;
}
joinByLink({ host, port, token }) {
  const env = this._sign(CollabPeer.GROUP_JOIN, { token });
  return this._post(host, port, env).then((res) => {
    if (!res.ok) return { code: res.error === 'bad-token' ? 'bad-token' : 'unreachable', error: res.error };
    const group = res.data && res.data.group;
    if (!group) return { code: 'unreachable' };
    this.store.setGroup(group);
    this._emit('synced', {});
    return { code: 'joined', group };
  });
}
async _inJoin(env) {
  if (typeof this.verifyAccessToken !== 'function' || !this.verifyAccessToken(env.payload && env.payload.token)) {
    return { ok: false, error: 'bad-token' };
  }
  const g = this.store.getGroup() || this.ensureGroup();
  this.store.addGroupMember(env.from);
  g.hubId = this.pub.machineId;
  this.store.saveGroup(g);
  await this._broadcastMemberSync(g);   // 一次性控制面同步给既有成员
  this._emit('synced', {});
  return { ok: true, data: { group: g } };
}
```

`_inMemberSync` 改为把成员合并进单例群组：

```js
_inMemberSync(env) {
  const g = env.payload.group;
  if (!g || !Array.isArray(g.members)) return { ok: false, error: 'bad-payload' };
  const local = this.store.getGroup();
  if (!local) { this.store.setGroup({ ...g }); }
  else {
    for (const m of g.members) if (!local.members.find((x) => x.machineId === m.machineId)) local.members.push(m);
    this.store.saveGroup(local);
  }
  this._emit('synced', {});
  return { ok: true };
}
```

- [ ] **Step 5: 运行测试**

Run: `node --test "server/test/collab-engine.test.js"`
Expected: PASS（旧的好友/多群用例需同步删除或用例改为单群；见 Step 6）

- [ ] **Step 6: 清理旧用例**

删除 `collab-engine.test.js` 中针对好友请求、建群、邀请、踢人、角色、旧 token 入群的用例；其余改为用 `A.ensureGroup()` + `B.joinByLink(...)`（配合 `A.verifyAccessToken`）建立双节点同群。

Run: `node --test "server/test/collab-engine.test.js"`
Expected: PASS

- [ ] **Step 7: 删除 `invite.js`**

Run: `rg -n "collaboration/invite|makeInviteToken|parseInviteToken" server`
确保无残留后：
```bash
git rm server/collaboration/invite.js
```

- [ ] **Step 8: Commit**

```bash
git add server/collaboration/engine.js server/collaboration/invite.js server/test/collab-engine.test.js
git commit -m "refactor(collab): 引擎单例群组 + joinByLink，删除好友/多群/邀请"
```

---

## Task 4: 引擎 chat/tasks 适配单例

**Files:**
- Modify: `server/collaboration/engine.js`
- Test: `server/test/collab-chat.test.js`

- [ ] **Step 1: 改测试建群方式**

`server/test/collab-chat.test.js` 的 `groupUp` 改为：

```js
async function groupUp(nodes) {
  const [A, B] = nodes;
  A.verifyAccessToken = (tk) => tk === 'good';
  A.ensureGroup();
  const r = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
  assert.equal(r.code, 'joined');
  return r.group;
}
```

`collab-chat.test.js` 与 `collab-remote-runner` 相关的其它直接用 `g.id` 的调用保持不变（`g.id === 'shared'`）。

- [ ] **Step 2: 运行，确认失败**

Run: `node --test "server/test/collab-chat.test.js"`
Expected: FAIL（旧 `requestFriend/createGroup` 已不存在）

- [ ] **Step 3: 修正引擎 chat 方法**

`_extendChat` 中 `groupIds`/`listGroups()` 相关逻辑保留即可（单例下返回 `[group]`）。`pullChatFrom` 用 `_knownProfile`，已改为单例。无需大改；若编译错误，逐个把 `this.store.listGroups().map(...)` 视为单例。确认 `sendChat/requestRemoteExec` 的 `groupId` 参数可传 `'shared'`。

- [ ] **Step 4: 运行通过**

Run: `node --test "server/test/collab-chat.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/engine.js server/test/collab-chat.test.js
git commit -m "test(collab): chat 用例改为单例群组"
```

---

## Task 5: http-mount 路由增删

**Files:**
- Modify: `server/collaboration/http-mount.js`
- Test: `server/test/collab-http.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-http.test.js` 追加（参考该文件既有启动方式）：

```js
test('POST /api/collab/join 入群', async () => {
  // A 起引擎并 ensureGroup + verifyAccessToken
  // B POST { host, port, token:'good' } → { code:'joined' }
  // 断言 B snapshot.groups.length===1 且 members 含 A
});

test('旧好友/建群路由已删除 404', async () => {
  // POST /api/collab/friends → 404
  // POST /api/collab/groups → 404
});
```

（按该文件现有 helper 写全，勿留注释占位）

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/collab-http.test.js"`
Expected: FAIL

- [ ] **Step 3: 改路由**

`http-mount.js`：
- 删除 `friends*`、`groups`（POST 建群）、`groups/:id/invite`、`groups/:id/invite-link`、`groups/:id/invite-revoke`、`groups/:id/members/:mid/kick`、`invites/*`、`join/preview`、旧 `join`（token）。
- 新增：
```js
if (seg[0] === 'join' && seg.length === 1 && m === 'POST') {
  const r = await engine.joinByLink({ host: body.host, port: Number(body.port), token: body.token });
  return ok(res, r);
}
```
- `snapshot` 改为返回 `{ identity, group: engine.store.getGroup(), heartbeats: engine.store.listHeartbeats?.() || {}, skillsInbox: inbox, outbox, groupSkills }`。
- 保留 `groups/:id/chat`、`/cmd`、`/files`、`/distribute`、`/chat-pull`、`/packages*`、`inbox/outbox/download/tool/assets/dirs/allowlist/cmds/pull`。
- `identity` PUT/GET、`skills`、`assets` 不变。

- [ ] **Step 4: 运行通过**

Run: `node --test "server/test/collab-http.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/http-mount.js server/test/collab-http.test.js
git commit -m "feat(collab): HTTP 路由改为 join，删除好友/邀请路由"
```

---

## Task 6: 远程门禁 `?access` + peer 豁免 + 注入校验

**Files:**
- Modify: `server/index.js`
- Test: `server/test/collab-invite.test.js`（改造）/ `server/test/collab-index.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-invite.test.js` 用现有 test-server helper 起服务，写：

```js
test('?access=正确令牌 → 302 且下发 Cookie', async () => {
  // POST /api/remote/invite 拿 token
  // GET /?access=<token> → 302、Set-Cookie devflow-access
});
test('?access=错误令牌 → 不通过门禁', async () => {
  // GET /?access=wrong → 非 302（登录页）
});
test('非回环 POST /api/collab/peer 不受 Cookie 门禁拦截', async () => {
  // 伪造 x-forwarded? 说明：门禁按 socket 地址判定，测试直接调用 isLocalReq 分支较难；
  // 改为单元测试：导出/注入判断，或断言路由在未带 cookie 时仍进入 collab 挂载（可用 req.socket.remoteAddress stub）。
});
```

（按 helper 能力写全；若无法模拟非回环，则对门禁逻辑做纯粹函数单测）

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/collab-invite.test.js"`
Expected: FAIL

- [ ] **Step 3: 改 `server/index.js`**

在请求处理开头（`isLocalReq` 判定后、`remoteAllowed` 之前）加：

```js
// ?access=<token> 免密换 Cookie
if (!isLocalReq(req)) {
  const access = url.searchParams.get('access');
  const inv0 = activeInvite();
  if (access && inv0 && safeEqual(access, inv0.token)) {
    const maxAge = Math.max(0, Math.floor((inv0.expiresAt - Date.now()) / 1000));
    const clean = new URL(req.url, 'http://localhost');
    clean.searchParams.delete('access');
    res.writeHead(302, { 'Set-Cookie': `${ACCESS_COOKIE}=${inv0.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`, Location: clean.pathname + (clean.search ? clean.search : '') });
    res.end();
    return;
  }
}
```

门禁 block 里，对 peer 路由豁免（放在 `if (!isLocalReq(req))` 内、无邀请/无 Cookie 分支最前）：

```js
const isPeer = url.pathname === '/api/collab/peer';
if (isPeer && req.method === 'POST') { /* 直接放行，交引擎签名鉴权 */ }
else { ...原有 activeInvite / remoteAllowed / 登录页逻辑... }
```

即：把现有「非本地一律拦」改为「非本地且非 peer POST 才拦」。

在生成邀请块（`/api/remote/invite`）内，`remoteInvite = ...` 之后加：

```js
if (ws && ws.engine) ws.engine.ensureGroup();
```

在 `initWorkspace` 内（`gateway` 创建附近）注入：

```js
ws.engine.verifyAccessToken = (tk) => { const inv = activeInvite(); return !!inv && safeEqual(tk, inv.token); };
```

`link` 改为：

```js
const link = `http://${addr}:${actualPort || PORT}/?access=${token}`;
```

- [ ] **Step 4: 运行通过 + 全量 server**

Run: `node --test "server/test/*.test.js"`
Expected: 相关用例 PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/test/collab-invite.test.js server/test/collab-index.test.js
git commit -m "feat(remote): ?access 免密 + peer 豁免门禁 + 邀请即建群"
```

---

## Task 7: 前端 types + useCollab

**Files:**
- Modify: `web/src/collaboration/types.ts`
- Modify: `web/src/collaboration/useCollab.ts`
- Test: `web/src/collaboration/useCollab.test.ts`

- [ ] **Step 1: 改 `types.ts`**

```ts
export interface CollabProfile { machineId: string; username: string; host: string; port: number; publicKey: string; }
export interface CollabMember extends CollabProfile {}
export interface CollabGroup { id: string; name: string; hubId: string; createdAt: number; members: CollabMember[]; }
export interface CollabInboxItem { /* 不变 */ }
export interface CollabGroupSkill { /* 不变 */ }
export interface CollabOutItem { /* 不变 */ }
export interface CollabSnapshot {
  identity: CollabProfile;
  group: CollabGroup | null;
  heartbeats: Record<string, CollabUsage>;
  skillsInbox: CollabInboxItem[];
  outbox: CollabOutItem[];
  groupSkills: CollabGroupSkill[];
}
export interface CollabUsage {
  agent: string; days: number; sessions?: number; messages?: number;
  totalCost?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
  collectedAt?: number; receivedAt?: number; error?: string;
}
export const EMPTY_SNAPSHOT: CollabSnapshot = {
  identity: { machineId: '', username: '', host: '', port: 0, publicKey: '' },
  group: null, heartbeats: {}, skillsInbox: [], outbox: [], groupSkills: [],
};
export interface CollabChatMeta { /* 不变 */ }
export type CollabChatKind = 'text' | 'cmd-result' | 'system';
export interface CollabChatMessage { /* 不变 */ }
export interface CollabPendingCmd { /* 不变 */ }
```

删除 `CollabFriend/CollabPendingFriend/CollabInvite/CollabInvitePreview`。

- [ ] **Step 2: 改 `useCollab.ts`**

删除方法：`requestFriend/acceptFriend/removeFriend/createGroup/inviteMember/kickMember/deleteGroup/acceptInvite/rejectInvite/createInviteLink/revokeInvites/previewInvite/joinByInvite`。

新增：

```ts
join: (host: string, port: number, token: string) => post('/api/collab/join', { host, port, token }),
```

`handleS2C` 中删除 `collab-friend-req`/`collab-group-invite` 分支（保留 chat/cmd）。
`updateIdentity/chat/sendChat/sendCmd/pullChat/loadPendingCmds/approveCmd/loadAllowlist/addAllow/removeAllow` 保留。
`sendPoolIn` 等技能方法保留；`sendPackage` 暂时保留（P3 改）。

- [ ] **Step 3: 改测试**

`useCollab.test.ts` 删除对已删方法的断言；新增 `join` 调用 URL/body 断言。

- [ ] **Step 4: 运行**

Run: `npm.cmd run test:web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/collaboration/types.ts web/src/collaboration/useCollab.ts web/src/collaboration/useCollab.test.ts
git commit -m "refactor(web): collab 类型与 API 收敛为单例群组"
```

---

## Task 8: GroupView + CollaborationView + 删除旧组件

**Files:**
- Create: `web/src/collaboration/GroupView.vue`
- Modify: `web/src/collaboration/CollaborationView.vue`
- Modify: `web/src/collaboration/GroupChatView.vue`
- Modify: `web/src/collaboration/TasksView.vue`
- Modify: `web/src/collaboration/SkillDistributor.vue`
- Delete: `web/src/collaboration/ContactsView.vue`, `web/src/collaboration/JoinInviteCard.vue`
- Modify: `web/src/App.vue`

- [ ] **Step 1: 新建 `GroupView.vue`**

结构（完整实现，样式沿用 `ContactsView` 的 class 名以免大改 CSS）：

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import GroupChatView from './GroupChatView.vue';
import { t } from '../i18n';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const group = computed(() => snap.value.group);
const me = computed(() => snap.value.identity?.machineId);

// 远程访问（自 TerminalView 迁入）
const remoteTtl = ref(24);
const remoteLink = ref('');
const remotePassword = ref('');
const remoteMsg = ref('');
const remoteState = ref<{ enabled: boolean; expiresAt: number | null; address?: string | null; needRestart?: boolean; host?: string; locked?: boolean }>({ enabled: false, expiresAt: null });

async function loadRemote() { try { remoteState.value = await fetch('/api/remote/state').then((r) => r.json()); } catch { /* ignore */ } }
async function genRemote() {
  remoteMsg.value = '';
  try {
    const r = await fetch('/api/remote/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hours: Number(remoteTtl.value) || 24 }) }).then((x) => x.json());
    remoteLink.value = r.link || ''; remotePassword.value = r.password || '';
    remoteState.value = { ...remoteState.value, enabled: !!r.enabled, expiresAt: r.expiresAt || null, address: r.address, needRestart: !!r.needRestart };
    if (r.needRestart) { /* 提示重启 */ }
  } catch (e) { remoteMsg.value = t('remote.failed', { msg: (e as Error).message }); }
}
async function revokeRemote() { try { await fetch('/api/remote/revoke', { method: 'POST' }); remoteLink.value = ''; remotePassword.value = ''; remoteState.value = { ...remoteState.value, enabled: false, expiresAt: null }; } catch { /* ignore */ } }
async function copy(v: string) { try { await navigator.clipboard.writeText(v); remoteMsg.value = t('remote.copied'); setTimeout(() => { remoteMsg.value = ''; }, 1500); } catch { /* ignore */ } }

// 加入
const joinInput = ref('');
const joinErr = ref('');
async function join() {
  joinErr.value = '';
  try {
    const u = new URL(joinInput.value.trim());
    const token = u.searchParams.get('access') || '';
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    if (!token || !u.hostname || !port) throw new Error(t('collab.join_link.invalid'));
    await props.collab.join(u.hostname, port, token);
    await props.collab.refresh();
    joinInput.value = '';
  } catch (e) { joinErr.value = (e as Error).message || String(e); }
}

// 命令白名单
const newPrefix = ref('');
const myAllow = computed(() => props.collab.allowlistState.value);
async function addAllowPrefix() { if (newPrefix.value.trim()) { await props.collab.addAllow(newPrefix.value.trim()); newPrefix.value = ''; } }
async function delAllowPrefix(p: string) { await props.collab.removeAllow(p); }

const online = (receivedAt?: number) => !!receivedAt && Date.now() - receivedAt < 20 * 60 * 1000;
function fmtExpire(ts: number | null) { return ts ? new Date(ts).toLocaleString() : ''; }

onMounted(async () => { await loadRemote(); await props.collab.loadAllowlist().catch(() => {}); });
</script>

<template>
  <div class="cw">
    <aside class="cw-left">
      <div class="sec">
        <h4>{{ $t('collab.remote.title') }}</h4>
        <div class="cfgrow"><span>{{ $t('remote.ttl') }}</span>
          <select v-model.number="remoteTtl">
            <option :value="4">{{ $t('remote.ttl_4h') }}</option>
            <option :value="24">{{ $t('remote.ttl_1d') }}</option>
            <option :value="48">{{ $t('remote.ttl_2d') }}</option>
            <option :value="120">{{ $t('remote.ttl_5d') }}</option>
            <option :value="168">{{ $t('remote.ttl_7d') }}</option>
          </select>
        </div>
        <div class="cfgrow">
          <button @click="genRemote">{{ $t('remote.generate') }}</button>
          <button v-if="remoteState.enabled" class="ghost" @click="revokeRemote">{{ $t('remote.revoke') }}</button>
        </div>
        <div v-if="remotePassword" class="linkrow"><input :value="remotePassword" readonly /><button @click="copy(remotePassword)">{{ $t('remote.copy_password') }}</button></div>
        <div v-if="remoteLink" class="linkrow"><input :value="remoteLink" readonly /><button @click="copy(remoteLink)">{{ $t('remote.copy') }}</button></div>
        <div v-if="remoteState.needRestart" class="err">{{ $t('remote.need_restart') }}</div>
        <div v-if="remoteMsg" class="cfghint">{{ remoteMsg }}</div>
      </div>

      <div class="sec">
        <h4>{{ $t('collab.join_link.title') }}</h4>
        <div class="addrow">
          <input v-model="joinInput" :placeholder="$t('collab.join_link.placeholder')" @keyup.enter="join" />
          <button @click="join">{{ $t('collab.join_link.join') }}</button>
        </div>
        <div v-if="joinErr" class="err">{{ joinErr }}</div>
      </div>

      <div class="sec">
        <h4>{{ $t('collab.member.title', { count: group?.members.length || 0 }) }}</h4>
        <div v-if="!group" class="empty">{{ $t('collab.member.empty') }}</div>
        <div v-for="m in group?.members || []" :key="m.machineId" class="rowline">
          <span class="dot" :class="{ on: online(snap.heartbeats[m.machineId]?.receivedAt) }" />
          <span class="txt">{{ m.username }}<span v-if="m.machineId === me" class="sub">{{ $t('collab.group.me_suffix') }}</span><span class="sub">{{ m.host }}:{{ m.port }}</span></span>
        </div>
      </div>

      <div class="sec allow">
        <h4>{{ $t('collab.allow.title') }}</h4>
        <div class="addrow"><input v-model="newPrefix" :placeholder="$t('collab.allow.placeholder')" @keyup.enter="addAllowPrefix" /><button @click="addAllowPrefix">＋</button></div>
        <div v-for="p in myAllow" :key="p" class="rowline"><span class="txt"><code>{{ p }}</code></span><button class="ghost del" @click="delAllowPrefix(p)">{{ $t('common.delete') }}</button></div>
      </div>
    </aside>

    <section class="cw-right">
      <template v-if="group">
        <div class="chat-col">
          <header class="gtop"><span class="tname">💬 {{ group.name }} <span class="tcnt">({{ group.members.length }})</span></span></header>
          <GroupChatView :collab="collab" :group-id="group.id" />
        </div>
      </template>
      <div v-else class="placeholder"><div class="ph">{{ $t('collab.placeholder') }}</div></div>
    </section>
  </div>
</template>

<style scoped>
@import './contacts.css';
</style>
```

> 说明：为避免复制 300 行 `<style>`，把 `ContactsView.vue` 的 `<style scoped>` 抽到新文件 `web/src/collaboration/contacts.css` 再用 `@import`（Vite 支持）。若 `@import` 与 scoped 冲突，则直接把样式粘贴进本组件。

- [ ] **Step 2: 抽样式文件**

Run: `New-Item -ItemType File web/src/collaboration/contacts.css`
把 `ContactsView.vue` 的 `<style scoped>` 内容（不含 `<style>` 标签）粘贴进 `contacts.css`。

- [ ] **Step 3: 改 `CollaborationView.vue`**

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { CollabS2C } from '@devflow/shared/collab';
import { useCollab } from './useCollab';
import { EMPTY_SNAPSHOT } from './types';
import type { useTerminal } from '../useTerminal';
import GroupView from './GroupView.vue';
import TasksView from './TasksView.vue';
import { t } from '../i18n';

type CollabTab = 'group' | 'tasks';
const props = defineProps<{ terminal: ReturnType<typeof useTerminal> }>();
const collab = useCollab();
const snap = computed(() => collab.state.value ?? EMPTY_SNAPSHOT);
const tab = ref<CollabTab>('group');
const tabs = computed(() => [
  { id: 'group' as const, label: t('collab.tabs.group') },
  { id: 'tasks' as const, label: t('collab.tabs.tasks') },
]);
let unsubs: (() => void)[] = [];
onMounted(() => {
  collab.refresh().catch(() => {});
  unsubs = [
    props.terminal.on(CollabS2C.COLLAB_SYNCED, () => collab.refresh().catch(() => {})),
    props.terminal.on(CollabS2C.COLLAB_INBOX, () => collab.refresh().catch(() => {})),
    props.terminal.on(CollabS2C.COLLAB_CHAT, (payload: any) => collab.handleS2C(CollabS2C.COLLAB_CHAT, payload)),
    props.terminal.on(CollabS2C.COLLAB_CMD_PENDING, (payload: any) => collab.handleS2C(CollabS2C.COLLAB_CMD_PENDING, payload)),
  ];
});
onBeforeUnmount(() => { unsubs.forEach((u) => u()); });
</script>

<template>
  <div class="cv">
    <header class="topbar">
      <span class="title">{{ $t('collab.title') }}</span>
      <nav class="tabs">
        <button v-for="t in tabs" :key="t.id" class="tab" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
      </nav>
      <div class="idbar" v-if="snap.identity.machineId">{{ snap.identity.username }} · {{ snap.identity.host }}:{{ snap.identity.port }}</div>
      <span v-if="collab.lastError" class="err">{{ collab.lastError }}</span>
    </header>
    <section class="body">
      <GroupView v-if="tab === 'group'" :collab="collab" />
      <TasksView v-else :collab="collab" />
    </section>
  </div>
</template>

<style scoped>
/* 保持原样式不变 */
</style>
```

- [ ] **Step 4: 适配 GroupChatView / TasksView / SkillDistributor**

- `GroupChatView.vue:12`：`snap.value.groups.find(...)` → `snap.value.group && snap.value.group.id === props.groupId ? snap.value.group : null`。
- `TasksView.vue:13`：`groupName` → `snap.value.group?.name || ''`。
- `SkillDistributor.vue:9`：同上改为单例查找。

- [ ] **Step 5: 删除 `ContactsView.vue` / `JoinInviteCard.vue`，改 `App.vue`**

- `git rm web/src/collaboration/ContactsView.vue web/src/collaboration/JoinInviteCard.vue`
- `App.vue`：删除 `import JoinInviteCard`、`import type { CollabGroup }`、`inviteCollab/inviteToken/onInviteJoined/clearInvite`，`onMounted` 里的 `it`/`inviteToken` 逻辑，模板中 `v-if="inviteToken"` 的 `joinmask` 块。

- [ ] **Step 6: 类型检查 + 测试**

Run: `npm.cmd run typecheck`
Expected: 通过
Run: `npm.cmd run test:web`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/collaboration web/src/App.vue
git commit -m "feat(web): 群组页签 = 远程访问 + 加入 + 单例群组，删除通讯录/邀请卡"
```

---

## Task 9: 设置里删除远程访问 UI

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 删除模板块**

删除 `TerminalView.vue` 中 `<div class="setsec">`（`remote.master_title` 那一段，约 645-683 行）。

- [ ] **Step 2: 删除脚本状态/函数**

删除 `remoteTtl/remoteLink/remotePassword/remoteMsg/remoteState`、`loadRemote/genRemote/revokeRemote/copyRemote/copyPassword/fmtExpire`；`onOpenSettings` 中去掉 `loadRemote()`。

- [ ] **Step 3: 删除相关样式**

删除 `.remote-warn`（约 852 行）及仅远程面板使用的样式。

- [ ] **Step 4: 验证无残留**

Run: `rg -n "remoteTtl|remoteState|genRemote|revokeRemote|remotePassword|loadRemote" web/src/components/TerminalView.vue`
Expected: 无输出

- [ ] **Step 5: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add web/src/components/TerminalView.vue
git commit -m "refactor(web): 远程访问 UI 自设置迁出"
```

---

## Task 10: i18n 增删

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 新增键（中英同步）**

新增：
`collab.group.default_name`、`collab.tabs.group`（替换 `collab.tabs.contacts`）、`collab.remote.title`、`collab.join_link.title/placeholder/join/invalid`、`collab.member.title`、`collab.member.empty`。
复用既有 `remote.*`、`collab.allow.*`、`collab.group.me_suffix`、`common.delete`。

- [ ] **Step 2: 删除键（中英同步）**

删除：`collab.tabs.contacts`、`collab.pending`、`collab.add`、`collab.role.*`、`collab.group.name_placeholder/create/create_short/mine/empty/avatar/member_count/invite_placeholder/invite/invited_you/kick/kick_title/kick_confirm/dissolve/dissolve_confirm`、`collab.friend.*`、`collab.invite.*`、`collab.join.*`。

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: PASS（键集合对称、无中文命中 server/web 用户可见范围）

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n: 单例群组/远程/加入 词条增删"
```

---

## Task 11: 全量验证

- [ ] **Step 1: 服务端 + 前端 + 类型 + i18n**

Run: `npm.cmd test`
Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 全部 PASS

- [ ] **Step 2: 手动冒烟（两实例）**

- A 启动 → 群组页签 → 生成链接（密码 + 链接）。
- B 启动 → 粘贴链接 → 接入 → 两侧成员列表出现彼此。
- 群聊、任务页面可用。
- 浏览器直开 A 的 `?access=<token>` 链接免密进入；错误令牌进登录页。

- [ ] **Step 3: 最终 commit（如有微调）**

```bash
git add -A
git commit -m "chore(collab): P1 单例群组+远程访问 收尾"
```

---

## Self-Review 记录

- **Spec 覆盖**：§3 数据模型→Task 2；§4 远程/加入→Task 3/5/6；§8 前端→Task 7/8/9；§10 i18n→Task 10；§12 测试→各 Task。P2/P3（心跳/downloads/技能拉取）不在本计划，见 `2026-09-11-heartbeat-downloads-usage.md` 与 `2026-09-11-skills-via-downloads.md`。
- **类型一致**：`getGroup/findGroup/listGroups/setGroup/saveGroup/addGroupMember`、`ensureGroup/joinByLink/_inJoin/verifyAccessToken`、前端 `join(host,port,token)` 在各 Task 命名一致。
- **占位扫描**：Task 5/6/8 中少量「按 helper 写全」处需执行者补全具体断言，不含 TBD 逻辑；其余均给出可运行代码。
