# 文件搜索去截断 + 流式增量 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让项目文件与小工具的文件搜索永不截断，改用服务端流式扫描 + 前端增量渲染，并保留「跳过忽略目录/二进制」的可选开关。

**Architecture:** 后端把同步一次性扫描改为 `async function* streamProject` 异步生成器，边扫边以 NDJSON 逐行推送（`name`/`content`/`progress`/`done`）；`/api/search` 与工具目录 `/api/files/<tool>/search` 复用同一生成器。前端把 `TreeSource.search` 契约从 `Promise<SearchResult>` 改为 `AsyncIterable<SearchEvent>`，`FileSearchPanel` 用 `AbortController` 取消旧搜索并随到随渲染。postman/navicat 的客户端搜索适配为生成器。

**Tech Stack:** Node ESM（`node:fs/promises`）、原生 `http` NDJSON、Vue 3 `<script setup>` + TypeScript、vitest + happy-dom、`node --test`。

**Spec:** `docs/superpowers/specs/2026-09-22-file-search-no-truncation-design.md`

---

## Task 1: 后端流式扫描生成器（`server/project-search.js`）

**Files:**
- Modify: `server/project-search.js`
- Test: `server/test/project-search.test.js`

- [ ] **Step 1: 改写测试为流式（先让它们失败）**

把 `server/test/project-search.test.js` 整个文件替换为：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamProject, searchProject, IGNORE_DIRS } from '../project-search.js';

function tmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dfsearch-'));
  const w = (rel, content) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  return { root, w };
}

async function collect(root, opts) {
  const nameHits = [];
  const contentHits = [];
  const types = [];
  let scanned = 0;
  for await (const ev of streamProject(root, opts)) {
    types.push(ev.type);
    if (ev.type === 'name') nameHits.push(...ev.hits);
    else if (ev.type === 'content') for (const l of ev.lines) contentHits.push({ path: ev.path, name: ev.name, line: l.line, text: l.text });
    else if (ev.type === 'done') scanned = ev.scanned;
  }
  return { nameHits, contentHits, scanned, types };
}

test('文件名与内容命中，内容带行号与整行文本', async () => {
  const { root, w } = tmpTree();
  w('src/app.js', 'const a = 1;\nconst target = 2;\n');
  w('target.md', '# target\n');
  const r = await collect(root, { query: 'target' });
  assert.deepEqual(r.nameHits, [{ path: 'target.md', name: 'target.md' }]);
  assert.deepEqual(
    [...r.contentHits].sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: 'src/app.js', name: 'app.js', line: 2, text: 'const target = 2;' },
      { path: 'target.md', name: 'target.md', line: 1, text: '# target' },
    ],
  );
  assert.equal(r.types.at(-1), 'done');
});

test('超大文件与超长行都不截断', async () => {
  const { root, w } = tmpTree();
  const line = 'x'.repeat(2 * 1024 * 1024) + 'target';
  w('big.txt', line + '\n');
  const r = await collect(root, { query: 'target' });
  assert.equal(r.contentHits.length, 1);
  assert.equal(r.contentHits[0].text, line);
});

test('默认跳过忽略目录与二进制；skipIgnores=false 时一并搜出', async () => {
  const { root, w } = tmpTree();
  w('node_modules/a.txt', 'target\n');
  w('.git/b.txt', 'target\n');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 116, 97, 114, 103, 101, 116]));
  w('keep.txt', 'target\n');
  const def = await collect(root, { query: 'target' });
  assert.deepEqual(def.contentHits.map((h) => h.path), ['keep.txt']);
  const all = await collect(root, { query: 'target', skipIgnores: false });
  assert.deepEqual(
    all.contentHits.map((h) => h.path).sort(),
    ['.git/b.txt', 'bin.dat', 'keep.txt', 'node_modules/a.txt'],
  );
});

test('区分大小写开关', async () => {
  const { root, w } = tmpTree();
  w('a.txt', 'Target\n');
  assert.equal((await collect(root, { query: 'target' })).contentHits.length, 1);
  assert.equal((await collect(root, { query: 'target', caseSensitive: true })).contentHits.length, 0);
  assert.equal((await collect(root, { query: 'Target', caseSensitive: true })).contentHits.length, 1);
});

test('空 query 只发 done 事件且不扫描', async () => {
  const { root, w } = tmpTree();
  w('a.txt', 'x');
  const r = await collect(root, { query: '' });
  assert.deepEqual(r.types, ['done']);
  assert.equal(r.scanned, 0);
});

test('单个字母/单字分词被忽略', async () => {
  const { root, w } = tmpTree();
  w('a.txt', 'x\nfoo\n');
  const r = await collect(root, { query: 'x foo' });
  assert.deepEqual(r.contentHits.map((h) => h.line), [2]);
  assert.deepEqual(r.nameHits, []);
});

test('searchName=false 只搜内容，searchContent=false 只搜文件名', async () => {
  const { root, w } = tmpTree();
  w('target.md', '# target\n');
  const onlyContent = await collect(root, { query: 'target', searchName: false });
  assert.deepEqual(onlyContent.nameHits, []);
  assert.equal(onlyContent.contentHits.length, 1);
  const onlyName = await collect(root, { query: 'target', searchContent: false });
  assert.deepEqual(onlyName.nameHits, [{ path: 'target.md', name: 'target.md' }]);
  assert.deepEqual(onlyName.contentHits, []);
});

test('两种模式都关：只发 done', async () => {
  const { root, w } = tmpTree();
  w('a.txt', 'target\n');
  const r = await collect(root, { query: 'target', searchName: false, searchContent: false });
  assert.deepEqual(r.types, ['done']);
});

test('收集器 searchProject 聚合事件', async () => {
  const { root, w } = tmpTree();
  w('target.md', '# target\n');
  const r = await searchProject(root, { query: 'target' });
  assert.equal(r.nameHits.length, 1);
  assert.equal(r.contentHits.length, 1);
  assert.ok(r.scanned >= 1);
});

test('IGNORE_DIRS 覆盖常见目录', () => {
  for (const d of ['node_modules', '.git', 'dist', 'dist-portable', 'build', 'out', 'coverage']) {
    assert.ok(IGNORE_DIRS.has(d), d);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/project-search.test.js`
Expected: FAIL（`streamProject` / `searchProject` 导出不存在或签名不符）。

- [ ] **Step 3: 改写 `server/project-search.js`**

把整个文件替换为：

```js
import fsp from 'node:fs/promises';
import path from 'node:path';

// 搜索时跳过的常见目录（按目录名精确匹配）
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-portable', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.idea', '.vscode',
]);

// 按空白拆成多个分词；单个字母/单字（长度 < 2）一律忽略
export function splitTerms(query, caseSensitive = false) {
  const out = [];
  for (const raw of String(query).trim().split(/\s+/)) {
    if (raw.length < 2) continue;
    const t = caseSensitive ? raw : raw.toLowerCase();
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// 读前 64KB，判断是否含 NUL（二进制）
async function probeBinary(abs, size) {
  const len = Math.min(size, 64 * 1024);
  if (len <= 0) return false;
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    return buf.includes(0);
  } finally {
    await fh.close();
  }
}

// 异步流式遍历 root，边扫边 yield 事件；不设任何上限、不截断。
// 事件：{type:'name',hits}/{type:'content',path,name,lines}/{type:'progress',scanned}/{type:'done',scanned}
// path 一律用 POSIX 风格相对路径；skipIgnores=false 时连忽略目录与二进制也搜。
export async function* streamProject(root, { query = '', caseSensitive = false, searchName = true, searchContent = true, skipIgnores = true } = {}) {
  const terms = splitTerms(query, caseSensitive);
  if (!terms.length || (!searchName && !searchContent)) { yield { type: 'done', scanned: 0 }; return; }

  const rootResolved = path.resolve(root);
  const stack = [''];
  let scanned = 0;
  let sinceProgress = 0;

  while (stack.length) {
    const relDir = stack.pop();
    const absDir = relDir ? path.join(rootResolved, relDir) : rootResolved;
    let entries;
    try { entries = await fsp.readdir(absDir, { withFileTypes: true }); } catch { continue; }

    const nameBatch = [];
    for (const d of entries) {
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (skipIgnores && IGNORE_DIRS.has(d.name)) continue;
        if (d.isSymbolicLink()) continue;
        stack.push(rel);
        continue;
      }
      if (!d.isFile()) continue;
      scanned++;
      sinceProgress++;

      if (searchName) {
        const nameHay = caseSensitive ? d.name : d.name.toLowerCase();
        for (const t of terms) {
          if (nameHay.includes(t)) { nameBatch.push({ path: rel, name: d.name }); break; }
        }
      }

      if (!searchContent) continue;
      const absFile = path.join(rootResolved, rel);
      let st;
      try { st = await fsp.stat(absFile); } catch { continue; }
      if (skipIgnores) {
        try { if (await probeBinary(absFile, st.size)) continue; } catch { continue; }
      }
      let text;
      try { text = await fsp.readFile(absFile, 'utf8'); } catch { continue; }
      const lines = text.split(/\r?\n/);
      const hitLines = [];
      for (let i = 0; i < lines.length; i++) {
        const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
        for (const t of terms) {
          if (hay.includes(t)) { hitLines.push({ line: i + 1, text: lines[i] }); break; }
        }
      }
      if (hitLines.length) yield { type: 'content', path: rel, name: d.name, lines: hitLines };

      if (sinceProgress >= 200) { sinceProgress = 0; yield { type: 'progress', scanned }; }
    }
    if (nameBatch.length) yield { type: 'name', hits: nameBatch };
  }
  yield { type: 'done', scanned };
}

// 便捷收集器：消费生成器并聚合为 { nameHits, contentHits, scanned }
export async function searchProject(root, opts) {
  const nameHits = [];
  const contentHits = [];
  let scanned = 0;
  for await (const ev of streamProject(root, opts)) {
    if (ev.type === 'name') nameHits.push(...ev.hits);
    else if (ev.type === 'content') for (const l of ev.lines) contentHits.push({ path: ev.path, name: ev.name, line: l.line, text: l.text });
    else if (ev.type === 'done') scanned = ev.scanned;
  }
  return { nameHits, contentHits, scanned };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/test/project-search.test.js`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add server/project-search.js server/test/project-search.test.js
git commit -m "feat(search): 后端改为流式扫描，去除所有截断与大小限制"
```

---

## Task 2: HTTP 流式端点（`server/http-api.js`）

**Files:**
- Modify: `server/http-api.js`（导入、NDJSON 助手、`/api/search` 分支、`handleFiles` 加 `/search`）
- Test: `server/test/notepad-http.test.js`

- [ ] **Step 1: 先加失败测试**

在 `server/test/notepad-http.test.js` 末尾追加（并在文件顶部 import 无需改动，已有 `createNotepadStore`/`createHttpApi`）：

```js
function callText(port, p) {
  return fetch(`http://127.0.0.1:${port}${p}`).then(async (res) => ({
    status: res.status,
    ctype: res.headers.get('content-type') || '',
    text: await res.text(),
  }));
}

test('notepad：/api/notepad/search 流式返回 NDJSON 事件', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  await call(A.port, 'POST', '/api/notepad/file', { folder: '', name: 'a.txt' });
  await call(A.port, 'PUT', '/api/notepad/file', { id: 'a.txt', content: 'target line\nother\n' });
  const r = await callText(A.port, '/api/notepad/search?q=target&name=1&content=1');
  assert.equal(r.status, 200);
  assert.match(r.ctype, /application\/x-ndjson/);
  const evs = r.text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(evs.some((e) => e.type === 'name' && e.hits.some((h) => h.path === 'a.txt')));
  assert.ok(evs.some((e) => e.type === 'content' && e.path === 'a.txt'));
  assert.equal(evs.at(-1).type, 'done');

  const bad = await callText(A.port, '/api/notepad/search?q=');
  assert.equal(bad.status, 400);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/notepad-http.test.js`
Expected: FAIL（`/api/notepad/search` 返回 404 普通 JSON）。

- [ ] **Step 3: 改 `server/http-api.js` 的导入**

把第 17 行：

```js
import { searchProject } from './project-search.js';
```

改为：

```js
import { streamProject } from './project-search.js';
```

- [ ] **Step 4: 在 `sendJson` 之后加 NDJSON 助手**

在 `const sendJson = (res, status, obj) => { ... };`（约 49-52 行）之后加：

```js
  const NDJSON_HEADERS = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' };
  const startNdjson = (res) => { res.writeHead(200, NDJSON_HEADERS); };
  const writeNdjson = (res, ev) => { if (!res.writableEnded) res.write(JSON.stringify(ev) + '\n'); };
  // 把一次搜索以 NDJSON 流写出；客户端断开即停止消费生成器。
  const streamSearchTo = async (res, root, opts) => {
    startNdjson(res);
    let closed = false;
    res.on('close', () => { closed = true; });
    try {
      for await (const ev of streamProject(root, opts)) {
        if (closed || res.writableEnded) break;
        writeNdjson(res, ev);
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  };
```

- [ ] **Step 5: 改 `/api/search` 分支（约 180-193 行）**

把整段：

```js
      if (url.pathname === '/api/search' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) { sendJson(res, 400, { error: 'q required' }); return; }
        const cs = url.searchParams.get('case');
        const caseSensitive = cs === '1' || cs === 'true';
        const nameParam = url.searchParams.get('name');
        const contentParam = url.searchParams.get('content');
        const searchName = nameParam !== '0' && nameParam !== 'false';
        const searchContent = contentParam !== '0' && contentParam !== 'false';
        const root = projects.rootOf(project);
        sendJson(res, 200, searchProject(root, { query: q, caseSensitive, searchName, searchContent }));
        return;
      }
```

替换为：

```js
      if (url.pathname === '/api/search' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) { sendJson(res, 400, { error: 'q required' }); return; }
        const caseSensitive = ['1', 'true'].includes(url.searchParams.get('case'));
        const searchName = !['0', 'false'].includes(url.searchParams.get('name'));
        const searchContent = !['0', 'false'].includes(url.searchParams.get('content'));
        const skipIgnores = !['1', 'true'].includes(url.searchParams.get('all'));
        const root = projects.rootOf(project);
        await streamSearchTo(res, root, { query: q, caseSensitive, searchName, searchContent, skipIgnores });
        return;
      }
```

- [ ] **Step 6: 给 `handleFiles` 加 `/search` 分支**

在 `handleFiles` 内、`if (sub === '/tree' && req.method === 'GET') { ... }` 这段之后加：

```js
      if (sub === '/search' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) { sendJson(res, 400, { error: 'q required' }); return; }
        const caseSensitive = ['1', 'true'].includes(url.searchParams.get('case'));
        const searchName = !['0', 'false'].includes(url.searchParams.get('name'));
        const searchContent = !['0', 'false'].includes(url.searchParams.get('content'));
        const skipIgnores = !['1', 'true'].includes(url.searchParams.get('all'));
        await streamSearchTo(res, store?.dir, { query: q, caseSensitive, searchName, searchContent, skipIgnores });
        return;
      }
```

- [ ] **Step 7: 运行测试确认通过**

Run: `node --test server/test/notepad-http.test.js`
Expected: PASS。

- [ ] **Step 8: 回归后端全套**

Run: `npm.cmd run test:server`
Expected: PASS（全部后端测试）。

- [ ] **Step 9: 提交**

```bash
git add server/http-api.js server/test/notepad-http.test.js
git commit -m "feat(search): /api/search 与工具目录搜索改为流式 NDJSON"
```

---

## Task 3: 前端契约 + 项目搜索 + 面板流式化 + i18n

**Files:**
- Modify: `web/src/tree/treeSource.ts`
- Create: `web/src/search/streamSearch.ts`
- Modify: `web/src/search/projectSearch.ts`
- Modify: `web/src/tree/projectTreeSource.ts`
- Modify: `web/src/search/FileSearchPanel.vue`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- Test: `web/src/tree/projectTreeSource.test.ts`、`web/src/search/FileSearchPanel.test.ts`

- [ ] **Step 1: 改契约 `web/src/tree/treeSource.ts`**

把第 11-19 行：

```ts
export interface SearchNameHit { path: string; name: string; }
export interface SearchContentHit { path: string; name: string; line: number; text: string; }
export interface SearchResult {
  nameHits: SearchNameHit[];
  contentHits: SearchContentHit[];
  truncated: boolean;
  scanned: number;
}
export interface SearchHit { path: string; name: string; line?: number; }
```

替换为：

```ts
export interface SearchNameHit { path: string; name: string; }
export interface SearchLine { line: number; text: string; }
export type SearchEvent =
  | { type: 'name'; hits: SearchNameHit[] }
  | { type: 'content'; path: string; name: string; lines: SearchLine[] }
  | { type: 'progress'; scanned: number }
  | { type: 'done'; scanned: number };
export interface SearchHit { path: string; name: string; line?: number; }
```

并把第 37 行：

```ts
  search?(query: string, opts: { caseSensitive: boolean; name: boolean; content: boolean }): Promise<SearchResult>;
```

替换为：

```ts
  search?(query: string, opts: { caseSensitive: boolean; name: boolean; content: boolean; all: boolean }, signal?: AbortSignal): AsyncIterable<SearchEvent>;
```

- [ ] **Step 2: 新建 `web/src/search/streamSearch.ts`**

```ts
import type { SearchEvent } from '../tree/treeSource';

// 逐行读取 NDJSON 响应体，边读边产出搜索事件。
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<SearchEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line) as SearchEvent;
    }
  }
  buf += decoder.decode();
  const tail = buf.trim();
  if (tail) yield JSON.parse(tail) as SearchEvent;
}

// fetch 一个流式搜索 URL 并产出事件；非 2xx 抛出 {error} 文案。
export async function* streamSearch(url: string, signal?: AbortSignal): AsyncGenerator<SearchEvent> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  if (!res.body) return;
  yield* readNdjson(res.body);
}
```

- [ ] **Step 3: 改 `web/src/search/projectSearch.ts` 为生成器**

整个文件替换为：

```ts
import type { SearchEvent } from '../tree/treeSource';
import { streamSearch } from './streamSearch';

// 调 GET /api/search：项目内按文件名和/或内容流式搜索（结果以 NDJSON 增量返回）。
export function searchProject(
  projectId: string,
  query: string,
  opts: { caseSensitive: boolean; name: boolean; content: boolean; all: boolean },
  signal?: AbortSignal,
): AsyncGenerator<SearchEvent> {
  const url = `/api/search?project=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}&case=${opts.caseSensitive ? 1 : 0}&name=${opts.name ? 1 : 0}&content=${opts.content ? 1 : 0}&all=${opts.all ? 1 : 0}`;
  return streamSearch(url, signal);
}
```

- [ ] **Step 4: 改 `web/src/tree/projectTreeSource.ts`**

第 4 行的导入：

```ts
import type { TreeSource, SearchResult, SearchHit } from './treeSource';
```

改为：

```ts
import type { TreeSource, SearchHit, SearchEvent } from './treeSource';
```

把第 45-48 行：

```ts
    async search(query: string, o: { caseSensitive: boolean; name: boolean; content: boolean }): Promise<SearchResult> {
      if (!pid) return { nameHits: [], contentHits: [], truncated: false, scanned: 0 };
      return searchProject(pid, query, o);
    },
```

替换为：

```ts
    search(query: string, o: { caseSensitive: boolean; name: boolean; content: boolean; all: boolean }, signal?: AbortSignal): AsyncGenerator<SearchEvent> {
      if (!pid) return (async function* (): AsyncGenerator<SearchEvent> { yield { type: 'done', scanned: 0 }; })();
      return searchProject(pid, query, o, signal);
    },
```

- [ ] **Step 5: 改 `web/src/search/FileSearchPanel.vue` 为流式 + `all` 勾选**

`<script setup>` 块（第 1-93 行）整体替换为：

```vue
<script setup lang="ts">
import { computed, ref, onBeforeUnmount, watch } from 'vue';
import type { TreeSource, SearchNameHit, SearchLine } from '../tree/treeSource';

// 左侧内嵌搜索面板：替换目录树显示，右上角关闭后恢复目录；可勾选按内容/文件名搜索。
// 结果流式增量渲染（服务端 NDJSON），不截断；命中过多时仅提示。
const props = defineProps<{ source: TreeSource }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const query = ref('');
const caseSensitive = ref(false);
const byContent = ref(true);   // 默认搜文件内容
const byName = ref(true);      // 默认也搜文件名
const all = ref(false);        // 默认跳过忽略目录/二进制
const loading = ref(false);
const error = ref('');
const scanned = ref(0);
const done = ref(false);
const nameHits = ref<SearchNameHit[]>([]);
const contentGroups = ref<{ path: string; name: string; lines: SearchLine[] }[]>([]);
const collapsed = ref<Set<string>>(new Set());
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
let ctrl: AbortController | null = null;

const keyword = computed(() => query.value.trim());
const searched = computed(() => keyword.value.length > 0);
const terms = computed(() => keyword.value.split(/\s+/).filter((t) => t.length >= 2));   // 空格分词；单个字母/单字忽略
const anyMode = computed(() => byContent.value || byName.value);
const started = computed(() => nameHits.value.length > 0 || contentGroups.value.length > 0);
const contentHitCount = computed(() => contentGroups.value.reduce((n, g) => n + g.lines.length, 0));
const totalHits = computed(() => nameHits.value.length + contentHitCount.value);
const tooMany = computed(() => totalHits.value >= 2000);

function reset() {
  nameHits.value = [];
  contentGroups.value = [];
  scanned.value = 0;
  done.value = false;
  error.value = '';
}
function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void run(); }, 300);
}
async function run() {
  if (timer) { clearTimeout(timer); timer = null; }
  ctrl?.abort();
  const q = keyword.value;
  const my = ++seq;
  if (!q || !terms.value.length || !anyMode.value || !props.source.search) {
    reset(); loading.value = false; return;
  }
  reset();
  loading.value = true;
  const myCtrl = new AbortController();
  ctrl = myCtrl;
  try {
    const stream = props.source.search(q, { caseSensitive: caseSensitive.value, name: byName.value, content: byContent.value, all: all.value }, myCtrl.signal);
    for await (const ev of stream) {
      if (my !== seq) return;
      if (ev.type === 'name') nameHits.value = [...nameHits.value, ...ev.hits];
      else if (ev.type === 'content') contentGroups.value = [...contentGroups.value, { path: ev.path, name: ev.name, lines: ev.lines }];
      else scanned.value = ev.scanned;
    }
    if (my === seq) done.value = true;
  } catch (e: unknown) {
    if (my !== seq) return;
    if ((e as Error)?.name === 'AbortError') return;
    error.value = String((e as Error)?.message || e);
  } finally {
    if (my === seq) loading.value = false;
  }
}
watch(query, schedule);
watch([caseSensitive, byContent, byName, all], () => { if (searched.value) void run(); });
onBeforeUnmount(() => ctrl?.abort());

function toggle(path: string) {
  const s = new Set(collapsed.value);
  if (s.has(path)) s.delete(path); else s.add(path);
  collapsed.value = s;
}
function pick(hit: { path: string; name: string; line?: number }) {
  props.source.openHit?.(hit);
}
// 命中分词分段（任一分词命中即高亮），供模板高亮
function segments(text: string): { text: string; hit: boolean }[] {
  const ts = terms.value;
  if (!text || !ts.length) return [{ text, hit: false }];
  const hay = caseSensitive.value ? text : text.toLowerCase();
  const mask = new Array<boolean>(text.length).fill(false);
  for (const t of ts) {
    const needle = caseSensitive.value ? t : t.toLowerCase();
    let from = 0;
    for (;;) {
      const i = hay.indexOf(needle, from);
      if (i < 0) break;
      for (let k = i; k < i + needle.length; k++) mask[k] = true;
      from = i + needle.length;
    }
  }
  const out: { text: string; hit: boolean }[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || mask[i] !== mask[start]) { out.push({ text: text.slice(start, i), hit: mask[start] }); start = i; }
  }
  return out;
}
</script>
```

`<template>` 块（第 95-142 行）整体替换为：

```vue
<template>
  <div class="fsp">
    <div class="fsbar">
      <input v-model="query" class="sinput" type="search" :placeholder="$t('search.placeholder')" spellcheck="false" @keydown.enter="run" />
      <button class="fsclose" :title="$t('search.close')" @click="emit('close')">×</button>
    </div>
    <div class="fsmodes">
      <label class="scase" :title="$t('search.mode.content')"><input data-mode="content" v-model="byContent" type="checkbox" /><span>{{ $t('search.mode.content') }}</span></label>
      <label class="scase" :title="$t('search.mode.name')"><input data-mode="name" v-model="byName" type="checkbox" /><span>{{ $t('search.mode.name') }}</span></label>
      <label class="scase" :title="$t('search.case')"><input data-mode="case" v-model="caseSensitive" type="checkbox" /><span>{{ $t('search.case') }}</span></label>
      <label class="scase" :title="$t('search.include_ignored')"><input data-mode="all" v-model="all" type="checkbox" /><span>{{ $t('search.include_ignored') }}</span></label>
    </div>
    <div class="sbody">
      <div v-if="!searched" class="shint">{{ $t('search.hint') }}</div>
      <div v-else-if="!terms.length" class="shint">{{ $t('search.too_short') }}</div>
      <div v-else-if="!anyMode" class="shint">{{ $t('search.need_mode') }}</div>
      <div v-else-if="error" class="serr">{{ $t('search.error', { msg: error }) }}</div>
      <div v-else-if="loading && !started" class="shint">{{ $t('search.loading') }}</div>
      <div v-else-if="done && !started" class="shint">{{ $t('search.empty') }}</div>
      <template v-else>
        <section v-if="nameHits.length" class="sgroup">
          <div class="sghead">{{ $t('search.name_group') }} <span class="scount">{{ nameHits.length }}</span></div>
          <button v-for="h in nameHits" :key="'n:' + h.path" class="sname-row" :title="$t('search.open_file')" @click="pick({ path: h.path, name: h.name })">
            <span class="sic">📄</span><span class="spath">{{ h.path }}</span>
          </button>
        </section>
        <section v-if="contentGroups.length" class="sgroup">
          <div class="sghead">{{ $t('search.content_group') }} <span class="scount">{{ contentHitCount }}</span></div>
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
        <div class="sfoot">{{ $t('search.scanned', { n: scanned }) }}</div>
        <div v-if="loading" class="sfoot">{{ $t('search.loading') }}</div>
      </template>
      <div v-if="tooMany" class="strunc">{{ $t('search.too_many') }}</div>
    </div>
  </div>
</template>
```

`<style scoped>` 块保持不变。

- [ ] **Step 6: 改 i18n 词条**

`shared/i18n/zh-CN.js` 把：

```js
  'search.truncated': '结果过多，已截断',
  'search.scanned': '已扫描 {n} 个文件',
```

改为：

```js
  'search.too_many': '结果较多，界面可能变慢',
  'search.scanned': '已扫描 {n} 个文件',
  'search.include_ignored': '包含忽略目录/二进制',
```

`shared/i18n/en.js` 把：

```js
  'search.truncated': 'Too many results, truncated',
  'search.scanned': 'Scanned {n} files',
```

改为：

```js
  'search.too_many': 'Many results; the UI may slow down',
  'search.scanned': 'Scanned {n} files',
  'search.include_ignored': 'Include ignored dirs & binaries',
```

- [ ] **Step 7: 更新 `web/src/tree/projectTreeSource.test.ts`**

把 `describe('projectTreeSource.search', ...)` 整段（第 43-59 行）替换为：

```ts
describe('projectTreeSource.search', () => {
  it('按 project/q/case/name/content/all 请求 /api/search 并流式返回事件', async () => {
    const events: SearchEvent[] = [
      { type: 'name', hits: [{ path: 'a.txt', name: 'a.txt' }] },
      { type: 'done', scanned: 3 },
    ];
    const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, body }));
    vi.stubGlobal('fetch', fetchMock);
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const got: SearchEvent[] = [];
    for await (const ev of src.search!('target', { caseSensitive: true, name: true, content: false, all: false })) got.push(ev);
    expect(got).toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith('/api/search?project=p1&q=target&case=1&name=1&content=0&all=0', { signal: undefined });
  });

  it('请求失败抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })));
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const gen = src.search!('x', { caseSensitive: false, name: true, content: true, all: false });
    await expect((async () => { for await (const _ of gen) { /* drain */ } })()).rejects.toThrow('boom');
  });
});
```

并在文件顶部第 2 行 import 下补：

```ts
import type { SearchEvent } from './treeSource';
```

- [ ] **Step 8: 更新 `web/src/search/FileSearchPanel.test.ts`**

整个文件替换为：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import FileSearchPanel from './FileSearchPanel.vue';
import type { TreeSource, SearchEvent } from '../tree/treeSource';

function fakeSource(over: Partial<TreeSource> = {}): TreeSource {
  return { async loadChildren() { return []; }, open: vi.fn(), ...over };
}

function streamOf(events: SearchEvent[]): AsyncGenerator<SearchEvent> {
  return (async function* () { for (const ev of events) yield ev; })();
}

const EVENTS: SearchEvent[] = [
  { type: 'name', hits: [{ path: 'target.md', name: 'target.md' }] },
  { type: 'content', path: 'src/a.js', name: 'a.js', lines: [{ line: 2, text: 'const target = 1;' }] },
  { type: 'content', path: 'src/b.js', name: 'b.js', lines: [{ line: 5, text: 'target()' }] },
  { type: 'done', scanned: 9 },
];

function mountPanel(src: TreeSource) {
  return mountC(FileSearchPanel, { props: { source: src } });
}

describe('FileSearchPanel', () => {
  it('默认勾选「文件内容」与「文件名」，回车按两者都搜并流式渲染结果', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    expect((w.find('[data-mode="name"]').element as HTMLInputElement).checked).toBe(true);
    expect((w.find('[data-mode="content"]').element as HTMLInputElement).checked).toBe(true);
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(src.search).toHaveBeenCalledWith('target', { caseSensitive: false, name: true, content: true, all: false }, expect.anything());
    expect(w.findAll('.sname-row').length).toBe(1);
    expect(w.findAll('.scgroup').length).toBe(2);
    expect(w.findAll('.sline').length).toBe(2);
  });

  it('取消勾选「文件名」后重搜只带 content', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.find('[data-mode="name"]').setValue(false);
    await flushPromises();
    expect(src.search).toHaveBeenLastCalledWith('target', { caseSensitive: false, name: false, content: true, all: false }, expect.anything());
  });

  it('勾选「包含忽略目录/二进制」后重搜带 all:true', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.find('[data-mode="all"]').setValue(true);
    await flushPromises();
    expect(src.search).toHaveBeenLastCalledWith('target', { caseSensitive: false, name: true, content: true, all: true }, expect.anything());
  });

  it('两种模式都不勾选时不发起搜索并提示', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('[data-mode="name"]').setValue(false);
    await w.find('[data-mode="content"]').setValue(false);
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(src.search).not.toHaveBeenCalled();
    expect(w.find('.shint').exists()).toBe(true);
  });

  it('单个字母/单字分词不发起搜索并提示', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('a');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(src.search).not.toHaveBeenCalled();
    expect(w.find('.shint').exists()).toBe(true);
  });

  it('命中过多时提示但不截断（保留全部命中）', async () => {
    const many: SearchEvent[] = [
      { type: 'name', hits: Array.from({ length: 2001 }, (_, i) => ({ path: `f${i}.txt`, name: `f${i}.txt` })) },
      { type: 'done', scanned: 2001 },
    ];
    const src = fakeSource({ search: vi.fn(() => streamOf(many)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    expect(w.findAll('.sname-row').length).toBe(2001);
    expect(w.find('.strunc').exists()).toBe(true);
  });

  it('点内容命中行调用 openHit 带 line，且不关闭面板', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.sinput').setValue('target');
    await w.find('.sinput').trigger('keydown.enter');
    await flushPromises();
    await w.findAll('.sline')[0].trigger('click');
    expect(src.openHit).toHaveBeenCalledWith({ path: 'src/a.js', name: 'a.js', line: 2 });
    expect(w.emitted('close')).toBeUndefined();
  });

  it('点右上角关闭按钮 emit close', async () => {
    const src = fakeSource({ search: vi.fn(() => streamOf(EVENTS)), openHit: vi.fn() });
    const w = mountPanel(src);
    await flushPromises();
    await w.find('.fsclose').trigger('click');
    expect(w.emitted('close')).toBeTruthy();
  });
});
```

- [ ] **Step 9: 运行前端相关测试确认通过**

Run: `npm --prefix web run test -- src/tree/projectTreeSource.test.ts src/search/FileSearchPanel.test.ts`
Expected: PASS。

- [ ] **Step 10: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 仅 `postmanTreeSource.ts` / `navicatTreeSource.ts` 报 `SearchResult` 未定义（Task 5 会修复），其余文件全部通过。若还有其它 `SearchResult` 引用报错，一并改为 `SearchEvent`。

- [ ] **Step 11: 提交**

```bash
git add web/src/tree/treeSource.ts web/src/search/streamSearch.ts web/src/search/projectSearch.ts web/src/tree/projectTreeSource.ts web/src/search/FileSearchPanel.vue web/src/tree/projectTreeSource.test.ts web/src/search/FileSearchPanel.test.ts shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(search): 前端改为流式增量渲染，新增包含忽略目录勾选"
```

---

## Task 4: 小工具文件搜索（`toolFileTreeSource`）

**Files:**
- Modify: `web/src/tools/files/useToolFiles.ts`（返回 `tool`）
- Modify: `web/src/tree/toolFileTreeSource.ts`（实现 `search` / `openHit`）
- Test: `web/src/tree/toolFileTreeSource.test.ts`

- [ ] **Step 1: 加失败测试**

在 `web/src/tree/toolFileTreeSource.test.ts` 第 2 行 import 下补：

```ts
import type { SearchEvent } from './treeSource';
```

在 `describe('toolFileTreeSource', ...)` 内追加：

```ts
  it('search 调 /api/files/<tool>/search 流式返回事件；openHit 打开文件', async () => {
    const events: SearchEvent[] = [
      { type: 'name', hits: [{ path: 'a.txt', name: 'a.txt' }] },
      { type: 'content', path: 'a.txt', name: 'a.txt', lines: [{ line: 1, text: 'target' }] },
      { type: 'done', scanned: 1 },
    ];
    const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, body }));
    vi.stubGlobal('fetch', fetchMock);
    const files = useToolFiles('notepad');
    const onOpen = vi.fn();
    const src = toolFileTreeSource(files, { onOpen });
    const got: SearchEvent[] = [];
    for await (const ev of src.search!('target', { caseSensitive: false, name: true, content: true, all: false })) got.push(ev);
    expect(got).toEqual(events);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/files/notepad/search?');
    src.openHit!({ path: 'a.txt', name: 'a.txt' });
    expect(onOpen).toHaveBeenCalledWith({ key: 'a.txt', name: 'a.txt', kind: 'item' });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix web run test -- src/tree/toolFileTreeSource.test.ts`
Expected: FAIL（`src.search` undefined）。

- [ ] **Step 3: `useToolFiles` 返回 `tool`**

`web/src/tools/files/useToolFiles.ts`：
- 返回类型第 3 行区域加一行。把：

```ts
export function useToolFiles(tool: FileTool): {
  folders: Ref<string[]>;
```

改为：

```ts
export function useToolFiles(tool: FileTool): {
  tool: FileTool;
  folders: Ref<string[]>;
```

- 文件末尾把：

```ts
  return { folders, items, load, read, save, createFile, createFolder, renameFolder, removeFolder, renameItem, removeItem, moveItem };
```

改为：

```ts
  return { tool, folders, items, load, read, save, createFile, createFolder, renameFolder, removeFolder, renameItem, removeItem, moveItem };
```

- [ ] **Step 4: `toolFileTreeSource` 实现 `search` / `openHit`**

`web/src/tree/toolFileTreeSource.ts`：
- 顶部 import 下补：

```ts
import type { SearchEvent } from './treeSource';
import { streamSearch } from '../search/streamSearch';
```

- 在 `return {` 对象里，`copyPath(node) { ... },` 之后加：

```ts
    search(query: string, o: { caseSensitive: boolean; name: boolean; content: boolean; all: boolean }, signal?: AbortSignal): AsyncGenerator<SearchEvent> {
      const p = new URLSearchParams({ q: query, case: o.caseSensitive ? '1' : '0', name: o.name ? '1' : '0', content: o.content ? '1' : '0', all: o.all ? '1' : '0' });
      return streamSearch(`/api/files/${files.tool}/search?${p.toString()}`, signal);
    },
    openHit(hit) { hooks.onOpen({ key: hit.path, name: hit.name, kind: 'item' }); },
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm --prefix web run test -- src/tree/toolFileTreeSource.test.ts src/tools/files/useToolFiles.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/tools/files/useToolFiles.ts web/src/tree/toolFileTreeSource.ts web/src/tree/toolFileTreeSource.test.ts
git commit -m "feat(search): 文件型小工具补齐同款流式搜索"
```

---

## Task 5: postman / navicat 搜索适配流式契约

**Files:**
- Modify: `web/src/tools/postman/postmanTreeSource.ts`
- Modify: `web/src/tools/navicat/navicatTreeSource.ts`
- Test: `web/src/tools/postman/postmanTreeSource.test.ts`、`web/src/tools/navicat/navicatTreeSource.test.ts`

- [ ] **Step 1: 改 `postmanTreeSource.ts`**

第 2 行 import：

```ts
import type { TreeSource, TreeSourceNode, SearchResult, SearchHit } from '../../tree/treeSource';
```

改为：

```ts
import type { TreeSource, TreeSourceNode, SearchEvent, SearchNameHit, SearchLine, SearchHit } from '../../tree/treeSource';
```

把 `searchRecords` 函数（第 35-57 行）整段删除，并把第 96 行：

```ts
    async search(query, o): Promise<SearchResult> { return searchRecords(deps.history(), query, o); },
```

替换为：

```ts
    async *search(query, o): AsyncGenerator<SearchEvent> {
      void o.all;
      const terms = splitTerms(query, o.caseSensitive);
      if (!terms.length || (!o.name && !o.content)) { yield { type: 'done', scanned: 0 }; return; }
      const hayOf = (s: string) => (o.caseSensitive ? s : s.toLowerCase());
      const nameHits: SearchNameHit[] = [];
      let scanned = 0;
      for (const r of deps.history()) {
        scanned++;
        const label = labelOf(r);
        if (o.name && terms.some((t) => hayOf(label).includes(t))) nameHits.push({ path: r.id, name: label });
        if (o.content) {
          const lines = JSON.stringify(r, null, 2).split('\n');
          const hitLines: SearchLine[] = [];
          for (let i = 0; i < lines.length; i++) if (terms.some((t) => hayOf(lines[i]).includes(t))) hitLines.push({ line: i + 1, text: lines[i] });
          if (hitLines.length) yield { type: 'content', path: r.id, name: label, lines: hitLines };
        }
      }
      if (nameHits.length) yield { type: 'name', hits: nameHits };
      yield { type: 'done', scanned };
    },
```

- [ ] **Step 2: 改 `navicatTreeSource.ts`**

第 2 行 import：

```ts
import type { TreeSource, TreeSourceNode, SearchResult, SearchHit } from '../../tree/treeSource';
```

改为：

```ts
import type { TreeSource, TreeSourceNode, SearchEvent, SearchNameHit, SearchLine, SearchHit } from '../../tree/treeSource';
```

把 `searchProfiles` 函数（第 37-56 行）整段删除，并把第 89 行：

```ts
    async search(query, o): Promise<SearchResult> { return searchProfiles(deps.profiles(), query, o); },
```

替换为：

```ts
    async *search(query, o): AsyncGenerator<SearchEvent> {
      void o.all;
      const terms = splitTerms(query, o.caseSensitive);
      if (!terms.length || (!o.name && !o.content)) { yield { type: 'done', scanned: 0 }; return; }
      const hayOf = (s: string) => (o.caseSensitive ? s : s.toLowerCase());
      const nameHits: SearchNameHit[] = [];
      let scanned = 0;
      for (const p of deps.profiles()) {
        scanned++;
        const key = cKey(String(p.id));
        if (o.name && terms.some((t) => hayOf(p.name).includes(t))) nameHits.push({ path: key, name: p.name });
        if (o.content) {
          const lines = JSON.stringify(p, null, 2).split('\n');
          const hitLines: SearchLine[] = [];
          for (let i = 0; i < lines.length; i++) if (terms.some((t) => hayOf(lines[i]).includes(t))) hitLines.push({ line: i + 1, text: lines[i] });
          if (hitLines.length) yield { type: 'content', path: key, name: p.name, lines: hitLines };
        }
      }
      if (nameHits.length) yield { type: 'name', hits: nameHits };
      yield { type: 'done', scanned };
    },
```

- [ ] **Step 3: 改 postman 测试的 search 用例**

`web/src/tools/postman/postmanTreeSource.test.ts` 把第 61-70 行的 `it('search：...')` 替换为：

```ts
  it('search：名字命中与内容命中；openHit 打开记录', async () => {
    const recs = [REC('a.json', 'curl https://target.com', '', 'Alpha'), REC('b.json', 'curl other', '', 'Beta')];
    const { src, opened } = make(recs, []);
    const nameHits: SearchEvent[] = [];
    for await (const ev of src.search!('alpha', { caseSensitive: false, name: true, content: false, all: false })) nameHits.push(ev);
    expect(nameHits.flatMap((e) => (e.type === 'name' ? e.hits : []))).toEqual([{ path: 'a.json', name: 'Alpha' }]);
    const paths: SearchEvent[] = [];
    for await (const ev of src.search!('target', { caseSensitive: false, name: false, content: true, all: false })) paths.push(ev);
    expect(paths.flatMap((e) => (e.type === 'content' ? [e.path] : []))).toEqual(['a.json']);
    src.openHit!({ path: 'b.json', name: 'Beta' });
    expect(opened[0].id).toBe('b.json');
  });
```

并在文件顶部 import 下补：

```ts
import type { SearchEvent } from '../../tree/treeSource';
```

- [ ] **Step 4: 改 navicat 测试的 search 用例**

`web/src/tools/navicat/navicatTreeSource.test.ts` 把第 42-50 行的 `it('open 表 → pickTable；search/openHit → 选中连接', ...)` 替换为：

```ts
  it('open 表 → pickTable；search/openHit → 选中连接', async () => {
    const { src, picked, opened } = make();
    src.open({ key: 't:1\u0000db1\u0000users', name: 'users', kind: 'item' });
    expect(picked).toEqual(['1:db1:users']);
    const hits: SearchEvent[] = [];
    for await (const ev of src.search!('alp', { caseSensitive: false, name: true, content: false, all: false })) hits.push(ev);
    expect(hits.flatMap((e) => (e.type === 'name' ? e.hits.map((h) => h.path) : []))).toEqual(['c:1']);
    src.openHit!({ path: 'c:1', name: 'Alpha' });
    expect(opened).toEqual(['c:1']);
  });
```

并在文件顶部 import 下补：

```ts
import type { SearchEvent } from '../../tree/treeSource';
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm --prefix web run test -- src/tools/postman/postmanTreeSource.test.ts src/tools/navicat/navicatTreeSource.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/tools/postman/postmanTreeSource.ts web/src/tools/navicat/navicatTreeSource.ts web/src/tools/postman/postmanTreeSource.test.ts web/src/tools/navicat/navicatTreeSource.test.ts
git commit -m "refactor(search): postman/navicat 搜索适配流式契约"
```

---

## Task 6: 全量校验

**Files:** 无新增。

- [ ] **Step 1: 后端 + 前端全部单测**

Run: `npm.cmd test`
Expected: PASS。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 3: i18n 校验**

Run: `npm.cmd run check:i18n`
Expected: PASS（零中文命中、键集合对称）。

- [ ] **Step 4: 手工冒烟（dev）**

用带 opencode 的终端后台起 dev：

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -RedirectStandardOutput "logs\dev-server.log" -RedirectStandardError "logs\dev-server.err.log"
```

打开 http://localhost:5173 ：
- 目录页签 → 🔍 → 搜大仓库：结果持续增长、底部无「已截断」；「结果较多，界面可能变慢」在命中 ≥2000 时出现。
- 勾选「包含忽略目录/二进制」→ 能搜到 `node_modules` 内文本；取消后搜不到。
- 打开 notepad/yaml/translate 工具页签 → 左侧 🔍 可用，勾选/搜索行为与项目一致。

- [ ] **Step 5: 提交（如手工冒烟有微调）**

```bash
git add -A
git commit -m "chore(search): 冒烟修正"
```

---

## 备注

- 删除全局排序是流式的必要取舍：结果按目录遍历顺序到达，同文件内容连续。
- 内容命中在文件型小工具里只打开文件、不跳行（工具侧 `DocSource` 无 locate 能力）。
- 本计划不改动工作区里与搜索无关的未提交改动（usage/collaboration 等），提交时只 `git add` 本计划涉及文件。
