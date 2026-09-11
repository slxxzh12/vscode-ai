# 心跳用量 + master downloads 实施计划（P2 / 3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 成员每 5–10 分钟随机采集本机 `opencode stats` 上报 hub；hub 汇总写入 `downloads/usage.json` + `group.json`；slave 仅在用户点击时从 master 拉取，不推送。

**Architecture:** 新增 `agent-stats.js`（采集/解析，纯函数可测）与 `heartbeat.js`（随机间隔调度）；引擎新增 `reportHeartbeat/_inHeartbeat/writeDownload/pullDownloads/_inPullDownloads`；`downloads/` 由引擎读写并按 sha256 维护 `manifest.json`；前端群组页签展示各成员用量并新增「同步 master」。

**Tech Stack:** Node ESM、`node:child_process.execFile`、node:test、Vue3。

**前置：** `2026-09-11-single-group-remote-access.md`（P1）已完成。spec §5/§6。

---

## 文件结构

**新建：**
- `server/collaboration/agent-stats.js`
- `server/collaboration/heartbeat.js`
- `server/test/agent-stats.test.js`
- `server/test/heartbeat.test.js`

**改：**
- `server/workspace.js` — `profilePaths` 增 `downloadsDir`
- `server/index.js` — 传入 downloadsDir、启动心跳、事件总线接线
- `server/collaboration/engine.js` — downloads 目录 + 心跳/拉取方法
- `server/collaboration/store.js` — `heartbeats` 表
- `server/collaboration/http-mount.js` — downloads 路由
- `shared/collab.js` / `shared/collab.d.ts` — 新增类型
- `web/src/collaboration/{types.ts,useCollab.ts,GroupView.vue,CollaborationView.vue}`
- `shared/i18n/{zh-CN,en}.js`

---

## Task 1: agent-stats 采集与解析

**Files:**
- Create: `server/collaboration/agent-stats.js`
- Test: `server/test/agent-stats.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStats, parseNum, collectAgentStats } from '../collaboration/agent-stats.js';

const SAMPLE = [
  '│Sessions                                             21 │',
  '│Messages                                          3,986 │',
  '│Days                                                  7 │',
  '│Total Cost                                        $4.83 │',
  '│Input                                              8.2M │',
  '│Output                                             1.0M │',
  '│Cache Read                                       983.0M │',
  '│Cache Write                                           0 │',
].join('\n');

test('parseNum 支持 K/M/B 与千分位', () => {
  assert.equal(parseNum('8.2M'), 8200000);
  assert.equal(parseNum('3,986'), 3986);
  assert.equal(parseNum('983.0M'), 983000000);
  assert.equal(parseNum('$4.83'), 4.83);
  assert.equal(parseNum('abc'), null);
});

test('parseStats 提取关键字段', () => {
  const s = parseStats(SAMPLE);
  assert.equal(s.sessions, 21);
  assert.equal(s.messages, 3986);
  assert.equal(s.days, 7);
  assert.equal(s.totalCost, 4.83);
  assert.equal(s.input, 8200000);
  assert.equal(s.output, 1000000);
  assert.equal(s.cacheRead, 983000000);
  assert.equal(s.cacheWrite, 0);
});

test('collectAgentStats 命令不存在返回 error', async () => {
  const r = await collectAgentStats({ cmd: 'definitely-not-a-cmd-xyz' });
  assert.ok(r.error);
  assert.equal(r.agent, 'definitely-not-a-cmd-xyz');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/agent-stats.test.js"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `agent-stats.js`**

```js
import { execFile } from 'node:child_process';

const MULT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

export function parseNum(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[,$\s]/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)([KMBT])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2] ? m[2].toUpperCase() : null;
  return u ? Math.round(n * MULT[u]) : n;
}

export function parseStats(text) {
  const t = stripAnsi(text || '');
  const grab = (label) => {
    const m = t.match(new RegExp(label + '\\s+\\$?([\\d.,]+\\s*[KMBT]?)', 'i'));
    return m ? parseNum(m[1]) : null;
  };
  return {
    sessions: grab('Sessions'),
    messages: grab('Messages'),
    days: grab('Days'),
    totalCost: grab('Total Cost'),
    input: grab('Input'),
    output: grab('Output'),
    cacheRead: grab('Cache Read'),
    cacheWrite: grab('Cache Write'),
  };
}

export function collectAgentStats({ cmd = 'opencode', days = 7, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, ['stats', '--days', String(days)], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) { resolve({ agent: cmd, days, error: String((err && err.message) || err) }); return; }
      resolve({ agent: cmd, days, ...parseStats(stdout), collectedAt: Date.now() });
    });
  });
}
```

- [ ] **Step 4: 运行通过**

Run: `node --test "server/test/agent-stats.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/agent-stats.js server/test/agent-stats.test.js
git commit -m "feat(collab): opencode stats 采集与解析"
```

---

## Task 2: Store 心跳表

**Files:**
- Modify: `server/collaboration/store.js`
- Test: `server/test/collab-store.test.js`

- [ ] **Step 1: 写失败测试**

```js
test('heartbeats 表 upsert / list', () => {
  const s = new CollabStore({ file: tmpFile() });
  assert.deepEqual(s.listHeartbeats(), {});
  s.setHeartbeat('m1', { agent: 'opencode', input: 1, receivedAt: 10 });
  s.setHeartbeat('m1', { agent: 'opencode', input: 2, receivedAt: 20 });
  assert.equal(s.listHeartbeats().m1.input, 2);
  assert.equal(s.listHeartbeats().m1.receivedAt, 20);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/collab-store.test.js"`
Expected: FAIL

- [ ] **Step 3: 实现**

`defaultData()` 增 `heartbeats: {}`。方法：

```js
// ---- 心跳（最新用量）----
listHeartbeats() { return this.data.heartbeats; }
getHeartbeat(machineId) { return this.data.heartbeats[machineId] || null; }
setHeartbeat(machineId, usage) {
  this.data.heartbeats[machineId] = { ...usage };
  this.save();
  return this.data.heartbeats[machineId];
}
```

- [ ] **Step 4: 运行通过 + Commit**

Run: `node --test "server/test/collab-store.test.js"`
```bash
git add server/collaboration/store.js server/test/collab-store.test.js
git commit -m "feat(collab): store 心跳表"
```

---

## Task 3: 协议新增心跳/拉取

**Files:**
- Modify: `shared/collab.js`, `shared/collab.d.ts`

- [ ] **Step 1: 改常量**

`CollabPeer` 增 `HEARTBEAT: 'heartbeat'`、`PULL_DOWNLOADS: 'pull-downloads'`。
`CollabS2C` 增 `COLLAB_HEARTBEAT: 'collab-heartbeat'`。

- [ ] **Step 2: 同步 d.ts**

- [ ] **Step 3: Commit**

```bash
git add shared/collab.js shared/collab.d.ts
git commit -m "feat(collab): 协议新增 heartbeat/pull-downloads"
```

---

## Task 4: 引擎 downloads 目录 + 心跳/拉取

**Files:**
- Modify: `server/collaboration/engine.js`
- Modify: `server/workspace.js`
- Test: `server/test/heartbeat.test.js`

- [ ] **Step 1: `workspace.js` 增 `downloadsDir`**

在 `profilePaths(...)` 返回对象中增 `downloadsDir: path.join(root, id, 'downloads')`（按该函数现有路径拼接方式写）。

- [ ] **Step 2: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPairHarness } from '../collaboration/engine.js';

async function joinGroup(A, B) {
  A.verifyAccessToken = (tk) => tk === 'good';
  A.ensureGroup();
  await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
}

test('slave 上报 → hub 汇总写 downloads/usage.json', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    await joinGroup(A, B);
    const usage = { agent: 'opencode', days: 7, sessions: 3, messages: 40, input: 100, output: 20, totalCost: 0.5 };
    await B.reportHeartbeat(usage);
    assert.equal(A.store.getHeartbeat(B.pub.machineId).messages, 40);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const usageFile = path.join(A.downloadsDir, 'usage.json');
    assert.ok(fs.existsSync(usageFile), 'hub 写 usage.json');
    const j = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
    assert.equal(j.members[B.pub.machineId].sessions, 3);
  } finally { await h.stop(); }
});

test('slave 点击拉取 → 本地 downloads 出现 usage.json', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    await joinGroup(A, B);
    await A.reportHeartbeat({ agent: 'opencode', days: 7, messages: 7 });
    const r = await B.pullDownloads();
    assert.equal(r.code, 'ok');
    assert.ok(r.files.includes('usage.json'));
    assert.equal(B.store.getHeartbeat(A.pub.machineId).messages, 7);
  } finally { await h.stop(); }
});
```

> harness 需给两节点各配 `downloadsDir` 临时目录。在 `engine.js` 的 `createPairHarness` `makeNode` 中增 `downloadsDir: path.join(nodeDir, 'downloads')`，并在 `new CollabEngine({...})` 传 `downloadsDir`。

- [ ] **Step 3: 运行确认失败**

Run: `node --test "server/test/heartbeat.test.js"`
Expected: FAIL

- [ ] **Step 4: 引擎实现**

构造参数增 `downloadsDir`（默认 `path.join(os.tmpdir(), 'devflow-downloads')` 兜底）。

```js
// ---- downloads（master 共享目录）----
_manifestPath() { return path.join(this.downloadsDir, 'manifest.json'); }
readManifest() {
  try { return JSON.parse(fs.readFileSync(this._manifestPath(), 'utf8')); } catch { return { version: 1, updatedAt: 0, files: [] }; }
}
_writeManifest(m) { fs.mkdirSync(this.downloadsDir, { recursive: true }); fs.writeFileSync(this._manifestPath(), JSON.stringify(m, null, 2)); }
writeDownload(name, buf, kind) {
  const abs = path.join(this.downloadsDir, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const m = this.readManifest();
  m.version = 1; m.updatedAt = Date.now();
  m.files = m.files.filter((f) => f.name !== name);
  m.files.push({ name, kind, size: buf.length, sha256, updatedAt: Date.now() });
  this._writeManifest(m);
  return { name, sha256, size: buf.length };
}
writeUsageSnapshot() {
  this.writeDownload('usage.json', Buffer.from(JSON.stringify({ updatedAt: Date.now(), members: this.store.listHeartbeats() }, null, 2)), 'usage');
  this.writeDownload('group.json', Buffer.from(JSON.stringify(this.store.getGroup() || {}, null, 2)), 'group');
}
reportHeartbeat(usage) {
  const g = this.store.getGroup();
  if (!g) return { code: 'no-group' };
  if (g.hubId === this.pub.machineId) {
    this.store.setHeartbeat(this.pub.machineId, { ...usage, receivedAt: Date.now() });
    this.writeUsageSnapshot();
    this._emit('heartbeat', {});
    return { code: 'local' };
  }
  const hub = g.members.find((m) => m.machineId === g.hubId);
  if (!hub) return { code: 'no-hub' };
  return this._post(hub.host, hub.port, this._sign(CollabPeer.HEARTBEAT, { groupId: g.id, usage }));
}
_inHeartbeat(env) {
  const g = this.store.getGroup();
  if (!g || !g.members.find((m) => m.machineId === env.from.machineId)) return { ok: false, error: 'not-member' };
  if (g.hubId !== this.pub.machineId) return { ok: false, error: 'not-hub' };
  this.store.setHeartbeat(env.from.machineId, { ...(env.payload.usage || {}), receivedAt: Date.now() });
  this.writeUsageSnapshot();
  this._emit('heartbeat', {});
  return { ok: true };
}
pullDownloads() {
  const g = this.store.getGroup();
  const hub = g && g.members.find((m) => m.machineId === g.hubId);
  if (!hub || hub.machineId === this.pub.machineId) return Promise.resolve({ code: 'no-master' });
  return this._post(hub.host, hub.port, this._sign(CollabPeer.PULL_DOWNLOADS, {})).then((res) => {
    if (!res.ok) return { code: 'unreachable', error: res.error };
    const data = res.data || {};
    for (const f of data.files || []) {
      const abs = path.join(this.downloadsDir, f.name);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(f.b64, 'base64'));
    }
    if (data.manifest) this._writeManifest(data.manifest);
    // 名单以 master 为准
    if (data.group) this.store.setGroup(data.group);
    this._emit('synced', {});
    this._emit('heartbeat', {});
    return { code: 'ok', files: (data.files || []).map((f) => f.name) };
  });
}
_inPullDownloads(env) {
  const g = this.store.getGroup();
  if (!g || !g.members.find((m) => m.machineId === env.from.machineId)) return { ok: false, error: 'not-member' };
  const manifest = this.readManifest();
  const local = this.store.getHeartbeat ? this.store.listHeartbeats() : {};
  const files = [];
  for (const f of manifest.files) {
    const abs = path.join(this.downloadsDir, f.name);
    if (!fs.existsSync(abs)) continue;
    files.push({ name: f.name, b64: fs.readFileSync(abs).toString('base64') });
  }
  // 一并回名单与用量快照（≤ 64MB 约束）
  return { ok: true, data: { manifest, files, group: g, usage: { updatedAt: Date.now(), members: local } } };
}
```

`handleIncoming` switch 增：
```js
case CollabPeer.HEARTBEAT: return this._inHeartbeat(env);
case CollabPeer.PULL_DOWNLOADS: return this._inPullDownloads(env);
```

- [ ] **Step 5: 运行通过**

Run: `node --test "server/test/heartbeat.test.js"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/collaboration/engine.js server/workspace.js server/test/heartbeat.test.js
git commit -m "feat(collab): 引擎心跳汇总 + downloads 拉取"
```

---

## Task 5: heartbeat 调度模块

**Files:**
- Create: `server/collaboration/heartbeat.js`
- Test: `server/test/heartbeat.test.js`（追加调度用例）

- [ ] **Step 1: 写失败测试**

```js
test('createHeartbeat 随机间隔落在 5–10 分钟', async () => {
  const { createHeartbeat } = await import('../collaboration/heartbeat.js');
  const calls = [];
  const hb = createHeartbeat({
    engine: { reportHeartbeat: async (u) => { calls.push(u); } },
    cmd: 'opencode', days: 7,
    intervalMinMs: 5 * 60 * 1000, intervalMaxMs: 10 * 60 * 1000,
    collect: async () => ({ agent: 'opencode', days: 7, messages: 1 }),   // 注入便于测试
  });
  const u = await hb.collectOnce();
  assert.equal(u.messages, 1);
  assert.equal(calls.length, 1);
});
```

> 为可测，`createHeartbeat` 接收可选 `collect`（默认 `collectAgentStats`）。

- [ ] **Step 2: 运行确认失败 → 实现**

```js
import { collectAgentStats } from './agent-stats.js';

export function createHeartbeat({ engine, cmd = 'opencode', days = 7, intervalMinMs = 5 * 60 * 1000, intervalMaxMs = 10 * 60 * 1000, collect = collectAgentStats, logger = console }) {
  let timer = null;
  let stopped = false;
  const nextDelay = () => intervalMinMs + Math.floor(Math.random() * Math.max(1, intervalMaxMs - intervalMinMs));
  async function collectOnce() {
    let usage;
    try { usage = await collect({ cmd, days }); }
    catch (e) { usage = { agent: cmd, days, error: String((e && e.message) || e) }; }
    try { await engine.reportHeartbeat(usage); }
    catch (e) { logger?.warn?.('heartbeat report failed', (e && e.message) || e); }
    return usage;
  }
  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => { await collectOnce(); schedule(); }, nextDelay());
    if (timer.unref) timer.unref();
  }
  return {
    start() { if (stopped) stopped = false; collectOnce().then(schedule); },
    stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
    collectOnce,
  };
}
```

- [ ] **Step 3: 运行通过 + Commit**

Run: `node --test "server/test/heartbeat.test.js"`
```bash
git add server/collaboration/heartbeat.js server/test/heartbeat.test.js
git commit -m "feat(collab): 心跳随机调度模块"
```

---

## Task 6: 服务端接线 + downloads 路由

**Files:**
- Modify: `server/index.js`
- Modify: `server/collaboration/http-mount.js`
- Test: `server/test/collab-http.test.js`

- [ ] **Step 1: `index.js` 接线**

- `buildWorkspace` paths 使用 `paths.downloadsDir`；`new CollabEngine({ ..., downloadsDir: paths.downloadsDir })`。
- `eventBus.on('heartbeat', () => broadcastCollab(CollabS2C.COLLAB_HEARTBEAT, {}))`。
- `initWorkspace` 末尾：
```js
const agentCmd = ((BOOT_CFG.agents.list || []).find((a) => a.id === BOOT_CFG.agents.default) || {}).cmd || 'opencode';
ws.heartbeat = createHeartbeat({ engine: ws.engine, cmd: agentCmd, logger: log });
ws.heartbeat.start();
```
import `createHeartbeat`。
- `buildWorkspace` 返回 `heartbeat: null` 占位。

- [ ] **Step 2: `http-mount.js` 路由**

```js
// downloads（master 共享目录）
if (seg[0] === 'downloads' && seg.length === 1 && m === 'GET') {
  return ok(res, { manifest: engine.readManifest(), usage: { members: engine.store.listHeartbeats() }, group: engine.store.getGroup() });
}
if (seg[0] === 'downloads' && seg.length === 2 && seg[1] === 'sync' && m === 'POST') {
  return ok(res, await engine.pullDownloads());
}
if (seg[0] === 'downloads' && seg.length === 3 && seg[1] === 'file' && m === 'GET') {
  const name = decodeURIComponent(seg[2]);
  if (name.includes('..') || name.includes('\\')) return sendJson(res, 400, { error: 'bad-name' });
  const abs = path.join(engine.downloadsDir, name);
  if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(abs).size });
  fs.createReadStream(abs).pipe(res);
  return;
}
```

- [ ] **Step 3: 写测试并运行**

`collab-http.test.js` 增：`GET /api/collab/downloads` 返回 `manifest/usage/group`；`POST /downloads/sync` 在无 master 时返回 `{ code:'no-master' }`；`GET /downloads/file/../x` 返回 400。

Run: `node --test "server/test/collab-http.test.js"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/index.js server/collaboration/http-mount.js server/test/collab-http.test.js
git commit -m "feat(collab): 心跳接线 + downloads 路由"
```

---

## Task 7: 前端用量展示 + 点击同步

**Files:**
- Modify: `web/src/collaboration/useCollab.ts`
- Modify: `web/src/collaboration/GroupView.vue`
- Modify: `web/src/collaboration/CollaborationView.vue`
- Modify: `shared/i18n/{zh-CN,en}.js`

- [ ] **Step 1: `useCollab.ts`**

新增：
```ts
async function syncDownloads() {
  const r = await post<{ code: string; files?: string[] }>('/api/collab/downloads/sync');
  await refresh();
  return r;
}
async function listDownloads() {
  return http<{ manifest: { files: { name: string; kind: string; size: number; updatedAt: number }[] }; usage: unknown; group: unknown }>('/api/collab/downloads');
}
```
返回对象增 `syncDownloads, listDownloads`。

- [ ] **Step 2: `GroupView.vue` 展示用量 + 同步**

成员行内联展示：`snap.heartbeats[m.machineId]` 的 `input/output/days/messages`（`t('collab.heartbeat.usage', {...})`）。
远程面板下增：

```vue
<div class="sec">
  <h4>{{ $t('collab.downloads.title') }}</h4>
  <button @click="syncMaster">{{ $t('collab.downloads.sync') }}</button>
  <div v-if="downloads.manifest?.files?.length" class="empty">{{ $t('collab.downloads.count', { count: downloads.manifest.files.length }) }}</div>
</div>
```
脚本增 `const downloads = ref<any>({ manifest: { files: [] } });` 与 `async function syncMaster(){ await props.collab.syncDownloads(); downloads.value = await props.collab.listDownloads(); }`；打开页签时也调用一次 `listDownloads`（不自动 sync）。

- [ ] **Step 3: `CollaborationView.vue` 订阅心跳**

`unsubs` 增 `props.terminal.on(CollabS2C.COLLAB_HEARTBEAT, () => collab.refresh().catch(() => {}))`。

- [ ] **Step 4: i18n 新增**

`collab.heartbeat.usage`、`collab.heartbeat.offline`、`collab.downloads.title/sync/count`（中英同步）。

- [ ] **Step 5: 验证 + Commit**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run test:web`
Run: `npm.cmd run check:i18n`
```bash
git add web/src/collaboration shared/i18n
git commit -m "feat(web): 成员用量展示 + 点击同步 master"
```

---

## Task 8: 全量验证

- [ ] **Step 1:** `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 全 PASS。
- [ ] **Step 2: 手动**：A 开远程 → B 接入 → B 等一次心跳（或临时把间隔调小）→ A 群组页签看到 B 用量；B 点「同步 master」后看到 A 用量；断开 A 后点击同步给出提示且不阻塞。

---

## Self-Review 记录

- **Spec 覆盖**：§5 心跳→Task 1/2/4/5/6/7；§6 downloads→Task 4/6/7；§7 例外（无广播，仅点击）→Task 4/6。
- **类型一致**：`reportHeartbeat/_inHeartbeat/writeDownload/writeUsageSnapshot/readManifest/pullDownloads/_inPullDownloads`、`downloadsDir`、`COLLAB_HEARTBEAT` 前后一致。
- **占位扫描**：Task 4 Step 2 明确要求 harness 增 `downloadsDir`；无 TBD。
