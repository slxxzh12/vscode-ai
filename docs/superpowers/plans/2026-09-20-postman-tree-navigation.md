# Postman 左侧目录树导航 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Postman 小工具左侧由「全展开平铺列表」改造成可展开/折叠、可就地新建与重命名的文件管理器式目录树，并把 Postman 从 `MiniTools.vue` 拆到独立目录。

**Architecture:** 后端 `server/postman-history.js` 增加 `renameFolder` / `setRecordTitle` 并在重跑时保留标题，`server/http-api.js` 加两个 PATCH 端点；前端新建 `web/src/tools/postman/`（`usePostmanHistory.ts` 数据层 + `PostmanTree.vue` 树交互 + `PostmanTool.vue` 布局），`MiniTools.vue` 只挂载 `PostmanTool`。

**Tech Stack:** Node ESM（node:test）、Vue 3 `<script setup>` + vitest/happy-dom；i18n 走 `@devflow/shared/i18n`（`shared/i18n/zh-CN.js` + `en.js`）。

**Spec:** `docs/superpowers/specs/2026-09-20-postman-tree-navigation-design.md`

---

### Task 1: 后端 store：`renameFolder` + `setRecordTitle` + 重跑保留标题

**Files:**
- Modify: `server/postman-history.js`
- Test: `server/test/postman-history.test.js`

- [ ] **Step 1: Write the failing tests**

在 `server/test/postman-history.test.js` 末尾追加：

```js
test('renameFolder：改目录名并返回新路径；重名/非法名/不存在报错', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  h.createFolder('foo/bar');
  h.record('curl https://a.com', RESULT, { folder: 'foo' });
  assert.equal(h.renameFolder('foo', 'baz'), 'baz');
  assert.deepEqual(h.listFolders().sort(), ['baz', 'baz/bar']);
  assert.equal(h.renameFolder('baz', 'baz'), 'baz');
  h.createFolder('other');
  assert.throws(() => h.renameFolder('baz', 'other'), (e) => e.code === 'exists');
  assert.throws(() => h.renameFolder('baz', '../evil'), (e) => e.code === 'bad-path');
  assert.throws(() => h.renameFolder('baz', 'a b'), (e) => e.code === 'bad-path');
  assert.throws(() => h.renameFolder('nope', 'x'), (e) => e.code === 'not-found');
});

test('setRecordTitle：设置/清空标题；重跑同 curl 保留标题', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  const id = postmanRecordName('curl https://a.com');
  h.record('curl https://a.com', RESULT);
  assert.equal(h.setRecordTitle(id, '  My A  '), true);
  assert.equal(h.list()[0].title, 'My A');
  h.record('curl https://a.com', { ...RESULT, stdout: 'again' });
  const kept = h.list()[0];
  assert.equal(kept.title, 'My A');
  assert.equal(kept.result.stdout, 'again');
  assert.equal(h.setRecordTitle(id, ''), true);
  assert.equal(h.list()[0].title, undefined);
  assert.equal(h.setRecordTitle('../evil.json', 'x'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "server/test/postman-history.test.js"`
Expected: FAIL —— `h.renameFolder is not a function`、`h.setRecordTitle is not a function`。

- [ ] **Step 3: 实现——`record` 保留旧标题**

在 `server/postman-history.js` 中，把 `record` 的这段：

```js
    const file = path.join(target, postmanRecordName(cmd));
    const rec = { command: cmd, result: normalizeResult(result), updatedAt: new Date(now).toISOString() };
```

替换为：

```js
    const file = path.join(target, postmanRecordName(cmd));
    let title = '';
    try {
      const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof prev?.title === 'string') title = prev.title.trim();
    } catch { /* 新文件或坏文件：无标题可保留 */ }
    const rec = { command: cmd, ...(title ? { title } : {}), result: normalizeResult(result), updatedAt: new Date(now).toISOString() };
```

- [ ] **Step 4: 实现——新增两个方法并导出**

在 `server/postman-history.js` 的 `move` 定义之后、`return { ... }` 之前插入：

```js
  // 只改目录最后一段名字；返回新相对路径。重名抛 exists，非法名抛 bad-path，目标不存在抛 not-found。
  const renameFolder = (rel, name) => {
    const r = normalizeRel(rel);
    if (!r) { const e = new Error('empty path'); e.code = 'empty'; throw e; }
    const abs = dirOf(r);
    if (!fs.existsSync(abs)) { const e = new Error('missing'); e.code = 'not-found'; throw e; }
    const seg = String(name ?? '').trim();
    if (!SEG.test(seg) || seg === '.' || seg === '..') { const e = new Error('bad name'); e.code = 'bad-path'; throw e; }
    const parent = r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '';
    const next = parent ? `${parent}/${seg}` : seg;
    if (next === r) return r;
    const to = dirOf(next);
    if (fs.existsSync(to)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
    fs.renameSync(abs, to);
    return next;
  };

  // 记录的显示标题；空标题清除该字段，回退显示 curl 原文。文件名（哈希）不变。
  const setRecordTitle = (id, title) => {
    let file;
    try { file = resolveRecord(id); } catch { return false; }
    let rec;
    try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
    const name = String(title ?? '').trim();
    if (name) rec.title = name; else delete rec.title;
    try { fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, 'utf8'); return true; } catch { return false; }
  };
```

把文件末尾的：

```js
  return { dir, record, list, listFolders, remove, createFolder, removeFolder, move };
```

替换为：

```js
  return { dir, record, list, listFolders, remove, createFolder, removeFolder, move, renameFolder, setRecordTitle };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test "server/test/postman-history.test.js"`
Expected: PASS（全部用例）。

- [ ] **Step 6: Commit**

```bash
git add server/postman-history.js server/test/postman-history.test.js
git commit -m "feat(postman): 目录重命名与记录标题（重跑保留标题）"
```

---

### Task 2: HTTP 端点 `PATCH /api/postman/folder` 与 `PATCH /api/postman/history`

**Files:**
- Modify: `server/http-api.js`（`/api/postman/folder` POST 块之后）
- Test: `server/test/http-api.test.js`

- [ ] **Step 1: Write the failing test（先加 patch 辅助函数）**

在 `server/test/http-api.test.js` 的 `del` 函数之后插入：

```js
function patch(server, url, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, body: buf.toString('utf8'), buf });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}
```

在文件末尾追加：

```js
test('PATCH /api/postman/folder 重命名；PATCH /api/postman/history 改标题', async (t) => {
  const { createPostmanHistory } = await import('../postman-history.js');
  const dir = tmpDir();
  const postmanHistory = createPostmanHistory({ dir });
  const result = { ok: true, code: 0, error: '', timedOut: false, stdout: 'ok', stderr: '' };
  const server = await start(new Projects({ projects: [] }), { runCurlFn: async () => result, postmanHistory });
  t.after(() => server.close());

  await post(server, '/api/postman/folder', { path: 'foo' });
  const renamed = await patch(server, '/api/postman/folder', { path: 'foo', name: 'bar' });
  assert.equal(renamed.status, 200);
  assert.deepEqual(JSON.parse(renamed.body), { ok: true, path: 'bar' });
  assert.equal(fs.existsSync(path.join(dir, 'bar')), true);

  await post(server, '/api/curl', { command: 'curl https://a.com', folder: 'bar' });
  const items = JSON.parse((await request(server, '/api/postman/history')).body).items;
  const rec = await patch(server, '/api/postman/history', { id: items[0].id, title: 'My A' });
  assert.equal(rec.status, 200);
  const after = JSON.parse((await request(server, '/api/postman/history')).body).items;
  assert.equal(after[0].title, 'My A');

  await post(server, '/api/postman/folder', { path: 'other' });
  const conflict = await patch(server, '/api/postman/folder', { path: 'bar', name: 'other' });
  assert.equal(conflict.status, 400);
  assert.equal(JSON.parse(conflict.body).error, 'exists');
  assert.equal((await patch(server, '/api/postman/history', { id: '../evil.json', title: 'x' })).status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "server/test/http-api.test.js"`
Expected: FAIL —— PATCH 落到默认 404 分支，`renamed.status` 为 404。

- [ ] **Step 3: 实现端点**

在 `server/http-api.js` 中，把 `/api/postman/folder` 的 POST 块之后（`if (url.pathname === '/api/postman/folder' && req.method === 'DELETE')` 之前）插入：

```js
      if (url.pathname === '/api/postman/folder' && req.method === 'PATCH') {
        const body = await readJsonBody(req);
        try {
          const folder = postmanHistory?.renameFolder?.(String(body.path ?? ''), String(body.name ?? '')) ?? '';
          sendJson(res, 200, { ok: true, path: folder });
        } catch (e) {
          sendJson(res, 400, { error: e?.code || 'bad-path' });
        }
        return;
      }
```

在 `/api/postman/history` 的 DELETE 块之后插入：

```js
      if (url.pathname === '/api/postman/history' && req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const ok = postmanHistory?.setRecordTitle?.(String(body.id ?? ''), String(body.title ?? '')) ?? false;
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not-found' });
        return;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "server/test/http-api.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/http-api.js server/test/http-api.test.js
git commit -m "feat(postman): PATCH 目录重命名与记录标题端点"
```

---

### Task 3: i18n 词条（中英对称）

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 中文——加新键、删旧键**

在 `shared/i18n/zh-CN.js` 的 `'tools.pm_saveto': '保存到：{path}',` 之后插入：

```js
  'tools.pm_new_folder': '新建文件夹',
  'tools.pm_new_subfolder': '新建子文件夹',
  'tools.pm_rename': '重命名',
  'tools.pm_rename_ph': '名称',
  'tools.pm_cancel': '取消',
  'tools.pm_exists': '同名文件夹已存在',
  'tools.pm_rename_failed': '重命名失败',
```

删除该文件中的这一行：

```js
  'tools.pm_folder_name': '文件夹名',
```

- [ ] **Step 2: 英文——加新键、删旧键**

在 `shared/i18n/en.js` 的 `'tools.pm_saveto': 'Save to: {path}',` 之后插入：

```js
  'tools.pm_new_folder': 'New folder',
  'tools.pm_new_subfolder': 'New subfolder',
  'tools.pm_rename': 'Rename',
  'tools.pm_rename_ph': 'Name',
  'tools.pm_cancel': 'Cancel',
  'tools.pm_exists': 'A folder with that name already exists',
  'tools.pm_rename_failed': 'Rename failed',
```

删除该文件中的这一行：

```js
  'tools.pm_folder_name': 'Folder name',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: 退出码 0、无中文命中、中英键集合对称。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(postman): 目录树新建/重命名词条"
```

---

### Task 4: 前端数据层 `usePostmanHistory.ts`

**Files:**
- Create: `web/src/tools/postman/usePostmanHistory.ts`
- Test: `web/src/tools/postman/usePostmanHistory.test.ts`

- [ ] **Step 1: Write the failing test**

创建 `web/src/tools/postman/usePostmanHistory.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { usePostmanHistory } from './usePostmanHistory';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
function errJson(status: number, body: unknown) { return { ok: false, status, json: async () => body }; }

afterEach(() => vi.unstubAllGlobals());

describe('usePostmanHistory', () => {
  it('load 拉取 items/folders', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [{ id: 'a.json', command: 'curl a' }], folders: ['foo'] })));
    const s = usePostmanHistory();
    await s.load();
    expect(s.history.value).toHaveLength(1);
    expect(s.folders.value).toEqual(['foo']);
  });

  it('createFolder 拼父路径并 POST', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method, init?.body ? JSON.parse(String(init.body)) : undefined]);
      return okJson({ ok: true, folder: 'foo/bar' });
    }));
    const s = usePostmanHistory();
    const res = await s.createFolder('foo', 'bar');
    expect(res).toEqual({ ok: true, path: 'foo/bar' });
    expect(calls[0]).toEqual(['/api/postman/folder', 'POST', { path: 'foo/bar' }]);
  });

  it('createFolder 根目录不带斜杠', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method, JSON.parse(String(init.body))]);
      return okJson({ ok: true });
    }));
    const s = usePostmanHistory();
    await s.createFolder('', 'top');
    expect(calls[0][2]).toEqual({ path: 'top' });
  });

  it('renameFolder 用 PATCH 并返回新路径', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method, JSON.parse(String(init.body))]);
      return okJson({ ok: true, path: 'foo2' });
    }));
    const s = usePostmanHistory();
    const res = await s.renameFolder('foo', 'foo2');
    expect(calls[0]).toEqual(['/api/postman/folder', 'PATCH', { path: 'foo', name: 'foo2' }]);
    expect(res).toEqual({ ok: true, path: 'foo2' });
  });

  it('renameFolder 冲突返回 error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(400, { error: 'exists' })));
    const s = usePostmanHistory();
    expect(await s.renameFolder('a', 'b')).toEqual({ ok: false, error: 'exists' });
  });

  it('renameRecord 用 PATCH /api/postman/history', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      calls.push([String(u), init?.method, JSON.parse(String(init.body))]);
      return okJson({ ok: true });
    }));
    const s = usePostmanHistory();
    const res = await s.renameRecord('a.json', 'My A');
    expect(calls[0]).toEqual(['/api/postman/history', 'PATCH', { id: 'a.json', title: 'My A' }]);
    expect(res.ok).toBe(true);
  });

  it('runCurl 返回结果并在失败时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/curl'
      ? okJson({ ok: true, code: 0, stdout: 'hi', stderr: '', timedOut: false })
      : okJson({ items: [], folders: [] }))));
    const s = usePostmanHistory();
    const j = await s.runCurl('curl x', '');
    expect(j.stdout).toBe('hi');

    vi.stubGlobal('fetch', vi.fn(async () => errJson(400, { message: 'bad' })));
    await expect(s.runCurl('bad', '')).rejects.toThrow('bad');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- src/tools/postman/usePostmanHistory.test.ts`
Expected: FAIL —— 无法解析 `./usePostmanHistory`。

- [ ] **Step 3: Write minimal implementation**

创建 `web/src/tools/postman/usePostmanHistory.ts`：

```ts
import { ref, type Ref } from 'vue';

export type PostmanRecord = {
  id: string;
  command: string;
  title?: string;
  result?: unknown;
  updatedAt?: string;
  folder?: string;
  name?: string;
};

export type ActionResult = { ok: boolean; error?: string; path?: string };

export type PostmanActions = {
  createFolder: (parent: string, name: string) => Promise<ActionResult>;
  renameFolder: (path: string, name: string) => Promise<ActionResult>;
  renameRecord: (id: string, title: string) => Promise<ActionResult>;
  removeFolder: (path: string) => Promise<ActionResult>;
  removeRecord: (id: string) => Promise<ActionResult>;
  moveRecord: (id: string, folder: string) => Promise<ActionResult>;
};

export type CurlResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function usePostmanHistory(): {
  history: Ref<PostmanRecord[]>;
  folders: Ref<string[]>;
  load: () => Promise<void>;
  createFolder: (parent: string, name: string) => Promise<ActionResult>;
  renameFolder: (path: string, name: string) => Promise<ActionResult>;
  renameRecord: (id: string, title: string) => Promise<ActionResult>;
  removeFolder: (path: string) => Promise<ActionResult>;
  removeRecord: (id: string) => Promise<ActionResult>;
  moveRecord: (id: string, folder: string) => Promise<ActionResult>;
  runCurl: (command: string, folder: string) => Promise<CurlResult>;
} {
  const history = ref<PostmanRecord[]>([]);
  const folders = ref<string[]>([]);

  async function load(): Promise<void> {
    try {
      const res = await fetch('/api/postman/history');
      const j: any = await res.json().catch(() => ({}));
      history.value = Array.isArray(j.items) ? j.items : [];
      folders.value = Array.isArray(j.folders) ? j.folders : [];
    } catch { /* 列表拉取失败不影响执行 */ }
  }

  async function createFolder(parent: string, name: string): Promise<ActionResult> {
    const path = parent ? `${parent}/${name}` : name;
    try {
      const res = await fetch('/api/postman/folder', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ path }) });
      if (!res.ok) {
        const j: any = await res.json().catch(() => ({}));
        return { ok: false, error: String(j?.error || 'bad-path') };
      }
      await load();
      return { ok: true, path };
    } catch { return { ok: false, error: 'failed' }; }
  }

  async function renameFolder(path: string, name: string): Promise<ActionResult> {
    try {
      const res = await fetch('/api/postman/folder', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ path, name }) });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: String(j?.error || 'rename-failed') };
      await load();
      return { ok: true, path: String(j?.path || path) };
    } catch { return { ok: false, error: 'failed' }; }
  }

  async function renameRecord(id: string, title: string): Promise<ActionResult> {
    try {
      const res = await fetch('/api/postman/history', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, title }) });
      if (!res.ok) return { ok: false, error: 'rename-failed' };
      await load();
      return { ok: true };
    } catch { return { ok: false, error: 'failed' }; }
  }

  async function removeFolder(path: string): Promise<ActionResult> {
    try {
      const res = await fetch(`/api/postman/folder?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      await load();
      return res.ok ? { ok: true } : { ok: false, error: 'not-found' };
    } catch { await load(); return { ok: false, error: 'failed' }; }
  }

  async function removeRecord(id: string): Promise<ActionResult> {
    try {
      const res = await fetch(`/api/postman/history?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
      return res.ok ? { ok: true } : { ok: false, error: 'not-found' };
    } catch { await load(); return { ok: false, error: 'failed' }; }
  }

  async function moveRecord(id: string, folder: string): Promise<ActionResult> {
    try {
      const res = await fetch('/api/postman/move', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, folder }) });
      if (res.ok) await load();
      return res.ok ? { ok: true } : { ok: false, error: 'not-found' };
    } catch { return { ok: false, error: 'failed' }; }
  }

  async function runCurl(command: string, folder: string): Promise<CurlResult> {
    const res = await fetch('/api/curl', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ command, folder }) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(j?.message || j?.error || `HTTP ${res.status}`));
    await load();
    return j as CurlResult;
  }

  return { history, folders, load, createFolder, renameFolder, renameRecord, removeFolder, removeRecord, moveRecord, runCurl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test -- src/tools/postman/usePostmanHistory.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/tools/postman/usePostmanHistory.ts web/src/tools/postman/usePostmanHistory.test.ts
git commit -m "feat(postman): 前端数据层 usePostmanHistory"
```

---

### Task 5: `PostmanTree.vue` 目录树交互

**Files:**
- Create: `web/src/tools/postman/PostmanTree.vue`
- Test: `web/src/tools/postman/PostmanTree.test.ts`

- [ ] **Step 1: Write the failing test**

创建 `web/src/tools/postman/PostmanTree.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mountC } from '../../test-utils';
import PostmanTree from './PostmanTree.vue';

function actions(overrides: Record<string, unknown> = {}) {
  return {
    createFolder: vi.fn(async () => ({ ok: true })),
    renameFolder: vi.fn(async () => ({ ok: true })),
    renameRecord: vi.fn(async () => ({ ok: true })),
    removeFolder: vi.fn(async () => ({ ok: true })),
    removeRecord: vi.fn(async () => ({ ok: true })),
    moveRecord: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function mount(props: Record<string, unknown> = {}) {
  return mountC(PostmanTree, {
    props: { folders: [], records: [], activeFolder: '', activeId: '', actions: actions(), ...props },
  });
}

const REC = (id: string, command: string, folder = '', extra: Record<string, unknown> = {}) =>
  ({ id, command, folder, result: {}, updatedAt: '2026-09-01T00:00:00.000Z', ...extra });

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('PostmanTree', () => {
  it('默认全展开：文件夹及其记录都可见', () => {
    const w = mount({ folders: ['foo'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    expect(w.text()).toContain('foo');
    expect(w.text()).toContain('curl A');
  });

  it('点箭头折叠后记录隐藏，并写入 localStorage', async () => {
    const w = mount({ folders: ['foo'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    await w.find('.pmchev:not(.invisible)').trigger('click');
    expect(w.text()).not.toContain('curl A');
    expect(JSON.parse(localStorage.getItem('devflow-postman-collapsed') || '[]')).toEqual(['foo']);
  });

  it('localStorage 里的折叠状态在挂载时生效', () => {
    localStorage.setItem('devflow-postman-collapsed', JSON.stringify(['foo']));
    const w = mount({ folders: ['foo'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    expect(w.text()).not.toContain('curl A');
  });

  it('双击文件夹名切换展开/折叠', async () => {
    const w = mount({ folders: ['foo'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    await w.find('.pmrow.folder .pmname').trigger('dblclick');
    expect(w.text()).not.toContain('curl A');
  });

  it('同一文件夹内先子文件夹后记录', () => {
    const w = mount({ folders: ['foo', 'foo/sub'], records: [REC('foo/a.json', 'curl A', 'foo')] });
    const texts = w.findAll('.pmrow .pmname').map((n) => n.text());
    expect(texts.indexOf('foo')).toBeLessThan(texts.indexOf('sub'));
    expect(texts.indexOf('sub')).toBeLessThan(texts.indexOf('curl A'));
  });

  it('单击文件夹/记录发出 select 事件', async () => {
    const w = mount({ folders: ['foo'], records: [REC('a.json', 'curl A', '')] });
    await w.find('.pmrow.folder .pmname').trigger('click');
    expect(w.emitted('select-folder')?.[0]).toEqual(['foo']);
    await w.find('.pmrow.record .pmname').trigger('click');
    expect(w.emitted('select-record')?.[0]?.[0]).toMatchObject({ id: 'a.json' });
  });

  it('悬停 ＋ 新建子文件夹：Enter 调 actions.createFolder(parent, name)', async () => {
    const a = actions();
    const w = mount({ actions: a, folders: ['foo'] });
    await w.find('.pmrow.folder .pmnew').trigger('click');
    const input = w.find('.pmedit');
    expect(input.exists()).toBe(true);
    await input.setValue('bar');
    await input.trigger('keydown.enter');
    await nextTick();
    expect(a.createFolder).toHaveBeenCalledWith('foo', 'bar');
  });

  it('记录重命名：Enter 调 actions.renameRecord', async () => {
    const a = actions();
    const w = mount({ actions: a, records: [REC('a.json', 'curl A', '')] });
    await w.find('.pmrow.record .pmrename').trigger('click');
    await w.find('.pmedit').setValue('My A');
    await w.find('.pmedit').trigger('keydown.enter');
    await nextTick();
    expect(a.renameRecord).toHaveBeenCalledWith('a.json', 'My A');
  });

  it('文件夹重命名冲突保持编辑态并显示提示', async () => {
    const a = actions({ renameFolder: vi.fn(async () => ({ ok: false, error: 'exists' })) });
    const w = mount({ actions: a, folders: ['foo'] });
    await w.find('.pmrow.folder .pmrename').trigger('click');
    await w.find('.pmedit').setValue('bar');
    await w.find('.pmedit').trigger('keydown.enter');
    await nextTick();
    expect(w.find('.pmedit').exists()).toBe(true);
    expect(w.find('.pmerr').exists()).toBe(true);
  });

  it('右键文件夹出现菜单，菜单可删除', async () => {
    const a = actions();
    const w = mount({ actions: a, folders: ['foo'] });
    await w.find('.pmrow.folder').trigger('contextmenu');
    expect(w.find('.pmmenu').exists()).toBe(true);
    await w.find('.pmmenu-del').trigger('click');
    await nextTick();
    expect(a.removeFolder).toHaveBeenCalledWith('foo');
  });

  it('记录显示标题优先于 command，无标题回退 command', () => {
    const w = mount({ records: [REC('a.json', 'curl A', '', { title: 'My A' }), REC('b.json', 'curl B', '')] });
    expect(w.text()).toContain('My A');
    expect(w.text()).not.toContain('curl A');
    expect(w.text()).toContain('curl B');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- src/tools/postman/PostmanTree.test.ts`
Expected: FAIL —— 无法解析 `./PostmanTree.vue`。

- [ ] **Step 3: Write implementation**

创建 `web/src/tools/postman/PostmanTree.vue`：

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n';
import type { ActionResult, PostmanActions, PostmanRecord } from './usePostmanHistory';

const props = defineProps<{
  folders: string[];
  records: PostmanRecord[];
  activeFolder: string;
  activeId: string;
  actions: PostmanActions;
}>();
const emit = defineEmits<{
  (e: 'select-folder', path: string): void;
  (e: 'select-record', record: PostmanRecord): void;
}>();

type EditingMeta =
  | { kind: 'new'; parent: string }
  | { kind: 'folder'; path: string }
  | { kind: 'record'; id: string };

type Row =
  | { kind: 'folder'; key: string; path: string; name: string; depth: number; expanded: boolean }
  | { kind: 'record'; key: string; record: PostmanRecord; depth: number }
  | { kind: 'editor'; key: string; depth: number };

type Menu =
  | { kind: 'folder'; path: string; x: number; y: number }
  | { kind: 'record'; record: PostmanRecord; x: number; y: number };

const STORE = 'devflow-postman-collapsed';

// 存「折叠」集合：缺省/为空 = 全展开
function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}

const collapsed = ref<Set<string>>(readCollapsed());
const editing = ref<EditingMeta | null>(null);
const draft = ref('');
const editError = ref('');
const menu = ref<Menu | null>(null);
const dragId = ref('');

function persistCollapsed() {
  try { localStorage.setItem(STORE, JSON.stringify([...collapsed.value])); } catch { /* ignore */ }
}
function toggle(path: string) {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path); else next.add(path);
  collapsed.value = next;
  persistCollapsed();
}

watch(() => props.folders, (list) => {
  const valid = new Set(list);
  let changed = false;
  const next = new Set<string>();
  for (const p of collapsed.value) { if (valid.has(p)) next.add(p); else changed = true; }
  if (changed) { collapsed.value = next; persistCollapsed(); }
});

const rows = computed<Row[]>(() => {
  const byFolder = new Map<string, PostmanRecord[]>();
  for (const r of props.records) {
    const f = r.folder || '';
    const arr = byFolder.get(f);
    if (arr) arr.push(r); else byFolder.set(f, [r]);
  }
  for (const arr of byFolder.values()) arr.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
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
    for (const r of byFolder.get(parent) || []) out.push({ kind: 'record', key: `r:${r.id}`, record: r, depth });
  };
  walk('', 0);
  return out;
});

function isFolderEditing(path: string) { const ed = editing.value; return !!ed && ed.kind === 'folder' && ed.path === path; }
function isRecordEditing(id: string) { const ed = editing.value; return !!ed && ed.kind === 'record' && ed.id === id; }
function recordLabel(rec: PostmanRecord) { return (rec.title && rec.title.trim()) || rec.command; }
function fmtTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function selectFolder(path: string) { emit('select-folder', path); }
function selectRecord(rec: PostmanRecord) { emit('select-record', rec); }

function startNew(parent: string) { menu.value = null; editing.value = { kind: 'new', parent }; draft.value = ''; editError.value = ''; }
function startRenameFolder(path: string) { menu.value = null; editing.value = { kind: 'folder', path }; draft.value = path.slice(path.lastIndexOf('/') + 1); editError.value = ''; }
function startRenameRecord(rec: PostmanRecord) { menu.value = null; editing.value = { kind: 'record', id: rec.id }; draft.value = rec.title || rec.command; editError.value = ''; }
function cancelEdit() { editing.value = null; draft.value = ''; editError.value = ''; }

async function commitEdit() {
  const ed = editing.value;
  if (!ed) return;
  const name = draft.value.trim();
  let res: ActionResult;
  if (ed.kind === 'new') {
    if (!name) { cancelEdit(); return; }
    res = await props.actions.createFolder(ed.parent, name);
  } else if (ed.kind === 'folder') {
    if (!name) { cancelEdit(); return; }
    res = await props.actions.renameFolder(ed.path, name);
  } else {
    res = await props.actions.renameRecord(ed.id, name);
  }
  if (res.ok) cancelEdit();
  else editError.value = res.error === 'exists' ? t('tools.pm_exists') : t('tools.pm_rename_failed');
}

async function removeFolder(path: string) { menu.value = null; await props.actions.removeFolder(path); }
async function removeRecord(id: string) { menu.value = null; await props.actions.removeRecord(id); }

function openMenuFolder(e: MouseEvent, path: string) { menu.value = { kind: 'folder', path, x: e.clientX, y: e.clientY }; }
function openMenuRecord(e: MouseEvent, rec: PostmanRecord) { menu.value = { kind: 'record', record: rec, x: e.clientX, y: e.clientY }; }
function closeMenu() { menu.value = null; }
function menuNew() { const m = menu.value; if (m && m.kind === 'folder') startNew(m.path); }
function menuRename() {
  const m = menu.value;
  if (!m) return;
  if (m.kind === 'folder' && m.path) startRenameFolder(m.path);
  else if (m.kind === 'record') startRenameRecord(m.record);
}
function menuDelete() {
  const m = menu.value;
  if (!m) return;
  if (m.kind === 'folder' && m.path) void removeFolder(m.path);
  else if (m.kind === 'record') void removeRecord(m.record.id);
}

function onDragStart(row: Row) { if (row.kind === 'record') dragId.value = row.record.id; }
function onDrop(folder: string) {
  const id = dragId.value;
  dragId.value = '';
  if (!id) return;
  const rec = props.records.find((r) => r.id === id);
  if (!rec || (rec.folder || '') === folder) return;
  void props.actions.moveRecord(id, folder);
}
function onDropRow(row: Row) {
  if (row.kind === 'folder') onDrop(row.path);
  else if (row.kind === 'record') onDrop(row.record.folder || '');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeMenu(); if (editing.value) cancelEdit(); }
}
onMounted(() => {
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenu);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="pmtree">
    <div class="pmroot" :class="{ on: activeFolder === '' }"
         @click="selectFolder('')" @contextmenu.prevent="openMenuFolder($event, '')"
         @dragover.prevent @drop.prevent="onDrop('')">
      <span class="pmchev invisible">▸</span>
      <span class="pmicon">🏠</span>
      <span class="pmname">{{ $t('tools.pm_root') }}</span>
      <span class="pmacts">
        <button class="pmact pmnew" :title="$t('tools.pm_new_folder')" @click.stop="startNew('')">＋</button>
      </span>
    </div>

    <div v-if="!rows.length" class="pmempty">{{ $t('tools.pm_empty') }}</div>
    <ul v-else class="pmlist" @dragover.prevent @drop.prevent="onDrop('')">
      <li v-for="row in rows" :key="row.key" class="pmrow"
          :class="[row.kind, { on: row.kind === 'folder' ? activeFolder === row.path : (row.kind === 'record' && activeId === row.record.id) }]"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          :draggable="row.kind === 'record' ? 'true' : 'false'"
          @dragstart="onDragStart(row)"
          @drop.stop.prevent="onDropRow(row)">
        <template v-if="row.kind === 'editor'">
          <span class="pmchev invisible">▸</span>
          <span class="pmicon">📁</span>
          <input class="pmedit" v-model="draft" :placeholder="$t('tools.pm_rename_ph')"
                 @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
          <button class="pmact" :title="$t('tools.pm_cancel')" @click.stop="cancelEdit">×</button>
          <span v-if="editError" class="pmerr">{{ editError }}</span>
        </template>

        <template v-else-if="row.kind === 'folder'">
          <span class="pmchev" :class="{ collapsed: !row.expanded }" @click.stop="toggle(row.path)">▸</span>
          <span class="pmicon">📁</span>
          <template v-if="isFolderEditing(row.path)">
            <input class="pmedit" v-model="draft"
                   @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
            <button class="pmact" :title="$t('tools.pm_cancel')" @click.stop="cancelEdit">×</button>
          </template>
          <template v-else>
            <span class="pmname" @click="selectFolder(row.path)" @dblclick="toggle(row.path)"
                  @contextmenu.prevent="openMenuFolder($event, row.path)">{{ row.name }}</span>
            <span class="pmacts">
              <button class="pmact pmnew" :title="$t('tools.pm_new_subfolder')" @click.stop="startNew(row.path)">＋</button>
              <button class="pmact pmrename" :title="$t('tools.pm_rename')" @click.stop="startRenameFolder(row.path)">✎</button>
              <button class="pmact pmdel" :title="$t('tools.pm_delete')" @click.stop="removeFolder(row.path)">×</button>
            </span>
          </template>
          <span v-if="isFolderEditing(row.path) && editError" class="pmerr">{{ editError }}</span>
        </template>

        <template v-else>
          <span class="pmchev invisible">▸</span>
          <span class="pmicon">📄</span>
          <template v-if="isRecordEditing(row.record.id)">
            <input class="pmedit" v-model="draft"
                   @click.stop @keydown.enter.stop.prevent="commitEdit" @keydown.esc.stop.prevent="cancelEdit" />
            <button class="pmact" :title="$t('tools.pm_cancel')" @click.stop="cancelEdit">×</button>
          </template>
          <template v-else>
            <span class="pmname" @click="selectRecord(row.record)"
                  @contextmenu.prevent="openMenuRecord($event, row.record)">{{ recordLabel(row.record) }}</span>
            <span class="pmtime">{{ fmtTime(row.record.updatedAt) }}</span>
            <span class="pmacts">
              <button class="pmact pmrename" :title="$t('tools.pm_rename')" @click.stop="startRenameRecord(row.record)">✎</button>
              <button class="pmact pmdel" :title="$t('tools.pm_delete')" @click.stop="removeRecord(row.record.id)">×</button>
            </span>
          </template>
          <span v-if="isRecordEditing(row.record.id) && editError" class="pmerr">{{ editError }}</span>
        </template>
      </li>
    </ul>

    <div v-if="menu" class="pmmenu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop>
      <button v-if="menu.kind === 'folder'" class="pmmenuitem pmmenu-new" @click="menuNew">
        {{ $t(menu.path ? 'tools.pm_new_subfolder' : 'tools.pm_new_folder') }}
      </button>
      <button v-if="menu.kind === 'folder' && menu.path" class="pmmenuitem pmmenu-rename" @click="menuRename">{{ $t('tools.pm_rename') }}</button>
      <button v-if="menu.kind === 'record'" class="pmmenuitem pmmenu-rename" @click="menuRename">{{ $t('tools.pm_rename') }}</button>
      <button v-if="menu.kind === 'record' || (menu.kind === 'folder' && menu.path)" class="pmmenuitem pmmenu-del" @click="menuDelete">{{ $t('tools.pm_delete') }}</button>
    </div>
  </div>
</template>

<style scoped>
.pmtree { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.pmroot, .pmrow { display: flex; align-items: center; gap: 4px; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--tx2); }
.pmroot { flex: none; margin-bottom: 4px; }
.pmroot:hover, .pmrow:hover { background: var(--bg4); }
.pmroot.on, .pmrow.on { background: var(--bg4); color: var(--ac2); }
.pmlist { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.pmchev { flex: none; width: 12px; text-align: center; color: var(--tx4); transition: transform .12s; }
.pmchev.invisible { visibility: hidden; }
.pmchev.collapsed { transform: rotate(-90deg); }
.pmicon { flex: none; }
.pmname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pmtime { flex: none; color: var(--tx4); font-size: 11px; }
.pmacts { display: none; flex: none; gap: 2px; }
.pmroot:hover .pmacts, .pmrow:hover .pmacts { display: inline-flex; }
.pmact { border: none; background: none; color: var(--tx4); cursor: pointer; font-size: 12px; line-height: 1; padding: 2px 3px; }
.pmact:hover { color: var(--ac2); }
.pmedit { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx); border: 1px solid var(--ac2); border-radius: 4px; padding: 2px 6px; font-size: 12px; box-sizing: border-box; }
.pmedit:focus { outline: none; }
.pmerr { color: #e06c75; font-size: 11px; }
.pmempty { padding: 12px; font-size: 12px; color: var(--tx4); }
.pmmenu { position: fixed; z-index: 4000; background: var(--bg1); border: 1px solid var(--bd); border-radius: 6px; padding: 4px; display: flex; flex-direction: column; min-width: 120px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.pmmenuitem { text-align: left; border: none; background: none; color: var(--tx2); cursor: pointer; font-size: 12px; padding: 6px 10px; border-radius: 4px; }
.pmmenuitem:hover { background: var(--bg4); color: var(--ac2); }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test -- src/tools/postman/PostmanTree.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/tools/postman/PostmanTree.vue web/src/tools/postman/PostmanTree.test.ts
git commit -m "feat(postman): 目录树组件（展开折叠/就地新建重命名/右键菜单）"
```

---

### Task 6: `PostmanTool.vue` 布局与执行

**Files:**
- Create: `web/src/tools/postman/PostmanTool.vue`
- Test: `web/src/tools/postman/PostmanTool.test.ts`

- [ ] **Step 1: Write the failing test**

创建 `web/src/tools/postman/PostmanTool.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import PostmanTool from './PostmanTool.vue';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const REC = (id: string, command: string) => ({ id, command, folder: '', result: {}, updatedAt: '2026-09-01T00:00:00.000Z' });

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('PostmanTool', () => {
  it('执行 curl 显示输出并提示退出码', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/postman/history'
      ? okJson({ items: [], folders: [] })
      : okJson({ ok: true, code: 0, stdout: 'hi', stderr: '', timedOut: false }))));
    const w = mountC(PostmanTool);
    await flushPromises();
    await w.find('.pmcurl').setValue('curl -s https://a.com');
    await w.find('.pmrun').trigger('click');
    await flushPromises();
    expect((w.find('.pmout').element as HTMLTextAreaElement).value).toBe('hi');
    expect(w.find('.pmmsg').exists()).toBe(true);
  });

  it('点击记录载入命令', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [REC('a.json', 'curl old')], folders: [] })));
    const w = mountC(PostmanTool);
    await flushPromises();
    await w.find('.pmrow.record .pmname').trigger('click');
    expect((w.find('.pmcurl').element as HTMLTextAreaElement).value).toBe('curl old');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- src/tools/postman/PostmanTool.test.ts`
Expected: FAIL —— 无法解析 `./PostmanTool.vue`。

- [ ] **Step 3: Write implementation**

创建 `web/src/tools/postman/PostmanTool.vue`：

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '../../i18n';
import { usePostmanHistory, type PostmanActions, type PostmanRecord } from './usePostmanHistory';
import PostmanTree from './PostmanTree.vue';

const { history, folders, load, createFolder, renameFolder, renameRecord, removeFolder, removeRecord, moveRecord, runCurl } = usePostmanHistory();

const curlCmd = ref('');
const output = ref('');
const busy = ref(false);
const msg = ref('');
const copied = ref(false);
const activeId = ref('');
const activeFolder = ref('');
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const actions: PostmanActions = {
  createFolder: (parent, name) => createFolder(parent, name),
  renameFolder: async (path, name) => {
    const res = await renameFolder(path, name);
    if (res.ok && res.path) {
      if (activeFolder.value === path) activeFolder.value = res.path;
      else if (activeFolder.value.startsWith(`${path}/`)) activeFolder.value = res.path + activeFolder.value.slice(path.length);
    }
    return res;
  },
  renameRecord: (id, title) => renameRecord(id, title),
  removeFolder: async (path) => {
    const res = await removeFolder(path);
    if (res.ok && (activeFolder.value === path || activeFolder.value.startsWith(`${path}/`))) activeFolder.value = '';
    return res;
  },
  removeRecord: async (id) => {
    const res = await removeRecord(id);
    if (res.ok && activeId.value === id) activeId.value = '';
    return res;
  },
  moveRecord: (id, folder) => moveRecord(id, folder),
};

const saveTo = computed(() => (activeFolder.value ? `/${activeFolder.value}` : '/'));

function selectFolder(path: string) { activeFolder.value = path; }
function selectRecord(r: PostmanRecord) { curlCmd.value = r.command; activeId.value = r.id; output.value = ''; msg.value = ''; }

async function runCurlCmd() {
  if (busy.value) return;
  if (!curlCmd.value.trim()) { msg.value = t('et.empty'); return; }
  busy.value = true; msg.value = ''; output.value = '';
  try {
    const j = await runCurl(curlCmd.value, activeFolder.value);
    output.value = [j.stdout, j.stderr ? `--- stderr ---\n${j.stderr}` : ''].filter(Boolean).join(j.stdout ? '\n' : '');
    msg.value = j.timedOut ? t('tools.pm_timeout') : t('tools.pm_exit', { code: j.code });
  } catch (e) {
    msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) });
  } finally { busy.value = false; }
}

async function copyOut() {
  if (!output.value) return;
  try { await navigator.clipboard.writeText(output.value); }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = output.value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch { /* ignore */ }
  }
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copied.value = false; copyTimer = null; }, 2000);
}

onMounted(() => { void load(); });
</script>

<template>
  <div class="pmbody">
    <aside class="pmside">
      <div class="pmsidehead">
        <span class="pmsidetitle">{{ $t('tools.pm_history') }}</span>
        <button class="pmmini" @click="load()">{{ $t('tools.pm_refresh') }}</button>
      </div>
      <PostmanTree
        :folders="folders"
        :records="history"
        :active-folder="activeFolder"
        :active-id="activeId"
        :actions="actions"
        @select-folder="selectFolder"
        @select-record="selectRecord"
      />
    </aside>

    <section class="pmmain">
      <div class="pmactsbar">
        <button class="pmbtn primary pmrun" :disabled="busy" @click="runCurlCmd">{{ busy ? $t('tools.pm_running') : $t('tools.run') }}</button>
        <button class="pmbtn" @click="curlCmd = ''; output = ''; msg = ''">{{ $t('tools.clear') }}</button>
        <span class="pmsave">{{ $t('tools.pm_saveto', { path: saveTo }) }}</span>
      </div>

      <div v-if="msg" class="pmmsg">{{ msg }}</div>

      <div class="pmcurlbox">
        <div class="pmcurlbar"><span class="pmcurlprompt">curl</span><span class="pmcurltip">{{ $t('tools.pm_tip') }}</span></div>
        <textarea v-model="curlCmd" class="pmcurl" :placeholder="$t('tools.pm_ph')" spellcheck="false" />
      </div>

      <label class="pmlabel">{{ $t('tools.pm_resp') }}</label>
      <div class="pmoutwrap">
        <textarea v-model="output" class="pmout" :placeholder="$t('tools.output')" spellcheck="false" readonly />
        <div class="pmoutacts">
          <button class="pmmini" :disabled="!output" @click="copyOut">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pmbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.pmside { width: 280px; flex: none; display: flex; flex-direction: column; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); overflow: hidden; padding: 6px; box-sizing: border-box; }
.pmsidehead { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 6px; }
.pmsidetitle { font-size: 12px; color: var(--tx3); }
.pmmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.pmactsbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pmbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.pmbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.pmbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.pmbtn:disabled { opacity: .55; cursor: default; }
.pmsave { color: var(--tx4); font-size: 12px; }
.pmmsg { color: var(--tx3); font-size: 12px; }
.pmlabel { color: var(--tx3); font-size: 12px; }
.pmcurlbox { display: flex; flex-direction: column; border: 1px solid var(--ac2); border-radius: 8px; overflow: hidden; background: var(--bg1); }
.pmcurlbar { display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: var(--bg4); border-bottom: 1px solid var(--bd); }
.pmcurlprompt { font-family: ui-monospace, Consolas, monospace; font-size: 12px; font-weight: 700; color: var(--ac2); }
.pmcurltip { color: var(--tx4); font-size: 11px; }
.pmcurl { flex: none; min-height: 120px; resize: none; border: none; background: transparent; color: var(--tx); padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.pmcurl:focus { outline: none; }
.pmoutwrap { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.pmout { flex: 1; min-height: 120px; resize: none; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.pmout:focus { outline: none; border-color: var(--ac2); }
.pmoutacts { display: flex; gap: 8px; justify-content: flex-end; }
.pmmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.pmmini:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.pmmini:disabled { opacity: .5; cursor: default; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test -- src/tools/postman/PostmanTool.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/tools/postman/PostmanTool.vue web/src/tools/postman/PostmanTool.test.ts
git commit -m "feat(postman): Postman 面板组件（左树 + curl 执行）"
```

---

### Task 7: `MiniTools.vue` 接入 `PostmanTool` 并清理内联实现

**Files:**
- Modify: `web/src/components/MiniTools.vue`
- Test: `web/src/components/MiniTools.test.ts`

- [ ] **Step 1: 替换脚本中的 Postman 状态/函数**

在 `web/src/components/MiniTools.vue` 中，把 `<script setup>` 顶部 import 段：

```ts
import { computed, ref } from 'vue';
import { t } from '../i18n';
import { parseYamlDoc, serializeYamlDoc } from '../yaml';
import { sortText, dedupText, type SortMode } from '../textTools';
```

替换为：

```ts
import { computed, ref } from 'vue';
import { t } from '../i18n';
import { parseYamlDoc, serializeYamlDoc } from '../yaml';
import { sortText, dedupText, type SortMode } from '../textTools';
import PostmanTool from '../tools/postman/PostmanTool.vue';
```

删除以下整段（`type PostmanRecord` 到 `treeRows` 结束，含 `TreeRow` 类型与 `treeRows` 计算属性）：

```ts
type PostmanRecord = { id: string; command: string; result: any; updatedAt?: string; folder?: string };
type TreeRow =
  | { kind: 'folder'; key: string; path: string; name: string; depth: number }
  | { kind: 'record'; key: string; record: PostmanRecord; depth: number };
```

以及：

```ts
const history = ref<PostmanRecord[]>([]);
const folders = ref<string[]>([]);
const activeId = ref('');
const activeFolder = ref('');
const folderName = ref('');
const dragRecord = ref<PostmanRecord | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

// 左侧树：文件夹按名排序，记录在各自目录内按时间倒序；根目录记录排在最后
const treeRows = computed<TreeRow[]>(() => {
  const byFolder = new Map<string, PostmanRecord[]>();
  for (const r of history.value) {
    const f = r.folder || '';
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f)!.push(r);
  }
  for (const arr of byFolder.values()) arr.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const children = new Map<string, string[]>();
  for (const f of folders.value) {
    const parent = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(f);
  }
  for (const arr of children.values()) arr.sort();
  const rows: TreeRow[] = [];
  const pushRecords = (folder: string, depth: number) => {
    for (const r of byFolder.get(folder) || []) rows.push({ kind: 'record', key: `r:${r.id}`, record: r, depth });
  };
  const walk = (parent: string, depth: number) => {
    for (const f of children.get(parent) || []) {
      rows.push({ kind: 'folder', key: `d:${f}`, path: f, name: f.slice(f.lastIndexOf('/') + 1), depth });
      walk(f, depth + 1);
      pushRecords(f, depth + 1);
    }
  };
  walk('', 0);
  pushRecords('', 0);
  return rows;
});
```

替换为（只保留 `copyTimer`，供其它工具复制用）：

```ts
let copyTimer: ReturnType<typeof setTimeout> | null = null;
```

再用以下内容删除 Postman 专用但已在其它片段中未涵盖的 ref 声明：

```ts
const curlCmd = ref('');
```

（即把 `const curlCmd = ref('');` 整行删除；`curlCmd` 清理后不再被任何代码使用。）

- [ ] **Step 2: 精简 `openTool`**

把 `openTool` 函数体：

```ts
function openTool(id: ToolId) {
  if (TOOLS.find((x) => x.id === id)?.disabled) return;
  open.value = id;
  input.value = '';
  curlCmd.value = '';
  output.value = '';
  msg.value = '';
  copied.value = false;
  activeId.value = '';
  activeFolder.value = '';
  folderName.value = '';
  if (id === 'postman') loadHistory();
}
```

替换为：

```ts
function openTool(id: ToolId) {
  if (TOOLS.find((x) => x.id === id)?.disabled) return;
  open.value = id;
  input.value = '';
  output.value = '';
  msg.value = '';
  copied.value = false;
}
```

- [ ] **Step 3: 删除 Postman 专用函数**

删除以下整段（从 `async function loadHistory()` 到 `async function dropInto(folder: string) { ... }` 结束）：

```ts
async function loadHistory() {
  try {
    const res = await fetch('/api/postman/history');
    const j: any = await res.json().catch(() => ({}));
    history.value = Array.isArray(j.items) ? j.items : [];
    folders.value = Array.isArray(j.folders) ? j.folders : [];
    if (activeFolder.value && !folders.value.includes(activeFolder.value)) activeFolder.value = '';
  } catch { /* 列表拉取失败不影响执行 */ }
}

function pickRecord(r: PostmanRecord) {
  curlCmd.value = r.command;
  activeId.value = r.id;
  output.value = '';
  msg.value = '';
}

async function removeRecord(r: PostmanRecord) {
  try {
    const res = await fetch(`/api/postman/history?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' });
    if (!res.ok) { loadHistory(); return; }
  } catch { loadHistory(); return; }
  history.value = history.value.filter((x) => x.id !== r.id);
  if (activeId.value === r.id) activeId.value = '';
}

async function createFolder() {
  const name = folderName.value.trim();
  if (!name) return;
  const target = activeFolder.value ? `${activeFolder.value}/${name}` : name;
  try {
    const res = await fetch('/api/postman/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target }),
    });
    if (!res.ok) return;
    folderName.value = '';
    activeFolder.value = target;
    await loadHistory();
  } catch { /* ignore */ }
}

async function removeFolder(p: string) {
  try {
    const res = await fetch(`/api/postman/folder?path=${encodeURIComponent(p)}`, { method: 'DELETE' });
    if (!res.ok) { loadHistory(); return; }
  } catch { loadHistory(); return; }
  if (activeFolder.value === p || activeFolder.value.startsWith(`${p}/`)) activeFolder.value = '';
  await loadHistory();
}

async function dropInto(folder: string) {
  const r = dragRecord.value;
  dragRecord.value = null;
  if (!r || (r.folder || '') === folder) return;
  try {
    const res = await fetch('/api/postman/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, folder }),
    });
    if (res.ok) await loadHistory();
  } catch { /* ignore */ }
}
```

同时删除 `fmtTime` 函数：

```ts
function fmtTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}
```

并删除 `runCurlCmd` 函数：

```ts
async function runCurlCmd() {
  if (busy.value) return;
  if (!curlCmd.value.trim()) { msg.value = t('et.empty'); return; }
  busy.value = true; msg.value = ''; output.value = '';
  try {
    const res = await fetch('/api/curl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: curlCmd.value, folder: activeFolder.value }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) { msg.value = t('tools.failed', { msg: j.message || j.error || `HTTP ${res.status}` }); return; }
    output.value = [j.stdout, j.stderr ? `--- stderr ---\n${j.stderr}` : ''].filter(Boolean).join(j.stdout ? '\n' : '');
    msg.value = j.timedOut ? t('tools.pm_timeout') : t('tools.pm_exit', { code: j.code });
    loadHistory();
  } catch (e) { fail(e); } finally { busy.value = false; }
}
```

- [ ] **Step 4: 替换模板中的 Postman 区块**

把模板中从 `<div v-if="open === 'postman'" class="mtbody mtpm">` 到其闭合 `</div>`（紧邻 `</el-dialog>` 前）的整段，替换为：

```html
      <PostmanTool v-if="open === 'postman'" />
```

（即原 block 内 `aside.mtpmside` 与 `section.mtpmmain` 全部删除，只留这一行；其后原有的 `<div v-else class="mtbody"> ... </div>` 保持不变。）

- [ ] **Step 5: 删除 Postman 专用样式**

在 `<style scoped>` 中删除以下选择器及其规则（整块）：

```css
.mtpm { ... }
.mtpmside { ... }
.mtpmsidehead { ... }
.mtpmsidetitle { ... }
.mtpmlist { ... }
.mtpmitem { ... }
.mtpmitem:hover { ... }
.mtpmitem.on { ... }
.mtpmcmd { ... }
.mtpmtime { ... }
.mtpmdel { ... }
.mtpmdel:hover { ... }
.mtpmempty { ... }
.mtpmmain { ... }
.mtpmkfolder { ... }
.mtpminput { ... }
.mtpminput:focus { ... }
.mtpmroot { ... }
.mtpmroot.on { ... }
.mtpmfolder { ... }
.mtpmfolder:hover { ... }
.mtpmfolder.on { ... }
.mtpmfname { ... }
.mtpmsave { ... }
```

同时删除这些仅 Postman 使用的选择器：

```css
.mtlabel { ... }
.mtcurlbox { ... }
.mtcurlbar { ... }
.mtcurlprompt { ... }
.mtcurltip { ... }
.mtcurl { ... }
.mtcurl:focus { ... }
```

保留通用样式：`.mtbody`、`.mtacts`、`.mtbtn`、`.mtmsg`、`.mtarea`、`.mtout`、`.mtoutacts`、`.mtmini`。

- [ ] **Step 6: 更新 `MiniTools.test.ts`**

在 `web/src/components/MiniTools.test.ts` 顶部 import 段加：

```ts
import PostmanTool from '../tools/postman/PostmanTool.vue';
```

删除这四个用例的整段：

```ts
  it('Postman：执行 curl 命令并显示输出', async () => {
    ...
  });

  it('Postman：左侧记录按时间倒序，点击载入，删除移除', async () => {
    ...
  });

  it('Postman：新建文件夹走 /api/postman/folder', async () => {
    ...
  });

  it('Postman：文件夹树展示，记录在目录内按时间倒序', async () => {
    ...
  });
```

替换为：

```ts
  it('Postman：渲染 PostmanTool 子组件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
    const w = mount();
    await w.findAll('.mticon')[4].trigger('click');
    await flushPromises();
    expect(w.findComponent(PostmanTool).exists()).toBe(true);
    expect(w.find('.pmbody').exists()).toBe(true);
  });
```

- [ ] **Step 7: 类型检查 + 单测**

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd --prefix web run test -- src/components/MiniTools.test.ts src/tools/postman`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add web/src/components/MiniTools.vue web/src/components/MiniTools.test.ts
git commit -m "refactor(postman): MiniTools 挂载 PostmanTool，移除内联实现"
```

---

### Task 8: 文档与全量验证

**Files:**
- Modify: `AGENTS.md`（「目录速览」节）

- [ ] **Step 1: 目录速览补一行**

在 `AGENTS.md` 的「## 目录速览」节内，找到这一行：

```markdown
- `shared/` — WS 协议常量/类型（唯一事实源）；`server/` — Node ESM 后端（ws + node-pty，测试在 `server/test/`，`node --test`）；`web/` — Vue3+Vite+TS+xterm（vitest + vue-tsc）。
```

在其后新增一行：

```markdown
- Postman 小工具：`server/postman-history.js`（curl 记录/目录树，存 `<端口数据目录>/tools/postman/`）；前端 `web/src/tools/postman/`（`usePostmanHistory.ts` 数据层 + `PostmanTree.vue` 目录树 + `PostmanTool.vue` 面板），由 `web/src/components/MiniTools.vue` 挂载。
```

- [ ] **Step 2: 全量测试**

Run: `npm.cmd test`
Expected: 全绿（server `node --test` + web `vitest run`）。

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 4: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 退出码 0、无中文命中。

- [ ] **Step 5: 前端构建**

Run: `npm.cmd run build:web`
Expected: 构建成功。

- [ ] **Step 6: 人工验收（dev，端口 33333，日志写 `logs\`）**

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:server" -RedirectStandardOutput "logs\dev-server.log" -RedirectStandardError "logs\dev-server.err.log" -WindowStyle Hidden
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:web" -RedirectStandardOutput "logs\dev-web.log" -RedirectStandardError "logs\dev-web.err.log" -WindowStyle Hidden
```

打开 `http://localhost:5173` → 打开 Postman 工具，确认：默认全部展开；点箭头折叠、刷新后折叠状态保持；双击文件夹名切换展开；悬停文件夹出现 ＋ ✎ ×；右键空白/文件夹/记录出现对应菜单；新建子文件夹落在所选目录下、刷新可见；重命名文件夹与记录（记录显示标题、磁盘文件名不变）；拖记录到文件夹完成移动。

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md
git commit -m "docs: 目录速览补充 Postman 目录树模块"
```

---

## Self-Review

**1. Spec coverage**

- 展开/折叠 + 默认全展开 + localStorage 持久化 → Task 5（`collapsed`、`readCollapsed`/`persistCollapsed`、测试「默认全展开」「折叠写入 localStorage」「挂载生效」）。
- 就地新建子文件夹（含根/任意文件夹）→ Task 5（`startNew`/`editor` 行、测试）、Task 4（`createFolder(parent,name)`）。
- 每层先子文件夹后记录 → Task 5（`walk` 顺序、测试「先子文件夹后记录」）。
- 单击选中、双击标题切换、箭头切换 → Task 5（模板 + `selectFolder`/`toggle`）。
- 重命名文件夹与记录（记录改显示标题）→ Task 1 + Task 2 + Task 4 + Task 5。
- 右键菜单 + 悬停图标并存 → Task 5（`pmacts` + `.pmmenu`）。
- 记录显示 `title || command`、空标题回退、重跑保留标题 → Task 1 + Task 5 测试「记录显示标题优先」。
- 拖拽移动保留 → Task 5（`onDragStart`/`onDrop`）+ Task 4（`moveRecord`）。
- 冲突提示并保持编辑态 → Task 5（`editError`、测试「冲突保持编辑态」）。
- 删除当前选中文件夹清空选择 → Task 6（`actions.removeFolder` 包装）。
- 拆出 `web/src/tools/postman/` 三文件、`MiniTools` 只挂载 → Task 4/5/6/7。
- i18n 中英对称、新增/删除词条 → Task 3。
- 后端 store + PATCH 端点 + 测试 → Task 1/2。
- 文档目录速览 → Task 8。

**2. Placeholder scan**

无 TBD/TODO；每个代码步骤给出完整代码与命令。

**3. Type consistency**

- `PostmanRecord` / `ActionResult` / `PostmanActions` / `CurlResult` 在 Task 4 定义，Task 5/6 引用一致。
- `createFolder(parent, name)`、`renameFolder(path, name)`、`renameRecord(id, title)`、`removeFolder(path)`、`removeRecord(id)`、`moveRecord(id, folder)` 签名在 Task 4（实现）、Task 5（props 调用）、Task 6（actions 装配）一致。
- localStorage 键 `devflow-postman-collapsed` 在 Task 5 实现与测试一致。
- CSS/DOM 选择器 `.pmrow.folder`、`.pmrow.record`、`.pmnew`、`.pmrename`、`.pmdel`、`.pmedit`、`.pmerr`、`.pmmenu-del`、`.pmcurl`、`.pmrun`、`.pmout`、`.pmmsg`、`.pmbody`、`.pmrow.record .pmname` 在实现与测试一致。
- i18n 键 `tools.pm_new_folder`/`pm_new_subfolder`/`pm_rename`/`pm_rename_ph`/`pm_cancel`/`pm_exists`/`pm_rename_failed` 在 Task 3 定义，Task 5 使用一致。
