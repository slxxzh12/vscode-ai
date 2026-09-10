# Git 提交文件统计（按日期区间）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 devflow 新增「Git 提交统计」：输入本地仓库路径 + 日期区间，后端调 `git log --name-status`，前端展示区间内新增/修改/删除/重命名的文件汇总与按提交分组的明细。

**Architecture:** 后端新增纯逻辑模块 `server/git-log.js`（`spawn` git CLI，解析、聚合），并在 `http-api.js` 暴露 `POST /api/git/changes`。前端 `web/src/gitStat.ts` 放类型与纯函数（可 vitest 测），`web/src/components/GitStat.vue` 为视图，`App.vue` 左侧 activity rail 增 `📊` 入口切换到该视图。

**Tech Stack:** Node ESM（`node:child_process` 的 `execFile`、`node:fs`）、Vue3 `<script setup lang="ts">`、vitest。Windows + `npm.cmd`（`npm.cmd test` = `node --test` + vitest；`npm.cmd run typecheck` = vue-tsc）。

**Spec:** `docs/superpowers/specs/2026-09-10-git-commit-statistics-design.md`

**执行中变更（2026-09-10，用户要求）：** 仓库来源由「仅本地路径」扩展为「**本地路径 + 远程 git 地址**」。`collectGitChanges` 入参 `repoPath` 统一改名为 `repo`；命中 URL（`https?|git|ssh|file://` 或 `user@host:path`）时先 `git clone --bare` 到系统临时目录、分析完 `finally` 清理。仓库判定由 `--is-inside-work-tree` 改为 `--git-dir`（`--bare` 克隆下前者为 false）。新增错误码 `bad-repo`/`clone-failed`/`clone-timeout`（均 400）。前端输入框标签改为「仓库路径或 git 地址」。详见 Task 7。

**实测确认（已在本机 git 2.21.0.windows.1 验证）:** `--since/--until` 的 `YYYY-MM-DDT00:00:00` / `T23:59:59` 能正确含当天并排除区间外提交；`--name-status -M` 重命名输出为 `R100\told\tnew`（同一行、制表符分隔）；非仓库/路径不存在时 git 退出非 0 并写 stderr。`git init` 默认分支在本机为 `master`，故测试不断言具体分支名。

---

### Task 1: server —— `git-log.js` 核心逻辑（TDD）

**Files:**
- Create: `server/git-log.js`
- Create: `server/test/helpers/git-fixture.js`
- Create: `server/test/git-log.test.js`

- [ ] **Step 1: 写 git 测试夹具 helper**

Create `server/test/helpers/git-fixture.js`:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfgit-')); }

export function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
}

export function commit(repo, msg, iso) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'tester', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 'tester', GIT_COMMITTER_EMAIL: 't@t',
    GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso,
  };
  execFileSync('git', ['-C', repo, 'add', '-A'], { env, windowsHide: true });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg], { env, windowsHide: true });
}

export function makeRepo() {
  const repo = tmpDir();
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'tester']);
  git(repo, ['config', 'user.email', 't@t']);
  return repo;
}

// 固定剧本（区间 2026-09-01 ~ 2026-09-10）：
//  c0 08-25  add m.txt,k.txt（区间前，用于造「纯修改」）
//  c1 09-01  A a.txt, M m.txt, M k.txt
//  c2 09-05  A b.txt
//  c3 09-06  R m.txt -> m2.txt
//  c4 09-08  D b.txt
//  c5 09-20  A out.txt（区间外）
export function seedRepo() {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'm.txt'), 'm0');
  fs.writeFileSync(path.join(repo, 'k.txt'), 'k0');
  commit(repo, 'c0', '2026-08-25T10:00:00');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a1');
  fs.writeFileSync(path.join(repo, 'm.txt'), 'm1');
  fs.writeFileSync(path.join(repo, 'k.txt'), 'k1');
  commit(repo, 'c1', '2026-09-01T10:00:00');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b1');
  commit(repo, 'c2', '2026-09-05T10:00:00');
  git(repo, ['mv', 'm.txt', 'm2.txt']);
  commit(repo, 'c3', '2026-09-06T10:00:00');
  fs.rmSync(path.join(repo, 'b.txt'));
  commit(repo, 'c4', '2026-09-08T10:00:00');
  fs.writeFileSync(path.join(repo, 'out.txt'), 'o');
  commit(repo, 'c5', '2026-09-20T10:00:00');
  return repo;
}
```

- [ ] **Step 2: 写失败测试**

Create `server/test/git-log.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { collectGitChanges } from '../git-log.js';
import { tmpDir, makeRepo, seedRepo } from './helpers/git-fixture.js';

const RANGE = { since: '2026-09-01', until: '2026-09-10' };

test('collectGitChanges 汇总新增/修改/删除/重命名', async () => {
  const repo = seedRepo();
  const r = await collectGitChanges({ repoPath: repo, ...RANGE });
  assert.equal(r.stats.commits, 4);
  assert.equal(r.stats.files, 4);
  assert.equal(r.stats.added, 1);
  assert.equal(r.stats.modified, 1);
  assert.equal(r.stats.deleted, 1);
  assert.equal(r.stats.renamed, 1);
  const by = Object.fromEntries(r.summary.map((s) => [s.path, s]));
  assert.equal(by['a.txt'].status, 'added');
  assert.equal(by['k.txt'].status, 'modified');
  assert.equal(by['k.txt'].touches, 1);
  assert.equal(by['b.txt'].status, 'deleted');
  assert.equal(by['b.txt'].touches, 2);
  assert.equal(by['m2.txt'].status, 'renamed');
  assert.equal(by['m2.txt'].oldPath, 'm.txt');
  assert.equal(typeof r.repo.branch, 'string');
});

test('collectGitChanges 只含区间内提交（c0/c5 不出现）', async () => {
  const repo = seedRepo();
  const r = await collectGitChanges({ repoPath: repo, ...RANGE });
  const subjects = r.commits.map((c) => c.subject);
  assert.deepEqual(subjects, ['c4', 'c3', 'c2', 'c1']);
  const c1 = r.commits.find((c) => c.subject === 'c1');
  assert.deepEqual(c1.files.map((f) => [f.status, f.path]), [
    ['added', 'a.txt'], ['modified', 'k.txt'], ['modified', 'm.txt'],
  ]);
});

test('collectGitChanges 空区间返回零与空数组', async () => {
  const repo = seedRepo();
  const r = await collectGitChanges({ repoPath: repo, since: '2026-01-01', until: '2026-01-02' });
  assert.equal(r.stats.commits, 0);
  assert.deepEqual(r.summary, []);
  assert.deepEqual(r.commits, []);
});

test('collectGitChanges 非仓库 → not-a-repo；路径不存在 → not-found', async () => {
  const empty = tmpDir();
  await assert.rejects(
    () => collectGitChanges({ repoPath: empty, ...RANGE }),
    (e) => e.code === 'not-a-repo',
  );
  await assert.rejects(
    () => collectGitChanges({ repoPath: path.join(empty, 'nope'), ...RANGE }),
    (e) => e.code === 'not-found',
  );
});

test('collectGitChanges 坏日期 → bad-date；反序 → bad-range', async () => {
  const repo = makeRepo();
  await assert.rejects(
    () => collectGitChanges({ repoPath: repo, since: '2026/09/01', until: '2026-09-10' }),
    (e) => e.code === 'bad-date',
  );
  await assert.rejects(
    () => collectGitChanges({ repoPath: repo, since: '2026-09-10', until: '2026-09-01' }),
    (e) => e.code === 'bad-range',
  );
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test server/test/git-log.test.js`
Expected: FAIL —— `Cannot find module '../git-log.js'`（模块尚未创建）。

- [ ] **Step 4: 实现 `server/git-log.js`**

Create `server/git-log.js`:

```js
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const STATUS_MAP = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'modified', T: 'modified' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COMMITS = 500;
const MAX_FILES = 5000;

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repoPath, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') { reject(err('git-unavailable', 'git not found in PATH')); return; }
        reject(err('git-failed', String(stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseLog(out) {
  const commits = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (!line) continue;
    if (line.startsWith('@@')) {
      const parts = line.slice(2).split('\x01');
      const hash = parts[0] || '';
      cur = {
        hash,
        short: hash.slice(0, 7),
        author: parts[1] || '',
        email: parts[2] || '',
        date: parts[3] || '',
        subject: parts.slice(4).join('\x01'),
        files: [],
      };
      commits.push(cur);
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^([AMDRTC])(\d*)\t(.*)$/);
    if (!m) continue;
    const status = STATUS_MAP[m[1]];
    const rest = m[3];
    if ((m[1] === 'R' || m[1] === 'C') && rest.includes('\t')) {
      const idx = rest.indexOf('\t');
      cur.files.push({ status, path: rest.slice(idx + 1), oldPath: rest.slice(0, idx) });
    } else {
      cur.files.push({ status, path: rest });
    }
  }
  return commits;
}

function summarize(commits) {
  const map = new Map();
  const applyEvent = (row, status, date) => {
    row.touches += 1;
    row.lastDate = date;
    if (!row.firstRaw) row.firstRaw = status;
    row.lastRaw = status;
    if (status === 'renamed') row.sawRename = true;
  };
  // git 默认最新在前，反转成时间正序以正确判定首次/末次状态
  for (const c of [...commits].reverse()) {
    for (const f of c.files) {
      if (f.status === 'renamed' && f.oldPath && map.has(f.oldPath)) {
        const row = map.get(f.oldPath);
        map.delete(f.oldPath);
        row.path = f.path;
        if (!row.oldPath) row.oldPath = f.oldPath;
        applyEvent(row, f.status, c.date);
        map.set(f.path, row);
        continue;
      }
      let row = map.get(f.path);
      if (!row) {
        row = { path: f.path, oldPath: f.oldPath, firstRaw: null, lastRaw: null, sawRename: false, touches: 0, lastDate: c.date };
        map.set(f.path, row);
      } else if (f.oldPath && !row.oldPath) {
        row.oldPath = f.oldPath;
      }
      applyEvent(row, f.status, c.date);
    }
  }
  const rows = [];
  for (const row of map.values()) {
    let status;
    if (row.lastRaw === 'deleted') status = 'deleted';
    else if (row.firstRaw === 'added') status = 'added';
    else if (row.sawRename) status = 'renamed';
    else status = 'modified';
    rows.push({ path: row.path, status, ...(row.oldPath ? { oldPath: row.oldPath } : {}), touches: row.touches, lastDate: row.lastDate });
  }
  return rows;
}

export async function collectGitChanges({ repoPath, since, until } = {}) {
  if (typeof repoPath !== 'string' || !repoPath) throw err('not-found', 'repoPath required');
  let st;
  try { st = fs.statSync(repoPath); } catch { throw err('not-found', 'repo path not found'); }
  if (!st.isDirectory()) throw err('not-found', 'repo path is not a directory');
  if (!DATE_RE.test(since || '') || !DATE_RE.test(until || '')) throw err('bad-date', 'date must be YYYY-MM-DD');
  if (since > until) throw err('bad-range', 'since is after until');

  let inside;
  try {
    inside = (await runGit(repoPath, ['rev-parse', '--is-inside-work-tree'])).trim();
  } catch (e) {
    if (e.code === 'git-unavailable') throw e;
    throw err('not-a-repo', e.message);
  }
  if (inside !== 'true') throw err('not-a-repo', 'not a git work tree');

  let branch = null;
  try {
    branch = (await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || null;
  } catch { /* 空仓库无分支，忽略 */ }

  const out = await runGit(repoPath, [
    '-c', 'core.quotepath=false',
    'log',
    `--since=${since}T00:00:00`,
    `--until=${until}T23:59:59`,
    '--no-merges',
    '-M',
    '--name-status',
    '--pretty=format:@@%x01%H%x01%an%x01%ae%x01%aI%x01%s',
  ]);

  const parsed = parseLog(out);
  const commits = parsed.slice(0, MAX_COMMITS).map((c) => ({
    hash: c.hash, short: c.short, author: c.author, email: c.email, date: c.date, subject: c.subject, files: c.files,
  }));
  const summaryAll = summarize(commits);
  const summary = summaryAll.slice(0, MAX_FILES);
  const truncated = parsed.length > MAX_COMMITS || summaryAll.length > MAX_FILES;

  const stats = { commits: commits.length, files: summary.length, added: 0, modified: 0, deleted: 0, renamed: 0 };
  for (const r of summary) stats[r.status] = (stats[r.status] || 0) + 1;

  return {
    repo: { path: repoPath, branch },
    range: { since, until },
    stats,
    summary,
    commits,
    ...(truncated ? { truncated: true } : {}),
  };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test server/test/git-log.test.js`
Expected: PASS（5 个用例全绿）。

- [ ] **Step 6: Commit**

```bash
git add server/git-log.js server/test/helpers/git-fixture.js server/test/git-log.test.js
git commit -m "feat(server): git-log 按日期区间解析提交与文件变动（A/M/D/R）"
```

---

### Task 2: server —— `POST /api/git/changes` 路由（TDD）

**Files:**
- Modify: `server/http-api.js`
- Test: `server/test/http-api.test.js`

- [ ] **Step 1: 先写测试**

在 `server/test/http-api.test.js` 顶部 import 区追加：

```js
import { seedRepo } from './helpers/git-fixture.js';
```

在文件末尾追加：

```js
test('/api/git/changes POST 返回统计与汇总', async (t) => {
  const repo = seedRepo();
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const r = await post(server, '/api/git/changes', { repoPath: repo, since: '2026-09-01', until: '2026-09-10' });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.stats.commits, 4);
  assert.equal(j.summary.length, 4);
  assert.equal(j.commits[0].files.length, 1);
});

test('/api/git/changes POST 非仓库 400、坏日期 400、路径不存在 404', async (t) => {
  const empty = tmpDir();
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const nr = await post(server, '/api/git/changes', { repoPath: empty, since: '2026-09-01', until: '2026-09-10' });
  assert.equal(nr.status, 400);
  const bd = await post(server, '/api/git/changes', { repoPath: empty, since: 'x', until: '2026-09-10' });
  assert.equal(bd.status, 400);
  const nf = await post(server, '/api/git/changes', { repoPath: path.join(empty, 'nope'), since: '2026-09-01', until: '2026-09-10' });
  assert.equal(nf.status, 404);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/http-api.test.js`
Expected: FAIL —— 两个新用例返回 404（路由未注册，落到末尾兜底 404），其余既有用例通过。

- [ ] **Step 3: 注册路由**

在 `server/http-api.js` 顶部 import 区追加：

```js
import { collectGitChanges } from './git-log.js';
```

在 `url.pathname === '/api/raw'` 分支之后（即 `}` 关掉 `/api/raw` 的 `if` 之后、`catch` 之前）插入：

```js
      if (url.pathname === '/api/git/changes' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, await collectGitChanges({ repoPath: body.repoPath, since: body.since, until: body.until }));
        return;
      }
```

- [ ] **Step 4: 补充错误码映射**

在 `catch (err)` 块内，`if (err.code === 'forbidden')` 之前插入：

```js
      if (err.code === 'not-a-repo') return sendJson(res, 400, { error: 'not a git repo' });
      if (err.code === 'bad-date') return sendJson(res, 400, { error: 'bad date' });
      if (err.code === 'bad-range') return sendJson(res, 400, { error: 'bad range' });
      if (err.code === 'git-unavailable') return sendJson(res, 500, { error: 'git unavailable', message: String(err.message) });
```

（`not-found` 已有 404 分支；`git-failed` 落到末尾 500 `internal` 并带 `message`。）

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test server/test/http-api.test.js`
Expected: PASS（2 个新用例 + 全部既有用例通过）。

- [ ] **Step 6: 跑整个 server 测试套件**

Run: `npm.cmd run test:server`
Expected: 全部通过。

- [ ] **Step 7: Commit**

```bash
git add server/http-api.js server/test/http-api.test.js
git commit -m "feat(server): POST /api/git/changes 暴露提交文件统计"
```

---

### Task 3: web —— `gitStat.ts`（类型 + 纯函数，TDD）

**Files:**
- Create: `web/src/gitStat.ts`
- Create: `web/src/gitStat.test.ts`

- [ ] **Step 1: 先写测试**

Create `web/src/gitStat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { statusLabel, statusClass, defaultRange } from './gitStat';

describe('statusLabel', () => {
  it('返回中文标签', () => {
    expect(statusLabel('added')).toBe('新增');
    expect(statusLabel('modified')).toBe('修改');
    expect(statusLabel('deleted')).toBe('删除');
    expect(statusLabel('renamed')).toBe('重命名');
  });
});

describe('statusClass', () => {
  it('统一加 st- 前缀', () => {
    expect(statusClass('added')).toBe('st-added');
    expect(statusClass('renamed')).toBe('st-renamed');
  });
});

describe('defaultRange', () => {
  it('默认近 7 天（含今天）', () => {
    const r = defaultRange(new Date(2026, 8, 10)); // 2026-09-10
    expect(r.until).toBe('2026-09-10');
    expect(r.since).toBe('2026-09-04');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test`
Expected: FAIL —— 找不到模块 `./gitStat`。

- [ ] **Step 3: 实现 `web/src/gitStat.ts`**

Create `web/src/gitStat.ts`:

```ts
export type GitStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitFileChange { status: GitStatus; path: string; oldPath?: string; }
export interface GitCommit {
  hash: string; short: string; author: string; email: string; date: string; subject: string; files: GitFileChange[];
}
export interface GitSummaryRow { path: string; status: GitStatus; oldPath?: string; touches: number; lastDate: string; }
export interface GitStats { commits: number; files: number; added: number; modified: number; deleted: number; renamed: number; }
export interface GitChangesResult {
  repo: { path: string; branch: string | null };
  range: { since: string; until: string };
  stats: GitStats;
  summary: GitSummaryRow[];
  commits: GitCommit[];
  truncated?: boolean;
}
export interface GitChangesParams { repoPath: string; since: string; until: string; }

const LABELS: Record<GitStatus, string> = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名' };

export function statusLabel(s: GitStatus): string { return LABELS[s] || s; }
export function statusClass(s: GitStatus): string { return `st-${s}`; }

function pad(n: number): string { return String(n).padStart(2, '0'); }
function fmt(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function defaultRange(today: Date = new Date()): { since: string; until: string } {
  const until = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const since = new Date(until);
  since.setDate(since.getDate() - 6);
  return { since: fmt(since), until: fmt(until) };
}

export async function fetchGitChanges(params: GitChangesParams): Promise<GitChangesResult> {
  const res = await fetch('/api/git/changes', {
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
  return res.json() as Promise<GitChangesResult>;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test`
Expected: PASS（新增 3 个用例 + 既有 web 用例全绿）。

- [ ] **Step 5: Commit**

```bash
git add web/src/gitStat.ts web/src/gitStat.test.ts
git commit -m "feat(web): gitStat 类型/纯函数/查询封装"
```

---

### Task 4: web —— `GitStat.vue` 视图

**Files:**
- Create: `web/src/components/GitStat.vue`

- [ ] **Step 1: 写组件**

Create `web/src/components/GitStat.vue`:

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { nodeFp } from '../nodeKey';
import {
  fetchGitChanges, statusLabel, statusClass, defaultRange,
  type GitChangesResult, type GitStatus, type GitSummaryRow,
} from '../gitStat';

const FILTERS = ['all', 'added', 'modified', 'deleted', 'renamed'] as const;

const repoPath = ref('');
const init = defaultRange();
const since = ref(init.since);
const until = ref(init.until);
const loading = ref(false);
const error = ref('');
const result = ref<GitChangesResult | null>(null);
const filter = ref<GitStatus | 'all'>('all');
const openCommits = ref<Set<string>>(new Set());
const recents = ref<string[]>([]);
let recentKey = 'devflow-gitstat-recent';

onMounted(async () => {
  recentKey = `devflow-gitstat-recent-${await nodeFp()}`;
  try {
    const a = JSON.parse(localStorage.getItem(recentKey) || '[]');
    recents.value = Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 20) : [];
  } catch { recents.value = []; }
  if (recents.value.length) repoPath.value = recents.value[0];
});

function remember(p: string) {
  const a = recents.value.filter((x) => x !== p);
  a.unshift(p);
  recents.value = a.slice(0, 20);
  try { localStorage.setItem(recentKey, JSON.stringify(recents.value)); } catch { /* ignore */ }
}

async function run() {
  const p = repoPath.value.trim();
  if (!p) { error.value = '请填写仓库路径'; return; }
  if (since.value > until.value) { error.value = '起始日期不能晚于结束日期'; return; }
  loading.value = true;
  error.value = '';
  result.value = null;
  try {
    result.value = await fetchGitChanges({ repoPath: p, since: since.value, until: until.value });
    remember(p);
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

const filteredSummary = computed<GitSummaryRow[]>(() => {
  const rows = result.value?.summary || [];
  return filter.value === 'all' ? rows : rows.filter((r) => r.status === filter.value);
});

function toggleCommit(hash: string) {
  const s = new Set(openCommits.value);
  if (s.has(hash)) s.delete(hash); else s.add(hash);
  openCommits.value = s;
}
function filterLabel(f: GitStatus | 'all'): string { return f === 'all' ? '全部' : statusLabel(f); }
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
</script>

<template>
  <div class="gs">
    <header class="bar"><span class="ttl">📊 Git 提交统计</span></header>

    <div class="form">
      <label class="fld grow">
        <span>仓库路径</span>
        <input v-model="repoPath" list="gitstat-recents" placeholder="例如 D:\code\my-repo" @keyup.enter="run" />
        <datalist id="gitstat-recents"><option v-for="p in recents" :key="p" :value="p" /></datalist>
      </label>
      <label class="fld"><span>起始日期</span><input v-model="since" type="date" /></label>
      <label class="fld"><span>结束日期</span><input v-model="until" type="date" /></label>
      <button class="go" :disabled="loading" @click="run">{{ loading ? '查询中…' : '查询' }}</button>
    </div>
    <div v-if="error" class="err">{{ error }}</div>

    <div v-if="result" class="res">
      <div class="cards">
        <div class="card"><b>{{ result.stats.commits }}</b><span>提交</span></div>
        <div class="card"><b>{{ result.stats.files }}</b><span>文件</span></div>
        <div class="card st-added"><b>{{ result.stats.added }}</b><span>新增</span></div>
        <div class="card st-modified"><b>{{ result.stats.modified }}</b><span>修改</span></div>
        <div class="card st-deleted"><b>{{ result.stats.deleted }}</b><span>删除</span></div>
        <div class="card st-renamed"><b>{{ result.stats.renamed }}</b><span>重命名</span></div>
      </div>
      <div v-if="result.truncated" class="warn">结果过多已截断，请缩小日期范围。</div>
      <div class="repoline">
        仓库：{{ result.repo.path }}<template v-if="result.repo.branch"> @ {{ result.repo.branch }}</template>
        · {{ result.range.since }} ~ {{ result.range.until }}
      </div>

      <div v-if="result.summary.length === 0" class="empty">该区间没有文件变动</div>
      <template v-else>
        <div class="filters">
          <button v-for="f in FILTERS" :key="f" :class="{ on: filter === f }" @click="filter = f">{{ filterLabel(f) }}</button>
        </div>
        <table class="tbl">
          <thead><tr><th>状态</th><th>文件</th><th>次数</th><th>最后变动</th></tr></thead>
          <tbody>
            <tr v-for="row in filteredSummary" :key="row.path">
              <td><span class="badge" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span></td>
              <td class="pth"><template v-if="row.oldPath"><span class="old">{{ row.oldPath }}</span> → </template>{{ row.path }}</td>
              <td class="num">{{ row.touches }}</td>
              <td class="num">{{ fmtDate(row.lastDate) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <h3 class="sub">提交明细（{{ result.commits.length }}）</h3>
      <div v-for="c in result.commits" :key="c.hash" class="cmt">
        <button class="chead" @click="toggleCommit(c.hash)">
          <span class="cx">{{ openCommits.has(c.hash) ? '▾' : '▸' }}</span>
          <code class="ch">{{ c.short }}</code>
          <span class="cs">{{ c.subject }}</span>
          <span class="ca">{{ c.author }} · {{ fmtDate(c.date) }}</span>
          <span class="cn">{{ c.files.length }}</span>
        </button>
        <div v-if="openCommits.has(c.hash)" class="cbody">
          <div v-for="(f, i) in c.files" :key="i" class="cf">
            <span class="badge" :class="statusClass(f.status)">{{ statusLabel(f.status) }}</span>
            <span class="cp"><template v-if="f.oldPath"><span class="old">{{ f.oldPath }}</span> → </template>{{ f.path }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gs { display: flex; flex-direction: column; height: 100%; min-width: 0; overflow: hidden; }
.bar { flex: none; display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--bd2); }
.ttl { color: var(--tx1); font-weight: 700; font-size: 13px; }
.form { flex: none; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; padding: 12px; }
.fld { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--tx3); }
.fld.grow { flex: 1 1 320px; min-width: 220px; }
.fld input { background: var(--bg4); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-size: 13px; }
.fld.grow input { width: 100%; }
.go { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 7px 18px; font-weight: 600; cursor: pointer; }
.go:disabled { opacity: .6; cursor: default; }
.err { flex: none; margin: 0 12px; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--err) 15%, transparent); color: var(--err); font-size: 12px; }
.warn { margin: 4px 0; padding: 6px 10px; border-radius: 4px; background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); font-size: 12px; }
.res { flex: 1; min-height: 0; overflow: auto; padding: 0 12px 24px; }
.cards { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 10px; }
.card { display: flex; flex-direction: column; align-items: center; min-width: 64px; padding: 6px 12px; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg2); }
.card b { font-size: 18px; color: var(--tx1); }
.card span { font-size: 11px; color: var(--tx3); }
.card.st-added b { color: var(--ok, #3fb950); }
.card.st-modified b { color: var(--ac2); }
.card.st-deleted b { color: var(--err); }
.card.st-renamed b { color: var(--warn); }
.repoline { color: var(--tx5); font-size: 11px; font-family: ui-monospace, Consolas, monospace; margin-bottom: 8px; word-break: break-all; }
.empty { color: var(--tx4); font-size: 12px; padding: 16px 0; }
.filters { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.filters button { background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.filters button.on { border-color: var(--ac); color: var(--tx1); }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; color: var(--tx4); font-weight: 500; padding: 4px 8px; border-bottom: 1px solid var(--bd2); }
.tbl td { padding: 4px 8px; border-bottom: 1px solid var(--bd2); vertical-align: top; }
.tbl .num { text-align: right; color: var(--tx4); white-space: nowrap; }
.pth { font-family: ui-monospace, Consolas, monospace; color: var(--tx); word-break: break-all; }
.old { color: var(--tx5); text-decoration: line-through; }
.badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; white-space: nowrap; }
.badge.st-added { background: color-mix(in srgb, var(--ok, #3fb950) 20%, transparent); color: var(--ok, #3fb950); }
.badge.st-modified { background: color-mix(in srgb, var(--ac2) 20%, transparent); color: var(--ac2); }
.badge.st-deleted { background: color-mix(in srgb, var(--err) 20%, transparent); color: var(--err); }
.badge.st-renamed { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
.sub { color: var(--tx1); font-size: 13px; margin: 16px 0 6px; }
.cmt { border-bottom: 1px solid var(--bd2); }
.chead { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; text-align: left; padding: 6px 4px; cursor: pointer; color: var(--tx); }
.chead:hover { background: var(--bg3); }
.cx { color: var(--tx4); width: 12px; flex: none; }
.ch { color: var(--ac2); font-family: ui-monospace, Consolas, monospace; flex: none; }
.cs { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca { color: var(--tx4); font-size: 11px; flex: none; }
.cn { color: var(--tx4); font-size: 11px; flex: none; min-width: 18px; text-align: right; }
.cbody { padding: 2px 4px 10px 24px; display: flex; flex-direction: column; gap: 3px; }
.cf { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.cp { font-family: ui-monospace, Consolas, monospace; color: var(--tx3); word-break: break-all; }
</style>
```

- [ ] **Step 2: typecheck + build**

Run: `npm.cmd run typecheck`
Expected: 退出码 0。

Run: `npm.cmd run build:web`
Expected: 退出码 0（vue-tsc + vite build 通过）。

- [ ] **Step 3: Commit**

```bash
git add web/src/components/GitStat.vue
git commit -m "feat(web): GitStat 提交统计视图（路径+日期区间+汇总+明细）"
```

---

### Task 5: web —— `App.vue` 左侧 rail 入口

**Files:**
- Modify: `web/src/App.vue`

- [ ] **Step 1: import 组件并扩展 rail 类型**

`web/src/App.vue` script 中，`import WorkflowPanel from './components/WorkflowPanel.vue';` 之后追加：

```ts
import GitStat from './components/GitStat.vue';
```

把 `const rail = ref<'explorer' | 'history' | 'contacts'>('explorer');` 替换为：

```ts
const rail = ref<'explorer' | 'history' | 'contacts' | 'stat'>('explorer');
```

- [ ] **Step 2: 加 rail 按钮**

在 activity rail 的「通讯录」按钮之后追加：

```html
        <button class="a-btn" :class="{ on: rail === 'stat' }" title="提交统计" @click="rail = 'stat'; showWf = false">📊</button>
```

- [ ] **Step 3: 加视图分支**

把模板中的：

```html
      <template v-if="rail === 'contacts'">
        <section class="center">
          <CollaborationView :terminal="terminal" />
        </section>
      </template>
      <template v-else>
```

替换为：

```html
      <template v-if="rail === 'contacts'">
        <section class="center">
          <CollaborationView :terminal="terminal" />
        </section>
      </template>
      <template v-else-if="rail === 'stat'">
        <section class="center">
          <GitStat />
        </section>
      </template>
      <template v-else>
```

- [ ] **Step 4: typecheck + 全量测试**

Run: `npm.cmd run typecheck`
Expected: 退出码 0。

Run: `npm.cmd test`
Expected: server 与 web 全部用例通过。

- [ ] **Step 5: Commit**

```bash
git add web/src/App.vue
git commit -m "feat(web): 左侧 rail 新增提交统计入口"
```

---

### Task 6: 生产构建 + 手动验证要点

**Files:** 无（运行验证）

- [ ] **Step 1: 构建**

Run: `npm.cmd run build:web`
Expected: 退出码 0。

- [ ] **Step 2: 手动验证（dev 模式：两个终端分别 `npm.cmd run dev:server` 与 `npm.cmd run dev:web`，访问 http://localhost:5173）**

1. 左侧 rail 点 `📊` → 主区域显示「Git 提交统计」，默认日期为近 7 天。
2. 仓库路径填本仓库根目录（如 `D:\baobiao\devflow_statistic\statistic_devflow`）→ 查询 → 卡片出现提交/文件/新增/修改/删除/重命名计数。
3. 文件汇总表显示带颜色的状态徽标；重命名行显示 `旧名 → 新名`；点状态筛选按钮只显示对应状态。
4. 提交明细按 commit 折叠，展开显示该次文件清单；短 hash、作者、时间正确。
5. 改成只含今天、但今天无提交的区间 → 显示「该区间没有文件变动」。
6. 路径填一个非 git 目录 → 返回 400 并在表单下方红字提示；填不存在路径 → 404 提示；起始日期晚于结束 → 前端即时提示。
7. 再查一次后刷新页面 → 路径输入框从「最近路径」候选恢复（localStorage 记忆）。
8. 选一个真实仓库做区间回归，抽查某文件状态与 `git log --name-status --since=... --until=...` 输出一致。

---

### Task 7: 远程 clone 支持（本地路径 + git 地址）

**Files:**
- Modify: `server/git-log.js`
- Modify: `server/http-api.js`
- Modify: `server/test/git-log.test.js`、`server/test/http-api.test.js`
- Modify: `web/src/gitStat.ts`、`web/src/components/GitStat.vue`

- [ ] **Step 1: `git-log.js` 增 `runGitRaw` / `isGitUrl` / `cloneToTemp`**

`runGitRaw(args, { timeout })` 用 `execFile('git', args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout })`，`ENOENT`→`git-unavailable`、`killed`→`git-timeout`、其余非零→`git-failed`。`isGitUrl(s)` = `/^(https?|git|ssh|file):\/\//i` 或 `/^[^\s@:]+@[^\s:]+:\S+$/`。`cloneToTemp(repo)` 建 `mkdtemp('dfgit-clone-')` 父目录，`git clone --quiet --bare <repo> <parent>/repo`（120s 超时），失败清父目录并抛 `clone-failed`/`clone-timeout`/`git-unavailable`，成功返回 `{ target, cleanup }`。

- [ ] **Step 2: `collectGitChanges({ repo, since, until })` 分支处理**

`repo` 去空白、首字符 `-` 抛 `bad-repo`；`remote = isGitUrl(source)`；远程则 `cloneToTemp` 并以克隆目录为 `target`，本地则 `statSync` 校验目录存在。仓库判定用 `await runGit(target, ['rev-parse','--git-dir'])`（失败→`not-a-repo`）。主流程包在 `try { ... } finally { cleanup?.() }`。返回 `repo: { path: source, branch, cloned: remote }`。

- [ ] **Step 3: `http-api.js` 改字段与错误码**

路由改读 `body.repo`；catch 增 `bad-repo`/`clone-failed`/`clone-timeout` → 400（带 `message`）。

- [ ] **Step 4: 前端**

`gitStat.ts` 的 `GitChangesParams` 改 `repo`、`repo` 类型增 `cloned?: boolean`；`fetchGitChanges` body 不变（JSON 序列化 params）。`GitStat.vue` 调用改 `{ repo: p, since, until }`；输入标签「仓库路径或 git 地址」，placeholder 与 loading 文案更新。

- [ ] **Step 5: 测试**

`git-log.test.js`：`repoPath`→`repo`；新增 `file://` 远程克隆用例（`cloned===true`、`path===url`、临时目录计数不变）与 `--upload-pack=evil` → `bad-repo` 用例。`http-api.test.js`：`repoPath`→`repo`。

- [ ] **Step 6: 验证**

Run: `node --test server/test/git-log.test.js` → 7/7；`npm.cmd test`（server 136 + web 37）；`npm.cmd run typecheck`；`npm.cmd run build:web`。端到端：起隔离服务（`DEVFLOW_NODE`+`DEVFLOW_PORT`）POST 本地路径、`file://` 地址、不存在路径，分别验证正常、`cloned=true`、404。

- [ ] **Step 7: Commit**

```bash
git add server/git-log.js server/http-api.js server/test/git-log.test.js server/test/http-api.test.js web/src/gitStat.ts web/src/components/GitStat.vue
git commit -m "feat(gitstat): 支持远程 git 地址（clone 到临时目录后分析）"
```

---

## Self-Review

**Spec 覆盖：**
- 前端手输/选择本地路径 + 最近路径记忆 → Task 3（`fetchGitChanges`）、Task 4（输入框 + `nodeFp()` 隔离 localStorage 最近路径）✔
- 后端 `spawn git`（方案 A）、日期含当天、`--no-merges -M`、`quotepath=false`、数组传参防注入 → Task 1 Step 4 ✔
- 校验与错误码（not-found 404 / not-a-repo、bad-date、bad-range 400 / git-unavailable 500）→ Task 1 + Task 2 Step 3/4 ✔
- 汇总（状态优先规则、`touches`、重命名带 oldPath）+ 明细（按 commit 分组）→ Task 1 `summarize`、Task 2 用例、Task 4 视图 ✔
- 状态 A/M/D/R/C/T 映射 → Task 1 `STATUS_MAP` ✔
- 统计卡片 + 状态筛选 + 折叠明细 + 空态 → Task 4 ✔
- 左侧 rail `📊` 入口 → Task 5 ✔
- 结果上限 500 提交 / 5000 文件 + `truncated` 提示 → Task 1 + Task 4 `.warn` ✔
- 测试：server 单测（夹具造跨日期新增/修改/删除/重命名）、HTTP 路由测试、web 纯函数 vitest、typecheck、手动验证 → Task 1/2/3/5/6 ✔
- 范围外（作者/分支/路径过滤、numstat、导出）未实现 ✔

**Placeholder 扫描：** 每步均含完整可粘贴代码与确切命令，无 TBD / “类似 Task N” / “补充错误处理” 等占位。

**类型一致性：**
- 后端 `collectGitChanges` 返回字段（`repo/range/stats/summary/commits/truncated`）与前端 `GitChangesResult`（Task 3）逐字段一致；状态字符串用 `added/modified/deleted/renamed` 贯穿 `STATUS_MAP`、`GitStatus`、`statusLabel/statusClass`、CSS class `st-*`。
- 前端导出的 `fetchGitChanges/statusLabel/statusClass/defaultRange` 在 Task 4 中按同名 import 使用。
- 测试夹具 `tmpDir/makeRepo/seedRepo` 在 Task 1 定义，Task 2 以同名 `seedRepo` import 并调用（已核对一致）。

**已知取舍：**
- `summary` 的 `m2.txt`（原 `m.txt` 重命名而来）在区间前已存在，故 `firstRaw` 为 `modified`、含重命名 → 状态判为 `renamed`、`touches=2`；测试已按此断言。
- `--since/--until` 基于提交时间戳；线性历史下准确，非线性历史可能有 git 自身的遍历边界限制，属可接受范围。
- 浏览器无法取得本地目录绝对路径，故仓库路径以手输为主 + 最近路径候选（datalist），不做目录选择器。
