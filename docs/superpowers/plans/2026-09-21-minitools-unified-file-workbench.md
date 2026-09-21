# 小工具统一文件工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把小工具（notepad/yaml/js/translate/postman/navicat）的编辑体验统一为「类首页代码编辑」：左侧文件树外观/交互对齐首页 `FileTree`，右侧编辑器始终可编辑，无活动文件时保存/新建都按时间戳落盘。

**Architecture:** 后端把 postman 的 JSON 记录、navicat 的 SQL 文件都适配成与 `notepad-store` 同形的文件树 store，统一挂在 `/api/files/<tool>/*`；前端 `ItemTree` 吸收标题栏与右键菜单、`useFileWorkbench` 承担「始终可编辑 + 无文件时间戳保存」，各工具只接线。

**Tech Stack:** Node ESM 后端（`node --test`）、Vue3 + TS + CodeMirror（vitest）、`shared/i18n` 词条。

**参考设计:** `docs/superpowers/specs/2026-09-21-minitools-unified-file-workbench-design.md`

> **与设计文档的偏差（经复核更简）：** postman 不再新增 `/api/postman/record` 端点，而是在服务端加一个把「记录 JSON」适配成通用文件树接口的 `server/postman-files.js`，直接复用现有 `/api/files/<tool>/*` 路由；前端因此不需要注入式的 `files` provider。

---

## 文件结构

**新增**
- `server/postman-files.js` — 把 Postman 记录适配成通用文件树 store
- `server/test/postman-files.test.js` — 适配器单测
- `web/src/components/ItemTree.test.ts` — 由 `PostmanTree.test.ts` 迁移而来

**修改（后端）**
- `server/postman-history.js` — 放宽记录文件名 + `read/write/createFile`
- `server/port-paths.js` — `navicatSqlDir`
- `server/index.js` — `fileStores.postman` / `fileStores.navicat`
- `server/test/postman-history.test.js`、`server/test/notepad-http.test.js`

**修改（前端）**
- `web/src/tools/files/useToolFiles.ts` — `FileTool` 增加 `postman`/`navicat`
- `web/src/tools/files/useFileWorkbench.ts` — 始终可编辑 + 时间戳保存 + `newFile(folder)` + `refresh`
- `web/src/components/ItemTree.vue` — 标题栏 + 去根行 + 菜单扩充 + 样式对齐
- `web/src/tools/postman/PostmanTree.vue` — 改为接收 `items` 的薄封装
- `web/src/tools/notepad/NotepadTool.vue`、`web/src/tools/text/TextToolBody.vue` — 直用 `ItemTree`
- `web/src/tools/postman/PostmanTool.vue` — 接入 `useFileWorkbench({ tool: 'postman' })`
- `web/src/tools/navicat/NavicatTree.vue`、`NavicatTool.vue` — 连接 + 文件分组
- 对应 `*.test.ts`

**删除**
- `web/src/components/FileSidebar.vue`（其职责并入 `ItemTree` 标题栏）
- `web/src/tools/postman/PostmanTree.test.ts`（改名迁移为 `ItemTree.test.ts`）

---

## Task 1: postman 记录 store 支持读写文件正文

**Files:**
- Modify: `server/postman-history.js`
- Test: `server/test/postman-history.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/postman-history.test.js` 末尾追加：

```javascript
test('read/write：正文即 curl，写回保留标题与结果', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  const id = postmanRecordName('curl https://a.com');
  h.record('curl https://a.com', RESULT);
  h.setRecordTitle(id, 'My A');
  assert.deepEqual(h.read(id), { content: 'curl https://a.com', title: 'My A', updatedAt: h.list()[0].updatedAt });
  h.write(id, 'curl https://b.com');
  const rec = h.list()[0];
  assert.equal(rec.command, 'curl https://b.com');
  assert.equal(rec.title, 'My A');
  assert.equal(rec.result.stdout, 'hello');
});

test('createFile：时间戳命名的记录文件可被 list/read 识别', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  h.createFolder('foo');
  const created = h.createFile('foo', '20260921-153012.json');
  assert.equal(created.id, 'foo/20260921-153012.json');
  assert.equal(h.read(created.id).content, '');
  assert.equal(h.list().length, 1);
  assert.throws(() => h.createFile('foo', '20260921-153012.json'), (e) => e.code === 'exists');
  assert.throws(() => h.createFile('foo', '../evil.json'), (e) => e.code === 'bad-path');
});

test('read/write：非法 id 抛 bad-id，不存在抛 not-found', () => {
  const dir = tmpDir();
  const h = createPostmanHistory({ dir });
  assert.throws(() => h.read('../evil.json'), (e) => e.code === 'bad-id');
  assert.throws(() => h.read('nope.json'), (e) => e.code === 'not-found');
  assert.throws(() => h.write('nope.json', 'x'), (e) => e.code === 'not-found');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/postman-history.test.js"`
Expected: FAIL — `h.read is not a function`

- [ ] **Step 3: 改 `isRecordName` 并新增三个方法**

`server/postman-history.js` 中把：

```javascript
function isRecordName(name) {
  return /^[0-9a-f]{16}\.json$/.test(String(name ?? ''));
}
```

改为：

```javascript
function isRecordName(name) {
  return /^[A-Za-z0-9_.-]+\.json$/.test(String(name ?? ''));
}
```

在 `const setRecordTitle = ...` 之后、`return` 之前插入：

```javascript
  // 文件正文 = curl 命令；标题与最近结果仍留在记录里
  const read = (id) => {
    let file;
    try { file = resolveRecord(id); } catch { const e = new Error('bad id'); e.code = 'bad-id'; throw e; }
    let rec;
    try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { const e = new Error('missing'); e.code = 'not-found'; throw e; }
    return { content: String(rec?.command ?? ''), title: typeof rec?.title === 'string' ? rec.title : '', updatedAt: String(rec?.updatedAt ?? '') };
  };

  const write = (id, content) => {
    let file;
    try { file = resolveRecord(id); } catch { const e = new Error('bad id'); e.code = 'bad-id'; throw e; }
    let rec;
    try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { const e = new Error('missing'); e.code = 'not-found'; throw e; }
    rec.command = String(content ?? '');
    rec.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
    return { size: Buffer.byteLength(rec.command, 'utf8') };
  };

  const createFile = (folder, name) => {
    const rel = normalizeRel(folder);
    const file = String(name ?? '').trim();
    if (!isRecordName(file)) { const e = new Error('bad name'); e.code = 'bad-path'; throw e; }
    const id = rel ? `${rel}/${file}` : file;
    const abs = dirOf(id);
    if (fs.existsSync(abs)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify({ command: '', updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
    return { id };
  };
```

并把这四个加入返回对象：

```javascript
  return { dir, record, list, listFolders, read, write, createFile, remove, createFolder, removeFolder, move, renameFolder, setRecordTitle };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/postman-history.test.js"`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server/postman-history.js server/test/postman-history.test.js
git commit -m "feat(postman): 记录 store 支持读写 curl 正文与时间戳文件"
```

---

## Task 2: postman 文件树适配器 + 注册 postman/navicat 文件目录

**Files:**
- Create: `server/postman-files.js`
- Modify: `server/port-paths.js`, `server/index.js`
- Test: `server/test/postman-files.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/postman-files.test.js`：

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPostmanFiles } from '../postman-files.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-pmf-')); }
const RESULT = { ok: true, code: 0, error: '', timedOut: false, stdout: 'hello', stderr: '' };

test('list：记录映射成文件项，label 优先标题再回退 command 首行', () => {
  const dir = tmpDir();
  const h = createPostmanFiles({ dir });
  const id = '20260921-153012.json';
  h.createFile('foo', id);
  h.write(`foo/${id}`, 'curl https://a.com');
  const { items, folders } = h.list();
  assert.deepEqual(folders, ['foo']);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, `foo/${id}`);
  assert.equal(items[0].folder, 'foo');
  assert.equal(items[0].label, 'curl https://a.com');
});

test('renameItem：改显示标题（文件 id 不变）；removeItem/moveItem 生效', () => {
  const dir = tmpDir();
  const h = createPostmanFiles({ dir });
  const created = h.createFile('', 'a.json');
  h.write(created.id, 'curl A');
  assert.equal(h.renameItem(created.id, 'My A'), created.id);
  assert.equal(h.list().items[0].label, 'My A');
  h.createFolder('d');
  assert.equal(h.moveItem(created.id, 'd'), true);
  assert.equal(h.list().items[0].id, 'd/a.json');
  assert.equal(h.removeItem('d/a.json'), true);
  assert.equal(h.list().items.length, 0);
});

test('createFolder/renameFolder/removeFolder 透传', () => {
  const dir = tmpDir();
  const h = createPostmanFiles({ dir });
  assert.equal(h.createFolder('foo'), 'foo');
  assert.equal(h.renameFolder('foo', 'bar'), 'bar');
  assert.equal(h.removeFolder('bar'), true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/postman-files.test.js"`
Expected: FAIL — Cannot find module `../postman-files.js`

- [ ] **Step 3: 新建 `server/postman-files.js`**

```javascript
import { createPostmanHistory } from './postman-history.js';

// 把 Postman 的 JSON 记录适配成小工具通用文件树接口（与 notepad-store 同形），
// 供 /api/files/postman/* 复用：文件正文 = curl 命令，标题/最近结果仍留在记录里。
export function createPostmanFiles({ dir }) {
  const h = createPostmanHistory({ dir });

  const toItem = (rec) => ({
    id: rec.id,
    folder: rec.folder || '',
    name: rec.name || rec.id,
    label: (typeof rec.title === 'string' && rec.title.trim()) || String(rec.command || '').split('\n')[0],
    updatedAt: rec.updatedAt,
  });

  const list = () => ({ items: h.list().map(toItem), folders: h.listFolders() });
  const listFolders = () => h.listFolders();
  const read = (id) => h.read(id);
  const write = (id, content) => h.write(id, content);
  const createFile = (folder, name) => h.createFile(folder, name);
  const createFolder = (rel) => h.createFolder(rel);
  const removeFolder = (rel) => h.removeFolder(rel);
  const renameFolder = (rel, name) => h.renameFolder(rel, name);
  const renameItem = (id, name) => {
    if (!h.setRecordTitle(id, name)) { const e = new Error('not-found'); e.code = 'not-found'; throw e; }
    return id;
  };
  const removeItem = (id) => h.remove(id);
  const moveItem = (id, folder) => h.move(id, folder);

  return { dir, list, listFolders, read, write, createFile, createFolder, removeFolder, renameFolder, renameItem, removeItem, moveItem };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/postman-files.test.js"`
Expected: 全部 PASS

- [ ] **Step 5: 加 navicat SQL 目录**

`server/port-paths.js` 中，在 `navicatDir: path.join(dir, 'tools', 'navicat'),` 之后加：

```javascript
    navicatSqlDir: path.join(dir, 'tools', 'navicat', 'sql'),
```

并把 `ensurePortDirs` 的数组里 `paths.navicatDir` 改成 `paths.navicatDir, paths.navicatSqlDir`（保持在同一行内追加）。

- [ ] **Step 6: 注册两个 fileStore**

`server/index.js` 顶部 import 区（`createPostmanHistory` 附近）加：

```javascript
import { createPostmanFiles } from './postman-files.js';
```

把 `const fileStores = { ... }` 改为：

```javascript
  const fileStores = {
    notepad: notepadStore,
    yaml: createNotepadStore({ dir: paths.yamlDir }),
    js: createNotepadStore({ dir: paths.jsDir }),
    translate: createNotepadStore({ dir: paths.translateDir }),
    postman: createPostmanFiles({ dir: paths.postmanDir }),
    navicat: createNotepadStore({ dir: paths.navicatSqlDir }),
  };
```

- [ ] **Step 7: 提交**

```bash
git add server/postman-files.js server/test/postman-files.test.js server/port-paths.js server/index.js
git commit -m "feat(tools): postman/navicat 接入通用文件树 store"
```

---

## Task 3: HTTP 测试补 navicat 文件目录

**Files:**
- Test: `server/test/notepad-http.test.js`

- [ ] **Step 1: 写测试**

在 `server/test/notepad-http.test.js` 的 `files：每个 tool 独立目录...` 用例里，把 `stores` 增加 `navicat` 并断言：

```javascript
  const stores = {
    notepad: createNotepadStore({ dir: tmpDir() }),
    yaml: createNotepadStore({ dir: tmpDir() }),
    js: createNotepadStore({ dir: tmpDir() }),
    navicat: createNotepadStore({ dir: tmpDir() }),
  };
  const A = await start(stores);
  t.after(() => A.server.close());
  await call(A.port, 'POST', '/api/files/yaml/file', { folder: '', name: 'a.yaml' });
  const yamlTree = await call(A.port, 'GET', '/api/files/yaml/tree');
  assert.equal(yamlTree.body.items.length, 1);
  const jsTree = await call(A.port, 'GET', '/api/files/js/tree');
  assert.equal(jsTree.body.items.length, 0);

  await call(A.port, 'POST', '/api/files/navicat/file', { folder: '', name: '20260921-153012.sql' });
  const nvTree = await call(A.port, 'GET', '/api/files/navicat/tree');
  assert.equal(nvTree.body.items.length, 1);
  await call(A.port, 'PUT', '/api/files/navicat/file', { id: '20260921-153012.sql', content: 'select 1' });
  const nvFile = await call(A.port, 'GET', '/api/files/navicat/file?id=20260921-153012.sql');
  assert.equal(nvFile.body.content, 'select 1');

  const unknown = await call(A.port, 'GET', '/api/files/nope/tree');
  assert.equal(unknown.status, 404);
```

- [ ] **Step 2: 运行**

Run: `node --test "server/test/notepad-http.test.js"`
Expected: PASS（`/api/files/navicat/*` 由已泛化的 `filesMatch` 路由处理，无需改 `http-api.js`）

- [ ] **Step 3: 提交**

```bash
git add server/test/notepad-http.test.js
git commit -m "test(tools): 覆盖 navicat 文件目录 HTTP 路由"
```

---

## Task 4: 前端 tool 类型与工作台增强

**Files:**
- Modify: `web/src/tools/files/useToolFiles.ts`, `web/src/tools/files/useFileWorkbench.ts`
- Test: `web/src/tools/files/useFileWorkbench.test.ts`（新增）

- [ ] **Step 1: 扩展 `FileTool`**

`web/src/tools/files/useToolFiles.ts`：

```typescript
export type FileTool = 'notepad' | 'yaml' | 'js' | 'translate' | 'postman' | 'navicat';
```

- [ ] **Step 2: 写失败测试**

创建 `web/src/tools/files/useFileWorkbench.test.ts`：

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useFileWorkbench } from './useFileWorkbench';

function okJson(body: unknown) { return { ok: true, json: async () => body }; }
afterEach(() => { vi.unstubAllGlobals(); });

const TREE = { items: [], folders: [] };

describe('useFileWorkbench', () => {
  it('无活动文件时输入不自动建文件；保存才按时间戳建文件并写入', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      calls.push(`${opt?.method || 'GET'} ${u}`);
      if (u.startsWith('/api/files/js/tree')) return okJson(TREE);
      if (u.startsWith('/api/files/js/file') && opt?.method === 'POST') return okJson({ ok: true, id: '20260921-153012.js' });
      return okJson({ ok: true });
    }));
    const w = useFileWorkbench({ tool: 'js', defaultExt: '.js' });
    await w.files.load();
    w.content.value = 'const a = 1;';
    await new Promise((r) => setTimeout(r, 1200));
    expect(calls.some((c) => c.includes('POST') && c.includes('/api/files/js/file'))).toBe(false);
    expect(w.dirty.value).toBe(true);
    await w.flushSave();
    expect(calls).toContain('POST /api/files/js/file');
    expect(calls).toContain('PUT /api/files/js/file');
    expect(w.activeId.value).toBe('20260921-153012.js');
    expect(w.dirty.value).toBe(false);
  });

  it('有活动文件时仍 1 秒防抖自动保存', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      calls.push(`${opt?.method || 'GET'} ${u}`);
      if (u.startsWith('/api/files/js/tree')) return okJson({ items: [{ id: 'a.js', folder: '', name: 'a.js' }], folders: [] });
      return okJson({ content: 'x' });
    }));
    const w = useFileWorkbench({ tool: 'js', defaultExt: '.js' });
    await w.files.load();
    await w.openFile({ id: 'a.js', folder: '', name: 'a.js' });
    w.content.value = 'changed';
    await new Promise((r) => setTimeout(r, 1200));
    expect(calls).toContain('PUT /api/files/js/file');
  });

  it('无活动文件时 newFile 直接按时间戳建空文件并选中', async () => {
    const created: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u.startsWith('/api/files/js/tree')) return okJson(TREE);
      if (u.startsWith('/api/files/js/file') && opt?.method === 'POST') {
        created.push(JSON.parse(opt.body));
        return okJson({ ok: true, id: '20260921-160000.js' });
      }
      return okJson({ ok: true });
    }));
    const w = useFileWorkbench({ tool: 'js', defaultExt: '.js' });
    await w.newFile('sub');
    expect(created[0]).toEqual({ folder: 'sub', name: '20260921-160000.js' });
    expect(w.activeId.value).toBe('20260921-160000.js');
    expect(w.content.value).toBe('');
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npm --prefix web run test -- useFileWorkbench`
Expected: FAIL — `w.files is undefined` / `flushSave` 不建文件

- [ ] **Step 4: 重写 `useFileWorkbench.ts`**

用以下内容整体替换 `web/src/tools/files/useFileWorkbench.ts`：

```typescript
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n';
import { useToolFiles, type FileTool } from './useToolFiles';
import type { FileItem, FileTreeActions } from '../../fileTree';

const SAVE_DELAY = 1000;

// 左侧文件树的通用「打开 / 新建 / 自动保存」逻辑：
// 编辑器始终可编辑；无活动文件时输入不自动建文件，点保存/Ctrl+S 才按时间戳建文件。
export function useFileWorkbench(opts: { tool: FileTool; defaultExt: string }) {
  const files = useToolFiles(opts.tool);
  const activeId = ref('');
  const activeFolder = ref('');
  const content = ref('');
  const dirty = ref(false);
  const msg = ref('');
  const saving = ref(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let loading = false;

  function leaf(id: string) { return id.slice(id.lastIndexOf('/') + 1); }

  const title = computed(() => {
    const base = activeId.value ? leaf(activeId.value) : t('files.untitled');
    return dirty.value ? `${base} *` : base;
  });

  const actions: FileTreeActions = {
    createFolder: (parent, name) => files.createFolder(parent, name),
    renameFolder: (path, name) => files.renameFolder(path, name),
    removeFolder: (path) => files.removeFolder(path),
    renameItem: async (id, name) => {
      const r = await files.renameItem(id, name);
      if (r.ok && activeId.value === id) activeId.value = id.includes('/') ? `${id.slice(0, id.lastIndexOf('/'))}/${name}` : name;
      return r;
    },
    removeItem: async (id) => {
      const r = await files.removeItem(id);
      if (r.ok && activeId.value === id) { activeId.value = ''; content.value = ''; dirty.value = false; }
      return r;
    },
    moveItem: (id, folder) => files.moveItem(id, folder),
  };

  async function openFile(item: FileItem) {
    if (dirty.value && activeId.value) await flushSave();
    try {
      const text = await files.read(item.id);
      loading = true;
      content.value = text;
      loading = false;
      activeId.value = item.id;
      dirty.value = false;
      msg.value = '';
    } catch (e) { msg.value = t('files.open_failed', { msg: (e as Error)?.message || String(e) }); }
  }

  // 未命名时的默认文件名：当前日期+时间（如 20260920-153012.txt）
  function stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  async function newFile(folder = activeFolder.value) {
    try {
      const id = await files.createFile(folder, `${stamp()}${opts.defaultExt}`);
      activeId.value = id;
      activeFolder.value = folder;
      loading = true;
      content.value = '';
      loading = false;
      dirty.value = false;
      msg.value = '';
    } catch (e) { msg.value = t('files.save_failed', { msg: (e as Error)?.message || String(e) }); }
  }

  async function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!activeId.value) {
      if (!content.value) return;
      saving.value = true;
      try {
        const id = await files.createFile(activeFolder.value, `${stamp()}${opts.defaultExt}`);
        activeId.value = id;
        await files.save(id, content.value);
        dirty.value = false;
        msg.value = t('files.saved');
      } catch (e) { msg.value = t('files.save_failed', { msg: (e as Error)?.message || String(e) }); }
      finally { saving.value = false; }
      return;
    }
    if (!dirty.value) return;
    saving.value = true;
    try {
      await files.save(activeId.value, content.value);
      dirty.value = false;
      msg.value = t('files.saved');
    } catch (e) { msg.value = t('files.save_failed', { msg: (e as Error)?.message || String(e) }); }
    finally { saving.value = false; }
  }

  watch(content, () => {
    if (loading) return;
    dirty.value = true;
    msg.value = '';
    if (!activeId.value) return;   // 无活动文件：不自动建文件
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; void flushSave(); }, SAVE_DELAY);
  });

  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flushSave(); }
  }
  function refresh() { return files.load(); }
  onMounted(() => { void files.load(); document.addEventListener('keydown', onKeydown); });
  onBeforeUnmount(() => { document.removeEventListener('keydown', onKeydown); if (saveTimer) clearTimeout(saveTimer); });

  return {
    files, folders: files.folders, items: files.items, activeId, activeFolder, content, dirty, msg, saving,
    title, actions, openFile, newFile, flushSave, refresh,
  };
}
```

> 说明：新增返回 `files`（供 PostmanTool 复用读文件）与 `refresh`；`scheduleSave` 不再对外暴露。

- [ ] **Step 5: 运行确认通过**

Run: `npm --prefix web run test -- useFileWorkbench`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add web/src/tools/files/useToolFiles.ts web/src/tools/files/useFileWorkbench.ts web/src/tools/files/useFileWorkbench.test.ts
git commit -m "feat(tools): 工作台始终可编辑，无文件保存即时间戳建文件"
```

---

## Task 5: ItemTree 标题栏 + 去根行 + 菜单扩充

**Files:**
- Modify: `web/src/components/ItemTree.vue`
- Delete: `web/src/components/FileSidebar.vue`

- [ ] **Step 1: 改 props/emits 与脚本逻辑**

`web/src/components/ItemTree.vue`：

props 增加 `title?: string`：

```typescript
const props = defineProps<{
  folders: string[];
  items: FileItem[];
  activeFolder: string;
  activeId: string;
  actions: FileTreeActions;
  storageKey: string;
  statuses?: Record<string, 'pass' | 'fail'>;
  showRun?: boolean;
  title?: string;
}>();
```

emits 增加 `new-file` 与 `refresh`：

```typescript
const emit = defineEmits<{
  (e: 'select-folder', path: string): void;
  (e: 'select-item', item: FileItem): void;
  (e: 'run-folder', path: string): void;
  (e: 'run-item', item: FileItem): void;
  (e: 'new-file', folder: string): void;
  (e: 'refresh'): void;
}>();
```

`Menu` 类型增加 root 分支：

```typescript
type Menu =
  | { kind: 'root'; x: number; y: number }
  | { kind: 'folder'; path: string; x: number; y: number }
  | { kind: 'item'; item: FileItem; x: number; y: number };
```

在 `closeMenu` 附近加：

```typescript
function openMenuRoot(e: MouseEvent) { menu.value = { kind: 'root', x: e.clientX, y: e.clientY }; }
function selectRoot() { emit('select-folder', ''); }
function menuNewFile() {
  const m = menu.value;
  if (!m || m.kind === 'item') return;
  const folder = m.kind === 'folder' ? m.path : '';
  menu.value = null;
  emit('new-file', folder);
}
async function copyText(s: string) {
  try { await navigator.clipboard.writeText(s); } catch { /* ignore */ }
}
function menuCopyName() {
  const m = menu.value;
  if (!m) return;
  if (m.kind === 'folder') void copyText(m.path.slice(m.path.lastIndexOf('/') + 1));
  else if (m.kind === 'item') void copyText(itemLabel(m.item));
  menu.value = null;
}
function menuCopyPath() {
  const m = menu.value;
  menu.value = null;
  if (m?.kind === 'folder') void copyText(m.path);
  else if (m?.kind === 'item') void copyText(m.item.id);
}
```

`menuNew` 需要兼容 root：

```typescript
function menuNew() {
  const m = menu.value;
  if (!m) return;
  if (m.kind === 'root') startNew('');
  else if (m.kind === 'folder') startNew(m.path);
}
```

`menuRename` / `menuDelete` 加 root 保护：

```typescript
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
```

- [ ] **Step 2: 改模板：加标题栏、删根行、容器根选中**

把 `<template>` 里的 `.ftroot` 整块删除，并在 `.fttree` 开头插入标题栏：

```html
  <div class="fttree">
    <div v-if="title !== undefined" class="fthead">
      <span class="fttitle" @click="selectRoot">{{ title }}</span>
      <div class="ftheadacts">
        <button class="ftic" :title="$t('tree.refresh')" @click="emit('refresh')">⟳</button>
        <button class="ftic ftnewfile" :title="$t('tree.new_file')" @click="emit('new-file', activeFolder)">📄＋</button>
        <button class="ftic ftnewdir" :title="$t('tree.new_dir')" @click="startNew(activeFolder)">📁＋</button>
      </div>
    </div>

    <div v-if="!rows.length" class="ftempty" @click="selectRoot" @contextmenu.prevent="openMenuRoot($event)">{{ $t('tree.empty') }}</div>
    <ul v-else class="ftlist" @click.self="selectRoot" @contextmenu.prevent.self="openMenuRoot($event)"
        @dragover.prevent @drop.prevent="onDrop('')">
```

（`<ul>` 内 `<li>` 部分保持原样。）

- [ ] **Step 3: 菜单模板扩充**

把 `.ftmenu` 块替换为：

```html
    <div v-if="menu" class="ftmenu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop>
      <button v-if="menu.kind !== 'item'" class="ftmenuitem ftmenu-newfile" @click="menuNewFile">{{ $t('tree.ctx.new_file') }}</button>
      <button v-if="menu.kind !== 'item'" class="ftmenuitem ftmenu-new" @click="menuNew">{{ $t('tree.ctx.new_dir') }}</button>
      <button v-if="menu.kind !== 'root'" class="ftmenuitem ftmenu-rename" @click="menuRename">{{ $t('tree.rename') }}</button>
      <button v-if="menu.kind !== 'root'" class="ftmenuitem ftmenu-del" @click="menuDelete">{{ $t('tree.delete') }}</button>
      <button v-if="menu.kind !== 'root'" class="ftmenuitem ftmenu-copy" @click="menuCopyName">
        {{ menu.kind === 'folder' ? $t('tree.copy_dir_name') : $t('tree.copy_file_name') }}
      </button>
      <button v-if="menu.kind === 'item' || menu.kind === 'folder'" class="ftmenuitem ftmenu-copypath" @click="menuCopyPath">{{ $t('tree.copy_path') }}</button>
    </div>
```

- [ ] **Step 4: 样式对齐首页**

`.fttree` 增加 `font-family: ui-monospace, Consolas, monospace;`（与首页 `.ft` 一致），并新增标题栏样式：

```css
.fthead { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 6px; flex: none; }
.fttitle { color: var(--tx3); text-transform: uppercase; font-size: 11px; cursor: pointer; }
.fttitle:hover { color: var(--ac2); }
.ftheadacts { display: flex; gap: 4px; }
.ftic { background: none; border: 1px solid transparent; color: var(--tx3); font-size: 12px; cursor: pointer; padding: 1px 5px; border-radius: 4px; }
.ftic:hover { background: var(--bg5); color: var(--tx1); border-color: var(--bd); }
```

- [ ] **Step 5: 删除 `FileSidebar.vue`**

```bash
git rm web/src/components/FileSidebar.vue
```

- [ ] **Step 6: 类型检查**

Run: `npm --prefix web run typecheck`
Expected: 仅剩未接线的工具（Task 7/8/9 之前的 `FileSidebar` 引用）报错；其余无错。若 `NotepadTool.vue`/`TextToolBody.vue` 报找不到 `FileSidebar`，属预期，Task 7 修复。

- [ ] **Step 7: 提交**

```bash
git add web/src/components/ItemTree.vue
git commit -m "feat(tools): ItemTree 增加标题栏/右键菜单，外观对齐首页文件树"
```

---

## Task 6: ItemTree 测试迁移

**Files:**
- Create: `web/src/components/ItemTree.test.ts`
- Modify: `web/src/tools/postman/PostmanTree.vue`
- Delete: `web/src/tools/postman/PostmanTree.test.ts`

- [ ] **Step 1: 新建 `ItemTree.test.ts`**

把 `web/src/tools/postman/PostmanTree.test.ts` 的内容迁移为直接挂载 `ItemTree`：`records: [REC(id, cmd, folder)]` 改为 `items: [{ id, folder, name: id, label: cmd }]`；`actions()` 的 `renameRecord` 改为 `renameItem`；`.ftroot .ftnew` 改为 `.fthead .ftnewdir`；把"记录显示标题优先于 command"用例改为断言 `label` 生效。完整文件：

```typescript
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import ItemTree from './ItemTree.vue';

function actions(overrides: Record<string, unknown> = {}) {
  return {
    createFolder: vi.fn(async () => ({ ok: true })),
    renameFolder: vi.fn(async () => ({ ok: true })),
    removeFolder: vi.fn(async () => ({ ok: true })),
    renameItem: vi.fn(async () => ({ ok: true })),
    removeItem: vi.fn(async () => ({ ok: true })),
    moveItem: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function mount(props: Record<string, unknown> = {}) {
  return mountC(ItemTree, {
    props: { folders: [], items: [], activeFolder: '', activeId: '', actions: actions(), storageKey: 'df-test-collapsed', title: 'Files', ...props },
  });
}

const IT = (id: string, label: string, folder = '') => ({ id, folder, name: id, label });

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('ItemTree', () => {
  it('默认全展开：文件夹及其文件都可见', () => {
    const w = mount({ folders: ['foo'], items: [IT('foo/a.json', 'curl A', 'foo')] });
    expect(w.text()).toContain('foo');
    expect(w.text()).toContain('curl A');
  });

  it('点箭头折叠后文件隐藏，并写入 localStorage', async () => {
    const w = mount({ folders: ['foo'], items: [IT('foo/a.json', 'curl A', 'foo')] });
    await w.find('.ftchev:not(.invisible)').trigger('click');
    expect(w.text()).not.toContain('curl A');
    expect(JSON.parse(localStorage.getItem('df-test-collapsed') || '[]')).toEqual(['foo']);
  });

  it('localStorage 里的折叠状态在挂载时生效', () => {
    localStorage.setItem('df-test-collapsed', JSON.stringify(['foo']));
    const w = mount({ folders: ['foo'], items: [IT('foo/a.json', 'curl A', 'foo')] });
    expect(w.text()).not.toContain('curl A');
  });

  it('双击文件夹名切换展开/折叠', async () => {
    const w = mount({ folders: ['foo'], items: [IT('foo/a.json', 'curl A', 'foo')] });
    await w.find('.ftrow.folder .ftname').trigger('dblclick');
    expect(w.text()).not.toContain('curl A');
  });

  it('单击文件夹/文件发出 select 事件', async () => {
    const w = mount({ folders: ['foo'], items: [IT('a.json', 'curl A', '')] });
    await w.find('.ftrow.folder .ftname').trigger('click');
    expect(w.emitted('select-folder')?.[0]).toEqual(['foo']);
    await w.find('.ftrow.item .ftname').trigger('click');
    expect(w.emitted('select-item')?.[0]?.[0]).toMatchObject({ id: 'a.json' });
  });

  it('标题栏 ＋ 新建文件：发出 new-file(folder)', async () => {
    const w = mount({ folders: ['foo'], activeFolder: 'foo' });
    await w.find('.fthead .ftnewfile').trigger('click');
    expect(w.emitted('new-file')?.[0]).toEqual(['foo']);
  });

  it('标题栏 📁＋ 新建文件夹：Enter 调 actions.createFolder(activeFolder, name)', async () => {
    const a = actions();
    const w = mount({ actions: a, activeFolder: 'foo' });
    await w.find('.fthead .ftnewdir').trigger('click');
    const input = w.find('.ftedit');
    expect(input.exists()).toBe(true);
    await input.setValue('bar');
    await input.trigger('keydown.enter');
    await nextTick();
    expect(a.createFolder).toHaveBeenCalledWith('foo', 'bar');
    expect(w.find('.ftedit').exists()).toBe(false);
  });

  it('标题栏 ⟳ 发出 refresh', async () => {
    const w = mount();
    await w.find('.fthead .ftic').trigger('click');
    expect(w.emitted('refresh')).toBeTruthy();
  });

  it('执行按钮：文件发出 run-item，文件夹发出 run-folder', async () => {
    const w = mount({ folders: ['foo'], items: [IT('foo/a.json', 'curl A', 'foo')] });
    await w.find('.ftrow.item .ftexec').trigger('click');
    expect(w.emitted('run-item')?.[0]?.[0]).toMatchObject({ id: 'foo/a.json' });
    await w.find('.ftrow.folder .ftexec').trigger('click');
    expect(w.emitted('run-folder')?.[0]).toEqual(['foo']);
  });

  it('statuses 渲染通过/未通过圆圈', () => {
    const w = mount({
      folders: ['foo'],
      items: [IT('foo/a.json', 'curl A', 'foo'), IT('foo/b.json', 'curl B', 'foo')],
      statuses: { 'foo/a.json': 'pass', 'foo/b.json': 'fail' },
    });
    expect(w.findAll('.ftstatus.pass').length).toBe(1);
    expect(w.findAll('.ftstatus.fail').length).toBe(1);
  });

  it('右键文件夹出现菜单，菜单可删除', async () => {
    const a = actions();
    const w = mount({ actions: a, folders: ['foo'] });
    await w.find('.ftrow.folder').trigger('contextmenu');
    expect(w.find('.ftmenu').exists()).toBe(true);
    await w.find('.ftmenu-del').trigger('click');
    await nextTick();
    expect(a.removeFolder).toHaveBeenCalledWith('foo');
  });

  it('右键菜单「新建文件」发出 new-file(path)', async () => {
    const w = mount({ folders: ['foo'] });
    await w.find('.ftrow.folder').trigger('contextmenu');
    await w.find('.ftmenu-newfile').trigger('click');
    expect(w.emitted('new-file')?.[0]).toEqual(['foo']);
  });

  it('右键文件「复制名称」写入剪贴板', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const w = mount({ items: [IT('a.json', 'My A', '')] });
    await w.find('.ftrow.item').trigger('contextmenu');
    await w.find('.ftmenu-copy').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('My A');
  });

  it('label 优先于 name 显示', () => {
    const w = mount({ items: [IT('a.json', 'My A', ''), { id: 'b.json', folder: '', name: 'b.json' }] });
    expect(w.text()).toContain('My A');
    expect(w.text()).toContain('b.json');
  });
});
```

- [ ] **Step 2: 删除旧测试并运行**

```bash
git rm web/src/tools/postman/PostmanTree.test.ts
```

Run: `npm --prefix web run test -- ItemTree`
Expected: 全部 PASS

- [ ] **Step 3: `PostmanTree.vue` 改为接收 `items` 的薄封装**

用以下内容整体替换 `web/src/tools/postman/PostmanTree.vue`：

```vue
<script setup lang="ts">
import ItemTree from '../../components/ItemTree.vue';
import type { FileItem, FileTreeActions } from '../../fileTree';

defineProps<{
  folders: string[];
  items: FileItem[];
  activeFolder: string;
  activeId: string;
  actions: FileTreeActions;
  statuses?: Record<string, 'pass' | 'fail'>;
  title: string;
}>();
const emit = defineEmits<{
  (e: 'select-folder', path: string): void;
  (e: 'select-item', item: FileItem): void;
  (e: 'run-folder', path: string): void;
  (e: 'run-item', item: FileItem): void;
  (e: 'new-file', folder: string): void;
  (e: 'refresh'): void;
}>();
</script>

<template>
  <ItemTree
    :folders="folders"
    :items="items"
    :active-folder="activeFolder"
    :active-id="activeId"
    :actions="actions"
    :statuses="statuses"
    :title="title"
    storage-key="devflow-postman-collapsed"
    show-run
    @select-folder="emit('select-folder', $event)"
    @select-item="emit('select-item', $event)"
    @run-folder="emit('run-folder', $event)"
    @run-item="emit('run-item', $event)"
    @new-file="emit('new-file', $event)"
    @refresh="emit('refresh')"
  />
</template>
```

- [ ] **Step 4: 运行构建类型检查**

Run: `npm --prefix web run typecheck`
Expected: 仍只剩 Task 7/8/9 的未接线报错。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/ItemTree.test.ts web/src/tools/postman/PostmanTree.vue
git commit -m "test(tools): ItemTree 独立测试，PostmanTree 改为薄封装"
```

---

## Task 7: 记事本与文本工具接入新工作台

**Files:**
- Modify: `web/src/tools/notepad/NotepadTool.vue`, `web/src/tools/text/TextToolBody.vue`
- Test: `web/src/tools/notepad/NotepadTool.test.ts`, `web/src/components/MiniTools.test.ts`

- [ ] **Step 1: 改 `NotepadTool.vue`**

script 里把 `useFileWorkbench` 解构改为（新增 `refresh`）：

```typescript
const {
  folders, items, activeId, activeFolder, content, saving, msg, title,
  actions, openFile, newFile, flushSave, refresh,
} = useFileWorkbench({ tool: 'notepad', defaultExt: '.txt' });
```

删除 `import FileSidebar from '../../components/FileSidebar.vue';`，改 `import ItemTree from '../../components/ItemTree.vue';`。

模板里把 `<FileSidebar ... />` 替换为：

```html
    <aside class="npside">
      <ItemTree
        :folders="folders"
        :items="items"
        :active-folder="activeFolder"
        :active-id="activeId"
        :actions="actions"
        storage-key="devflow-notepad-collapsed"
        :title="$t('tools.notepad')"
        @select-folder="selectFolder"
        @select-item="openItem"
        @new-file="newFile"
        @refresh="refresh"
      />
    </aside>
```

`selectFolder` 保留；`openItem` 保留。

把编辑器的 `:disabled="!activeId"` 去掉：

```html
      <CodeEditor v-model="content" class="nparea" :language="activeId" :placeholder="$t('files.no_file')" />
```

把标题显示由 `{{ title || $t('files.no_file') }}` 改为 `{{ title }}`。

`.npside` 样式复用原 `FileSidebar` 的容器样式：

```css
.npside { width: 280px; flex: none; display: flex; flex-direction: column; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); overflow: hidden; padding: 6px; box-sizing: border-box; }
```

- [ ] **Step 2: 改 `TextToolBody.vue`**

script：

```typescript
import ItemTree from '../../components/ItemTree.vue';
// 删除：import FileSidebar from '../../components/FileSidebar.vue';

const {
  folders, items, activeId, activeFolder, content, saving, msg, title, actions,
  openFile, newFile, flushSave, refresh,
} = useFileWorkbench({ tool: props.tool, defaultExt: EXT[props.tool] });
```

模板里 `<FileSidebar ... />` 替换为：

```html
    <aside class="ttside">
      <ItemTree
        :folders="folders"
        :items="items"
        :active-folder="activeFolder"
        :active-id="activeId"
        :actions="actions"
        :storage-key="sidebarKey"
        :title="$t(LABEL[tool])"
        @select-folder="selectFolder"
        @select-item="openItem"
        @new-file="newFile"
        @refresh="refresh"
      />
    </aside>
```

标题行由 `{{ title || $t('files.no_file') }}` 改为 `{{ title }}`；`.ttbody` 下新增 `.ttside` 容器样式（与 `.npside` 相同）：

```css
.ttside { width: 280px; flex: none; display: flex; flex-direction: column; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); overflow: hidden; padding: 6px; box-sizing: border-box; }
```

- [ ] **Step 3: 更新测试**

`web/src/tools/notepad/NotepadTool.test.ts` 增补一个「无文件时保存生成时间戳文件」用例：

```typescript
  it('无活动文件时编辑后保存，按时间戳新建文件', async () => {
    const posts: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u.startsWith('/api/files/notepad/tree')) return okJson({ items: [], folders: [] });
      if (u.startsWith('/api/files/notepad/file') && opt?.method === 'POST') { posts.push(JSON.parse(opt.body)); return okJson({ ok: true, id: '20260921-170000.txt' }); }
      return okJson({ ok: true });
    }));
    const w = mountC(NotepadTool);
    await flushPromises();
    w.findComponent(CodeEditor).vm.$emit('update:modelValue', 'hello');
    await w.findAll('.npbtn')[0].trigger('click');   // 保存
    await flushPromises();
    expect(posts[0].name).toMatch(/^\d{8}-\d{6}\.txt$/);
  });
```

- [ ] **Step 4: 运行**

Run: `npm --prefix web run test -- NotepadTool MiniTools`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/notepad/NotepadTool.vue web/src/tools/text/TextToolBody.vue web/src/tools/notepad/NotepadTool.test.ts
git commit -m "feat(tools): 记事本/文本工具接入新工作台（始终可编辑）"
```

---

## Task 8: Postman 接入新工作台

**Files:**
- Modify: `web/src/tools/postman/PostmanTool.vue`
- Test: `web/src/tools/postman/PostmanTool.test.ts`

- [ ] **Step 1: 改 `PostmanTool.vue`**

script `<script setup>` 改为（保留原有结果展示相关逻辑，替换树与编辑器部分）：

```typescript
import { computed, onMounted, ref } from 'vue';
import { t } from '../../i18n';
import { usePostmanHistory, type CurlResult } from './usePostmanHistory';
import { useFileWorkbench } from '../files/useFileWorkbench';
import PostmanTree from './PostmanTree.vue';
import CodeEditor from '../../components/CodeEditor.vue';
import type { FileItem } from '../../fileTree';

const ph = usePostmanHistory();
const {
  folders, items, activeId, activeFolder, content: curlCmd, msg: fileMsg, saving,
  title, actions, openFile, newFile, flushSave, refresh,
} = useFileWorkbench({ tool: 'postman', defaultExt: '.json' });

const respHeaders = ref('');
const respBody = ref('');
const respStderr = ref('');
const status = ref(0);
const failed = ref(false);
const busy = ref(false);
const msg = ref('');
const copied = ref(false);
const runStatus = ref<Record<string, 'pass' | 'fail'>>({});
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const hasOutput = computed(() => !!(respHeaders.value || respBody.value || respStderr.value));
const respState = computed(() => {
  if (status.value >= 400) return 'err';
  if (status.value >= 200 && status.value < 300) return 'ok';
  if (status.value > 0) return 'neutral';
  return failed.value ? 'warn' : 'neutral';
});
const message = computed(() => msg.value || fileMsg.value);

// 运行会新增/更新记录：树（files）与记录（ph）都刷新
async function reload() { await Promise.all([refresh(), ph.load()]); }

function commandOf(id: string) { return ph.history.value.find((r) => r.id === id)?.command || ''; }

function clearResult() { respHeaders.value = ''; respBody.value = ''; respStderr.value = ''; status.value = 0; failed.value = false; }

function selectFolder(path: string) { activeFolder.value = path; }
function onSelectItem(item: FileItem) { clearResult(); msg.value = ''; void openFile(item); }

function setStatus(id: string, pass: boolean) { runStatus.value = { ...runStatus.value, [id]: pass ? 'pass' : 'fail' }; }
function clearStatuses(ids: string[]) {
  const next = { ...runStatus.value };
  for (const id of ids) delete next[id];
  runStatus.value = next;
}
function isPass(j: CurlResult) { return !!j.ok && !j.error && !j.timedOut && (Number(j.status) || 0) < 400; }

async function execCurl(command: string, folder: string): Promise<CurlResult> {
  const j = await ph.runCurl(command, folder);
  status.value = Number(j.status) || 0;
  respHeaders.value = j.headers ?? '';
  respBody.value = j.body ?? j.stdout ?? '';
  respStderr.value = j.stderr ?? '';
  failed.value = !j.ok || !!j.error || (status.value === 0 && j.code !== 0);
  msg.value = j.timedOut ? t('tools.pm_timeout') : t('tools.pm_exit', { code: j.code });
  await reload();
  return j;
}

async function runCurlCmd() {
  if (busy.value) return;
  if (!curlCmd.value.trim()) { msg.value = t('et.empty'); return; }
  busy.value = true; msg.value = ''; clearResult();
  try { await execCurl(curlCmd.value, activeFolder.value); }
  catch (e) { failed.value = true; msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) }); }
  finally { busy.value = false; }
}

async function runItem(item: FileItem) {
  if (busy.value) return;
  const command = commandOf(item.id);
  if (!command) return;
  await openFile(item);
  busy.value = true; msg.value = ''; clearResult();
  try { setStatus(item.id, isPass(await execCurl(command, item.folder || ''))); }
  catch (e) { setStatus(item.id, false); failed.value = true; msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) }); }
  finally { busy.value = false; }
}

function folderItems(path: string) {
  return items.value.filter((r) => { const f = r.folder || ''; return f === path || f.startsWith(`${path}/`); });
}

async function runFolder(path: string) {
  if (busy.value) return;
  const list = folderItems(path);
  if (!list.length) { msg.value = t('tools.pm_folder_empty'); return; }
  clearStatuses(list.map((r) => r.id));
  busy.value = true; msg.value = ''; clearResult();
  try {
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i];
      activeId.value = r.id;
      msg.value = t('tools.pm_run_progress', { i: i + 1, total: list.length });
      setStatus(r.id, isPass(await execCurl(commandOf(r.id), r.folder || '')));
    }
    msg.value = t('tools.pm_run_done', { n: list.length });
  } catch (e) { failed.value = true; msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) }); }
  finally { busy.value = false; }
}

function allOutput() {
  const parts: string[] = [];
  if (respHeaders.value) parts.push(respHeaders.value);
  if (respBody.value) parts.push(respBody.value);
  if (respStderr.value) parts.push(respStderr.value);
  return parts.join('\n');
}

async function copyOut() {
  if (!hasOutput.value) return;
  const text = allOutput();
  try { await navigator.clipboard.writeText(text); }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
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

onMounted(() => { void ph.load(); });
```

模板左侧替换为：

```html
    <aside class="pmside">
      <PostmanTree
        :folders="folders"
        :items="items"
        :active-folder="activeFolder"
        :active-id="activeId"
        :actions="actions"
        :statuses="runStatus"
        :title="$t('tools.pm_history')"
        @select-folder="selectFolder"
        @select-item="onSelectItem"
        @run-folder="runFolder"
        @run-item="runItem"
        @new-file="newFile"
        @refresh="reload"
      />
    </aside>
```

顶部工具条改为：

```html
      <div class="pmactsbar">
        <span class="pmtitle">{{ title }}</span>
        <button class="pmbtn" :disabled="!activeId || saving" @click="flushSave">{{ $t('files.save') }}</button>
        <button class="pmbtn primary pmrun" :disabled="busy" @click="runCurlCmd">{{ busy ? $t('tools.pm_running') : $t('tools.run') }}</button>
        <button class="pmbtn" @click="curlCmd = ''; clearResult(); msg = ''">{{ $t('tools.clear') }}</button>
        <span class="pmsave">{{ $t('tools.pm_saveto', { path: saveTo }) }}</span>
      </div>
```

`saveTo` 计算属性保留（用 `activeFolder`）。`v-if="message"` 替换 `v-if="msg"`：

```html
      <div v-if="message" class="pmmsg">{{ message }}</div>
```

删除原 `.pmsidehead`/`.pmsidetitle` 相关模板块与对应样式；`.pmside` 容器样式保留；新增 `.pmtitle { flex: 1; min-width: 0; color: var(--tx2); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`。

- [ ] **Step 2: 更新 `PostmanTool.test.ts`**

把「新建文件夹后点刷新仍存在」用例改为走 `/api/files/postman/folder` 与标题栏按钮：

```typescript
  it('新建文件夹后点刷新仍存在', async () => {
    const folders: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u === '/api/postman/history' && (!opt || !opt.method || opt.method === 'GET')) return okJson({ items: [], folders: [] });
      if (u.startsWith('/api/files/postman/tree')) return okJson({ items: [], folders });
      if (u === '/api/files/postman/folder') { folders.push(JSON.parse(opt.body).path); return okJson({ ok: true }); }
      return okJson({});
    }));
    const w = mountC(PostmanTool);
    await flushPromises();
    await w.find('.fthead .ftnewdir').trigger('click');
    await w.find('.ftedit').setValue('bar');
    await w.find('.ftedit').trigger('keydown.enter');
    await flushPromises();
    expect(w.text()).toContain('bar');
    await w.find('.fthead .ftic').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('bar');
  });
```

「文件夹执行」「点击记录载入命令」用例把 `/api/postman/history` 返回的记录同时喂给 `/api/files/postman/tree`（加 `label`），并把 `.ftrow.item .ftname` 点击改为触发 `/api/files/postman/file?id=` 读取命令：

```typescript
  it('文件夹执行：逐条运行并标出通过/未通过', async () => {
    const records = [
      { id: 'foo/a.json', command: 'curl A', folder: 'foo', result: {}, updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'foo/b.json', command: 'curl B', folder: 'foo', result: {}, updatedAt: '2026-09-02T00:00:00.000Z' },
    ];
    const items = records.map((r) => ({ id: r.id, folder: r.folder, name: r.id, label: r.command, updatedAt: r.updatedAt }));
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u === '/api/postman/history') return okJson({ items: records, folders: ['foo'] });
      if (u.startsWith('/api/files/postman/tree')) return okJson({ items, folders: ['foo'] });
      if (u.startsWith('/api/files/postman/file?id=')) return okJson({ content: 'curl A' });
      if (u === '/api/curl') {
        const b = JSON.parse(opt.body);
        calls.push(b.command);
        return okJson({ ok: true, code: 0, status: b.command === 'curl A' ? 200 : 500, headers: '', body: '', stdout: '', stderr: '', timedOut: false });
      }
      return okJson({});
    }));
    const w = mountC(PostmanTool);
    await flushPromises();
    await w.find('.ftrow.folder .ftexec').trigger('click');
    await flushPromises();
    expect(calls).toEqual(['curl A', 'curl B']);
    expect(w.findAll('.ftstatus.pass').length).toBe(1);
    expect(w.findAll('.ftstatus.fail').length).toBe(1);
  });
```

「点击记录载入命令」：

```typescript
  it('点击记录载入命令', async () => {
    const rec = { id: 'a.json', command: 'curl old', folder: '', result: {}, updatedAt: '2026-09-01T00:00:00.000Z' };
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u === '/api/postman/history') return okJson({ items: [rec], folders: [] });
      if (u.startsWith('/api/files/postman/tree')) return okJson({ items: [{ id: 'a.json', folder: '', name: 'a.json', label: 'curl old' }], folders: [] });
      if (u.startsWith('/api/files/postman/file?id=')) return okJson({ content: 'curl old' });
      return okJson({});
    }));
    const w = mountC(PostmanTool);
    await flushPromises();
    await w.find('.ftrow.item .ftname').trigger('click');
    await flushPromises();
    expect(cmdOf(w)).toBe('curl old');
  });
```

其余用例只需在 fetch stub 中为 `/api/files/postman/tree` 返回 `{ items: [], folders: [] }`（在 final `return okJson(result)` 之前加一行 `if (u.startsWith('/api/files/postman/tree')) return okJson({ items: [], folders: [] });`）。

- [ ] **Step 3: 运行**

Run: `npm --prefix web run test -- Postman`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add web/src/tools/postman/PostmanTool.vue web/src/tools/postman/PostmanTool.test.ts
git commit -m "feat(postman): 接入统一文件工作台，树即文件、保存即时间戳"
```

---

## Task 9: Navicat 接入新工作台

**Files:**
- Modify: `web/src/tools/navicat/NavicatTree.vue`, `web/src/tools/navicat/NavicatTool.vue`
- Test: `web/src/tools/navicat/NavicatTool.test.ts`

- [ ] **Step 1: `NavicatTree.vue` 增加文件分组**

props 增加：

```typescript
import ItemTree from '../../components/ItemTree.vue';
import type { FileItem, FileTreeActions } from '../../fileTree';
// ...
  fileFolders: string[];
  fileItems: FileItem[];
  activeFileFolder: string;
  activeFileId: string;
  fileActions: FileTreeActions;
```

emits 增加：

```typescript
  (e: 'select-file-folder', path: string): void;
  (e: 'select-file', item: FileItem): void;
  (e: 'new-file', folder: string): void;
  (e: 'refresh-files'): void;
```

模板顶部加「连接」分组标题，底部加「文件」分组：

```html
  <div class="nvtree">
    <div class="nvgroup">{{ $t('nv.conn_group') }}</div>
    <!-- ...原有 profiles 循环保持不变... -->
    <div v-if="!profiles.length" class="nvempty">{{ $t('nv.empty') }}</div>

    <div class="nvfilegroup">
      <ItemTree
        :folders="fileFolders"
        :items="fileItems"
        :active-folder="activeFileFolder"
        :active-id="activeFileId"
        :actions="fileActions"
        storage-key="devflow-navicat-collapsed"
        :title="$t('nv.file_group')"
        @select-folder="emit('select-file-folder', $event)"
        @select-item="emit('select-file', $event)"
        @new-file="emit('new-file', $event)"
        @refresh="emit('refresh-files')"
      />
    </div>
  </div>
```

样式新增：

```css
.nvgroup { padding: 4px 6px 2px; color: var(--tx3); text-transform: uppercase; font-size: 11px; }
.nvfilegroup { margin-top: 8px; border-top: 1px solid var(--bd); padding-top: 6px; display: flex; flex-direction: column; min-height: 120px; }
```

- [ ] **Step 2: `NavicatTool.vue` 接入工作台**

script 增加：

```typescript
import { useFileWorkbench } from '../files/useFileWorkbench';
import type { FileItem } from '../../fileTree';

const {
  folders: fileFolders, items: fileItems, activeId: activeFileId, activeFolder: activeFileFolder,
  content: sql, saving: fileSaving, msg: fileMsg, title: fileTitle,
  actions: fileActions, openFile: openFileItem, newFile: newFileItem, flushSave: flushSql, refresh: refreshFiles,
} = useFileWorkbench({ tool: 'navicat', defaultExt: '.sql' });

function onSelectFileFolder(p: string) { activeFileFolder.value = p; }
function onSelectSqlFile(it: FileItem) { void openFileItem(it); }
function onNewSqlFile(f: string) { void newFileItem(f); }
function onRefreshFiles() { void refreshFiles(); }
```

删除原 `const sql = ref('');`，并把模板里 `<CodeEditor v-model="sql" .../>` 保留（`sql` 现在来自工作台）。`doExec` 中 `sql.value` 不变。

模板 `NavicatTree` 增加传入与监听：

```html
      <NavicatTree
        :profiles="filtered"
        :active-id="activeId"
        :active-database="activeDatabase"
        :version="treeVersion"
        :fetch-databases="listDatabases"
        :fetch-tables="listTables"
        :file-folders="fileFolders"
        :file-items="fileItems"
        :active-file-folder="activeFileFolder"
        :active-file-id="activeFileId"
        :file-actions="fileActions"
        @select-conn="onSelectConn"
        @select-database="onSelectDatabase"
        @pick-table="onPickTable"
        @edit="openEdit"
        @rename="onRename"
        @remove="onRemove"
        @select-file-folder="onSelectFileFolder"
        @select-file="onSelectSqlFile"
        @new-file="onNewSqlFile"
        @refresh-files="onRefreshFiles"
      />
```

在 `.nvtoolbar` 里加保存按钮与文件名，并把提示合并：

```html
        <span v-if="fileTitle" class="nvfiletitle">{{ fileTitle }}</span>
        <button class="nvbtn nv-save-sql" :disabled="!activeFileId || fileSaving" @click="flushSql">{{ $t('files.save') }}</button>
```

提示行改为：

```html
      <div v-if="msg || fileMsg" class="nvmsg">{{ msg || fileMsg }}</div>
```

- [ ] **Step 3: 更新 `NavicatTool.test.ts`**

`stubFetch` 里补：

```typescript
    if (s.startsWith('/api/files/navicat/tree')) return okJson({ items: [], folders: [] });
```

新增用例：

```typescript
  it('SQL 文件分组：无活动文件时保存生成时间戳 .sql', async () => {
    const posts: any[] = [];
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      if (String(u).startsWith('/api/files/navicat/file') && init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return okJson({ ok: true, id: '20260921-180000.sql' }); }
      return okJson({ ok: true });
    }));
    const w = mount();
    await flushPromises();
    await w.findComponent(CodeEditor).vm.$emit('update:modelValue', 'select 1');
    await w.find('.nv-save-sql').trigger('click');
    await flushPromises();
    expect(posts[0].name).toMatch(/^\d{8}-\d{6}\.sql$/);
  });
```

- [ ] **Step 4: 运行**

Run: `npm --prefix web run test -- Navicat`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/navicat/NavicatTree.vue web/src/tools/navicat/NavicatTool.vue web/src/tools/navicat/NavicatTool.test.ts
git commit -m "feat(navicat): 连接树升级为连接+文件分组，SQL 可存成文件"
```

---

## Task 10: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`, `shared/i18n/en.js`

- [ ] **Step 1: 加词条**

`shared/i18n/zh-CN.js` 与 `shared/i18n/en.js` 同时加（键名一致、放在各自现有 `files.*` / `nv.*` 区域）：

```javascript
  'files.untitled': '未命名',        // en: 'Untitled'
  'nv.conn_group': '连接',           // en: 'Connections'
  'nv.file_group': '文件',           // en: 'Files'
```

- [ ] **Step 2: 校验**

Run: `npm.cmd run check:i18n`
Expected: 通过（无缺失/不对称键）

- [ ] **Step 3: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 小工具文件工作台新增词条"
```

---

## Task 11: 全量验证

- [ ] **Step 1: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误

- [ ] **Step 2: 服务端测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS

- [ ] **Step 3: 前端测试**

Run: `npm.cmd run test:web`
Expected: 全部 PASS

- [ ] **Step 4: 若有修复则提交**

如有修复，按具体文件 `git add`（禁止 `git add -A`）：

```bash
git add <本次改动的具体文件>
git commit -m "test(tools): 全量测试与类型检查通过"
```

---

## 完成判据

- 六个小工具的左侧都是「标题栏 + 文件树 + 右键菜单」的统一外观，数据仍各在自己目录。
- 编辑器在任何时候都能输入；无活动文件时点保存/Ctrl+S 会生成 `YYYYMMDD-HHmmss.<ext>` 文件并写入；之后恢复 1 秒防抖自动保存。
- 标题栏 📄＋/📁＋ 新建文件（时间戳）/文件夹；⟳ 刷新；右键菜单含新建文件/新建文件夹/重命名/删除/复制名称/复制路径。
- postman 运行仍自动落记录，记录即文件、可点击载入、可运行文件夹/单条。
- navicat 左侧为「连接 + 文件」两分组，SQL 可保存为文件。
- `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 全绿。
