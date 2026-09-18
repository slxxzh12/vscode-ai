# 会话列表展示与恢复修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让左侧「历史 → 消息 → 全部会话」列出运行中/账本里的会话（即使没有历史消息），关闭会话不再删除账本记录，账本没有记录时点「打开」能重建同 id 会话，默认只展示 30 个会话。

**Architecture:** 服务端 `SessionManager.kill` 不再删除账本条目（改为标记 `exited` + flush 回滚日志），启动恢复只重建 `state==='running'` 的会话；新增 `GET /api/sessions` 暴露账本（≤30 条）；`C2S.RESTORE` 在账本无记录时用 `{ sessionId, name }` 重建同 id shell 会话并回 `recreated`。前端新增账本会话来源，与历史消息、运行中会话在 `buildSessionTree` 中合并去重，节点上限 30；「打开」把节点标签作为 `name` 一起发给服务端。

**Tech Stack:** Node ESM（ws + node-pty）、Vue3 + TS + Vitest、`@devflow/shared` 协议常量、`shared/i18n` 词条。

---

## 背景（现状与根因）

- 「全部会话」列表来自历史消息反推的会话：`buildSessionTree(props.messages)`（`web/src/components/HistoryList.vue:132`、`web/src/sessionTree.ts:14`）。新建会话在发出第一条消息前没有历史消息 → 不出现。
- 点「打开」走 `C2S.RESTORE` → `restoreSessionById`（`server/index.js:262`）。账本 `sessions.json` 没有该 id 时回 `restore-failed: not-found`。
- 根因：关闭终端页签 → `killSession`（`web/src/components/TerminalView.vue:863`）→ 服务端 `kill`（`server/session-manager.js:107`）→ 触发 `removed` → `sessionLedger.remove(id)`（`server/index.js:255`）删掉账本条目。历史消息不删，于是列表里看得到却恢复不了。

## 决策（已与用户确认）

1. 打开时账本没有 → 按 `sessionId/tabName` 重建同 id 会话（无上下文续接，给提示）。
2. 「全部会话」也列出运行中/账本里的会话（即使没有历史消息），可点开。
3. 关闭会话不删记录；列表默认最多展示 30 个会话（沿用账本 `MAX_SESSIONS=30` 作为存储上限）。

## 文件结构

**服务端（修改）**
- `server/session-ledger.js`：新增 `close(id)`（flush 回滚日志 + 丢弃内存缓冲，保留文件与记录）。
- `server/session-restore.js`：`restoreSessions` 跳过 `state === 'exited'` 的记录。
- `server/index.js`：`removed` 处理器改为 `close` + 标记 `exited`；`restoreSessionById(id, { name })` 支持账本缺失时重建；`createHttpApi` 传 `sessionLedger`。
- `server/http-api.js`：新增 `GET /api/sessions`。
- `server/ws-gateway.js`：`C2S.RESTORE` 透传 `name`，响应带 `recreated`。

**前端（修改）**
- `shared/index.d.ts`、`web/src/useTerminal.ts`：`SessionSummary` 增 `recreated?: boolean`。
- `web/src/useTerminal.ts`：`restoreSession(id, { name })`。
- `web/src/sessionRestore.ts`：新增 `onRecreated` 回调。
- `web/src/sessionTree.ts`：`buildSessionTree` 合并会话来源（extras）+ 上限 30。
- `web/src/components/HistoryList.vue`：新增 `sessions` prop、空态、`open-session` 带 name。
- `web/src/App.vue`：加载账本会话、合并 extras、接线。
- `web/src/ledgerSessions.ts`（新建）：拉取 `/api/sessions`。
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js`：新增 `hist.tree.recreated`。

**测试**
- `server/test/session-ledger.test.js`、`server/test/session-restore.test.js`、`server/test/ws-gateway.test.js`
- `web/src/sessionTree.test.ts`、`web/src/sessionRestore.test.ts`、`web/src/useTerminal.test.ts`、`web/src/components/HistoryList.test.ts`

---

## Task 1: 服务端 — kill 不再删除账本记录

**Files:**
- Modify: `server/session-ledger.js`
- Modify: `server/session-restore.js:51-53`
- Modify: `server/index.js:255`
- Test: `server/test/session-ledger.test.js`, `server/test/session-restore.test.js`

- [ ] **Step 1: 写失败测试（ledger.close 保留记录与日志文件）**

在 `server/test/session-ledger.test.js` 末尾追加：

```js
test('close 落盘回滚并丢内存缓冲，但保留记录与日志文件', () => {
  const dir = tmpDir();
  const ledger = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  ledger.upsert(entry('s1'));
  ledger.appendLog('s1', 'hello\n');
  ledger.close('s1');
  assert.equal(ledger.read().sessions.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'session-logs', 's1.log'), 'utf8'), 'hello\n');
  const fresh = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  assert.equal(fresh.readLog('s1'), 'hello\n');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/session-ledger.test.js"`
Expected: FAIL（`ledger.close is not a function`）

- [ ] **Step 3: 实现 `close`**

`server/session-ledger.js` 在 `remove` 之前插入：

```js
  // 关闭会话（kill）：把回滚落盘后丢内存缓冲，但保留记录与日志文件（供历史恢复）。
  function close(id) {
    flushLog(id);
    buffers.delete(id);
    dirty.delete(id);
  }
```

并把返回值改为：

```js
  return { read: store.read, upsert, remove, close, appendLog, flushLog, flushAll, readLog };
```

- [ ] **Step 4: 写失败测试（restoreSessions 跳过 exited）**

在 `server/test/session-restore.test.js` 末尾追加：

```js
test('恢复：state=exited 的记录跳过（关闭的会话不随启动自动拉起）', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_live'), rec('s_closed', { state: 'exited' })]);
  const res = await restoreSessions({ ledger, sessionManager: sm, agents: [], resumeDelayMs: 0 });
  assert.equal(res.restored, 1);
  assert.equal(sm.list().length, 1);
  assert.equal(sm.get('s_live') !== null, true);
  assert.equal(sm.get('s_closed'), null);
});
```

- [ ] **Step 5: 运行测试确认失败**

Run: `node --test "server/test/session-restore.test.js"`
Expected: FAIL（`restored` 为 2）

- [ ] **Step 6: 实现跳过 exited**

`server/session-restore.js` 的 `for (const rec of records)` 循环体第一行后（`if (!rec || ...)` 之后）插入：

```js
    if (rec.state === 'exited') continue;
```

- [ ] **Step 7: 接线 `removed` → close + 标记 exited**

`server/index.js:255` 把：

```js
  sessionManager.on('removed', (id) => sessionLedger.remove(id));
```

改为：

```js
  sessionManager.on('removed', (id) => {
    sessionLedger.close(id);
    const row = sessionLedger.read().sessions.find((r) => r.id === id);
    if (row) sessionLedger.upsert({ ...row, state: 'exited', updatedAt: Date.now() });
  });
```

- [ ] **Step 8: 运行服务端测试**

Run: `npm.cmd run test:server`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/session-ledger.js server/session-restore.js server/index.js server/test/session-ledger.test.js server/test/session-restore.test.js
git commit -m "fix(session): 关闭会话不再删账本记录，启动恢复跳过 exited"
```

---

## Task 2: 服务端 — `GET /api/sessions` 暴露账本

**Files:**
- Modify: `server/http-api.js:46`、`server/http-api.js:266` 附近
- Modify: `server/index.js:365`
- Test: `server/test/http-api-sessions.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/test/http-api-sessions.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHttpApi } from '../http-api.js';

function call(handler, path) {
  return new Promise((resolve) => {
    const req = { url: path, method: 'GET', headers: {} };
    const res = {
      statusCode: 0, body: '',
      writeHead(code) { this.statusCode = code; return this; },
      end(body) { this.body = body || ''; resolve(this); },
    };
    handler(req, res);
  });
}

test('GET /api/sessions 返回账本会话', async () => {
  const sessionLedger = { read: () => ({ sessions: [{ id: 's1', name: 'A', state: 'exited' }] }) };
  const handler = createHttpApi({ projects: { listProjects: () => [] }, sessionLedger });
  const res = await call(handler, '/api/sessions');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).sessions.map((s) => s.id), ['s1']);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/http-api-sessions.test.js"`
Expected: FAIL（返回 404 / 无 `sessions`）

- [ ] **Step 3: 实现路由**

`server/http-api.js:46` 的 `createHttpApi` 解构参数里，在 `sessionProjects = createSessionProjects({}),` 后加：

```js
  sessionLedger = null,
```

在 `/api/session-projects` 路由（`server/http-api.js:266`）之前插入：

```js
      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        sendJson(res, 200, { sessions: sessionLedger ? sessionLedger.read().sessions : [] });
        return;
      }
```

- [ ] **Step 4: 接线 index.js**

`server/index.js:365` 的 `createHttpApi({ ... })` 参数里，`sessionProjects,` 后加：

```js
  sessionLedger,
```

（`sessionLedger` 已在 `server/index.js:207` 定义。）

- [ ] **Step 5: 运行测试**

Run: `node --test "server/test/http-api-sessions.test.js"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/http-api.js server/index.js server/test/http-api-sessions.test.js
git commit -m "feat(server): 新增 GET /api/sessions 暴露会话账本"
```

---

## Task 3: 服务端 — 账本缺失时重建同 id 会话

**Files:**
- Modify: `server/index.js:262-280`
- Modify: `server/ws-gateway.js:112-119`
- Test: `server/test/ws-gateway.test.js`

- [ ] **Step 1: 写失败测试（RESTORE 透传 name、响应带 recreated）**

在 `server/test/ws-gateway.test.js` 的 `restore：not-found` 测试之后追加：

```js
test('restore：透传 name，recreated 时响应带标记', async () => {
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory([])({ cwd: process.cwd() }) });
  const seen = [];
  const session = await sm.create({ id: 's_new', name: '重建', kind: 'shell' });
  const t = await startTestServer({ sessionManager: sm, restoreSessionById: async (id, opts) => { seen.push({ id, opts }); return { ok: true, session, recreated: true }; } });
  try {
    const c = await t.connect();
    c.send(C2S.RESTORE, { sessionId: 's_new', name: '重建' });
    const created = await c.wait((m) => m.type === S2C.SESSION_CREATED);
    assert.deepEqual(seen, [{ id: 's_new', opts: { name: '重建' } }]);
    assert.equal(created.session.recreated, true);
  } finally {
    await t.stop();
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/ws-gateway.test.js"`
Expected: FAIL（`seen` 里 opts 为 undefined，或 session 无 recreated）

- [ ] **Step 3: 实现 ws-gateway**

`server/ws-gateway.js:112-119` 改为：

```js
      case C2S.RESTORE: {
        const r = restoreSessionById ? await restoreSessionById(msg.sessionId, { name: msg.name }) : null;
        if (!r || !r.ok) { conn.send({ type: S2C.ERROR, code: 'restore-failed', message: (r && r.reason) || 'not-found' }); break; }
        sessionManager.setActive(r.session.id, conn);
        const summary = sessionManager.summary(r.session);
        if (r.recreated) summary.recreated = true;
        conn.send({ type: S2C.SESSION_CREATED, session: summary });
        replay(conn, r.session);
        break;
      }
```

- [ ] **Step 4: 实现 index.js 重建分支**

`server/index.js:262` 的 `restoreSessionById` 改为：

```js
  async function restoreSessionById(id, { name } = {}) {
    const live = sessionManager.get(id);
    if (live && live.state === 'running') return { ok: true, session: live, redirected: false };
    const rec = sessionLedger.read().sessions.find((r) => r.id === id);
    if (!rec) {
      const projectId = sessionProjects.read()[id] || null;
      const session = await sessionManager.create({ id, name: name || id, projectId, kind: 'shell' });
      return { ok: true, session, recreated: true };
    }
    if (rec.agentSessionId) {
      const owner = findLiveByAgentSessionId(rec.agentSessionId, id);
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

- [ ] **Step 5: 运行测试**

Run: `node --test "server/test/ws-gateway.test.js"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/ws-gateway.js server/test/ws-gateway.test.js
git commit -m "feat(session): 账本缺失时按 name 重建同 id 会话并回 recreated"
```

---

## Task 4: 前端 — 协议类型与 restoreSession 透传 name

**Files:**
- Modify: `shared/index.d.ts:17`
- Modify: `web/src/useTerminal.ts:5,128-131`
- Test: `web/src/useTerminal.test.ts`

- [ ] **Step 1: 写失败测试**

`web/src/useTerminal.test.ts` 在 `restoreSession 发 restore` 测试之后追加：

```ts
  it('restoreSession 透传 name，recreated 标记透传', async () => {
    hook.term.connect();
    const ws = hook.sockets[0];
    ws.emitOpen();
    const p = hook.term.restoreSession('s_gone', { name: '旧会话' });
    expect(ws.sent.at(-1)).toMatchObject({ type: C2S.RESTORE, sessionId: 's_gone', name: '旧会话' });
    ws.emitMessage({ type: S2C.SESSION_CREATED, session: { id: 's_gone', name: '旧会话', projectId: null, state: 'running', cwd: '', cols: 80, rows: 24, exitCode: null, recreated: true } });
    const s = await p;
    expect(s?.recreated).toBe(true);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run web/src/useTerminal.test.ts`
Expected: FAIL（`name` 未发送）

- [ ] **Step 3: 实现类型与实现**

`shared/index.d.ts:17` 的 `SessionSummary` 末尾 `resumed?: boolean;` 改为：

```ts
resumed?: boolean; recreated?: boolean; }
```

`web/src/useTerminal.ts:5` 的接口末尾 `resumed?: boolean; }` 改为：

```ts
resumed?: boolean; recreated?: boolean; }
```

`web/src/useTerminal.ts:128-131` 改为：

```ts
    restoreSession(id: string, opts: { name?: string } = {}) {
      send(C2S.RESTORE, { sessionId: id, name: opts.name });
      return new Promise<SessionSummary | null>((resolve) => { restoreResolve = resolve; });
    },
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run web/src/useTerminal.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/index.d.ts web/src/useTerminal.ts web/src/useTerminal.test.ts
git commit -m "feat(web): restoreSession 透传 name，SessionSummary 带 recreated"
```

---

## Task 5: 前端 — sessionTree 合并会话来源并限 30

**Files:**
- Modify: `web/src/sessionTree.ts`
- Test: `web/src/sessionTree.test.ts`

- [ ] **Step 1: 写失败测试**

`web/src/sessionTree.test.ts` 末尾追加：

```ts
  it('合并会话来源：无消息的会话也生成节点，标签取 name', () => {
    const tree = buildSessionTree(
      [m({ text: 'x', ts: 10, sessionId: 's1', tabName: 'A' })],
      '未知会话',
      [{ id: 's2', name: 'B', updatedAt: 20 }, { id: 's1', name: 'A-live', updatedAt: 30 }],
    );
    expect(tree.map((n) => n.label)).toEqual(['A', 'B']);
    expect(tree.find((n) => n.sessionId === 's2')!.messages).toEqual([]);
  });

  it('默认最多 30 个会话节点', () => {
    const msgs = Array.from({ length: 40 }, (_, i) => m({ text: 'x', ts: i + 1, sessionId: `s${i}` }));
    expect(buildSessionTree(msgs).length).toBe(30);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run web/src/sessionTree.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`web/src/sessionTree.ts` 全量替换为：

```ts
import type { HistoryMessage } from './useMessageHistory';

export interface SessionExtra { id: string; name?: string; updatedAt?: number; }
export interface SessionNode {
  key: string;
  label: string;
  sessionId: string | null;
  messages: HistoryMessage[];
  sortTs: number;
}

const UNKNOWN_KEY = '__unknown__';
export const MAX_SESSION_NODES = 30;

// 把历史消息按会话分组（sessionId 优先，其次 tabName，最后未知组），并合并「运行中/账本」
// 会话来源（extras，按 id 去重）：即使没有历史消息也生成节点，可被打开。
// 组内消息倒序；组间按 (最新消息 ts, extra.updatedAt) 取大者倒序；默认最多 MAX_SESSION_NODES 个。
export function buildSessionTree(
  messages: HistoryMessage[],
  unknownLabel = 'unknown',
  extras: SessionExtra[] = [],
  limit = MAX_SESSION_NODES,
): SessionNode[] {
  const groups = new Map<string, { sessionId: string | null; messages: HistoryMessage[]; extra?: SessionExtra }>();
  for (const msg of messages) {
    const sid = typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : null;
    const name = typeof msg.tabName === 'string' && msg.tabName ? msg.tabName : null;
    const key = sid || (name ? `name:${name}` : UNKNOWN_KEY);
    let g = groups.get(key);
    if (!g) { g = { sessionId: sid, messages: [] }; groups.set(key, g); }
    g.messages.push(msg);
  }
  for (const ex of extras) {
    if (!ex || typeof ex.id !== 'string' || !ex.id) continue;
    let g = groups.get(ex.id);
    if (!g) { g = { sessionId: ex.id, messages: [] }; groups.set(ex.id, g); }
    g.extra = ex;
  }
  const nodes: SessionNode[] = [];
  for (const [key, g] of groups) {
    g.messages.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const named = g.messages.find((x) => typeof x.tabName === 'string' && x.tabName);
    const latest = g.messages[0]?.ts || 0;
    const extraTs = g.extra?.updatedAt || 0;
    nodes.push({
      key,
      label: named?.tabName || g.extra?.name || g.sessionId || unknownLabel,
      sessionId: g.sessionId,
      messages: g.messages,
      sortTs: Math.max(latest, extraTs),
    });
  }
  nodes.sort((a, b) => (b.sortTs || 0) - (a.sortTs || 0));
  return nodes.slice(0, limit);
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run web/src/sessionTree.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/sessionTree.ts web/src/sessionTree.test.ts
git commit -m "feat(web): sessionTree 合并会话来源并默认限 30 个"
```

---

## Task 6: 前端 — ledgerSessions 拉取账本

**Files:**
- Create: `web/src/ledgerSessions.ts`
- Test: `web/src/ledgerSessions.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `web/src/ledgerSessions.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeLedgerSessions, fetchLedgerSessions } from './ledgerSessions';

afterEach(() => { vi.restoreAllMocks(); });

describe('ledgerSessions', () => {
  it('normalize 丢弃非法项', () => {
    expect(normalizeLedgerSessions({ sessions: [{ id: 's1', name: 'A', state: 'exited' }, null, { id: '' }] }).map((s) => s.id)).toEqual(['s1']);
    expect(normalizeLedgerSessions('nope')).toEqual([]);
  });

  it('fetch 命中返回数组，异常返回空数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's1', name: 'A' }] }) })));
    expect((await fetchLedgerSessions()).map((s) => s.id)).toEqual(['s1']);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    expect(await fetchLedgerSessions()).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run web/src/ledgerSessions.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

新建 `web/src/ledgerSessions.ts`：

```ts
import { ref } from 'vue';

// 服务端会话账本（<端口数据目录>/sessions.json，≤30 条）：含已关闭的会话。
// 历史面板「全部会话」用它把没有历史消息的会话也列出来。
export interface LedgerSession {
  id: string; name: string; projectId: string | null;
  kind?: string; agentId?: string | null;
  state: 'running' | 'exited';
  createdAt?: number; updatedAt?: number;
}

const sessions = ref<LedgerSession[]>([]);
let loadPromise: Promise<void> | null = null;

export function normalizeLedgerSessions(input: unknown): LedgerSession[] {
  const list = input && typeof input === 'object' && !Array.isArray(input) ? (input as { sessions?: unknown }).sessions : null;
  if (!Array.isArray(list)) return [];
  const out: LedgerSession[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) continue;
    out.push({
      id: o.id,
      name: typeof o.name === 'string' && o.name ? o.name : o.id,
      projectId: typeof o.projectId === 'string' ? o.projectId : null,
      kind: typeof o.kind === 'string' ? o.kind : undefined,
      agentId: typeof o.agentId === 'string' ? o.agentId : null,
      state: o.state === 'exited' ? 'exited' : 'running',
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : undefined,
      updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : undefined,
    });
  }
  return out;
}

export async function fetchLedgerSessions(): Promise<LedgerSession[]> {
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) return [];
    return normalizeLedgerSessions(await res.json());
  } catch { return []; }
}

export function useLedgerSessions() {
  async function load(force = false): Promise<void> {
    if (loadPromise && !force) return loadPromise;
    loadPromise = (async () => { sessions.value = await fetchLedgerSessions(); })();
    return loadPromise;
  }
  return { sessions, load };
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run web/src/ledgerSessions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/ledgerSessions.ts web/src/ledgerSessions.test.ts
git commit -m "feat(web): 新增账本会话拉取 ledgerSessions"
```

---

## Task 7: 前端 — HistoryList 渲染账本会话

**Files:**
- Modify: `web/src/components/HistoryList.vue:5,9-14,23,132-143,157,198-241`
- Test: `web/src/components/HistoryList.test.ts`

- [ ] **Step 1: 写失败测试**

`web/src/components/HistoryList.test.ts` 末尾追加，并修改既有断言：

把「全部会话：渲染会话树」里的：

```ts
    expect(w.emitted('open-session')?.[0]).toEqual(['s1']);
```

改为：

```ts
    expect(w.emitted('open-session')?.[0]).toEqual(['s1', 'A']);
```

追加：

```ts
  it('全部会话：账本/运行中的空会话也展示且可打开', async () => {
    const w = mount({ tab: 'messages', filter: false, messages: [], sessions: [{ id: 's9', name: '空会话' }] });
    await w.vm.$nextTick();
    expect(w.findAll('.tnode')).toHaveLength(1);
    expect(w.find('.tname').text()).toBe('空会话');
    expect(w.find('.tcount').exists()).toBe(false);
    await w.find('.topen').trigger('click');
    expect(w.emitted('open-session')?.[0]).toEqual(['s9', '空会话']);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run web/src/components/HistoryList.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`web/src/components/HistoryList.vue` 的 import 行改为：

```ts
import { buildSessionTree, type SessionNode, type SessionExtra } from '../sessionTree';
```

props 增加（在 `liveSessionIds?: string[];` 后）：

```ts
  sessions?: SessionExtra[];
```

默认值（在 `liveSessionIds: () => [],` 后）：

```ts
  sessions: () => [],
```

emit 签名改为：

```ts
  (e: 'open-session', sessionId: string, name: string): void;
```

`treeNodes` 改为：

```ts
const treeNodes = computed<SessionNode[]>(() => {
  const q = query.value.trim().toLowerCase();
  const all = buildSessionTree(props.messages, t('hist.tree.unknown'), props.sessions);
  if (!q) return all;
  const out: SessionNode[] = [];
  for (const n of all) {
    if (match(n.label, q)) { out.push(n); continue; }
    const msgs = n.messages.filter((m) => match(m.text, q));
    if (msgs.length) out.push({ ...n, messages: msgs });
  }
  return out;
});
```

`openNode` 改为：

```ts
function openNode(n: SessionNode) { if (n.sessionId) emit('open-session', n.sessionId, n.label); }
```

模板里「消息」页签的整段（`HistoryList.vue` 当前 `198-241` 行，从 `<div v-if="messages.length === 0" ...>` 到平铺分支的 `</template>`）整体替换为：

```html
        <template v-if="!filter">
          <div v-if="treeNodes.length === 0" class="empty">{{ $t('hist.empty_messages') }}</div>
          <div v-else-if="noMatch" class="empty">{{ $t('hist.no_match') }}</div>
          <template v-else>
            <div v-for="n in treeShown" :key="n.key" class="tgroup">
              <button class="tnode" @click="toggleNode(n.key)">
                <span class="tcaret">{{ n.messages.length ? (expanded.has(n.key) ? '▾' : '▸') : '' }}</span>
                <span class="tdot" :class="{ live: !!n.sessionId && liveSet.has(n.sessionId) }" />
                <span class="tname">{{ n.label }}</span>
                <span v-if="n.messages.length" class="tcount">{{ $t('hist.tree.count', { n: n.messages.length }) }}</span>
                <span v-if="n.sessionId" class="topen" :title="$t('hist.tree.open_title')" @click.stop="openNode(n)">{{ $t('hist.tree.open') }}</span>
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
        </template>
        <template v-else>
          <div v-if="messages.length === 0" class="empty">{{ $t('hist.empty_messages') }}</div>
          <div v-else-if="noMatch" class="empty">{{ $t('hist.no_match') }}</div>
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
```

`noMatch` 改为：

```ts
const noMatch = computed(() => {
  if (!searching.value) return false;
  if (props.tab === 'files') return props.items.length > 0 && filteredItems.value.length === 0;
  return props.filter
    ? (props.messages.length > 0 && filteredMessages.value.length === 0)
    : ((props.messages.length > 0 || props.sessions.length > 0) && treeNodes.value.length === 0);
});
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run web/src/components/HistoryList.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/HistoryList.vue web/src/components/HistoryList.test.ts
git commit -m "feat(web): 全部会话渲染账本/运行中会话并带 name 打开"
```

---

## Task 8: 前端 — App 接线账本来源与重建提示

**Files:**
- Modify: `web/src/sessionRestore.ts:12-27`
- Modify: `web/src/App.vue:22-26,173-201,530,615-619`
- Modify: `shared/i18n/zh-CN.js`, `shared/i18n/en.js`
- Test: `web/src/sessionRestore.test.ts`

- [ ] **Step 1: 写失败测试**

`web/src/sessionRestore.test.ts` 末尾追加：

```ts
  it('账本缺失重建（recreated）时激活并提示', async () => {
    const activate = vi.fn();
    const onRecreated = vi.fn();
    await openRestoredSession('s1', {
      restore: async () => s('s1', { recreated: true }),
      activate,
      error: () => '',
      onFailed: vi.fn(),
      onFreshAgent: vi.fn(),
      onRecreated,
    });
    expect(activate).toHaveBeenCalledWith('s1');
    expect(onRecreated).toHaveBeenCalledTimes(1);
  });
```

（既有 4 个用例的 `openRestoredSession(...)` deps 里补 `onRecreated: vi.fn(),`。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run web/src/sessionRestore.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 sessionRestore**

`web/src/sessionRestore.ts` 的 deps 接口与实现改为：

```ts
export interface OpenRestoredSessionDeps {
  restore: (sessionId: string) => Promise<SessionSummary | null>;
  activate: (sessionId: string) => void;
  error: () => string;
  onFailed: (reason: string) => void;
  onFreshAgent: () => void;
  onRecreated: () => void;
}

// 打开历史会话：恢复成功后必须显式激活中心页签，不能只依赖 activeSessionId 变化触发 watcher。
// 再次打开当前活动会话时 id 不变，watcher 不触发 → 右侧会一直停在文件页签，看不到会话。
export async function openRestoredSession(sessionId: string, deps: OpenRestoredSessionDeps): Promise<SessionSummary | null> {
  const s = await deps.restore(sessionId);
  if (!s) { deps.onFailed(deps.error() || 'restore-failed'); return null; }
  deps.activate(s.id);
  if (s.recreated) deps.onRecreated();
  else if (s.restored && s.kind === 'agent' && s.resumed === false) deps.onFreshAgent();
  return s;
}
```

- [ ] **Step 4: 加 i18n 词条**

`shared/i18n/zh-CN.js` 在 `'hist.tree.fresh_agent': ...` 后加：

```js
  'hist.tree.recreated': '原会话记录已不存在，已新建同名会话（无上下文）',
```

`shared/i18n/en.js` 同位置加：

```js
  'hist.tree.recreated': 'Original session record is gone; opened a new session (no context)',
```

- [ ] **Step 5: 接线 App.vue**

`web/src/App.vue:25` 后加 import：

```ts
import { useLedgerSessions } from './ledgerSessions';
import type { SessionExtra } from './sessionTree';
```

在 `const { map: sessionProjectMap, load: loadSessionProjects } = useSessionProjects();`（`App.vue:177`）后加：

```ts
const { sessions: ledgerSessions, load: loadLedgerSessions } = useLedgerSessions();
const sessionExtras = computed<SessionExtra[]>(() => {
  const byId = new Map<string, SessionExtra>();
  for (const s of ledgerSessions.value) byId.set(s.id, { id: s.id, name: s.name, updatedAt: s.updatedAt });
  for (const s of terminal.state.sessions) if (!byId.has(s.id)) byId.set(s.id, { id: s.id, name: s.name });
  return [...byId.values()];
});
```

`openHistorySession`（`App.vue:193-201`）改为：

```ts
async function openHistorySession(sid: string, name?: string) {
  await openRestoredSession(sid, {
    restore: (id) => terminal.restoreSession(id, { name }),
    activate: (id) => center.activateSession(id),
    error: () => terminal.state.error,
    onFailed: (reason) => alert(t('hist.tree.restore_failed', { reason })),
    onFreshAgent: () => alert(t('hist.tree.fresh_agent')),
    onRecreated: () => alert(t('hist.tree.recreated')),
  });
}
```

`onMounted`（`App.vue:530` 附近）在 `void loadSessionProjects();` 后加：

```ts
  void loadLedgerSessions();
```

新增 watch（放在 `openHistorySession` 定义之后即可）：

```ts
// 会话集合变化（新建/退出/关闭）后刷新账本，保证「全部会话」能列出已关闭会话
watch(() => terminal.state.sessions.map((s) => s.id).join(','), () => { void loadLedgerSessions(true); });
```

模板 `HistoryList`（`App.vue:615-619`）增加 `:sessions`：

```html
          <HistoryList v-if="rail === 'history'" :items="historyItems" :tab="historyTab" :messages="visibleMessages" :filter="msgFilter"
            :live-session-ids="liveSessionIds" :sessions="sessionExtras"
            @update:tab="historyTab = $event" @open="openFromHistory" @remove="(pid, p) => removeFileHistory(pid, p)"
            @clear="clearFileHistory" @open-message="onOpenMessage" @remove-message="(m) => msgHistory.remove(m)"
            @update:filter="msgFilter = $event" @open-session="openHistorySession" />
```

- [ ] **Step 6: 运行测试与类型检查**

Run: `npx vitest run web/src/sessionRestore.test.ts`
Expected: PASS
Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/sessionRestore.ts web/src/sessionRestore.test.ts web/src/App.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 全部会话接入账本来源，重建会话时提示"
```

---

## Task 9: 全量验证

- [ ] **Step 1: 跑全部测试与检查**

Run: `npm.cmd test`
Expected: PASS
Run: `npm.cmd run typecheck`
Expected: PASS
Run: `npm.cmd run check:i18n`
Expected: 零命中

- [ ] **Step 2: 手工验证（dev 33333）**

1. `npm.cmd run dev`，打开 http://localhost:5173 。
2. 新建一个会话，**不发任何消息** → 左侧「历史 → 消息 → 全部会话」应立刻出现该会话（灰点，0 条，可点「打开」）。
3. 在该会话发一条消息 → 节点出现「1 条」，展开可见消息。
4. 关闭该会话页签（确认关闭）→ 刷新页面 → 「全部会话」里仍能看到它（灰点），点「打开」应重新拉起（同 id，无上下文）并提示 `hist.tree.recreated`（若账本已有记录则正常恢复，不提示）。
5. 重启后端 → 之前**运行中**的会话应自动恢复；已关闭的会话不应自动拉起。

- [ ] **Step 3: Commit（如有遗留改动）**

```bash
git status
```

---

## 补充决策（执行后追加）

- **账本记录原 agent 并长期保留**：`sessions.json` 已记录 `kind`/`agentId`/`agentCmd`/`agentSessionId`；关闭会话只标 `exited` 不删记录。存储上限由 30 提到 **500**（`server/session-ledger.js` 的 `MAX_SESSIONS`），UI 仍按 30 展示（`sessionTree.ts` 的 `MAX_SESSION_NODES`）。恢复走 `restoreRecord`：按 `rec.agentId` 用同一个 agent 打开，并按 `rec.agentSessionId` 续回原对话。
- **退出/关闭时补一次 agent 会话发现**：`server/index.js` 的 `exit` 处理器在 `kind==='agent'` 时调用 `runDiscovery(s, { requireAlive:false })`，避免在 15s/60s 定时发现前关闭而漏掉 `agentSessionId`。
- **账本缺失（>500 条被淘汰 / 历史遗留）**：仍退化为 shell；这些会话本来就没有记录过 agent，无法还原。

## 不做（明确排除）

- 不新增 `.db` 文件、不改 `void.db` 表结构。
- 不改「仅当前会话」平铺视图。
- 不为重建的会话猜测 agent（账本缺失时统一重建为 shell；有账本记录时按 `agentSessionId` 续接）。
- 不做账本存储上限扩展（沿用 `MAX_SESSIONS=30`）。
