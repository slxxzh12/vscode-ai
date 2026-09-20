# 记事本（Notepad）小工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「小工具」里的「排序」升级为「记事本」：左侧通用目录树（对齐 Postman）+ 右侧纯文本编辑器，文件存 `<端口数据目录>/tools/notepad/`。

**Architecture:** 后端新增独立 `server/notepad-store.js`（纯文本文件树，防路径穿越）+ 在 `http-api.js` 注入 `notepadStore` 挂 `/api/notepad/*`（与 Postman 一致的接线方式）。前端把 `PostmanTree.vue` 抽成通用 `web/src/components/FileTree.vue`（Postman 改为薄封装），记事本用 `useNotepadFiles.ts` + `NotepadTool.vue`。

**Tech Stack:** Node ESM（`node --test`）、Vue3 + Vite + TS（vitest / vue-tsc）、`@devflow/shared` i18n。

参考 spec：`docs/superpowers/specs/2026-09-20-notepad-tool-design.md`

**执行方式：** AGENTS.md 规定用 inline（本会话内执行），不用 subagent。

---

## File Structure

- `server/notepad-store.js`（新）— 纯文本文件树存储。
- `server/http-api.js`（改）— `createHttpApi` 加 `notepadStore`，挂 `/api/notepad/*`。
- `server/port-paths.js`（改）— 加 `notepadDir` + `ensurePortDirs`。
- `server/index.js`（改）— 创建 store 并注入 httpApi。
- `web/src/fileTree.ts`（新）— 通用树类型 `FileItem` / `FileTreeActions` / `FileTreeActionResult`。
- `web/src/components/FileTree.vue`（新）— 通用树组件。
- `web/src/tools/postman/PostmanTree.vue`（改）— 改为 FileTree 薄封装（行为不变）。
- `web/src/tools/notepad/useNotepadFiles.ts`（新）+ `NotepadTool.vue`（新）。
- `web/src/components/MiniTools.vue`（改）— `sort` → `notepad`，渲染 `NotepadTool`。
- `shared/i18n/zh-CN.js` / `en.js`（改）— 新增 `tree.*` / `np.*` / `tools.notepad`。

---

## Task 1: 端口路径新增 notepadDir

**Files:**
- Modify: `server/port-paths.js:40-45`
- Test: `server/test/port-paths.test.js`

- [ ] **Step 1: 写测试**

在 `port-paths.test.js` 的 `portPaths` 测试里 `postmanDir` 断言后追加：

```js
  assert.equal(p.notepadDir, path.join(base, 'tools', 'notepad'));
```

在 `ensurePortDirs` 测试的目录数组里加入 `p.notepadDir`：

```js
  for (const d of [p.dir, p.schedulerDir, p.collabDir, p.uploadDir, p.downloadDir, p.downloadsDir, p.skillsRoot, p.sessionLogsDir, p.postmanDir, p.notepadDir]) {
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/port-paths.test.js"`
Expected: FAIL（`p.notepadDir` undefined；目录不存在）。

- [ ] **Step 3: 实现**

`server/port-paths.js` 的 `return { ... }` 中，`postmanDir` 后加：

```js
    postmanDir: path.join(dir, 'tools', 'postman'),
    notepadDir: path.join(dir, 'tools', 'notepad'),
```

`ensurePortDirs` 的数组加入 `paths.notepadDir`：

```js
  for (const d of [paths.dir, paths.schedulerDir, paths.collabDir, paths.uploadDir, paths.downloadDir, paths.downloadsDir, paths.skillsRoot, paths.sessionLogsDir, paths.postmanDir, paths.notepadDir]) {
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/port-paths.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/port-paths.js server/test/port-paths.test.js
git commit -m "feat(notepad): 端口路径新增 tools/notepad 目录"
```

---

## Task 2: 记事本存储 `server/notepad-store.js`

**Files:**
- Create: `server/notepad-store.js`
- Test: `server/test/notepad-store.test.js`

- [ ] **Step 1: 写测试**

创建 `server/test/notepad-store.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNotepadStore, MAX_FILE_BYTES } from '../notepad-store.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-notepad-')); }
function make() { return createNotepadStore({ dir: tmpDir() }); }

test('write/read/createFile/list', () => {
  const s = make();
  const { id } = s.createFile('', 'a.txt');
  assert.equal(id, 'a.txt');
  s.write('a.txt', 'hello\nworld');
  assert.equal(s.read('a.txt').content, 'hello\nworld');
  const { items } = s.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'a.txt');
  assert.ok(s.list().folders.length === 0);
});

test('createFile 已存在抛 exists；read 不存在抛 not-found', () => {
  const s = make();
  s.createFile('', 'a.txt');
  assert.throws(() => s.createFile('', 'a.txt'), (e) => e.code === 'exists');
  assert.throws(() => s.read('nope.txt'), (e) => e.code === 'not-found');
});

test('文件夹：createFolder/listFolders/renameFolder/removeFolder', () => {
  const s = make();
  s.createFolder('x/y');
  assert.deepEqual(s.listFolders().sort(), ['x', 'x/y']);
  assert.equal(s.renameFolder('x/y', 'z'), 'x/z');
  assert.ok(s.listFolders().includes('x/z'));
  assert.equal(s.removeFolder('x'), true);
  assert.deepEqual(s.listFolders(), []);
});

test('renameItem/moveItem/removeItem', () => {
  const s = make();
  s.createFolder('d');
  s.createFile('', 'a.txt');
  s.write('a.txt', '1');
  assert.equal(s.renameItem('a.txt', 'b.txt'), 'b.txt');
  assert.equal(s.moveItem('b.txt', 'd'), true);
  assert.equal(s.read('d/b.txt').content, '1');
  assert.equal(s.removeItem('d/b.txt'), true);
  assert.deepEqual(s.list().items, []);
});

test('路径穿越与非法规段被拒', () => {
  const s = make();
  for (const bad of ['../x.txt', 'a/../../x.txt', '/abs.txt', 'C:/x.txt', 'a b.txt', 'a//b.txt']) {
    assert.throws(() => s.write(bad, 'x'), (e) => e.code === 'bad-path' || e.code === 'bad-id', bad);
  }
});

test('超过大小上限抛 too-large', () => {
  const s = make();
  s.createFile('', 'big.txt');
  assert.throws(() => s.write('big.txt', 'x'.repeat(MAX_FILE_BYTES + 1)), (e) => e.code === 'too-large');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/notepad-store.test.js"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

创建 `server/notepad-store.js`：

```js
import fs from 'node:fs';
import path from 'node:path';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const SEG = /^[A-Za-z0-9_.-]+$/;

function normalizeRel(rel) {
  const raw = String(rel ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  const parts = raw.split('/');
  for (const p of parts) {
    if (!p || p === '.' || p === '..' || !SEG.test(p)) { const e = new Error('bad path'); e.code = 'bad-path'; throw e; }
  }
  return parts.join('/');
}

function assertFileName(name) {
  const n = String(name ?? '').trim();
  if (!SEG.test(n) || n === '.' || n === '..') { const e = new Error('bad name'); e.code = 'bad-path'; throw e; }
  return n;
}

export function createNotepadStore({ dir }) {
  const dirOf = (rel) => path.join(dir, ...(rel ? rel.split('/') : []));
  const last = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

  const listFolders = () => {
    const out = [];
    const walk = (abs, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory() || !SEG.test(e.name)) continue;
        const child = rel ? `${rel}/${e.name}` : e.name;
        out.push(child);
        walk(path.join(abs, e.name), child);
      }
    };
    walk(dir, '');
    return out;
  };

  const list = () => {
    const items = [];
    const walk = (abs, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SEG.test(e.name)) walk(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
          continue;
        }
        if (!SEG.test(e.name)) continue;
        const id = rel ? `${rel}/${e.name}` : e.name;
        let updatedAt = '';
        try { updatedAt = new Date(fs.statSync(path.join(abs, e.name)).mtimeMs).toISOString(); } catch { /* ignore */ }
        items.push({ id, folder: rel, name: e.name, updatedAt });
      }
    };
    walk(dir, '');
    return { items, folders: listFolders() };
  };

  const read = (id) => {
    const rel = normalizeRel(id);
    if (!rel) { const e = new Error('bad id'); e.code = 'bad-id'; throw e; }
    const abs = dirOf(rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { const e = new Error('missing'); e.code = 'not-found'; throw e; }
    if (!stat.isFile()) { const e = new Error('not a file'); e.code = 'not-found'; throw e; }
    if (stat.size > MAX_FILE_BYTES) { const e = new Error('too large'); e.code = 'too-large'; throw e; }
    return { content: fs.readFileSync(abs, 'utf8'), size: stat.size };
  };

  const write = (id, content) => {
    const rel = normalizeRel(id);
    if (!rel) { const e = new Error('bad id'); e.code = 'bad-id'; throw e; }
    assertFileName(last(rel));
    const text = String(content ?? '');
    const size = Buffer.byteLength(text, 'utf8');
    if (size > MAX_FILE_BYTES) { const e = new Error('too large'); e.code = 'too-large'; throw e; }
    const abs = dirOf(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
    return { size };
  };

  const createFile = (folder, name) => {
    const rel = normalizeRel(folder);
    const file = assertFileName(name);
    const id = rel ? `${rel}/${file}` : file;
    const abs = dirOf(id);
    if (fs.existsSync(abs)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '', 'utf8');
    return { id };
  };

  const createFolder = (rel) => {
    const r = normalizeRel(rel);
    if (!r) { const e = new Error('empty path'); e.code = 'empty'; throw e; }
    fs.mkdirSync(dirOf(r), { recursive: true });
    return r;
  };

  const removeFolder = (rel) => {
    const r = normalizeRel(rel);
    if (!r) return false;
    const abs = dirOf(r);
    if (!fs.existsSync(abs)) return false;
    try { fs.rmSync(abs, { recursive: true, force: true }); return true; } catch { return false; }
  };

  const renameFolder = (rel, name) => {
    const r = normalizeRel(rel);
    if (!r) { const e = new Error('empty path'); e.code = 'empty'; throw e; }
    const abs = dirOf(r);
    if (!fs.existsSync(abs)) { const e = new Error('missing'); e.code = 'not-found'; throw e; }
    const seg = assertFileName(name);
    const parent = r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '';
    const next = parent ? `${parent}/${seg}` : seg;
    if (next === r) return r;
    const to = dirOf(next);
    if (fs.existsSync(to)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
    fs.renameSync(abs, to);
    return next;
  };

  const renameItem = (id, name) => {
    const rel = normalizeRel(id);
    if (!rel) { const e = new Error('bad id'); e.code = 'bad-id'; throw e; }
    const abs = dirOf(rel);
    if (!fs.existsSync(abs)) { const e = new Error('missing'); e.code = 'not-found'; throw e; }
    const file = assertFileName(name);
    const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const next = parent ? `${parent}/${file}` : file;
    if (next === rel) return rel;
    const to = dirOf(next);
    if (fs.existsSync(to)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
    fs.renameSync(abs, to);
    return next;
  };

  const removeItem = (id) => {
    let rel;
    try { rel = normalizeRel(id); } catch { return false; }
    if (!rel) return false;
    try { fs.unlinkSync(dirOf(rel)); return true; } catch { return false; }
  };

  const moveItem = (id, folder) => {
    let rel;
    try { rel = normalizeRel(id); } catch { return false; }
    if (!rel) return false;
    const from = dirOf(rel);
    if (!fs.existsSync(from)) return false;
    const target = normalizeRel(folder);
    const to = path.join(dirOf(target), last(rel));
    if (from === to) return true;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(from, to); return true; } catch { return false; }
  };

  return { dir, list, listFolders, read, write, createFile, createFolder, removeFolder, renameFolder, renameItem, removeItem, moveItem };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/notepad-store.test.js"`
Expected: PASS（全部）。

- [ ] **Step 5: 提交**

```bash
git add server/notepad-store.js server/test/notepad-store.test.js
git commit -m "feat(notepad): 新增纯文本文件树存储 notepad-store"
```

---

## Task 3: HTTP 端点 `/api/notepad/*`

**Files:**
- Modify: `server/http-api.js:46`（签名）与 `:263` 后（路由）
- Modify: `server/index.js:395`（注入）
- Test: `server/test/notepad-http.test.js`

- [ ] **Step 1: 写测试**

创建 `server/test/notepad-http.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHttpApi } from '../http-api.js';
import { createNotepadStore } from '../notepad-store.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-np-http-')); }

async function start() {
  const notepadStore = createNotepadStore({ dir: tmpDir() });
  const projects = { listProjects: () => [], resolveAbsolute: () => ({ project: 'p', rel: 'r' }) };
  const api = createHttpApi({ projects, notepadStore });
  const server = http.createServer(api);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  return { store: notepadStore, port: server.address().port, server };
}
function call(port, method, p, body) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

test('notepad：新建文件/写/读/树/重命名/移动/删除', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const create = await call(A.port, 'POST', '/api/notepad/file', { folder: '', name: 'a.txt' });
  assert.equal(create.status, 200);
  assert.equal(create.body.id, 'a.txt');

  const put = await call(A.port, 'PUT', '/api/notepad/file', { id: 'a.txt', content: 'hi' });
  assert.equal(put.status, 200);
  const get = await call(A.port, 'GET', '/api/notepad/file?id=a.txt');
  assert.equal(get.body.content, 'hi');

  const tree = await call(A.port, 'GET', '/api/notepad/tree');
  assert.equal(tree.body.items[0].id, 'a.txt');

  const mk = await call(A.port, 'POST', '/api/notepad/folder', { path: 'd' });
  assert.equal(mk.status, 200);
  const mv = await call(A.port, 'POST', '/api/notepad/move', { id: 'a.txt', folder: 'd' });
  assert.equal(mv.status, 200);
  const ren = await call(A.port, 'PATCH', '/api/notepad/file', { id: 'd/a.txt', name: 'b.txt' });
  assert.equal(ren.body.id, 'd/b.txt');
  const del = await call(A.port, 'DELETE', '/api/notepad/file?id=d/b.txt');
  assert.equal(del.status, 200);
});

test('notepad：已存在 → 409，非法路径 → 400，不存在 → 404', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  await call(A.port, 'POST', '/api/notepad/file', { folder: '', name: 'x.txt' });
  const dup = await call(A.port, 'POST', '/api/notepad/file', { folder: '', name: 'x.txt' });
  assert.equal(dup.status, 409);
  const bad = await call(A.port, 'PUT', '/api/notepad/file', { id: '../x.txt', content: 'z' });
  assert.equal(bad.status, 400);
  const missing = await call(A.port, 'GET', '/api/notepad/file?id=nope.txt');
  assert.equal(missing.status, 404);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/notepad-http.test.js"`
Expected: FAIL（404/未实现）。

- [ ] **Step 3: 实现 http-api 路由**

`server/http-api.js` 的 `createHttpApi` 参数列表末尾加 `notepadStore = null`：

```js
  ..., runCurlFn = runCurl, postmanHistory = null, notepadStore = null }) {
```

在 `/api/postman/move` 路由块（约 `:263-268`）之后插入：

```js
      if (url.pathname.startsWith('/api/notepad/')) {
        const statusOf = (code) => (code === 'exists' ? 409 : code === 'not-found' ? 404 : code === 'too-large' ? 413 : code === 'bad-path' || code === 'bad-id' || code === 'empty' ? 400 : 500);
        const fail = (e) => sendJson(res, statusOf(e?.code), { error: e?.code || 'failed' });
        try {
          if (url.pathname === '/api/notepad/tree' && req.method === 'GET') {
            sendJson(res, 200, notepadStore?.list?.() ?? { items: [], folders: [] });
            return;
          }
          if (url.pathname === '/api/notepad/file' && req.method === 'GET') {
            sendJson(res, 200, notepadStore.read(url.searchParams.get('id') || ''));
            return;
          }
          if (url.pathname === '/api/notepad/file' && req.method === 'PUT') {
            const body = await readJsonBody(req);
            sendJson(res, 200, { ok: true, ...notepadStore.write(String(body.id ?? ''), body.content) });
            return;
          }
          if (url.pathname === '/api/notepad/file' && req.method === 'POST') {
            const body = await readJsonBody(req);
            sendJson(res, 200, { ok: true, ...notepadStore.createFile(String(body.folder ?? ''), String(body.name ?? '')) });
            return;
          }
          if (url.pathname === '/api/notepad/file' && req.method === 'PATCH') {
            const body = await readJsonBody(req);
            sendJson(res, 200, { ok: true, id: notepadStore.renameItem(String(body.id ?? ''), String(body.name ?? '')) });
            return;
          }
          if (url.pathname === '/api/notepad/file' && req.method === 'DELETE') {
            const ok = notepadStore.removeItem(url.searchParams.get('id') || '');
            sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not-found' });
            return;
          }
          if (url.pathname === '/api/notepad/folder' && req.method === 'POST') {
            const body = await readJsonBody(req);
            sendJson(res, 200, { ok: true, path: notepadStore.createFolder(String(body.path ?? '')) });
            return;
          }
          if (url.pathname === '/api/notepad/folder' && req.method === 'PATCH') {
            const body = await readJsonBody(req);
            sendJson(res, 200, { ok: true, path: notepadStore.renameFolder(String(body.path ?? ''), String(body.name ?? '')) });
            return;
          }
          if (url.pathname === '/api/notepad/folder' && req.method === 'DELETE') {
            const ok = notepadStore.removeFolder(url.searchParams.get('path') || '');
            sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not-found' });
            return;
          }
          if (url.pathname === '/api/notepad/move' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const ok = notepadStore.moveItem(String(body.id ?? ''), String(body.folder ?? ''));
            sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not-found' });
            return;
          }
          sendJson(res, 404, { error: 'not-found' });
          return;
        } catch (e) { fail(e); return; }
      }
```

- [ ] **Step 4: 注入 store（`server/index.js`）**

在 `createHttpApi({ ... })` 调用（约 `:395`）里，`postmanHistory` 后加 `notepadStore`，并在调用前创建：

```js
  const notepadStore = createNotepadStore({ dir: paths.notepadDir });
```

```js
  const httpApi = createHttpApi({ projects, saveProjects, logger: log, repoRoot: path.join(__dirname, '..'), codeGroups, codePrefs, composerPrefs, sessionProjects, windowState, sessionLedger, postmanHistory, notepadStore });
```

并在文件顶部 import：`import { createNotepadStore } from './notepad-store.js';`

- [ ] **Step 5: 运行确认通过**

Run: `node --test "server/test/notepad-http.test.js"`
Expected: PASS。

- [ ] **Step 6: 回归**

Run: `node --test "server/test/http-api.test.js"`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add server/http-api.js server/index.js server/test/notepad-http.test.js
git commit -m "feat(notepad): /api/notepad/* 路由与装配"
```

---

## Task 4: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 新增中文词条**

在 `zh-CN.js` 的 `tools.sort` 附近加：

```js
  'tools.notepad': '记事本',
```

在 `tools.pm_*` 区块附近加通用树键（`tree.*`）：

```js
  'tree.root': '根目录',
  'tree.new_folder': '新建文件夹',
  'tree.new_subfolder': '新建子文件夹',
  'tree.rename': '重命名',
  'tree.delete': '删除',
  'tree.cancel': '取消',
  'tree.empty': '还没有内容',
  'tree.rename_ph': '输入名称',
  'tree.exists': '同名已存在',
  'tree.rename_failed': '重命名失败',
  'tree.run_folder': '运行文件夹',
  'tree.run_item': '运行',
```

新增 `np.*`：

```js
  'np.save': '保存',
  'np.saved': '已保存',
  'np.unsaved': '未保存',
  'np.new_file': '新建文件',
  'np.file_name': '文件名',
  'np.file_ph': '未命名.txt',
  'np.no_file': '未选择文件',
  'np.save_failed': '保存失败：{msg}',
  'np.open_failed': '打开失败：{msg}',
  'np.exists': '同名文件已存在',
  'np.deleted': '已删除',
  'np.dedup': '去重',
```

- [ ] **Step 2: 新增英文词条（同位置）**

`en.js`：

```js
  'tools.notepad': 'Notepad',
  'tree.root': 'Root',
  'tree.new_folder': 'New folder',
  'tree.new_subfolder': 'New subfolder',
  'tree.rename': 'Rename',
  'tree.delete': 'Delete',
  'tree.cancel': 'Cancel',
  'tree.empty': 'Nothing here yet',
  'tree.rename_ph': 'Enter a name',
  'tree.exists': 'Name already exists',
  'tree.rename_failed': 'Rename failed',
  'tree.run_folder': 'Run folder',
  'tree.run_item': 'Run',
  'np.save': 'Save',
  'np.saved': 'Saved',
  'np.unsaved': 'Unsaved',
  'np.new_file': 'New file',
  'np.file_name': 'File name',
  'np.file_ph': 'untitled.txt',
  'np.no_file': 'No file selected',
  'np.save_failed': 'Save failed: {msg}',
  'np.open_failed': 'Open failed: {msg}',
  'np.exists': 'File already exists',
  'np.deleted': 'Deleted',
  'np.dedup': 'Deduplicate',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: PASS（中英键集合对称）。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(tools): 记事本与通用目录树词条"
```

---

## Task 5: 通用树类型 `web/src/fileTree.ts`

**Files:**
- Create: `web/src/fileTree.ts`

- [ ] **Step 1: 写类型**

创建 `web/src/fileTree.ts`：

```ts
export type FileTreeActionResult = { ok: boolean; error?: string; path?: string };

export type FileItem = {
  id: string;
  folder: string;
  name: string;
  label?: string;
  updatedAt?: string;
};

export type FileTreeActions = {
  createFolder: (parent: string, name: string) => Promise<FileTreeActionResult>;
  renameFolder: (path: string, name: string) => Promise<FileTreeActionResult>;
  removeFolder: (path: string) => Promise<FileTreeActionResult>;
  renameItem: (id: string, name: string) => Promise<FileTreeActionResult>;
  removeItem: (id: string) => Promise<FileTreeActionResult>;
  moveItem: (id: string, folder: string) => Promise<FileTreeActionResult>;
};
```

- [ ] **Step 2: 提交**

```bash
git add web/src/fileTree.ts
git commit -m "feat(web): 通用文件树类型 fileTree.ts"
```

---

## Task 6: 通用树组件 `web/src/components/FileTree.vue`

**Files:**
- Create: `web/src/components/FileTree.vue`
- Test: `web/src/components/FileTree.test.ts`（迁移 `PostmanTree.test.ts` 用例）

- [ ] **Step 1: 写组件**

创建 `web/src/components/FileTree.vue`（由 `PostmanTree.vue` 泛化：`records → items`、`record → item`、类前缀 `pm → ft`、i18n `tools.pm_* → tree.*`、加 `storageKey`/`showRun`）：

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../i18n';
import type { FileTreeActionResult, FileItem, FileTreeActions } from '../fileTree';

const props = defineProps<{
  folders: string[];
  items: FileItem[];
  activeFolder: string;
  activeId: string;
  actions: FileTreeActions;
  storageKey: string;
  statuses?: Record<string, 'pass' | 'fail'>;
  showRun?: boolean;
}>();
const emit = defineEmits<{
  (e: 'select-folder', path: string): void;
  (e: 'select-item', item: FileItem): void;
  (e: 'run-folder', path: string): void;
  (e: 'run-item', item: FileItem): void;
}>();

type EditingMeta =
  | { kind: 'new'; parent: string }
  | { kind: 'folder'; path: string }
  | { kind: 'item'; id: string };

type Row =
  | { kind: 'folder'; key: string; path: string; name: string; depth: number; expanded: boolean }
  | { kind: 'item'; key: string; item: FileItem; depth: number }
  | { kind: 'editor'; key: string; depth: number };

type Menu =
  | { kind: 'folder'; path: string; x: number; y: number }
  | { kind: 'item'; item: FileItem; x: number; y: number };

const collapsed = ref<Set<string>>(readCollapsed());
const editing = ref<EditingMeta | null>(null);
const draft = ref('');
const editError = ref('');
const menu = ref<Menu | null>(null);
const dragId = ref('');

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(props.storageKey);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}
function persistCollapsed() {
  try { localStorage.setItem(props.storageKey, JSON.stringify([...collapsed.value])); } catch { /* ignore */ }
}
function toggle(path: string) {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path); else next.add(path);
  collapsed.value = next;
  persistCollapsed();
}
watch(() => props.storageKey, () => { collapsed.value = readCollapsed(); });
watch(() => props.folders, (list) => {
  const valid = new Set(list);
  let changed = false;
  const next = new Set<string>();
  for (const p of collapsed.value) { if (valid.has(p)) next.add(p); else changed = true; }
  if (changed) { collapsed.value = next; persistCollapsed(); }
});

const rows = computed<Row[]>(() => {
  const byFolder = new Map<string, FileItem[]>();
  for (const r of props.items) {
    const f = r.folder || '';
    const arr = byFolder.get(f);
    if (arr) arr.push(r); else byFolder.set(f, [r]);
  }
  const children = new Map<string, string[]>();
  for (const f of props.folders) {
    const parent = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    const arr = children.get(parent);
    if (arr) arr.push(f); else children.set(parent, [f]);
  }
  for (const arr of children.values()) arr.sort();
  const out: Row[] = [];
  const ed = editing.value;
  const walk = (parent: string, depth: number) => {
    if (ed && ed.kind === 'new' && ed.parent === parent) out.push({ kind: 'editor', key: 'editor', depth });
    for (const f of children.get(parent) || []) {
      const expanded = !collapsed.value.has(f) || (!!ed && ed.kind === 'new' && ed.parent === f);
      out.push({ kind: 'folder', key: `d:${f}`, path: f, name: f.slice(f.lastIndexOf('/') + 1), depth, expanded });
      if (expanded) walk(f, depth + 1);
    }
    for (const r of byFolder.get(parent) || []) out.push({ kind: 'item', key: `i:${r.id}`, item: r, depth });
  };
  walk('', 0);
  return out;
});

function isFolderEditing(path: string) { const ed = editing.value; return !!ed && ed.kind === 'folder' && ed.path === path; }
function isItemEditing(id: string) { const ed = editing.value; return !!ed && ed.kind === 'item' && ed.id === id; }
function itemLabel(item: FileItem) { return (item.label && item.label.trim()) || item.name; }
function itemStatus(id: string) { return props.statuses?.[id] || ''; }
function fmtTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function selectFolder(path: string) { emit('select-folder', path); }
function selectItem(item: FileItem) { emit('select-item', item); }
function runFolder(path: string) { menu.value = null; emit('run-folder', path); }
function runItem(item: FileItem) { menu.value = null; emit('run-item', item); }

function startNew(parent: string) { menu.value = null; editing.value = { kind: 'new', parent }; draft.value = ''; editError.value = ''; }
function startRenameFolder(path: string) { menu.value = null; editing.value = { kind: 'folder', path }; draft.value = path.slice(path.lastIndexOf('/') + 1); editError.value = ''; }
function startRenameItem(item: FileItem) { menu.value = null; editing.value = { kind: 'item', id: item.id }; draft.value = item.label || item.name; editError.value = ''; }
function cancelEdit() { editing.value = null; draft.value = ''; editError.value = ''; }

async function commitEdit() {
  const ed = editing.value;
  if (!ed) return;
  const name = draft.value.trim();
  let res: FileTreeActionResult;
  if (ed.kind === 'new') {
    if (!name) { cancelEdit(); return; }
    res = await props.actions.createFolder(ed.parent, name);
  } else if (ed.kind === 'folder') {
    if (!name) { cancelEdit(); return; }
    res = await props.actions.renameFolder(ed.path, name);
  } else {
    res = await props.actions.renameItem(ed.id, name);
  }
  if (res.ok) cancelEdit();
  else editError.value = res.error === 'exists' ? t('tree.exists') : t('tree.rename_failed');
}

async function removeFolder(path: string) { menu.value = null; await props.actions.removeFolder(path); }
async function removeItem(id: string) { menu.value = null; await props.actions.removeItem(id); }

function openMenuFolder(e: MouseEvent, path: string) { menu.value = { kind: 'folder', path, x: e.clientX, y: e.clientY }; }
function openMenuItem(e: MouseEvent, item: FileItem) { menu.value = { kind: 'item', item, x: e.clientX, y: e.clientY }; }
function onContextMenu(e: MouseEvent, row: Row) {
  if (row.kind === 'folder') openMenuFolder(e, row.path);
  else if (row.kind === 'item') openMenuItem(e, row.item);
}
function closeMenu() { menu.value = null; }
function menuNew() { const m = menu.value; if (m && m.kind === 'folder') startNew(m.path); }
function menuRename() {
  const m = menu.value;
  if (!m) return;
  if (m.kind === 'folder' && m.path) startRenameFolder(m.path);
  else if (m.kind === 'item') startRenameItem(m.item);
}
function menuDelete() {
  const m = menu.value;
  if (!m) return;
  if (m.kind === 'folder' && m.path) void removeFolder(m.path);
  else if (m.kind === 'item') void removeItem(m.item.id);
}

function onDragStart(row: Row) { if (row.kind === 'item') dragId.value = row.item.id; }
function onDrop(folder: string) {
  const id = dragId.value;
  dragId.value = '';
  if (!id) return;
  const item = props.items.find((r) => r.id === id);
  if (!item || (item.folder || '') === folder) return;
  void props.actions.moveItem(id, folder);
}
function onDropRow(row: Row) {
  if (row.kind === 'folder') onDrop(row.path);
  else if (row.kind === 'item') onDrop(row.item.folder || '');
}

function onDocClick(e: MouseEvent) {
  closeMenu();
  if (!editing.value) return;
  const target = e.target as HTMLElement | null;
  if (target && target.closest('.ftedit')) return;
  if (editError.value) { cancelEdit(); return; }
  void commitEdit();
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeMenu(); if (editing.value) cancelEdit(); }
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="fttree">
    <div class="ftroot" :class="{ on: activeFolder === '' }"
         @click="selectFolder('')" @contextmenu.prevent="openMenuFolder($event, '')"
         @dragover.prevent @drop.prevent="onDrop('')">
      <span class="ftchev invisible">▸</span>
      <span class="fticon">🏠</span>
      <span class="ftname">{{ $t('tree.root') }}</span>
      <span class="ftacts">
        <button v-if="showRun" class="ftact ftexec" :title="$t('tree.run_folder')" @click.stop="runFolder('')">▶</button>
        <button class="ftact ftnew" :title="$t('tree.new_folder')" @click.stop="startNew('')">＋</button>
      </span>
    </div>

    <div v-if="!rows.length" class="ftempty">{{ $t('tree.empty') }}</div>
    <ul v-else class="ftlist" @dragover.prevent @drop.prevent="onDrop('')">
      <li v-for="row in rows" :key="row.key" class="ftrow"
          :class="[row.kind, { on: row.kind === 'folder' ? activeFolder === row.path : (row.kind === 'item' && activeId === row.item.id) }]"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          :draggable="row.kind === 'item' ? 'true' : 'false'"
          @dragstart="onDragStart(row)"
          @contextmenu.prevent="onContextMenu($event, row)"
          @drop.stop.prevent="onDropRow(row)">
        <template v-if="row.kind === 'editor'">
          <span class="ftchev invisible">▸</span>
          <span class="fticon">📁</span>
          <input class="ftedit" v-model="draft" :placeholder="$t('tree.rename_ph')"
                 @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
          <button class="ftact" :title="$t('tree.cancel')" @click.stop="cancelEdit">×</button>
          <span v-if="editError" class="fterr">{{ editError }}</span>
        </template>

        <template v-else-if="row.kind === 'folder'">
          <span class="ftchev" :class="{ collapsed: !row.expanded }" @click.stop="toggle(row.path)">▸</span>
          <span class="fticon">📁</span>
          <template v-if="isFolderEditing(row.path)">
            <input class="ftedit" v-model="draft"
                   @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
            <button class="ftact" :title="$t('tree.cancel')" @click.stop="cancelEdit">×</button>
          </template>
          <template v-else>
            <span class="ftname" @click="selectFolder(row.path)" @dblclick="toggle(row.path)">{{ row.name }}</span>
            <span class="ftacts">
              <button v-if="showRun" class="ftact ftexec" :title="$t('tree.run_folder')" @click.stop="runFolder(row.path)">▶</button>
              <button class="ftact ftnew" :title="$t('tree.new_subfolder')" @click.stop="startNew(row.path)">＋</button>
              <button class="ftact ftrename" :title="$t('tree.rename')" @click.stop="startRenameFolder(row.path)">✎</button>
              <button class="ftact ftdel" :title="$t('tree.delete')" @click.stop="removeFolder(row.path)">×</button>
            </span>
          </template>
          <span v-if="isFolderEditing(row.path) && editError" class="fterr">{{ editError }}</span>
        </template>

        <template v-else>
          <span class="ftstatus" :class="itemStatus(row.item.id)" />
          <span class="ftchev invisible">▸</span>
          <span class="fticon">📄</span>
          <template v-if="isItemEditing(row.item.id)">
            <input class="ftedit" v-model="draft"
                   @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
            <button class="ftact" :title="$t('tree.cancel')" @click.stop="cancelEdit">×</button>
          </template>
          <template v-else>
            <span class="ftname" @click="selectItem(row.item)">{{ itemLabel(row.item) }}</span>
            <span class="fttime">{{ fmtTime(row.item.updatedAt) }}</span>
            <span class="ftacts">
              <button v-if="showRun" class="ftact ftexec" :title="$t('tree.run_item')" @click.stop="runItem(row.item)">▶</button>
              <button class="ftact ftrename" :title="$t('tree.rename')" @click.stop="startRenameItem(row.item)">✎</button>
              <button class="ftact ftdel" :title="$t('tree.delete')" @click.stop="removeItem(row.item.id)">×</button>
            </span>
          </template>
          <span v-if="isItemEditing(row.item.id) && editError" class="fterr">{{ editError }}</span>
        </template>
      </li>
    </ul>

    <div v-if="menu" class="ftmenu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop>
      <button v-if="menu.kind === 'folder'" class="ftmenuitem ftmenu-new" @click="menuNew">
        {{ $t(menu.path ? 'tree.new_subfolder' : 'tree.new_folder') }}
      </button>
      <button v-if="menu.kind === 'folder' && menu.path" class="ftmenuitem ftmenu-rename" @click="menuRename">{{ $t('tree.rename') }}</button>
      <button v-if="menu.kind === 'item'" class="ftmenuitem ftmenu-rename" @click="menuRename">{{ $t('tree.rename') }}</button>
      <button v-if="menu.kind === 'item' || (menu.kind === 'folder' && menu.path)" class="ftmenuitem ftmenu-del" @click="menuDelete">{{ $t('tree.delete') }}</button>
    </div>
  </div>
</template>

<style scoped>
.fttree { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.ftroot, .ftrow { display: flex; align-items: center; gap: 4px; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--tx2); }
.ftroot { flex: none; margin-bottom: 4px; }
.ftroot:hover, .ftrow:hover { background: var(--bg4); }
.ftroot.on, .ftrow.on { background: var(--bg4); color: var(--ac2); }
.ftlist { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.ftchev { flex: none; width: 12px; text-align: center; color: var(--tx4); transition: transform .12s; }
.ftchev.invisible { visibility: hidden; }
.ftchev.collapsed { transform: rotate(-90deg); }
.fticon { flex: none; }
.ftstatus { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.ftstatus.pass { background: #2e7d32; }
.ftstatus.fail { background: #c62828; }
.ftexec { font-size: 10px; }
.ftname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fttime { flex: none; color: var(--tx4); font-size: 11px; }
.ftacts { display: none; flex: none; gap: 2px; }
.ftroot:hover .ftacts, .ftrow:hover .ftacts { display: inline-flex; }
.ftact { border: none; background: none; color: var(--tx4); cursor: pointer; font-size: 12px; line-height: 1; padding: 2px 3px; }
.ftact:hover { color: var(--ac2); }
.ftedit { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx); border: 1px solid var(--ac2); border-radius: 4px; padding: 2px 6px; font-size: 12px; box-sizing: border-box; }
.ftedit:focus { outline: none; }
.fterr { color: #e06c75; font-size: 11px; }
.ftempty { padding: 12px; font-size: 12px; color: var(--tx4); }
.ftmenu { position: fixed; z-index: 4000; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; padding: 4px; display: flex; flex-direction: column; min-width: 120px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.ftmenuitem { text-align: left; border: none; background: none; color: var(--tx2); cursor: pointer; font-size: 12px; padding: 6px 10px; border-radius: 4px; }
.ftmenuitem:hover { background: var(--bg4); color: var(--ac2); }
</style>
```

> 注意 `readCollapsed` 在 `props` 之后定义但被 `collapsed = ref(readCollapsed())` 调用：把 `readCollapsed` 的函数声明放到 `const collapsed` 之前（函数声明提升也可，但为清晰请前置）。

- [ ] **Step 2: 写组件测试**

创建 `web/src/components/FileTree.test.ts`（happy-dom）：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import FileTree from './FileTree.vue';
import type { FileTreeActions } from '../fileTree';

function makeActions(): FileTreeActions {
  return {
    createFolder: vi.fn(async () => ({ ok: true })),
    renameFolder: vi.fn(async () => ({ ok: true })),
    removeFolder: vi.fn(async () => ({ ok: true })),
    renameItem: vi.fn(async () => ({ ok: true })),
    removeItem: vi.fn(async () => ({ ok: true })),
    moveItem: vi.fn(async () => ({ ok: true })),
  };
}
beforeEach(() => localStorage.clear());

describe('FileTree', () => {
  it('渲染文件夹与文件，选中事件', async () => {
    const actions = makeActions();
    const w = mountC(FileTree, { props: { folders: ['d'], items: [{ id: 'd/a.txt', folder: 'd', name: 'a.txt' }], activeFolder: '', activeId: '', actions, storageKey: 'k' } });
    const names = w.findAll('.ftname').map((n) => n.text());
    expect(names).toContain('d');
    expect(names).toContain('a.txt');
    await w.findAll('.ftrow.item .ftname')[0].trigger('click');
    expect(w.emitted('select-item')?.[0]?.[0]).toMatchObject({ id: 'd/a.txt' });
  });

  it('showRun=false 不渲染 ▶', () => {
    const w = mountC(FileTree, { props: { folders: [], items: [{ id: 'a.txt', folder: '', name: 'a.txt' }], activeFolder: '', activeId: '', actions: makeActions(), storageKey: 'k' } });
    expect(w.find('.ftexec').exists()).toBe(false);
  });

  it('新建文件夹走 createFolder', async () => {
    const actions = makeActions();
    const w = mountC(FileTree, { props: { folders: [], items: [], activeFolder: '', activeId: '', actions, storageKey: 'k' } });
    await w.find('.ftroot .ftnew').trigger('click');
    await w.find('.ftedit').setValue('newdir');
    await w.find('.ftedit').trigger('keydown.enter');
    await flushPromises();
    expect(actions.createFolder).toHaveBeenCalledWith('', 'newdir');
  });
});
```

- [ ] **Step 3: 运行**

Run: `npm --prefix web run test -- FileTree`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add web/src/fileTree.ts web/src/components/FileTree.vue web/src/components/FileTree.test.ts
git commit -m "feat(web): 通用目录树组件 FileTree"
```

---

## Task 7: PostmanTree 改为 FileTree 薄封装

**Files:**
- Modify: `web/src/tools/postman/PostmanTree.vue`（整体替换为封装）
- Test: `web/src/tools/postman/PostmanTree.test.ts`（保留既有用例，断言如依赖 pm 类名需改为 ft 类名）

- [ ] **Step 1: 写封装**

把 `web/src/tools/postman/PostmanTree.vue` 整体替换为：

```vue
<script setup lang="ts">
import { computed } from 'vue';
import FileTree from '../../components/FileTree.vue';
import type { FileItem, FileTreeActions } from '../../fileTree';
import type { PostmanActions, PostmanRecord } from './usePostmanHistory';

const props = defineProps<{
  folders: string[];
  records: PostmanRecord[];
  activeFolder: string;
  activeId: string;
  actions: PostmanActions;
  statuses?: Record<string, 'pass' | 'fail'>;
}>();
const emit = defineEmits<{
  (e: 'select-folder', path: string): void;
  (e: 'select-record', record: PostmanRecord): void;
  (e: 'run-folder', path: string): void;
  (e: 'run-record', record: PostmanRecord): void;
}>();

const items = computed<FileItem[]>(() => props.records.map((r) => ({
  id: r.id,
  folder: r.folder || '',
  name: r.name || r.id,
  label: (r.title && r.title.trim()) || r.command,
  updatedAt: r.updatedAt,
})));

const fileTreeActions: FileTreeActions = {
  createFolder: (parent, name) => props.actions.createFolder(parent, name),
  renameFolder: (path, name) => props.actions.renameFolder(path, name),
  removeFolder: (path) => props.actions.removeFolder(path),
  renameItem: (id, name) => props.actions.renameRecord(id, name),
  removeItem: (id) => props.actions.removeRecord(id),
  moveItem: (id, folder) => props.actions.moveRecord(id, folder),
};

function onSelectItem(item: FileItem) {
  const rec = props.records.find((r) => r.id === item.id);
  if (rec) emit('select-record', rec);
}
function onRunItem(item: FileItem) {
  const rec = props.records.find((r) => r.id === item.id);
  if (rec) emit('run-record', rec);
}
</script>

<template>
  <FileTree
    :folders="folders"
    :items="items"
    :active-folder="activeFolder"
    :active-id="activeId"
    :actions="fileTreeActions"
    :statuses="statuses"
    storage-key="devflow-postman-collapsed"
    show-run
    @select-folder="emit('select-folder', $event)"
    @select-item="onSelectItem"
    @run-folder="emit('run-folder', $event)"
    @run-item="onRunItem"
  />
</template>
```

- [ ] **Step 2: 跑 Postman 测试并按需改类名断言**

Run: `npm --prefix web run test -- PostmanTree`
若有断言依赖 `.pm*` 类名，改为 `.ft*`（`PostmanTool.test.ts` 也可能引用，用 `PostmanTool` 测试确认）。

- [ ] **Step 3: 回归 Postman 全组**

Run: `npm --prefix web run test -- Postman`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add web/src/tools/postman/PostmanTree.vue web/src/tools/postman/PostmanTree.test.ts web/src/tools/postman/PostmanTool.test.ts
git commit -m "refactor(postman): 目录树改用通用 FileTree，行为不变"
```

---

## Task 8: 记事本数据层 `useNotepadFiles.ts`

**Files:**
- Create: `web/src/tools/notepad/useNotepadFiles.ts`
- Test: `web/src/tools/notepad/useNotepadFiles.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useNotepadFiles } from './useNotepadFiles';

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }
afterEach(() => vi.unstubAllGlobals());

describe('useNotepadFiles', () => {
  it('load / read / save 请求路径正确', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      urls.push(`${opt?.method || 'GET'} ${u}`);
      if (u.startsWith('/api/notepad/tree')) return okJson({ items: [{ id: 'a.txt', folder: '', name: 'a.txt' }], folders: [] });
      if (u.startsWith('/api/notepad/file?id=')) return okJson({ content: 'hi', size: 2 });
      return okJson({ ok: true });
    }));
    const n = useNotepadFiles();
    await n.load();
    expect(n.items.value[0].id).toBe('a.txt');
    const c = await n.read('a.txt');
    expect(c).toBe('hi');
    await n.save('a.txt', 'x');
    expect(urls).toContain('PUT /api/notepad/file');
  });

  it('createFile 返回 id 并刷新', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => u.startsWith('/api/notepad/file') ? okJson({ ok: true, id: 'n.txt' }) : okJson({ items: [], folders: [] })));
    const n = useNotepadFiles();
    const id = await n.createFile('', 'n.txt');
    expect(id).toBe('n.txt');
  });

  it('失败抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(409, { error: 'exists' })));
    const n = useNotepadFiles();
    await expect(n.createFile('', 'a.txt')).rejects.toThrow('exists');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm --prefix web run test -- useNotepadFiles`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

创建 `web/src/tools/notepad/useNotepadFiles.ts`：

```ts
import { ref, type Ref } from 'vue';
import type { FileTreeActionResult } from '../../fileTree';

export type NotepadFile = { id: string; folder: string; name: string; updatedAt?: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch(url: string, opt: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opt);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(j?.error || `HTTP ${res.status}`));
  return j;
}

export function useNotepadFiles(): {
  folders: Ref<string[]>;
  items: Ref<NotepadFile[]>;
  load: () => Promise<void>;
  read: (id: string) => Promise<string>;
  save: (id: string, content: string) => Promise<void>;
  createFile: (folder: string, name: string) => Promise<string>;
  createFolder: (parent: string, name: string) => Promise<FileTreeActionResult>;
  renameFolder: (path: string, name: string) => Promise<FileTreeActionResult>;
  removeFolder: (path: string) => Promise<FileTreeActionResult>;
  renameItem: (id: string, name: string) => Promise<FileTreeActionResult>;
  removeItem: (id: string) => Promise<FileTreeActionResult>;
  moveItem: (id: string, folder: string) => Promise<FileTreeActionResult>;
} {
  const folders = ref<string[]>([]);
  const items = ref<NotepadFile[]>([]);

  async function load(): Promise<void> {
    try {
      const j = await jfetch('/api/notepad/tree');
      items.value = Array.isArray(j.items) ? j.items : [];
      folders.value = Array.isArray(j.folders) ? j.folders : [];
    } catch { /* ignore */ }
  }

  async function read(id: string): Promise<string> {
    const j = await jfetch(`/api/notepad/file?id=${encodeURIComponent(id)}`);
    return typeof j.content === 'string' ? j.content : '';
  }

  async function save(id: string, content: string): Promise<void> {
    await jfetch('/api/notepad/file', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ id, content }) });
  }

  async function createFile(folder: string, name: string): Promise<string> {
    const j = await jfetch('/api/notepad/file', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ folder, name }) });
    await load();
    return String(j.id || '');
  }

  function wrap(fn: () => Promise<any>): Promise<FileTreeActionResult> {
    return fn().then(async () => { await load(); return { ok: true }; }).catch((e) => ({ ok: false, error: (e as Error)?.message || 'failed' }));
  }

  const createFolder = (parent: string, name: string) => wrap(() => jfetch('/api/notepad/folder', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ path: parent ? `${parent}/${name}` : name }) }));
  const renameFolder = (path: string, name: string) => wrap(() => jfetch('/api/notepad/folder', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ path, name }) }));
  const removeFolder = (path: string) => wrap(() => jfetch(`/api/notepad/folder?path=${encodeURIComponent(path)}`, { method: 'DELETE' }));
  const renameItem = (id: string, name: string) => wrap(() => jfetch('/api/notepad/file', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, name }) }));
  const removeItem = (id: string) => wrap(() => jfetch(`/api/notepad/file?id=${encodeURIComponent(id)}`, { method: 'DELETE' }));
  const moveItem = (id: string, folder: string) => wrap(() => jfetch('/api/notepad/move', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, folder }) }));

  return { folders, items, load, read, save, createFile, createFolder, renameFolder, removeFolder, renameItem, removeItem, moveItem };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm --prefix web run test -- useNotepadFiles`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/notepad/useNotepadFiles.ts web/src/tools/notepad/useNotepadFiles.test.ts
git commit -m "feat(notepad): 记事本数据层 useNotepadFiles"
```

---

## Task 9: 记事本面板 `NotepadTool.vue` + MiniTools 接线

**Files:**
- Create: `web/src/tools/notepad/NotepadTool.vue`
- Modify: `web/src/components/MiniTools.vue`
- Test: `web/src/components/MiniTools.test.ts`

- [ ] **Step 1: 写面板组件**

创建 `web/src/tools/notepad/NotepadTool.vue`：

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../../i18n';
import { sortText, dedupText, type SortMode } from '../../textTools';
import { useNotepadFiles } from './useNotepadFiles';
import FileTree from '../../components/FileTree.vue';
import type { FileItem, FileTreeActions } from '../../fileTree';

const np = useNotepadFiles();
const activeId = ref('');
const activeFolder = ref('');
const content = ref('');
const dirty = ref(false);
const msg = ref('');
const saving = ref(false);
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const SORT_BTNS: Array<{ mode: SortMode; key: string }> = [
  { mode: 'asc', key: 'fp.sort.short.asc' },
  { mode: 'desc', key: 'fp.sort.short.desc' },
  { mode: 'num-asc', key: 'fp.sort.short.num_asc' },
  { mode: 'num-desc', key: 'fp.sort.short.num_desc' },
];

const actions: FileTreeActions = {
  createFolder: async (parent, name) => {
    if (!name) return { ok: false, error: 'empty' };
    return np.createFolder(parent, name);
  },
  renameFolder: (path, name) => np.renameFolder(path, name),
  removeFolder: (path) => np.removeFolder(path),
  renameItem: async (id, name) => {
    const r = await np.renameItem(id, name);
    if (r.ok && activeId.value === id) activeId.value = id.includes('/') ? `${id.slice(0, id.lastIndexOf('/'))}/${name}` : name;
    return r;
  },
  removeItem: async (id) => {
    const r = await np.removeItem(id);
    if (r.ok && activeId.value === id) { activeId.value = ''; content.value = ''; dirty.value = false; }
    return r;
  },
  moveItem: (id, folder) => np.moveItem(id, folder),
};

const title = computed(() => {
  if (!activeId.value) return '';
  const leaf = activeId.value.slice(activeId.value.lastIndexOf('/') + 1);
  return dirty.value ? `${leaf} *` : leaf;
});

async function openFile(item: FileItem) {
  if (dirty.value && activeId.value) await flushSave();
  try {
    content.value = await np.read(item.id);
    activeId.value = item.id;
    dirty.value = false;
    msg.value = '';
  } catch (e) { msg.value = t('np.open_failed', { msg: (e as Error)?.message || String(e) }); }
}

async function flushSave() {
  if (!activeId.value || !dirty.value) return;
  saving.value = true;
  try {
    await np.save(activeId.value, content.value);
    dirty.value = false;
    msg.value = t('np.saved');
  } catch (e) { msg.value = t('np.save_failed', { msg: (e as Error)?.message || String(e) }); }
  finally { saving.value = false; }
}
function scheduleSave() {
  dirty.value = true;
  msg.value = '';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void flushSave(); }, 1000);
}
function onInput() { if (activeId.value) scheduleSave(); }

function applySort(mode: SortMode) {
  if (!activeId.value) return;
  content.value = sortText(content.value, mode);
  scheduleSave();
}
function applyDedup() {
  if (!activeId.value) return;
  content.value = dedupText(content.value);
  scheduleSave();
}
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flushSave(); }
}
onMounted(() => { void np.load(); document.addEventListener('keydown', onKeydown); });
onBeforeUnmount(() => { document.removeEventListener('keydown', onKeydown); if (saveTimer) clearTimeout(saveTimer); });
</script>

<template>
  <div class="npbody">
    <aside class="npside">
      <div class="npsidehead">
        <span class="npsidetitle">{{ $t('tools.notepad') }}</span>
        <button class="npmini" @click="np.load()">{{ $t('np.new_file') }}</button>
      </div>
      <FileTree
        :folders="np.folders.value"
        :items="np.items.value"
        :active-folder="activeFolder"
        :active-id="activeId"
        :actions="actions"
        storage-key="devflow-notepad-collapsed"
        @select-folder="(p) => (activeFolder = p)"
        @select-item="openFile"
      />
    </aside>

    <section class="npmain">
      <div class="npbar">
        <span class="npname">{{ title || $t('np.no_file') }}</span>
        <button class="npbtn primary" :disabled="!activeId || saving" @click="flushSave">{{ $t('np.save') }}</button>
        <button v-for="b in SORT_BTNS" :key="b.mode" class="npbtn" :disabled="!activeId" @click="applySort(b.mode)">{{ $t(b.key) }}</button>
        <button class="npbtn" :disabled="!activeId" @click="applyDedup">{{ $t('np.dedup') }}</button>
      </div>
      <div v-if="msg" class="npmsg">{{ msg }}</div>
      <textarea v-model="content" class="nparea" :placeholder="$t('np.no_file')" spellcheck="false" :disabled="!activeId" @input="onInput" />
    </section>
  </div>
</template>

<style scoped>
.npbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.npside { width: 280px; flex: none; display: flex; flex-direction: column; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); overflow: hidden; padding: 6px; box-sizing: border-box; }
.npsidehead { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 6px; }
.npsidetitle { font-size: 12px; color: var(--tx3); }
.npmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.npbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.npname { flex: 1; min-width: 0; color: var(--tx2); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.npbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.npbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.npbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.npbtn:disabled { opacity: .55; cursor: default; }
.npmsg { color: var(--tx3); font-size: 12px; }
.nparea { flex: 1; min-height: 200px; resize: none; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.nparea:focus { outline: none; border-color: var(--ac2); }
.npmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.npmini:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
</style>
```

> `np.folders.value` / `np.items.value` 在模板中解引用 `ref`：`<script setup>` 下模板不会自动解 `np.xxx`（`np` 是普通对象），故上面显式写 `.value`；这是刻意为之。

新建文件入口：`npsidehead` 的按钮改为调用一个 `newFile()`（而不是刷新）：

```ts
async function newFile() {
  const name = window.prompt(t('np.file_name'), t('np.file_ph'));
  if (!name) return;
  try {
    const id = await np.createFile(activeFolder.value, name.trim());
    activeId.value = id; content.value = ''; dirty.value = false; msg.value = '';
  } catch (e) { msg.value = t('np.save_failed', { msg: (e as Error)?.message || String(e) }); }
}
```

并把按钮 `@click="np.load()"` 改为 `@click="newFile()"`、文案 `{{ $t('np.new_file') }}`。

- [ ] **Step 2: MiniTools 接线**

`web/src/components/MiniTools.vue`：
- `import NotepadTool from '../tools/notepad/NotepadTool.vue';`
- `type ToolId = 'translate' | 'yaml' | 'js' | 'notepad' | 'postman';`
- `TOOLS` 第 4 项改为 `{ id: 'notepad', icon: '📝', label: 'tools.notepad' }`。
- 模板里在 `<PostmanTool v-if="open === 'postman'" />` 旁加 `<NotepadTool v-else-if="open === 'notepad'" />`，并让 `mtbody` 的 `v-else` 分支不再包含 notepad。
- 删除 `SORT_BTNS`、`runSort`、`runDedup` 及 `textTools` import（若不再使用）。

- [ ] **Step 3: 更新 MiniTools 测试**

`MiniTools.test.ts`：把「排序/去重为纯前端计算」用例改为断言第 4 个工具渲染 `NotepadTool`：

```ts
import NotepadTool from '../tools/notepad/NotepadTool.vue';
// ...
it('记事本：渲染 NotepadTool', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
  const w = mount();
  await w.findAll('.mticon')[3].trigger('click');
  await flushPromises();
  expect(w.findComponent(NotepadTool).exists()).toBe(true);
  expect(w.find('.npbody').exists()).toBe(true);
});
```

删除依赖 `.mtbtn` 排序按钮的旧断言；「复制输出/转输入/清空」用例改到 translate（`mtbtn.primary`）或删除排序专属断言。

- [ ] **Step 4: 写 NotepadTool 测试**

创建 `web/src/tools/notepad/NotepadTool.test.ts`（happy-dom）：mock fetch 返回树与文件，断言选中文件后 textarea 载入内容、排序按钮后内容变化。示例：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import NotepadTool from './NotepadTool.vue';

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
afterEach(() => vi.unstubAllGlobals());

describe('NotepadTool', () => {
  it('打开文件载入内容', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.startsWith('/api/notepad/tree')) return okJson({ items: [{ id: 'a.txt', folder: '', name: 'a.txt' }], folders: [] });
      if (u.startsWith('/api/notepad/file?id=')) return okJson({ content: 'b\na' });
      return okJson({ ok: true });
    }));
    const w = mountC(NotepadTool);
    await flushPromises();
    await w.find('.ftrow.item .ftname').trigger('click');
    await flushPromises();
    expect((w.find('.nparea').element as HTMLTextAreaElement).value).toBe('b\na');
    await w.findAll('.npbtn')[1].trigger('click');   // 升序
    expect((w.find('.nparea').element as HTMLTextAreaElement).value).toBe('a\nb');
  });
});
```

- [ ] **Step 5: 全量 web 测试 + 类型检查**

Run: `npm.cmd test`（或至少 `npm --prefix web run test`）
Expected: PASS。

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/tools/notepad/NotepadTool.vue web/src/tools/notepad/NotepadTool.test.ts web/src/components/MiniTools.vue web/src/components/MiniTools.test.ts
git commit -m "feat(notepad): 记事本面板与 MiniTools 接线"
```

---

## Task 10: 全量验证与文档

**Files:** 无（验证 + AGENTS 目录速览补一行）

- [ ] **Step 1: 全量测试**

Run: `npm.cmd test`
Expected: server 与 web 全 PASS。

- [ ] **Step 2: 类型 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 3: 敏感信息自查**

Run:
```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat-|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git ls-files env
```
Expected: 仅命中清单自身示例；`env` 为空。

- [ ] **Step 4: AGENTS 目录速览补一行**

在 `AGENTS.md`「目录速览」的 Postman 小工具那行后补：

```md
- 记事本小工具：`server/notepad-store.js`（`<端口数据目录>/tools/notepad/` 纯文本文件树）+ `http-api.js` 的 `/api/notepad/*`；前端 `web/src/tools/notepad/`（`useNotepadFiles.ts` 数据层 + `NotepadTool.vue` 面板），通用目录树 `web/src/components/FileTree.vue`（Postman 与记事本共用）。
```

- [ ] **Step 5: 提交**

```bash
git add AGENTS.md
git commit -m "docs(agents): 目录速览补充记事本小工具"
```

---

## Self-Review 结论

- **Spec 覆盖**：命名/接线（T7/T9）、目录能力（T6）、落盘路径（T1/T2）、读写落盘/自动保存+Ctrl+S（T9）、排序去重（T9 保留 4 项）、通用树抽取（T5/T6/T7）、HTTP（T3）、i18n（T4）——覆盖 spec 全部条目；「非目标」未触碰。
- **占位符**：无 TODO/TBD；各步给出完整代码或精确改动。
- **命名一致性**：`notepadDir`、`createNotepadStore`、`/api/notepad/*`、`FileTree`/`FileItem`/`FileTreeActions`、`useNotepadFiles`、`activeId/dirty/scheduleSave/flushSave` 全文一致。
- **风险**：T6/T7 抽取会改动 Postman 树；已要求跑 Postman 回归。并发会话可能同时改 `PostmanTree.vue`，执行前先 `git status` 确认工作树干净。
