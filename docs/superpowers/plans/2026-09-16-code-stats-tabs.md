# 代码统计（页签化 + 实代码行统计）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本仓库 AGENTS.md 要求：默认 inline 执行，无需询问执行方式。

**Goal:** `📊` 页升级为「代码统计」，用 Element Plus `el-tabs` 分「Git 提交统计」「实代码统计」两个页签；目录与过滤项共用一套提到页签上方。

**Architecture:** 新增 `server/code-count.js`（复用 `scripts/count-code.js` 的 `countReal`）+ `POST /api/code/stats`（单目录）。前端新增容器 `CodeStats.vue`（共用输入 + `el-tabs`）、`RealCodeStat.vue`，并把共用输入从 `GitStat.vue` 提到容器（GitStat 改收 props）。

**Tech Stack:** Node ESM、Element Plus 2.14（全局注册）、Vue3 `<script setup lang="ts">`、node:test、vitest。Windows + `npm.cmd`。

**Spec:** `docs/superpowers/specs/2026-09-16-code-stats-tabs-design.md`

---

### Task 1: server —— `code-count.js`（TDD）

**Files:** Create `server/code-count.js`、`server/test/code-count.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectCodeStats } from '../code-count.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfcode-')); }
function w(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('collectCodeStats 按 countReal 口径统计并列文件', async () => {
  const dir = tmp();
  w(dir, 'src/a.js', ['// c', '', '{', 'const a = 1;', '中文', 'foo();'].join('\n'));
  w(dir, 'src/b.js', 'const b = 2;\n');
  const r = await collectCodeStats({ dir });
  assert.equal(r.totals.files, 2);
  const by = Object.fromEntries(r.files.map((f) => [f.rel, f]));
  assert.deepEqual(by['src/a.js'], { rel: 'src/a.js', real: 2, total: 6 });
  assert.deepEqual(by['src/b.js'], { rel: 'src/b.js', real: 1, total: 1 });
  assert.deepEqual(r.groups, [{ key: 'src', real: 3, total: 7, files: 2 }]);
  assert.deepEqual(r.totals, { files: 2, real: 3, total: 7 });
});

test('collectCodeStats filter：exts / excludeDirs / excludeTestFiles', async () => {
  const dir = tmp();
  w(dir, 'src/a.js', 'const a = 1;\n');
  w(dir, 'src/b.py', 'x = 1\n');
  w(dir, 'docs/g.js', 'const g = 1;\n');
  w(dir, 'src/a.test.js', 'const t = 1;\n');
  const r = await collectCodeStats({ dir, filter: { exts: ['.js'], excludeDirs: ['docs'], excludeTestFiles: true } });
  assert.deepEqual(r.files.map((f) => f.rel), ['src/a.js']);
});

test('collectCodeStats 硬跳过 node_modules 与点目录', async () => {
  const dir = tmp();
  w(dir, 'node_modules/x/i.js', 'const i = 1;\n');
  w(dir, '.git/hooks/h.js', 'const h = 1;\n');
  w(dir, 'ok.js', 'const o = 1;\n');
  const r = await collectCodeStats({ dir });
  assert.deepEqual(r.files.map((f) => f.rel), ['ok.js']);
});

test('collectCodeStats 跳过二进制与超 2MiB 文件', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'bin.js'), Buffer.from([0x63, 0x00, 0x6f]));
  fs.writeFileSync(path.join(dir, 'big.js'), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
  w(dir, 'ok.js', 'const o = 1;\n');
  const r = await collectCodeStats({ dir });
  assert.deepEqual(r.files.map((f) => f.rel), ['ok.js']);
});

test('collectCodeStats 根目录文件归 (root) 分组', async () => {
  const dir = tmp();
  w(dir, 'root.js', 'const r = 1;\n');
  const r = await collectCodeStats({ dir });
  assert.equal(r.groups[0].key, '(root)');
});

test('collectCodeStats 非目录/不存在 → not-found；空 dir → bad-dir', async () => {
  const dir = tmp();
  await assert.rejects(() => collectCodeStats({ dir: path.join(dir, 'nope') }), (e) => e.code === 'not-found');
  await assert.rejects(() => collectCodeStats({ dir: '' }), (e) => e.code === 'bad-dir');
  await assert.rejects(() => collectCodeStats({}), (e) => e.code === 'bad-dir');
});

test('collectCodeStats 超过 MAX_FILES 截断', async () => {
  const dir = tmp();
  for (let i = 0; i < 5001; i++) w(dir, `f${i}.js`, `const v${i} = ${i};\n`);
  const r = await collectCodeStats({ dir });
  assert.equal(r.totals.files, 5000);
  assert.equal(r.truncated, true);
});
```

- [ ] **Step 2: 运行确认失败**：`node --test server/test/code-count.test.js` → `Cannot find module '../code-count.js'`

- [ ] **Step 3: 实现 `server/code-count.js`**

```js
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { countReal } from '../scripts/count-code.js';
import { makeKeepPath } from '@devflow/shared/git-filter';

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const HARD_SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-portable', 'env']);
const CONCURRENCY = 16;

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

export function groupKey(rel) {
  const p = rel.split('/');
  return p.length === 1 ? '(root)' : p[0];
}

function listFiles(root) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || HARD_SKIP_DIRS.has(e.name)) continue;
        stack.push(childRel);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  return out;
}

async function countOne(root, rel) {
  const full = path.join(root, rel);
  let st;
  try { st = await fsp.stat(full); } catch { return null; }
  if (st.size > MAX_FILE_BYTES) return null;
  let buf;
  try { buf = await fsp.readFile(full); } catch { return null; }
  if (buf.includes(0)) return null;
  const { real, total } = countReal(buf.toString('utf8'));
  return { rel, real, total };
}

export async function collectCodeStats({ dir, filter } = {}) {
  if (typeof dir !== 'string' || !dir.trim()) throw err('bad-dir', 'dir required');
  const root = dir.trim();
  let st;
  try { st = await fsp.stat(root); } catch { throw err('not-found', 'path not found'); }
  if (!st.isDirectory()) throw err('not-found', 'not a directory');

  const keep = makeKeepPath(filter || {});
  const all = listFiles(root).filter((rel) => keep(rel)).sort();
  const files = [];
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const chunk = all.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(chunk.map((rel) => countOne(root, rel)));
    for (const r of rows) if (r) files.push(r);
  }

  files.sort((a, b) => b.real - a.real || a.rel.localeCompare(b.rel));
  const truncated = files.length > MAX_FILES;
  const kept = files.slice(0, MAX_FILES);

  const gmap = new Map();
  for (const f of kept) {
    const key = groupKey(f.rel);
    const g = gmap.get(key) || { key, real: 0, total: 0, files: 0 };
    g.real += f.real; g.total += f.total; g.files += 1;
    gmap.set(key, g);
  }
  const groups = [...gmap.values()].sort((a, b) => b.real - a.real || a.key.localeCompare(b.key));
  const totals = kept.reduce((s, f) => ({ files: s.files + 1, real: s.real + f.real, total: s.total + f.total }), { files: 0, real: 0, total: 0 });

  return { dir: root, files: kept, groups, totals, ...(truncated ? { truncated: true } : {}) };
}
```

- [ ] **Step 4: 运行确认通过**：`node --test server/test/code-count.test.js` → 7/7

---

### Task 2: server —— `POST /api/code/stats`（TDD）

**Files:** Modify `server/http-api.js`；Test `server/test/http-api.test.js`

- [ ] **Step 1: 写失败测试**（`http-api.test.js` 末尾追加）

```js
test('/api/code/stats POST 返回实代码统计', async (t) => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// c\nconst a = 1;\n');
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const r = await post(server, '/api/code/stats', { dir, filter: { exts: ['.js'] } });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.deepEqual(j.files, [{ rel: 'src/a.js', real: 1, total: 2 }]);
  assert.deepEqual(j.totals, { files: 1, real: 1, total: 2 });
});

test('/api/code/stats POST 坏 dir 400、不存在 404', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const bad = await post(server, '/api/code/stats', { dir: '' });
  assert.equal(bad.status, 400);
  const nf = await post(server, '/api/code/stats', { dir: path.join(tmpDir(), 'nope') });
  assert.equal(nf.status, 404);
});
```

- [ ] **Step 2: 运行确认失败**：`node --test server/test/http-api.test.js` → 新用例 404/兜底

- [ ] **Step 3: 实现**

`server/http-api.js` 顶部 import 追加：

```js
import { collectCodeStats } from './code-count.js';
```

`/api/git/changes` 分支之后追加：

```js
      if (url.pathname === '/api/code/stats' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, await collectCodeStats({ dir: body.dir, filter: body.filter }));
        return;
      }
```

catch 块中 `not-a-repo` 之前追加：

```js
      if (err.code === 'bad-dir') return sendJson(res, 400, { error: 'bad dir', message: String(err.message) });
```

（`not-found` 已有 404 分支。）

- [ ] **Step 4: 运行确认通过**：`node --test server/test/http-api.test.js` → 全绿

---

### Task 3: web —— `codeStats.ts`（类型 + 纯函数，TDD）

**Files:** Create `web/src/codeStats.ts`、`web/src/codeStats.test.ts`

- [ ] **Step 1: 写失败测试** `web/src/codeStats.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { sumCodeTotals, ratioText } from './codeStats';

describe('sumCodeTotals', () => {
  it('逐字段累加', () => {
    expect(sumCodeTotals([
      { files: 2, real: 10, total: 20 },
      { files: 1, real: 5, total: 15 },
    ])).toEqual({ files: 3, real: 15, total: 35 });
  });
  it('空数组全零', () => {
    expect(sumCodeTotals([])).toEqual({ files: 0, real: 0, total: 0 });
  });
});

describe('ratioText', () => {
  it('实代码行 / 总行数 百分比，保留一位小数', () => {
    expect(ratioText(1, 3)).toBe('33.3%');
    expect(ratioText(2, 2)).toBe('100.0%');
  });
  it('总行数为 0 返回 —', () => {
    expect(ratioText(0, 0)).toBe('—');
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npm.cmd --prefix web run test`

- [ ] **Step 3: 实现 `web/src/codeStats.ts`**

```ts
import type { GitFilter } from './gitStat';

export interface CodeFileRow { rel: string; real: number; total: number; }
export interface CodeGroupRow { key: string; real: number; total: number; files: number; }
export interface CodeTotals { files: number; real: number; total: number; }
export interface CodeStatsResult {
  dir: string;
  files: CodeFileRow[];
  groups: CodeGroupRow[];
  totals: CodeTotals;
  truncated?: boolean;
}
export interface CodeStatsParams { dir: string; filter: GitFilter; }

export function sumCodeTotals(list: CodeTotals[]): CodeTotals {
  const total: CodeTotals = { files: 0, real: 0, total: 0 };
  for (const t of list) {
    total.files += t.files;
    total.real += t.real;
    total.total += t.total;
  }
  return total;
}

export function ratioText(real: number, total: number): string {
  if (!total) return '—';
  return `${((real / total) * 100).toFixed(1)}%`;
}

export async function fetchCodeStats(params: CodeStatsParams): Promise<CodeStatsResult> {
  const res = await fetch('/api/code/stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = (j.error || msg) + (j.message ? `：${j.message}` : '');
    } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json() as Promise<CodeStatsResult>;
}
```

- [ ] **Step 4: 运行确认通过**：`npm.cmd --prefix web run test`

---

### Task 4: web —— `CodeStats.vue` 容器 + 抽取共用输入（重构 `GitStat.vue`）

**Files:** Create `web/src/components/CodeStats.vue`；Modify `web/src/components/GitStat.vue`；Modify `web/src/App.vue`

- [ ] **Step 1: 新建 `CodeStats.vue`**（承载标题、共用输入、`el-tabs`、目录选择弹窗、localStorage 分键持久化）

script 要点：

```ts
import { ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue';
import { nodeFp } from '../nodeKey';
import { useProjects } from '../useProjects';
import { DEFAULT_CODE_EXTS, DEFAULT_EXCLUDE_DIRS } from '@devflow/shared/git-filter';
import { t } from '../i18n';
import GitStat from './GitStat.vue';
import RealCodeStat from './RealCodeStat.vue';

const props = defineProps<{ projectRoot?: string }>();

const tab = ref<'git' | 'real'>('git');
const dirs = ref<string[]>(['']);
const codeExtsText = ref(DEFAULT_CODE_EXTS.join(', '));
const excludeDirsText = ref(DEFAULT_EXCLUDE_DIRS.join(', '));
const excludeTestFiles = ref(true);
const recents = ref<string[]>([]);
const pickIndex = ref(-1);
const pickOpen = ref(false);
const pickPath = ref('');
const pickError = ref('');
// 键：devflow-codestat-{dirs,exts,exclude-dirs,exclude-test-files}-<fp>
```

- `onMounted`：`nodeFp()` 后设键名；读回 dirs/exts/excludeDirs/excludeTestFiles/recents；dirs 为空时用 `props.projectRoot`、再退 `recents[0]`。
- `dirs` 去抖持久化（复用原 `persistDirs`）；`codeExtsText`/`excludeDirsText`/`excludeTestFiles` 各自 `watch` 持久化。
- 目录增删/选择/确认/浏览（从 GitStat 原样迁移，`error` 改为 `pickError`）。
- `finishRun(dir)`：最近目录记忆（供子组件查询成功后调用）→ 通过 `@ran="remember"` 事件由子组件触发。

template 要点：

```html
<div class="cs">
  <header class="bar"><span class="ttl">{{ $t('codestat.title') }}</span></header>
  <div class="form">
    <!-- 目录列表（add/remove/pick + datalist codestat-recents） -->
    <!-- 过滤行：排除测试文件 checkbox（codestat.f.exclude_test_files） -->
    <!-- 后缀 / 排除目录两个输入（codestat.f.exts_label / codestat.f.exclude_dirs_label） -->
  </div>
  <el-tabs v-model="tab" class="tabs">
    <el-tab-pane :label="$t('codestat.tab.git')" name="git">
      <GitStat :dirs="dirs" :exts-text="codeExtsText" :exclude-dirs-text="excludeDirsText"
        :exclude-test-files="excludeTestFiles" @ran="remember" />
    </el-tab-pane>
    <el-tab-pane :label="$t('codestat.tab.real')" name="real">
      <RealCodeStat :dirs="dirs" :exts-text="codeExtsText" :exclude-dirs-text="excludeDirsText"
        :exclude-test-files="excludeTestFiles" @ran="remember" />
    </el-tab-pane>
  </el-tabs>
  <!-- 目录选择弹窗（同 GitStat 原样式） -->
</div>
```

`.cs` 为 `height:100%` 纵向；`.tabs` 占满剩余高度并可滚动（`el-tabs` 内容区 `overflow:auto`）。

- [ ] **Step 2: 重构 `GitStat.vue`**

- 删除：`projectRoot` prop、`dirs/codeExtsText/excludeDirsText/recents/pickIndex/pickOpen/pickPath/recentKey/dirsKey/extsKey/exclKey` 及其 onMounted 读取、`persistDirs`、dirs/exts/excl 的 watch、`addDir/removeDir/chooseDir/closePick/confirmPick/browsePick`、目录表单模板、`gitstat.title` 头部。
- 新增 props 与 emit：

```ts
const props = defineProps<{ dirs: string[]; extsText: string; excludeDirsText: string; excludeTestFiles: boolean }>();
const emit = defineEmits<{ (e: 'ran', dir: string): void }>();
```

- `run()` 改为读 props：

```ts
const list = [...new Set(props.dirs.map((d) => d.trim()).filter(Boolean))];
if (!list.length) { error.value = t('gitstat.need_repo'); return; }
if (since.value > until.value) { error.value = t('gitstat.bad_range'); return; }
...
const result = await fetchGitChanges({ repo: dir, since: since.value, until: until.value, filter: { codeOnly: flt.codeOnly, excludeTestFiles: props.excludeTestFiles, exts: parseExts(props.extsText), excludeDirs: parseDirs(props.excludeDirsText), hugeCommitLimit: parseHugeCommitLimit(hugeLimitText.value) } });
...
for (const e of settled) if (e.result) emit('ran', e.dir);
```

- `flt` 缩为 `reactive({ codeOnly: true })`；`useProjects()` 与 `DEFAULT_CODE_EXTS/DEFAULT_EXCLUDE_DIRS` import 移除（`parseExts/parseDirs/parseHugeCommitLimit/DEFAULT_HUGE_COMMIT_ADDED_LIMIT` 保留）。
- 保留：日期区间、仅统计代码、超大提交阈值、查询按钮、结果区与全部结果样式。
- 过滤行模板保留「仅统计代码」+ 超大提交输入；「排除测试文件」与后缀/排除目录输入移除（已上提）。

- [ ] **Step 3: `App.vue` 换用新容器**

```diff
-import GitStat from './components/GitStat.vue';
+import CodeStats from './components/CodeStats.vue';
```

```diff
-          <GitStat :project-root="currentProjectInfo?.root || ''" />
+          <CodeStats :project-root="currentProjectInfo?.root || ''" />
```

- [ ] **Step 4: 运行**：`npm.cmd run typecheck` → 0

---

### Task 5: web —— `RealCodeStat.vue`

**Files:** Create `web/src/components/RealCodeStat.vue`

- [ ] script 要点

```ts
const props = defineProps<{ dirs: string[]; extsText: string; excludeDirsText: string; excludeTestFiles: boolean }>();
const emit = defineEmits<{ (e: 'ran', dir: string): void }>();
interface DirEntry { dir: string; result: CodeStatsResult | null; error: string; }
const loading = ref(false);
const error = ref('');
const entries = ref<DirEntry[]>([]);
const collapsed = ref<Set<string>>(new Set());
async function run() {
  const list = [...new Set(props.dirs.map((d) => d.trim()).filter(Boolean))];
  if (!list.length) { error.value = t('codestat.need_dir'); return; }
  loading.value = true; error.value = ''; entries.value = []; collapsed.value = new Set();
  try {
    const settled = await Promise.all(list.map(async (dir): Promise<DirEntry> => {
      try {
        const result = await fetchCodeStats({ dir, filter: { codeOnly: true, excludeTestFiles: props.excludeTestFiles, exts: parseExts(props.extsText), excludeDirs: parseDirs(props.excludeDirsText) } });
        return { dir, result, error: '' };
      } catch (e: any) { return { dir, result: null, error: String(e?.message || e) }; }
    }));
    entries.value = settled;
    for (const e of settled) if (e.result) emit('ran', e.dir);
  } finally { loading.value = false; }
}
const okResults = computed(() => entries.value.map((e) => e.result).filter((r): r is CodeStatsResult => !!r));
const total = computed(() => sumCodeTotals(okResults.value.map((r) => r.totals)));
const failedCount = computed(() => entries.value.filter((e) => e.error).length);
const sortKey = ref<'real' | 'total' | 'rel'>('real');
const sortedFiles = computed(() => { /* per entry, sort by sortKey; rel 用 localeCompare */ });
```

- [ ] template 要点

```html
<div class="rc">
  <div class="toolbar"><button class="go" :disabled="loading" @click="run">{{ loading ? $t('codestat.running') : $t('codestat.run') }}</button></div>
  <div v-if="loading" class="slow">{{ $t('codestat.slow_hint') }}</div>
  <div v-if="error" class="err">{{ error }}</div>
  <div v-if="entries.length" class="res">
    <section class="total">
      <div class="cards">
        <div class="card"><b>{{ total.files }}</b><span>{{ $t('codestat.total_files') }}</span></div>
        <div class="card"><b>{{ total.real }}</b><span>{{ $t('codestat.total_real') }}</span></div>
        <div class="card"><b>{{ total.total }}</b><span>{{ $t('codestat.total_all') }}</span></div>
        <div class="card"><b>{{ ratioText(total.real, total.total) }}</b><span>{{ $t('codestat.col.ratio') }}</span></div>
      </div>
      <div v-if="failedCount" class="warn">{{ $t('codestat.some_failed', { count: failedCount }) }}</div>
    </section>
    <section v-for="(e, i) in entries" :key="e.dir" class="entry">
      <button class="ehead" @click="toggleEntry(e.dir)">
        <span class="ecaret">{{ collapsed.has(e.dir) ? '▸' : '▾' }}</span>
        <span class="eidx">#{{ i + 1 }}</span>
        <span class="edir">{{ e.dir }}</span>
        <span v-if="e.result" class="ecount">{{ e.result.totals.files }} {{ $t('codestat.total_files') }} · {{ e.result.totals.real }} {{ $t('codestat.total_real') }}</span>
      </button>
      <template v-if="!collapsed.has(e.dir)">
        <div v-if="e.error" class="err">{{ e.error }}</div>
        <template v-else-if="e.result">
          <div v-if="e.result.truncated" class="warn">{{ $t('codestat.truncated') }}</div>
          <h3 class="sub">{{ $t('codestat.groups_title') }}</h3>
          <table class="tbl"><!-- col.dir / col.files / col.real / col.total / col.ratio + 分组行 --></table>
          <h3 class="sub">{{ $t('codestat.files_title', { count: e.result.files.length }) }}</h3>
          <div class="sortbar"><!-- 排序按钮 real/total/rel --></div>
          <table class="tbl"><!-- col.file / col.real / col.total / col.ratio + 文件行 --></table>
          <div v-if="!e.result.files.length" class="empty">{{ $t('codestat.empty') }}</div>
        </template>
      </template>
    </section>
  </div>
</div>
```

样式沿用 `GitStat.vue` 的 `.cards/.card/.tbl/.warn/.err/.slow/.entry/.ehead` 一组（复制并加 `.rc`）。

- [ ] 运行：`npm.cmd run typecheck` → 0

---

### Task 6: i18n

**Files:** Modify `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 改名与新增**

- `nav.stat`：zh `提交统计` → `代码统计`；en `Git Stats` → `Code Stats`。
- 删除 `gitstat.title`（两语言）。
- 删除 `gitstat.f.exclude_test_files` / `gitstat.f.exclude_dirs_label` / `gitstat.f.exclude_dirs_placeholder` / `gitstat.f.exts_label` / `gitstat.f.exts_placeholder`，改到 `codestat.f.*`（值不变，中英同步）。
- 保留 `gitstat.f.title` / `gitstat.f.code_only` / `gitstat.f.huge_limit_label`。
- 新增 `codestat.*`：

```js
// zh-CN
'codestat.title': '📊 代码统计',
'codestat.tab.git': 'Git 提交统计',
'codestat.tab.real': '实代码统计',
'codestat.run': '统计',
'codestat.running': '扫描中…',
'codestat.total_files': '文件',
'codestat.total_real': '实代码行',
'codestat.total_all': '总行数',
'codestat.groups_title': '按目录汇总',
'codestat.files_title': '文件明细（{count}）',
'codestat.col.dir': '目录',
'codestat.col.files': '文件数',
'codestat.col.file': '文件',
'codestat.col.real': '实代码行',
'codestat.col.total': '总行数',
'codestat.col.ratio': '实代码占比',
'codestat.empty': '没有可统计的文件',
'codestat.truncated': '文件过多已截断，请排除更多目录。',
'codestat.need_dir': '请填写目录',
'codestat.some_failed': '有 {count} 个目录统计失败',
'codestat.slow_hint': '扫描中，文件较多时需要一点时间…',
// en
'codestat.title': '📊 Code Stats',
'codestat.tab.git': 'Git Commit Stats',
'codestat.tab.real': 'Real Code Stats',
'codestat.run': 'Count',
'codestat.running': 'Scanning…',
'codestat.total_files': 'Files',
'codestat.total_real': 'Real lines',
'codestat.total_all': 'Total lines',
'codestat.groups_title': 'By directory',
'codestat.files_title': 'Files ({count})',
'codestat.col.dir': 'Directory',
'codestat.col.files': 'Files',
'codestat.col.file': 'File',
'codestat.col.real': 'Real lines',
'codestat.col.total': 'Total lines',
'codestat.col.ratio': 'Real ratio',
'codestat.empty': 'No countable files',
'codestat.truncated': 'Too many files, truncated. Exclude more directories.',
'codestat.need_dir': 'Please enter a directory',
'codestat.some_failed': '{count} directories failed',
'codestat.slow_hint': 'Scanning, may take a while for large trees…',
```

- [ ] **Step 2:** `npm.cmd run check:i18n` → 0

---

### Task 7: 验证

- [ ] `npm.cmd run test:server` → 全绿
- [ ] `npm.cmd --prefix web run test` → 全绿
- [ ] `npm.cmd run typecheck` → 0
- [ ] `npm.cmd run check:i18n` → 0
- [ ] `npm.cmd run build:web` → 0
- [ ] 手工验收（dev）：`📊` 显示「代码统计」+ `el-tabs` 两个页签；共用目录/后缀/排除项两页签生效；Git 页签查询结果与之前一致；实代码页签扫描本仓库 → 总计/分组/文件明细合理，按实代码行排序可用；改动共用输入后切页签仍保留。

---

## Self-Review

- 口径 = `countReal`（Task 1 复用 `scripts/count-code.js`，不复制实现）。
- 目录/过滤项共用并提到页签上方（Task 4）；两子组件只读 props。
- Element Plus 页签（Task 4 用 `el-tabs`/`el-tab-pane`，全局注册）。
- 硬跳过与上限（Task 1：点目录/node_modules/dist/dist-portable/env、符号链接、2 MiB、NUL、MAX_FILES=5000 + truncated）。
- 错误码：`bad-dir` 400 / `not-found` 404（Task 2）。
- 中英同步 + 改名（Task 6）；`check:i18n` 兜底。
- 未做：CLI 改动、历史趋势、实代码按提交归属（spec 第 5 节）。
