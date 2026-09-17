# 会话永久持久化与重启恢复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后端重启后自动恢复终端会话页签、回滚内容，并让 agent 会话续接上一次对话上下文。

**Architecture:** 新增 `session-ledger`（账本 + 回滚文件，端口隔离落盘）、`agent-resume`（按 agent 的续会话适配器，opencode 内建 + XML 配置驱动）、`session-restore`（启动时急切重建 PTY、预填 ring、注入续会话命令）。`SessionManager` 支持显式 id/createdAt/replay 以复用会话身份；前端只认领 `restored` 会话，不重复创建。

**Tech Stack:** Node ESM + `node:test`（server）、Vue 3 + TypeScript + Vitest（web）、`@devflow/shared` 协议常量、`createJsonStore` 通用小存储、node-pty。

**设计依据：** `docs/superpowers/specs/2026-09-17-session-persist-restore-design.md`

**环境：** Windows + PowerShell 5.1，一律用 `npm.cmd`；测试命令 `npm.cmd test`、类型检查 `npm.cmd run typecheck`、i18n 检查 `npm.cmd run check:i18n`。

---

### Task 1: 端口路径新增 sessionsFile / sessionLogsDir

**Files:**
- Modify: `server/port-paths.js:11-45`
- Test: `server/test/port-paths.test.js:10-53`

- [ ] **Step 1: 写失败测试**

在 `server/test/port-paths.test.js` 的 `portPaths 全部落在 ports/<端口> 下` 用例里，`windowStateFile` 断言之后插入：

```js
  assert.equal(p.sessionsFile, path.join(base, 'sessions.json'));
  assert.equal(p.sessionLogsDir, path.join(base, 'session-logs'));
```

并把 `ensurePortDirs 幂等创建必需子目录` 用例的目录清单改为：

```js
  for (const d of [p.dir, p.schedulerDir, p.collabDir, p.uploadDir, p.downloadDir, p.downloadsDir, p.skillsRoot, p.sessionLogsDir]) {
    assert.ok(fs.existsSync(d), d + ' 应存在');
  }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/port-paths.test.js"`
Expected: FAIL（`p.sessionsFile` 为 undefined）

- [ ] **Step 3: 实现**

在 `server/port-paths.js` 的 `portPaths()` 返回对象里，`windowStateFile` 行后加：

```js
    sessionsFile: path.join(dir, 'sessions.json'),
    sessionLogsDir: path.join(dir, 'session-logs'),
```

把 `ensurePortDirs` 的目录数组改为：

```js
  for (const d of [paths.dir, paths.schedulerDir, paths.collabDir, paths.uploadDir, paths.downloadDir, paths.downloadsDir, paths.skillsRoot, paths.sessionLogsDir]) {
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/port-paths.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/port-paths.js server/test/port-paths.test.js
git commit -m "feat(session): 端口路径新增会话账本与回滚目录"
```

---

### Task 2: session-ledger（账本 + 回滚文件）

**Files:**
- Create: `server/session-ledger.js`
- Test: `server/test/session-ledger.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/session-ledger.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeLedger, createSessionLedger, MAX_SESSIONS, MAX_LOG_BYTES,
} from '../session-ledger.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-ledger-')); }
const entry = (id, extra = {}) => ({
  id, name: 'N', projectId: 'p1', cwd: 'C:\\proj', kind: 'agent',
  agentId: 'opencode', agentCmd: 'opencode', cols: 80, rows: 24,
  createdAt: 1000, updatedAt: 1000, ...extra,
});

test('normalizeLedger 丢弃非法项并按 updatedAt 降序、上限截断', () => {
  const out = normalizeLedger({ sessions: [
    entry('s1', { updatedAt: 1 }), null, { id: '' }, { id: 's2', cwd: '' },
    entry('s3', { updatedAt: 3 }), entry('s4', { updatedAt: 2 }),
  ] });
  assert.deepEqual(out.sessions.map((s) => s.id), ['s3', 's4', 's1']);
  assert.equal(normalizeLedger({ sessions: 'nope' }).sessions.length, 0);
});

test('normalizeLedger 强制 kind 白名单与数值兜底（workflow 保留，未知归 shell）', () => {
  const out = normalizeLedger({ sessions: [
    entry('s1', { kind: 'workflow', cols: 0, rows: -2 }),
    entry('s2', { kind: 'bogus' }),
  ] });
  assert.equal(out.sessions.find((s) => s.id === 's1').kind, 'workflow');
  assert.equal(out.sessions.find((s) => s.id === 's1').cols, 80);
  assert.equal(out.sessions.find((s) => s.id === 's1').rows, 24);
  assert.equal(out.sessions.find((s) => s.id === 's2').kind, 'shell');
});

test('normalizeLedger 上限 MAX_SESSIONS', () => {
  const many = Array.from({ length: MAX_SESSIONS + 5 }, (_, i) => entry(`s${i}`, { updatedAt: i }));
  assert.equal(normalizeLedger({ sessions: many }).sessions.length, MAX_SESSIONS);
});

test('upsert 幂等合并、保留已有 agentSessionId', () => {
  const dir = tmpDir();
  const ledger = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  ledger.upsert(entry('s1'));
  ledger.upsert({ ...entry('s1'), agentSessionId: 'ses_x' });
  ledger.upsert({ ...entry('s1'), name: 'renamed' });     // 不含 agentSessionId
  const got = ledger.read().sessions.find((s) => s.id === 's1');
  assert.equal(got.name, 'renamed');
  assert.equal(got.agentSessionId, 'ses_x');
});

test('appendLog 截头留尾，readLog 可回读内存缓冲', () => {
  const dir = tmpDir();
  const ledger = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  ledger.appendLog('s1', 'a'.repeat(MAX_LOG_BYTES));
  ledger.appendLog('s1', 'TAIL');
  const content = ledger.readLog('s1');
  assert.equal(content.length, MAX_LOG_BYTES);
  assert.equal(content.endsWith('TAIL'), true);
});

test('flushLog 落盘、flushAll 批量、readLog 从盘回读', () => {
  const dir = tmpDir();
  const ledger = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  ledger.appendLog('s1', 'hello\n');
  ledger.flushLog('s1');
  const file = path.join(dir, 'session-logs', 's1.log');
  assert.equal(fs.readFileSync(file, 'utf8'), 'hello\n');
  const fresh = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  assert.equal(fresh.readLog('s1'), 'hello\n');
});

test('remove 删记录与回滚文件', () => {
  const dir = tmpDir();
  const ledger = createSessionLedger({ file: path.join(dir, 'sessions.json'), logsDir: path.join(dir, 'session-logs') });
  ledger.upsert(entry('s1'));
  ledger.appendLog('s1', 'x');
  ledger.flushLog('s1');
  ledger.remove('s1');
  assert.equal(ledger.read().sessions.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'session-logs', 's1.log')), false);
  assert.equal(ledger.readLog('s1'), null);
});

test('文件损坏回退空账本', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'sessions.json');
  fs.writeFileSync(file, '{ not json', 'utf8');
  const ledger = createSessionLedger({ file, logsDir: path.join(dir, 'session-logs') });
  assert.deepEqual(ledger.read(), { sessions: [] });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/session-ledger.test.js"`
Expected: FAIL（`Cannot find module '../session-ledger.js'`）

- [ ] **Step 3: 实现**

创建 `server/session-ledger.js`：

```js
import fs from 'node:fs';
import path from 'node:path';
import { createJsonStore } from './json-store.js';

// 会话账本 + 终端回滚落盘。一个端口一份：sessions.json + session-logs/<id>.log。
export const MAX_SESSIONS = 30;
export const MAX_LOG_BYTES = 512 * 1024;
export const KINDS = ['agent', 'shell', 'workflow'];   // workflow 仅用于识别并跳过恢复

const str = (v) => (typeof v === 'string' ? v : '');

export function normalizeLedger(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const list = Array.isArray(src.sessions) ? src.sessions : [];
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    const id = str(it.id);
    const cwd = str(it.cwd);
    if (!id || !cwd) continue;
    out.push({
      id,
      name: str(it.name) || id,
      projectId: str(it.projectId) || null,
      cwd,
      kind: KINDS.includes(it.kind) ? it.kind : 'shell',
      agentId: str(it.agentId) || null,
      agentCmd: str(it.agentCmd) || null,
      agentSessionId: str(it.agentSessionId) || null,
      cols: Number.isInteger(it.cols) && it.cols > 0 ? it.cols : 80,
      rows: Number.isInteger(it.rows) && it.rows > 0 ? it.rows : 24,
      createdAt: Number.isFinite(it.createdAt) ? it.createdAt : 0,
      updatedAt: Number.isFinite(it.updatedAt) ? it.updatedAt : 0,
      state: it.state === 'exited' ? 'exited' : 'running',
    });
  }
  out.sort((a, b) => (b.updatedAt - a.updatedAt) || (b.createdAt - a.createdAt));
  return { sessions: out.slice(0, MAX_SESSIONS) };
}

export function createSessionLedger({ file = null, logsDir = null, logger = console } = {}) {
  const store = createJsonStore({ file, logger, normalize: normalizeLedger, defaults: () => ({ sessions: [] }) });
  const buffers = new Map();
  const dirty = new Set();
  const logFile = (id) => (logsDir ? path.join(logsDir, `${id}.log`) : null);

  function appendLog(id, chunk) {
    if (!id || typeof chunk !== 'string' || !chunk) return;
    let buf = (buffers.get(id) || '') + chunk;
    if (buf.length > MAX_LOG_BYTES) buf = buf.slice(buf.length - MAX_LOG_BYTES);
    buffers.set(id, buf);
    dirty.add(id);
  }
  function flushLog(id) {
    const f = logFile(id);
    if (!f || !dirty.has(id)) return;
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = `${f}.tmp`;
      fs.writeFileSync(tmp, buffers.get(id) || '', 'utf8');
      fs.renameSync(tmp, f);
      dirty.delete(id);
    } catch (e) { logger?.warn?.('session log flush failed', (e && e.message) || e); }
  }
  function flushAll() { for (const id of [...dirty]) flushLog(id); }
  function readLog(id) {
    if (buffers.has(id)) return buffers.get(id);
    const f = logFile(id);
    if (!f) return null;
    try { return fs.readFileSync(f, 'utf8'); } catch { return null; }
  }
  function upsert(entry) {
    if (!entry || !entry.id) return store.read();
    const cur = store.read();
    const existing = cur.sessions.find((s) => s.id === entry.id) || {};
    const rest = cur.sessions.filter((s) => s.id !== entry.id);
    return store.write({ sessions: [{ ...existing, ...entry }, ...rest] });
  }
  function remove(id) {
    const cur = store.read();
    store.write({ sessions: cur.sessions.filter((s) => s.id !== id) });
    buffers.delete(id);
    dirty.delete(id);
    const f = logFile(id);
    if (f) { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } }
  }
  return { read: store.read, upsert, remove, appendLog, flushLog, flushAll, readLog };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/session-ledger.test.js"`
Expected: PASS（8 tests）

- [ ] **Step 5: 提交**

```bash
git add server/session-ledger.js server/test/session-ledger.test.js
git commit -m "feat(session): 会话账本与终端回滚落盘（端口隔离）"
```

---

### Task 3: SessionManager 支持显式 id/createdAt/replay 与 restored 标记

**Files:**
- Modify: `server/session-manager.js:21-59`
- Test: `server/test/session-manager.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/session-manager.test.js` 末尾追加：

```js
test('create 支持显式 id/createdAt 并保留 kind/agentId', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({ id: 's_fixed01', createdAt: 111, kind: 'agent', agentId: 'opencode', agentCmd: 'opencode' });
  assert.equal(s.id, 's_fixed01');
  assert.equal(s.createdAt, 111);
  const sum = sm.summary(s);
  assert.equal(sum.kind, 'agent');
  assert.equal(sum.agentId, 'opencode');
  assert.equal(sum.restored, false);
});

test('create 用 replay 预填 ring，START 重放能看到', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({ replay: 'old-line\n' });
  assert.equal(s.ring.content, 'old-line\n');
});

test('list 按 createdAt 降序保持恢复顺序', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  await sm.create({ id: 's_old00001', createdAt: 100 });
  await sm.create({ id: 's_new00001', createdAt: 200 });
  assert.deepEqual(sm.list().map((s) => s.id), ['s_new00001', 's_old00001']);
});

test('markRestored 置 restored=true 并出现在 summary', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({});
  sm.markRestored(s.id);
  assert.equal(sm.summary(s).restored, true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/session-manager.test.js"`
Expected: FAIL（显式 id 被忽略 / `summary` 无 `kind`）

- [ ] **Step 3: 实现**

把 `server/session-manager.js` 的 `create()` 改为（保留原 `projectResolver` 逻辑）：

```js
  async create({ projectId = null, cwd = null, name = null, cols = 80, rows = 24,
                 id = null, kind = 'shell', agentId = null, agentCmd = null,
                 createdAt = null, replay = null } = {}) {
    const projRoot = projectId && this.projectResolver ? (this.projectResolver(projectId) || null) : null;
    const workdir = cwd || projRoot || process.cwd();
    const pty = await this.ptyFactory({ cwd: workdir, cols, rows });
    const session = {
      id: id || shortId(), name: name || (projectId ? `${projectId} · ${timeLabel()}` : `${t('session.default')} · ${timeLabel()}`),
      projectId, cwd: workdir, pty, alive: true,
      ring: new RingBuffer(this.ringMaxBytes), clients: new Set(),
      cols, rows, state: 'running', exitCode: null,
      createdAt: createdAt || Date.now(), seq: ++this._seq, ptyExited: false,
      kind, agentId, agentCmd, restored: false,
    };
    if (typeof replay === 'string' && replay) session.ring.push(replay);
    pty.onData((chunk) => this._onData(session, chunk));
    pty.onExit((code) => this._onExit(session, code));
    this.sessions.set(session.id, session);
    this.onCreated?.(session);
    return session;
  }
```

把 `summary()` 改为：

```js
  summary(s) {
    return { id: s.id, name: s.name, projectId: s.projectId, state: s.state, cwd: s.cwd,
      cols: s.cols, rows: s.rows, exitCode: s.exitCode,
      kind: s.kind || 'shell', agentId: s.agentId || null, restored: !!s.restored };
  }
```

在 `kill()` 之前新增方法：

```js
  markRestored(id) {
    const s = this.get(id);
    if (s) s.restored = true;
    return !!s;
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/session-manager.test.js"`
Expected: PASS（原 11 + 新 4）

- [ ] **Step 5: 提交**

```bash
git add server/session-manager.js server/test/session-manager.test.js
git commit -m "feat(session): SessionManager 支持显式身份/回滚预填/恢复标记"
```

---

### Task 4: devflow.xml agent 支持 resumeCmd / resumeDiscover

**Files:**
- Modify: `server/devflow-config.js:52-56,70-73`
- Test: `server/test/devflow-config-resume.test.js`（新增）

- [ ] **Step 1: 写失败测试**

创建 `server/test/devflow-config-resume.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevflowConfig, serializeDevflowConfig } from '../devflow-config.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<devflow>
  <server language="zh-CN" host="127.0.0.1" />
  <agents default="opencode">
    <agent id="opencode" name="OpenCode" cmd="opencode" />
    <agent id="claudecode" name="ClaudeCode" cmd="claudecode" resumeCmd="claudecode --resume {id}" resumeDiscover="win-claude-last-id" />
  </agents>
  <workflows></workflows>
</devflow>`;

test('parseDevflowConfig 解析 resumeCmd / resumeDiscover（缺省不产生键）', () => {
  const cfg = parseDevflowConfig(XML);
  const oc = cfg.agents.list.find((a) => a.id === 'opencode');
  const cc = cfg.agents.list.find((a) => a.id === 'claudecode');
  assert.equal('resumeCmd' in oc, false);
  assert.equal('resumeDiscover' in oc, false);
  assert.equal(cc.resumeCmd, 'claudecode --resume {id}');
  assert.equal(cc.resumeDiscover, 'win-claude-last-id');
});

test('serializeDevflowConfig 原样回写 resume 属性', () => {
  const cfg = parseDevflowConfig(XML);
  const out = serializeDevflowConfig(cfg);
  assert.ok(out.includes('resumeCmd="claudecode --resume {id}"'));
  assert.ok(out.includes('resumeDiscover="win-claude-last-id"'));
  const back = parseDevflowConfig(out);
  assert.equal(back.agents.list.find((a) => a.id === 'claudecode').resumeCmd, 'claudecode --resume {id}');
});

test('无 resume 属性的旧配置仍可解析与序列化', () => {
  const cfg = parseDevflowConfig('<devflow><agents default="opencode"><agent id="opencode" name="OpenCode" cmd="opencode" /></agents></devflow>');
  const out = serializeDevflowConfig(cfg);
  assert.equal(out.includes('resumeCmd'), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/devflow-config-resume.test.js"`
Expected: FAIL（`cc.resumeCmd` 为 undefined）

- [ ] **Step 3: 实现**

`server/devflow-config.js` 的 agent 解析循环改为：

```js
    while ((m = re.exec(agentsTag[2]))) {
      const id = decode(attr(m[1], 'id'));
      const cmd = decode(attr(m[1], 'cmd'));
      if (id && cmd) {
        const agent = { id, name: decode(attr(m[1], 'name')) || id, cmd };
        const resumeCmd = decode(attr(m[1], 'resumeCmd'));
        const resumeDiscover = decode(attr(m[1], 'resumeDiscover'));
        if (resumeCmd) agent.resumeCmd = resumeCmd;
        if (resumeDiscover) agent.resumeDiscover = resumeDiscover;
        found.push(agent);
      }
    }
```

`serializeDevflowConfig` 的 agents 序列化改为：

```js
  const agents = cfg.agents.list
    .map((a) => {
      const attrs = [`id="${escXml(a.id)}"`, `name="${escXml(a.name)}"`, `cmd="${escXml(a.cmd)}"`];
      if (a.resumeCmd) attrs.push(`resumeCmd="${escXml(a.resumeCmd)}"`);
      if (a.resumeDiscover) attrs.push(`resumeDiscover="${escXml(a.resumeDiscover)}"`);
      return `    <agent ${attrs.join(' ')} />`;
    })
    .join('\n');
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/devflow-config-resume.test.js"`
Expected: PASS（3 tests）；再跑 `node --test "server/test/devflow-config-seed.test.js"` 确认未回归

- [ ] **Step 5: 提交**

```bash
git add server/devflow-config.js server/test/devflow-config-resume.test.js
git commit -m "feat(config): agent 支持 resumeCmd/resumeDiscover 续会话配置"
```

---

### Task 5: agent-resume 适配器

**Files:**
- Create: `server/agent-resume.js`
- Test: `server/test/agent-resume.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/agent-resume.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResumeCommand, parseSessionList, pickOpencodeSession, discoverAgentSessionId,
} from '../agent-resume.js';

const ITEMS = JSON.stringify([
  { id: 'ses_a', created: 1000, directory: 'C:\\proj' },
  { id: 'ses_b', created: 5000, directory: 'C:\\proj' },
  { id: 'ses_c', created: 1200, directory: 'C:\\other' },
]);

test('buildResumeCommand：opencode 内建用 --session', () => {
  assert.equal(buildResumeCommand({ agent: { id: 'opencode', cmd: 'opencode' }, agentSessionId: 'ses_x' }), 'opencode --session ses_x');
  assert.equal(buildResumeCommand({ agent: { id: 'opencode', cmd: 'opencode' }, agentSessionId: null }), null);
});

test('buildResumeCommand：配置模板替换 {id}，无 {id} 原样，缺 id 返回 null', () => {
  const agent = { id: 'claudecode', cmd: 'claudecode', resumeCmd: 'claudecode --resume {id}' };
  assert.equal(buildResumeCommand({ agent, agentSessionId: 'abc' }), 'claudecode --resume abc');
  assert.equal(buildResumeCommand({ agent, agentSessionId: null }), null);
  assert.equal(buildResumeCommand({ agent: { id: 'x', cmd: 'x', resumeCmd: 'x --continue' }, agentSessionId: null }), 'x --continue');
});

test('parseSessionList 容错', () => {
  assert.equal(parseSessionList(ITEMS).length, 3);
  assert.deepEqual(parseSessionList('nope'), []);
});

test('pickOpencodeSession 按目录 + 时间窗取最接近', () => {
  assert.equal(pickOpencodeSession(JSON.parse(ITEMS), { cwd: 'c:/proj/', since: 4800 }), 'ses_b');
  assert.equal(pickOpencodeSession(JSON.parse(ITEMS), { cwd: 'C:\\proj', since: 900 }), 'ses_a');
  assert.equal(pickOpencodeSession(JSON.parse(ITEMS), { cwd: 'C:\\none', since: 1000 }), null);
  assert.equal(pickOpencodeSession(JSON.parse(ITEMS), { cwd: 'C:\\proj', since: 999999, now: 999999 }), null);
});

test('discoverAgentSessionId：opencode 走 session list', async () => {
  const calls = [];
  const run = async (cmd, opts) => { calls.push({ cmd, opts }); return ITEMS; };
  const id = await discoverAgentSessionId({ agent: { id: 'opencode', cmd: 'opencode' }, cwd: 'C:\\proj', since: 5000, run });
  assert.equal(id, 'ses_b');
  assert.equal(calls[0].cmd, 'opencode session list --format json -n 30');
});

test('discoverAgentSessionId：resumeDiscover 命令 stdout 去空白', async () => {
  const run = async () => '  sess-123\n';
  const id = await discoverAgentSessionId({ agent: { id: 'claudecode', cmd: 'claudecode', resumeDiscover: 'get-id' }, cwd: 'C:\\proj', since: 0, run });
  assert.equal(id, 'sess-123');
});

test('discoverAgentSessionId：无适配器返回 null；run 失败返回 null', async () => {
  assert.equal(await discoverAgentSessionId({ agent: { id: 'nga', cmd: 'nga.cmd' }, cwd: 'C:\\p', since: 0, run: async () => '' }), null);
  assert.equal(await discoverAgentSessionId({ agent: { id: 'opencode', cmd: 'opencode' }, cwd: 'C:\\p', since: 0, run: async () => null }), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/agent-resume.test.js"`
Expected: FAIL（`Cannot find module '../agent-resume.js'`）

- [ ] **Step 3: 实现**

创建 `server/agent-resume.js`：

```js
import { exec } from 'node:child_process';

// 按 agent 的续会话适配器：opencode 内建；其它 agent 通过 XML resumeCmd/resumeDiscover 配置。
const DEFAULT_DISCOVER_MS = 20000;

const normDir = (s) => String(s || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function buildResumeCommand({ agent, agentSessionId } = {}) {
  if (!agent) return null;
  const id = typeof agentSessionId === 'string' ? agentSessionId : '';
  const configured = typeof agent.resumeCmd === 'string' ? agent.resumeCmd.trim() : '';
  if (configured) {
    if (configured.includes('{id}')) return id ? configured.replace(/\{id\}/g, id) : null;
    return configured;
  }
  if (agent.id === 'opencode' || agent.cmd === 'opencode') {
    return id ? `opencode --session ${id}` : null;
  }
  return null;
}

export function parseSessionList(text) {
  try {
    const arr = JSON.parse(String(text || ''));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function pickOpencodeSession(items, { cwd, since, slackMs = 60000, now = Date.now() } = {}) {
  const dir = normDir(cwd);
  let best = null;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== 'string' || !it.id) continue;
    if (normDir(it.directory) !== dir) continue;
    const created = Number(it.created);
    if (!Number.isFinite(created)) continue;
    if (created < since - slackMs || created > now + slackMs) continue;
    const d = Math.abs(created - since);
    if (!best || d < best.d) best = { id: it.id, d };
  }
  return best ? best.id : null;
}

function defaultRun(command, { cwd, timeoutMs = DEFAULT_DISCOVER_MS } = {}) {
  return new Promise((resolve) => {
    try {
      exec(command, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        resolve(err && !stdout ? null : String(stdout || ''));
      });
    } catch { resolve(null); }
  });
}

export async function discoverAgentSessionId({ agent, cwd, since, run = defaultRun } = {}) {
  if (!agent) return null;
  if (typeof agent.resumeDiscover === 'string' && agent.resumeDiscover.trim()) {
    const out = await run(agent.resumeDiscover.trim(), { cwd });
    const id = out == null ? '' : String(out).trim();
    return id || null;
  }
  if (agent.id === 'opencode' || agent.cmd === 'opencode') {
    const out = await run('opencode session list --format json -n 30', { cwd });
    if (out == null) return null;
    return pickOpencodeSession(parseSessionList(out), { cwd, since });
  }
  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/agent-resume.test.js"`
Expected: PASS（7 tests）

- [ ] **Step 5: 提交**

```bash
git add server/agent-resume.js server/test/agent-resume.test.js
git commit -m "feat(session): 按 agent 的续会话适配器（opencode 内建 + XML 配置）"
```

---

### Task 6: session-restore 启动恢复编排

**Files:**
- Create: `server/session-restore.js`
- Test: `server/test/session-restore.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/session-restore.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session-manager.js';
import { makeFakePtyFactory } from './helpers/fake-pty.js';
import { restoreSessions } from '../session-restore.js';

function makeLedger(sessions, logs = {}) {
  return { read: () => ({ sessions }), readLog: (id) => logs[id] ?? null };
}
function rec(id, extra = {}) {
  return { id, name: `name-${id}`, projectId: 'p1', cwd: process.cwd(), kind: 'agent',
    agentId: 'opencode', agentCmd: 'opencode', agentSessionId: 'ses_1',
    cols: 80, rows: 24, createdAt: 111, updatedAt: 222, state: 'running', ...extra };
}

test('恢复：复用 id/cwd/name、预填回滚、agent 注入续会话命令', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([rec('s_a', { createdAt: 100 }), rec('s_b', { createdAt: 200, agentSessionId: null })], { s_a: 'history-a\n' });
  const res = await restoreSessions({ ledger, sessionManager: sm, agents: [{ id: 'opencode', name: 'OpenCode', cmd: 'opencode' }], resumeDelayMs: 0 });
  assert.equal(res.restored, 2);
  assert.equal(sm.get('s_a').cwd, process.cwd());
  assert.equal(sm.get('s_a').name, 'name-s_a');
  assert.equal(sm.get('s_a').ring.content, 'history-a\n');
  assert.equal(sm.summary(sm.get('s_a')).restored, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(instances[0].pty.writes.includes('opencode --session ses_1\r'), true);   // s_a 续接
  assert.equal(instances[1].pty.writes.includes('opencode\r'), true);                   // s_b 无 id：退化重开 agent
});

test('恢复：workflow 会话跳过；cwd 缺失跳过且不抛', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const ledger = makeLedger([
    rec('s_wf', { kind: 'workflow' }),
    rec('s_gone', { cwd: 'C:\\no-such-dir' }),
  ]);
  const res = await restoreSessions({ ledger, sessionManager: sm, agents: [], resumeDelayMs: 0, exists: (p) => p !== 'C:\\no-such-dir' });
  assert.equal(res.restored, 0);
  assert.deepEqual(res.skipped.map((x) => x.reason), ['cwd-missing']);
  assert.equal(sm.list().length, 0);
});

test('恢复：单条失败不阻断其它', async () => {
  const instances = [];
  let n = 0;
  const sm = new SessionManager({ ptyFactory: async () => { if (n++ === 0) throw new Error('boom'); return makeFakePtyFactory(instances)({ cwd: process.cwd() }); } });
  const ledger = makeLedger([rec('s_1'), rec('s_2')]);
  const res = await restoreSessions({ ledger, sessionManager: sm, agents: [], resumeDelayMs: 0, exists: () => true });
  assert.equal(res.restored, 1);
  assert.deepEqual(res.skipped, [{ id: 's_1', reason: 'boom' }]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/session-restore.test.js"`
Expected: FAIL（`Cannot find module '../session-restore.js'`）

- [ ] **Step 3: 实现**

创建 `server/session-restore.js`：

```js
import fs from 'node:fs';
import { buildResumeCommand } from './agent-resume.js';

// 启动时按账本重建会话：复用 id/createdAt、预填回滚、agent 注入续会话命令。
export async function restoreSessions({
  ledger, sessionManager, agents = [], logger = console, resumeDelayMs = 1500, exists = fs.existsSync,
} = {}) {
  const records = ledger.read().sessions || [];
  const result = { restored: 0, skipped: [] };
  for (const rec of records) {
    if (!rec || !rec.id || rec.kind === 'workflow') continue;
    if (rec.cwd && !exists(rec.cwd)) { result.skipped.push({ id: rec.id, reason: 'cwd-missing' }); continue; }
    try {
      const replay = ledger.readLog(rec.id);
      const session = await sessionManager.create({
        id: rec.id, name: rec.name, projectId: rec.projectId, cwd: rec.cwd,
        kind: rec.kind, agentId: rec.agentId, agentCmd: rec.agentCmd,
        cols: rec.cols, rows: rec.rows, createdAt: rec.createdAt,
        replay: replay || null,
      });
      sessionManager.markRestored(session.id);
      let cmd = null;
      if (rec.kind === 'agent') {
        const agent = agents.find((a) => a.id === rec.agentId) || null;
        // 能续则续；续不上退化为原 agent 命令（不续上下文，但 agent 仍自动起来）
        cmd = buildResumeCommand({ agent, agentSessionId: rec.agentSessionId })
          || (agent && agent.cmd) || rec.agentCmd || null;
      }
      if (cmd) {
        setTimeout(() => { sessionManager.write(session.id, `${cmd}\r`); }, resumeDelayMs);
        logger?.info?.(`session restored with command: ${session.id}`);
      } else {
        logger?.info?.(`session restored: ${session.id}`);
      }
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

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/session-restore.test.js"`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add server/session-restore.js server/test/session-restore.test.js
git commit -m "feat(session): 启动时按账本恢复会话（重建+回填+续会话）"
```

---

### Task 7: ws-gateway CREATE 透传 kind/agentId/agentCmd

**Files:**
- Modify: `server/ws-gateway.js:76-83`
- Test: `server/test/ws-gateway.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/ws-gateway.test.js` 末尾追加：

```js
test('create 透传 kind/agentId/agentCmd 并出现在 summary', async () => {
  const { t } = await makeHarness();
  const c = await t.connect();
  c.send(C2S.CREATE, { kind: 'agent', agentId: 'opencode', agentCmd: 'opencode' });
  const created = await c.wait((m) => m.type === S2C.SESSION_CREATED);
  assert.equal(created.session.kind, 'agent');
  assert.equal(created.session.agentId, 'opencode');
  assert.equal(created.session.restored, false);
  await t.stop();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/ws-gateway.test.js"`
Expected: FAIL（`created.session.kind` 为 undefined）

- [ ] **Step 3: 实现**

`server/ws-gateway.js` 的 `C2S.CREATE` 分支改为：

```js
      case C2S.CREATE:
        sessionManager.create({
          projectId: msg.projectId || null, cwd: msg.cwd || null,
          cols: msg.cols || 80, rows: msg.rows || 24,
          kind: msg.kind || 'shell', agentId: msg.agentId || null, agentCmd: msg.agentCmd || null,
        }).then((session) => {
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/ws-gateway.test.js"`
Expected: PASS（原 10 + 新 1）

- [ ] **Step 5: 提交**

```bash
git add server/ws-gateway.js server/test/ws-gateway.test.js
git commit -m "feat(session): WS create 透传会话类型与 agent 信息"
```

---

### Task 8: index.js 接线（账本、恢复、发现、kill 清理）

**Files:**
- Modify: `server/index.js`（import 区、`buildWorkspace`、`initWorkspace`）

- [ ] **Step 1: 加 import**

`server/index.js` 顶部 `import { SessionManager } from './session-manager.js';` 附近加：

```js
import { createSessionLedger } from './session-ledger.js';
import { restoreSessions } from './session-restore.js';
import { discoverAgentSessionId } from './agent-resume.js';
```

- [ ] **Step 2: buildWorkspace 里建账本、扩展 onCreated、挂事件、暴露返回值**

在 `const sessionProjects = createSessionProjects(...)` 之后加：

```js
  const sessionLedger = createSessionLedger({ file: paths.sessionsFile, logsDir: paths.sessionLogsDir, logger: log });
```

把 `new SessionManager({...})` 改为：

```js
  const agentList = () => loadDevflowConfig(configFile).agents.list || [];
  function scheduleAgentDiscovery(session) {
    const known = sessionLedger.read().sessions.find((r) => r.id === session.id);
    if (known && known.agentSessionId) return;
    const delays = [15000, 60000];
    delays.forEach((delay) => {
      setTimeout(() => {
        const cur = sessionManager.get(session.id);
        if (!cur || !cur.alive) return;
        const already = sessionLedger.read().sessions.find((r) => r.id === session.id);
        if (already && already.agentSessionId) return;
        const agent = agentList().find((a) => a.id === session.agentId) || null;
        discoverAgentSessionId({ agent, cwd: session.cwd, since: session.createdAt })
          .then((sid) => {
            if (!sid) return;
            const row = sessionLedger.read().sessions.find((r) => r.id === session.id);
            if (row) sessionLedger.upsert({ ...row, agentSessionId: sid, updatedAt: Date.now() });
          })
          .catch(() => { /* 发现失败不影响使用 */ });
      }, delay).unref?.();
    });
  }
  const sessionManager = new SessionManager({
    logger: log,
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    onCreated: (s) => {
      sessionProjects.record(s.id, s.projectId);
      if (s.kind === 'workflow') return;
      sessionLedger.upsert({
        id: s.id, name: s.name, projectId: s.projectId, cwd: s.cwd, kind: s.kind,
        agentId: s.agentId, agentCmd: s.agentCmd, cols: s.cols, rows: s.rows,
        createdAt: s.createdAt, updatedAt: Date.now(), state: 'running',
      });
      if (s.kind === 'agent') scheduleAgentDiscovery(s);
    },
  });
  sessionManager.on('data', (s, chunk) => sessionLedger.appendLog(s.id, chunk));
  sessionManager.on('exit', (s) => {
    sessionLedger.flushLog(s.id);
    const row = sessionLedger.read().sessions.find((r) => r.id === s.id);
    if (row) sessionLedger.upsert({ ...row, state: 'exited', updatedAt: Date.now() });
  });
  sessionManager.on('removed', (id) => sessionLedger.remove(id));
  setInterval(() => sessionLedger.flushAll(), 10000).unref?.();
```

把 `buildWorkspace` 的 return 语句加上 `sessionLedger`：

```js
  return { projects, saveProjects, workflows, sessionManager, workflowRunner, engine, collabMount, usageMount, usageReporter, scheduler, httpApi, llmMount, translateMount, llmVault, usageStore, taskStore, sessionLedger, historyFile: paths.historyFile, paths };
```

- [ ] **Step 3: initWorkspace 里非阻塞触发恢复**

在 `initWorkspace` 的 `if (!gateway) { gateway = createGateway(...) }` 之后加：

```js
  void restoreSessions({
    ledger: ws.sessionLedger,
    sessionManager: ws.sessionManager,
    agents: loadDevflowConfig(configFile).agents.list || [],
    logger: log,
  }).then((r) => {
    if (r.restored || r.skipped.length) log.info(`session restore: restored=${r.restored} skipped=${r.skipped.length}`);
  }).catch((e) => log.warn('session restore failed', (e && e.message) || e));
```

> `configFile` 是 `server/index.js:63` 的模块级变量，`buildWorkspace` 与 `initWorkspace` 均可见，直接使用即可。

- [ ] **Step 4: 语法与既有测试自检**

Run: `node --check server/index.js; node --test "server/test/ws-gateway.test.js" "server/test/session-manager.test.js" "server/test/session-ledger.test.js" "server/test/session-restore.test.js" "server/test/agent-resume.test.js"`
Expected: `node --check` 无输出即通过；测试全 PASS

- [ ] **Step 5: 提交**

```bash
git add server/index.js
git commit -m "feat(session): 接线会话账本、启动恢复与 opencode 会话发现"
```

---

### Task 9: shared + useTerminal 类型与透传

**Files:**
- Modify: `shared/index.d.ts:17`
- Modify: `web/src/useTerminal.ts:5,123-126`
- Test: `web/src/useTerminal.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/useTerminal.test.ts` 的 createSession 用例里，`expect(ws.sent.at(-1)!.type).toBe(C2S.CREATE);` 之后插入：

```ts
    expect(ws.sent.at(-1)).toMatchObject({ kind: 'agent', agentId: 'opencode', agentCmd: 'opencode' });
```

把该用例的调用改为：

```ts
    const p = hook.term.createSession({ projectId: 'p1', cols: 90, rows: 30, kind: 'agent', agentId: 'opencode', agentCmd: 'opencode' });
```

在 `收 session-list 更新 store.sessions` 用例末尾追加：

```ts
    const restored = { ...fake, id: 's2', restored: true, kind: 'agent' as const, agentId: 'opencode' };
    ws.emitMessage({ type: S2C.SESSION_LIST, sessions: [restored] });
    expect(hook.term.state.sessions[0].restored).toBe(true);
    expect(hook.term.state.sessions[0].kind).toBe('agent');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:web`
Expected: FAIL（TS 报 `kind` 不在 `createSession` 参数类型 / 发送 payload 缺字段）

- [ ] **Step 3: 实现**

`shared/index.d.ts` 第 17 行 `SessionSummary` 改为：

```ts
export interface SessionSummary { id: string; name: string; projectId: string | null; state: 'running' | 'exited'; cwd: string; cols: number; rows: number; exitCode: number | null; kind?: 'agent' | 'shell' | 'workflow'; agentId?: string | null; restored?: boolean; }
```

`web/src/useTerminal.ts` 第 5 行同步改为：

```ts
export interface SessionSummary { id: string; name: string; projectId: string | null; state: 'running' | 'exited'; cwd: string; cols: number; rows: number; exitCode: number | null; kind?: 'agent' | 'shell' | 'workflow'; agentId?: string | null; restored?: boolean; }
```

`createSession` 签名改为：

```ts
    createSession(input: { projectId?: string | null; cols?: number; rows?: number; kind?: 'agent' | 'shell'; agentId?: string | null; agentCmd?: string | null }) {
      send(C2S.CREATE, { ...input });
      return new Promise<SessionSummary>((resolve) => { createdResolve = resolve; });
    },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add shared/index.d.ts web/src/useTerminal.ts web/src/useTerminal.test.ts
git commit -m "feat(web): 会话类型透传 kind/agentId/restored"
```

---

### Task 10: 前端恢复认领（纯函数 + TerminalView 接线）

**Files:**
- Create: `web/src/sessionRestore.ts`
- Test: `web/src/sessionRestore.test.ts`
- Modify: `web/src/components/TerminalView.vue:254-263,317-338,684-694`

- [ ] **Step 1: 写失败测试**

创建 `web/src/sessionRestore.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { pickRestoredAgent, restoredAgentIds } from './sessionRestore';
import type { SessionSummary } from './useTerminal';

const s = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id, name: id, projectId: 'p1', state: 'running', cwd: '', cols: 80, rows: 24, exitCode: null, ...extra,
});

describe('sessionRestore', () => {
  it('pickRestoredAgent 只挑 restored 且 kind=agent 的第一条', () => {
    const list = [s('s1'), s('s2', { restored: true, kind: 'shell' }), s('s3', { restored: true, kind: 'agent', agentId: 'opencode' })];
    expect(pickRestoredAgent(list)?.id).toBe('s3');
    expect(pickRestoredAgent([s('s1')])).toBeNull();
  });

  it('restoredAgentIds 返回全部已恢复 agent 会话 id', () => {
    const list = [s('s1', { restored: true, kind: 'agent' }), s('s2'), s('s3', { restored: true, kind: 'agent' })];
    expect(restoredAgentIds(list)).toEqual(['s1', 's3']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:web`
Expected: FAIL（`Cannot find module './sessionRestore'`）

- [ ] **Step 3: 实现纯函数**

创建 `web/src/sessionRestore.ts`：

```ts
import type { SessionSummary } from './useTerminal';

// 恢复会话的挑选逻辑抽成纯函数，便于单测；服务端负责注入续会话命令，前端只认领与展示。
export function pickRestoredAgent(sessions: SessionSummary[]): SessionSummary | null {
  return sessions.find((s) => !!s.restored && s.kind === 'agent') || null;
}

export function restoredAgentIds(sessions: SessionSummary[]): string[] {
  return sessions.filter((s) => !!s.restored && s.kind === 'agent').map((s) => s.id);
}
```

- [ ] **Step 4: TerminalView 接线**

在 `web/src/components/TerminalView.vue` 的 import 区加：

```ts
import { pickRestoredAgent, restoredAgentIds } from '../sessionRestore';
```

`createNew()`（约 254-263 行）中 `createSession` 调用改为：

```ts
  const s = await props.terminal.createSession({
    projectId: props.projectId, cols: 80, rows: 24,
    kind: c.cmd ? 'agent' : 'shell', agentId: c.cmd ? c.id : null, agentCmd: c.cmd || null,
  });
```

`startAgent()`（约 324 行）中 `createSession` 调用改为：

```ts
  const s = await props.terminal.createSession({
    projectId: pid, cols: 80, rows: 24,
    kind: 'agent', agentId: agentId.value, agentCmd: agentCmd.value,
  });
```

> `restartAgentForProject()` 内部走的是 `startAgent()`，无需单独改。

`SESSION_LIST` 处理器（约 684-694 行）改为：

```ts
  unsubList = props.terminal.on(S2C.SESSION_LIST, () => {
    if (autoTried || props.terminal.state.activeSessionId) return;
    autoTried = true;
    const adopted = pickRestoredAgent(props.terminal.state.sessions);
    if (adopted) {
      for (const id of restoredAgentIds(props.terminal.state.sessions)) markAgent(id);
      agentSid.value = adopted.id;
      agentProjectId.value = adopted.projectId ?? null;
      agentAtStart.value = adopted.agentId || agentId.value;
      agentStarted.value = true;
      agentCliReady.value = true;                 // 服务端已注入续会话命令，不再重复注入
      props.terminal.switchTo(adopted.id);
      return;
    }
    const existing = props.terminal.state.sessions.find((s) => agentSids.value.has(s.id));
    if (existing) {
      agentSid.value = existing.id;
      agentProjectId.value = existing.projectId ?? null;
      props.terminal.switchTo(existing.id);
      if (props.projectId && existing.projectId !== props.projectId) void restartAgentForProject();
    } else startAgent();
  });
```

- [ ] **Step 5: 运行校验**

Run: `npm.cmd run typecheck`
Expected: PASS；web 测试全绿

- [ ] **Step 6: 提交**

```bash
git add web/src/sessionRestore.ts web/src/sessionRestore.test.ts web/src/components/TerminalView.vue
git commit -m "feat(web): 认领服务端恢复的 agent 会话，不重复注入命令"
```

---

### Task 11: 修订既有设计文档（对齐实现取舍）

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-window-restore-design.md:17,28,307-313`
- Modify: `docs/superpowers/specs/2026-09-17-session-persist-restore-design.md`（§4.3、§7）

- [ ] **Step 1: 修订 window-restore spec**

- 第 17 行表格第 1 行「会话页签列表沿用现有自动恢复，不做持久化」→ 改为「会话页签由 `2026-09-17-session-persist-restore-design.md` 的会话账本负责持久化与重启恢复」。
- 第 28 行表格第 12 行「opencode 会话续接 | **不做**」→ 改为「opencode 会话续接 | 由 `session-persist-restore` 设计承担（`--session <id>`）」。
- §8 第 309 行「opencode 会话续接（`--continue` / `--session`）：本设计不做」→ 删除该条，改为指向新设计。
- §8 第 312 行「会话页签自身的持久化（沿用服务端 `SESSION_LIST` 自动恢复）」→ 改为「会话页签的持久化与重启恢复见 `session-persist-restore` 设计」。

- [ ] **Step 2: 修订 session-persist-restore spec**

- §4.3「可选弹一条状态提示」—— 明确 v1 **不弹提示**（页签与回滚已足够表达），把该节改为「不新增用户可见文案，因此无需新增 i18n 词条」。
- §7 修改清单里去掉 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`。

- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/specs/2026-09-17-window-restore-design.md docs/superpowers/specs/2026-09-17-session-persist-restore-design.md
git commit -m "docs(session): 对齐会话恢复实现取舍，修订 window-restore 旧约束"
```

---

### Task 12: 全量验证与手动冒烟

**Files:** 无（仅验证）

- [ ] **Step 1: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 2: 全量测试**

Run: `npm.cmd test`
Expected: server（`node --test "server/test/*.test.js"`）+ web（vitest）全 PASS

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 零中文命中（本设计不新增用户可见文案，应无新命中）

- [ ] **Step 4: 手动冒烟（dev）**

1. `npm.cmd run dev:server`（dev 端口 33333）+ `npm.cmd run dev:web`，打开 http://localhost:5173。
2. 在固定 Agent 页签里发一句话，确认 opencode 会话建立；等 ≥15s 让发现回填。
3. 检查 `<数据目录>/ports/33333/sessions.json` 含该会话记录且有 `agentSessionId`。
4. 重启 dev:server（Ctrl-C 后重跑），刷新页面：
   - 原会话页签按原名回来，终端显示重启前回滚；
   - Agent 自动以 `opencode --session <id>` 续上，能引用上一轮内容。
5. 关闭某个会话页签（kill）→ 账本里该记录与 `session-logs/<id>.log` 被删除；再重启不再出现。

- [ ] **Step 5: 收尾提交（若冒烟中有微调）**

```bash
git status
git add <本次涉及文件>
git commit -m "fix(session): 冒烟修正"
```

---

## 完成标准

- 后端重启后，`sessions.json` 中的会话按原 id/名字/目录恢复，终端回滚可见。
- opencode agent 会话自动续接上下文；未发现 id 时退回普通 agent + 回滚（不报错）。
- 用户 kill 的会话永久不再恢复；`workflow` 会话不入账本。
- `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run check:i18n` 全绿。
