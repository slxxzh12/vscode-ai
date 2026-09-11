# 端口数据档案（Port Profiles）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个端口使用一套完全独立的数据档案，启动时多份档案则弹窗选择，并按监听端口记忆选择。

**Architecture:** 服务先绑定端口，再解析"端口档案"（`devflow/ports/<id>/`），档案确定后才构建数据模块；未就绪时业务 API 返回 409，只提供 `/api/workspace/*` 与静态页，前端弹窗选择。旧数据一次性迁移为档案 `22222`。

**Tech Stack:** Node.js (ESM, node:test) 服务端；Vue 3 + TypeScript + Vite 前端；共享 i18n（`shared/i18n`）。

参考规格：`docs/superpowers/specs/2026-09-11-port-profiles-design.md`

---

## 文件结构

**新建**
- `server/workspace.js` — 档案路径/状态/解析/创建/迁移/选择服务（无重依赖，便于单测）。
- `server/workspace-http.js` — `/api/workspace/*` 路由。
- `server/test/workspace.test.js` — 档案逻辑单测。
- `server/test/workspace-http.test.js` — 路由单测。
- `web/src/useWorkspace.ts` — 前端工作区 API。
- `web/src/components/WorkspacePicker.vue` — 档案选择弹窗。

**修改**
- `server/index.js` — 先绑定端口 → 解析档案 → 懒初始化；新增 workspace 路由与 409 门禁。
- `web/src/App.vue` — 启动先取工作区状态，需要选择时显示弹窗。
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js` — workspace 文案。
- `README.md` — 说明端口档案与数据目录。

**不改**
- `server/config.js`（保留 `ensureDefaults/loadProjects/loadWorkflows` 供新流程复用；`resolveFiles` 保留兼容）。
- `server/projects.js`、`server/message-history.js`（路径由调用方传入）。

---

### Task 1: workspace.js 核心（路径 / 状态 / 档案读写）

**Files:**
- Create: `server/workspace.js`
- Test: `server/test/workspace.test.js`

- [ ] **Step 1: 写失败测试**

`server/test/workspace.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  profilesRoot, stateFile, readState, writeState, listProfiles,
  readProfile, profilePaths, createProfile, touchProfile, bindProfile,
} from '../workspace.js';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-ws-')); }

test('writeState/readState 原子读写', () => {
  const root = tmpRoot();
  writeState(stateFile(root), { byListenPort: { '22222': '22222' } });
  assert.deepEqual(readState(stateFile(root)), { version: 1, byListenPort: { '22222': '22222' } });
});

test('readState 坏文件返回空状态', () => {
  const root = tmpRoot();
  fs.writeFileSync(stateFile(root), '{not json', 'utf8');
  assert.deepEqual(readState(stateFile(root)), { version: 1, byListenPort: {} });
});

test('createProfile 建目录与 profile.json，重复报 exists', () => {
  const root = tmpRoot();
  const p = createProfile(root, { id: '22222', name: '端口 22222', port: 22222 });
  assert.equal(p.id, '22222');
  assert.ok(fs.existsSync(path.join(profilesRoot(root), '22222', 'profile.json')));
  assert.ok(fs.existsSync(path.join(profilesRoot(root), '22222', 'collab')));
  assert.throws(() => createProfile(root, { id: '22222', port: 22222 }), /exists/);
});

test('createProfile 拒绝非法 id', () => {
  const root = tmpRoot();
  assert.throws(() => createProfile(root, { id: '../x', port: 1 }), /invalid/);
});

test('listProfiles 按 lastUsedAt 倒序', () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  createProfile(root, { id: 'b', port: 2 });
  touchProfile(root, 'a');
  const list = listProfiles(root);
  assert.equal(list[0].id, 'a');
});

test('bindProfile 写入监听端口映射', () => {
  const root = tmpRoot();
  createProfile(root, { id: '22222', port: 22222 });
  bindProfile(root, 33333, '22222');
  assert.equal(readState(stateFile(root)).byListenPort['33333'], '22222');
});

test('profilePaths 指向档案内各路径', () => {
  const root = tmpRoot();
  const p = profilePaths(root, '22222');
  assert.ok(p.projectsFile.endsWith(path.join('22222', 'projects.json')));
  assert.ok(p.historyFile.endsWith(path.join('22222', 'message-history.jsonc')));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix D:/root/devflow/devflow run test:server 2>&1 | findstr workspace`
Expected: FAIL（`Cannot find module '../workspace.js'`）

- [ ] **Step 3: 实现 `server/workspace.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { dataHome } from './data-home.js';

export const PROFILE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function profilesRoot(root = dataHome()) { return path.join(root, 'ports'); }
export function stateFile(root = dataHome()) { return path.join(root, 'ports-state.json'); }

export function readState(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const by = j && typeof j.byListenPort === 'object' && j.byListenPort ? j.byListenPort : {};
    return { version: 1, byListenPort: { ...by } };
  } catch {
    return { version: 1, byListenPort: {} };
  }
}

export function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = JSON.stringify({ version: 1, byListenPort: (state && state.byListenPort) || {} }, null, 2);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
}

export function readProfile(root, id) {
  if (typeof id !== 'string' || !PROFILE_ID_RE.test(id)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(profilesRoot(root), id, 'profile.json'), 'utf8'));
    return {
      id,
      name: String(j.name || id),
      port: Number(j.port) || 0,
      createdAt: Number(j.createdAt) || 0,
      lastUsedAt: Number(j.lastUsedAt) || 0,
    };
  } catch { return null; }
}

export function listProfiles(root = dataHome()) {
  let names = [];
  try {
    names = fs.readdirSync(profilesRoot(root), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch { return []; }
  return names.map((id) => readProfile(root, id)).filter(Boolean)
    .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
}

export function profilePaths(root, id) {
  const dir = path.join(profilesRoot(root), id);
  return {
    id,
    dir,
    profileFile: path.join(dir, 'profile.json'),
    projectsFile: path.join(dir, 'projects.json'),
    workflowsFile: path.join(dir, 'workflows.json'),
    schedulerDir: path.join(dir, 'scheduler'),
    collabDir: path.join(dir, 'collab'),
    identityFile: path.join(dir, 'collab', 'identity.json'),
    storeFile: path.join(dir, 'collab', 'collab.json'),
    uploadDir: path.join(dir, 'upload'),
    downloadDir: path.join(dir, 'download'),
    historyFile: path.join(dir, 'message-history.jsonc'),
    skillsRoot: path.join(dir, 'skills-opencode'),
  };
}

export function createProfile(root, { id, name, port }) {
  if (typeof id !== 'string' || !PROFILE_ID_RE.test(id)) {
    const e = new Error('invalid profile id'); e.code = 'bad-id'; throw e;
  }
  const dir = path.join(profilesRoot(root), id);
  if (fs.existsSync(path.join(dir, 'profile.json'))) {
    const e = new Error('profile exists'); e.code = 'exists'; throw e;
  }
  const now = Date.now();
  fs.mkdirSync(dir, { recursive: true });
  for (const sub of ['collab', 'upload', 'download', 'scheduler', 'skills-opencode']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  const meta = { id, name: name || `端口 ${port}`, port: Number(port) || 0, createdAt: now, lastUsedAt: now };
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

export function touchProfile(root, id) {
  const meta = readProfile(root, id);
  if (!meta) return null;
  meta.lastUsedAt = Date.now();
  try { fs.writeFileSync(path.join(profilesRoot(root), id, 'profile.json'), JSON.stringify(meta, null, 2), 'utf8'); }
  catch { /* ignore */ }
  return meta;
}

export function bindProfile(root, listenPort, id) {
  const st = readState(stateFile(root));
  st.byListenPort[String(listenPort)] = id;
  writeState(stateFile(root), st);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix D:/root/devflow/devflow run test:server 2>&1 | findstr /C:"tests" /C:"fail"`
Expected: PASS（fail 0）

- [ ] **Step 5: 提交**

```bash
git add server/workspace.js server/test/workspace.test.js
git commit -m "feat(workspace): 端口档案路径/状态/读写核心"
```

---

### Task 2: 迁移与档案解析

**Files:**
- Modify: `server/workspace.js`
- Test: `server/test/workspace.test.js`

- [ ] **Step 1: 追加失败测试**

在 `server/test/workspace.test.js` 末尾追加：

```js
import { migrateLegacy, resolveProfile } from '../workspace.js';

test('migrateLegacy 复制旧数据为档案 22222 并写标记', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ projects: [{ id: 'local', name: '本地', root: '.' }] }), 'utf8');
  fs.mkdirSync(path.join(root, 'scheduler'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scheduler', 'tasks.json'), '[]', 'utf8');
  const p = migrateLegacy(root);
  assert.equal(p.id, '22222');
  assert.ok(fs.existsSync(path.join(profilesRoot(root), '22222', 'projects.json')));
  assert.ok(fs.existsSync(path.join(root, 'ports', '.migrated')));
  assert.equal(migrateLegacy(root), null);   // 幂等：ports/ 已存在不再迁移
});

test('migrateLegacy 无旧数据返回 null', () => {
  const root = tmpRoot();
  assert.equal(migrateLegacy(root), null);
});

test('resolveProfile: 0 份 ready 且 profile 为 null', () => {
  const root = tmpRoot();
  const r = resolveProfile({ root, listenPort: 22222 });
  assert.equal(r.status, 'ready');
  assert.equal(r.profile, null);
});

test('resolveProfile: 1 份自动使用', () => {
  const root = tmpRoot();
  createProfile(root, { id: '22222', port: 22222 });
  const r = resolveProfile({ root, listenPort: 33333 });
  assert.equal(r.status, 'ready');
  assert.equal(r.profile.id, '22222');
});

test('resolveProfile: 映射命中直接使用', () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  createProfile(root, { id: 'b', port: 2 });
  bindProfile(root, 22222, 'b');
  const r = resolveProfile({ root, listenPort: 22222 });
  assert.equal(r.status, 'ready');
  assert.equal(r.profile.id, 'b');
});

test('resolveProfile: 映射指向缺失档案则重新判断', () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  createProfile(root, { id: 'b', port: 2 });
  bindProfile(root, 22222, 'gone');
  const r = resolveProfile({ root, listenPort: 22222 });
  assert.equal(r.status, 'select');
  assert.equal(r.profiles.length, 2);
});

test('resolveProfile: 多份且未映射 -> select', () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  createProfile(root, { id: 'b', port: 2 });
  assert.equal(resolveProfile({ root, listenPort: 22222 }).status, 'select');
});

test('resolveProfile: nodeMode 直接 node', () => {
  const root = tmpRoot();
  assert.equal(resolveProfile({ root, listenPort: 22222, nodeMode: true }).status, 'node');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm --prefix D:/root/devflow/devflow run test:server 2>&1 | findstr /C:"migrateLegacy" /C:"resolveProfile"`
Expected: FAIL（导出不存在）

- [ ] **Step 3: 实现迁移与解析**

在 `server/workspace.js` 末尾追加：

```js
function copyFileIf(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst)) return false;   // 幂等：已存在跳过
  fs.copyFileSync(src, dst);
  return true;
}
function copyDirIf(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirIf(s, d);
    else copyFileIf(s, d);
  }
  return true;
}
// 在 nodes/<fp>/ 下取最近修改的 message-history.jsonc
function findNewestMessageHistory(nodesDir) {
  let best = null; let bestM = -1;
  let fps = [];
  try { fps = fs.readdirSync(nodesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return null; }
  for (const fp of fps) {
    const f = path.join(nodesDir, fp, 'message-history.jsonc');
    try { const m = fs.statSync(f).mtimeMs; if (m > bestM) { bestM = m; best = f; } } catch { /* skip */ }
  }
  return best;
}

// 旧数据 -> ports/<id>（只在 ports/ 不存在时执行；复制不删除，幂等）
export function migrateLegacy(root = dataHome(), id = '22222') {
  const proot = profilesRoot(root);
  if (fs.existsSync(proot)) return null;
  const legacy = ['projects.json', 'workflows.json', 'scheduler', 'collab']
    .map((n) => path.join(root, n));
  if (!legacy.some((p) => fs.existsSync(p))) return null;
  const dir = path.join(proot, id);
  for (const sub of ['collab', 'upload', 'download', 'scheduler', 'skills-opencode']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  copyFileIf(path.join(root, 'projects.json'), path.join(dir, 'projects.json'));
  copyFileIf(path.join(root, 'workflows.json'), path.join(dir, 'workflows.json'));
  copyDirIf(path.join(root, 'scheduler'), path.join(dir, 'scheduler'));
  copyDirIf(path.join(root, 'collab'), path.join(dir, 'collab'));
  const hist = findNewestMessageHistory(path.join(root, 'nodes'));
  if (hist) copyFileIf(hist, path.join(dir, 'message-history.jsonc'));
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'profile.json'),
    JSON.stringify({ id, name: '默认 (22222)', port: 22222, createdAt: now, lastUsedAt: now }, null, 2), 'utf8');
  fs.writeFileSync(path.join(proot, '.migrated'), String(now), 'utf8');
  return readProfile(root, id);
}

// 解析：node 模式 / 命中映射 / 单份 / 零份 / 多份
export function resolveProfile({ root = dataHome(), listenPort, nodeMode = false } = {}) {
  if (nodeMode) return { status: 'node' };
  const mapped = readState(stateFile(root)).byListenPort[String(listenPort)];
  if (mapped) {
    const meta = readProfile(root, mapped);
    if (meta) return { status: 'ready', profile: meta };
  }
  const profiles = listProfiles(root);
  if (profiles.length === 1) return { status: 'ready', profile: profiles[0] };
  if (profiles.length === 0) return { status: 'ready', profile: null };
  return { status: 'select', profiles };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm --prefix D:/root/devflow/devflow run test:server 2>&1 | findstr /C:"fail"`
Expected: `fail 0`

- [ ] **Step 5: 提交**

```bash
git add server/workspace.js server/test/workspace.test.js
git commit -m "feat(workspace): 旧数据迁移与档案解析"
```

---

### Task 3: 选择服务 + `/api/workspace/*` 路由

**Files:**
- Modify: `server/workspace.js`
- Create: `server/workspace-http.js`
- Test: `server/test/workspace-http.test.js`

- [ ] **Step 1: 写失败测试**

`server/test/workspace-http.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProfile } from '../workspace.js';
import { createWorkspaceService } from '../workspace.js';
import { createWorkspaceHttp } from '../workspace-http.js';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-wsh-')); }

async function start(service) {
  const handler = createWorkspaceHttp({ service });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    Promise.resolve(handler(req, res, url)).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}
function get(server, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
  });
}
function post(server, url, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject); req.end(data);
  });
}

test('state 列出档案与项目数', async () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  fs.writeFileSync(path.join(root, 'ports', 'a', 'projects.json'), JSON.stringify({ projects: [{ id: 'x' }] }), 'utf8');
  let ready = null;
  const service = createWorkspaceService({ root, listenPort: 22222, onProfile: (id) => { ready = id; } });
  const server = await start(service);
  const r = await get(server, '/api/workspace/state');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.needSelect, true);
  assert.equal(j.profiles[0].id, 'a');
  assert.equal(j.profiles[0].projectCount, 1);
  server.close();
});

test('select 写映射并触发 onProfile', async () => {
  const root = tmpRoot();
  createProfile(root, { id: 'a', port: 1 });
  let ready = null;
  const service = createWorkspaceService({ root, listenPort: 22222, onProfile: (paths) => { ready = paths.id; } });
  const server = await start(service);
  const r = await post(server, '/api/workspace/select', { id: 'a' });
  assert.equal(r.status, 200);
  assert.equal(ready, 'a');
  const st = JSON.parse(fs.readFileSync(path.join(root, 'ports-state.json'), 'utf8'));
  assert.equal(st.byListenPort['22222'], 'a');
  server.close();
});

test('select 不存在 -> 404', async () => {
  const root = tmpRoot();
  const service = createWorkspaceService({ root, listenPort: 22222, onProfile: () => {} });
  const server = await start(service);
  const r = await post(server, '/api/workspace/select', { id: 'nope' });
  assert.equal(r.status, 404);
  server.close();
});

test('create 以监听端口为 id 新建', async () => {
  const root = tmpRoot();
  const service = createWorkspaceService({ root, listenPort: 33333, onProfile: () => {} });
  const server = await start(service);
  const r = await post(server, '/api/workspace/create', { name: '工作区' });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).profile.id, '33333');
  server.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm --prefix D:/root/devflow/devflow run test:server 2>&1 | findstr /C:"workspace-http"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现服务（追加到 `server/workspace.js`）**

```js
export function createWorkspaceService({ root = dataHome(), listenPort, onProfile, logger = console } = {}) {
  const proot = profilesRoot(root);
  const sfile = stateFile(root);

  function countProjects(id) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(proot, id, 'projects.json'), 'utf8'));
      return Array.isArray(j.projects) ? j.projects.length : 0;
    } catch { return 0; }
  }
  function bind(id) {
    const st = readState(sfile);
    st.byListenPort[String(listenPort)] = id;
    writeState(sfile, st);
    touchProfile(root, id);
  }
  return {
    state() {
      const current = readState(sfile).byListenPort[String(listenPort)] || null;
      const profiles = listProfiles(root).map((p) => ({ ...p, projectCount: countProjects(p.id) }));
      return { ready: false, needSelect: true, listenPort, current, profiles };
    },
    select(id) {
      const meta = readProfile(root, id);
      if (!meta) { const e = new Error('profile not found'); e.code = 'not-found'; throw e; }
      bind(meta.id);
      logger?.info?.(`workspace: port ${listenPort} -> profile ${meta.id}`);
      onProfile(profilePaths(root, meta.id));
      return { ok: true, profile: meta };
    },
    create(name) {
      let id = String(listenPort);
      let n = 2;
      while (readProfile(root, id)) id = `${listenPort}-${n++}`;
      const meta = createProfile(root, { id, name: typeof name === 'string' && name.trim() ? name.trim() : `端口 ${listenPort}`, port: listenPort });
      bind(meta.id);
      logger?.info?.(`workspace: created profile ${meta.id} for port ${listenPort}`);
      onProfile(profilePaths(root, meta.id));
      return { ok: true, profile: meta };
    },
  };
}
```

- [ ] **Step 4: 实现 `server/workspace-http.js`**

```js
// /api/workspace/* 路由。handler 返回 true 表示已处理。
export function createWorkspaceHttp({ service }) {
  const send = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) => new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
  return async function handle(req, res, url) {
    if (url.pathname === '/api/workspace/state' && req.method === 'GET') {
      send(res, 200, service.state());
      return true;
    }
    if (url.pathname === '/api/workspace/select' && req.method === 'POST') {
      const body = await readBody(req);
      try { send(res, 200, service.select(String(body.id || ''))); }
      catch (e) { send(res, e.code === 'not-found' ? 404 : 400, { error: 'select failed', message: String(e && e.message || e) }); }
      return true;
    }
    if (url.pathname === '/api/workspace/create' && req.method === 'POST') {
      const body = await readBody(req);
      try { send(res, 200, service.create(typeof body.name === 'string' ? body.name : undefined)); }
      catch (e) { send(res, 400, { error: 'create failed', message: String(e && e.message || e) }); }
      return true;
    }
    return false;
  };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npm --prefix D:/root/devflow/devflow run test:server 2>&1 | findstr /C:"fail"`
Expected: `fail 0`

- [ ] **Step 6: 提交**

```bash
git add server/workspace.js server/workspace-http.js server/test/workspace-http.test.js
git commit -m "feat(workspace): 选择服务与 /api/workspace 路由"
```

---

### Task 4: 抽出 `buildWorkspace`（行为不变的重构）

**Files:**
- Modify: `server/index.js:40-146`

本任务只把现有数据模块构造搬进一个工厂函数，仍按老路径、启动即建，保证行为与现状一致（现有测试 + 启动验证）。

- [ ] **Step 1: 在 `server/index.js` 中用工厂替换 40-146 行的直接构造**

只改两处 import：第 13 行增加 `ensureDefaults`（`dataHome/instanceName/instanceSeedDir/instanceFpRoot/collabDir/uploadDir/downloadDir/seedFromLegacy` 已在第 57 行导入，`publicFingerprint` 已在第 58 行导入，勿重复）：

```js
import { resolveFiles, ensureDefaults, loadProjects, loadWorkflows } from './config.js';
```

把第 40-51 行（`files/projects/saveProjects/workflows/sessionManager/workflowRunner`）与 56-146 行（collab、scheduler、eventBus）整理为下面这个工厂（保留模块级 `HOST`/`PORT_DEFAULT`/`NODE`/`gateway`，并把 `broadcastCollab`/`broadcastSched` 提到工厂前）：

```js
const HOST = process.env.DEVFLOW_HOST || '127.0.0.1';
const PORT_DEFAULT = Number(process.env.DEVFLOW_PORT || 22222);
const NODE = instanceName();
let gateway = null;

const broadcastCollab = (type, payload) => { if (!gateway) return; for (const c of gateway.conns) c.send({ type, ...payload }); };
const broadcastSched = (type, payload) => { if (!gateway) return; for (const c of gateway.conns) c.send({ type, ...payload }); };

// 由档案路径构建所有数据模块（不监听端口，不建 gateway）
function buildWorkspace({ paths, port }) {
  const projectsFile = process.env.DEVFLOW_PROJECTS || paths.projectsFile;
  const workflowsFile = process.env.DEVFLOW_WORKFLOWS || paths.workflowsFile;
  ensureDefaults(projectsFile, workflowsFile);
  const projects = new Projects({ projects: loadProjects(projectsFile), logger: log });
  const saveProjects = () => {
    try { fs.writeFileSync(projectsFile, JSON.stringify({ projects: projects.rawProjects() }, null, 2), 'utf8'); }
    catch (e) { log.warn?.('save projects failed', e && e.message); }
  };
  const workflows = loadWorkflows(workflowsFile);
  const sessionManager = new SessionManager({ logger: log, projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null });
  const workflowRunner = new WorkflowRunner({ sessionManager, workflows, logger: log });

  const identity = loadIdentity({ file: paths.identityFile, host: HOST, port });
  const eventBus = createEventBus();
  const engine = new CollabEngine({
    store: new CollabStore({ file: paths.storeFile, logger: log }),
    identity, skillsRoot: paths.skillsRoot,
    uploadDir: paths.uploadDir, downloadDir: paths.downloadDir,
    events: eventBus, logger: log,
  });
  engine.peer = makePeerClient();
  const collabMount = createCollabMount({ engine, logger: log });
  eventBus.on('friend-request', (p) => broadcastCollab(CollabS2C.COLLAB_FRIEND_REQ, p));
  eventBus.on('group-invite', (p) => broadcastCollab(CollabS2C.COLLAB_GROUP_INVITE, p));
  eventBus.on('inbox', (p) => broadcastCollab(CollabS2C.COLLAB_INBOX, p));
  eventBus.on('synced', () => broadcastCollab(CollabS2C.COLLAB_SYNCED, {}));
  eventBus.on('chat', (p) => broadcastCollab(CollabS2C.COLLAB_CHAT, { groupId: p.groupId, msg: p.msg }));
  eventBus.on('cmd-pending', (p) => broadcastCollab(CollabS2C.COLLAB_CMD_PENDING, p));

  const scheduler = createScheduler({
    dir: paths.schedulerDir,
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    logger: log,
  });
  scheduler.engine.onEvent((evt, payload) => {
    const type = evt === 'run-start' ? SchedulerS2C.SCHED_RUN_START
      : evt === 'run-end' ? SchedulerS2C.SCHED_RUN_END
      : SchedulerS2C.SCHED_TASKS_CHANGED;
    broadcastSched(type, payload);
  });

  const httpApi = createHttpApi({ projects, saveProjects, logger: log });
  return { projects, saveProjects, workflows, sessionManager, workflowRunner, engine, collabMount, scheduler, httpApi, historyFile: paths.historyFile, paths };
}
```

- [ ] **Step 2: 构造并保存默认路径 bundle（与旧行为等价）**

> 复用文件顶部第 57 行已有的 `collabDir / uploadDir / downloadDir / seedFromLegacy / dataHome / instanceFpRoot` 与第 58 行 `publicFingerprint` 导入，**不要重复 import**。把原先直接写在模块顶层的 identity/store/路径构造搬进 `legacyPaths()`：

```js
function legacyPaths() {
  const COLLAB_DIR = collabDir();
  seedFromLegacy(path.join(COLLAB_DIR, 'identity.json'), path.join(__dirname, 'collaboration', 'identity.json'));
  seedFromLegacy(path.join(COLLAB_DIR, 'collab.json'), path.join(__dirname, 'collaboration', 'collab.json'));
  return {
    id: 'default',
    identityFile: path.join(COLLAB_DIR, 'identity.json'),
    storeFile: path.join(COLLAB_DIR, 'collab.json'),
    uploadDir: uploadDir(), downloadDir: downloadDir(),
    skillsRoot: process.env.DEVFLOW_COLLAB_SKILLS || path.join(os.homedir(), '.config', 'opencode', 'skills'),
    projectsFile: resolveFiles().projectsFile,
    workflowsFile: resolveFiles().workflowsFile,
    schedulerDir: path.join(dataHome(), 'scheduler'),
    historyFile: null,   // 在下面按指纹补
  };
}
const _seedPaths = legacyPaths();
const _seedIdentity = loadIdentity({ file: _seedPaths.identityFile, host: HOST, port: PORT_DEFAULT });
_seedPaths.historyFile = path.join(instanceFpRoot(publicFingerprint(_seedIdentity.publicKey)), 'message-history.jsonc');
const wsDefault = buildWorkspace({ paths: _seedPaths, port: PORT_DEFAULT });
let ws = wsDefault;   // Task 5 改为按档案懒加载
```

> 说明：本步让 `ws` 与旧全局变量等价；旧代码中对 `projects/collabEngine/collabMount/scheduler/httpApi/historyFile` 的引用需替换为 `ws.projects` 等（见 Step 3）。

- [ ] **Step 3: 替换旧全局引用**

在 HTTP handler、config watch、`startListening` 中，把所有旧的 `projects`→`ws.projects`、`collabMount`→`ws.collabMount`、`scheduler`→`ws.scheduler`、`historyFile`→`ws.historyFile`、`createHttpApi(...)`→`ws.httpApi`、`collabEngine`→`ws.engine`。gateway 创建保持 `createGateway({ httpServer: server, sessionManager: ws.sessionManager, workflowRunner: ws.workflowRunner, requireAuthWs, log })`。

- [ ] **Step 4: 验证**

Run: `npm --prefix D:/root/devflow/devflow run test:server 2>&1 | findstr /C:"fail"`
Expected: `fail 0`
Run（另一个终端）: `npm --prefix D:/root/devflow/devflow run dev:server`，访问 `http://127.0.0.1:22222/api/projects`
Expected: 200 且返回项目列表（与改动前一致）

- [ ] **Step 5: 提交**

```bash
git add server/index.js
git commit -m "refactor(server): 抽出 buildWorkspace 工厂（行为不变）"
```

---

### Task 5: 懒初始化 + 工作区路由 + 409 门禁

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 引入 workspace 模块**

在 `server/index.js` import 区加入：

```js
import { dataHome as _dataHome } from './data-home.js';
import {
  profilesRoot, stateFile, readState, writeState, listProfiles, readProfile,
  profilePaths, createProfile, touchProfile, bindProfile, migrateLegacy, resolveProfile,
  createWorkspaceService,
} from './workspace.js';
import { createWorkspaceHttp } from './workspace-http.js';
```

- [ ] **Step 2: 把数据模块改为懒加载**

将模块级 `let ws = wsDefault;` 与 `const wsDefault = ...` 删除（保留 `legacyPaths` 供 DEVFLOW_NODE 分支）。改为：

```js
let ws = null;               // ready 后指向 bundle
let actualPort = null;
let workspaceHttp = null;    // needs-selection 时可用

function initWorkspace(paths, port) {
  ws = buildWorkspace({ paths, port });
  actualPort = port;
  if (!gateway) {
    gateway = createGateway({ httpServer: server, sessionManager: ws.sessionManager, workflowRunner: ws.workflowRunner, requireAuthWs, log });
  }
  ws.engine.setAdvertised({ host: HOST, port });
  if (!['0', 'off', 'false'].includes(String(process.env.DEVFLOW_SCHEDULER || '').toLowerCase())) {
    ws.scheduler.engine.start();
    log.info('scheduler started');
  }
  log.info(`workspace ready: profile=${paths.id} port=${port}`);
}
```

- [ ] **Step 3: HTTP handler 加门禁与 workspace 路由**

在 `createServer` 回调内、`requireAuthHttp` 之后、业务路由之前插入：

```js
    // 工作区选择（永远可用）
    if (url.pathname.startsWith('/api/workspace')) {
      if (!ws && workspaceHttp) { await workspaceHttp(req, res, url); return; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ready: true, needSelect: false, listenPort: actualPort, current: ws ? ws.paths.id : null, profiles: [] }));
      return;
    }
    // 配置类接口永远可用（不依赖档案）
    //   /api/workflows-xml /api/agents /api/settings* 保持原位（放在本段之后、门禁之前）
    ...
    // 未就绪：其余 /api/* 返回 409
    if (url.pathname.startsWith('/api/') && !ws) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'not-ready' }));
      return;
    }
```

并把 `/api/history` 用 `ws.historyFile`、collab 用 `ws.collabMount`、scheduler 用 `ws.scheduler.mount`、通用 `/api/` 用 `ws.httpApi`。静态服务保持在最后（未就绪也要能打开页面看弹窗）。

同时把 config 热重载里的广播循环加空值保护（`gateway` 在档案就绪前为 `null`）：

```js
for (const conn of (gateway?.conns || [])) conn.send({ type: S2C.CONFIG_CHANGED });
```

- [ ] **Step 4: 启动时解析档案**

替换 `startListening` 的 `onListening`：

```js
  const onListening = () => {
    server.removeListener('error', onError);
    const actual = server.address().port;
    actualPort = actual;
    writeRuntimePort(actual);
    log.info(`listening on http://${HOST}:${actual}  (ws: ws://${HOST}:${actual}/ws)`);

    if (NODE) {   // 逃生通道：沿用 nodes/<name> 机制
      const seedDir = instanceSeedDir(NODE);
      const identity = loadIdentity({ file: path.join(seedDir, 'identity.json'), host: HOST, port: actual });
      const stateRoot = instanceFpRoot(publicFingerprint(identity.publicKey));
      const paths = {
        id: `node-${NODE}`,
        identityFile: path.join(seedDir, 'identity.json'),
        storeFile: path.join(stateRoot, 'collab.json'),
        uploadDir: path.join(stateRoot, 'upload'),
        downloadDir: path.join(stateRoot, 'download'),
        skillsRoot: process.env.DEVFLOW_COLLAB_SKILLS || path.join(stateRoot, 'skills-opencode'),
        projectsFile: path.join(_dataHome(), 'projects.json'),
        workflowsFile: path.join(_dataHome(), 'workflows.json'),
        schedulerDir: path.join(_dataHome(), 'scheduler'),
        historyFile: path.join(stateRoot, 'message-history.jsonc'),
      };
      initWorkspace(paths, actual);
      return;
    }

    migrateLegacy(_dataHome());      // 首次：复制旧数据为档案 22222
    const r = resolveProfile({ listenPort: actual });
    if (r.status === 'ready') {
      const prof = r.profile || createProfile(_dataHome(), { id: String(actual), name: `端口 ${actual}`, port: actual });
      bindProfile(_dataHome(), actual, prof.id);
      touchProfile(_dataHome(), prof.id);
      initWorkspace(profilePaths(_dataHome(), prof.id), actual);
    } else {
      const service = createWorkspaceService({
        root: _dataHome(), listenPort: actual,
        onProfile: (paths) => initWorkspace(paths, actual),
        logger: log,
      });
      workspaceHttp = createWorkspaceHttp({ service });
      log.info(`workspace: ${r.profiles.length} profiles found, awaiting selection`);
    }
  };
```

删除旧的 `collabEngine.setAdvertised(...)` 和 `scheduler.engine.start()` 调用（已并入 `initWorkspace`）。

- [ ] **Step 5: 验证**

Run: `npm --prefix D:/root/devflow/devflow run test:server 2>&1 | findstr /C:"fail"`
Expected: `fail 0`
手动：
1. 备份并临时移走 `%USERPROFILE%\.local\share\devflow\ports`、`ports-state.json`；启动服务 → 访问 `/api/workspace/state` 返回 `ready`（首次单档案/自动新建）。
2. 造两个档案：手动 `mkdir ports/a ports/b` 各放 `profile.json` 与 `projects.json`，删 `ports-state.json`；启动 → `/api/workspace/state` 返回 `needSelect:true` 且列出两份；`POST /api/workspace/select {id:"a"}` → 200；再启动同端口 → 自动使用 a。

- [ ] **Step 6: 提交**

```bash
git add server/index.js
git commit -m "feat(server): 端口档案懒初始化、workspace 路由与 409 门禁"
```

---

### Task 6: i18n 文案

**Files:**
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 追加词条**

在 `shared/i18n/zh-CN.js` 的 `term.done` 附近追加：

```js
  'ws.pick.title': '选择数据档案',
  'ws.pick.desc': '检测到多个端口的数据档案，请选择本次使用哪一个（按端口记忆，下次自动沿用）。',
  'ws.pick.use': '使用',
  'ws.pick.create': '新建档案',
  'ws.pick.new_name': '新档案名称（可选）',
  'ws.pick.last_used': '最近使用',
  'ws.pick.projects': '{count} 个项目',
  'ws.pick.loading': '加载中…',
  'ws.pick.failed': '操作失败：{msg}',
```

在 `shared/i18n/en.js` 同位置追加：

```js
  'ws.pick.title': 'Choose a data profile',
  'ws.pick.desc': 'Multiple port data profiles were found. Choose one for this session (remembered per port).',
  'ws.pick.use': 'Use',
  'ws.pick.create': 'New profile',
  'ws.pick.new_name': 'New profile name (optional)',
  'ws.pick.last_used': 'Last used',
  'ws.pick.projects': '{count} projects',
  'ws.pick.loading': 'Loading…',
  'ws.pick.failed': 'Failed: {msg}',
```

- [ ] **Step 2: 校验**

Run: `npm --prefix D:/root/devflow/devflow run check:i18n`
Expected: `check-i18n: 未发现中文命中`

- [ ] **Step 3: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 端口档案选择文案"
```

---

### Task 7: 前端选择弹窗

**Files:**
- Create: `web/src/useWorkspace.ts`
- Create: `web/src/components/WorkspacePicker.vue`
- Modify: `web/src/App.vue`

- [ ] **Step 1: `web/src/useWorkspace.ts`**

```ts
export interface WorkspaceProfile { id: string; name: string; port: number; lastUsedAt: number; projectCount?: number; }
export interface WorkspaceState { ready: boolean; needSelect: boolean; listenPort: number; current: string | null; profiles: WorkspaceProfile[]; }

async function jsonPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { message?: string; error?: string }).message || (j as { error?: string }).error || `HTTP ${res.status}`);
  return j as T;
}

export function useWorkspace() {
  return {
    async state(): Promise<WorkspaceState> {
      return fetch('/api/workspace/state').then((r) => r.json());
    },
    select(id: string) { return jsonPost<{ ok: boolean }>('/api/workspace/select', { id }); },
    create(name?: string) { return jsonPost<{ ok: boolean; profile: WorkspaceProfile }>('/api/workspace/create', { name }); },
  };
}
```

- [ ] **Step 2: `web/src/components/WorkspacePicker.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useWorkspace, type WorkspaceState } from '../useWorkspace';

const props = defineProps<{ state: WorkspaceState }>();
const ws = useWorkspace();
const busy = ref(false);
const name = ref('');
const err = ref('');

function fmt(ts: number) {
  if (!ts) return '—';
  const d = new Date(ts); const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function pick(id: string) {
  busy.value = true; err.value = '';
  try { await ws.select(id); location.reload(); }
  catch (e: any) { err.value = String(e?.message || e); busy.value = false; }
}
async function createNew() {
  busy.value = true; err.value = '';
  try { await ws.create(name.value); location.reload(); }
  catch (e: any) { err.value = String(e?.message || e); busy.value = false; }
}
</script>

<template>
  <div class="wsoverlay">
    <div class="wsbox">
      <h3>{{ $t('ws.pick.title') }}</h3>
      <p class="wsdesc">{{ $t('ws.pick.desc') }}</p>
      <div class="wslist">
        <button v-for="p in props.state.profiles" :key="p.id" class="wsitem" :disabled="busy" @click="pick(p.id)">
          <span class="wsname">{{ p.name }}</span>
          <span class="wsmeta">:{{ p.port }} · {{ $t('ws.pick.projects', { count: p.projectCount ?? 0 }) }} · {{ $t('ws.pick.last_used') }} {{ fmt(p.lastUsedAt) }}</span>
          <span class="wsgo">{{ $t('ws.pick.use') }}</span>
        </button>
      </div>
      <div class="wsnew">
        <input v-model="name" :placeholder="$t('ws.pick.new_name')" :disabled="busy" />
        <button :disabled="busy" @click="createNew">{{ $t('ws.pick.create') }}</button>
      </div>
      <div v-if="err" class="wserr">{{ $t('ws.pick.failed', { msg: err }) }}</div>
    </div>
  </div>
</template>

<style scoped>
.wsoverlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 9999; }
.wsbox { width: 520px; max-width: 92vw; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 10px; padding: 18px 20px; box-shadow: 0 18px 50px rgba(0,0,0,.45); }
.wsbox h3 { margin: 0 0 8px; font-size: 16px; }
.wsdesc { color: var(--tx3); font-size: 12px; margin: 0 0 12px; line-height: 1.6; }
.wslist { display: flex; flex-direction: column; gap: 8px; max-height: 46vh; overflow: auto; }
.wsitem { display: flex; align-items: center; gap: 10px; text-align: left; background: var(--bg3); border: 1px solid var(--bd); color: var(--tx1); border-radius: 8px; padding: 10px 12px; cursor: pointer; }
.wsitem:hover:not(:disabled) { border-color: var(--ac2); }
.wsname { font-weight: 700; }
.wsmeta { color: var(--tx3); font-size: 11px; flex: 1; }
.wsgo { color: var(--ac2); font-size: 12px; }
.wsnew { display: flex; gap: 8px; margin-top: 12px; }
.wsnew input { flex: 1; background: var(--bg3); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 8px; font-size: 12px; }
.wsnew button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; }
.wserr { color: var(--errtx); font-size: 12px; margin-top: 10px; }
</style>
```

- [ ] **Step 3: `App.vue` 启动门禁**

在 `<script setup>` 加：

```ts
import { useWorkspace, type WorkspaceState } from './useWorkspace';
import WorkspacePicker from './components/WorkspacePicker.vue';
const ws = useWorkspace();
const wsState = ref<WorkspaceState | null>(null);
```

将 `onMounted` 改为 async 且在最前面插入：

```ts
onMounted(async () => {
  try {
    const st = await ws.state();
    if (st && st.needSelect) { wsState.value = st; return; }   // 只显示弹窗，不连接
  } catch { /* 落回原有流程 */ }
  // ……以下为原有初始化（initFileHistory/loadProjects/msgHistory.load/terminal.connect 等）
});
```

在模板根节点末尾加：

```vue
    <WorkspacePicker v-if="wsState" :state="wsState" />
```

- [ ] **Step 4: 类型检查与测试**

Run: `npm --prefix D:/root/devflow/devflow run typecheck 2>&1 | findstr /C:"error"`
Expected: 无输出（通过）
Run: `npm --prefix D:/root/devflow/devflow run test:web 2>&1 | findstr /C:"Tests"`
Expected: `Tests  64 passed`

- [ ] **Step 5: 提交**

```bash
git add web/src/useWorkspace.ts web/src/components/WorkspacePicker.vue web/src/App.vue
git commit -m "feat(web): 端口档案选择弹窗与启动门禁"
```

---

### Task 8: 文档与整体验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 文档补充**

在 `README.md` 的"数据存储/配置"章节加入：

```markdown
### 端口数据档案（Port Profiles）

服务按监听端口隔离数据，每个档案是一套完全独立的目录：

- 数据档案根：`%USERPROFILE%\.local\share\devflow\ports\<profileId>\`
  （含 `projects.json`、`workflows.json`、`scheduler/`、`collab/identity.json`、`message-history.jsonc` 等）
- 选择记忆：`%USERPROFILE%\.local\share\devflow\ports-state.json` 的 `byListenPort`。
- 首次启动会自动把旧数据迁移为档案 `22222`（复制，不删除）。
- 启动时若发现多份档案，界面会弹窗选择；单份自动使用；零份自动新建。
- `DEVFLOW_NODE` 环境变量仍可用作多实例模拟，此时不进入端口档案系统。
```

- [ ] **Step 2: 全量验证**

Run: `npm --prefix D:/root/devflow/devflow run typecheck`
Expected: 通过
Run: `npm --prefix D:/root/devflow/devflow run check:i18n`
Expected: `check-i18n: 未发现中文命中`
Run: `npm --prefix D:/root/devflow/devflow run test`
Expected: server 全绿 + web 全绿

- [ ] **Step 3: 手动走查（写进验证记录）**

1. 单档案：默认启动 → 自动使用，无弹窗。
2. 多档案：造两份 → 启动 → 弹窗 → 选择 → 页面加载所选数据。
3. 记忆：同端口重启 → 自动沿用，无弹窗。
4. 端口回退：22222 占用时起第二实例 → 监听 33333 → 可独立选择/复用档案。
5. 迁移：备份真实数据目录，确认旧数据出现在 `ports/22222/`。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: 端口数据档案说明"
```

---

## 完成标准

- `npm test` 与 `npm run typecheck`、`npm run check:i18n` 全绿。
- 多端口实例数据互相隔离；启动多份档案时可弹窗选择且按端口记忆。
- 旧数据迁移到 `ports/22222/`，原始文件保留。
- `DEVFLOW_NODE` 多实例模拟行为不回归。
