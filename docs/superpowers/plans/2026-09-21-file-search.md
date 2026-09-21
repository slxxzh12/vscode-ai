# 项目文件搜索（类 IDEA / VS Code）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「目录」页签头部加 🔍 按钮，弹出搜索框，按「文件名命中」与「内容命中（按文件分组、带行号）」展示结果，点击可打开文件并跳到命中行高亮。

**Architecture:** 后端新增独立模块 `server/project-search.js` 做目录遍历扫描，经 `GET /api/search` 暴露；前端沿 `TreeSource` 契约新增可选 `search`/`openHit` 能力，`TreeView` 头部按能力显示按钮并挂载 `FileSearchDialog`；跳行经 App 的 `locateToken/locatePath/locateLine` 仿 `detailToken` 透传到 `DocViewer`，用 CodeMirror 定位。

**Tech Stack:** Node ESM（`node --test`）、Vue 3 + TS + Element Plus + CodeMirror 6（vitest + vue-tsc）。

**Windows 环境注意：** npm 一律用 `npm.cmd`（PowerShell 执行策略拦截 `npm.ps1`）。

**Spec:** `docs/superpowers/specs/2026-09-21-file-search-design.md`

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `server/project-search.js`（新增） | 纯目录扫描：名字命中 + 内容命中 + 上限/截断 |
| `server/test/project-search.test.js`（新增） | 扫描逻辑单测 |
| `server/projects.js`（改） | 新增 `rootOf(projectId)`：解析项目根绝对路径 |
| `server/test/projects.test.js`（改） | `rootOf` 单测 |
| `server/http-api.js`（改） | 新增 `GET /api/search` 路由 |
| `server/test/http-api.test.js`（改） | 路由正常/400/404/403 |
| `shared/i18n/zh-CN.js`、`shared/i18n/en.js`（改） | `search.*` 词条 |
| `web/src/tree/treeSource.ts`（改） | 契约新增 `search?`/`openHit?` 与结果类型 |
| `web/src/search/projectSearch.ts`（新增） | 调 `/api/search` 的类型化封装 |
| `web/src/tree/projectTreeSource.ts`（改） | 实现 `search`/`openHit`，新增 `onOpenFileAt` 回调 |
| `web/src/tree/projectTreeSource.test.ts`（新增） | 请求参数映射 + `openHit` 带 line |
| `web/src/components/FileSearchDialog.vue`（新增） | 搜索弹窗：输入/开关/两组结果/分组/跳转 |
| `web/src/components/FileSearchDialog.test.ts`（新增） | 组件渲染与点击 emit |
| `web/src/components/TreeView.vue`（改） | 头部 🔍 按钮 + 挂载弹窗 |
| `web/src/components/TreeView.test.ts`（改） | 按钮按能力显隐 |
| `web/src/components/HistoryList.vue`（改） | 新增 `open-file-at` emit |
| `web/src/App.vue`（改） | `onOpenFileAt` + `locate*` refs + 透传 |
| `web/src/components/TerminalView.vue`（改） | 透传 `locate*` props |
| `web/src/components/FilePreview.vue`（改） | 透传 `locate*` props |
| `web/src/components/DocViewer.vue`（改） | 跳行定位实现 |

---

### Task 1: 后端搜索模块 `server/project-search.js`

**Files:**
- Create: `server/project-search.js`
- Test: `server/test/project-search.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/project-search.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchProject, IGNORE_DIRS } from '../project-search.js';

function tmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dfsearch-'));
  const w = (rel, content) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  return { root, w };
}

test('文件名与内容命中，内容带行号与行文本', () => {
  const { root, w } = tmpTree();
  w('src/app.js', 'const a = 1;\nconst target = 2;\n');
  w('target.md', '# target\n');
  const r = searchProject(root, { query: 'target' });
  assert.deepEqual(r.nameHits, [{ path: 'target.md', name: 'target.md' }]);
  assert.deepEqual(
    [...r.contentHits].sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: 'src/app.js', name: 'app.js', line: 2, text: 'const target = 2;' },
      { path: 'target.md', name: 'target.md', line: 1, text: '# target' },
    ],
  );
  assert.equal(r.truncated, false);
});

test('区分大小写开关', () => {
  const { root, w } = tmpTree();
  w('a.txt', 'Target\n');
  assert.equal(searchProject(root, { query: 'target' }).contentHits.length, 1);
  assert.equal(searchProject(root, { query: 'target', caseSensitive: true }).contentHits.length, 0);
  assert.equal(searchProject(root, { query: 'Target', caseSensitive: true }).contentHits.length, 1);
});

test('跳过忽略目录、二进制文件与超大文件', () => {
  const { root, w } = tmpTree();
  w('node_modules/a.txt', 'target\n');
  w('.git/b.txt', 'target\n');
  w('dist/c.txt', 'target\n');
  w('dist-portable/d.txt', 'target\n');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 116, 97, 114, 103, 101, 116]));
  fs.writeFileSync(path.join(root, 'big.txt'), 'target\n'.repeat(300000));
  w('keep.txt', 'target\n');
  const r = searchProject(root, { query: 'target' });
  assert.deepEqual(r.contentHits.map((h) => h.path), ['keep.txt']);
});

test('总内容命中上限触发 truncated', () => {
  const { root, w } = tmpTree();
  w('a.txt', 'x\nx\ny\n');
  const r = searchProject(root, { query: 'x', limits: { maxContentHits: 2 } });
  assert.equal(r.contentHits.length, 2);
  assert.equal(r.truncated, true);
});

test('单文件内容命中上限触发 truncated', () => {
  const { root, w } = tmpTree();
  w('a.txt', Array.from({ length: 10 }, () => 'hit').join('\n'));
  const r = searchProject(root, { query: 'hit', limits: { maxHitsPerFile: 3 } });
  assert.equal(r.contentHits.length, 3);
  assert.equal(r.truncated, true);
});

test('空 query 返回空结果且不扫描', () => {
  const { root, w } = tmpTree();
  w('a.txt', 'x');
  assert.deepEqual(searchProject(root, { query: '' }), { nameHits: [], contentHits: [], truncated: false, scanned: 0 });
});

test('IGNORE_DIRS 覆盖常见目录', () => {
  for (const d of ['node_modules', '.git', 'dist', 'dist-portable', 'build', 'out', 'coverage']) {
    assert.ok(IGNORE_DIRS.has(d), d);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/project-search.test.js"`
Expected: FAIL，报 `Cannot find module '../project-search.js'`。

- [ ] **Step 3: 实现模块**

创建 `server/project-search.js`：

```js
import fs from 'node:fs';
import path from 'node:path';

// 搜索时跳过的常见目录（按目录名精确匹配）
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-portable', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.idea', '.vscode',
]);

export const DEFAULT_LIMITS = {
  maxNameHits: 200,
  maxContentHits: 300,
  maxHitsPerFile: 50,
  maxFiles: 20000,
  maxFileBytes: 1024 * 1024,
  maxLineLength: 400,
};

// 读前 64KB，含 NUL 即视为二进制
function isBinaryFile(abs, size) {
  if (size <= 0) return false;
  const probeLen = Math.min(size, 64 * 1024);
  const buf = Buffer.alloc(probeLen);
  const fd = fs.openSync(abs, 'r');
  try {
    fs.readSync(fd, buf, 0, probeLen, 0);
    return buf.includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

// 遍历 root，返回 { nameHits, contentHits, truncated, scanned }；path 一律用 POSIX 风格相对路径
export function searchProject(root, { query = '', caseSensitive = false, limits = {} } = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const nameHits = [];
  const contentHits = [];
  let scanned = 0;
  let truncated = false;
  if (!query) return { nameHits, contentHits, truncated, scanned };

  const needle = caseSensitive ? query : query.toLowerCase();
  const rootResolved = path.resolve(root);
  const stack = [''];

  while (stack.length) {
    if (scanned >= lim.maxFiles) { truncated = true; break; }
    const relDir = stack.pop();
    const absDir = relDir ? path.join(rootResolved, relDir) : rootResolved;
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { continue; }

    for (const d of entries) {
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (IGNORE_DIRS.has(d.name)) continue;
        if (d.isSymbolicLink()) continue;   // 跳过符号链接目录，防目录环
        stack.push(rel);
        continue;
      }
      if (!d.isFile()) continue;

      scanned++;
      if (scanned > lim.maxFiles) { truncated = true; break; }

      // —— 文件名命中 ——
      const nameHay = caseSensitive ? d.name : d.name.toLowerCase();
      if (nameHay.includes(needle)) {
        if (nameHits.length < lim.maxNameHits) nameHits.push({ path: rel, name: d.name });
        else truncated = true;
      }

      // —— 内容命中 ——
      if (contentHits.length >= lim.maxContentHits) { continue; }
      const absFile = path.join(rootResolved, rel);
      let st;
      try { st = fs.statSync(absFile); } catch { continue; }
      if (st.size > lim.maxFileBytes) continue;
      try { if (isBinaryFile(absFile, st.size)) continue; } catch { continue; }
      let text;
      try { text = fs.readFileSync(absFile, 'utf8'); } catch { continue; }

      const lines = text.split(/\r?\n/);
      let perFile = 0;
      for (let i = 0; i < lines.length; i++) {
        const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
        if (!hay.includes(needle)) continue;
        contentHits.push({ path: rel, name: d.name, line: i + 1, text: lines[i].slice(0, lim.maxLineLength) });
        perFile++;
        if (contentHits.length >= lim.maxContentHits) { truncated = true; break; }
        if (perFile >= lim.maxHitsPerFile) { truncated = true; break; }
      }
    }
  }
  return { nameHits, contentHits, truncated, scanned };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/project-search.test.js"`
Expected: PASS（7 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add server/project-search.js server/test/project-search.test.js
git commit -m "feat(search): 新增项目目录扫描模块（文件名+内容、忽略目录、上限截断）"
```

---

### Task 2: `Projects.rootOf` + HTTP 路由 `GET /api/search`

**Files:**
- Modify: `server/projects.js`（在 `hash` 方法后新增 `rootOf`）
- Modify: `server/test/projects.test.js`
- Modify: `server/http-api.js`（import + 路由）
- Modify: `server/test/http-api.test.js`

- [ ] **Step 1: 写失败测试（projects.rootOf）**

在 `server/test/projects.test.js` 末尾追加（沿用该文件已有的 `tmpDir`/构造风格；若文件名不同请按实际 helper 调整）：

```js
test('rootOf 返回项目根解析路径，未知项目抛 not-found', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfroot-'));
  const p = new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] });
  assert.equal(p.rootOf('a'), fs.realpathSync(dir));
  assert.throws(() => p.rootOf('nope'), (e) => e.code === 'not-found');
});
```

若文件顶部缺少 `os` import，补上 `import os from 'node:os';`。

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/projects.test.js"`
Expected: FAIL，`p.rootOf is not a function`。

- [ ] **Step 3: 实现 `rootOf`**

在 `server/projects.js` 的 `hash(...)` 方法之后、`readText` 之前插入：

```js
  // 项目根解析路径（供目录搜索用）
  rootOf(projectId) {
    const proj = this._project(projectId);
    return this._realOrResolved(proj.root);
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/projects.test.js"`
Expected: PASS。

- [ ] **Step 5: 写失败测试（HTTP 路由）**

在 `server/test/http-api.test.js` 的 `/api/tree 未知项目返回 404` 用例之后插入：

```js
test('/api/search 正常返回名字与内容命中', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'target.md'), '# target\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const target = 1;\n');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'target\n');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/search?project=a&q=target');
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.deepEqual(body.nameHits, [{ path: 'target.md', name: 'target.md' }]);
  assert.deepEqual(
    body.contentHits.map((h) => [h.path, h.line]).sort(),
    [['src/a.js', 1], ['target.md', 1]],
  );
});

test('/api/search q 为空返回 400', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  assert.equal((await request(server, '/api/search?project=a&q=')).status, 400);
});

test('/api/search 未知项目返回 404', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  assert.equal((await request(server, '/api/search?project=nope&q=x')).status, 404);
});
```

- [ ] **Step 6: 运行确认失败**

Run: `node --test "server/test/http-api.test.js"`
Expected: FAIL，`/api/search` 返回 404 `not found`。

- [ ] **Step 7: 实现路由**

在 `server/http-api.js` 顶部 import 区（`import { runCurl } ...` 之后）加：

```js
import { searchProject } from './project-search.js';
```

在 `/api/tree` 路由块（`sendJson(res, 200, { items }); return; }` 那个 `}`）之后插入：

```js
      if (url.pathname === '/api/search' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) { sendJson(res, 400, { error: 'q required' }); return; }
        const cs = url.searchParams.get('case');
        const caseSensitive = cs === '1' || cs === 'true';
        const root = projects.rootOf(project);
        sendJson(res, 200, searchProject(root, { query: q, caseSensitive }));
        return;
      }
```

（外层已有 `try/catch`：未知项目 `not-found` → 404，`forbidden` → 403。）

- [ ] **Step 8: 运行确认通过**

Run: `node --test "server/test/http-api.test.js" "server/test/projects.test.js"`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add server/projects.js server/test/projects.test.js server/http-api.js server/test/http-api.test.js
git commit -m "feat(search): 新增 GET /api/search 与 Projects.rootOf"
```

---

### Task 3: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 的 `'tree.copy_path'` 行之后插入：

```js
  'search.title': '搜索文件',
  'search.placeholder': '搜索文件名或内容',
  'search.case': '区分大小写',
  'search.name_group': '文件名命中',
  'search.content_group': '内容命中',
  'search.hits': '{n} 处',
  'search.loading': '搜索中…',
  'search.empty': '没有匹配结果',
  'search.error': '搜索失败：{msg}',
  'search.hint': '输入关键词开始搜索',
  'search.truncated': '结果过多，已截断',
  'search.scanned': '已扫描 {n} 个文件',
  'search.open_file': '打开文件',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 的 `'tree.copy_path'` 行之后插入：

```js
  'search.title': 'Search files',
  'search.placeholder': 'Search file name or content',
  'search.case': 'Match case',
  'search.name_group': 'File name matches',
  'search.content_group': 'Content matches',
  'search.hits': '{n} matches',
  'search.loading': 'Searching…',
  'search.empty': 'No matches',
  'search.error': 'Search failed: {msg}',
  'search.hint': 'Type a keyword to search',
  'search.truncated': 'Too many results, truncated',
  'search.scanned': 'Scanned {n} files',
  'search.open_file': 'Open file',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: 通过，无缺失/多余键。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(search): 补齐搜索相关中英词条"
```

---

### Task 4: `TreeSource` 契约扩展

**Files:**
- Modify: `web/src/tree/treeSource.ts`

- [ ] **Step 1: 扩展类型与契约**

将 `web/src/tree/treeSource.ts` 改为（在文件顶部类型区新增搜索结果类型，并在 `TreeSource` 接口末尾加两个可选方法）：

```ts
// 统一树的数据源契约：TreeView 只依赖本契约；能力（方法）缺省即隐藏对应菜单/按钮。
export interface TreeSourceNode {
  key: string;                       // 唯一 id：项目=相对路径；工具文件=文件/目录 id；navicat=连接/库/表 key
  name: string;                      // 显示名
  kind: 'dir' | 'item';
  icon?: string;                     // 可选图标；缺省由 TreeView 按 kind/扩展名给默认图标
  time?: string;                     // 可选时间（已格式化字符串）
  status?: 'pass' | 'fail';          // 可选状态点（postman 运行结果）
}

export interface SearchNameHit { path: string; name: string; }
export interface SearchContentHit { path: string; name: string; line: number; text: string; }
export interface SearchResult {
  nameHits: SearchNameHit[];
  contentHits: SearchContentHit[];
  truncated: boolean;
  scanned: number;
}
export interface SearchHit { path: string; name: string; line?: number; }

export interface TreeSource {
  loadChildren(dirKey: string): Promise<TreeSourceNode[]>;   // '' = 根
  open(node: TreeSourceNode): void;

  createFile?(dirKey: string, name: string): Promise<void>;
  createFolder?(dirKey: string, name: string): Promise<void>;
  rename?(node: TreeSourceNode, name: string): Promise<void>;
  remove?(node: TreeSourceNode): Promise<void>;
  move?(node: TreeSourceNode, dirKey: string): Promise<void>;
  run?(node: TreeSourceNode): void;
  runFolder?(dirKey: string): void;
  reveal?(node: TreeSourceNode): Promise<void>;
  detail?(node: TreeSourceNode): void;
  copyName?(node: TreeSourceNode): void;
  copyPath?(node: TreeSourceNode): void;
  copyContent?(node: TreeSourceNode): Promise<void>;
  search?(query: string, opts: { caseSensitive: boolean }): Promise<SearchResult>;
  openHit?(hit: SearchHit): void;
}

export type { TreeRowNode, TreeRow } from './treeRows';
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（新增可选方法不影响现有实现）。

- [ ] **Step 3: 提交**

```bash
git add web/src/tree/treeSource.ts
git commit -m "feat(search): TreeSource 契约新增 search/openHit 能力"
```

---

### Task 5: 前端 API 封装 + 项目数据源实现

**Files:**
- Create: `web/src/search/projectSearch.ts`
- Modify: `web/src/tree/projectTreeSource.ts`
- Test: `web/src/tree/projectTreeSource.test.ts`（新增）

- [ ] **Step 1: 写失败测试**

创建 `web/src/tree/projectTreeSource.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { projectTreeSource } from './projectTreeSource';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('projectTreeSource.search', () => {
  it('按 project/q/case 请求 /api/search 并返回结果', async () => {
    const payload = { nameHits: [{ path: 'a.txt', name: 'a.txt' }], contentHits: [], truncated: false, scanned: 3 };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }));
    vi.stubGlobal('fetch', fetchMock);
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const r = await src.search!('target', { caseSensitive: true });
    expect(r).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/search?project=p1&q=target&case=1');
  });

  it('请求失败抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })));
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    await expect(src.search!('x', { caseSensitive: false })).rejects.toThrow('boom');
  });
});

describe('projectTreeSource.openHit', () => {
  it('有 onOpenFileAt 时带上 line', () => {
    const onOpenFileAt = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn(), onOpenFileAt });
    src.openHit!({ path: 'src/a.js', name: 'a.js', line: 7 });
    expect(onOpenFileAt).toHaveBeenCalledWith('p1', 'src/a.js', 'a.js', 7);
  });

  it('无 onOpenFileAt 时回退到 onOpenFile', () => {
    const onOpenFile = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile, onDetailFile: vi.fn() });
    src.openHit!({ path: 'a.txt', name: 'a.txt' });
    expect(onOpenFile).toHaveBeenCalledWith('p1', 'a.txt', 'a.txt');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/tree/projectTreeSource.test.ts`
Expected: FAIL（`src.search` 为 undefined / 类型报错）。

- [ ] **Step 3: 新增 API 封装**

创建 `web/src/search/projectSearch.ts`：

```ts
import type { SearchResult } from '../tree/treeSource';

// 调 GET /api/search：项目内按文件名 + 内容搜索
export async function searchProject(projectId: string, query: string, opts: { caseSensitive: boolean }): Promise<SearchResult> {
  const url = `/api/search?project=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}&case=${opts.caseSensitive ? 1 : 0}`;
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json() as Promise<SearchResult>;
}
```

- [ ] **Step 4: 实现数据源**

将 `web/src/tree/projectTreeSource.ts` 改为：

```ts
import { useProjects } from '../useProjects';
import { copyText } from '../clipboard';
import { searchProject } from '../search/projectSearch';
import type { TreeSource, SearchResult, SearchHit } from './treeSource';

// 项目文件树数据源：包装 useProjects，供统一 TreeView 使用。
export function projectTreeSource(opts: {
  projectId: string;
  onOpenFile: (projectId: string, path: string, name: string) => void;
  onDetailFile: (projectId: string, path: string, name: string) => void;
  onOpenFileAt?: (projectId: string, path: string, name: string, line?: number) => void;
}): TreeSource {
  const api = useProjects();
  const pid = opts.projectId;
  const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

  return {
    async loadChildren(dirKey) {
      if (!pid) return [];
      const items = await api.tree(pid, dirKey);
      return items.map((i) => ({ key: join(dirKey, i.name), name: i.name, kind: i.type === 'dir' ? 'dir' : 'item' }));
    },
    open(node) {
      opts.onOpenFile(pid, node.key, node.name);
    },
    createFile(dirKey, name) {
      const rel = join(dirKey, name);
      return api.createFile(pid, rel).then(() => { opts.onOpenFile(pid, rel, name); });
    },
    createFolder(dirKey, name) {
      return api.createDir(pid, join(dirKey, name)).then(() => undefined);
    },
    reveal(node) {
      return api.reveal(pid, node.key).then(() => undefined);
    },
    detail(node) {
      opts.onDetailFile(pid, node.key, node.name);
    },
    copyName(node) { void copyText(node.name); },
    copyPath(node) { void copyText(node.key); },
    async copyContent(node) {
      const f = await api.text(pid, node.key);
      await copyText(f.content);
    },
    async search(query: string, o: { caseSensitive: boolean }): Promise<SearchResult> {
      if (!pid) return { nameHits: [], contentHits: [], truncated: false, scanned: 0 };
      return searchProject(pid, query, o);
    },
    openHit(hit: SearchHit) {
      if (opts.onOpenFileAt) opts.onOpenFileAt(pid, hit.path, hit.name, hit.line);
      else opts.onOpenFile(pid, hit.path, hit.name);
    },
  };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/tree/projectTreeSource.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 6: 提交**

```bash
git add web/src/search/projectSearch.ts web/src/tree/projectTreeSource.ts web/src/tree/projectTreeSource.test.ts
git commit -m "feat(search): 前端搜索 API 封装与项目数据源 search/openHit"
```

---

### Task 6: 搜索弹窗 `FileSearchDialog.vue`

**Files:**
- Create: `web/src/components/FileSearchDialog.vue`
- Test: `web/src/components/FileSearchDialog.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/FileSearchDialog.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import FileSearchDialog from './FileSearchDialog.vue';
import type { TreeSource } from '../tree/treeSource';

function fakeSource(over: Partial<TreeSource> = {}): TreeSource {
  return {
    async loadChildren() { return []; },
    open: vi.fn(),
    ...over,
  };
}

function mountDialog(src: TreeSource) {
  return mountC(FileSearchDialog, {
    props: { source: src },
    global: { plugins: [ElementPlus], stubs: { teleport: true } },
  });
}

const RESULT = {
  nameHits: [{ path: 'target.md', name: 'target.md' }],
  contentHits: [
    { path: 'src/a.js', name: 'a.js', line: 2, text: 'const target = 1;' },
    { path: 'src/b.js', name: 'b.js', line: 5, text: 'target()' },
  ],
  truncated: false,
  scanned: 9,
};

describe('FileSearchDialog', () => {
  it('回车触发搜索并分组渲染：文件名命中 + 每个内容文件一组', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountDialog(src);
    expect(w.find('.shint').exists()).toBe(true);          // 初始提示
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(src.search).toHaveBeenCalledWith('target', { caseSensitive: false });
    expect(w.findAll('.sname-row').length).toBe(1);
    expect(w.findAll('.scgroup').length).toBe(2);
    expect(w.findAll('.sline').length).toBe(2);
  });

  it('点击内容命中行调用 openHit 并带 line', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountDialog(src);
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.findAll('.sline')[0].trigger('click');
    expect(src.openHit).toHaveBeenCalledWith({ path: 'src/a.js', name: 'a.js', line: 2 });
  });

  it('点击文件名命中调用 openHit（不带 line）', async () => {
    const src = fakeSource({ search: vi.fn(async () => RESULT), openHit: vi.fn() });
    const w = mountDialog(src);
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.find('.sname-row').trigger('click');
    expect(src.openHit).toHaveBeenCalledWith({ path: 'target.md', name: 'target.md' });
  });

  it('无命中显示空态；截断有提示', async () => {
    const empty = { nameHits: [], contentHits: [], truncated: true, scanned: 4 };
    const src = fakeSource({ search: vi.fn(async () => empty), openHit: vi.fn() });
    const w = mountDialog(src);
    await w.find('.sinput').setValue('zzz');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(w.find('.shint').exists()).toBe(true);
    expect(w.find('.strunc').exists()).toBe(true);
  });

  it('搜索失败显示错误', async () => {
    const src = fakeSource({ search: vi.fn(async () => { throw new Error('boom'); }), openHit: vi.fn() });
    const w = mountDialog(src);
    await w.find('.sinput').setValue('x');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(w.find('.serr').text()).toContain('boom');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/components/FileSearchDialog.test.ts`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现组件**

创建 `web/src/components/FileSearchDialog.vue`：

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TreeSource, SearchResult, SearchHit } from '../tree/treeSource';

// 项目文件搜索弹窗：一个输入框同时搜文件名与内容；内容命中按文件分组。
const props = defineProps<{ source: TreeSource }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const open = ref(true);                 // 组件被挂载即打开
const query = ref('');
const caseSensitive = ref(false);
const loading = ref(false);
const error = ref('');
const result = ref<SearchResult | null>(null);
const collapsed = ref<Set<string>>(new Set());
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

const keyword = computed(() => query.value.trim());
const searched = computed(() => keyword.value.length > 0);
const nameHits = computed(() => result.value?.nameHits ?? []);
const contentHits = computed(() => result.value?.contentHits ?? []);
const contentGroups = computed(() => {
  const map = new Map<string, { path: string; name: string; lines: { line: number; text: string }[] }>();
  for (const h of contentHits.value) {
    let g = map.get(h.path);
    if (!g) { g = { path: h.path, name: h.name, lines: [] }; map.set(h.path, g); }
    g.lines.push({ line: h.line, text: h.text });
  }
  return [...map.values()];
});

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void run(); }, 300);
}
async function run() {
  if (timer) { clearTimeout(timer); timer = null; }
  const q = keyword.value;
  const my = ++seq;
  if (!q || !props.source.search) { result.value = null; loading.value = false; error.value = ''; return; }
  loading.value = true;
  error.value = '';
  try {
    const r = await props.source.search(q, { caseSensitive: caseSensitive.value });
    if (my !== seq) return;
    result.value = r;
  } catch (e: unknown) {
    if (my !== seq) return;
    error.value = String((e as Error)?.message || e);
    result.value = null;
  } finally {
    if (my === seq) loading.value = false;
  }
}
watch(query, schedule);
watch(caseSensitive, () => { if (searched.value) void run(); });

function toggle(path: string) {
  const s = new Set(collapsed.value);
  if (s.has(path)) s.delete(path); else s.add(path);
  collapsed.value = s;
}
function pick(hit: SearchHit) {
  props.source.openHit?.(hit);
  open.value = false;
}
// 命中关键词分段，供模板高亮
function segments(text: string): { text: string; hit: boolean }[] {
  const kw = keyword.value;
  if (!kw) return [{ text, hit: false }];
  const hay = caseSensitive.value ? text : text.toLowerCase();
  const needle = caseSensitive.value ? kw : kw.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    if (i > from) out.push({ text: text.slice(from, i), hit: false });
    out.push({ text: text.slice(i, i + needle.length), hit: true });
    from = i + needle.length;
    if (!needle.length) break;
  }
  if (from < text.length) out.push({ text: text.slice(from), hit: false });
  return out;
}
</script>

<template>
  <el-dialog v-model="open" :title="$t('search.title')" width="720px" append-to-body class="fsdlg" @closed="emit('close')">
    <div class="sbar">
      <input v-model="query" class="sinput" type="search" :placeholder="$t('search.placeholder')" spellcheck="false" @keydown.enter="run" />
      <label class="scase" :title="$t('search.case')"><input v-model="caseSensitive" type="checkbox" /><span>{{ $t('search.case') }}</span></label>
    </div>
    <div class="sbody">
      <div v-if="!searched" class="shint">{{ $t('search.hint') }}</div>
      <div v-else-if="loading" class="shint">{{ $t('search.loading') }}</div>
      <div v-else-if="error" class="serr">{{ $t('search.error', { msg: error }) }}</div>
      <div v-else-if="result && !nameHits.length && !contentHits.length" class="shint">{{ $t('search.empty') }}</div>
      <template v-else-if="result">
        <section v-if="nameHits.length" class="sgroup">
          <div class="sghead">{{ $t('search.name_group') }} <span class="scount">{{ nameHits.length }}</span></div>
          <button v-for="h in nameHits" :key="'n:' + h.path" class="sname-row" :title="$t('search.open_file')" @click="pick({ path: h.path, name: h.name })">
            <span class="sic">📄</span><span class="spath">{{ h.path }}</span>
          </button>
        </section>
        <section v-if="contentHits.length" class="sgroup">
          <div class="sghead">{{ $t('search.content_group') }} <span class="scount">{{ contentHits.length }}</span></div>
          <div v-for="g in contentGroups" :key="'g:' + g.path" class="scgroup">
            <button class="sfilehead" :title="$t('search.open_file')" @click="pick({ path: g.path, name: g.name })">
              <span class="scaret" @click.stop="toggle(g.path)">{{ collapsed.has(g.path) ? '▸' : '▾' }}</span>
              <span class="sic">📄</span>
              <span class="spath">{{ g.path }}</span>
              <span class="scount">{{ $t('search.hits', { n: g.lines.length }) }}</span>
            </button>
            <template v-if="!collapsed.has(g.path)">
              <button v-for="(l, i) in g.lines" :key="i" class="sline" @click="pick({ path: g.path, name: g.name, line: l.line })">
                <span class="sln">{{ l.line }}</span>
                <span class="stext"><span v-for="(s, si) in segments(l.text)" :key="si" :class="{ hit: s.hit }">{{ s.text }}</span></span>
              </button>
            </template>
          </div>
        </section>
        <div class="sfoot">{{ $t('search.scanned', { n: result.scanned }) }}</div>
      </template>
      <div v-if="result && result.truncated" class="strunc">{{ $t('search.truncated') }}</div>
    </div>
  </el-dialog>
</template>

<style scoped>
.fsdlg :deep(.el-dialog__body) { padding-top: 8px; }
.sbar { display: flex; align-items: center; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--bd2); }
.sinput { flex: 1; min-width: 0; box-sizing: border-box; background: var(--bg3); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 10px; font-size: 13px; font-family: inherit; }
.sinput:focus { outline: none; border-color: var(--ac2); }
.scase { display: inline-flex; align-items: center; gap: 4px; color: var(--tx3); font-size: 12px; white-space: nowrap; cursor: pointer; }
.sbody { max-height: 60vh; overflow-y: auto; padding-top: 6px; }
.shint, .strunc, .sfoot { color: var(--tx5); font-size: 12px; padding: 10px 2px; }
.serr { color: var(--err); font-size: 12px; padding: 10px 2px; }
.sgroup { margin-bottom: 10px; }
.sghead { color: var(--ac2); font-size: 11px; text-transform: uppercase; padding: 8px 2px 4px; }
.scount { color: var(--tx5); font-size: 11px; margin-left: 6px; }
.sname-row, .sfilehead, .sline { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; text-align: left; padding: 4px 8px; cursor: pointer; border-radius: 4px; color: var(--tx1); font-size: 12px; font-family: ui-monospace, Consolas, monospace; }
.sname-row:hover, .sfilehead:hover, .sline:hover { background: var(--bg3); }
.sic { flex: none; }
.spath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scaret { flex: none; width: 12px; text-align: center; color: var(--tx4); }
.sline { padding-left: 28px; align-items: flex-start; }
.sln { flex: none; width: 44px; text-align: right; color: var(--tx5); user-select: none; }
.stext { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; }
.stext .hit { background: color-mix(in srgb, var(--ac) 40%, transparent); border-radius: 2px; }
</style>
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/components/FileSearchDialog.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/FileSearchDialog.vue web/src/components/FileSearchDialog.test.ts
git commit -m "feat(search): 新增文件搜索弹窗（按文件分组、命中行高亮、点击跳转）"
```

---

### Task 7: `TreeView` 头部接入搜索按钮

**Files:**
- Modify: `web/src/components/TreeView.vue`
- Modify: `web/src/components/TreeView.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/components/TreeView.test.ts` 顶部补 `import ElementPlus from 'element-plus';`（若已有则跳过），并在 `describe('TreeView', ...)` 内末尾追加：

```ts
  it('source.search 存在时显示搜索按钮，缺失时不显示', async () => {
    const withSearch = mountC(TreeView, {
      props: { source: fakeSource({ search: vi.fn() }), title: 'X' },
      global: { plugins: [ElementPlus], stubs: { teleport: true } },
    });
    await flushPromises();
    expect(withSearch.find('.ftsearch').exists()).toBe(true);

    const without = mountC(TreeView, { props: { source: fakeSource(), title: 'X' } });
    await flushPromises();
    expect(without.find('.ftsearch').exists()).toBe(false);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/components/TreeView.test.ts`
Expected: FAIL（找不到 `.ftsearch`）。

- [ ] **Step 3: 实现**

在 `web/src/components/TreeView.vue` 的 `<script setup>` 顶部 import 区加：

```ts
import FileSearchDialog from './FileSearchDialog.vue';
```

在 `const menu = ref(...)` 之前（或 `nodes`/`collapsed` 附近）加：

```ts
const searchOpen = ref(false);
```

在模板 `.ftacts` 内，`📁＋` 按钮之后加：

```html
        <button v-if="source.search" class="ftic ftsearch" :title="$t('search.title')" @click.stop="searchOpen = true">🔍</button>
```

在 `</div>`（`.ftv` 根 div 结束前）加：

```html
    <FileSearchDialog v-if="searchOpen" :source="source" @close="searchOpen = false" />
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/components/TreeView.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/TreeView.vue web/src/components/TreeView.test.ts
git commit -m "feat(search): TreeView 头部按能力显示搜索按钮并挂载弹窗"
```

---

### Task 8: 打开文件并跳行链路

**Files:**
- Modify: `web/src/components/HistoryList.vue`
- Modify: `web/src/App.vue`
- Modify: `web/src/components/TerminalView.vue`
- Modify: `web/src/components/FilePreview.vue`
- Modify: `web/src/components/DocViewer.vue`

- [ ] **Step 1: HistoryList 传出 open-file-at**

`web/src/components/HistoryList.vue`：

emits 增补（在 `(e: 'detail-file', ...)` 之后）：

```ts
  (e: 'open-file-at', projectId: string, path: string, name: string, line?: number): void;
```

`treeSource` 计算属性改为：

```ts
const treeSource = computed(() => projectTreeSource({
  projectId: props.projectId || '',
  onOpenFile: (pid, p, name) => emit('open-file', pid, p, name),
  onDetailFile: (pid, p, name) => emit('detail-file', pid, p, name),
  onOpenFileAt: (pid, p, name, line) => emit('open-file-at', pid, p, name, line),
}));
```

- [ ] **Step 2: App 处理并透传**

`web/src/App.vue`：

在 `onDetailFile` 函数之后新增：

```ts
const locateToken = ref(0);
const locatePath = ref('');
const locateLine = ref(0);
function onOpenFileAt(projectId: string, path: string, _name: string, line?: number) {
  openFile(projectId, path);
  locatePath.value = path.replace(/\\/g, '/');
  locateLine.value = line || 0;
  locateToken.value++;
}
```

`HistoryList` 绑定追加 `@open-file-at="onOpenFileAt"`（接在 `@detail-file="onDetailFile"` 后）。

`TerminalView` 绑定追加：

```html
:locate-token="locateToken" :locate-path="locatePath" :locate-line="locateLine"
```

- [ ] **Step 3: TerminalView 透传**

`web/src/components/TerminalView.vue` props 类型新增：

```ts
  locateToken?: number;
  locatePath?: string;
  locateLine?: number;
```

`<FilePreview ... />` 追加：

```html
:locate-token="locateToken" :locate-path="locatePath" :locate-line="locateLine"
```

- [ ] **Step 4: FilePreview 透传**

`web/src/components/FilePreview.vue`：

props 改为：

```ts
const props = defineProps<{ projectId: string; path: string; name: string; detailToken?: number; detailPath?: string; locateToken?: number; locatePath?: string; locateLine?: number }>();
```

`<DocViewer ... />` 追加：

```html
:locate-token="locateToken" :locate-path="locatePath" :locate-line="locateLine"
```

- [ ] **Step 5: DocViewer 实现定位**

`web/src/components/DocViewer.vue`：

props 改为（第 23 行）：

```ts
const props = defineProps<{ source: DocSource; path: string; name: string; detailToken?: number; detailPath?: string; locateToken?: number; locatePath?: string; locateLine?: number }>();
```

在 `let seenDetail = -1;`（约 539 行）附近新增：

```ts
let seenLocate = -1;
```

在 `applyExternalText` 函数之前新增定位函数：

```ts
// —— 搜索命中跳行：切到 code 模式 → 编辑器选中该行并滚动聚焦 ——
async function applyLocate() {
  const line = props.locateLine || 0;
  if (!line || props.locatePath !== props.path) return;
  if (kind.value !== 'text' || isBinary.value) return;   // 图片/PDF/二进制无编辑器
  if (viewMode.value !== 'code') viewMode.value = 'code';
  await nextTick();
  if (!view) mountEditor(raw.value);
  if (!view) return;
  const total = view.state.doc.lines;
  const n = Math.min(Math.max(1, line), total);
  const l = view.state.doc.line(n);
  view.dispatch({ selection: { anchor: l.from, head: l.to }, scrollIntoView: true });
  view.focus();
}
watch(() => props.locateToken, (tk) => {
  if (!tk || tk === seenLocate) return;
  if (props.locatePath !== props.path) return;
  seenLocate = tk;
  void applyLocate();
});
```

在 `load()` 内、编辑器挂载的 `if (kind.value === 'text' && showEditor.value) { ... }` 块**之后**（仍在 `try` 内、`} catch (e: any) {` 之前）追加：

```ts
      if (props.locatePath === props.path && props.locateLine) {
        seenLocate = props.locateToken || seenLocate;
        await applyLocate();
      }
```

> 说明：`FilePreview` 用 `:key="activeFile.id"` 保证切文件重建；同一文件再次跳不同行时靠 `locateToken` 变化触发 watch。

- [ ] **Step 6: 类型检查 + 相关测试**

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd --prefix web run test -- src/components/HistoryList.test.ts src/components/TreeView.test.ts src/components/FileSearchDialog.test.ts`
Expected: PASS。

- [ ] **Step 7: 手动验证（记录结果）**

1. `npm.cmd run dev`，打开 http://localhost:5173。
2. 左侧「目录」页签头部出现 🔍；点开输入某关键词。
3. 「文件名命中」与「内容命中」两组出现，内容按文件分组、显示行号与高亮。
4. 点内容命中行 → 打开该文件并滚动/选中该行；对 Markdown/HTML 文件会自动切到代码视图。
5. 勾选「区分大小写」结果变化；搜索 `node_modules` 内不存在的结果。

- [ ] **Step 8: 提交**

```bash
git add web/src/components/HistoryList.vue web/src/App.vue web/src/components/TerminalView.vue web/src/components/FilePreview.vue web/src/components/DocViewer.vue
git commit -m "feat(search): 内容命中跳行链路（App locate 透传 + DocViewer 定位高亮）"
```

---

### Task 9: 全量验证与收尾

**Files:** 无（仅验证）

- [ ] **Step 1: 全量测试**

Run: `npm.cmd test`
Expected: server + web 全绿。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: PASS（`web/src`、`server` 用户可见文案零中文命中）。

- [ ] **Step 4: 若有修复，追加提交**

```bash
git add <改动文件>
git commit -m "fix(search): 修复 <具体问题>"
```

---

## 自检记录

- **Spec 覆盖**：后端扫描（Task 1）、接口（Task 2）、i18n（Task 3）、契约（Task 4）、数据源（Task 5）、弹窗（Task 6）、入口按钮（Task 7）、跳行（Task 8）、验证（Task 9）——spec 各节均有对应任务。
- **占位符**：无 TBD/TODO；每个改代码的步骤都给出完整代码。
- **类型一致性**：`SearchResult`/`SearchHit`/`nameHits`/`contentHits`/`line` 在契约（Task 4）、数据源（Task 5）、弹窗（Task 6）、服务端返回（Task 1/2）中命名一致；`onOpenFileAt(pid,path,name,line)` 在 Task 5/8 一致；`locateToken/locatePath/locateLine` 在 Task 8 各文件一致。

## 后续（本轮不做）

见 spec「后续」节：跨项目搜索、正则/全词/类型过滤、搜索历史、流式增量与取消、结果内替换。
