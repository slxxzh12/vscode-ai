# 点击 db 文件用内置 Navicat 打开 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **提交约定（AGENTS.md）：** 未明确要求不得 commit；下列 Commit 步骤仅为检查点。

**Goal:** 项目里点 SQLite 文件（扩展名或内容头命中）时，用内置 Navicat 打开并按绝对路径自动新建/复用连接。

**Architecture:** 服务端 `projects.meta()` 增加 `sqlite` 内容头探测；`App.vue` 的 `openFile` 变 async，命中则走 `useNavicatWorkbench().openSqliteFile(abs,name)` 并 `center.openTool('navicat')`；纯函数 `isDbExt`/`shouldOpenInNavicat`/`uniqueConnName` 便于测试。

**Tech Stack:** Node ESM（`node:test`）、Vue3+TS（vitest）、`shared/i18n`。

---

## File Structure

- `server/projects.js` — `meta()` 增 `sqlite`。
- `server/test/http-api.test.js` — `/api/file/meta` 断言 `sqlite`。
- `web/src/tools/navicat/sqliteFile.ts`（新）— 纯函数。
- `web/src/tools/navicat/sqliteFile.test.ts`（新）。
- `web/src/tools/navicat/useNavicatWorkbench.ts` — `openSqliteFile`。
- `web/src/tools/navicat/useNavicatWorkbench.test.ts`。
- `web/src/App.vue` — `openFile` 拦截。
- `shared/i18n/zh-CN.js` / `en.js` — `nv.file_conn`。

---

## Task 1: 服务端 meta.sqlite

**Files:** Modify `server/projects.js`; Test `server/test/http-api.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/http-api.test.js` 末尾追加（`start`/`dir` 等既有夹具：项目根写入文件后经 `/api/file/meta` 读取）：

```js
test('/api/file/meta 返回 sqlite 内容头判定', async () => {
  const { server, port, dir } = await start();   // 沿用本文件既有的 start() 夹具
  try {
    const db = Buffer.concat([Buffer.from('SQLite format 3\u0000'), Buffer.alloc(64, 0x2a)]);
    fs.writeFileSync(path.join(dir, 'a.db'), db);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'hello world');
    const rd = await fetch(`http://127.0.0.1:${port}/api/file/meta?project=A&path=a.db`).then((r) => r.json());
    assert.equal(rd.sqlite, true);
    const rt = await fetch(`http://127.0.0.1:${port}/api/file/meta?project=A&path=b.txt`).then((r) => r.json());
    assert.equal(rt.sqlite, false);
  } finally { server.close(); }
});
```

> 注意：`start()` 及其项目根目录变量名以本文件现有夹具为准，按实际调整（若项目 id 非 `A`/根目录变量非 `dir`，相应替换）。逻辑不变：写一个魔数文件和一个文本文件，断言 `meta.sqlite`。

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd run test:server -- --test-name-pattern "meta 返回 sqlite"`
Expected: FAIL（`rd.sqlite === undefined`）

- [ ] **Step 3: 实现**

`server/projects.js` 顶部（`path`/`fs` 已 import）新增辅助，并在 `meta()` 内使用：

```js
function isSqliteHeader(abs, size) {
  if (!size || size < 16) return false;
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(abs, 'r');
  try { fs.readSync(fd, buf, 0, 16, 0); } finally { fs.closeSync(fd); }
  return buf.toString('latin1') === 'SQLite format 3\u0000';
}
```

`meta()`（`server/projects.js:114`）改为：

```js
  meta(projectId, rel) {
    const { abs, name, isDir } = this.revealTarget(projectId, rel);
    const st = fs.statSync(abs);
    const out = { name, path: rel, abs, size: st.size, mtime: st.mtimeMs, isDir };
    if (!isDir) out.sqlite = isSqliteHeader(abs, st.size);
    return out;
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd run test:server -- --test-name-pattern "meta 返回 sqlite"`
Expected: PASS

---

## Task 2: 前端纯函数

**Files:** Create `web/src/tools/navicat/sqliteFile.ts`, `web/src/tools/navicat/sqliteFile.test.ts`

- [ ] **Step 1: 写失败测试**

`web/src/tools/navicat/sqliteFile.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isDbExt, shouldOpenInNavicat, uniqueConnName } from './sqliteFile';

describe('sqliteFile', () => {
  it('isDbExt 命中常见扩展名且大小写不敏感', () => {
    for (const n of ['a.db', 'a.sqlite', 'a.sqlite3', 'a.db3', 'A.DB']) expect(isDbExt(n)).toBe(true);
    for (const n of ['a.ts', 'a.txt', 'adb', 'a.dbs']) expect(isDbExt(n)).toBe(false);
  });

  it('shouldOpenInNavicat：扩展名或内容头命中', () => {
    expect(shouldOpenInNavicat('a.txt', true)).toBe(true);
    expect(shouldOpenInNavicat('a.db', false)).toBe(true);
    expect(shouldOpenInNavicat('a.ts', false)).toBe(false);
  });

  it('uniqueConnName 冲突时追加序号', () => {
    expect(uniqueConnName('a.db', [])).toBe('a.db');
    expect(uniqueConnName('a.db', ['a.db'])).toBe('a.db (2)');
    expect(uniqueConnName('a.db', ['a.db', 'a.db (2)'])).toBe('a.db (3)');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run（工作目录 `web`）: `npx.cmd vitest run src/tools/navicat/sqliteFile.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`web/src/tools/navicat/sqliteFile.ts`：

```ts
const DB_EXTS = ['.db', '.sqlite', '.sqlite3', '.db3'];

export function isDbExt(name: string): boolean {
  const n = String(name || '').toLowerCase();
  return DB_EXTS.some((e) => n.endsWith(e));
}

export function shouldOpenInNavicat(name: string, sqlite: boolean): boolean {
  return isDbExt(name) || sqlite === true;
}

export function uniqueConnName(base: string, existing: string[]): string {
  const name = String(base || '').trim() || 'database';
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  for (let i = 2; ; i += 1) {
    const cand = `${name} (${i})`;
    if (!taken.has(cand)) return cand;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run（工作目录 `web`）: `npx.cmd vitest run src/tools/navicat/sqliteFile.test.ts`
Expected: PASS

---

## Task 3: 工作台 openSqliteFile

**Files:** Modify `web/src/tools/navicat/useNavicatWorkbench.ts`; Test `useNavicatWorkbench.test.ts`

- [ ] **Step 1: 写失败测试**

在 `useNavicatWorkbench.test.ts` 的 `describe` 内追加：

```ts
  it('openSqliteFile：没有则新建 sqlite 连接并选中', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (String(u) === '/api/navicat/profiles' && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)));
        return okJson({ item: { id: '9', name: 'a.db', type: 'sqlite', database: 'C:\\d\\a.db' } });
      }
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [] });
      return okJson({});
    }));
    const wb = useNavicatWorkbench();
    await wb.openSqliteFile('C:\\d\\a.db', 'a.db');
    expect(bodies[0]).toMatchObject({ type: 'sqlite', database: 'C:\\d\\a.db', name: 'a.db' });
    expect(wb.activeId.value).toBe('9');
  });

  it('openSqliteFile：同路径复用不新增', async () => {
    const posts: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (String(u) === '/api/navicat/profiles' && init?.method === 'POST') { posts.push(1); return okJson({ item: { id: '9' } }); }
      if (String(u) === '/api/navicat/profiles') return okJson({ items: [{ id: '9', name: 'a.db', type: 'sqlite', database: 'C:\\d\\a.db' }] });
      return okJson({});
    }));
    const wb = useNavicatWorkbench();
    await wb.openSqliteFile('C:\\d\\a.db', 'a.db');
    expect(posts).toHaveLength(0);
    expect(wb.activeId.value).toBe('9');
  });
```

- [ ] **Step 2: 运行确认失败**

Run（工作目录 `web`）: `npx.cmd vitest run src/tools/navicat/useNavicatWorkbench.test.ts`
Expected: FAIL（`openSqliteFile is not a function`）

- [ ] **Step 3: 实现**

`useNavicatWorkbench.ts`：顶部 import 纯函数：

```ts
import { uniqueConnName } from './sqliteFile';
```

接口 `NavicatWorkbench` 增加：

```ts
  openSqliteFile(abs: string, name: string): Promise<void>;
```

实现放在 `browseFile` 之后：

```ts
  async function openSqliteFile(abs: string, name: string) {
    if (!abs) return;
    await nav.load();
    const ex = nav.profiles.value.find((p) => p.type === 'sqlite' && p.database === abs);
    if (ex) { selectConn(ex); if (ex.id) activeFolder.value = `c:${ex.id}`; return; }
    const names = nav.profiles.value.map((p) => p.name);
    const saved = await nav.save({ name: uniqueConnName(name, names), type: 'sqlite', host: '', port: '', user: '', database: abs, password: '' });
    selectConn(saved);
    if (saved.id) activeFolder.value = `c:${saved.id}`;
  }
```

在 `cache = { ... }` 返回对象里加入 `openSqliteFile`。

- [ ] **Step 4: 运行确认通过**

Run（工作目录 `web`）: `npx.cmd vitest run src/tools/navicat/useNavicatWorkbench.test.ts`
Expected: PASS

---

## Task 4: i18n

**Files:** Modify `shared/i18n/zh-CN.js`, `shared/i18n/en.js`

- [ ] **Step 1: 加词条**

`zh-CN.js` 的 `'nv.database_file'` 行后加：

```js
  'nv.file_conn': '数据库文件',
```

`en.js` 同位置加：

```js
  'nv.file_conn': 'Database file',
```

- [ ] **Step 2: 校验**

Run: `npm.cmd run check:i18n`
Expected: PASS

---

## Task 5: App.vue 拦截

**Files:** Modify `web/src/App.vue`

- [ ] **Step 1: import**

`App.vue` 顶部加：

```js
import { useNavicatWorkbench } from './tools/navicat/useNavicatWorkbench';
import { shouldOpenInNavicat } from './tools/navicat/sqliteFile';
```

- [ ] **Step 2: 改 openFile（`App.vue:649`）**

```js
async function openFile(projectId: string, path: string) {
  const q = path.replace(/\\/g, '/');
  const i = q.lastIndexOf('/');
  const name = i >= 0 ? q.slice(i + 1) : q;   // 文件名一律由 path 推导
  try {
    const meta = await projectsApi.fileMeta(projectId, path);
    if (meta && !meta.isDir && shouldOpenInNavicat(name, (meta as { sqlite?: boolean }).sqlite === true) && meta.abs) {
      await useNavicatWorkbench().openSqliteFile(meta.abs, name);
      rail.value = 'explorer';
      center.openTool('navicat');
      return;
    }
  } catch { /* 探测失败：按普通文件打开 */ }
  pushFileHistory(projectId, q);
  center.openFile(projectId, path, name);
}
```

> `FileMeta` 类型未含 `sqlite`，用 `(meta as { sqlite?: boolean })` 兼容；后续如需严格类型，可在 `useProjects.ts` 的 `FileMeta` 接口补 `sqlite?: boolean`（推荐一并改）。

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 4: 现有 web 测试不回归**

Run: `npm.cmd run test:web`
Expected: PASS

---

## Task 6: 全量验证

- [ ] **Step 1:** `npm.cmd test` → PASS
- [ ] **Step 2:** `npm.cmd run typecheck` → PASS
- [ ] **Step 3:** `npm.cmd run check:i18n` → PASS
- [ ] **Step 4（手工，Windows）:** 项目里点 `.db`/`.sqlite` → 打开 Navicat 工具页签、左树出现并选中该连接、可列表/跑 SQL；点普通文本 → 仍打开文件页签。
