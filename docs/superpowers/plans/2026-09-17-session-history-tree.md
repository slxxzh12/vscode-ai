# 会话两级目录 + 点击恢复会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 历史面板「全部会话」改成按会话的两级目录（一级会话、二级消息），点会话行的「打开」可切换/恢复该会话；并修复多 agent（opencode/nga.cmd）恢复的 id 错配、无续会话能力时静默丢上下文、多会话抢占同一对话。

**Architecture:** 前端用纯函数 `buildSessionTree` 把历史消息分组渲染成树；恢复复用服务端账本，新增一条 WS 消息 `C2S.RESTORE`（在跑则切、账本有则重建、被占用则切占用者、否则报错）；opencode 会话 id 发现增加「已认领排除 + 串行化」。

**Tech Stack:** Node ESM（`node --test`）、Vue3 + TS + vitest、`ws`、`@devflow/shared` 协议常量、`shared/i18n/{zh-CN,en}.js`。

**Spec:** `docs/superpowers/specs/2026-09-17-session-history-tree-design.md`

**环境（AGENTS.md）:** Windows + PowerShell 5.1，无 bash；一律 `npm.cmd`；`node --test` 单文件直接给路径；提交前跑敏感信息扫描与 `check:i18n`；所有常驻进程异步启动。

---

## 文件结构

**新增**
- `server/session-claims.js` — 续接认领判定（已认领 id 集合、占用者查找），纯函数。
- `server/test/session-claims.test.js`
- `web/src/sessionTree.ts` — 消息 → 会话树分组，纯函数。
- `web/src/sessionTree.test.ts`
- `docs/learn/agent续会话配置.md`

**修改**
- `server/agent-resume.js` — `pickOpencodeSession`/`discoverAgentSessionId` 支持 `exclude`。
- `server/session-restore.js` — 抽出 `restoreRecord`，返回 `resumed`，占用退化。
- `server/session-manager.js` — `summary()` 增加 `resumed`；新增 `live()`。
- `server/ws-gateway.js` — `C2S.RESTORE` 处理，`handleMessage` 改 async。
- `server/index.js` — 发现串行化 + 认领排除 + `restoreSessionById` 接线。
- `server/test/helpers/test-server.js` — 透传 `restoreSessionById`。
- `shared/index.js` / `shared/index.d.ts` — `C2S.RESTORE`、`SessionSummary.resumed`。
- `web/src/components/HistoryList.vue` — 会话树渲染。
- `web/src/useTerminal.ts` — `restoreSession()`。
- `web/src/App.vue` — 传 `liveSessionIds`、接 `@open-session`。
- `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — 6 条词条。
- `config/devflow.xml` — `<agents>` 注释说明 `resumeCmd`/`resumeDiscover`。

---

## Task 1: opencode 发现支持排除已认领 id

**Files:**
- Modify: `server/agent-resume.js`（`pickOpencodeSession` 第 29-42 行、`discoverAgentSessionId` 第 54-66 行）
- Test: `server/test/agent-resume.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/agent-resume.test.js` 末尾追加：

```js
test('pickOpencodeSession 支持 exclude 跳过已认领 id', () => {
  const items = JSON.parse(ITEMS);
  assert.equal(pickOpencodeSession(items, { cwd: 'C:\\proj', since: 4800, exclude: ['ses_b'] }), 'ses_a');
  assert.equal(pickOpencodeSession(items, { cwd: 'C:\\proj', since: 4800, exclude: new Set(['ses_a', 'ses_b']) }), null);
});

test('discoverAgentSessionId 透传 exclude 给 opencode 发现', async () => {
  const run = async () => ITEMS;
  const id = await discoverAgentSessionId({ agent: { id: 'opencode', cmd: 'opencode' }, cwd: 'C:\\proj', since: 5000, run, exclude: ['ses_b'] });
  assert.equal(id, 'ses_a');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/agent-resume.test.js`
Expected: 新用例 FAIL（`exclude` 未生效，返回 `ses_b`）。

- [ ] **Step 3: 实现**

把 `pickOpencodeSession` 改为：

```js
export function pickOpencodeSession(items, { cwd, since, slackMs = 60000, now = Date.now(), exclude = null } = {}) {
  const dir = normDir(cwd);
  const skip = exclude instanceof Set ? exclude : new Set(Array.isArray(exclude) ? exclude : []);
  let best = null;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== 'string' || !it.id) continue;
    if (skip.has(it.id)) continue;
    if (normDir(it.directory) !== dir) continue;
    const created = Number(it.created);
    if (!Number.isFinite(created)) continue;
    if (created < since - slackMs || created > now + slackMs) continue;
    const d = Math.abs(created - since);
    if (!best || d < best.d) best = { id: it.id, d };
  }
  return best ? best.id : null;
}
```

把 `discoverAgentSessionId` 签名与 opencode 分支改为：

```js
export async function discoverAgentSessionId({ agent, cwd, since, run = defaultRun, exclude = null } = {}) {
  if (!agent) return null;
  if (typeof agent.resumeDiscover === 'string' && agent.resumeDiscover.trim()) {
    const out = await run(agent.resumeDiscover.trim(), { cwd });
    const id = out == null ? '' : String(out).trim();
    return id || null;
  }
  if (agent.id === 'opencode' || agent.cmd === 'opencode') {
    const out = await run('opencode session list --format json -n 30', { cwd });
    if (out == null) return null;
    return pickOpencodeSession(parseSessionList(out), { cwd, since, exclude });
  }
  return null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/agent-resume.test.js`
Expected: PASS（含原有 6 个用例）。

- [ ] **Step 5: 提交**

```powershell
git add server/agent-resume.js server/test/agent-resume.test.js
git commit -m "feat(session): opencode 发现支持排除已认领会话 id"
```

---

## Task 2: 续接认领判定模块

**Files:**
- Create: `server/session-claims.js`
- Test: `server/test/session-claims.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/session-claims.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimedAgentSessionIds, findClaimOwner } from '../session-claims.js';

test('claimedAgentSessionIds：排除自身、忽略空值与无 id 记录', () => {
  const rows = [
    { id: 's_a', agentSessionId: 'ses_1' },
    { id: 's_b', agentSessionId: '' },
    { id: 's_c' },
    { id: 's_d', agentSessionId: 'ses_2' },
  ];
  assert.deepEqual([...claimedAgentSessionIds(rows, 's_a')], ['ses_2']);
  assert.deepEqual([...claimedAgentSessionIds(rows)], ['ses_1', 'ses_2']);
  assert.equal(claimedAgentSessionIds(null).size, 0);
});

test('findClaimOwner：只认在跑且账本 id 一致的会话', () => {
  const ledger = [
    { id: 's_a', agentSessionId: 'ses_1' },
    { id: 's_b', agentSessionId: 'ses_1' },
  ];
  const live = [
    { id: 's_a', state: 'exited' },
    { id: 's_b', state: 'running' },
  ];
  assert.equal(findClaimOwner(live, ledger, 'ses_1')?.id, 's_b');
  assert.equal(findClaimOwner(live, ledger, 'ses_1', 's_b'), null);
  assert.equal(findClaimOwner(live, ledger, 'ses_x'), null);
  assert.equal(findClaimOwner(live, ledger, ''), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/session-claims.test.js`
Expected: FAIL（`Cannot find module '../session-claims.js'`）。

- [ ] **Step 3: 实现**

创建 `server/session-claims.js`：

```js
// 会话续接认领：避免多个 devflow 会话抢占同一个 agent 对话（同一 opencode session）。
export function claimedAgentSessionIds(records, exceptDevflowId = null) {
  const out = new Set();
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || r.id === exceptDevflowId) continue;
    if (typeof r.agentSessionId === 'string' && r.agentSessionId) out.add(r.agentSessionId);
  }
  return out;
}

export function findClaimOwner(liveSessions, records, agentSessionId, exceptDevflowId = null) {
  if (!agentSessionId) return null;
  const byId = new Map();
  for (const r of Array.isArray(records) ? records : []) if (r && r.id) byId.set(r.id, r);
  for (const s of Array.isArray(liveSessions) ? liveSessions : []) {
    if (!s || !s.id || s.id === exceptDevflowId || s.state !== 'running') continue;
    const rec = byId.get(s.id);
    if (rec && rec.agentSessionId === agentSessionId) return s;
  }
  return null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/session-claims.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add server/session-claims.js server/test/session-claims.test.js
git commit -m "feat(session): 续接认领判定（已认领集合/占用者查找）"
```

---

## Task 3: restoreRecord + resumed + 占用退化

**Files:**
- Modify: `server/session-restore.js`
- Modify: `server/session-manager.js`（`summary()` 第 60-64 行；新增 `live()`）
- Test: `server/test/session-restore.test.js`、`server/test/session-manager.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/session-manager.test.js` 末尾追加：

```js
test('summary 带 resumed（仅恢复时置 true）', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({});
  assert.equal(sm.summary(s).resumed, undefined);
  s.resumed = true;
  assert.equal(sm.summary(s).resumed, true);
});

test('live 返回全部会话对象', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  await sm.create({});
  assert.equal(sm.live().length, 1);
});
```

在 `server/test/session-restore.test.js` 顶部 import 改为：

```js
import { restoreSessions, restoreRecord } from '../session-restore.js';
```

并在末尾追加：

```js
test('restoreRecord：可续会话注入续命令且 resumed=true', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_a')]);
  const out = await restoreRecord({ ledger, sessionManager: sm, agents: [{ id: 'opencode', cmd: 'opencode' }], rec: rec('s_a'), resumeDelayMs: 0 });
  assert.equal(out.resumed, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(instances[0].pty.writes.includes('opencode --session ses_1\r'), true);
});

test('restoreRecord：agentSessionId 被占用时退化为原命令且 resumed=false', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_a')]);
  const out = await restoreRecord({
    ledger, sessionManager: sm, agents: [{ id: 'opencode', cmd: 'opencode' }],
    rec: rec('s_a'), resumeDelayMs: 0, isAgentSessionIdTaken: () => true,
  });
  assert.equal(out.resumed, false);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(instances[0].pty.writes.includes('opencode\r'), true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/session-restore.test.js server/test/session-manager.test.js`
Expected: FAIL（`restoreRecord` 未导出、`summary().resumed` 为 undefined、`live` 不存在）。

- [ ] **Step 3: 实现**

`server/session-manager.js` 的 `summary` 与新增 `live`：

```js
  summary(s) {
    return { id: s.id, name: s.name, projectId: s.projectId, state: s.state, cwd: s.cwd,
      cols: s.cols, rows: s.rows, exitCode: s.exitCode,
      kind: s.kind || 'shell', agentId: s.agentId || null, restored: !!s.restored,
      resumed: s.resumed === true ? true : undefined };
  }
  live() { return [...this.sessions.values()]; }
```

把 `server/session-restore.js` 整体替换为：

```js
import fs from 'node:fs';
import { buildResumeCommand } from './agent-resume.js';

// 单条账本记录 → 重建会话：复用 id/createdAt、预填回滚、agent 注入续会话命令。
// 返回 { session, resumed }；resumed 仅在成功注入续会话命令时为 true。
export async function restoreRecord({
  ledger, sessionManager, agents = [], logger = console,
  rec, resumeDelayMs = 1500, exists = fs.existsSync,
  isAgentSessionIdTaken = () => false,
} = {}) {
  if (!rec || !rec.id) throw new Error('bad-record');
  if (rec.kind === 'workflow') throw new Error('workflow-skip');
  if (rec.cwd && !exists(rec.cwd)) throw new Error('cwd-missing');
  const replay = ledger.readLog(rec.id);
  const session = await sessionManager.create({
    id: rec.id, name: rec.name, projectId: rec.projectId, cwd: rec.cwd,
    kind: rec.kind, agentId: rec.agentId, agentCmd: rec.agentCmd,
    cols: rec.cols, rows: rec.rows, createdAt: rec.createdAt,
    replay: replay || null,
  });
  sessionManager.markRestored(session.id);
  const agent = rec.kind === 'agent' ? (agents.find((a) => a.id === rec.agentId) || null) : null;
  let resumeCmd = rec.kind === 'agent' ? buildResumeCommand({ agent, agentSessionId: rec.agentSessionId }) : null;
  // 目标对话已被别的活跃会话占用：不抢，退化为原命令重开
  if (resumeCmd && rec.agentSessionId && isAgentSessionIdTaken(rec.agentSessionId, rec.id)) resumeCmd = null;
  const cmd = resumeCmd || (agent && agent.cmd) || rec.agentCmd || null;
  session.resumed = !!resumeCmd;
  if (cmd) {
    setTimeout(() => { sessionManager.write(session.id, `${cmd}\r`); }, resumeDelayMs);
    logger?.info?.(`session restored with command: ${session.id}`);
  } else {
    logger?.info?.(`session restored: ${session.id}`);
  }
  return { session, resumed: !!resumeCmd };
}

// 启动时按账本重建会话：复用 id/createdAt、预填回滚、agent 注入续会话命令。
export async function restoreSessions({
  ledger, sessionManager, agents = [], logger = console, resumeDelayMs = 1500, exists = fs.existsSync,
} = {}) {
  const records = ledger.read().sessions || [];
  const result = { restored: 0, skipped: [] };
  const isAgentSessionIdTaken = (agentSessionId, exceptDevflowId) => {
    for (const row of records) {
      if (row.id === exceptDevflowId || !row.agentSessionId || row.agentSessionId !== agentSessionId) continue;
      const live = sessionManager.get(row.id);
      if (live && live.state === 'running') return true;
    }
    return false;
  };
  for (const rec of records) {
    if (!rec || !rec.id || rec.kind === 'workflow') continue;
    if (rec.cwd && !exists(rec.cwd)) { result.skipped.push({ id: rec.id, reason: 'cwd-missing' }); continue; }
    try {
      await restoreRecord({ ledger, sessionManager, agents, logger, rec, resumeDelayMs, exists, isAgentSessionIdTaken });
      result.restored += 1;
    } catch (e) {
      const reason = (e && e.message) || 'restore-failed';
      result.skipped.push({ id: rec.id, reason });
      logger?.warn?.('session restore failed', rec.id, reason);
    }
  }
  return result;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/session-restore.test.js server/test/session-manager.test.js`
Expected: PASS（原有用例保持：s_a 续 `opencode --session ses_1`、s_b 无 id 退化为 `opencode`；workflow/cwd 缺失跳过语义不变）。

- [ ] **Step 5: 提交**

```powershell
git add server/session-restore.js server/session-manager.js server/test/session-restore.test.js server/test/session-manager.test.js
git commit -m "feat(session): restoreRecord 返回 resumed 并在对话被占用时退化"
```

---

## Task 4: 协议 C2S.RESTORE + gateway 处理

**Files:**
- Modify: `shared/index.js`、`shared/index.d.ts`
- Modify: `server/ws-gateway.js`（`createGateway` 第 24 行、`ws.on('message')` 第 52-55 行、`handleMessage` 第 71-119 行）
- Modify: `server/test/helpers/test-server.js`
- Test: `server/test/ws-gateway.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/ws-gateway.test.js` 末尾追加：

```js
test('restore：成功 → SESSION_CREATED + REPLAY，summary 带 resumed', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const session = await sm.create({ id: 's_hist01', name: 'hist', kind: 'agent', agentId: 'opencode' });
  session.resumed = true;
  session.ring.push('old-line\n');
  const t = await startTestServer({ sessionManager: sm, restoreSessionById: async (id) => (id === 's_hist01' ? { ok: true, session } : { ok: false, reason: 'not-found' }) });
  try {
    const c = await t.connect();
    c.send(C2S.RESTORE, { sessionId: 's_hist01' });
    const created = await c.wait((m) => m.type === S2C.SESSION_CREATED);
    assert.equal(created.session.id, 's_hist01');
    assert.equal(created.session.resumed, true);
    const replay = await c.wait((m) => m.type === S2C.REPLAY && m.sessionId === 's_hist01');
    assert.ok(replay.data.includes('old-line'));
  } finally {
    await t.stop();
  }
});

test('restore：not-found → ERROR restore-failed', async () => {
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory([])({ cwd: process.cwd() }) });
  const t = await startTestServer({ sessionManager: sm, restoreSessionById: async () => ({ ok: false, reason: 'not-found' }) });
  try {
    const c = await t.connect();
    c.send(C2S.RESTORE, { sessionId: 'ghost' });
    const err = await c.wait((m) => m.type === S2C.ERROR);
    assert.equal(err.code, 'restore-failed');
    assert.equal(err.message, 'not-found');
  } finally {
    await t.stop();
  }
});

test('restore：未注入 restoreSessionById 时回 error', async () => {
  const { t } = await makeHarness();
  try {
    const c = await t.connect();
    c.send(C2S.RESTORE, { sessionId: 'x' });
    const err = await c.wait((m) => m.type === S2C.ERROR);
    assert.equal(err.code, 'restore-failed');
  } finally {
    await t.stop();
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/ws-gateway.test.js`
Expected: FAIL（`C2S.RESTORE` 为 undefined；`startTestServer` 不认识 `restoreSessionById`）。

- [ ] **Step 3: 实现**

`shared/index.js` 的 `C2S` 增加 `RESTORE: 'restore'`：

```js
export const C2S = Object.freeze({
  LIST: 'list', CREATE: 'create', START: 'start', INPUT: 'input',
  RESIZE: 'resize', STOP: 'stop', KILL: 'kill', PING: 'ping', RESTORE: 'restore',
  WF_LIST: 'wf-list', WF_RUN: 'wf-run', WF_NEXT: 'wf-next', WF_ABORT: 'wf-abort',
});
```

`shared/index.d.ts` 的 `C2S` 同步增加 `RESTORE: 'restore';`，`SessionSummary` 增加 `resumed?: boolean;`：

```ts
export declare const C2S: Readonly<{
  LIST: 'list'; CREATE: 'create'; START: 'start'; INPUT: 'input';
  RESIZE: 'resize'; STOP: 'stop'; KILL: 'kill'; PING: 'ping'; RESTORE: 'restore';
  WF_LIST: 'wf-list'; WF_RUN: 'wf-run'; WF_NEXT: 'wf-next'; WF_ABORT: 'wf-abort';
}>;
```

```ts
export interface SessionSummary { id: string; name: string; projectId: string | null; state: 'running' | 'exited'; cwd: string; cols: number; rows: number; exitCode: number | null; kind?: 'agent' | 'shell' | 'workflow'; agentId?: string | null; restored?: boolean; resumed?: boolean; }
```

`server/test/helpers/test-server.js` 改为：

```js
export async function startTestServer({ sessionManager, workflowRunner = null, restoreSessionById = null }) {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const gateway = createGateway({ httpServer: server, sessionManager, workflowRunner, restoreSessionById });
```

`server/ws-gateway.js`：

1. `createGateway` 签名增加参数：

```js
export function createGateway({ httpServer, sessionManager, workflowRunner = null, requireAuthWs = null, restoreSessionById = null, log = console }) {
```

2. `ws.on('message', ...)` 改为异步安全调用：

```js
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      Promise.resolve(handleMessage(conn, msg)).catch((e) => log.error('ws message failed', e));
    });
```

3. `handleMessage` 改为 `async function handleMessage(conn, msg) {`，并在 `case C2S.KILL` 之后插入：

```js
      case C2S.RESTORE: {
        const r = restoreSessionById ? await restoreSessionById(msg.sessionId) : null;
        if (!r || !r.ok) { conn.send({ type: S2C.ERROR, code: 'restore-failed', message: (r && r.reason) || 'not-found' }); break; }
        sessionManager.setActive(r.session.id, conn);
        conn.send({ type: S2C.SESSION_CREATED, session: sessionManager.summary(r.session) });
        replay(conn, r.session);
        break;
      }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/ws-gateway.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add shared/index.js shared/index.d.ts server/ws-gateway.js server/test/helpers/test-server.js server/test/ws-gateway.test.js
git commit -m "feat(session): WS restore 消息与 gateway 处理"
```

---

## Task 5: index.js 接线（发现串行化 + 认领排除 + restoreSessionById）

**Files:**
- Modify: `server/index.js`（imports；`scheduleAgentDiscovery` 第 195-214 行；bundle return 第 323 行；`initWorkspace` 第 335-345 行）

- [ ] **Step 1: 写失败测试（提取后由 index 使用，此处直接单测已有 session-claims 覆盖）**

本任务的纯逻辑已在 Task 2 覆盖；此处先跑全量服务端测试确认基线：

Run: `npm.cmd run test:server`
Expected: PASS（基线）。

- [ ] **Step 2: 实现**

在 `server/index.js` 顶部 import 增加：

```js
import { restoreSessions, restoreRecord } from './session-restore.js';
import { claimedAgentSessionIds, findClaimOwner } from './session-claims.js';
```

（若已有 `import { restoreSessions } from './session-restore.js';`，改为上面的合并写法。）

把 `scheduleAgentDiscovery`（第 195-214 行）替换为：

```js
  let discoveryQueue = Promise.resolve();
  function runDiscovery(session) {
    discoveryQueue = discoveryQueue.then(async () => {
      const cur = sessionManager.get(session.id);
      if (!cur || !cur.alive) return;
      const rows = sessionLedger.read().sessions;
      const already = rows.find((r) => r.id === session.id);
      if (already && already.agentSessionId) return;
      const agent = agentList().find((a) => a.id === session.agentId) || null;
      const exclude = claimedAgentSessionIds(rows, session.id);
      const sid = await discoverAgentSessionId({ agent, cwd: session.cwd, since: session.createdAt, exclude });
      if (!sid) return;
      const fresh = sessionLedger.read().sessions;
      if (claimedAgentSessionIds(fresh, session.id).has(sid)) return;   // 竞态兜底：已被别会话认领
      const row = fresh.find((r) => r.id === session.id);
      if (row) sessionLedger.upsert({ ...row, agentSessionId: sid, updatedAt: Date.now() });
    }).catch(() => { /* 发现失败不影响使用 */ });
  }
  function scheduleAgentDiscovery(session) {
    const known = sessionLedger.read().sessions.find((r) => r.id === session.id);
    if (known && known.agentSessionId) return;
    for (const delay of [15000, 60000]) {
      setTimeout(() => { void runDiscovery(session); }, delay).unref?.();
    }
  }
```

在 `sessionManager.on('removed', ...)` 之后、`setInterval(() => sessionLedger.flushAll(), 10000)` 之前插入：

```js
  function findLiveByAgentSessionId(agentSessionId, exceptDevflowId) {
    return findClaimOwner(sessionManager.live(), sessionLedger.read().sessions, agentSessionId, exceptDevflowId);
  }
  function isAgentSessionIdTaken(agentSessionId, exceptDevflowId) {
    return !!findLiveByAgentSessionId(agentSessionId, exceptDevflowId);
  }
  async function restoreSessionById(id) {
    const live = sessionManager.get(id);
    if (live && live.state === 'running') return { ok: true, session: live, redirected: false };
    const rec = sessionLedger.read().sessions.find((r) => r.id === id);
    if (!rec) return { ok: false, reason: 'not-found' };
    if (rec.agentSessionId) {
      const owner = findClaimOwner(sessionManager.live(), sessionLedger.read().sessions, rec.agentSessionId, id);
      if (owner) return { ok: true, session: owner, redirected: true };
    }
    try {
      const { session } = await restoreRecord({
        ledger: sessionLedger, sessionManager, agents: agentList(), logger: log, rec,
        isAgentSessionIdTaken,
      });
      return { ok: true, session, redirected: false };
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'restore-failed' };
    }
  }
```

在 `buildWorkspace` 的 return（第 323 行）增加 `restoreSessionById`：

```js
  return { projects, saveProjects, workflows, sessionManager, workflowRunner, engine, collabMount, usageMount, usageReporter, scheduler, httpApi, llmMount, translateMount, llmVault, usageStore, taskStore, sessionLedger, historyFile: paths.historyFile, paths, restoreSessionById };
```

在 `initWorkspace`（第 335-345 行）把 gateway 构造与恢复调用改为：

```js
  if (!gateway) {
    gateway = createGateway({ httpServer: server, sessionManager: ws.sessionManager, workflowRunner: ws.workflowRunner, requireAuthWs, log, restoreSessionById: ws.restoreSessionById });
  }
  void restoreSessions({
    ledger: ws.sessionLedger,
    sessionManager: ws.sessionManager,
    agents: loadDevflowConfig(configFile).agents.list || [],
    logger: log,
  }).then((r) => {
```

- [ ] **Step 3: 运行确认通过**

Run: `npm.cmd run test:server`
Expected: PASS。

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 4: 提交**

```powershell
git add server/index.js
git commit -m "feat(session): 发现串行化+认领排除，接线按 id 恢复会话"
```

---

## Task 6: 前端会话树纯函数

**Files:**
- Create: `web/src/sessionTree.ts`
- Test: `web/src/sessionTree.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/sessionTree.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildSessionTree } from './sessionTree';

const m = (over: Record<string, unknown>) => ({ text: 'x', ts: 0, ...over });

describe('buildSessionTree', () => {
  it('按 sessionId 分组，组内倒序，标签取最新 tabName', () => {
    const tree = buildSessionTree([
      m({ text: 'b2', ts: 20, sessionId: 's1', tabName: '新名' }),
      m({ text: 'a1', ts: 10, sessionId: 's2', tabName: 'A' }),
      m({ text: 'b1', ts: 5, sessionId: 's1', tabName: '旧名' }),
    ]);
    expect(tree.map((n) => n.label)).toEqual(['新名', 'A']);
    expect(tree[0].sessionId).toBe('s1');
    expect(tree[0].messages.map((x) => x.text)).toEqual(['b2', 'b1']);
  });

  it('无 sessionId 回退 tabName；两者都无归未知会话且不可恢复', () => {
    const tree = buildSessionTree([
      m({ text: 'n', ts: 3, tabName: 'byName' }),
      m({ text: 'u', ts: 2 }),
    ], '未知会话');
    const byName = tree.find((n) => n.label === 'byName')!;
    expect(byName.sessionId).toBeNull();
    expect(byName.key).toBe('name:byName');
    const unknown = tree.find((n) => n.label === '未知会话')!;
    expect(unknown.sessionId).toBeNull();
    expect(unknown.key).toBe('__unknown__');
  });

  it('组间按组内最新消息时间倒序', () => {
    const tree = buildSessionTree([
      m({ text: 'old', ts: 1, sessionId: 's1' }),
      m({ text: 'new', ts: 9, sessionId: 's2' }),
    ]);
    expect(tree.map((n) => n.sessionId)).toEqual(['s2', 's1']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web test -- src/sessionTree.test.ts`
Expected: FAIL（找不到模块 `./sessionTree`）。

- [ ] **Step 3: 实现**

创建 `web/src/sessionTree.ts`：

```ts
import type { HistoryMessage } from './useMessageHistory';

export interface SessionNode {
  key: string;
  label: string;
  sessionId: string | null;
  messages: HistoryMessage[];
}

const UNKNOWN_KEY = '__unknown__';

// 把历史消息按会话分组：sessionId 优先，其次 tabName，最后归入未知组。
// 组内消息按时间倒序；组间按各自最新消息时间倒序；标签取该组最新的 tabName。
export function buildSessionTree(messages: HistoryMessage[], unknownLabel = 'unknown'): SessionNode[] {
  const groups = new Map<string, { sessionId: string | null; messages: HistoryMessage[] }>();
  for (const msg of messages) {
    const sid = typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : null;
    const name = typeof msg.tabName === 'string' && msg.tabName ? msg.tabName : null;
    const key = sid || (name ? `name:${name}` : UNKNOWN_KEY);
    let g = groups.get(key);
    if (!g) { g = { sessionId: sid, messages: [] }; groups.set(key, g); }
    g.messages.push(msg);
  }
  const nodes: SessionNode[] = [];
  for (const [key, g] of groups) {
    g.messages.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const named = g.messages.find((x) => typeof x.tabName === 'string' && x.tabName);
    nodes.push({ key, label: named?.tabName || g.sessionId || unknownLabel, sessionId: g.sessionId, messages: g.messages });
  }
  nodes.sort((a, b) => (b.messages[0]?.ts || 0) - (a.messages[0]?.ts || 0));
  return nodes;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web test -- src/sessionTree.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add web/src/sessionTree.ts web/src/sessionTree.test.ts
git commit -m "feat(web): 会话树分组纯函数 sessionTree"
```

---

## Task 7: HistoryList 会话树渲染

**Files:**
- Modify: `web/src/components/HistoryList.vue`
- Test: `web/src/components/HistoryList.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/components/HistoryList.test.ts` 末尾（`describe` 内）追加：

```ts
  it('全部会话：渲染会话树，点行展开，打开按钮 emit open-session', async () => {
    const messages = [
      { text: 'm1', ts: 100, sessionId: 's1', tabName: 'A' },
      { text: 'm2', ts: 200, sessionId: 's2', tabName: 'B' },
    ];
    const w = mount({ tab: 'messages', filter: false, messages, liveSessionIds: ['s2'] });
    await w.vm.$nextTick();
    const nodes = w.findAll('.tnode');
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.find('.tname').text())).toEqual(['B', 'A']);
    expect(w.findAll('.mrow')).toHaveLength(0);              // 默认折叠
    await nodes[1].trigger('click');                          // 展开 A
    expect(w.findAll('.mrow')).toHaveLength(1);
    await nodes[1].find('.topen').trigger('click');
    expect(w.emitted('open-session')?.[0]).toEqual(['s1']);
  });

  it('全部会话：无 sessionId 的组禁用打开', async () => {
    const w = mount({ tab: 'messages', filter: false, messages: [{ text: 'x', ts: 1, tabName: 'only' }] });
    await w.vm.$nextTick();
    expect(w.find('.topen').exists()).toBe(false);
  });

  it('仅当前会话：仍是平铺消息', async () => {
    const w = mount({ tab: 'messages', filter: true, messages: [{ text: 'x', ts: 1, tabName: 't' }] });
    await w.vm.$nextTick();
    expect(w.findAll('.tnode')).toHaveLength(0);
    expect(w.findAll('.mrow')).toHaveLength(1);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web test -- src/components/HistoryList.test.ts`
Expected: 新用例 FAIL（无 `.tnode`、无 `open-session`）。

- [ ] **Step 3: 实现**

`web/src/components/HistoryList.vue`：

3a) `<script setup>` 顶部 import 增加：

```ts
import { t } from '../i18n';
import { buildSessionTree, type SessionNode } from '../sessionTree';
```

3b) props 增加 `liveSessionIds`：

```ts
const props = withDefaults(defineProps<{
  items: HistoryEntry[]; tab: 'files' | 'messages'; messages: HistoryMessage[];
  filter?: boolean; liveSessionIds?: string[];
}>(), {
  filter: true,
  liveSessionIds: () => [],
});
```

3c) emits 增加：

```ts
  (e: 'open-session', sessionId: string): void;
```

3d) 在 `const msgRows = computed(...)` 之后追加：

```ts
// —— 全部会话：会话两级目录 ——
const liveSet = computed(() => new Set(props.liveSessionIds || []));
const expanded = ref<Set<string>>(new Set());
function toggleNode(key: string) {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  expanded.value = next;
}
const treeNodes = computed<SessionNode[]>(() => {
  const q = query.value.trim().toLowerCase();
  const all = buildSessionTree(props.messages, t('hist.tree.unknown'));
  if (!q) return all;
  const out: SessionNode[] = [];
  for (const n of all) {
    if (match(n.label, q)) { out.push(n); continue; }
    const msgs = n.messages.filter((m) => match(m.text, q));
    if (msgs.length) out.push({ ...n, messages: msgs });
  }
  return out;
});
const treeTotal = computed(() => treeNodes.value.reduce((sum, n) => sum + n.messages.length, 0));
const treeShown = computed<SessionNode[]>(() => {
  const out: SessionNode[] = [];
  let budget = msgLimit.value;
  for (const n of treeNodes.value) {
    if (budget <= 0) break;
    const take = n.messages.slice(0, budget);
    out.push({ ...n, messages: take });
    budget -= take.length;
  }
  return out;
});
function nodeRows(n: SessionNode) { return withDaySeps(n.messages, (m) => m.ts); }
function openNode(sid: string | null) { if (sid) emit('open-session', sid); }
```

3e) `hasMore` 与 `noMatch` 适配树模式（`filter===false` 时按树统计）：

```ts
const hasMore = computed(() => props.tab === 'files'
  ? fileLimit.value < filteredItems.value.length
  : msgLimit.value < (props.filter ? filteredMessages.value.length : treeTotal.value));
const noMatch = computed(() => {
  if (!searching.value) return false;
  if (props.tab === 'files') return props.items.length > 0 && filteredItems.value.length === 0;
  return props.filter
    ? (props.messages.length > 0 && filteredMessages.value.length === 0)
    : (props.messages.length > 0 && treeTotal.value === 0);
});
```

（删除原先基于 `total/shown` 的 `noMatch` 定义，替换为上面这段。）

3f) 模板消息页签分支（第 154-171 行）替换为：

```html
      <template v-else>
        <div v-if="messages.length === 0" class="empty">{{ $t('hist.empty_messages') }}</div>
        <div v-else-if="noMatch" class="empty">{{ $t('hist.no_match') }}</div>
        <template v-else-if="!filter">
          <div v-for="n in treeShown" :key="n.key" class="tgroup">
            <button class="tnode" @click="toggleNode(n.key)">
              <span class="tcaret">{{ expanded.has(n.key) ? '▾' : '▸' }}</span>
              <span class="tdot" :class="{ live: !!n.sessionId && liveSet.has(n.sessionId) }" />
              <span class="tname">{{ n.label }}</span>
              <span class="tcount">{{ $t('hist.tree.count', { n: n.messages.length }) }}</span>
              <span v-if="n.sessionId" class="topen" :title="$t('hist.tree.open_title')" @click.stop="openNode(n.sessionId)">{{ $t('hist.tree.open') }}</span>
            </button>
            <template v-if="expanded.has(n.key)">
              <template v-for="(row, i) in nodeRows(n)" :key="i">
                <div v-if="'sep' in row" class="daysep">{{ row.sep }}</div>
                <button v-else class="mrow" :class="dayClass(row.item.ts)" :title="row.item.text" @click="emit('open-message', row.item.text)">
                  <span class="ic">💬</span>
                  <span class="mbody">
                    <span class="mtext">{{ row.item.text }}</span>
                    <span class="mmeta"><span v-if="row.item.ts" class="mdate">{{ fmtBelow(row.item.ts) }}</span></span>
                  </span>
                  <span class="x" :title="$t('hist.remove_message')" @click.stop="emit('remove-message', row.item)">×</span>
                </button>
              </template>
            </template>
          </div>
        </template>
        <template v-else>
          <template v-for="(row, i) in msgRows" :key="i">
            <div v-if="'sep' in row" class="daysep">{{ row.sep }}</div>
            <button v-else class="mrow" :class="dayClass(row.item.ts)" :title="row.item.text" @click="emit('open-message', row.item.text)">
              <span class="ic">💬</span>
              <span class="mbody">
                <span class="mtext">{{ row.item.text }}</span>
                <span class="mmeta">
                  <span v-if="row.item.tabName" class="mtab">{{ row.item.tabName }}</span>
                  <span v-if="row.item.ts" class="mdate">{{ fmtBelow(row.item.ts) }}</span>
                </span>
              </span>
              <span class="x" :title="$t('hist.remove_message')" @click.stop="emit('remove-message', row.item)">×</span>
            </button>
          </template>
        </template>
      </template>
```

3g) `<style scoped>` 末尾追加：

```css
.tgroup { border-bottom: 1px solid var(--bd2); }
.tnode { display: flex; align-items: center; gap: 6px; width: 100%; background: none; border: none; text-align: left; padding: 6px 10px; cursor: pointer; }
.tnode:hover { background: var(--bg3); }
.tcaret { color: var(--tx5); font-size: 10px; width: 10px; flex: none; }
.tdot { width: 7px; height: 7px; border-radius: 50%; background: var(--tx6); flex: none; }
.tdot.live { background: var(--ac2); }
.tname { flex: 1; min-width: 0; color: var(--tx1); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tcount { color: var(--tx6); font-size: 10px; flex: none; }
.topen { flex: none; color: var(--tx5); border: 1px solid var(--bd); border-radius: 4px; padding: 0 8px; font-size: 11px; line-height: 16px; }
.topen:hover { color: var(--ac2); border-color: var(--ac2); }
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web test -- src/components/HistoryList.test.ts`
Expected: PASS（含原有 7 个用例）。

- [ ] **Step 5: 提交**

```powershell
git add web/src/components/HistoryList.vue web/src/components/HistoryList.test.ts
git commit -m "feat(web): 历史面板全部会话渲染会话两级目录"
```

---

## Task 8: useTerminal.restoreSession

**Files:**
- Modify: `web/src/useTerminal.ts`
- Test: `web/src/useTerminal.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/useTerminal.test.ts` 的 `describe` 内追加：

```ts
  it('restoreSession 发 restore，收 session-created 解析并带 resumed', async () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const p = hook.term.restoreSession('s_old');
    expect(ws.sent.at(-1)).toMatchObject({ type: C2S.RESTORE, sessionId: 's_old' });
    ws.emitMessage({ type: S2C.SESSION_CREATED, session: { id: 's_old', name: 'A', projectId: null, state: 'running', cwd: '', cols: 80, rows: 24, exitCode: null, restored: true, kind: 'agent', resumed: false } });
    const s = await p;
    expect(s?.resumed).toBe(false);
    expect(hook.term.state.activeSessionId).toBe('s_old');
  });

  it('restoreSession 收 restore-failed 返回 null', async () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const p = hook.term.restoreSession('ghost');
    ws.emitMessage({ type: S2C.ERROR, code: 'restore-failed', message: 'not-found' });
    expect(await p).toBe(null);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web test -- src/useTerminal.test.ts`
Expected: FAIL（`restoreSession` 不是函数）。

- [ ] **Step 3: 实现**

`web/src/useTerminal.ts`：

3a) `SessionSummary` 增加 `resumed?: boolean;`：

```ts
export interface SessionSummary { id: string; name: string; projectId: string | null; state: 'running' | 'exited'; cwd: string; cols: number; rows: number; exitCode: number | null; kind?: 'agent' | 'shell' | 'workflow'; agentId?: string | null; restored?: boolean; resumed?: boolean; }
```

3b) 在 `let createdResolve: ...` 之后增加：

```ts
  let restoreResolve: ((s: SessionSummary | null) => void) | null = null;
```

3c) `SESSION_CREATED` 分支增加恢复解析：

```ts
      case S2C.SESSION_CREATED: {
        state.sessions = state.sessions.filter((s) => s.id !== msg.session.id).concat([msg.session]);
        state.activeSessionId = msg.session.id;
        createdResolve?.(msg.session); createdResolve = null;
        restoreResolve?.(msg.session); restoreResolve = null;
        emit(S2C.SESSION_CREATED, msg); break;
      }
```

3d) `ERROR` 分支增加：

```ts
      case S2C.ERROR:
        state.error = `${msg.code}: ${msg.message}`;
        if (msg.code === 'restore-failed') { restoreResolve?.(null); restoreResolve = null; }
        emit(S2C.ERROR, msg); break;
```

3e) 返回对象里 `switchTo` 之后增加：

```ts
    restoreSession(id: string) {
      send(C2S.RESTORE, { sessionId: id });
      return new Promise<SessionSummary | null>((resolve) => { restoreResolve = resolve; });
    },
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web test -- src/useTerminal.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add web/src/useTerminal.ts web/src/useTerminal.test.ts
git commit -m "feat(web): useTerminal 增加 restoreSession"
```

---

## Task 9: App.vue 接线

**Files:**
- Modify: `web/src/App.vue`（`liveProjectBySession` 第 178-182 行附近；`HistoryList` 模板第 584-587 行）

- [ ] **Step 1: 实现**

1a) 在 `const liveProjectBySession = computed(...)` 之后追加：

```ts
const liveSessionIds = computed(() => terminal.state.sessions.filter((s) => s.state === 'running').map((s) => s.id));
async function openHistorySession(sid: string) {
  const s = await terminal.restoreSession(sid);
  if (s && s.restored && s.kind === 'agent' && s.resumed === false) alert(t('hist.tree.fresh_agent'));
}
```

（`t` 已从 `./i18n` 引入，无需新增 import。）

1b) `HistoryList` 模板增加两个绑定：

```html
          <HistoryList v-if="rail === 'history'" :items="historyItems" :tab="historyTab" :messages="visibleMessages" :filter="msgFilter"
            :live-session-ids="liveSessionIds"
            @update:tab="historyTab = $event" @open="openFromHistory" @remove="(pid, p) => removeFileHistory(pid, p)"
            @clear="clearFileHistory" @open-message="onOpenMessage" @remove-message="(m) => msgHistory.remove(m)"
            @update:filter="msgFilter = $event" @open-session="openHistorySession" />
```

- [ ] **Step 2: 运行确认通过**

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd --prefix web test`
Expected: PASS。

- [ ] **Step 3: 提交**

```powershell
git add web/src/App.vue
git commit -m "feat(web): 历史会话树打开时恢复会话并提示未续上下文"
```

---

## Task 10: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`（`hist.filter.title` 第 337 行之后）
- Modify: `shared/i18n/en.js`（`hist.filter.title` 第 337 行之后）

- [ ] **Step 1: 加词条**

`shared/i18n/zh-CN.js` 在 `'hist.filter.title': ...` 之后插入：

```js
  'hist.tree.open': '打开',
  'hist.tree.open_title': '恢复/切换到该会话',
  'hist.tree.count': '{n} 条',
  'hist.tree.unknown': '未知会话',
  'hist.tree.restore_failed': '恢复失败：{reason}',
  'hist.tree.fresh_agent': '未找到可续对话，已重开会话',
```

`shared/i18n/en.js` 在 `'hist.filter.title': ...` 之后插入：

```js
  'hist.tree.open': 'Open',
  'hist.tree.open_title': 'Restore/switch to this session',
  'hist.tree.count': '{n}',
  'hist.tree.unknown': 'Unknown session',
  'hist.tree.restore_failed': 'Restore failed: {reason}',
  'hist.tree.fresh_agent': 'No resumable conversation found; reopened the session',
```

- [ ] **Step 2: 运行确认通过**

Run: `npm.cmd run check:i18n`
Expected: PASS（中英键集合对称，`web/src` 与 `server` 用户可见范围零中文命中）。

- [ ] **Step 3: 提交**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 历史会话树与恢复提示词条"
```

---

## Task 11: 配置注释与续会话文档

**Files:**
- Modify: `config/devflow.xml`（`<agents>` 第 12 行上方）
- Create: `docs/learn/agent续会话配置.md`

- [ ] **Step 1: 配置注释**

在 `config/devflow.xml` 的 `<agents default="opencode">` 上方插入注释（不改变 agent 标签本身）：

```xml
  <!--
    agents：每个 agent 可选配续会话能力（后端重启或点历史会话「打开」时恢复对话上下文）：
    - resumeDiscover="命令"：在该会话 cwd 下执行，stdout 去空白即 agent 会话 id；缺省仅 opencode 有内建发现。
    - resumeCmd="命令模板"：恢复时注入终端；含 {id} 用发现的 id 替换，不含则原样执行（如 xxx --continue）。
    示例（真值按本机 CLI 填写，勿写密钥）：
      <agent id="claudecode" name="ClaudeCode" cmd="claudecode" resumeCmd="claudecode --resume {id}" resumeDiscover="<列出最近会话 id 的命令>" />
      <agent id="nga" name="nga" cmd="nga.cmd" resumeCmd="nga.cmd --continue" />
    注意：resumeCmd 不含 {id}（如 --continue）时，同目录多会话会都接到「最近一次」，易串台。
    详见 docs/learn/agent续会话配置.md。
  -->
```

- [ ] **Step 2: 写文档**

创建 `docs/learn/agent续会话配置.md`：

```markdown
# Agent 续会话配置

## 背景

DevFlow 在**后端重启**或用户点击历史面板会话树的「打开」时，会按会话账本重建终端：
回滚照常恢复；对 `kind='agent'` 的会话，服务端还会注入一条**续会话命令**，让 agent 继续上一次的对话上下文。

- 账本：`<数据目录>/ports/<端口>/sessions.json`（上限 30 条）；回滚：`session-logs/<id>.log`。
- 活动配置：`<数据目录>/ports/<端口>/downloads/devflow.xml`。
  仓库里的 `config/devflow.xml` 只是**首次启动的 seed 模板**，改它不影响既有实例。

## 机制

恢复时对 agent 会话依次取命令：

1. `buildResumeCommand({ agent, agentSessionId })`：
   - 配了 `resumeCmd`：含 `{id}` → 用发现的 id 替换；不含 → 原样执行；缺 id 且含 `{id}` → 不注入。
   - 未配且是 opencode → `opencode --session <id>`（需要 `agentSessionId`）。
   - 否则 → `null`。
2. 取不到续会话命令 → 退化为该 agent 的原始 `cmd`（**只重开外壳，不续上下文**）。

`agentSessionId` 的来源：

- `resumeDiscover` 配置的命令，stdout 去空白即 id；
- 未配且是 opencode → 内建发现：`opencode session list --format json -n 30`，
  按 `directory === cwd` 且 `created` 落在会话创建时间 ±60s 的项取最接近的 id；
  **会排除已被其它活跃会话认领的 id，且发现串行化**（避免同目录多会话错配）。

## 配置方法

在活动配置 `downloads/devflow.xml` 的 `<agents>` 里给对应 agent 加属性：

```xml
<agent id="claudecode" name="ClaudeCode" cmd="claudecode"
       resumeCmd="claudecode --resume {id}"
       resumeDiscover="<列出最近会话 id 的命令>" />
<agent id="nga" name="nga" cmd="nga.cmd" resumeCmd="nga.cmd --continue" />
```

- opencode 无需配置（内建）。
- `nga`/`claudecode` 的 `resumeCmd`/`resumeDiscover` 真值取决于各自 CLI，请按本机实际填写。
- 改完**重启后端**生效。

## 验证

1. 起一个 agent 会话，聊两句，看 `sessions.json` 该条是否回填了 `agentSessionId`。
2. 重启后端；恢复后确认 agent 里能接着上文。
3. 日志出现「session restored with command」= 续上了；只出现「session restored」= 未续（退化重开）。

## 风险与注意

- **多会话同目录**：`resumeCmd` 不含 `{id}`（如 `--continue`）时，多个会话会都接到「最近一次」→ 串台。
  优先用 `resumeDiscover` + `resumeCmd` 的 `{id}` 精确续接。
- **发现未完成前重启**：`agentSessionId` 仍为空 → 退化重开（点「打开」时会提示「未找到可续对话」）。
- **抢占同一对话**：若目标 `agentSessionId` 已被别的活跃会话占用，恢复**不重建**，改为切到占用者，避免两个终端抢同一对话。
- `resumeDiscover` 执行的是本机 XML 里配置的命令，与 `cmd` 同信任级别；**不要**在 XML 里写任何密钥/令牌。
```

- [ ] **Step 3: 提交**

```powershell
git add config/devflow.xml "docs/learn/agent续会话配置.md"
git commit -m "docs(session): agent 续会话配置说明与模板注释"
```

---

## Task 12: 全量验证与手工回归

**Files:** 无（验证任务）

- [ ] **Step 1: 全量测试**

Run: `npm.cmd test`
Expected: server + web 全部 PASS。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: PASS。

- [ ] **Step 4: 手工验证（dev）**

1. `npm.cmd run dev`（server :33333 + web :5173，日志在 `logs/`）。
2. 打开 http://localhost:5173 ，左侧「历史」→「消息」→ 点「全部会话」：
   - 出现会话两级目录；点一级行展开/折叠二级消息；消息行点开仍送入当前会话。
   - 行尾「打开」：在跑的会话 → 右侧切过去；已退出/已关的会话 → 从账本重建并切过去。
   - 组无 `sessionId` 时不显示「打开」。
   - 「仅当前会话」仍是平铺。
3. 多 agent：开一个 opencode、一个 nga 会话，各聊两句；确认 `sessions.json` 里两条 `agentSessionId` 不重复（nga 无则为空）。
4. 重启后端（Ctrl-C 后重跑 `npm.cmd run dev`），确认恢复后 opencode 能接上文；nga 若未配 `resumeCmd` 则重开（预期）。
5. 用会话树「打开」一个已退出的 opencode 会话：若其 `agentSessionId` 已被活跃会话占用，应切到占用者而非新建。

- [ ] **Step 5: 提交（如手工验证中有小修正）**

```powershell
git add <具体文件>
git commit -m "fix(session): 手工回归修正"
```

---

## 自查记录

- **Spec 覆盖**：§3.1→Task 6；§3.2→Task 7；§3.3→Task 8；§3.4→Task 9；§4.1→Task 4；§4.2→Task 1；§4.3→Task 2+5；§4.4→Task 3；§4.5→Task 4；§5→Task 11；§6→Task 10；§7 边界→Task 3/4/5 用例；§8→各 Task 测试 + Task 12。
- **占位符**：无 TBD/TODO；每个代码步骤给出完整代码。
- **类型/命名一致**：`restoreRecord`/`resumeDelayMs`/`isAgentSessionIdTaken`/`resumed`/`claimedAgentSessionIds`/`findClaimOwner`/`buildSessionTree`/`SessionNode`/`restoreSession`/`openHistorySession`/`liveSessionIds`/`nodeRows` 前后一致。
