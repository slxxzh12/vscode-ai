# 代码统计：首次提交人 + CSV/ZIP 导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 本仓库 AGENTS.md：默认 inline 执行。

**Goal:** 实代码文件行加「首次提交人」；两个页签各导出 2 个 CSV 打包 zip 下载。

**Architecture:** `server/code-count.js` 用一次 `git log` 建首次作者映射；新增 `POST /api/export/zip` 复用 `server/collaboration/zip.js` 的 `buildZip`；前端新增 `web/src/csv.ts`（toCsv/zipStamp/downloadZip），两个页签加导出按钮。

**Tech Stack:** Node ESM、`node:child_process`（`runGitRaw`）、Vue3 + Element Plus、node:test、vitest。

**Spec:** `docs/superpowers/specs/2026-09-16-code-stats-export-design.md`

---

### Task 1: server —— firstAuthor（TDD）

**Files:** Modify `server/git-log.js`（导出 `runGitRaw`）、`server/code-count.js`、`server/test/code-count.test.js`

- [ ] **Step 1: 写失败测试**（追加到 `code-count.test.js`，import 补 `makeRepo, commit`）

```js
test('collectCodeStats 贴首次提交人（含子目录扫描）', async () => {
  const repo = makeRepo();
  w(repo, 'src/a.js', 'const a = 1;\n');
  commit(repo, 'first', '2026-09-01T10:00:00');
  w(repo, 'src/b.js', 'const b = 1;\n');
  commit(repo, 'second', '2026-09-02T10:00:00');

  const r = await collectCodeStats({ dir: repo, filter: { exts: ['.js'] } });
  const by = Object.fromEntries(r.files.map((f) => [f.rel, f]));
  assert.equal(by['src/a.js'].firstAuthor, 'tester');
  assert.equal(by['src/b.js'].firstAuthor, 'tester');

  const sub = await collectCodeStats({ dir: path.join(repo, 'src'), filter: { exts: ['.js'] } });
  assert.deepEqual(sub.files.map((f) => [f.rel, f.firstAuthor]), [['a.js', 'tester'], ['b.js', 'tester']]);
});

test('collectCodeStats 非 git 目录不贴首次提交人', async () => {
  const dir = tmp();
  w(dir, 'a.js', 'const a = 1;\n');
  const r = await collectCodeStats({ dir, filter: { exts: ['.js'] } });
  assert.equal(r.files[0].firstAuthor, undefined);
});
```

- [ ] **Step 2: 运行确认失败**：`node --test server/test/code-count.test.js` → `firstAuthor` 为 `undefined`

- [ ] **Step 3: 实现**

`server/git-log.js`：把 `function runGitRaw(` 改为 `export function runGitRaw(`。

`server/code-count.js` 顶部 import 追加：

```js
import { runGitRaw } from './git-log.js';
```

新增函数并接入 `collectCodeStats`：

```js
const AUTHOR_TIMEOUT = 30 * 1000;

// 首次提交人映射：一次 git log，取每个文件最早一次「新增」的作者；非仓库/失败返回空
export async function firstAuthors(dir) {
  const empty = new Map();
  try {
    const top = (await runGitRaw(['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 10000 })).trim();
    if (!top) return empty;
    let prefix = path.relative(path.resolve(top), path.resolve(dir)).replace(/\\/g, '/');
    if (prefix === '.') prefix = '';
    if (prefix.startsWith('..')) return empty;
    const out = await runGitRaw(
      ['-C', dir, '-c', 'core.quotepath=false', 'log', '--reverse', '--diff-filter=A', '--format=%x01%an', '--name-only'],
      { timeout: AUTHOR_TIMEOUT },
    );
    const map = new Map();
    let author = null;
    for (const line of out.split('\n')) {
      if (!line) continue;
      if (line.startsWith('\x01')) { author = line.slice(1); continue; }
      if (author == null) continue;
      let rel = line;
      if (prefix) {
        if (!rel.startsWith(`${prefix}/`)) continue;
        rel = rel.slice(prefix.length + 1);
      }
      if (!map.has(rel)) map.set(rel, author);
    }
    return map;
  } catch { return empty; }
}
```

在 `collectCodeStats` 里、`const kept = files.slice(0, MAX_FILES);` 之后追加：

```js
  const authors = await firstAuthors(root);
  if (authors.size) {
    for (const f of kept) {
      const a = authors.get(f.rel);
      if (a) f.firstAuthor = a;
    }
  }
```

- [ ] **Step 4: 运行确认通过**：`node --test server/test/code-count.test.js`

---

### Task 2: server —— `POST /api/export/zip`（TDD）

**Files:** Modify `server/http-api.js`、`server/test/http-api.test.js`

- [ ] **Step 1: 写失败测试**（追加；import 补 `readZip` 与 `buildZip` 相关）

```js
import { readZip } from '../collaboration/zip.js';

test('/api/export/zip 返回可回读的 zip', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  const r = await post(server, '/api/export/zip', { zipName: 'a.zip', files: [{ name: 'a.csv', content: '\uFEFFa,b\r\n' }] });
  assert.equal(r.status, 200);
  const buf = Buffer.from(r.body, 'binary');
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.equal(readZip(buf)[0].name, 'a.csv');
});

test('/api/export/zip 空 files 400、非法名 400、超量 413', async (t) => {
  const server = await start(new Projects({ projects: [] }));
  t.after(() => server.close());
  assert.equal((await post(server, '/api/export/zip', { files: [] })).status, 400);
  assert.equal((await post(server, '/api/export/zip', { files: [{ name: '../x.csv', content: 'x' }] })).status, 400);
  const many = Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.csv`, content: 'x' }));
  assert.equal((await post(server, '/api/export/zip', { files: many })).status, 413);
});
```

> 说明：`post()` 目前以文本聚合 body；zip 是二进制，需在测试里改用 `res.setEncoding('binary')` 或把 `post` 改为收集 `Buffer`。实现时把 `post` 的 body 收集改为 `res.on('data', (d) => chunks.push(d))` 后 `Buffer.concat(chunks)`，再 `body: buf.toString('binary')`，避免破坏既有用例（既有断言用 `JSON.parse(r.body)` / 字符串，二进制化后仍可用 `r.body` 文本）。

- [ ] **Step 2: 运行确认失败**：`node --test server/test/http-api.test.js`

- [ ] **Step 3: 实现**

`server/http-api.js` import 追加：

```js
import { buildZip, safeZipName } from './collaboration/zip.js';
```

`/api/code/stats` 分支之后追加：

```js
      if (url.pathname === '/api/export/zip' && req.method === 'POST') {
        const body = await readJsonBody(req, 16 * 1024 * 1024);
        const files = Array.isArray(body.files) ? body.files : [];
        if (!files.length) return sendJson(res, 400, { error: 'bad-zip', message: 'no files' });
        if (files.length > 100) return sendJson(res, 413, { error: 'too-many-files' });
        let total = 0;
        const entries = [];
        for (const f of files) {
          const name = String(f && f.name || '');
          if (!safeZipName(name)) return sendJson(res, 400, { error: 'bad-zip', message: name });
          const content = typeof f.content === 'string' ? f.content : '';
          total += Buffer.byteLength(content);
          entries.push({ name, data: Buffer.from(content, 'utf8') });
        }
        if (total > 8 * 1024 * 1024) return sendJson(res, 413, { error: 'too-large' });
        const rawName = String(body.zipName || '').replace(/[^A-Za-z0-9._-]/g, '');
        const zipName = rawName.endsWith('.zip') ? rawName : `${rawName || 'export'}.zip`;
        const zip = buildZip(entries);
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${zipName}"`, 'Content-Length': zip.length });
        res.end(zip);
        return;
      }
```

- [ ] **Step 4: 运行确认通过**：`node --test server/test/http-api.test.js`

---

### Task 3: web —— `csv.ts`（TDD）

**Files:** Create `web/src/csv.ts`、`web/src/csv.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { toCsv, zipStamp } from './csv';

describe('toCsv', () => {
  it('带 BOM、CRLF 与表头', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('\uFEFFa,b\r\n1,2\r\n');
  });
  it('含逗号/引号/换行时加引号并双写引号', () => {
    expect(toCsv(['x'], [['a,b'], ['a"b'], ['a\nb']])).toBe('\uFEFFx\r\na,b\r\n'.replace('a,b\r\n', '"a,b"\r\n') + '"a""b"\r\n"a\nb"\r\n');
  });
});

describe('zipStamp', () => {
  it('yyyyMMdd-HHmm', () => {
    expect(zipStamp(new Date(2026, 8, 16, 15, 30))).toBe('20260916-1530');
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npm.cmd --prefix web run test`

- [ ] **Step 3: 实现**

```ts
export type CsvValue = string | number | null | undefined;

export function csvCell(v: CsvValue): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: CsvValue[], rows: CsvValue[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

export function zipStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export async function downloadZip(zipName: string, files: { name: string; content: string }[]): Promise<void> {
  const res = await fetch('/api/export/zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zipName, files }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 4: 运行确认通过**：`npm.cmd --prefix web run test`

---

### Task 4: web —— 两个页签的导出 + 首次提交人列

**Files:** Modify `web/src/components/GitStat.vue`、`web/src/components/RealCodeStat.vue`、`web/src/codeStats.ts`

- [ ] **Step 1: `codeStats.ts` 加字段**

```ts
export interface CodeFileRow { rel: string; real: number; total: number; firstAuthor?: string; }
```

- [ ] **Step 2: GitStat.vue 导出**

script 追加：

```ts
import { statusLabel } from '../gitStat';
import { toCsv, zipStamp, downloadZip } from '../csv';
```

```ts
const exporting = ref(false);
async function exportCsv() {
  const ok = okResults.value;
  if (!ok.length) return;
  exporting.value = true;
  try {
    const fileRows = entries.value.flatMap((e) => (e.result ? e.result.summary.map((r) => [e.dir, statusLabel(r.status), r.path, r.lastAuthor, r.touches, r.added, r.deleted, r.lastDate]) : []));
    const commitRows = entries.value.flatMap((e) => (e.result ? e.result.commits.map((c) => [e.dir, c.short, c.author, c.date, c.subject, c.files.length]) : []));
    const files = [
      { name: 'git-files.csv', content: toCsv([t('codestat.col.dir'), t('gitstat.col.status'), t('gitstat.col.file'), t('gitstat.col.author'), t('gitstat.col.touches'), t('gitstat.col.added_lines'), t('gitstat.col.deleted_lines'), t('gitstat.col.last')], fileRows) },
      { name: 'git-commits.csv', content: toCsv([t('codestat.col.dir'), 'hash', t('gitstat.col.author'), t('gitstat.col.last'), t('gitstat.commits_title', { count: '' }).replace(/[（(].*/, ''), t('codestat.col.files')], commitRows) },
    ];
    await downloadZip(`codestat-git-${zipStamp()}.zip`, files);
  } catch (e: any) {
    alert(t('codestat.export_failed', { msg: e?.message || String(e) }));
  } finally {
    exporting.value = false;
  }
}
```

> 表头里的「主题」用 `t('codestat.col.subject')`（新增词条），不要用正则拼装；上面正则仅为示意删除，实际实现直接新增词条。

template：`daterow` 里查询按钮后加：

```html
        <button class="go ghost" :disabled="exporting || !okResults.length" @click="exportCsv">{{ $t('codestat.export') }}</button>
```

样式：`.go.ghost { background: var(--bg4); color: var(--tx3); border: 1px solid var(--bd); margin-left: 0; padding: 9px 18px; }`

- [ ] **Step 3: RealCodeStat.vue 导出 + 首次提交人列**

script 追加：

```ts
import { toCsv, zipStamp, downloadZip } from '../csv';
```

```ts
const exporting = ref(false);
async function exportCsv() {
  const ok = okResults.value;
  if (!ok.length) return;
  exporting.value = true;
  try {
    const dirRows = entries.value.flatMap((e) => (e.result ? e.result.groups.map((g) => [e.dir, g.key, g.files, g.real, g.total, ratioText(g.real, g.total)]) : []));
    const fileRows = entries.value.flatMap((e) => (e.result ? sortedFiles(e.result.files).map((f) => [e.dir, f.rel, f.real, f.total, ratioText(f.real, f.total), f.firstAuthor || '']) : []));
    const files = [
      { name: 'real-dirs.csv', content: toCsv([t('codestat.col.dir'), t('codestat.col.dir'), t('codestat.col.files'), t('codestat.col.real'), t('codestat.col.total'), t('codestat.col.ratio')], dirRows) },
      { name: 'real-files.csv', content: toCsv([t('codestat.col.dir'), t('codestat.col.file'), t('codestat.col.real'), t('codestat.col.total'), t('codestat.col.ratio'), t('codestat.col.first_author')], fileRows) },
    ];
    await downloadZip(`codestat-real-${zipStamp()}.zip`, files);
  } catch (e: any) {
    alert(t('codestat.export_failed', { msg: e?.message || String(e) }));
  } finally {
    exporting.value = false;
  }
}
```

> `real-dirs.csv` 第一列表头应为「仓库/目录」与第二列「子目录」区分；实际用 `t('codestat.col.repo')` + `t('codestat.col.dir')` 两个词条（新增 `codestat.col.repo`）。

文件明细表新增列：表头 `{{ $t('codestat.col.first_author') }}`，单元格 `{{ f.firstAuthor || '—' }}`（同时更新 `colspan`/无）。

toolbar 加导出按钮：

```html
<button class="go ghost" :disabled="exporting || !okResults.length" @click="exportCsv">{{ $t('codestat.export') }}</button>
```

- [ ] **Step 4:** `npm.cmd run typecheck` → 0

---

### Task 5: i18n

**Files:** Modify `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] 新增（中英同步）：

```js
// zh-CN
'codestat.export': '导出 CSV',
'codestat.export_failed': '导出失败：{msg}',
'codestat.col.repo': '仓库目录',
'codestat.col.subject': '主题',
'codestat.col.first_author': '首次提交人',
// en
'codestat.export': 'Export CSV',
'codestat.export_failed': 'Export failed: {msg}',
'codestat.col.repo': 'Repo directory',
'codestat.col.subject': 'Subject',
'codestat.col.first_author': 'First author',
```

- [ ] `npm.cmd run check:i18n` → 0

---

### Task 6: 验证

- [ ] `node --test server/test/code-count.test.js`
- [ ] `node --test server/test/http-api.test.js`
- [ ] `npm.cmd run test:server`
- [ ] `npm.cmd --prefix web run test`
- [ ] `npm.cmd run typecheck`
- [ ] `npm.cmd run check:i18n`
- [ ] `npm.cmd run build:web`
- [ ] 手工：实代码页签出现「首次提交人」列（本仓库文件显示作者）；两个页签点「导出 CSV」各下载一个 zip，解压得 2 个 CSV，Excel 打开中文不乱码、无总计行。

---

## Self-Review

- 首次作者：一次 `git log --reverse --diff-filter=A`（Task 1），子目录前缀裁剪，非仓库空。
- CSV：BOM + CRLF + 转义（Task 3）；`toCsv` 有测试。
- zip：复用 `buildZip`，不新增依赖（Task 2）。
- 两页签各 2 个 CSV + zip（Task 4、5）。
- 不含总计行（Task 4 只导 `summary`/`commits`/`groups`/`files`，无 totals）。
- 中英同步（Task 5）+ `check:i18n` 兜底。
- 未做：按作者统计导出、服务端落盘导出（spec 第 6 节）。
