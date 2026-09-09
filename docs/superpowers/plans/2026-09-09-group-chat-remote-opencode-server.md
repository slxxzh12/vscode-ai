# 群聊 + @ 远程 opencode（server）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `statistic` 分支的协作子系统中实现：群聊消息 P2P 投递与离线补拉（CHAT）、`@某人 /command` 远程 `opencode run` 执行（CMD_REQ/CONFIRM/RESULT），含白名单与确认。

**Architecture:** 复用现有 collab P2P：机器↔机器走签名 HTTP 信封（`POST /api/collab/peer`），浏览器↔本机走 REST `/api/collab/*`。在 `shared/collab.js` 增 `CHAT_SEND/CMD_REQ/CMD_CONFIRM/CMD_RESULT/CHAT_PULL` 与 `CollabS2C.COLLAB_CHAT/COLLAB_CMD_PENDING`；`store` 增 `chatMessages/pendingCmds/commandAllowlist`；`engine` 增聊天/远程执行/pull 逻辑；新模块 `remote-runner.js` 负责 spawn `opencode run`（cwd/超时/截断）。隔离约束与既有 collab 相同。

**Tech Stack:** Node ESM，`node:child_process`/`node:crypto`/`node:fs`，`node:test`，`@devflow/shared/collab` 子路径。

**前置约束（照做，勿改）：**
- 不改 `shared/index.js`、`server/ws-gateway.js`、`web/**`。新增文件全在 `server/collaboration/**`、`server/test/*.test.js`、`shared/collab.js(.d.ts)`；`server/index.js` 仅加事件广播注册。
- 测试命令：`node --test "server/test/*.test.js"`。测试文件直接放 `server/test/`，`.test.js` 结尾。
- 消息 seq：`store` 维护本机全局单调递增 `chatSeq`（跨群唯一、不断增长），供补拉 `afterSeq` 过滤。
- 本机执行命令 = `spawn('opencode', ['run', text], { cwd })`，非 shell。

---

## Task 1: shared 常量扩展

**Files:**
- Modify: `shared/collab.js`
- Modify: `shared/collab.d.ts`
- Modify: `server/test/collab-const.test.js`

- [ ] **Step 1: 更新 `shared/collab.js`**

`CollabS2C` 增加两项，`CollabPeer` 增加五项（其余不动）：

```js
export const CollabS2C = Object.freeze({
  COLLAB_INBOX: 'collab-inbox',
  COLLAB_FRIEND_REQ: 'collab-friend-req',
  COLLAB_GROUP_INVITE: 'collab-group-invite',
  COLLAB_SYNCED: 'collab-synced',
  COLLAB_CHAT: 'collab-chat',             // 群有新消息/执行结果
  COLLAB_CMD_PENDING: 'collab-cmd-pending', // 本机收到待确认远程执行
});
export const CollabPeer = Object.freeze({
  FRIEND_REQUEST: 'friend-request',
  FRIEND_ACCEPT: 'friend-accept',
  GROUP_INVITE: 'group-invite',
  GROUP_ACCEPT: 'group-accept',
  MEMBER_SYNC: 'member-sync',
  SKILL_PUSH: 'skill-push',
  PULL_SYNC: 'pull-sync',
  CHAT_SEND: 'chat-send',                 // 聊天/@ 消息投递
  CMD_REQ: 'cmd-req',                     // 远程执行请求（发给目标机）
  CMD_CONFIRM: 'cmd-confirm',             // 目标机确认/拒绝结果
  CMD_RESULT: 'cmd-result',               // 目标机执行结果回传群
  CHAT_PULL: 'chat-pull',                 // 离线补拉消息
});
```

- [ ] **Step 2: 更新 `shared/collab.d.ts`**（与 JS 完全一致，追加同名字段）

```ts
export declare const CollabS2C: Readonly<{
  COLLAB_INBOX: 'collab-inbox';
  COLLAB_FRIEND_REQ: 'collab-friend-req';
  COLLAB_GROUP_INVITE: 'collab-group-invite';
  COLLAB_SYNCED: 'collab-synced';
  COLLAB_CHAT: 'collab-chat';
  COLLAB_CMD_PENDING: 'collab-cmd-pending';
}>;
export declare const CollabPeer: Readonly<{
  FRIEND_REQUEST: 'friend-request';
  FRIEND_ACCEPT: 'friend-accept';
  GROUP_INVITE: 'group-invite';
  GROUP_ACCEPT: 'group-accept';
  MEMBER_SYNC: 'member-sync';
  SKILL_PUSH: 'skill-push';
  PULL_SYNC: 'pull-sync';
  CHAT_SEND: 'chat-send';
  CMD_REQ: 'cmd-req';
  CMD_CONFIRM: 'cmd-confirm';
  CMD_RESULT: 'cmd-result';
  CHAT_PULL: 'chat-pull';
}>;
```

- [ ] **Step 3: 扩展测试 `server/test/collab-const.test.js`**（追加两条断言，其余保持）

```js
  assert.equal(CollabPeer.CHAT_SEND, 'chat-send');
  assert.equal(CollabPeer.CMD_RESULT, 'cmd-result');
  assert.equal(CollabS2C.COLLAB_CHAT, 'collab-chat');
```

- [ ] **Step 4: 跑测试**

Run: `node --test "server/test/collab-const.test.js"`
Expected: pass 1, fail 0

- [ ] **Step 5: Commit**

```bash
git add shared/collab.js shared/collab.d.ts server/test/collab-const.test.js
git commit -m "feat(collab): chat & remote-exec peer/s2c constants"
```

---

## Task 2: store 扩展（chatMessages/pendingCmds/commandAllowlist）

**Files:**
- Modify: `server/collaboration/store.js`
- Modify: `server/test/collab-store.test.js`

- [ ] **Step 1: 写失败的测试（追加到 `server/test/collab-store.test.js`）**

```js
test('chat 增删查 + 全局单调 seq', () => {
  const s = new CollabStore({ file: tmpFile() });
  s.addChatMessage({ id: 'm1', groupId: 'g', kind: 'text', fromId: 'a', text: 'hi', toId: null, ts: 1 });
  s.addChatMessage({ id: 'm2', groupId: 'g', kind: 'text', fromId: 'b', text: 'yo', toId: 'a', ts: 2 });
  const msgs = s.listChatMessages('g');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].seq, 1);
  assert.equal(msgs[1].seq, 2);
  assert.equal(msgs[0].groupId, 'g');
  // afterSeq 过滤
  const after = s.listChatMessages('g', { afterSeq: 1 });
  assert.equal(after.length, 1);
  assert.equal(after[0].id, 'm2');
  // 每机全局 seq 单调：下一个 getNextSeq 为 3
  assert.equal(s.nextChatSeq(), 3);
  assert.equal(s.nextChatSeq(), 4);
  // 跨群也不重复
  s.addChatMessage({ id: 'm3', groupId: 'g2', kind: 'system', fromId: 'a', text: 'sys', toId: null, ts: 3 });
  assert.equal(s.listChatMessages('g2')[0].seq, 5);
});

test('pendingCmds 与 allowlist', () => {
  const s = new CollabStore({ file: tmpFile() });
  s.addPendingCmd({ id: 'r1', groupId: 'g', fromId: 'a', text: 'ls', receivedAt: 1 });
  assert.equal(s.listPendingCmds().length, 1);
  assert.ok(s.findPendingCmd('r1'));
  s.removePendingCmd('r1');
  assert.equal(s.listPendingCmds().length, 0);
  s.addAllowEntry('deploy');
  s.addAllowEntry('git status');
  assert.deepEqual(s.listAllowlist(), ['deploy', 'git status']);
  s.removeAllowEntry('deploy');
  assert.deepEqual(s.listAllowlist(), ['git status']);
});

test('本地历史 cap 每群 500', () => {
  const s = new CollabStore({ file: tmpFile() });
  for (let i = 0; i < 502; i++) s.addChatMessage({ id: `m${i}`, groupId: 'g', kind: 'text', fromId: 'a', text: String(i), toId: null, ts: i });
  const msgs = s.listChatMessages('g');
  assert.equal(msgs.length, 500);
  assert.equal(msgs[0].id, 'm2'); // 最旧两条被裁
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-store.test.js"`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 写实现**

在 `server/collaboration/store.js` 的 `defaultData()` 增加字段：

```js
export function defaultData() {
  return {
    identity: null,
    friends: [],
    pendingFriends: [],
    groups: [],
    pendingInvites: [],
    skillsInbox: [],
    groupSkills: [],
    chatSeq: 0,            // 本机全局单调消息序号
    chatMessages: [],      // { id, groupId, kind, fromId, text, toId, meta, ts, seq }
    pendingCmds: [],       // { id(reqId), groupId, fromId, text, receivedAt }
    commandAllowlist: [],  // string[] 前缀
  };
}
```

在 class 中追加方法（含 CHAT_CAP 常量）：

```js
  // ---- chat ----
  nextChatSeq() { this.data.chatSeq += 1; this.save(); return this.data.chatSeq; }
  addChatMessage(msg) {
    const m = { id: msg.id, groupId: msg.groupId, kind: msg.kind, fromId: msg.fromId,
      text: msg.text, toId: msg.toId ?? null, meta: msg.meta ?? null, ts: msg.ts, seq: msg.seq };
    this.data.chatMessages.push(m);
    const cap = 500;
    if (this.data.chatMessages.filter((x) => x.groupId === m.groupId).length > cap) {
      // 只裁当前群最旧的一条（简单实现：逐条裁至 cap）
      const same = this.data.chatMessages.filter((x) => x.groupId === m.groupId);
      while (same.length > cap) { const first = same.shift(); this.data.chatMessages = this.data.chatMessages.filter((x) => x !== first); }
    }
    this.save();
    return m;
  }
  listChatMessages(groupId, { afterSeq = 0, limit = 500 } = {}) {
    return this.data.chatMessages
      .filter((m) => m.groupId === groupId && m.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(-limit);
  }
  lastSeqOf(groupId) {
    const arr = this.data.chatMessages.filter((m) => m.groupId === groupId);
    if (!arr.length) return 0;
    return Math.max(...arr.map((m) => m.seq));
  }

  // ---- pending cmds ----
  listPendingCmds() { return this.data.pendingCmds; }
  findPendingCmd(id) { return this.data.pendingCmds.find((c) => c.id === id) || null; }
  addPendingCmd(cmd) { if (!this.findPendingCmd(cmd.id)) this.data.pendingCmds.push(cmd); this.save(); return cmd; }
  removePendingCmd(id) { this.data.pendingCmds = this.data.pendingCmds.filter((c) => c.id !== id); this.save(); }

  // ---- allowlist ----
  listAllowlist() { return this.data.commandAllowlist; }
  addAllowEntry(prefix) {
    if (!this.data.commandAllowlist.includes(prefix)) this.data.commandAllowlist.push(prefix);
    this.save();
  }
  removeAllowEntry(prefix) {
    this.data.commandAllowlist = this.data.commandAllowlist.filter((p) => p !== prefix);
    this.save();
  }
  isAllowed(text) { return this.data.commandAllowlist.some((p) => typeof text === 'string' && text.startsWith(p)); }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-store.test.js"`
Expected: 全部 PASS（含旧的 + 新增 3 个）

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/store.js server/test/collab-store.test.js
git commit -m "feat(collab): store chat/pendingCmd/allowlist + monotonic seq"
```

---

## Task 3: remote-runner.js（opencode run 封装）

**Files:**
- Create: `server/collaboration/remote-runner.js`
- Create: `server/test/collab-remote-runner.test.js`

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpenCodeRunner } from '../collaboration/remote-runner.js';

// 用 node 脚本充当 opencode：第一个参数 "run"，第二个为 text（echo 回写 + 可 sleep）
function shimPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-shim-'));
  const p = path.join(dir, 'shim.cjs');
  fs.writeFileSync(p, `
const args = process.argv.slice(2);
if (args[0] === 'echo') { process.stdout.write(args[1] || ''); process.exit(0); }
if (args[0] === 'fail') { process.stderr.write('boom'); process.exit(3); }
if (args[0] === 'slow') { setTimeout(() => process.exit(0), 5000); }
`, 'utf8');
  return p;
}

test('正常执行返回 stdout/exitCode', async () => {
  const shim = shimPath();
  // bin=node，spawnArgs=['shim', 'run', text] 无法直接映射；因此本 runner 以 args 数组注入
  const runner = createOpenCodeRunner({ bin: process.execPath, spawnPrefix: [] });
  const r = await runner.execute({ args: [shim, 'echo', 'hello world'], cwd: os.tmpdir() });
  assert.equal(r.stdout, 'hello world');
  assert.equal(r.exitCode, 0);
});

test('stderr 与退出码透传', async () => {
  const shim = shimPath();
  const runner = createOpenCodeRunner({ bin: process.execPath, spawnPrefix: [] });
  const r = await runner.execute({ args: [shim, 'fail'], cwd: os.tmpdir() });
  assert.equal(r.exitCode, 3);
  assert.equal(r.stderr, 'boom');
});

test('超时 kill 返回 timedOut', async () => {
  const shim = shimPath();
  const runner = createOpenCodeRunner({ bin: process.execPath, spawnPrefix: [], timeoutMs: 200 });
  const r = await runner.execute({ args: [shim, 'slow'], cwd: os.tmpdir() });
  assert.equal(r.timedOut, true);
});

test('输出截断', async () => {
  const shim = shimPath();
  const runner = createOpenCodeRunner({ bin: process.execPath, spawnPrefix: [], maxBytes: 8 });
  const r = await runner.execute({ args: [shim, 'echo', '1234567890abcdef'], cwd: os.tmpdir() });
  assert.ok(r.stdout.length <= 8 + 3, '超出截断加省略标记');
});

test('默认前缀=opencode run：bin 可注入', async () => {
  const shim = shimPath();
  // 模拟 opencode：args 应被 runner 拼成 [shim('run'), text]；用真实 echo 脚本来验证
  const runner = createOpenCodeRunner({ bin: process.execPath, opencodePrefix: [shim, 'echo'] });
  const r = await runner.execute({ text: '远程文本', cwd: os.tmpdir() });
  assert.equal(r.stdout, '远程文本');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-remote-runner.test.js"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

Create: `server/collaboration/remote-runner.js`

```js
import { spawn } from 'node:child_process';

// 封装 spawn 一次性命令：默认跑 `opencode run "<text>"`。
// 为可测，开放注入：
//  - bin：可执行文件（默认 'opencode'）
//  - opencodePrefix：当只给 text 时拼在 text 前的 argv（默认 ['run']）
//  - spawnPrefix：可整体替换 argv 的额外注入（测试用）
export function createOpenCodeRunner({
  bin = 'opencode',
  opencodePrefix = ['run'],
  timeoutMs = Number(process.env.OPENCODE_RUN_TIMEOUT_MS || 300000),
  maxBytes = Number(process.env.OPENCODE_RESULT_MAX_BYTES || 200 * 1024),
} = {}) {
  function truncate(buf) {
    if (buf.length <= maxBytes) return buf.toString('utf8');
    return buf.toString('utf8', 0, maxBytes) + '...[truncated]';
  }
  function execute({ text = null, args = null, cwd = process.cwd() }) {
    const argv = args ? args.slice() : [...opencodePrefix, text ?? ''];
    return new Promise((resolve) => {
      let child;
      try { child = spawn(bin, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { return resolve({ exitCode: -1, stdout: '', stderr: String(e && e.message || e), timedOut: false, durationMs: 0, spawnError: true }); }
      const out = []; const errBuf = [];
      let done = false;
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* noop */ }
        if (!done) { done = true; resolve({ exitCode: null, stdout: truncate(Buffer.concat(out)), stderr: truncate(Buffer.concat(errBuf)), timedOut: true, durationMs: Date.now() - startedAt, spawnError: false }); }
      }, timeoutMs);
      const startedAt = Date.now();
      child.stdout.on('data', (c) => out.push(Buffer.from(c)));
      child.stderr.on('data', (c) => errBuf.push(Buffer.from(c)));
      child.on('error', (e) => {
        if (done) return; done = true; clearTimeout(timer);
        resolve({ exitCode: -1, stdout: truncate(Buffer.concat(out)), stderr: truncate(Buffer.concat(errBuf)) || String(e && e.message || e), timedOut: false, durationMs: Date.now() - startedAt, spawnError: true });
      });
      child.on('close', (code) => {
        if (done) return; done = true; clearTimeout(timer);
        resolve({ exitCode: code ?? null, stdout: truncate(Buffer.concat(out)), stderr: truncate(Buffer.concat(errBuf)), timedOut: false, durationMs: Date.now() - startedAt, spawnError: false });
      });
    });
  }
  return { execute, bin, timeoutMs, maxBytes };
}
```

> 说明：`startedAt` 在 `timer` 定义之后、`execute` 内声明，因 `const` 提升时序需在 `timer` 内引用前已初始化——上述代码在 `setTimeout` 之后定义 `startedAt`，闭包执行晚于同步初始化，安全。测试全部为真实 node 子进程（shim），不 mock spawn。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-remote-runner.test.js"`
Expected: PASS（5 个用例）

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/remote-runner.js server/test/collab-remote-runner.test.js
git commit -m "feat(collab): remote-runner spawn opencode run with timeout/truncate"
```

---

## Task 4: engine 聊天与远程执行核心

**Files:**
- Modify: `server/collaboration/engine.js`
- Create: `server/test/collab-chat.test.js`

engine 新增：构造注入 `runner`（默认 `createOpenCodeRunner()`，测试注入假 runner）；方法 `sendChat`、`requestRemoteExec`、`approveCmd`、`listChat`、`pullChatFrom`、`allowCmd`/`disallowCmd`/`listAllowlist`；inbound 分支 CHAT_SEND / CMD_REQ / CMD_CONFIRM / CMD_RESULT / CHAT_PULL；事件 `chat` / `cmd-pending`。

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabEngine, createPairHarness } from '../collaboration/engine.js';

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

test('白名单命中自动执行并回结果；未命中产生 pending', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp([A, B]);
    // B 是目标机：注入假 runner 记录执行
    const executed = [];
    B.runner = { execute: async ({ text }) => { executed.push(text); return { stdout: 'OUT', stderr: '', exitCode: 0, timedOut: false, durationMs: 5 }; } };
    B.store.addAllowEntry('安全命令');
    const reqId = await A.requestRemoteExec({ groupId: g.id, text: '安全命令 跑测试', toId: B.pub.machineId });
    assert.ok(reqId);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(executed.length, 1, '白名单自动执行');
    // 结果应回传到 A 的历史
    const results = A.store.listChatMessages(g.id).filter((m) => m.kind === 'cmd-result');
    assert.ok(results.length >= 1, 'A 收到 cmd-result');
    assert.equal(results[0].meta.stdout, 'OUT');
  } finally { await h.stop(); }
});

test('未命中白名单 → B 产生 pending，approve 后执行', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp([A, B]);
    const executed = [];
    B.runner = { execute: async ({ text }) => { executed.push(text); return { stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 }; } };
    await A.requestRemoteExec({ groupId: g.id, text: '危险命令 删除', toId: B.pub.machineId });
    await new Promise((r) => setTimeout(r, 20));
    const pend = B.store.listPendingCmds();
    assert.equal(pend.length, 1, 'B 产生 pending');
    await B.approveCmd({ reqId: pend[0].id, approve: true });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(executed.length, 1, 'approve 后执行');
  } finally { await h.stop(); }
});

test('越权：非群成员发 CMD_REQ 被拒', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const g = await groupUp([A, B]);
    // 把 A 从 B 侧群成员中移除，但 A 仍是 B 好友（签名仍可验证）→ 应被群成员校验拒绝
    const gB = B.store.findGroup(g.id);
    gB.members = gB.members.filter((m) => m.machineId !== A.pub.machineId);
    B.store.saveGroup(gB);
    // 用 A 真实私钥签名的 CMD_REQ（绕过签名失败，验证群成员鉴权本身）
    const env = signEnvelope(A.identity.privateKey, 'cmd-req', A.pub,
      { groupId: g.id, text: 'x', toId: B.pub.machineId, reqId: 'r-fake' });
    const res = await B.engine.handleIncoming(env);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'not-member');
  } finally { await h.stop(); }
});
```

测试文件头部需追加 import：

```js
import { signEnvelope } from '../collaboration/sign.js';
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-chat.test.js"`
Expected: FAIL

- [ ] **Step 3: 在 engine.js 加 import 与构造函数字段**

在文件头 import 区加：`import { createOpenCodeRunner } from './remote-runner.js';` 并在构造器加参数与默认赋值：

```js
constructor({ store, identity, events = null, peer = null, skillsRoot = null, inboxDir = null, runner = null, logger = console }) {
    ...
    this.runner = runner || createOpenCodeRunner();
  }
```

`handleIncoming` switch 增加分支：

```js
      case CollabPeer.CHAT_SEND: return this._inChatSend(env);
      case CollabPeer.CMD_REQ: return this._inCmdReq(env);
      case CollabPeer.CMD_CONFIRM: return this._inCmdConfirm(env);
      case CollabPeer.CMD_RESULT: return this._inCmdResult(env);
      case CollabPeer.CHAT_PULL: return this._inChatPull(env);
```

- [ ] **Step 4: 在 engine.js class 末尾、setAdvertised 前追加实现**

```js
  // ================= 群聊 =================
  _requireMember(groupId, machineId = this.pub.machineId) {
    const g = this.store.findGroup(groupId);
    if (!g) return { code: 'no-group', group: null, me: null };
    const me = g.members.find((m) => m.machineId === machineId);
    if (!me) return { code: 'not-member', group: g, me: null };
    return { code: 'ok', group: g, me };
  }
  async _broadcastChat(groupId, msg) {
    const g = this.store.findGroup(groupId);
    if (!g) return;
    const env = this._sign(CollabPeer.CHAT_SEND, { msg });
    for (const m of g.members) {
      if (m.machineId === this.pub.machineId) continue;
      await this._post(m.host, m.port, env);
    }
  }
  async sendChat({ groupId, text, toId = null }) {
    const r = this._requireMember(groupId);
    if (r.code !== 'ok') return { code: r.code };
    if (toId && !r.group.members.find((m) => m.machineId === toId)) return { code: 'no-target' };
    const msg = { id: crypto.randomUUID(), groupId, kind: 'text', fromId: this.pub.machineId, text, toId, ts: Date.now(), seq: this.store.nextChatSeq() };
    this.store.addChatMessage(msg);
    this._broadcastChat(groupId, msg);
    this._emit('chat', { groupId, msg });
    return { code: 'ok', msg };
  }
  async _inChatSend(env) {
    const p = env.from;
    const msg = env.payload.msg;
    if (!msg || msg.groupId == null || typeof msg.text !== 'string') return { ok: false, error: 'bad-msg' };
    const r = this._requireMember(msg.groupId, p.machineId);
    if (r.code !== 'ok') return { ok: false, error: 'not-member' };
    this.store.addChatMessage({ ...msg, seq: this.store.nextChatSeq(), ts: msg.ts ?? Date.now() });
    this._emit('chat', { groupId: msg.groupId, msg });
    return { ok: true };
  }

  // ============ @ 远程执行 ============
  async requestRemoteExec({ groupId, text, toId }) {
    const r = this._requireMember(groupId);
    if (r.code !== 'ok') return { code: r.code };
    const target = r.group.members.find((m) => m.machineId === toId);
    if (!target) return { code: 'no-target' };
    const reqId = crypto.randomUUID();
    const env = this._sign(CollabPeer.CMD_REQ, { groupId, text, toId, reqId });
    const res = await this._post(target.host, target.port, env);
    if (!res.ok) {
      // 目标离线：本机落 system 提示
      const msg = { id: crypto.randomUUID(), groupId, kind: 'system', fromId: this.pub.machineId, text: `远程执行未送达（@${target.username} 可能离线）`, toId, ts: Date.now(), seq: this.store.nextChatSeq(), meta: null };
      this.store.addChatMessage(msg);
      this._emit('chat', { groupId, msg });
      return { code: 'undelivered', reqId };
    }
    return { code: 'sent', reqId };
  }
  async _inCmdReq(env) {
    const p = env.from;
    const { groupId, text, toId, reqId } = env.payload;
    if (!groupId || typeof text !== 'string' || !toId || !reqId) return { ok: false, error: 'bad-request' };
    if (toId !== this.pub.machineId) return { ok: true }; // 只处理发给本机
    const r = this._requireMember(groupId, p.machineId);
    if (r.code !== 'ok') return { ok: false, error: 'not-member' };
    if (this.store.isAllowed(text)) {
      this._runCmd({ reqId, groupId, fromId: p.machineId, text, auto: true });
      return { ok: true };
    }
    this.store.addPendingCmd({ id: reqId, groupId, fromId: p.machineId, text, receivedAt: Date.now() });
    this._emit('cmd-pending', { reqId, groupId, fromId: p.machineId, text });
    return { ok: true };
  }
  async _runCmd({ reqId, groupId, fromId, text }) {
    let res;
    try { res = await this.runner.execute({ text, cwd: process.cwd() }); }
    catch (e) { res = { stdout: '', stderr: String(e && e.message || e), exitCode: -1, timedOut: false, durationMs: 0, spawnError: true }; }
    const msg = { id: crypto.randomUUID(), groupId, kind: 'cmd-result', fromId: this.pub.machineId,
      text: res.stdout || '(no output)', toId: fromId, ts: Date.now(), seq: this.store.nextChatSeq(),
      meta: { reqId, exitCode: res.exitCode, stderr: res.stderr || '', durationMs: res.durationMs ?? 0 } };
    this.store.addChatMessage(msg);
    this._broadcastChat(groupId, msg);
    this._emit('chat', { groupId, msg });
  }
  async approveCmd({ reqId, approve }) {
    const pending = this.store.findPendingCmd(reqId);
    if (!pending) return { code: 'not-found' };
    this.store.removePendingCmd(reqId);
    if (!approve) {
      const msg = { id: crypto.randomUUID(), groupId: pending.groupId, kind: 'system', fromId: this.pub.machineId,
        text: `拒绝了 @${pending.fromId} 的远程执行`, toId: pending.fromId, ts: Date.now(), seq: this.store.nextChatSeq(), meta: null };
      this.store.addChatMessage(msg);
      this._broadcastChat(pending.groupId, msg);
      this._emit('chat', { groupId: pending.groupId, msg });
      return { code: 'denied' };
    }
    this._runCmd({ reqId: pending.id, groupId: pending.groupId, fromId: pending.fromId, text: pending.text });
    return { code: 'approved' };
  }
  _inCmdConfirm(env) {
    // 对方（被发起方？非标准场景）——确认消息由本地 UI 触发，不走 peer；保留分支以防扩展
    return { ok: true };
  }
  _inCmdResult(env) {
    const p = env.from;
    const { groupId } = env.payload;
    const r = this._requireMember(groupId, p.machineId);
    if (r.code !== 'ok') return { ok: false, error: 'not-member' };
    const { reqId = null, stdout = '', stderr = '', exitCode = null, durationMs = 0 } = env.payload;
    const msg = { id: crypto.randomUUID(), groupId, kind: 'cmd-result', fromId: p.machineId,
      text: stdout || '(no output)', toId: env.payload.toId ?? null, ts: Date.now(), seq: this.store.nextChatSeq(),
      meta: { reqId, exitCode, stderr, durationMs } };
    this.store.addChatMessage(msg);
    this._emit('chat', { groupId, msg });
    return { ok: true };
  }

  // ============ 本地查询 / 拉历史 / 白名单 ============
  listChat(groupId, { afterSeq = 0 } = {}) { return this.store.listChatMessages(groupId, { afterSeq }); }
  async pullChatFrom(fromMachineId, { groupId }) {
    const peerProfile = this._knownProfile(fromMachineId);
    if (!peerProfile) return { code: 'no-peer' };
    const afterSeq = this.store.lastSeqOf(groupId);
    const res = await this._post(peerProfile.host, peerProfile.port, this._sign(CollabPeer.CHAT_PULL, { groupId, afterSeq }));
    if (!res.ok) return { code: 'failed', error: res.error };
    return { code: 'ok', messages: res.data?.messages || [] };
  }
  applyChatPull({ groupId, messages }) {
    if (!groupId || !Array.isArray(messages)) return;
    const existing = new Set(this.store.listChatMessages(groupId).map((m) => m.id));
    for (const m of messages) {
      if (existing.has(m.id)) continue;
      this.store.addChatMessage({ ...m, seq: this.store.nextChatSeq(), ts: m.ts ?? Date.now() });
    }
    this._emit('chat', { groupId, msg: null });
  }
  _inChatPull(env) {
    const p = env.from;
    const { groupId, afterSeq = 0 } = env.payload;
    const r = this._requireMember(groupId, p.machineId);
    if (r.code !== 'ok') return { ok: false, error: 'not-member' };
    const messages = this.store.listChatMessages(groupId, { afterSeq });
    return { ok: true, data: { messages } };
  }
  listPendingCmds() { return this.store.listPendingCmds(); }
  listAllowlist() { return this.store.listAllowlist(); }
  allowCmd(prefix) { if (typeof prefix === 'string' && prefix) { this.store.addAllowEntry(prefix.trim()); return { code: 'ok' }; } return { code: 'bad' }; }
  disallowCmd(prefix) { this.store.removeAllowEntry(prefix); return { code: 'ok' }; }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test "server/test/collab-chat.test.js"`
Expected: PASS（4 个用例全过）

- [ ] **Step 6: 跑既有 collab 测试确认未破坏**

Run: `node --test "server/test/collab-engine.test.js"`、`node --test "server/test/collab-store.test.js"`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add server/collaboration/engine.js server/test/collab-chat.test.js
git commit -m "feat(collab): engine chat + remote exec + allowlist + pull"
```

---

## Task 5: http-mount 补本地 API

**Files:**
- Modify: `server/collaboration/http-mount.js`
- Modify: `server/test/collab-http.test.js`

- [ ] **Step 1: 加失败测试（追加到 `server/test/collab-http.test.js`）**

```js
test('群聊与远程执行 REST 冒烟', async () => {
  const A = await startNode('alice');
  const B = await startNode('bob');
  const demo = path.join(A.skillsRoot, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(path.join(demo, 'SKILL.md'), '# demo', 'utf8');
  // B 注入假 runner
  B.engine.runner = { execute: async () => ({ stdout: 'OK', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 }) };
  try {
    await post(`http://127.0.0.1:${A.port}/api/collab/friends`, { host: '127.0.0.1', port: B.port });
    await new Promise((r) => setTimeout(r, 50));
    await post(`http://127.0.0.1:${B.port}/api/collab/friends/${A.engine.pub.machineId}/accept`, {});
    const gRes = await post(`http://127.0.0.1:${A.port}/api/collab/groups`, { name: 'team' });
    const gid = gRes.body.group.id;
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/invite`, { machineId: B.engine.pub.machineId });
    await new Promise((r) => setTimeout(r, 50));
    const inv = B.engine.store.listPendingInvites()[0];
    await post(`http://127.0.0.1:${B.port}/api/collab/invites/${inv.id}/accept`, {});
    // B 白名单加入，A @B 执行
    await post(`http://127.0.0.1:${B.port}/api/collab/allowlist`, { prefix: '安全命令' });
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/chat`, { text: 'hello', toId: null });
    await new Promise((r) => setTimeout(r, 80));
    // 拉 A 的聊天列表
    const chat = await fetch(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/chat`).then((r) => r.json());
    assert.ok(chat.messages.some((m) => m.text === 'hello'));
    // 远程执行
    await post(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/cmd`, { text: '安全命令 go', toId: B.engine.pub.machineId });
    await new Promise((r) => setTimeout(r, 120));
    const chat2 = await fetch(`http://127.0.0.1:${A.port}/api/collab/groups/${gid}/chat`).then((r) => r.json());
    const results = chat2.messages.filter((m) => m.kind === 'cmd-result');
    assert.ok(results.length >= 1, 'A 群内有 cmd-result');
  } finally { A.server.close(); B.server.close(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-http.test.js"`
Expected: FAIL（404，路由未实现）

- [ ] **Step 3: 在 http-mount.js 的 try 块末尾（`return sendJson(res, 404...)` 之前）追加路由**

```js
      // ---- chat ----
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'chat' && m === 'POST') {
        const r = await engine.sendChat({ groupId: seg[1], text: body.text, toId: body.toId ?? null });
        return ok(res, r);
      }
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'chat' && m === 'GET') {
        const afterSeq = Number(url.searchParams.get('afterSeq') || 0);
        return ok(res, { messages: engine.listChat(seg[1], { afterSeq }) });
      }
      if (seg[0] === 'groups' && seg.length === 3 && seg[2] === 'cmd' && m === 'POST') {
        const r = await engine.requestRemoteExec({ groupId: seg[1], text: body.text, toId: body.toId });
        return ok(res, r);
      }
      if (seg[0] === 'groups' && seg.length === 4 && seg[3] === 'chat-pull' && m === 'POST') {
        const r = await engine.pullChatFrom(body.machineId, { groupId: seg[1] });
        if (r.code === 'ok') engine.applyChatPull({ groupId: seg[1], messages: r.messages });
        return ok(res, r);
      }
      // ---- pending cmds（目标机待确认）----
      if (seg[0] === 'cmds' && seg.length === 1 && m === 'GET') return ok(res, { pending: engine.listPendingCmds() });
      if (seg[0] === 'cmds' && seg.length === 3 && seg[2] === 'approve' && m === 'POST') {
        const r = await engine.approveCmd({ reqId: seg[1], approve: body.approve !== false });
        return ok(res, r);
      }
      // ---- allowlist ----
      if (seg[0] === 'allowlist' && m === 'GET') return ok(res, { allowlist: engine.listAllowlist() });
      if (seg[0] === 'allowlist' && seg.length === 1 && m === 'POST') { const r = engine.allowCmd(body.prefix); return ok(res, r); }
      if (seg[0] === 'allowlist' && seg.length === 2 && m === 'DELETE') { const r = engine.disallowCmd(decodeURIComponent(seg[1])); return ok(res, r); }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-http.test.js"`
Expected: 全部 PASS（含旧的 2 个 + 新增 1 个）

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/http-mount.js server/test/collab-http.test.js
git commit -m "feat(collab): http routes for chat/remote-exec/allowlist"
```

---

## Task 6: index.js 事件广播 + 收尾

**Files:**
- Modify: `server/index.js`
- Modify: `server/test/collab-index.test.js`

- [ ] **Step 1: index.js 注册新事件到 CollabS2C**

在现有 4 行 `collabEventBus.on(...)` 之后追加：

```js
collabEventBus.on('chat', (payload) => broadcastCollab(CollabS2C.COLLAB_CHAT, { groupId: payload.groupId, msg: payload.msg }));
collabEventBus.on('cmd-pending', (payload) => broadcastCollab(CollabS2C.COLLAB_CMD_PENDING, payload));
```

- [ ] **Step 2: 在 `server/test/collab-index.test.js` 追加断言**

```js
test('事件总线转发 chat / cmd-pending 事件', async () => {
  const bus = createEventBus();
  const seen = [];
  bus.on(CollabS2C.COLLAB_CHAT, (p) => seen.push(['chat', p.groupId]));
  bus.on(CollabS2C.COLLAB_CMD_PENDING, (p) => seen.push(['pending', p.reqId]));
  bus.emit('chat', { groupId: 'g1', msg: null });
  bus.emit('cmd-pending', { reqId: 'r1' });
  assert.deepEqual(seen, [['chat', 'g1'], ['pending', 'r1']]);
});
```

- [ ] **Step 3: 全量测试 + typecheck**

Run: `node --test "server/test/*.test.js"`
Expected: 全绿（含既有 93 + 新增）

- [ ] **Step 4: Commit**

```bash
git add server/index.js server/test/collab-index.test.js
git commit -m "feat(collab): broadcast chat & cmd-pending events over ws"
```

---

## 完成标准

- `shared/collab.js` 含 5 个 chat/cmd peer 类型 + 2 个 S2C 推送类型。
- store 支持聊天历史（seq 单调、cap 500）、pendingCmds、allowlist。
- remote-runner 能 spawn 一次性命令，支持 cwd/超时/输出截断/退出码。
- engine 完成：sendChat/@远程执行（白名单自动 or pending 确认后执行）/结果回传/离线补拉/越权拒绝。
- http-mount 暴露 chat/cmd/allowlist 路由；index.js 广播 chat & cmd-pending。
- `node --test "server/test/*.test.js"` 全绿。
