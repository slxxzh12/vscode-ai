# 按目录恢复窗口（页签 + 消息历史）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 devflow 记住上次的窗口——文件页签、激活页签、左侧栏位与消息筛选开关——并给左侧「消息」页加上「仅当前会话 / 当前项目」筛选。

**Architecture:** 服务端在端口数据目录新增两份小存储（`session-projects.json` 记 `sessionId → projectId`，`window-state.json` 记窗口状态），走 `createJsonStore` + `GET/POST` 接口；前端新增三个纯逻辑模块（`sessionProjects.ts` / `windowState.ts` / `msgFilter.ts`），`App.vue` 只负责在启动时把 `planRestore()` 的结果应用到 `center`/`rail`/`msgFilter`，并在变化时去抖回写。

**Tech Stack:** Node ESM + `node:test`（服务端）、Vue 3 + Vite + vitest + happy-dom（前端）、i18n 词条中英双语。

**设计文档：** `docs/superpowers/specs/2026-09-17-window-restore-design.md`

**环境提醒（Windows）：** 一律用 `npm.cmd` / `npx.cmd`；`node --test` 传**文件路径**而不是目录；dev 后端固定端口 33333。

---

## 文件结构

**服务端新增**
- `server/session-projects.js` — `sessionId → projectId` 映射存储（只增不删、上限 500、幂等）。
- `server/window-state.js` — 窗口状态存储（白名单归一化、tabs 上限 50）。

**服务端修改**
- `server/port-paths.js` — 新增两个数据文件路径。
- `server/session-manager.js` — 构造参数 `onCreated`，会话创建后回调。
- `server/http-api.js` — 新增 3 个路由 + 2 个可注入 store 参数。
- `server/index.js` — 构造两个 store、把 `record` 挂到 `SessionManager`、传入 `createHttpApi`。

**前端新增**
- `web/src/sessionProjects.ts` — 读映射（模块级单例）。
- `web/src/windowState.ts` — 读写窗口状态 + 纯函数 `toSavedTabs` / `fileTabsOf` / `planRestore`。
- `web/src/msgFilter.ts` — 纯函数 `sessionOfActiveTab` / `resolveProject` / `filterMessages`。

**前端修改**
- `web/src/App.vue` — 恢复/保存窗口状态、消息筛选。
- `web/src/components/HistoryList.vue` — 筛选开关按钮。
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js` — 3 个新词条。

**测试**
- 新增：`server/test/session-projects.test.js`、`server/test/window-state.test.js`、`web/src/sessionProjects.test.ts`、`web/src/windowState.test.ts`、`web/src/msgFilter.test.ts`
- 扩展：`server/test/port-paths.test.js`、`server/test/http-api.test.js`、`server/test/session-manager.test.js`、`web/src/components/HistoryList.test.ts`

---

## Task 1: 服务端 `sessionId → projectId` 映射存储

**Files:**
- Create: `server/session-projects.js`
- Test: `server/test/session-projects.test.js`

- [ ] **Step 1: 写失败的测试**

创建 `server/test/session-projects.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeSessionProjects, createSessionProjects, MAX_SESSIONS } from '../session-projects.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfsp-')), 'session-projects.json');
}

test('normalizeSessionProjects 只留非空字符串键值', () => {
  assert.deepEqual(normalizeSessionProjects({ a: 'p1', b: '', c: 1, d: null, e: 'p2' }), { a: 'p1', e: 'p2' });
  assert.deepEqual(normalizeSessionProjects(null), {});
  assert.deepEqual(normalizeSessionProjects('x'), {});
  assert.deepEqual(normalizeSessionProjects([]), {});
});

test('normalizeSessionProjects 超过上限淘汰最旧', () => {
  const src = {};
  for (let i = 0; i < MAX_SESSIONS + 5; i++) src[`k${i}`] = `p${i}`;
  const out = normalizeSessionProjects(src);
  assert.equal(Object.keys(out).length, MAX_SESSIONS);
  assert.equal(out.k0, undefined);
  assert.equal(out.k4, undefined);
  assert.equal(out[`k${MAX_SESSIONS + 4}`], `p${MAX_SESSIONS + 4}`);
});

test('record 幂等、空值跳过、读写往返', () => {
  const file = tmpFile();
  const store = createSessionProjects({ file });
  assert.deepEqual(store.read(), {});

  store.record('s_1', 'p1');
  assert.deepEqual(store.read(), { s_1: 'p1' });
  store.record('s_1', 'p1');                 // 幂等
  assert.deepEqual(store.read(), { s_1: 'p1' });

  store.record('s_2', null);
  store.record(null, 'p1');
  store.record('', 'p1');
  store.record('s_3', '');
  assert.deepEqual(store.read(), { s_1: 'p1' });

  assert.deepEqual(createSessionProjects({ file }).read(), { s_1: 'p1' });   // 落盘可回读
});

test('record 超过上限时淘汰最旧', () => {
  const file = tmpFile();
  const store = createSessionProjects({ file });
  for (let i = 0; i < MAX_SESSIONS + 3; i++) store.record(`s${i}`, `p${i}`);
  const out = store.read();
  assert.equal(Object.keys(out).length, MAX_SESSIONS);
  assert.equal(out.s0, undefined);
  assert.equal(out[`s${MAX_SESSIONS + 2}`], `p${MAX_SESSIONS + 2}`);
});

test('坏文件回退空 + 无 file 时纯内存', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ bad json');
  assert.deepEqual(createSessionProjects({ file }).read(), {});

  const mem = createSessionProjects({});
  mem.record('s_1', 'p1');
  assert.deepEqual(mem.read(), { s_1: 'p1' });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/session-projects.test.js`
Expected: FAIL —— `Cannot find module '.../server/session-projects.js'`

- [ ] **Step 3: 实现**

创建 `server/session-projects.js`：

```js
import { createJsonStore } from './json-store.js';

// sessionId → projectId 映射。用途：服务端重启后 PTY 全没、sessionId 全部失效，
// 靠这份映射仍能把历史消息（message-history.jsonc）归属到项目，供前端「当前项目」筛选。
// 只增不删（会话被 kill 也不清——消息还在，仍需归属），上限 MAX_SESSIONS 淘汰最旧。
export const MAX_SESSIONS = 500;

export function normalizeSessionProjects(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof k === 'string' && k && typeof v === 'string' && v) out[k] = v;
  }
  const keys = Object.keys(out);
  if (keys.length > MAX_SESSIONS) {
    for (const k of keys.slice(0, keys.length - MAX_SESSIONS)) delete out[k];
  }
  return out;
}

export function createSessionProjects({ file = null, logger = console } = {}) {
  const store = createJsonStore({ file, logger, normalize: normalizeSessionProjects, defaults: () => ({}) });
  // 记录一条映射；空值跳过，同值不写盘（幂等）。
  function record(sessionId, projectId) {
    const cur = store.read();
    if (typeof sessionId !== 'string' || !sessionId) return cur;
    if (typeof projectId !== 'string' || !projectId) return cur;
    if (cur[sessionId] === projectId) return cur;
    return store.write({ ...cur, [sessionId]: projectId });
  }
  return { read: store.read, record };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test server/test/session-projects.test.js`
Expected: PASS（5 个 test 全绿）

- [ ] **Step 5: 提交**

```bash
git add server/session-projects.js server/test/session-projects.test.js
git commit -m "feat(server): sessionId→projectId 映射存储"
```

---

## Task 2: 服务端窗口状态存储

**Files:**
- Create: `server/window-state.js`
- Test: `server/test/window-state.test.js`

- [ ] **Step 1: 写失败的测试**

创建 `server/test/window-state.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeWindowState, createWindowState, MAX_TABS } from '../window-state.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfws-')), 'window-state.json');
}

test('normalizeWindowState 白名单校验 rail/historyTab/msgFilter', () => {
  assert.deepEqual(normalizeWindowState({ rail: 'history' }), { rail: 'history' });
  assert.deepEqual(normalizeWindowState({ rail: 'nope' }), {});
  assert.deepEqual(normalizeWindowState({ rail: 'mobile' }), {});          // 手机视图不持久化
  assert.deepEqual(normalizeWindowState({ historyTab: 'messages' }), { historyTab: 'messages' });
  assert.deepEqual(normalizeWindowState({ historyTab: 'other' }), {});
  assert.deepEqual(normalizeWindowState({ msgFilter: false }), { msgFilter: false });
  assert.deepEqual(normalizeWindowState({ msgFilter: 'yes' }), {});
  assert.deepEqual(normalizeWindowState({ nope: 1 }), {});                // 未知键丢弃
  assert.deepEqual(normalizeWindowState(null), {});
  assert.deepEqual(normalizeWindowState([]), {});
});

test('normalizeWindowState tabs 丢弃非法项、label 缺失用文件名、上限截断', () => {
  const out = normalizeWindowState({
    tabs: [
      { projectId: 'p1', path: 'src/a.ts', label: 'a.ts' },
      { projectId: 'p1', path: 'src\\b.ts' },                 // 缺 label → 反推文件名
      { projectId: 'p1' },                                     // 缺 path → 丢
      { path: 'x.ts' },                                        // 缺 projectId → 丢
      { projectId: '', path: 'y.ts' },                         // 空 projectId → 丢
      'nope', null, 42,
    ],
  });
  assert.deepEqual(out.tabs, [
    { projectId: 'p1', path: 'src/a.ts', label: 'a.ts' },
    { projectId: 'p1', path: 'src\\b.ts', label: 'b.ts' },
  ]);

  const many = Array.from({ length: MAX_TABS + 5 }, (_, i) => ({ projectId: 'p', path: `f${i}.ts`, label: `f${i}.ts` }));
  assert.equal(normalizeWindowState({ tabs: many }).tabs.length, MAX_TABS);
});

test('normalizeWindowState activeTab 只接受非空字符串或 null', () => {
  assert.deepEqual(normalizeWindowState({ activeTab: 'f:p1|a.ts' }), { activeTab: 'f:p1|a.ts' });
  assert.deepEqual(normalizeWindowState({ activeTab: null }), { activeTab: null });
  assert.deepEqual(normalizeWindowState({ activeTab: '' }), {});
  assert.deepEqual(normalizeWindowState({ activeTab: 7 }), {});
});

test('createWindowState 读写往返 + 坏文件回退空 + 无 file 纯内存', () => {
  const file = tmpFile();
  const store = createWindowState({ file });
  assert.deepEqual(store.read(), {});

  store.write({ rail: 'history', historyTab: 'messages', msgFilter: false, tabs: [{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }], activeTab: 'f:p1|a.ts' });
  assert.deepEqual(createWindowState({ file }).read(), {
    rail: 'history', historyTab: 'messages', msgFilter: false,
    tabs: [{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }], activeTab: 'f:p1|a.ts',
  });

  fs.writeFileSync(file, '{ bad json');
  assert.deepEqual(createWindowState({ file }).read(), {});

  const mem = createWindowState({});
  mem.write({ msgFilter: false });
  assert.deepEqual(mem.read(), { msgFilter: false });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/window-state.test.js`
Expected: FAIL —— `Cannot find module '.../server/window-state.js'`

- [ ] **Step 3: 实现**

创建 `server/window-state.js`：

```js
import { createJsonStore } from './json-store.js';

// 窗口状态：上次打开的文件页签、激活页签、左侧栏位、「历史」子页、消息筛选开关。
// rail 白名单**不含 mobile**——手机视图由前端 mobileLanding 的自动逻辑管理，不参与窗口恢复。
export const RAILS = ['explorer', 'history', 'contacts', 'stat', 'scheduler', 'proxy'];
export const HISTORY_TABS = ['files', 'messages'];
export const MAX_TABS = 50;

export function emptyWindowState() { return {}; }

function fileNameOf(p) {
  const q = p.replace(/\\/g, '/');
  return q.split('/').filter(Boolean).pop() || q;
}

export function normalizeWindowState(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  if (typeof src.rail === 'string' && RAILS.includes(src.rail)) out.rail = src.rail;
  if (typeof src.historyTab === 'string' && HISTORY_TABS.includes(src.historyTab)) out.historyTab = src.historyTab;
  if (typeof src.msgFilter === 'boolean') out.msgFilter = src.msgFilter;
  if (Array.isArray(src.tabs)) {
    const tabs = [];
    for (const t of src.tabs) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
      if (typeof t.projectId !== 'string' || !t.projectId) continue;
      if (typeof t.path !== 'string' || !t.path) continue;
      const label = typeof t.label === 'string' && t.label ? t.label : fileNameOf(t.path);
      tabs.push({ projectId: t.projectId, path: t.path, label });
      if (tabs.length >= MAX_TABS) break;
    }
    out.tabs = tabs;
  }
  if (typeof src.activeTab === 'string' && src.activeTab) out.activeTab = src.activeTab;
  else if (src.activeTab === null) out.activeTab = null;
  return out;
}

export function createWindowState({ file = null, logger = console } = {}) {
  return createJsonStore({ file, logger, normalize: normalizeWindowState, defaults: emptyWindowState });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test server/test/window-state.test.js`
Expected: PASS（4 个 test 全绿）

- [ ] **Step 5: 提交**

```bash
git add server/window-state.js server/test/window-state.test.js
git commit -m "feat(server): 窗口状态存储（白名单归一化 + 上限）"
```

---

## Task 3: 端口数据目录新增两个路径

**Files:**
- Modify: `server/port-paths.js:27-34`
- Test: `server/test/port-paths.test.js:27-33`

- [ ] **Step 1: 写失败的测试**

在 `server/test/port-paths.test.js` 里，`assert.equal(p.historyFile, ...)` 之后插入两行：

```js
  assert.equal(p.sessionProjectsFile, path.join(base, 'session-projects.json'));
  assert.equal(p.windowStateFile, path.join(base, 'window-state.json'));
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/port-paths.test.js`
Expected: FAIL —— `Expected values to be strictly equal: undefined !== '...session-projects.json'`

- [ ] **Step 3: 实现**

在 `server/port-paths.js` 的 `historyFile` 行之后加两行：

```js
    sessionProjectsFile: path.join(dir, 'session-projects.json'),
    windowStateFile: path.join(dir, 'window-state.json'),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test server/test/port-paths.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/port-paths.js server/test/port-paths.test.js
git commit -m "feat(server): 端口数据目录新增 session-projects/window-state 路径"
```

---

## Task 4: `SessionManager` 会话创建回调

**Files:**
- Modify: `server/session-manager.js:11-35`
- Test: `server/test/session-manager.test.js`（文件末尾追加）

- [ ] **Step 1: 写失败的测试**

在 `server/test/session-manager.test.js` 末尾追加：

```js
test('create 之后调用 onCreated，携带 id/projectId', async () => {
  const instances = [];
  const seen = [];
  const sm = new SessionManager({
    ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }),
    onCreated: (s) => seen.push(s),
  });
  const s = await sm.create({ projectId: 'p1' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, s.id);
  assert.equal(seen[0].projectId, 'p1');
});

test('未传 onCreated 时 create 正常', async () => {
  const instances = [];
  const sm = new SessionManager({ ptyFactory: async () => makeFakePtyFactory(instances)({ cwd: process.cwd() }) });
  const s = await sm.create({});
  assert.ok(s.id);
  assert.equal(s.projectId, null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/session-manager.test.js`
Expected: FAIL —— `seen.length` 为 0（`onCreated` 还没被调用）

- [ ] **Step 3: 实现**

`server/session-manager.js` 的构造函数加参数与赋值：

```js
  constructor({ ptyFactory = createPty, ringMaxBytes = 256 * 1024, logger = console, projectResolver = null, onCreated = null } = {}) {
    super();
    this.ptyFactory = ptyFactory;   // async ({cwd,cols,rows}) => PseudoPty
    this.ringMaxBytes = ringMaxBytes;
    this.log = logger;
    this.projectResolver = projectResolver; // (projectId) => root|null
    this.onCreated = onCreated;             // (session) => void，用于记录 sessionId → projectId
    this.sessions = new Map();
    this._seq = 0;
  }
```

`create()` 末尾（`this.sessions.set(session.id, session);` 之后、`return session;` 之前）插入：

```js
    this.onCreated?.(session);
```

即：

```js
    this.sessions.set(session.id, session);
    this.onCreated?.(session);
    return session;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test server/test/session-manager.test.js`
Expected: PASS（原有 test + 新增 2 个全绿）

- [ ] **Step 5: 提交**

```bash
git add server/session-manager.js server/test/session-manager.test.js
git commit -m "feat(server): SessionManager 支持 onCreated 回调"
```

---

## Task 5: HTTP 路由（`/api/session-projects`、`/api/window-state`）

**Files:**
- Modify: `server/http-api.js:6-8`（imports）、`:43`（签名）、`:258` 之后（路由）
- Test: `server/test/http-api.test.js`（文件末尾追加）

- [ ] **Step 1: 写失败的测试**

在 `server/test/http-api.test.js` 末尾追加：

```js
test('GET /api/session-projects 默认空对象', async () => {
  const server = await start(new Projects({ projects: [] }));
  try {
    const r = await request(server, '/api/session-projects');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), {});
  } finally { server.close(); }
});

test('GET /api/window-state 默认空对象；POST 归一化后落盘', async () => {
  const file = path.join(tmpDir(), 'window-state.json');
  const { createWindowState } = await import('../window-state.js');
  const windowState = createWindowState({ file });
  const server = await start(new Projects({ projects: [] }), { windowState });
  try {
    const empty = await request(server, '/api/window-state');
    assert.equal(empty.status, 200);
    assert.deepEqual(JSON.parse(empty.body), {});

    const post = await post(server, '/api/window-state', {
      rail: 'history', historyTab: 'messages', msgFilter: false,
      tabs: [{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }, { projectId: 'p1' }, 'nope'],
      activeTab: 'f:p1|a.ts', junk: true,
    });
    assert.equal(post.status, 200);
    assert.deepEqual(JSON.parse(post.body), {
      rail: 'history', historyTab: 'messages', msgFilter: false,
      tabs: [{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }], activeTab: 'f:p1|a.ts',
    });

    const back = await request(server, '/api/window-state');
    assert.deepEqual(JSON.parse(back.body), JSON.parse(post.body));
  } finally { server.close(); }
});

test('POST /api/window-state 非法字段被剔除（rail=mobile 不持久化）', async () => {
  const server = await start(new Projects({ projects: [] }));
  try {
    const r = await post(server, '/api/window-state', { rail: 'mobile', msgFilter: 'x', tabs: 'nope' });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), {});
  } finally { server.close(); }
});
```

（`tmpDir` / `request` / `post` / `start` 都是该文件已有的辅助函数。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/http-api.test.js`
Expected: FAIL —— `/api/session-projects` 返回 404

- [ ] **Step 3: 实现**

`server/http-api.js` 顶部 import 区加两行（跟在 `createComposerPrefs` 之后）：

```js
import { createSessionProjects } from './session-projects.js';
import { createWindowState } from './window-state.js';
```

`createHttpApi` 参数表加两个可注入 store：

```js
export function createHttpApi({ projects, saveProjects = null, logger = console, repoRoot = process.cwd(), codeGroups = createCodeGroups({}), codePrefs = createCodePrefs({}), composerPrefs = createComposerPrefs({}), sessionProjects = createSessionProjects({}), windowState = createWindowState({}), pickFolderFn = pickFolder, pickAnyFileFn = pickAnyFile, saveSnapshotFn = saveSnapshotToRepo, revealInOsFn = revealInOs, runScriptFn = runScript }) {
```

在 `/api/composer/prefs` 的 POST 分支之后插入 3 个路由：

```js
      if (url.pathname === '/api/session-projects' && req.method === 'GET') {
        sendJson(res, 200, sessionProjects.read());
        return;
      }
      if (url.pathname === '/api/window-state' && req.method === 'GET') {
        sendJson(res, 200, windowState.read());
        return;
      }
      if (url.pathname === '/api/window-state' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, windowState.write(body));
        return;
      }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test server/test/http-api.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/http-api.js server/test/http-api.test.js
git commit -m "feat(server): /api/session-projects 与 /api/window-state 路由"
```

---

## Task 6: `index.js` 接线

**Files:**
- Modify: `server/index.js:15-17`（imports）、`:183-190`（构造）、`:265`（createHttpApi）

无新测试（接线层，由 Task 1/2/4/5 的单元测试覆盖逻辑）。

- [ ] **Step 1: 加 import**

在 `server/index.js` 顶部 import 区（`createComposerPrefs` 那一行之后）加：

```js
import { createSessionProjects } from './session-projects.js';
import { createWindowState } from './window-state.js';
```

- [ ] **Step 2: 构造 store 并挂到 SessionManager**

把 `:183-189` 改成：

```js
  const codeGroups = createCodeGroups({ file: paths.codeGroupsFile, logger: log });
  const codePrefs = createCodePrefs({ file: paths.codePrefsFile, logger: log });
  const composerPrefs = createComposerPrefs({ file: paths.composerPrefsFile, logger: log });
  const sessionProjects = createSessionProjects({ file: paths.sessionProjectsFile, logger: log });
  const windowState = createWindowState({ file: paths.windowStateFile, logger: log });
  const sessionManager = new SessionManager({
    logger: log,
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    onCreated: (s) => sessionProjects.record(s.id, s.projectId),
  });
```

- [ ] **Step 3: 传给 createHttpApi**

把 `:265` 改成：

```js
  const httpApi = createHttpApi({ projects, saveProjects, logger: log, repoRoot: path.join(__dirname, '..'), codeGroups, codePrefs, composerPrefs, sessionProjects, windowState });
```

- [ ] **Step 4: 回归验证（不启真服务，接线留到 Task 13 冒烟）**

Run: `npm.cmd run test:server`
Expected: 全绿（确认 index.js/session-manager/http-api 改动没破坏既有行为）

- [ ] **Step 5: 提交**

```bash
git add server/index.js
git commit -m "feat(server): 接线 session-projects/window-state 与 onCreated"
```

---

## Task 7: 前端 `sessionProjects.ts`

**Files:**
- Create: `web/src/sessionProjects.ts`
- Test: `web/src/sessionProjects.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `web/src/sessionProjects.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

async function fresh() {
  vi.resetModules();
  const mod = await import('./sessionProjects');
  return mod;
}

describe('sessionProjects', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('normalizeMap 只保留非空字符串值', async () => {
    const mod = await fresh();
    expect(mod.normalizeMap({ a: 'p1', b: '', c: 1, d: null })).toEqual({ a: 'p1' });
    expect(mod.normalizeMap(null)).toEqual({});
    expect(mod.normalizeMap([])).toEqual({});
  });

  it('load 拉取后填入 map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ s_1: 'p1', bad: 5 }) })));
    const mod = await fresh();
    const hook = mod.useSessionProjects();
    await hook.load();
    expect(hook.map.value).toEqual({ s_1: 'p1' });
  });

  it('请求失败/非 2xx 时保持空，不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    const mod = await fresh();
    const hook = mod.useSessionProjects();
    await hook.load();
    expect(hook.map.value).toEqual({});

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const mod2 = await fresh();
    const hook2 = mod2.useSessionProjects();
    await hook2.load();
    expect(hook2.map.value).toEqual({});
  });

  it('load 只请求一次（单例）', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ s_1: 'p1' }) }));
    vi.stubGlobal('fetch', f);
    const mod = await fresh();
    const hook = mod.useSessionProjects();
    await hook.load();
    await hook.load();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run（cwd = `web/`）: `npx.cmd vitest run src/sessionProjects.test.ts`
Expected: FAIL —— `Failed to resolve import "./sessionProjects"`

- [ ] **Step 3: 实现**

创建 `web/src/sessionProjects.ts`：

```ts
import { ref } from 'vue';

// sessionId → projectId（服务端 <端口数据目录>/session-projects.json）。
// 服务端重启后 PTY 消失、sessionId 失效，靠这份映射仍能把老消息归属到项目。
export type SessionProjectMap = Record<string, string>;

const map = ref<SessionProjectMap>({});
let loadPromise: Promise<void> | null = null;

export function normalizeMap(input: unknown): SessionProjectMap {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const out: SessionProjectMap = {};
  for (const [k, v] of Object.entries(src)) if (typeof v === 'string' && v) out[k] = v;
  return out;
}

export async function fetchSessionProjects(): Promise<SessionProjectMap> {
  try {
    const res = await fetch('/api/session-projects');
    if (!res.ok) return {};
    return normalizeMap(await res.json());
  } catch { return {}; }   // 映射只是筛选的兜底，拿不到就退化为「只认活跃会话」
}

export function useSessionProjects() {
  async function load(): Promise<void> {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => { map.value = await fetchSessionProjects(); })();
    return loadPromise;
  }
  return { map, load };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx.cmd vitest run src/sessionProjects.test.ts`
Expected: PASS（4 个 test）

- [ ] **Step 5: 提交**

```bash
git add web/src/sessionProjects.ts web/src/sessionProjects.test.ts
git commit -m "feat(web): sessionId→projectId 映射读取"
```

---

## Task 8: 前端 `windowState.ts`

**Files:**
- Create: `web/src/windowState.ts`
- Test: `web/src/windowState.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `web/src/windowState.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { toSavedTabs, fileTabsOf, planRestore, saveWindowState, flushWindowState } from './windowState';
import type { WindowState } from './windowState';
import type { CenterTab } from './useCenter';

const tab = (over: Partial<CenterTab> = {}): CenterTab => ({ id: 'f:p1|a.ts', kind: 'file', label: 'a.ts', projectId: 'p1', path: 'a.ts', ...over });

describe('toSavedTabs', () => {
  it('只取文件页签并保序', () => {
    const tabs: CenterTab[] = [
      tab({ id: 's:1', kind: 'session', label: 'agent', projectId: undefined, path: undefined }),
      tab({ id: 'f:p1|a.ts', path: 'a.ts', label: 'a.ts' }),
      tab({ id: 'f:p2|b.ts', projectId: 'p2', path: 'b.ts', label: 'b.ts' }),
      tab({ id: 'f:p3|c.ts', projectId: 'p3', path: 'c.ts', label: '' as string }),   // label 空 → 用 path
    ];
    expect(toSavedTabs(tabs)).toEqual([
      { projectId: 'p1', path: 'a.ts', label: 'a.ts' },
      { projectId: 'p2', path: 'b.ts', label: 'b.ts' },
      { projectId: 'p3', path: 'c.ts', label: 'c.ts' },
    ]);
  });
});

describe('fileTabsOf', () => {
  it('容错各种非法输入', () => {
    expect(fileTabsOf(null)).toEqual([]);
    expect(fileTabsOf({})).toEqual([]);
    expect(fileTabsOf({ tabs: 'nope' } as unknown as WindowState)).toEqual([]);
    expect(fileTabsOf({ tabs: [
      { projectId: 'p1', path: 'a.ts' },
      { projectId: '', path: 'x.ts' },
      { projectId: 'p', path: '' },
      null,
    ] } as unknown as WindowState)).toEqual([{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }]);
  });
});

describe('planRestore', () => {
  const base = {
    tabs: [
      { projectId: 'p1', path: 'a.ts', label: 'a.ts' },
      { projectId: 'gone', path: 'x.ts', label: 'x.ts' },
    ],
    activeTab: 'f:p1|a.ts',
  };

  it('过滤失效项目并恢复激活页签', () => {
    const plan = planRestore(base, { projectIds: ['p1'], hashRail: null, hashHistoryTab: null, deepLinkOpened: false });
    expect(plan.tabs).toEqual([{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }]);
    expect(plan.activeFileTab).toBe('f:p1|a.ts');
  });

  it('hash 已指定 rail/historyTab 时不返回对应字段；只指定 rail 时 historyTab 仍回填', () => {
    const st = { rail: 'explorer' as const, historyTab: 'files' as const, msgFilter: false };
    const a = planRestore(st, { projectIds: [], hashRail: 'history', hashHistoryTab: 'messages', deepLinkOpened: false });
    expect(a.rail).toBeUndefined();
    expect(a.historyTab).toBeUndefined();
    expect(a.msgFilter).toBe(false);

    const b = planRestore(st, { projectIds: [], hashRail: 'history', hashHistoryTab: null, deepLinkOpened: false });
    expect(b.rail).toBeUndefined();
    expect(b.historyTab).toBe('files');
  });

  it('deepLinkOpened 为真时不恢复激活页签', () => {
    const plan = planRestore(base, { projectIds: ['p1'], hashRail: null, hashHistoryTab: null, deepLinkOpened: true });
    expect(plan.activeFileTab).toBeUndefined();
  });

  it('activeTab 指不到恢复出来的文件页签时不返回它', () => {
    const plan = planRestore({ ...base, activeTab: 's:deadbeef' }, { projectIds: ['p1'], hashRail: null, hashHistoryTab: null, deepLinkOpened: false });
    expect(plan.activeFileTab).toBeUndefined();
  });

  it('state 为 null 时全部走兜底', () => {
    const plan = planRestore(null, { projectIds: ['p1'], hashRail: null, hashHistoryTab: null, deepLinkOpened: false });
    expect(plan).toEqual({ tabs: [] });
  });
});

describe('saveWindowState / flushWindowState', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('去抖合并写，flush 立即写', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({}) };
    }));
    vi.useFakeTimers();

    saveWindowState({ msgFilter: true });
    saveWindowState({ msgFilter: false });
    expect(calls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(700);
    expect(calls.length).toBe(1);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ msgFilter: false });

    await flushWindowState({ msgFilter: true });
    expect(calls.length).toBe(2);
    expect(calls[1].url).toBe('/api/window-state');
    expect(calls[1].init?.method).toBe('POST');
  });

  it('写失败静默', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    await expect(flushWindowState({})).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run（cwd = `web/`）: `npx.cmd vitest run src/windowState.test.ts`
Expected: FAIL —— `Failed to resolve import "./windowState"`

- [ ] **Step 3: 实现**

创建 `web/src/windowState.ts`：

```ts
import type { CenterTab } from './useCenter';

// 窗口状态（服务端 <端口数据目录>/window-state.json，一个端口一份，多端共享一份）。
export type Rail = 'explorer' | 'history' | 'contacts' | 'stat' | 'scheduler' | 'proxy' | 'mobile';
export type HistoryTab = 'files' | 'messages';

export interface SavedTab { projectId: string; path: string; label: string }
export interface WindowState {
  rail?: Rail;
  historyTab?: HistoryTab;
  msgFilter?: boolean;
  tabs?: SavedTab[];
  activeTab?: string | null;
}

export interface RestorePlan {
  tabs: SavedTab[];            // 已过滤掉 projects 里不存在的 projectId
  rail?: Rail;                 // 仅当 URL hash 未指定栏位
  historyTab?: HistoryTab;     // 仅当 URL hash 未指定子页
  msgFilter?: boolean;
  activeFileTab?: string;      // `f:<projectId>|<path>`；深链优先或指不到时 undefined
}

const SAVE_DEBOUNCE_MS = 600;
const fileTabId = (projectId: string, path: string) => `f:${projectId}|${path}`;

// 中心页签 → 存档（只存文件页签：会话页签由服务端 SESSION_LIST 自动恢复）
export function toSavedTabs(tabs: CenterTab[]): SavedTab[] {
  const out: SavedTab[] = [];
  for (const t of tabs) {
    if (t.kind !== 'file') continue;
    if (!t.projectId || !t.path) continue;
    out.push({ projectId: t.projectId, path: t.path, label: t.label || t.path });
  }
  return out;
}

// 存档 → 文件页签列表（容错：非法项直接丢）
export function fileTabsOf(state: WindowState | null): SavedTab[] {
  if (!state || !Array.isArray(state.tabs)) return [];
  const out: SavedTab[] = [];
  for (const t of state.tabs) {
    if (!t || typeof t.projectId !== 'string' || !t.projectId) continue;
    if (typeof t.path !== 'string' || !t.path) continue;
    out.push({ projectId: t.projectId, path: t.path, label: typeof t.label === 'string' && t.label ? t.label : t.path });
  }
  return out;
}

// 恢复决策（纯函数，便于单测）：hash 优先级、失效页签过滤、激活页签兜底都在这里定。
export function planRestore(state: WindowState | null, opts: {
  projectIds: string[];
  hashRail: string | null;
  hashHistoryTab: HistoryTab | null;
  deepLinkOpened: boolean;
}): RestorePlan {
  const known = new Set(opts.projectIds);
  const tabs = fileTabsOf(state).filter((t) => known.has(t.projectId));
  const plan: RestorePlan = { tabs };
  if (!state) return plan;                                   // 无存档：不覆盖任何默认值
  if (!opts.hashRail && state.rail) plan.rail = state.rail;
  if (!opts.hashHistoryTab && state.historyTab) plan.historyTab = state.historyTab;
  if (typeof state.msgFilter === 'boolean') plan.msgFilter = state.msgFilter;
  if (opts.deepLinkOpened) return plan;                       // ?open= 深链优先于存档的激活项
  const active = state.activeTab;
  if (typeof active === 'string' && tabs.some((t) => fileTabId(t.projectId, t.path) === active)) {
    plan.activeFileTab = active;
  }
  return plan;
}

export async function fetchWindowState(): Promise<WindowState | null> {
  try {
    const res = await fetch('/api/window-state');
    if (!res.ok) return null;
    const j = await res.json();
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as WindowState) : null;
  } catch { return null; }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function putWindowState(state: WindowState): Promise<void> {
  try {
    await fetch('/api/window-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      keepalive: true,
    });
  } catch { /* 窗口状态丢了不影响使用 */ }
}

// 去抖合并写（页签开关会连续触发）
export function saveWindowState(state: WindowState): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void putWindowState(state); }, SAVE_DEBOUNCE_MS);
}

// 立即写（beforeunload 用）
export async function flushWindowState(state: WindowState): Promise<void> {
  clearTimeout(saveTimer);
  await putWindowState(state);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx.cmd vitest run src/windowState.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/windowState.ts web/src/windowState.test.ts
git commit -m "feat(web): 窗口状态读写与恢复决策纯函数"
```

---

## Task 9: 前端 `msgFilter.ts`

**Files:**
- Create: `web/src/msgFilter.ts`
- Test: `web/src/msgFilter.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `web/src/msgFilter.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { sessionOfActiveTab, resolveProject, filterMessages } from './msgFilter';
import type { HistoryMessage } from './useMessageHistory';
import type { CenterTab } from './useCenter';

const msg = (over: Partial<HistoryMessage> = {}): HistoryMessage => ({ text: 'x', ts: 1, ...over });
const sessionTab = (id: string, label: string): CenterTab => ({ id: `s:${id}`, kind: 'session', label });

describe('sessionOfActiveTab', () => {
  it('会话页签返回 sessionId + 显示名，其它返回 null', () => {
    expect(sessionOfActiveTab(sessionTab('s_1', 'agent'))).toEqual({ sessionId: 's_1', tabName: 'agent' });
    expect(sessionOfActiveTab({ id: 'f:p|a.ts', kind: 'file', label: 'a.ts' })).toBeNull();
    expect(sessionOfActiveTab(null)).toBeNull();
  });
});

describe('resolveProject', () => {
  it('活跃会话优先，其次查映射，都查不到为 null', () => {
    expect(resolveProject(msg({ sessionId: 's_1' }), { s_1: 'live' }, { s_1: 'saved' })).toBe('live');
    expect(resolveProject(msg({ sessionId: 's_1' }), {}, { s_1: 'saved' })).toBe('saved');
    expect(resolveProject(msg({ sessionId: 's_1' }), { s_1: null }, {})).toBeNull();
    expect(resolveProject(msg({ sessionId: 's_1' }), {}, {})).toBeNull();
    expect(resolveProject(msg(), {}, {})).toBeNull();
  });
});

describe('filterMessages', () => {
  const base = { sessionId: null, tabName: null, projectId: null, liveProjectBySession: {}, map: {} };

  it('筛选开启：按 sessionId 匹配；无 sessionId 的老消息退回 tabName', () => {
    const messages = [
      msg({ text: 'cur', sessionId: 's_1', tabName: 'agent' }),
      msg({ text: 'other', sessionId: 's_2', tabName: 'agent' }),
      msg({ text: 'legacy-same-tab', tabName: 'agent' }),
      msg({ text: 'legacy-other-tab', tabName: 'shell' }),
      msg({ text: 'legacy-no-tab' }),
    ];
    const out = filterMessages({ ...base, messages, filterOn: true, sessionId: 's_1', tabName: 'agent' });
    expect(out.map((m) => m.text)).toEqual(['cur', 'legacy-same-tab']);
  });

  it('无当前会话时退化为项目过滤', () => {
    const messages = [
      msg({ text: 'p1', sessionId: 's_1' }),
      msg({ text: 'p2', sessionId: 's_2' }),
      msg({ text: 'unknown' }),
    ];
    const out = filterMessages({
      ...base, messages, filterOn: true, sessionId: null, tabName: null, projectId: 'p1',
      liveProjectBySession: { s_1: 'p1' }, map: { s_2: 'p2' },
    });
    expect(out.map((m) => m.text)).toEqual(['p1', 'unknown']);
  });

  it('关闭筛选：按项目过滤，无法归属的老消息照常显示', () => {
    const messages = [
      msg({ text: 'p1', sessionId: 's_1' }),
      msg({ text: 'p2', sessionId: 's_2' }),
      msg({ text: 'unknown', sessionId: 's_dead' }),
      msg({ text: 'no-sid' }),
    ];
    const out = filterMessages({
      ...base, messages, filterOn: false, projectId: 'p1',
      liveProjectBySession: {}, map: { s_1: 'p1', s_2: 'p2' },
    });
    expect(out.map((m) => m.text)).toEqual(['p1', 'unknown', 'no-sid']);
  });

  it('没有选中项目时全量返回', () => {
    const messages = [msg({ sessionId: 's_1' }), msg({ sessionId: 's_2' })];
    expect(filterMessages({ ...base, messages, filterOn: false, projectId: null }).map((m) => m.text)).toEqual(['x', 'x']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run（cwd = `web/`）: `npx.cmd vitest run src/msgFilter.test.ts`
Expected: FAIL —— `Failed to resolve import "./msgFilter"`

- [ ] **Step 3: 实现**

创建 `web/src/msgFilter.ts`：

```ts
import type { HistoryMessage } from './useMessageHistory';
import type { CenterTab } from './useCenter';
import type { SessionProjectMap } from './sessionProjects';

// 左侧「消息」页的筛选：默认只看当前会话；关掉看当前项目。
// 项目归属优先查活跃会话，服务端重启后查 session-projects.json 映射；
// 两者都查不到的（升级前的老消息）视为「无法归属」——关闭筛选时照常显示，避免看起来像被清空。
export interface FilterInput {
  messages: HistoryMessage[];
  filterOn: boolean;
  sessionId: string | null;                              // 当前会话页签对应的会话 id
  tabName: string | null;                                // 当前会话页签的显示名
  projectId: string | null;                              // 当前项目
  liveProjectBySession: Record<string, string | null>;   // 来自 terminal.state.sessions
  map: SessionProjectMap;                                // 来自 /api/session-projects
}

export function sessionOfActiveTab(tab: CenterTab | null): { sessionId: string; tabName: string } | null {
  if (!tab || tab.kind !== 'session' || !tab.id.startsWith('s:')) return null;
  return { sessionId: tab.id.slice(2), tabName: tab.label };
}

export function resolveProject(
  msg: HistoryMessage,
  liveProjectBySession: Record<string, string | null>,
  map: SessionProjectMap,
): string | null {
  const sid = msg.sessionId;
  if (!sid) return null;
  const live = liveProjectBySession[sid];
  if (typeof live === 'string' && live) return live;
  const saved = map[sid];
  if (typeof saved === 'string' && saved) return saved;
  return null;
}

export function filterMessages(input: FilterInput): HistoryMessage[] {
  const { messages, filterOn, sessionId, tabName, projectId, liveProjectBySession, map } = input;
  if (filterOn && sessionId) {
    return messages.filter((m) => (m.sessionId ? m.sessionId === sessionId : !!tabName && m.tabName === tabName));
  }
  if (!projectId) return messages;
  return messages.filter((m) => {
    const p = resolveProject(m, liveProjectBySession, map);
    return p === null || p === projectId;   // 无法归属的老消息照常显示
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx.cmd vitest run src/msgFilter.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/msgFilter.ts web/src/msgFilter.test.ts
git commit -m "feat(web): 消息筛选纯函数（会话/项目/未知归属）"
```

---

## Task 10: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:328`（`hist.foot` 之后）
- Modify: `shared/i18n/en.js:328`（`hist.foot` 之后）

- [ ] **Step 1: 加中文词条**

`shared/i18n/zh-CN.js` 的 `'hist.foot'` 行之后插入：

```js
  'hist.filter.on': '仅当前会话',
  'hist.filter.off': '当前项目',
  'hist.filter.title': '筛选：只显示当前会话的消息；关闭后显示当前项目的消息',
```

- [ ] **Step 2: 加英文词条**

`shared/i18n/en.js` 的 `'hist.foot'` 行之后插入：

```js
  'hist.filter.on': 'Current session',
  'hist.filter.off': 'Current project',
  'hist.filter.title': 'Filter: show only the current session; turn off to show the current project',
```

- [ ] **Step 3: 验证中英对称**

Run: `npm.cmd run check:i18n`
Expected: 通过（无缺失键）

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 消息筛选开关词条"
```

---

## Task 11: `HistoryList.vue` 筛选开关按钮

**Files:**
- Modify: `web/src/components/HistoryList.vue:6`（props）、`:7-15`（emits）、`:110-117`（模板头部）、样式区
- Test: `web/src/components/HistoryList.test.ts`（追加）

- [ ] **Step 1: 写失败的测试**

在 `web/src/components/HistoryList.test.ts` 末尾（`describe` 内、最后一个 `});` 之前）追加：

```ts
  it('消息页筛选开关：默认开启、点击 emit update:filter、文件页不渲染', async () => {
    const w = mount({ tab: 'messages' });
    const btn = w.find('.filterbtn');
    expect(btn.exists()).toBe(true);
    expect(btn.classes()).toContain('on');
    expect(btn.text()).toBe('仅当前会话');
    await btn.trigger('click');
    expect(w.emitted('update:filter')?.[0]).toEqual([false]);

    const off = mount({ tab: 'messages', filter: false });
    expect(off.find('.filterbtn').classes()).not.toContain('on');
    expect(off.find('.filterbtn').text()).toBe('当前项目');

    const files = mount({ tab: 'files' });
    expect(files.find('.filterbtn').exists()).toBe(false);
  });
```

（`mount()` 辅助函数已支持传任意 props。）

- [ ] **Step 2: 跑测试确认失败**

Run（cwd = `web/`）: `npx.cmd vitest run src/components/HistoryList.test.ts`
Expected: FAIL —— `.filterbtn` 不存在

- [ ] **Step 3: 实现**

`web/src/components/HistoryList.vue` 的 `<script setup>` 里，把 props 那一行改为（加 `withDefaults` 与 `filter`；`withDefaults` 是编译器宏，无需 import，`vue` 的 import 行不用动）：

```ts
const props = withDefaults(defineProps<{ items: HistoryEntry[]; tab: 'files' | 'messages'; messages: HistoryMessage[]; filter?: boolean }>(), {
  filter: true,
});
```

emits 加一条：

```ts
  (e: 'update:filter', v: boolean): void;
```

模板 `.hh` 内、`.tabs` 之后插入：

```html
      <button v-if="tab === 'messages'" class="filterbtn" :class="{ on: filter }" :title="$t('hist.filter.title')"
        @click="emit('update:filter', !filter)">{{ filter ? $t('hist.filter.on') : $t('hist.filter.off') }}</button>
```

样式区（`.clear` 规则之后）加：

```css
.filterbtn { background: none; border: 1px solid var(--bd); color: var(--tx5); border-radius: 4px; padding: 1px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; }
.filterbtn:hover { border-color: var(--ac2); color: var(--ac2); }
.filterbtn.on { color: var(--ac2); border-color: var(--ac2); }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx.cmd vitest run src/components/HistoryList.test.ts`
Expected: PASS（原有 6 个 + 新增 1 个）

- [ ] **Step 5: 提交**

```bash
git add web/src/components/HistoryList.vue web/src/components/HistoryList.test.ts
git commit -m "feat(web): 历史消息页筛选开关按钮"
```

---

## Task 12: `App.vue` 接线（恢复 + 保存 + 筛选）

**Files:**
- Modify: `web/src/App.vue:1-21`（imports）、`:55` 附近（新状态）、`:399-420`（openFile/processOpenParam）、`:432-461`（onMounted/beforeunload）、`:527`（模板 HistoryList）

无新单测（纯接线；决策逻辑已在 Task 8/9 覆盖），由 Task 13 的手工冒烟验证。

- [ ] **Step 1: 加 import**

`web/src/App.vue` 顶部 import 区（`readMobileLanding` 那行之后）加：

```ts
import { useSessionProjects } from './sessionProjects';
import { fetchWindowState, planRestore, saveWindowState, flushWindowState, toSavedTabs, type HistoryTab, type Rail } from './windowState';
import { filterMessages, sessionOfActiveTab } from './msgFilter';
```

- [ ] **Step 2: 加状态与计算属性**

在 `const msgHistory = useMessageHistory();`（原 `:176`）之后插入：

```ts
// —— 窗口状态：上次页签/激活页签/左侧栏位/消息筛选 ——
const msgFilter = ref(true);
const { map: sessionProjectMap, load: loadSessionProjects } = useSessionProjects();
let windowRestored = false;             // 闸门：恢复完成前不写盘（避免空状态覆盖存档）
let deepLinkOpened = false;             // ?open= 深链已打开文件：优先于存档的 activeTab
const liveProjectBySession = computed(() => {
  const out: Record<string, string | null> = {};
  for (const s of terminal.state.sessions) out[s.id] = s.projectId ?? null;
  return out;
});
const activeSessionTab = computed(() => sessionOfActiveTab(center.active.value));
const visibleMessages = computed(() => filterMessages({
  messages: msgHistory.messages.value,
  filterOn: msgFilter.value,
  sessionId: activeSessionTab.value?.sessionId ?? null,
  tabName: activeSessionTab.value?.tabName ?? null,
  projectId: currentProject.value,
  liveProjectBySession: liveProjectBySession.value,
  map: sessionProjectMap.value,
}));
function currentWindowState() {
  return {
    rail: rail.value === 'mobile' ? undefined : (rail.value as Rail),
    historyTab: historyTab.value as HistoryTab,
    msgFilter: msgFilter.value,
    tabs: toSavedTabs(center.tabs.value),
    activeTab: center.activeId.value,
  };
}
async function restoreWindowState(projectsReady: Promise<void>) {
  await projectsReady;
  const ws = await fetchWindowState();
  const plan = planRestore(ws, {
    projectIds: projects.value.map((p) => p.id),
    hashRail: hashRailOf(),
    hashHistoryTab: hashHistoryTabOf(),
    deepLinkOpened,
  });
  if (plan.rail) rail.value = plan.rail;
  if (plan.historyTab) historyTab.value = plan.historyTab;
  if (typeof plan.msgFilter === 'boolean') msgFilter.value = plan.msgFilter;
  const opened = plan.tabs.map((t) => `f:${t.projectId}|${t.path}`);
  for (const t of plan.tabs) center.openFile(t.projectId, t.path, t.label);
  if (deepLinkOpened) {
    // 深链优先：不动激活项
  } else if (plan.activeFileTab) {
    center.setActive(plan.activeFileTab);
  } else if (opened.includes(center.activeId.value ?? '')) {
    center.setActive(null);             // 别停在最后一个恢复出来的文件页签，交回会话激活逻辑
  }
  windowRestored = true;
}
watch(
  [() => center.tabs.value.map((t) => `${t.id}|${t.label}`).join(','), center.activeId, rail, historyTab, msgFilter],
  () => { if (windowRestored) saveWindowState(currentWindowState()); },
);
function persistWindowState() { if (windowRestored) void flushWindowState(currentWindowState()); }
```

- [ ] **Step 3: 加 hash 查询辅助函数**

在 `parseHashSegs()` 定义之后（`applyHash` 之前或之后都行）加：

```ts
function hashRailOf(): string | null {
  const [r] = parseHashSegs();
  return r && RAILS.includes(r) ? r : null;
}
function hashHistoryTabOf(): HistoryTab | null {
  const [r, sub] = parseHashSegs();
  return r === 'history' && (sub === 'files' || sub === 'messages') ? sub : null;
}
```

- [ ] **Step 4: 深链打开标记**

把 `processOpenParam()` 里的 `openFile(r.project.id, r.rel);` 改成：

```ts
    deepLinkOpened = true;
    openFile(r.project.id, r.rel);
```

- [ ] **Step 5: 改写 `onMounted`**

把 `onMounted` 改为（保留原有逻辑，只调整项目加载与恢复的编排）：

```ts
onMounted(async () => {
  loadVersion();
  writeRegistry(windowColorId.value);
  colorHeartbeat = setInterval(() => { try { writeRegistry(windowColorId.value); } catch { /* ignore */ } }, 4000);
  try {
    const landing = readMobileLanding(window.localStorage, Date.now());
    writeMobileLanding(window.localStorage, landing);
    if (landing.openMobile) rail.value = 'mobile';
  } catch { /* ignore */ }
  applyHash();
  initFileHistory();
  const projectsReady = loadProjects();
  void restoreWindowState(projectsReady);      // 后台恢复：不阻塞终端连接
  void loadSessionProjects();
  processOpenParam();
  msgHistory.load();
  syncHash();
  window.addEventListener('hashchange', applyHash);
  window.addEventListener('df-open-history', onOpenHistory);
  window.addEventListener('beforeunload', persistFileHistory);
  window.addEventListener('beforeunload', releaseWindowColor);
  window.addEventListener('beforeunload', persistWindowState);
  terminal.connect();
});
```

`onBeforeUnmount` 里同步补一行移除：

```ts
  window.removeEventListener('beforeunload', persistWindowState);
```

- [ ] **Step 6: 模板接线**

把 `HistoryList` 那处改为：

```html
          <HistoryList v-if="rail === 'history'" :items="historyItems" :tab="historyTab" :messages="visibleMessages" :filter="msgFilter"
            @update:tab="historyTab = $event" @open="openFromHistory" @remove="(pid, p) => removeFileHistory(pid, p)"
            @clear="clearFileHistory" @open-message="onOpenMessage" @remove-message="(m) => msgHistory.remove(m)" @clear-messages="msgHistory.clear()"
            @update:filter="msgFilter = $event" />
```

- [ ] **Step 7: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过（无 TS 错误）

- [ ] **Step 8: 提交**

```bash
git add web/src/App.vue
git commit -m "feat(web): App 恢复/保存窗口状态并接入消息筛选"
```

---

## Task 13: 全量验证与手工冒烟

- [ ] **Step 1: 全量测试与检查**

Run:
```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run check:i18n
```
Expected: server 测试全绿、web 测试全绿、typecheck 无错、i18n 无缺失键。

- [ ] **Step 2: 启动 dev 环境**

在另一个终端跑 `npm.cmd run dev`（它会同时起后端 33333 与前端 5173，日志写在 `logs\dev-server.log` / `logs\dev-web.log`；Ctrl-C 结束）。
访问 http://localhost:5173

- [ ] **Step 3: 逐条冒烟（对照设计文档 §5）**

1. 打开 2 个不同项目的文件页签 → F5 刷新 → **文件页签都回来**，且上次激活的那个仍是激活态。
2. 左侧切到「🕘 历史」→ 选「消息」页 → 关闭地址栏 hash（或从启动器重开）后刷新 → **左侧仍回到历史/消息**。
3. 消息页筛选开关默认「仅当前会话」；点一下变「当前项目」→ 刷新后**开关状态保持**。
4. 在会话 A 发一条消息 → 左侧只显示该会话的消息；切到另一个会话页签 → 列表跟着换。
5. 切到文件页签（无当前会话）→ 消息页自动变成「当前项目」范围，不空。
6. 关掉 dev 后端再重开（模拟服务端重启）→ 老消息在「当前项目」视图下**仍能归属到正确项目**（`session-projects.json` 已记录）；升级前的无归属老消息**照常显示**。
7. 深链 `http://localhost:5173/?open=<某文件路径>` → 打开的是该文件，不被存档的激活页签抢走。
8. 保存的页签对应项目被移出 `projects.json` 后刷新 → 该页签被跳过，其余正常。
9. 检查 `<数据目录>/ports/33333/window-state.json` 与 `session-projects.json` 内容符合设计（路径见 `server/port-paths.js`）。
10. 手机视图（`#mobile`）停留后刷新 → 仍按 hash 回到手机视图；关闭浏览器后重开 → 由 `mobileLanding` 逻辑决定，不受存档干扰。

- [ ] **Step 4: 收尾**

确认 `git status` 只含本次预期改动；如有临时日志/文件，确认它们在 `.gitignore` 覆盖范围内（`logs/`、`data/`）。

---

## 自查记录

- **spec 覆盖**：§1 决定 1→Task 8/12；2→Task 8/12；3→Task 11/12；4→Task 9；5→Task 9；6→Task 9；7→Task 7/9；8→Task 4/6；9→Task 1/2/3；10→Task 8；11→Task 8/12；12（不做）→无任务（正确）。§5 边界 → Task 8/9 的测试 + Task 13 冒烟。
- **占位符**：无 TBD/TODO；每个代码步骤都有完整代码。
- **类型一致性**：`SavedTab`/`WindowState`/`RestorePlan`/`FilterInput`/`SessionProjectMap` 的字段名在 Task 7/8/9/12 间一致；`planRestore` 返回 `activeFileTab`（非 `activeTab`），Task 12 按此使用。
- **与 spec 的两处对齐**（已回改 spec `docs/superpowers/specs/2026-09-17-window-restore-design.md`）：
  1. `windowState.ts` 用独立函数 `saveWindowState()` / `flushWindowState()`，不用原来的 `useWindowState()` 包装（写盘由调用方传入状态，无需内部 ref）。
  2. `planRestore()` 的返回由 `activeTab` + `clearActive` 改为 `activeFileTab`（只针对文件页签）——避免与会话列表到达的时序赛跑；"置空激活项"只在 `App.vue` 里、且仅当激活项是自己 `openFile()` 造成时才做。
