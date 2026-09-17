# Git 提交统计——过滤超大提交 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Git 统计里「单次提交新增行数 > 阈值（默认 2000，可配置，0=不过滤）」的提交整条不计入统计。

**Architecture:** 共享层加常量与归一化函数 `DEFAULT_HUGE_COMMIT_ADDED_LIMIT` / `parseHugeCommitLimit`；`server/git-log.js` 在路径过滤后、`MAX_COMMITS` 截断前按提交丢弃并返回 `hugeCommits`；前端 `gitStat.ts` 扩类型，`GitStat.vue` 加数字输入 + 提示，词条中英补齐。

**Tech Stack:** Node ESM、Vue3 `<script setup lang="ts">`、node:test、vitest。Windows + `npm.cmd`。

**Spec:** `docs/superpowers/specs/2026-09-16-huge-commit-filter-design.md`

---

### Task 1: shared —— 常量与归一化函数（TDD）

**Files:** Modify `shared/git-filter.js`、`shared/git-filter.d.ts`、`web/src/gitStat.test.ts`

- [ ] **Step 1: 写失败测试**（`web/src/gitStat.test.ts` 末尾追加）

```ts
import { parseHugeCommitLimit, DEFAULT_HUGE_COMMIT_ADDED_LIMIT } from '@devflow/shared/git-filter';

describe('parseHugeCommitLimit', () => {
  it('正整数/数字串原样返回', () => {
    expect(parseHugeCommitLimit(2000)).toBe(2000);
    expect(parseHugeCommitLimit('3000')).toBe(3000);
  });
  it('0/负数/非法/空 → 0（不过滤）', () => {
    expect(parseHugeCommitLimit(0)).toBe(0);
    expect(parseHugeCommitLimit(-5)).toBe(0);
    expect(parseHugeCommitLimit('abc')).toBe(0);
    expect(parseHugeCommitLimit('')).toBe(0);
    expect(parseHugeCommitLimit(null)).toBe(0);
    expect(parseHugeCommitLimit(undefined)).toBe(0);
  });
  it('默认值为 2000', () => {
    expect(DEFAULT_HUGE_COMMIT_ADDED_LIMIT).toBe(2000);
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npm.cmd --prefix web run test` → `parseHugeCommitLimit is not a function`。
- [ ] **Step 3: 实现**

`shared/git-filter.js` 末尾追加：

```js
export const DEFAULT_HUGE_COMMIT_ADDED_LIMIT = 2000;

// 超大提交阈值归一：非正整数一律视为 0（不过滤）
export function parseHugeCommitLimit(input) {
  const n = typeof input === 'number' ? input : parseInt(String(input ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}
```

`shared/git-filter.d.ts` 追加声明，并给 `GitPathFilter` 加 `hugeCommitLimit?: number;`：

```ts
export declare const DEFAULT_HUGE_COMMIT_ADDED_LIMIT: number;
export declare function parseHugeCommitLimit(input?: number | string | null): number;
```

- [ ] **Step 4: 运行确认通过**：`npm.cmd --prefix web run test` → 全绿。

---

### Task 2: server —— 按提交过滤（TDD）

**Files:** Modify `server/git-log.js`、`server/test/git-log.test.js`

- [ ] **Step 1: 写失败测试**（`server/test/git-log.test.js` 末尾追加）

```js
test('collectGitChanges 单次新增超阈值 → 整条提交被过滤', async () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'big.js'), Array.from({ length: 2001 }, (_, i) => `const x${i} = ${i};`).join('\n'));
  commit(repo, 'big', '2026-09-02T10:00:00');
  fs.writeFileSync(path.join(repo, 'small.js'), 'const a = 1;\n');
  commit(repo, 'small', '2026-09-03T10:00:00');

  const all = await collectGitChanges({ repo, ...RANGE, filter: { codeOnly: true } });
  assert.equal(all.stats.commits, 2);
  assert.equal(all.summary.map((s) => s.path).sort().join(','), 'big.js,small.js');

  const filtered = await collectGitChanges({ repo, ...RANGE, filter: { codeOnly: true, hugeCommitLimit: 2000 } });
  assert.equal(filtered.stats.commits, 1);
  assert.equal(filtered.hugeCommits, 1);
  assert.deepEqual(filtered.summary.map((s) => s.path), ['small.js']);
  assert.deepEqual(filtered.commits.map((c) => c.subject), ['small']);

  const custom = await collectGitChanges({ repo, ...RANGE, filter: { codeOnly: true, hugeCommitLimit: 3 } });
  assert.equal(custom.stats.commits, 1);
  assert.equal(custom.hugeCommits, 1);
});
```

- [ ] **Step 2: 运行确认失败**：`node --test server/test/git-log.test.js` → `hugeCommits` 为 `undefined`、`stats.commits` 为 2。
- [ ] **Step 3: 实现**

`server/git-log.js` 顶部 import 改：

```js
import { makeKeepPath, parseHugeCommitLimit } from '@devflow/shared/git-filter';
```

把：

```js
    const keep = flt ? makeKeepPath(flt) : null;
    const kept = keep
      ? allCommits.filter((c) => { c.files = c.files.filter((fp) => keep(fp.path)); return c.files.length > 0; })
      : allCommits;
    const commits = kept.slice(0, MAX_COMMITS);
```

替换为：

```js
    const keep = flt ? makeKeepPath(flt) : null;
    const kept = keep
      ? allCommits.filter((c) => { c.files = c.files.filter((fp) => keep(fp.path)); return c.files.length > 0; })
      : allCommits;
    const hugeLimit = parseHugeCommitLimit(flt && flt.hugeCommitLimit);
    let hugeCommits = 0;
    const selected = [];
    for (const c of kept) {
      if (hugeLimit > 0) {
        const added = c.files.reduce((s, fp) => s + (fp.added || 0), 0);
        if (added > hugeLimit) { hugeCommits += 1; continue; }
      }
      selected.push(c);
    }
    const commits = selected.slice(0, MAX_COMMITS);
```

并把 `truncated` 判定与返回值改为：

```js
    const truncated = selected.length > MAX_COMMITS || summaryAll.length > MAX_FILES;
```

```js
      stats,
      summary,
      commits,
      hugeCommits,
      ...(truncated ? { truncated: true } : {}),
```

- [ ] **Step 4: 运行确认通过**：`node --test server/test/git-log.test.js` → 全绿。
- [ ] **Step 5: 全量 server 测试**：`npm.cmd run test:server` → 全绿。

---

### Task 3: web —— 类型、视图、词条

**Files:** Modify `web/src/gitStat.ts`、`web/src/components/GitStat.vue`、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: `gitStat.ts` 扩类型**

`GitFilter` 加 `hugeCommitLimit?: number;`，`GitChangesResult` 加 `hugeCommits?: number;`：

```ts
export interface GitChangesResult {
  repo: { path: string; branch: string | null; cloned?: boolean };
  range: { since: string; until: string };
  stats: GitStats;
  summary: GitSummaryRow[];
  commits: GitCommit[];
  hugeCommits?: number;
  truncated?: boolean;
}
export interface GitFilter { codeOnly: boolean; exts?: string[]; excludeDirs?: string[]; excludeTestFiles: boolean; hugeCommitLimit?: number; }
```

- [ ] **Step 2: `GitStat.vue` 加输入 + 持久化 + 提示**

script 顶部 import 追加：

```ts
import { DEFAULT_CODE_EXTS, DEFAULT_EXCLUDE_DIRS, parseExts, parseDirs, parseHugeCommitLimit, DEFAULT_HUGE_COMMIT_ADDED_LIMIT } from '@devflow/shared/git-filter';
```

新增状态与键：

```ts
const hugeLimitText = ref(String(DEFAULT_HUGE_COMMIT_ADDED_LIMIT));
let hugeLimitKey = 'devflow-gitstat-huge-limit';
```

`onMounted` 内追加（与 `exclKey` 同处）：

```ts
  hugeLimitKey = `devflow-gitstat-huge-limit-${fp}`;
```

```ts
  try {
    const h = localStorage.getItem(hugeLimitKey);
    if (h !== null) hugeLimitText.value = h;
  } catch { /* ignore */ }
```

新增 watch：

```ts
watch(hugeLimitText, (v) => {
  try { localStorage.setItem(hugeLimitKey, v); } catch { /* ignore */ }
});
```

`run()` 的 filter 传参追加：

```ts
        const result = await fetchGitChanges({ repo: dir, since: since.value, until: until.value, filter: { ...flt, exts: parseExts(codeExtsText.value), excludeDirs: parseDirs(excludeDirsText.value), hugeCommitLimit: parseHugeCommitLimit(hugeLimitText.value) } });
```

computed 追加：

```ts
const hugeFiltered = computed(() => okResults.value.reduce((s, r) => s + (r.hugeCommits || 0), 0));
```

模板过滤区（`.fltrow` 之后、`.extbox` 内或独立一行）加：

```html
      <div class="extbox">
        <label class="fld grow">
          <span>{{ $t('gitstat.f.huge_limit_label') }}</span>
          <input v-model="hugeLimitText" inputmode="numeric" :placeholder="String(2000)" />
        </label>
      </div>
```

模板 `GitAuthorTable` 之前加提示：

```html
        <div v-if="hugeFiltered" class="warn">{{ $t('gitstat.filtered_huge', { count: hugeFiltered, limit: parseHugeCommitLimit(hugeLimitText) }) }}</div>
```

（`parseHugeCommitLimit` 已被 `<script setup>` 引入，模板可直接用。）

- [ ] **Step 3: i18n 中英**

`shared/i18n/zh-CN.js`（`gitstat.f.exclude_test_files` 附近）：

```js
  'gitstat.f.huge_limit_label': '过滤超大提交：单次新增 >（行，0=不过滤）',
```

`gitstat.truncated` 附近：

```js
  'gitstat.filtered_huge': '已过滤 {count} 个超大提交（单次新增 > {limit} 行）',
```

`shared/i18n/en.js` 同键：

```js
  'gitstat.f.huge_limit_label': 'Filter huge commits: added lines > (0 = off)',
  'gitstat.filtered_huge': 'Filtered {count} huge commits (added > {limit} lines)',
```

---

### Task 4: 验证

- [ ] **Step 1:** `npm.cmd run test:server` → 全绿
- [ ] **Step 2:** `npm.cmd --prefix web run test` → 全绿
- [ ] **Step 3:** `npm.cmd run typecheck` → 0
- [ ] **Step 4:** `npm.cmd run check:i18n` → 0
- [ ] **Step 5:** `npm.cmd run build:web` → 0
- [ ] **Step 6:** 手工验收（dev：`npm.cmd run dev:server` + `npm.cmd run dev:web`，http://localhost:5173）：本仓库根查询 → 勾选默认 2000 → 出现「已过滤 N 个超大提交」；改成 0 → 提示消失、数字回升。

---

## Self-Review

- 口径（只看新增）→ Task 2 过滤用 `Σ f.added`；Tests 覆盖。
- 可配置（0=不过滤）→ `parseHugeCommitLimit`（Task 1）；前端输入 + 持久化（Task 3）。
- 判断在路径过滤之后 → Task 2 在 `kept` 上遍历。
- 丢弃先于 500 截断 → Task 2 用 `selected.slice`，`truncated` 用 `selected.length`。
- 提示被过滤条数 → `hugeCommits`（Task 2）+ `gitstat.filtered_huge`（Task 3）。
- 中英同步 → Task 3 Step 3。
- 不改既有字段/错误码 → 仅新增 `hugeCommits`。
