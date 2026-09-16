# 机器用量上报（token 上报替换签名信封）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** slave 只粘一个 master 访问链接，就每 60–90 分钟随机把本机 `opencode stats` 用量推给 master；master 收下并汇总展示；彻底删掉旧的「加群 + Ed25519 签名信封」上报路径。

**Architecture:** 新增三个独立小模块：`server/usage-peers.js`（master 侧落库：每机器最新一份）、`server/usage-report.js`（slave 侧：链接解析 + 定时上报）、`server/remote-invite.js`（邀请令牌落盘，`expiresAt=0` 表示长期不过期）；三者通过新的 `server/usage-mount.js`（HTTP 面）暴露给前端与远端。`server/index.js` 负责装配，`engine`/`store`/`http-mount`/`shared` 中旧的 heartbeat 语义全部移除。

**Tech Stack:** Node 24 ESM（`node --test`，全局 `fetch`）、Vue3 + TS（vitest）、文件型 JSON 存储（沿用 `CollabStore` 的写法）、PowerShell 无关（无启动器改动）。

---

## 文件结构

**新建**

| 文件 | 职责 |
| --- | --- |
| `server/usage-peers.js` | master 侧上报库：`UsagePeersStore`（`upsert`/`list`/`get`/`snapshot`/`save`），落 `<dataDir>/usage-peers.json` |
| `server/usage-report.js` | slave 侧：`parseInviteLink`、`nextDelay`、`loadReportConfig`/`saveReportConfig`、`createUsageReporter` |
| `server/remote-invite.js` | 邀请令牌落盘：`isInviteActive`、`loadInvite`、`saveInvite`、`clearInvite` |
| `server/usage-mount.js` | `/api/usage/*` 的 HTTP 面：收上报、看汇总、配上报器、立刻上报 |
| `server/test/usage-peers.test.js` | 上报库单测 |
| `server/test/usage-report.test.js` | 链接解析 / 间隔 / 上报器单测 |
| `server/test/usage-report-http.test.js` | `/api/usage/*` 端到端单测 |
| `server/test/remote-invite.test.js` | 令牌落盘单测 |
| `web/src/collaboration/usagePeers.ts` | 前端纯函数：行数据整理、在线判定、数字格式化 |
| `web/src/collaboration/usagePeers.test.ts` | 上述纯函数单测 |
| `web/src/collaboration/UsageView.vue` | 「机器用量」视图（汇总表 + 上报到 master 配置） |

**修改**

| 文件 | 改动 |
| --- | --- |
| `docs/superpowers/specs/2026-09-16-usage-report-design.md` | 汇总接口改名 `GET /api/usage` → `GET /api/usage/peers`（避免与既有 LLM `/api/usage` 冲突） |
| `server/port-paths.js` | 加 `usagePeersFile`、`usageReportFile`、`inviteFile` |
| `server/remote-gate.js` | `isPeerRequest` 放行 `POST /api/usage/report`；新增 `resolveInviteDaysAllowForever` |
| `server/index.js` | 装配 peers/reporter/mount；令牌落盘读写成败；`/api/usage/` 前缀派发 |
| `server/collaboration/engine.js` | 删 `reportHeartbeat`/`_storeHeartbeat`/`_inHeartbeat`/`_inStats`/`_heartbeatRecord`/`writeUsageSnapshot`；`peers` 依赖注入 |
| `server/collaboration/store.js` | 删 `heartbeats` 字段与 `listHeartbeats`/`getHeartbeat`/`setHeartbeat` |
| `server/collaboration/http-mount.js` | 删 `POST /api/collab/stats` 分支；snapshot/downloads 的用量改读 `engine.peers` |
| `shared/collab.js` / `shared/collab.d.ts` | 删 `CollabPeer.HEARTBEAT`、`CollabPeer.STATS` |
| `server/test/collab-store.test.js` / `collab-const.test.js` / `collab-http.test.js` | 同步删除旧语义断言 |
| `web/src/collaboration/CollaborationView.vue` | 加第三个 tab `usage` |
| `web/src/App.vue` | `collabTab` 与 hash 支持 `usage` |
| `shared/i18n/zh-CN.js` / `en.js` | 新增 `usage.*` 词条（中英同时补齐） |
| `AGENTS.md` | 记一条：用量上报靠 master 链接令牌，与加群解耦 |

**删除**

- `server/collaboration/heartbeat.js`、`server/test/heartbeat.test.js`

---

### Task 1: 修正 spec 里的汇总接口名（避免路径冲突）

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-usage-report-design.md`

- [ ] **Step 1: 改 spec 中的接口名**

把 `### 4.2 \`GET /api/usage\`（仅 master，供本机界面）` 改成 `### 4.2 \`GET /api/usage/peers\`（仅 master，供本机界面）`，并在该节末尾补一行说明：

```markdown
> 命名为 `/api/usage/peers` 而不是 `/api/usage`：`server/index.js:500` 已有 `GET /api/usage`（LLM token 用量，读 `usage.db`），不能复用同一路径。
```

同时把第 8 节里的「群成员列表的用量列改读同一份数据（`GET /api/usage`）」改成 `GET /api/usage/peers`。

- [ ] **Step 2: 校验没有残留的错误路径**

Run: `Select-String -Path docs/superpowers/specs/2026-09-16-usage-report-design.md -Pattern "GET /api/usage\b"`
Expected: 无输出（只剩 `/api/usage/peers` 与 `/api/usage/report`）

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-16-usage-report-design.md
git commit -m "docs(spec): 汇总接口改名 /api/usage/peers，避免与既有 LLM /api/usage 冲突"
```

---

### Task 2: 端口路径加三个新文件位置

**Files:**
- Modify: `server/port-paths.js`
- Test: `server/test/port-paths.test.js`

- [ ] **Step 1: 先改测试（红）**

在 `server/test/port-paths.test.js` 的 `portPaths 全部落在 ports/<端口> 下` 用例里，`assert.equal(p.skillsRoot, ...)` 之前插入：

```js
  assert.equal(p.usagePeersFile, path.join(base, 'usage-peers.json'));
  assert.equal(p.usageReportFile, path.join(base, 'usage-report.json'));
  assert.equal(p.inviteFile, path.join(base, 'collab', 'invite.json'));
```

Run: `node --test "server/test/port-paths.test.js"`
Expected: FAIL（`undefined !== '...\\usage-peers.json'`）

- [ ] **Step 2: 改实现**

`server/port-paths.js` 里 `historyFile` 行之后加：

```js
    usagePeersFile: path.join(dir, 'usage-peers.json'),
    usageReportFile: path.join(dir, 'usage-report.json'),
    inviteFile: path.join(dir, 'collab', 'invite.json'),
```

- [ ] **Step 3: 跑测试（绿）**

Run: `node --test "server/test/port-paths.test.js"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/port-paths.js server/test/port-paths.test.js
git commit -m "feat(server): 端口路径补充 usage-peers/usage-report/invite 文件位置"
```

---

### Task 3: master 侧上报库 `UsagePeersStore`

**Files:**
- Create: `server/usage-peers.js`
- Test: `server/test/usage-peers.test.js`

- [ ] **Step 1: 写失败测试**

`server/test/usage-peers.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsagePeersStore, emptyPeers } from '../usage-peers.js';

function tmpFile(name = 'usage-peers.json') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-peers-')), name);
}

test('空文件时返回空结构', () => {
  const s = new UsagePeersStore({ file: tmpFile() });
  assert.deepEqual(s.snapshot(), emptyPeers());
  assert.equal(s.get('nobody'), null);
});

test('upsert 落盘并按 machineId 只留最新一份', () => {
  const file = tmpFile();
  const s = new UsagePeersStore({ file });
  s.upsert({ machineId: 'm1', username: 'u1', sessions: 1, days: 7, messages: 2, input: 100, output: 10 }, 1000);
  s.upsert({ machineId: 'm1', username: 'u1', sessions: 3, days: 7, messages: 9, input: 999, output: 99 }, 2000);
  s.upsert({ machineId: 'm2', username: 'u2', sessions: 5 }, 3000);

  const snap = s.snapshot();
  assert.equal(snap.updatedAt, 3000);
  assert.deepEqual(Object.keys(snap.peers).sort(), ['m1', 'm2']);
  assert.equal(snap.peers.m1.sessions, 3);
  assert.equal(snap.peers.m1.input, 999);
  assert.equal(snap.peers.m1.receivedAt, 2000);

  const again = new UsagePeersStore({ file });
  assert.equal(again.get('m1').messages, 9);
  assert.equal(again.get('m2').receivedAt, 3000);
});

test('缺 machineId 不落库，返回 null', () => {
  const s = new UsagePeersStore({ file: tmpFile() });
  assert.equal(s.upsert({ sessions: 1 }, 1000), null);
  assert.deepEqual(s.snapshot().peers, {});
});

test('文件损坏时回退空结构而不是抛错', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not json', 'utf8');
  const s = new UsagePeersStore({ file, logger: { warn() {} } });
  assert.deepEqual(s.snapshot(), emptyPeers());
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/usage-peers.test.js"`
Expected: FAIL（无法解析 `../usage-peers.js`）

- [ ] **Step 3: 实现**

`server/usage-peers.js`：

```js
import fs from 'node:fs';
import path from 'node:path';

export function emptyPeers() {
  return { updatedAt: 0, peers: {} };
}

// master 侧上报库：每台机器只留最新一份（按 machineId upsert）
export class UsagePeersStore {
  constructor({ file, logger = console }) {
    this.file = file;
    this.log = logger;
    this.data = this._load();
  }

  _load() {
    if (!this.file || !fs.existsSync(this.file)) return emptyPeers();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const peers = raw && typeof raw.peers === 'object' && raw.peers ? raw.peers : {};
      return { updatedAt: Number(raw && raw.updatedAt) || 0, peers };
    } catch (e) {
      this.log?.warn?.('usage-peers load failed', (e && e.message) || e);
      return emptyPeers();
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      this.log?.warn?.('usage-peers save failed', (e && e.message) || e);
    }
    return this.data;
  }

  upsert(usage, now = Date.now()) {
    const machineId = String((usage && usage.machineId) || '');
    if (!machineId) return null;
    this.data.peers[machineId] = { ...usage, machineId, receivedAt: now };
    this.data.updatedAt = now;
    this.save();
    return this.data.peers[machineId];
  }

  list() { return this.data.peers; }
  get(machineId) { return this.data.peers[machineId] || null; }
  snapshot() { return { updatedAt: this.data.updatedAt, peers: this.data.peers }; }
}
```

- [ ] **Step 4: 跑测试（绿）**

Run: `node --test "server/test/usage-peers.test.js"`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add server/usage-peers.js server/test/usage-peers.test.js
git commit -m "feat(server): 新增 master 侧用量上报库 UsagePeersStore"
```

---

### Task 4: 邀请令牌落盘 + 长期不过期

**Files:**
- Create: `server/remote-invite.js`
- Modify: `server/remote-gate.js`
- Test: `server/test/remote-invite.test.js`, `server/test/remote-gate.test.js`, `server/test/collab-remote.test.js`

- [ ] **Step 1: 写失败测试**

`server/test/remote-invite.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInviteActive, loadInvite, saveInvite, clearInvite } from '../remote-invite.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-invite-')), 'collab', 'invite.json');
}

test('saveInvite 落盘、loadInvite 读回（含自动建目录）', () => {
  const file = tmpFile();
  assert.equal(loadInvite(file), null);
  saveInvite(file, { token: 'tk', password: 'pw', expiresAt: 123 });
  assert.deepEqual(loadInvite(file), { token: 'tk', password: 'pw', expiresAt: 123 });
});

test('clearInvite 删除文件且不抛错', () => {
  const file = tmpFile();
  saveInvite(file, { token: 'tk', password: 'pw', expiresAt: 0 });
  clearInvite(file);
  assert.equal(loadInvite(file), null);
  clearInvite(file);   // 幂等
});

test('isInviteActive：expiresAt=0 永久有效；过期/无 token 无效', () => {
  assert.equal(isInviteActive({ token: 'tk', expiresAt: 0 }, 9e12), true);
  assert.equal(isInviteActive({ token: 'tk', expiresAt: 1000 }, 999), true);
  assert.equal(isInviteActive({ token: 'tk', expiresAt: 1000 }, 1001), false);
  assert.equal(isInviteActive(null, 1), false);
  assert.equal(isInviteActive({ expiresAt: 0 }, 1), false);
});

test('文件损坏时 loadInvite 返回 null', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json', 'utf8');
  assert.equal(loadInvite(file), null);
});
```

在 `server/test/remote-gate.test.js` 顶部 import 里加 `resolveInviteDaysAllowForever`，并新增用例：

```js
test('resolveInviteDaysAllowForever：days=0 表示长期，其它沿用 resolveInviteDays', () => {
  assert.equal(resolveInviteDaysAllowForever({ days: 0 }), 0);
  assert.equal(resolveInviteDaysAllowForever({ days: '0' }), 0);
  assert.equal(resolveInviteDaysAllowForever({}), DEFAULT_INVITE_DAYS);
  assert.equal(resolveInviteDaysAllowForever({ days: 7 }), 7);
  assert.equal(resolveInviteDaysAllowForever({ days: 9999 }), MAX_INVITE_DAYS);
});

test('isPeerRequest：放行 POST /api/usage/report', () => {
  assert.equal(isPeerRequest('/api/usage/report', 'POST'), true);
  assert.equal(isPeerRequest('/api/usage/report', 'GET'), false);
});
```

Run: `node --test "server/test/remote-invite.test.js" "server/test/remote-gate.test.js"`
Expected: FAIL（模块不存在 / 函数未导出）

- [ ] **Step 2: 实现 `server/remote-invite.js`**

```js
import fs from 'node:fs';
import path from 'node:path';

// 邀请令牌落盘：expiresAt === 0 表示长期不过期（供 slave 长期用量上报复用）
export function isInviteActive(invite, now = Date.now()) {
  if (!invite || typeof invite.token !== 'string' || !invite.token) return false;
  const exp = Number(invite.expiresAt);
  return exp === 0 || now < exp;
}

export function loadInvite(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v.token === 'string' && v.token ? v : null;
  } catch { return null; }
}

export function saveInvite(file, invite) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(invite, null, 2), 'utf8');
  return invite;
}

export function clearInvite(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
}
```

- [ ] **Step 3: 改 `server/remote-gate.js`**

`isPeerRequest` 改为：

```js
export function isPeerRequest(pathname, method) {
  if (method !== 'POST') return false;
  return pathname === '/api/collab/peer' || pathname === '/api/usage/report';
}
```

（`/api/collab/stats` 同时从这里移除，因为该路由在 Task 8 被删除。）

文件末尾加：

```js
// days=0 表示「长期不过期」（用作用量上报的长期令牌）；其它值沿用 resolveInviteDays
export function resolveInviteDaysAllowForever(input = {}) {
  if (Number(input.days) === 0) return 0;
  return resolveInviteDays(input);
}
```

- [ ] **Step 4: 跑测试（绿）**

Run: `node --test "server/test/remote-invite.test.js" "server/test/remote-gate.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/remote-invite.js server/remote-gate.js server/test/remote-invite.test.js server/test/remote-gate.test.js
git commit -m "feat(server): 邀请令牌落盘（expiresAt=0 长期有效），peer 白名单换到 /api/usage/report"
```

---

### Task 5: slave 侧链接解析与间隔（纯函数）

**Files:**
- Create: `server/usage-report.js`
- Test: `server/test/usage-report.test.js`

- [ ] **Step 1: 写失败测试**

`server/test/usage-report.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseInviteLink, nextDelay, loadReportConfig, saveReportConfig,
  MIN_INTERVAL_MS, MAX_INTERVAL_MS,
} from '../usage-report.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-report-')), 'usage-report.json');
}

test('parseInviteLink：解析 master 访问链接的 host/port/token', () => {
  assert.deepEqual(parseInviteLink('http://192.168.1.5:22222/?access=abc123'),
    { masterUrl: 'http://192.168.1.5:22222', token: 'abc123' });
  assert.deepEqual(parseInviteLink('  http://127.0.0.1:12345/?access=tk  '),
    { masterUrl: 'http://127.0.0.1:12345', token: 'tk' });
});

test('parseInviteLink：缺 token / 非 http / 空串都报 bad-link', () => {
  assert.deepEqual(parseInviteLink('http://127.0.0.1:22222/'), { error: 'bad-link' });
  assert.deepEqual(parseInviteLink('ftp://127.0.0.1:22222/?access=tk'), { error: 'bad-link' });
  assert.deepEqual(parseInviteLink(''), { error: 'bad-link' });
  assert.deepEqual(parseInviteLink('随便一串'), { error: 'bad-link' });
});

test('nextDelay 落在 60–90 分钟闭区间内', () => {
  assert.equal(nextDelay(() => 0), MIN_INTERVAL_MS);
  assert.equal(nextDelay(() => 1 - Number.EPSILON), MAX_INTERVAL_MS - 1);
  for (let i = 0; i < 200; i += 1) {
    const d = nextDelay();
    assert.ok(d >= MIN_INTERVAL_MS && d < MAX_INTERVAL_MS, String(d));
  }
  assert.equal(MIN_INTERVAL_MS, 60 * 60 * 1000);
  assert.equal(MAX_INTERVAL_MS, 90 * 60 * 1000);
});

test('loadReportConfig 默认值 / saveReportConfig 落盘读回', () => {
  const file = tmpFile();
  assert.deepEqual(loadReportConfig(file), { masterUrl: '', token: '', days: 7 });
  saveReportConfig(file, { masterUrl: 'http://a:1', token: 'tk', days: 3 });
  assert.deepEqual(loadReportConfig(file), { masterUrl: 'http://a:1', token: 'tk', days: 3 });
  fs.writeFileSync(file, 'broken', 'utf8');
  assert.deepEqual(loadReportConfig(file), { masterUrl: '', token: '', days: 7 });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/usage-report.test.js"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 只实现这四个纯函数**

`server/usage-report.js` 先写这部分（`createUsageReporter` 在 Task 6 加）：

```js
import fs from 'node:fs';
import path from 'node:path';

export const MIN_INTERVAL_MS = 60 * 60 * 1000;   // 60 分钟
export const MAX_INTERVAL_MS = 90 * 60 * 1000;   // 90 分钟
const DEFAULT_CONFIG = { masterUrl: '', token: '', days: 7 };

// 解析 master 的访问链接：http://<host>:<port>/?access=<token>
export function parseInviteLink(link) {
  let u;
  try { u = new URL(String(link || '').trim()); } catch { return { error: 'bad-link' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'bad-link' };
  const token = u.searchParams.get('access') || '';
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (!u.hostname || !port || !token) return { error: 'bad-link' };
  return { masterUrl: `${u.protocol}//${u.hostname}:${port}`, token };
}

export function nextDelay(random = Math.random) {
  return MIN_INTERVAL_MS + Math.floor(random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS));
}

export function loadReportConfig(file) {
  if (!file || !fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      masterUrl: typeof raw.masterUrl === 'string' ? raw.masterUrl : '',
      token: typeof raw.token === 'string' ? raw.token : '',
      days: Number.isFinite(Number(raw.days)) && Number(raw.days) > 0 ? Number(raw.days) : DEFAULT_CONFIG.days,
    };
  } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveReportConfig(file, cfg) {
  const next = {
    masterUrl: String((cfg && cfg.masterUrl) || ''),
    token: String((cfg && cfg.token) || ''),
    days: Number.isFinite(Number(cfg && cfg.days)) && Number(cfg.days) > 0 ? Number(cfg.days) : DEFAULT_CONFIG.days,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
```

- [ ] **Step 4: 跑测试（绿）**

Run: `node --test "server/test/usage-report.test.js"`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add server/usage-report.js server/test/usage-report.test.js
git commit -m "feat(server): slave 侧链接解析/间隔/配置读写（60-90 分钟）"
```

---

### Task 6: slave 侧上报器 `createUsageReporter`

**Files:**
- Modify: `server/usage-report.js`
- Test: `server/test/usage-report.test.js`

- [ ] **Step 1: 追加上报器测试（红）**

在 `server/test/usage-report.test.js` 末尾追加（并把 import 补上 `createUsageReporter` 与 `collectAgentStats` 不引入，直接用注入的假 `collect`）：

```js
test('reportNow：未配置时直接失败，不调用 collect', async () => {
  const file = tmpFile();
  const calls = [];
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    collect: async () => { calls.push('collect'); return {}; },
    fetchFn: async () => { calls.push('fetch'); return { ok: true, json: async () => ({ ok: true }) }; },
  });
  const out = await r.reportNow();
  assert.equal(out.ok, false);
  assert.equal(out.error, 'not-configured');
  assert.deepEqual(calls, []);
});

test('reportNow：带 X-DF-Token POST 到 /api/usage/report，body 带机器身份与用量', async () => {
  const file = tmpFile();
  saveReportConfig(file, { masterUrl: 'http://10.0.0.9:22222', token: 'tk', days: 7 });
  const seen = [];
  const r = createUsageReporter({
    file,
    identity: () => ({ machineId: 'm1', employeeId: 'e1', username: 'u1', host: '10.0.0.2', port: 22222 }),
    collect: async ({ cmd, days }) => ({ agent: cmd, days, sessions: 4, messages: 8, input: 1000, output: 100 }),
    fetchFn: async (url, opts) => { seen.push({ url, opts }); return { ok: true, json: async () => ({ ok: true }) }; },
    cmd: 'opencode',
  });
  const out = await r.reportNow();
  assert.equal(out.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'http://10.0.0.9:22222/api/usage/report');
  assert.equal(seen[0].opts.method, 'POST');
  assert.equal(seen[0].opts.headers['X-DF-Token'], 'tk');
  const body = JSON.parse(seen[0].opts.body);
  assert.equal(body.machineId, 'm1');
  assert.equal(body.employeeId, 'e1');
  assert.equal(body.host, '10.0.0.2');
  assert.equal(body.usage.sessions, 4);
  assert.equal(r.status().lastOk, true);
  assert.equal(r.status().lastError, '');
});

test('reportNow：403 bad-token 记入 lastError 且不抛错', async () => {
  const file = tmpFile();
  saveReportConfig(file, { masterUrl: 'http://10.0.0.9:22222', token: 'bad' });
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 1 }),
    fetchFn: async () => ({ ok: false, status: 403, json: async () => ({ error: 'bad-token' }) }),
  });
  const out = await r.reportNow();
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
  assert.equal(r.status().lastOk, false);
  assert.equal(r.status().lastError, 'bad-token');
});

test('setConfig：保存链接解析结果并回读', () => {
  const file = tmpFile();
  const r = createUsageReporter({ file, identity: () => ({ machineId: 'm1' }) });
  const cfg = r.setConfig({ masterUrl: 'http://a:22222', token: 'tk', days: 7 });
  assert.deepEqual(cfg, { masterUrl: 'http://a:22222', token: 'tk', days: 7 });
  assert.deepEqual(loadReportConfig(file), cfg);
});

test('start：启动立即上报一次，下一次延迟落在 60–90 分钟', async () => {
  const file = tmpFile();
  saveReportConfig(file, { masterUrl: 'http://a:22222', token: 'tk' });
  const delays = [];
  let reported = 0;
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 1 }),
    fetchFn: async () => { reported += 1; return { ok: true, json: async () => ({ ok: true }) }; },
    random: () => 0,
    scheduleFn: (fn, ms) => { delays.push(ms); return { unref() {} }; },
  });
  r.start();
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(reported, 1);
  assert.deepEqual(delays, [MIN_INTERVAL_MS]);
  r.stop();
});
```

Run: `node --test "server/test/usage-report.test.js"`
Expected: FAIL（`createUsageReporter is not a function`）

- [ ] **Step 2: 实现上报器**

在 `server/usage-report.js` 末尾追加（顶部补 `import { collectAgentStats } from './collaboration/agent-stats.js';`）：

```js
// slave 侧上报器：启动即报一次，之后 60–90 分钟随机再报
export function createUsageReporter({
  file, identity, cmd = 'opencode', collect = collectAgentStats,
  fetchFn = fetch, logger = console, random = Math.random,
  now = () => Date.now(), scheduleFn = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  let timer = null;
  let stopped = false;
  let status = { lastAt: 0, lastOk: null, lastError: '', nextAt: 0 };

  const config = () => loadReportConfig(file);
  const statusOf = () => ({ ...status, config: config() });

  async function reportNow() {
    const cfg = config();
    if (!cfg.masterUrl || !cfg.token) {
      status = { ...status, lastAt: now(), lastOk: false, lastError: 'not-configured' };
      return { ok: false, error: 'not-configured' };
    }
    let usage;
    try { usage = await collect({ cmd, days: cfg.days }); }
    catch (e) { usage = { agent: cmd, days: cfg.days, error: String((e && e.message) || e) }; }
    const me = (typeof identity === 'function' ? identity() : identity) || {};
    const body = {
      machineId: me.machineId || '', employeeId: me.employeeId || '', username: me.username || '',
      host: me.host || '', port: me.port || 0, usage,
    };
    try {
      const res = await fetchFn(`${cfg.masterUrl}/api/usage/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DF-Token': cfg.token },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      status = { ...status, lastAt: now(), lastOk: true, lastError: '' };
      return { ok: true };
    } catch (e) {
      const msg = String((e && e.message) || e);
      status = { ...status, lastAt: now(), lastOk: false, lastError: msg };
      logger?.warn?.('usage report failed', msg);
      return { ok: false, error: msg };
    }
  }

  function schedule() {
    if (stopped) return;
    const delay = nextDelay(random);
    status.nextAt = now() + delay;
    timer = scheduleFn(async () => { await reportNow(); schedule(); }, delay);
    if (timer && timer.unref) timer.unref();
  }

  return {
    config,
    status: statusOf,
    setConfig(patch) { return saveReportConfig(file, { ...config(), ...patch }); },
    reportNow,
    start() { stopped = false; reportNow().then(schedule); },
    stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
  };
}
```

- [ ] **Step 3: 跑测试（绿）**

Run: `node --test "server/test/usage-report.test.js"`
Expected: PASS（9 tests）

- [ ] **Step 4: Commit**

```bash
git add server/usage-report.js server/test/usage-report.test.js
git commit -m "feat(server): slave 侧用量上报器（启动即报 + 60-90 分钟随机）"
```

---

### Task 7: HTTP 面 `server/usage-mount.js`

**Files:**
- Create: `server/usage-mount.js`
- Test: `server/test/usage-report-http.test.js`

- [ ] **Step 1: 写失败测试**

`server/test/usage-report-http.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { UsagePeersStore } from '../usage-peers.js';
import { createUsageReporter } from '../usage-report.js';
import { createUsageMount } from '../usage-mount.js';

function tmp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-umount-')) + '/' + name; }

async function start({ token = 'good', peers, reporter, onReport } = {}) {
  const p = peers || new UsagePeersStore({ file: tmp('usage-peers.json') });
  const r = reporter || createUsageReporter({
    file: tmp('usage-report.json'), identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 1 }), fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  });
  const mount = createUsageMount({ peers: p, reporter: r, checkToken: (tk) => tk === token, onReport });
  const server = http.createServer((req, res) => mount(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  return { peers: p, reporter: r, port: server.address().port, server };
}

function call(port, method, p, { headers = {}, body } = {}) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

test('POST /api/usage/report：正确令牌 → 落库 + 触发 onReport', async () => {
  const seen = [];
  const A = await start({ onReport: (rec) => seen.push(rec) });
  const r = await call(A.port, 'POST', '/api/usage/report', {
    headers: { 'X-DF-Token': 'good' },
    body: { machineId: 'slave1', username: 'u1', host: '10.0.0.2', port: 22222, usage: { sessions: 3, days: 7, messages: 9, input: 111, output: 22 } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(A.peers.get('slave1').sessions, 3);
  assert.equal(A.peers.get('slave1').input, 111);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].machineId, 'slave1');
  assert.ok(A.peers.get('slave1').receivedAt > 0);
});

test('POST /api/usage/report：错误令牌 → 403 bad-token，不落库', async () => {
  const A = await start();
  const r = await call(A.port, 'POST', '/api/usage/report', { headers: { 'X-DF-Token': 'bad' }, body: { machineId: 'x', usage: {} } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'bad-token');
  assert.deepEqual(A.peers.snapshot().peers, {});
});

test('POST /api/usage/report：缺 machineId 或 usage 非对象 → 400 bad-body', async () => {
  const A = await start();
  const a = await call(A.port, 'POST', '/api/usage/report', { headers: { 'X-DF-Token': 'good' }, body: { usage: { sessions: 1 } } });
  assert.equal(a.status, 400);
  assert.equal(a.body.error, 'bad-body');
  const b = await call(A.port, 'POST', '/api/usage/report', { headers: { 'X-DF-Token': 'good' }, body: { machineId: 'm', usage: 'nope' } });
  assert.equal(b.status, 400);
  assert.equal(b.body.error, 'bad-body');
});

test('GET /api/usage/peers：返回 updatedAt 与 peers', async () => {
  const A = await start();
  await call(A.port, 'POST', '/api/usage/report', { headers: { 'X-DF-Token': 'good' }, body: { machineId: 'm9', usage: { sessions: 7 } } });
  const r = await call(A.port, 'GET', '/api/usage/peers');
  assert.equal(r.status, 200);
  assert.equal(r.body.peers.m9.sessions, 7);
  assert.ok(r.body.updatedAt > 0);
});

test('GET/POST /api/usage/reporter：配置读取、链接写入、坏链接 400', async () => {
  const A = await start();
  const before = await call(A.port, 'GET', '/api/usage/reporter');
  assert.equal(before.status, 200);
  assert.equal(before.body.config.masterUrl, '');

  const bad = await call(A.port, 'POST', '/api/usage/reporter', { body: { link: 'nope' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad-link');

  const ok = await call(A.port, 'POST', '/api/usage/reporter', { body: { link: 'http://10.0.0.9:22222/?access=tk' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.config.masterUrl, 'http://10.0.0.9:22222');
  assert.equal(ok.body.config.token, 'tk');

  const after = await call(A.port, 'GET', '/api/usage/reporter');
  assert.equal(after.body.config.masterUrl, 'http://10.0.0.9:22222');
});

test('POST /api/usage/reporter/now：立即上报并回状态', async () => {
  const file = tmp('usage-report.json');
  const reporter = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    collect: async () => ({ sessions: 2 }),
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  });
  reporter.setConfig({ masterUrl: 'http://a:22222', token: 'tk' });
  const A = await start({ reporter });
  const r = await call(A.port, 'POST', '/api/usage/reporter/now');
  assert.equal(r.status, 200);
  assert.equal(r.body.status.lastOk, true);
});

test('未知 /api/usage/* 路径 → 404', async () => {
  const A = await start();
  const r = await call(A.port, 'GET', '/api/usage/nope');
  assert.equal(r.status, 404);
});
```

Run: `node --test "server/test/usage-report-http.test.js"`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现 `server/usage-mount.js`**

```js
import { parseInviteLink } from './usage-report.js';

const MAX_BODY = 1024 * 1024;   // 上报体只放用量数字，1MB 足够

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// /api/usage/* 的 HTTP 面：远端收上报（令牌），本机界面看汇总/配上报器
export function createUsageMount({ peers, reporter, checkToken, onReport, logger = console }) {
  async function route(req, res, url) {
    const m = req.method;
    const seg = url.pathname.replace(/^\/api\/usage\/?/, '').split('/').filter(Boolean);

    if (seg[0] === 'report' && seg.length === 1 && m === 'POST') {
      const tk = String(req.headers['x-df-token'] || '');
      if (!checkToken || !checkToken(tk)) return sendJson(res, 403, { error: 'bad-token' });
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
      if (!body || typeof body.machineId !== 'string' || !body.machineId || !body.usage || typeof body.usage !== 'object' || Array.isArray(body.usage)) {
        return sendJson(res, 400, { error: 'bad-body' });
      }
      const rec = peers.upsert({
        ...body.usage,
        machineId: body.machineId,
        employeeId: typeof body.employeeId === 'string' ? body.employeeId : '',
        username: typeof body.username === 'string' ? body.username : '',
        host: typeof body.host === 'string' ? body.host : '',
        port: Number(body.port) || 0,
      });
      try { onReport?.(rec); } catch (e) { logger?.warn?.('usage onReport failed', (e && e.message) || e); }
      return sendJson(res, 200, { ok: true });
    }

    if (seg[0] === 'peers' && seg.length === 1 && m === 'GET') return sendJson(res, 200, peers.snapshot());

    if (seg[0] === 'reporter' && seg.length === 1 && m === 'GET') {
      return sendJson(res, 200, { config: reporter.config(), status: reporter.status() });
    }
    if (seg[0] === 'reporter' && seg.length === 1 && m === 'POST') {
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
      if (typeof body.link === 'string' && body.link.trim()) {
        const parsed = parseInviteLink(body.link);
        if (parsed.error) return sendJson(res, 400, { error: parsed.error });
        reporter.setConfig({ masterUrl: parsed.masterUrl, token: parsed.token, days: body.days });
      } else {
        reporter.setConfig({ masterUrl: body.masterUrl, token: body.token, days: body.days });
      }
      return sendJson(res, 200, { config: reporter.config(), status: reporter.status() });
    }
    if (seg[0] === 'reporter' && seg[1] === 'now' && seg.length === 2 && m === 'POST') {
      await reporter.reportNow();
      return sendJson(res, 200, { status: reporter.status() });
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  return (req, res, url) => {
    const u = url || new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/api/usage/')) return sendJson(res, 404, { error: 'not found' });
    route(req, res, u).catch((e) => {
      logger?.error?.('usage mount error', e);
      sendJson(res, 500, { error: 'internal' });
    });
  };
}
```

- [ ] **Step 3: 跑测试（绿）**

Run: `node --test "server/test/usage-report-http.test.js"`
Expected: PASS（7 tests）

- [ ] **Step 4: Commit**

```bash
git add server/usage-mount.js server/test/usage-report-http.test.js
git commit -m "feat(server): /api/usage/* HTTP 面（收上报/看汇总/配上报器/立刻上报）"
```

---

### Task 8: 删除旧签名信封链路（engine / store / http-mount / shared）

**Files:**
- Modify: `server/collaboration/engine.js`, `server/collaboration/store.js`, `server/collaboration/http-mount.js`, `shared/collab.js`, `shared/collab.d.ts`
- Modify: `server/test/collab-store.test.js`, `server/test/collab-const.test.js`, `server/test/collab-http.test.js`
- Delete: `server/collaboration/heartbeat.js`, `server/test/heartbeat.test.js`

- [ ] **Step 1: 改测试（红）**

`server/test/collab-const.test.js`：删掉 `assert.equal(CollabPeer.HEARTBEAT, 'heartbeat');` 与 `assert.equal(CollabPeer.STATS, 'stats');` 两行。

`server/test/collab-store.test.js`：删掉整个 `heartbeats 表 upsert / list` 用例（`test('heartbeats ...` 起、到该 test 结束的 `});` 为止），并把该文件里其它引用 `setHeartbeat`/`listHeartbeats` 的断言一并删掉（`git grep -n "Heartbeat" server/test/collab-store.test.js` 自查，应为空）。

`server/test/collab-http.test.js:243` 那个用 `CollabPeer.STATS` 发信封的用例：整段删掉（`git grep -n "STATS" server/test/collab-http.test.js` 自查，应为空），并新增一个断言旧路由已消失的用例：

```js
test('旧路由 POST /api/collab/stats 已移除（404）', async () => {
  const A = await startNode('alice');
  try {
    const r = await post(`http://127.0.0.1:${A.port}/api/collab/stats`, { type: 'stats', payload: {} });
    assert.equal(r.status, 404);
  } finally { A.server.close(); }
});
```

新建 `server/test/usage-heartbeat-removed.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CollabPeer } from '@devflow/shared/collab';

test('旧的签名信封常量已删除', () => {
  assert.equal(CollabPeer.STATS, undefined);
  assert.equal(CollabPeer.HEARTBEAT, undefined);
});

test('旧的 heartbeat 模块与测试文件已删除', () => {
  const root = path.join(import.meta.dirname, '..');
  assert.equal(fs.existsSync(path.join(root, 'collaboration', 'heartbeat.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'test', 'heartbeat.test.js')), false);
});
```

Run: `node --test "server/test/collab-const.test.js" "server/test/usage-heartbeat-removed.test.js"`
Expected: FAIL（常量仍存在 / 文件仍存在）

- [ ] **Step 2: 删 shared 常量**

`shared/collab.js` 的 `CollabPeer` 里删掉 `HEARTBEAT: 'heartbeat',` 与 `STATS: 'stats',` 两行；`shared/collab.d.ts` 删掉同名两行。

- [ ] **Step 3: 删 store 心跳**

`server/collaboration/store.js`：删 `defaultData()` 里的 `heartbeats: {},` 行；删整段：

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

- [ ] **Step 4: 改 engine**

`server/collaboration/engine.js`：

1. 构造函数签名（`engine.js:43`）加 `peers` 并保存：

```js
  constructor({ store, identity, events = null, peer = null, peers = null, skillsRoot = null, inboxDir = null, uploadDir = null, downloadDir = null, downloadsDir = null, syncDir = null, runner = null, logger = console, getWorkflows = null, mergeWorkflows = null }) {
```

构造函数体里 `this.identity = identity;`（`engine.js:45`）之后加一行：

```js
    this.peers = peers;            // 用量上报库（master 侧），见 server/usage-peers.js
```
2. 删 `_heartbeatRecord`、`reportHeartbeat`、`_storeHeartbeat`、`_inHeartbeat`、`_inStats`、`writeUsageSnapshot` 六个方法。
3. `handleIncoming` 的 switch 里删掉：
   ```js
      case CollabPeer.HEARTBEAT: return this._inHeartbeat(env);
   ```
   与
   ```js
      case CollabPeer.STATS: return this._inStats(env);
   ```
4. pull-downloads 应用处（原 `if (data.usage && data.usage.members)` 那段）改为：
   ```js
      if (data.usage && data.usage.members) {
        for (const [mid, u] of Object.entries(data.usage.members)) this.peers?.upsert?.({ ...u, machineId: mid });
      }
   ```

- [ ] **Step 5: 改 http-mount**

`server/collaboration/http-mount.js`：

1. 删掉整段 `if (seg[0] === 'stats' && m === 'POST') { ... }`（连同其上方注释）。
2. `snapshot` 分支里的 `heartbeats: engine.store.listHeartbeats ? engine.store.listHeartbeats() : {},` 改为 `heartbeats: (engine.peers && engine.peers.list) ? engine.peers.list() : {},`
3. downloads 分支里的 `usage: { members: engine.store.listHeartbeats() }` 改为 `usage: { members: (engine.peers && engine.peers.list) ? engine.peers.list() : {} }`

- [ ] **Step 6: 删文件**

```bash
git rm server/collaboration/heartbeat.js server/test/heartbeat.test.js
```

- [ ] **Step 7: 跑全量 server 测试（绿）**

Run: `npm.cmd run test:server`
Expected: 全绿（原先 384 条 + 新增用例），且无 `heartbeat.test.js`

- [ ] **Step 8: Commit**

```bash
git add shared/collab.js shared/collab.d.ts server/collaboration/store.js server/collaboration/engine.js server/collaboration/http-mount.js server/test/collab-store.test.js server/test/collab-const.test.js server/test/collab-http.test.js server/test/usage-heartbeat-removed.test.js
git commit -m "refactor(server): 删除群内签名信封用量上报（engine/store/http-mount/shared）"
```

---

### Task 9: `server/index.js` 装配（令牌落盘 + mount 派发 + 上报器）

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 加 import**

在 `server/index.js` 顶部 import 区加（删掉旧行 `import { createHeartbeat } from './collaboration/heartbeat.js';`）：

```js
import { UsagePeersStore } from './usage-peers.js';
import { createUsageReporter } from './usage-report.js';
import { createUsageMount } from './usage-mount.js';
import { loadInvite, saveInvite, clearInvite, isInviteActive } from './remote-invite.js';
```

把 `resolveInviteDays` 的 import 改为：

```js
import { isPeerRequest, matchAccessToken, resolveInviteDaysAllowForever } from './remote-gate.js';
```

（`activeInvite()` 不再需要 `resolveInviteDays`；`git grep -n "resolveInviteDays(" server/` 自查，除新加的 `resolveInviteDaysAllowForever` 外应无引用。）

- [ ] **Step 2: 令牌落盘（读/写/删）**

`let remoteInvite = null;` 保持不变，但：

```js
function activeInvite() { return isInviteActive(remoteInvite, Date.now()) ? remoteInvite : null; }
```

`initWorkspace(paths, port)` 里加：

```js
  remoteInvite = loadInvite(paths.inviteFile);
```

`/api/remote/invite` 处理里，把

```js
      const days = resolveInviteDays(body);
      const token = crypto.randomBytes(24).toString('hex');
      const password = crypto.randomBytes(16).toString('base64url');
      remoteInvite = { token, password, expiresAt: Date.now() + Math.min(days * 24 * 3600 * 1000, MAX_TTL_MS) };
```

改为：

```js
      const days = resolveInviteDaysAllowForever(body);   // days=0 = 长期不过期
      const token = crypto.randomBytes(24).toString('hex');
      const password = crypto.randomBytes(16).toString('base64url');
      remoteInvite = { token, password, expiresAt: days === 0 ? 0 : Date.now() + Math.min(days * 24 * 3600 * 1000, MAX_TTL_MS) };
      saveInvite(paths.inviteFile, remoteInvite);
```

`/api/remote/revoke` 处理里，`remoteInvite = null;` 之后加：

```js
      clearInvite(paths.inviteFile);
```

`/api/remote/state` 与 `/api/remote/reveal` 里对 `expiresAt` 的计算要兼容长期，按下述两处精确修改：

`server/index.js:378-387` 的 JSON 里，把

```js
      expiresAt: inv ? inv.expiresAt : null,
```

改为

```js
      expiresAt: inv ? inv.expiresAt : null,
      forever: !!inv && inv.expiresAt === 0,
```

`server/index.js:404` 的 JSON 里，把

```js
    res.end(JSON.stringify({ enabled: true, password: inv.password, token: inv.token, link, address, expiresAt: inv.expiresAt }));
```

改为

```js
    res.end(JSON.stringify({ enabled: true, password: inv.password, token: inv.token, link, address, expiresAt: inv.expiresAt, forever: inv.expiresAt === 0 }));
```

（`inviteLink(inv)` 不动。）

- [ ] **Step 3: buildWorkspace 装配 peers + mount**

在 `buildWorkspace` 里，`engine` 创建时加 `peers` 依赖（把 `new CollabEngine({...})` 的对象里加一行）：

```js
    peers: new UsagePeersStore({ file: paths.usagePeersFile, logger: log }),
```

把 `collabMount` 创建行之后加：

```js
  const usagePeers = engine.peers;
  const usageReporter = createUsageReporter({
    file: paths.usageReportFile,
    identity: () => ({ ...engine.pub }),
    cmd: ((BOOT_CFG.agents.list || []).find((a) => a.id === BOOT_CFG.agents.default) || {}).cmd || 'opencode',
    logger: log,
  });
  const usageMount = createUsageMount({
    peers: usagePeers,
    reporter: usageReporter,
    checkToken: (tk) => { const inv = activeInvite(); return !!inv && safeEqual(tk, inv.token); },
    onReport: () => {
      engine.writeDownload?.('usage.json', Buffer.from(JSON.stringify(usagePeers.snapshot(), null, 2)), 'usage');
      broadcastCollab(CollabS2C.COLLAB_HEARTBEAT, {});
    },
    logger: log,
  });
```

`writeUsageSnapshot` 已在 Task 8 删除，因此用上面的 `engine.writeDownload` 替代（签名：`writeDownload(name, buf, kind)`）。

把 `heartbeat` 字段从返回对象里去掉，改为 `usageReporter`：

```js
  return { projects, saveProjects, workflows, sessionManager, workflowRunner, engine, collabMount, usageMount, usageReporter, scheduler, httpApi, llmMount, llmVault, usageStore, historyFile: paths.historyFile, paths };
```

- [ ] **Step 4: 启动上报器**

`initWorkspace` 里把原 heartbeat 三行：

```js
  const agentCmd = ((BOOT_CFG.agents.list || []).find((a) => a.id === BOOT_CFG.agents.default) || {}).cmd || 'opencode';
  if (ws.heartbeat) ws.heartbeat.stop();
  ws.heartbeat = createHeartbeat({ engine: ws.engine, cmd: agentCmd, logger: log });
  ws.heartbeat.start();
```

改为：

```js
  if (ws.usageReporter) { ws.usageReporter.stop(); ws.usageReporter.start(); }
```

- [ ] **Step 5: 路由派发**

在 `if (url.pathname.startsWith('/api/collab')) { await ws.collabMount(req, res); return; }` 之后加：

```js
  if (url.pathname.startsWith('/api/usage/')) { await ws.usageMount(req, res, url); return; }
```

（既有 `GET/POST /api/usage`（LLM 用量）是精确匹配、在更前面处理，互不影响。）

- [ ] **Step 6: 语法与全量测试**

Run: `node --check server/index.js; npm.cmd run test:server`
Expected: 语法通过；测试全绿

- [ ] **Step 7: Commit**

```bash
git add server/index.js
git commit -m "feat(server): 装配用量上报（令牌落盘、/api/usage/* 派发、启动即报）"
```

---

### Task 10: 前端「机器用量」视图 + i18n

**Files:**
- Create: `web/src/collaboration/usagePeers.ts`, `web/src/collaboration/usagePeers.test.ts`, `web/src/collaboration/UsageView.vue`
- Modify: `web/src/collaboration/CollaborationView.vue`, `web/src/App.vue`, `shared/i18n/zh-CN.js`, `shared/i18n/en.js`

- [ ] **Step 1: 写纯函数测试（红）**

`web/src/collaboration/usagePeers.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isOnline, fmtNum, sortPeers, usageCells, ONLINE_WINDOW_MS } from './usagePeers';

const mk = (o: any) => ({ machineId: 'm', username: 'u', host: 'h', port: 1, ...o });

describe('usagePeers', () => {
  it('isOnline：3 小时内算在线', () => {
    expect(ONLINE_WINDOW_MS).toBe(3 * 60 * 60 * 1000);
    expect(isOnline(1000, 1000 + ONLINE_WINDOW_MS - 1)).toBe(true);
    expect(isOnline(1000, 1000 + ONLINE_WINDOW_MS)).toBe(false);
    expect(isOnline(0, 500)).toBe(false);
  });
  it('fmtNum：千/百万缩写，缺失显示 -', () => {
    expect(fmtNum(undefined)).toBe('-');
    expect(fmtNum(999)).toBe('999');
    expect(fmtNum(1500)).toBe('1.5K');
    expect(fmtNum(2_000_000)).toBe('2.0M');
  });
  it('sortPeers：最近上报在前', () => {
    const list = sortPeers({ a: mk({ machineId: 'a', receivedAt: 10 }), b: mk({ machineId: 'b', receivedAt: 30 }) });
    expect(list.map((p) => p.machineId)).toEqual(['b', 'a']);
  });
  it('usageCells：给出 sessions/days/messages/input/output/totalCost 六列文本', () => {
    expect(usageCells(mk({ sessions: 3, days: 7, messages: 9, input: 1500, output: 20, totalCost: 1.5 })))
      .toEqual(['3', '7', '9', '1.5K', '20', '1.5']);
    expect(usageCells(mk({ error: 'boom' }))).toEqual(['-', '-', '-', '-', '-', '-']);
  });
});
```

Run: `npm.cmd --prefix web run test -- src/collaboration/usagePeers.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现纯函数**

`web/src/collaboration/usagePeers.ts`：

```ts
import type { CollabUsage } from './types';

export const ONLINE_WINDOW_MS = 3 * 60 * 60 * 1000;   // 上报间隔上限 90 分钟 × 2

export function isOnline(receivedAt?: number, now = Date.now()): boolean {
  return !!receivedAt && now - receivedAt < ONLINE_WINDOW_MS;
}

export function fmtNum(n?: number): string {
  if (n == null) return '-';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export function sortPeers(peers: Record<string, CollabUsage>): CollabUsage[] {
  return Object.values(peers || {}).sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
}

export function usageCells(u: CollabUsage): string[] {
  if (!u || u.error) return ['-', '-', '-', '-', '-', '-'];
  return [fmtNum(u.sessions), fmtNum(u.days), fmtNum(u.messages), fmtNum(u.input), fmtNum(u.output), u.totalCost == null ? '-' : String(u.totalCost)];
}
```

Run: `npm.cmd --prefix web run test -- src/collaboration/usagePeers.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 3: i18n 词条（中英同时加）**

`shared/i18n/zh-CN.js` 的 `collab.*` 区域加：

```js
  'usage.title': '机器用量',
  'usage.machine': '机器',
  'usage.sessions': '会话',
  'usage.days': '天数',
  'usage.messages': '消息',
  'usage.input': '输入',
  'usage.output': '输出',
  'usage.cost': '花费',
  'usage.last_report': '最后上报',
  'usage.online': '在线',
  'usage.offline': '离线',
  'usage.empty': '还没有任何机器上报',
  'usage.report_to_master': '上报到 master',
  'usage.link_placeholder': '粘贴 master 的访问链接（http://…/?access=…）',
  'usage.save': '保存',
  'usage.report_now': '立即上报一次',
  'usage.reported_ok': '上报成功：{time}',
  'usage.reported_fail': '上报失败：{msg}',
  'usage.bad_link': '链接不合法，请粘贴 master 的完整访问链接',
  'usage.next_at': '下次上报：{time}',
  'usage.not_configured': '未配置',
  'usage.saved': '已保存',
```

`shared/i18n/en.js` 同位置加：

```js
  'usage.title': 'Machine usage',
  'usage.machine': 'Machine',
  'usage.sessions': 'Sessions',
  'usage.days': 'Days',
  'usage.messages': 'Messages',
  'usage.input': 'Input',
  'usage.output': 'Output',
  'usage.cost': 'Cost',
  'usage.last_report': 'Last report',
  'usage.online': 'Online',
  'usage.offline': 'Offline',
  'usage.empty': 'No machine has reported yet',
  'usage.report_to_master': 'Report to master',
  'usage.link_placeholder': "Paste the master's access link (http://…/?access=…)",
  'usage.save': 'Save',
  'usage.report_now': 'Report now',
  'usage.reported_ok': 'Reported at {time}',
  'usage.reported_fail': 'Report failed: {msg}',
  'usage.bad_link': 'Invalid link; paste the full access link from the master',
  'usage.next_at': 'Next report: {time}',
  'usage.not_configured': 'Not configured',
  'usage.saved': 'Saved',
```

Run: `npm.cmd run check:i18n && node -e "Promise.all([import('./shared/i18n/zh-CN.js'),import('./shared/i18n/en.js')]).then(([z,e])=>{const Z=Object.keys(z.messages),E=Object.keys(e.messages);console.log(Z.length,E.length,Z.filter(k=>!E.includes(k)),E.filter(k=>!Z.includes(k)));})"`
Expected: `check-i18n` 无中文命中；两文件键数一致、互相差集为空

- [ ] **Step 4: 视图组件**

`web/src/collaboration/UsageView.vue`：

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { CollabS2C } from '@devflow/shared/collab';
import { t } from '../i18n';
import { isOnline, sortPeers, usageCells } from './usagePeers';
import type { CollabUsage } from './types';

const props = defineProps<{ terminal: { on: (type: string, cb: (p: any) => void) => () => void } }>();
const peers = ref<Record<string, CollabUsage>>({});
const cfg = ref<{ masterUrl: string; token: string; days?: number }>({ masterUrl: '', token: '' });
const st = ref<{ lastAt: number; lastOk: boolean | null; lastError: string; nextAt: number }>({ lastAt: 0, lastOk: null, lastError: '', nextAt: 0 });
const link = ref('');
const msg = ref('');
const rows = computed(() => sortPeers(peers.value));
const fmtTime = (ms?: number) => (ms ? new Date(ms).toLocaleString() : t('usage.not_configured'));

async function loadPeers() {
  try { const r = await fetch('/api/usage/peers').then((x) => x.json()); peers.value = r.peers || {}; } catch { /* ignore */ }
}
async function loadReporter() {
  try {
    const r = await fetch('/api/usage/reporter').then((x) => x.json());
    cfg.value = r.config || cfg.value;
    st.value = r.status || st.value;
  } catch { /* ignore */ }
}
async function save() {
  msg.value = '';
  const res = await fetch('/api/usage/reporter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link: link.value }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { msg.value = t(data.error === 'bad-link' ? 'usage.bad_link' : 'usage.reported_fail', { msg: data.error || res.status }); return; }
  cfg.value = data.config;
  st.value = data.status;
  msg.value = t('usage.saved');
}
async function reportNow() {
  msg.value = '';
  const r = await fetch('/api/usage/reporter/now', { method: 'POST' }).then((x) => x.json()).catch(() => null);
  if (!r) return;
  st.value = r.status;
  msg.value = r.status.lastOk ? t('usage.reported_ok', { time: fmtTime(r.status.lastAt) }) : t('usage.reported_fail', { msg: r.status.lastError });
}

let off: (() => void) | null = null;
onMounted(() => {
  loadPeers(); loadReporter();
  off = props.terminal.on(CollabS2C.COLLAB_HEARTBEAT, () => loadPeers());
});
onBeforeUnmount(() => { if (off) off(); });
</script>

<template>
  <div class="uv">
    <div class="sec">
      <div class="stitle">{{ $t('usage.title') }}</div>
      <div v-if="!rows.length" class="hint">{{ $t('usage.empty') }}</div>
      <table v-else class="ptable">
        <thead>
          <tr>
            <th>{{ $t('usage.machine') }}</th>
            <th>{{ $t('usage.sessions') }}</th>
            <th>{{ $t('usage.days') }}</th>
            <th>{{ $t('usage.messages') }}</th>
            <th>{{ $t('usage.input') }}</th>
            <th>{{ $t('usage.output') }}</th>
            <th>{{ $t('usage.cost') }}</th>
            <th>{{ $t('usage.last_report') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in rows" :key="p.machineId">
            <td class="who">
              <span class="dot" :class="{ on: isOnline(p.receivedAt) }" />
              {{ (p.employeeId || p.username || p.machineId) }}<span class="host">@{{ p.host }}:{{ p.port }}</span>
            </td>
            <td v-for="(c, i) in usageCells(p)" :key="i">{{ c }}</td>
            <td>{{ fmtTime(p.receivedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="sec">
      <div class="stitle">{{ $t('usage.report_to_master') }}</div>
      <div class="row">
        <input v-model="link" :placeholder="$t('usage.link_placeholder')" @keyup.enter="save" />
        <button class="ghost" @click="save">{{ $t('usage.save') }}</button>
        <button class="ghost" @click="reportNow">{{ $t('usage.report_now') }}</button>
      </div>
      <div class="hint" v-if="cfg.masterUrl">{{ cfg.masterUrl }}</div>
      <div class="hint" v-if="st.lastOk !== null">{{ st.lastOk ? $t('usage.reported_ok', { time: fmtTime(st.lastAt) }) : $t('usage.reported_fail', { msg: st.lastError }) }}</div>
      <div class="hint" v-if="st.nextAt">{{ $t('usage.next_at', { time: fmtTime(st.nextAt) }) }}</div>
      <div class="err" v-if="msg">{{ msg }}</div>
    </div>
  </div>
</template>

<style scoped>
.uv { padding: 14px; overflow: auto; }
.sec { margin-bottom: 22px; }
.stitle { font-weight: 700; color: var(--ac3); margin-bottom: 8px; }
.hint { color: var(--tx6); font-size: 12px; }
.err { color: var(--err); font-size: 12px; }
.ptable { border-collapse: collapse; font-size: 12px; width: 100%; }
.ptable th, .ptable td { border: 1px solid var(--bd); padding: 4px 8px; text-align: right; }
.ptable th:first-child, .ptable td:first-child { text-align: left; }
.who { display: flex; align-items: center; gap: 6px; }
.host { color: var(--tx6); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tx6); flex: none; }
.dot.on { background: #4caf50; }
.row { display: flex; gap: 8px; }
.row input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; }
.ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 2px 10px; cursor: pointer; }
</style>
```

（词条 `usage.saved` 已在 Step 3 中加入，中英各一条，无需额外判断。）

- [ ] **Step 5: 挂到 tab**

`web/src/collaboration/CollaborationView.vue`：

```ts
type CollabTab = 'group' | 'tasks' | 'usage';
```

`tabs` 里追加：

```ts
  { id: 'usage' as const, label: t('usage.title') },
```

模板里：

```vue
      <GroupView v-if="tab === 'group'" :collab="collab" />
      <TasksView v-else-if="tab === 'tasks'" :collab="collab" />
      <UsageView v-else :terminal="props.terminal" />
```

import 加 `import UsageView from './UsageView.vue';`

`web/src/App.vue`：

```ts
const collabTab = ref<'group' | 'tasks' | 'usage'>('group');
```

hash 解析处：

```ts
if (r === 'contacts' && (sub === 'group' || sub === 'tasks' || sub === 'usage')) collabTab.value = sub;
```

- [ ] **Step 6: 类型 + 测试 + i18n 全绿**

Run: `npm.cmd run typecheck; npm.cmd --prefix web run test; npm.cmd run check:i18n`
Expected: 三项全通过

- [ ] **Step 7: Commit**

```bash
git add web/src/collaboration/usagePeers.ts web/src/collaboration/usagePeers.test.ts web/src/collaboration/UsageView.vue web/src/collaboration/CollaborationView.vue web/src/App.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 新增「机器用量」视图（汇总表 + 上报到 master 配置）"
```

---

### Task 11: 文档 + 端到端验收

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: AGENTS.md 记一条**

在「目录速览」的 `server/` 说明后或「已验证教训」附近加：

```markdown
- **用量上报不走加群**：slave 在「机器用量」页粘 master 的访问链接（`http://<host>:<port>/?access=<token>`）即可，每 60–90 分钟随机把 `opencode stats` 结果 `POST /api/usage/report`（头 `X-DF-Token`）；master 邀请令牌落盘在 `collab/invite.json`，`days=0` 表示长期不过期。旧的群内签名信封上报已删除。
```

- [ ] **Step 2: 起双实例（异步、非阻塞）**

```powershell
# master：release 包（22222）
Start-Process -FilePath "cmd.exe" -ArgumentList '/c','start','""','/min',"D:\soft\vscode-ai-windows-x64-v20260916\start.bat" -WorkingDirectory "D:\soft\vscode-ai-windows-x64-v20260916"
# slave：dev（33333）
Start-Process -FilePath "cmd.exe" -ArgumentList '/c','start','""','/min',"$env:TEMP\opencode\void-dev-server.cmd"
```

- [ ] **Step 3: master 生成长期链接**

```powershell
Invoke-WebRequest -UseBasicParsing -Method POST "http://127.0.0.1:22222/api/remote/invite" -ContentType 'application/json' -Body '{"days":0}' | Select-Object -ExpandProperty Content
```

Expected: JSON 含 `"days":0`、`expiresAt":0`、`"link":"http://<LAN IP>:22222/?access=<token>"`；且 `D:\soft\...\data\collab\invite.json` 文件存在（用 `Test-Path` 验证）

- [ ] **Step 4: slave 配置并立即上报**

```powershell
$link = '<Step 3 的 link>'
Invoke-WebRequest -UseBasicParsing -Method POST "http://127.0.0.1:33333/api/usage/reporter" -ContentType 'application/json' -Body (@{ link = $link } | ConvertTo-Json) | Select-Object -ExpandProperty Content
Invoke-WebRequest -UseBasicParsing -Method POST "http://127.0.0.1:33333/api/usage/reporter/now" | Select-Object -ExpandProperty Content
```

Expected: 配置返回 `config.masterUrl`/`token` 正确；`now` 返回 `status.lastOk = true`

- [ ] **Step 5: master 侧可见**

```powershell
Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:22222/api/usage/peers" | Select-Object -ExpandProperty Content
```

Expected: `peers` 里出现 dev 机器的 `machineId`，含 `sessions/days/messages/input/output` 与 `receivedAt`

- [ ] **Step 6: 令牌持久化（重启 master 后仍可上报）**

重启 master（设置面板「重启后端」或重开 `start.bat`）→ 再执行 Step 4 的 `now` → Expected: 仍 `lastOk = true`（失败即说明落盘/读取有问题）

- [ ] **Step 7: 错误令牌 → 明确失败**

```powershell
Invoke-WebRequest -UseBasicParsing -Method POST "http://127.0.0.1:22222/api/usage/report" -ContentType 'application/json' -Headers @{ 'X-DF-Token' = 'wrong' } -Body '{"machineId":"x","usage":{}}' -SkipHttpErrorCheck
```

Expected: 403 `{"error":"bad-token"}`

- [ ] **Step 8: 全量校验 + 打绿色包**

```bash
npm.cmd test
npm.cmd run typecheck
npm.cmd run check:i18n
npm.cmd run build:web
node scripts/build.js
```

Expected: 测试/类型/i18n 全绿；产物 `dist-portable/vscode-ai-windows-x64-<日期>/` + `.zip`

- [ ] **Step 9: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): 记录用量上报走令牌链接、与加群解耦"
```

---

## 自审记录（写完计划后回看 spec）

- **spec 覆盖度**：令牌落盘（Task 4/9）、长期不过期（Task 4/9）、60–90 分钟随机（Task 5/6）、采集口径不变（Task 6）、master 收上报（Task 7）、汇总查看（Task 7/10）、slave 只推不开接口（Task 7 只实现 master 侧 `/api/usage/*`；slave 侧无对外只读接口）、界面（Task 10）、删除旧链路（Task 8）、测试（Task 3–8、10）、手工验收（Task 11）——均有任务对应。
- **命名冲突**：spec 原写 `GET /api/usage` 与既有 LLM `/api/usage`（`server/index.js:500`）冲突，Task 1 已改为 `/api/usage/peers`；计划内所有引用统一使用新名。
- **类型一致性**：`UsagePeersStore.upsert(usage, now)`、`createUsageReporter({ file, identity, cmd, collect, fetchFn, logger, random, now, scheduleFn })`、`createUsageMount({ peers, reporter, checkToken, onReport, logger })`、`resolveInviteDaysAllowForever`、`parseInviteLink`/`nextDelay`/`loadReportConfig`/`saveReportConfig` 在后续任务中的调用签名与定义一致。
- **占位符**：无 TBD/TODO；每个代码步骤都给了可直接粘贴的完整实现。
