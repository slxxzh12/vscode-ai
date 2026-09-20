# Navicat 左栏树导航 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Navicat 小工具从「顶部下拉框选连接 + 单列表单」改为「左侧树导航 + 右侧上 SQL 下结果」，树按库类型懒加载（连接 → 库 → 表 / 连接 → 表 / 连接 → 数字库），点表自动生成 `SELECT *`，执行时用当前选中的库。

**Architecture:** 后端在既有 `navicat-exec.js` 上新增 `listDatabases`/`listTables`（复用建连逻辑，按库类型分支），`navicat-mount.js` 新增两个 schema 端点和 exec 的 `database` 覆盖；前端新增专用 `NavicatTree.vue`（三层数据树、懒加载、缓存、错误重试），`NavicatTool.vue` 重写为两栏布局 + 连接配置对话框，数据层 `useNavicat.ts` 增加 schema 方法与 `quoteIdent` 工具。

**Tech Stack:** Node ESM（`node:test`）、Vue 3 `<script setup>` + TypeScript、Element Plus（`el-dialog`/`el-input`/`ElMessageBox`）、vitest + @vue/test-utils（happy-dom）。

**关联 spec:** `docs/superpowers/specs/2026-09-20-navicat-tree-navigation-design.md`

---

## File Structure

- Modify: `server/navicat-exec.js` — 新增 `listDatabases` / `listTables`。
- Modify: `server/navicat-mount.js` — 新增 `GET /api/navicat/schema/databases`、`GET /api/navicat/schema/tables`；exec 支持 `database` 覆盖。
- Modify: `server/test/navicat-exec.test.js` — schema 用例（sqlite/redis 分支）。
- Modify: `server/test/navicat-http.test.js` — schema 端点 + exec database 覆盖用例。
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js` — 新增 9 个 `nv.*` 键。
- Modify: `web/src/tools/navicat/useNavicat.ts` — `listDatabases`/`listTables`/`quoteIdent`，`exec` 加 `database`。
- Modify: `web/src/tools/navicat/useNavicat.test.ts` — 新方法 + exec body 断言。
- Create: `web/src/tools/navicat/NavicatTree.vue` — 树组件。
- Create: `web/src/tools/navicat/NavicatTree.test.ts` — 树组件用例。
- Modify: `web/src/tools/navicat/NavicatTool.vue` — 两栏布局 + 对话框。
- Modify: `web/src/tools/navicat/NavicatTool.test.ts` — 按新布局重写。

不改动：`server/navicat-store.js`、`server/navicat-crypto.js`、`server/navicat-ncx.js`、`web/src/components/MiniTools.vue`、`web/src/components/MiniTools.test.ts`（MiniTools 的 Navicat 用例只验证 `.nvbody` 挂载，仍成立）。

---

## Task 1: 后端 exec 层新增 schema 查询

**Files:**
- Modify: `server/navicat-exec.js`（在 `return {` 之前插入两个方法）
- Test: `server/test/navicat-exec.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/navicat-exec.test.js` 末尾追加：

```js
test('schema：SQLite 列库/列表，Redis 数字库', async () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-nvschema-')), 'a.db');
  const exec = createNavicatExec({});
  const sqlite = { type: 'sqlite', database: dbFile };
  await exec.exec(sqlite, '', 'CREATE TABLE users(a INTEGER)');
  await exec.exec(sqlite, '', 'CREATE VIEW v_users AS SELECT * FROM users');
  assert.deepEqual(await exec.listDatabases(sqlite, ''), []);
  assert.deepEqual(await exec.listTables(sqlite, '', dbFile), ['users', 'v_users']);

  const redis = { type: 'redis', host: '127.0.0.1', port: '6379' };
  assert.deepEqual(await exec.listDatabases(redis, ''), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15']);
  assert.deepEqual(await exec.listTables(redis, '', '0'), []);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd run test:server -- --test-name-pattern "schema"`
（若上面的 `--` 透传不便，直接 `node --test "server/test/navicat-exec.test.js"`）
Expected: FAIL —— `exec.listDatabases is not a function`。

- [ ] **Step 3: 实现**

在 `server/navicat-exec.js` 里，找到：

```js
  return {
    isWriteSql,
```

在它**之前**插入：

```js
  async function listDatabases(profile, password) {
    if (profile.type === 'redis') return Array.from({ length: 16 }, (_, i) => String(i));
    if (profile.type === 'sqlite') return [];
    const sql = profile.type === 'mysql'
      ? 'SELECT schema_name FROM information_schema.schemata ORDER BY schema_name'
      : 'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname';
    try {
      const out = await withTimeout(run(profile, password, sql), connectTimeoutMs + statementTimeoutMs);
      return (out.rows || []).map((r) => String(r[0]));
    } catch (e) {
      if (e && !e.code) e.code = 'connect';
      throw e;
    }
  }

  async function listTables(profile, password, database) {
    if (profile.type === 'redis') return [];
    const p = { ...profile, database: database || profile.database };
    const sql = profile.type === 'mysql'
      ? `SELECT table_name FROM information_schema.tables WHERE table_schema = '${String(database || '').replace(/'/g, "''")}' ORDER BY table_name`
      : profile.type === 'postgres'
        ? 'SELECT tablename FROM pg_tables WHERE schemaname = ' + "'public'" + ' ORDER BY tablename'
        : "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name";
    try {
      const out = await withTimeout(run(p, password, sql), connectTimeoutMs + statementTimeoutMs);
      return (out.rows || []).map((r) => String(r[0]));
    } catch (e) {
      if (e && !e.code) e.code = 'connect';
      throw e;
    }
  }

```

再在返回对象里，找到：

```js
  return {
    isWriteSql,
    isWriteRedis,
    tokenizeRedis,
```

改为：

```js
  return {
    isWriteSql,
    isWriteRedis,
    tokenizeRedis,
    listDatabases,
    listTables,
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/navicat-exec.test.js"`
Expected: PASS（含新 schema 用例）。

- [ ] **Step 5: Commit**

```powershell
git add server/navicat-exec.js server/test/navicat-exec.test.js
git commit -m "feat(navicat): exec 层新增 listDatabases/listTables"
```

---

## Task 2: 后端 HTTP schema 端点与 exec database 覆盖

**Files:**
- Modify: `server/navicat-mount.js`
- Test: `server/test/navicat-http.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/navicat-http.test.js` 的 `fakeExec()` 里，找到：

```js
    exec: async (p, pw, sql) => {
      calls.push({ type: p.type, password: pw, sql });
      return { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 3 };
    },
    test: async (p, pw) => { calls.push({ test: p.type, password: pw }); return { ok: true }; },
```

改为（新增 database 记录与两个 schema 方法）：

```js
    exec: async (p, pw, sql) => {
      calls.push({ type: p.type, password: pw, sql, database: p.database });
      return { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 3 };
    },
    test: async (p, pw) => { calls.push({ test: p.type, password: pw }); return { ok: true }; },
    listDatabases: async (p) => { calls.push({ schema: 'databases', type: p.type }); return ['db1', 'db2']; },
    listTables: async (p, pw, db) => { calls.push({ schema: 'tables', db }); return ['t1', 't2']; },
```

在文件末尾追加：

```js
test('schema：databases/tables 端点', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  const dbs = await call(A.port, 'GET', `/api/navicat/schema/databases?id=${id}`);
  assert.equal(dbs.status, 200);
  assert.deepEqual(dbs.body.items, ['db1', 'db2']);
  const tbs = await call(A.port, 'GET', `/api/navicat/schema/tables?id=${id}&database=db2`);
  assert.deepEqual(tbs.body.items, ['t1', 't2']);
  assert.equal(A.exec.calls.find((c) => c.schema === 'tables').db, 'db2');
});

test('exec：database 覆盖档案并传给执行层', async (t) => {
  const A = await start();
  t.after(() => A.server.close());
  const id = (await call(A.port, 'POST', '/api/navicat/profiles', PROFILE)).body.item.id;
  await call(A.port, 'POST', '/api/navicat/exec', { id, sql: 'SELECT 1', database: 'other' });
  assert.equal(A.exec.calls.find((c) => c.sql === 'SELECT 1').database, 'other');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/navicat-http.test.js"`
Expected: FAIL —— `/schema/databases` 返回 404。

- [ ] **Step 3: 实现 schema 端点**

在 `server/navicat-mount.js` 的 `reveal` 分支之前，找到：

```js
    if (head === 'reveal' && m === 'POST') {
```

在它**之前**插入：

```js
    if (head === 'schema' && seg[1] === 'databases' && m === 'GET') {
      const p = store.get(String(url.searchParams.get('id') || ''));
      const items = await exec.listDatabases(p, store.password(p.id));
      return sendJson(res, 200, { items });
    }

    if (head === 'schema' && seg[1] === 'tables' && m === 'GET') {
      const p = store.get(String(url.searchParams.get('id') || ''));
      const database = url.searchParams.get('database') || '';
      const items = await exec.listTables(p, store.password(p.id), database || p.database);
      return sendJson(res, 200, { items });
    }

```

- [ ] **Step 4: 实现 exec database 覆盖**

在 `server/navicat-mount.js` 里，找到：

```js
    if (head === 'exec' && m === 'POST') {
      const p = store.get(String(body.id || ''));
      const sql = String(body.sql || '');
      if (!sql.trim()) return sendErr(res, 'bad-request');
      if (exec.isWrite(p, sql) && body.confirm !== true) {
        return sendJson(res, 200, { needConfirm: true, kind: 'write' });
      }
      const result = await exec.exec(p, store.password(p.id), sql);
      return sendJson(res, 200, { ok: true, result });
    }
```

改为：

```js
    if (head === 'exec' && m === 'POST') {
      const base = store.get(String(body.id || ''));
      const p = body.database !== undefined && body.database !== null && String(body.database) !== ''
        ? { ...base, database: String(body.database) }
        : base;
      const sql = String(body.sql || '');
      if (!sql.trim()) return sendErr(res, 'bad-request');
      if (exec.isWrite(p, sql) && body.confirm !== true) {
        return sendJson(res, 200, { needConfirm: true, kind: 'write' });
      }
      const result = await exec.exec(p, store.password(p.id), sql);
      return sendJson(res, 200, { ok: true, result });
    }
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test "server/test/navicat-http.test.js"`
Expected: PASS（原有 + 新增共 8 个用例全绿）。

- [ ] **Step 6: Commit**

```powershell
git add server/navicat-mount.js server/test/navicat-http.test.js
git commit -m "feat(navicat): schema 端点与 exec database 覆盖"
```

---

## Task 3: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:783`
- Modify: `shared/i18n/en.js:783`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 中，把：

```js
  'nv.new': '新建连接',
  'nv.search_ph': '搜索连接',
```

改为：

```js
  'nv.new': '新建连接',
  'nv.new_title': '新建连接',
  'nv.edit_title': '编辑连接',
  'nv.edit': '编辑',
  'nv.cancel': '取消',
  'nv.loading': '加载中…',
  'nv.refresh': '刷新',
  'nv.databases': '数据库',
  'nv.tables': '表',
  'nv.schema_load_failed': '加载失败，点击重试',
  'nv.search_ph': '搜索连接',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 中，把：

```js
  'nv.new': 'New connection',
  'nv.search_ph': 'Search connections',
```

改为：

```js
  'nv.new': 'New connection',
  'nv.new_title': 'New connection',
  'nv.edit_title': 'Edit connection',
  'nv.edit': 'Edit',
  'nv.cancel': 'Cancel',
  'nv.loading': 'Loading…',
  'nv.refresh': 'Refresh',
  'nv.databases': 'Databases',
  'nv.tables': 'Tables',
  'nv.schema_load_failed': 'Load failed, click to retry',
  'nv.search_ph': 'Search connections',
```

- [ ] **Step 3: 校验中英键集合对称**

Run: `npm.cmd run check:i18n`
Expected: 无错误输出（退出码 0）。

- [ ] **Step 4: Commit**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(navicat): 新增树导航/对话框词条"
```

---

## Task 4: 前端数据层 `useNavicat.ts`

**Files:**
- Modify: `web/src/tools/navicat/useNavicat.ts`（整文件替换）
- Test: `web/src/tools/navicat/useNavicat.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/tools/navicat/useNavicat.test.ts` 中，把导入行：

```ts
import { useNavicat } from './useNavicat';
```

改为：

```ts
import { useNavicat, quoteIdent } from './useNavicat';
```

把 `exec` 相关用例：

```ts
    const a = await s.exec('1', 'INSERT INTO t VALUES (1)');
    expect(a.needConfirm).toBe(true);
    const b = await s.exec('1', 'INSERT INTO t VALUES (1)', true);
    expect(b.result?.rows).toEqual([[1]]);
```

改为：

```ts
    const a = await s.exec('1', 'INSERT INTO t VALUES (1)');
    expect(a.needConfirm).toBe(true);
    const b = await s.exec('1', 'INSERT INTO t VALUES (1)', '', true);
    expect(b.result?.rows).toEqual([[1]]);
```

在 `describe('useNavicat', ...)` 内追加三个用例：

```ts
  it('exec：database 写入请求体', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : {});
      return okJson({ ok: true, result: { columns: [], rows: [], affected: 1, truncated: false, durationMs: 1 } });
    }));
    const s = useNavicat();
    await s.exec('1', 'SELECT 1', 'db2');
    expect(bodies[0].database).toBe('db2');
  });

  it('listDatabases / listTables 打 schema 端点', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(String(u));
      if (String(u).startsWith('/api/navicat/schema/databases')) return okJson({ items: ['db1'] });
      return okJson({ items: ['t1'] });
    }));
    const s = useNavicat();
    expect(await s.listDatabases('1')).toEqual(['db1']);
    expect(await s.listTables('1', 'db2')).toEqual(['t1']);
    expect(urls[0]).toBe('/api/navicat/schema/databases?id=1');
    expect(urls[1]).toBe('/api/navicat/schema/tables?id=1&database=db2');
  });

  it('quoteIdent：mysql 反引号，pg/sqlite 双引号并转义', () => {
    expect(quoteIdent('mysql', 'a`b')).toBe('`a``b`');
    expect(quoteIdent('postgres', 'a"b')).toBe('"a""b"');
    expect(quoteIdent('sqlite', 'users')).toBe('"users"');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/useNavicat.test.ts`
Expected: FAIL —— `quoteIdent` 未导出 / `listDatabases is not a function`。

- [ ] **Step 3: 用下方内容整体替换 `useNavicat.ts`**

```ts
import { ref, type Ref } from 'vue';

export type NavicatType = 'mysql' | 'postgres' | 'sqlite' | 'redis';

export type NavicatProfile = {
  id?: string;
  name: string;
  type: NavicatType;
  host: string;
  port: string;
  user: string;
  database: string;
  options?: { ssl?: boolean };
  hasPassword?: boolean;
  password?: string;
  updatedAt?: string;
};

export type ExecResult = {
  columns: string[];
  rows: unknown[][];
  affected: number | null;
  truncated: boolean;
  durationMs: number;
  raw?: string;
};

export type ExecOutcome = { needConfirm: boolean; result?: ExecResult };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch(url: string, opt: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opt);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(j?.message || j?.error || `HTTP ${res.status}`));
  return j;
}

export function quoteIdent(type: NavicatType, name: string): string {
  const q = type === 'mysql' ? '`' : '"';
  return q + String(name ?? '').split(q).join(q + q) + q;
}

export function useNavicat(): {
  profiles: Ref<NavicatProfile[]>;
  load: () => Promise<void>;
  save: (p: NavicatProfile) => Promise<NavicatProfile>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  test: (p: { id?: string } | { profile: NavicatProfile }) => Promise<void>;
  exec: (id: string, sql: string, database?: string, confirm?: boolean) => Promise<ExecOutcome>;
  reveal: (id: string) => Promise<string>;
  connstr: (id: string, withPassword: boolean) => Promise<string>;
  exportNcx: (ids: string[]) => Promise<string>;
  listDatabases: (id: string) => Promise<string[]>;
  listTables: (id: string, database: string) => Promise<string[]>;
} {
  const profiles = ref<NavicatProfile[]>([]);

  async function load(): Promise<void> {
    try {
      const j = await jfetch('/api/navicat/profiles');
      profiles.value = Array.isArray(j.items) ? j.items : [];
    } catch { /* 列表失败不阻塞 */ }
  }

  async function save(p: NavicatProfile): Promise<NavicatProfile> {
    const j = await jfetch('/api/navicat/profiles', {
      method: p.id ? 'PATCH' : 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(p),
    });
    await load();
    return j.item as NavicatProfile;
  }

  async function remove(id: string): Promise<void> {
    await jfetch(`/api/navicat/profiles?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  async function rename(id: string, name: string): Promise<void> {
    await jfetch('/api/navicat/profiles', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, name }) });
    await load();
  }

  async function test(p: { id?: string } | { profile: NavicatProfile }): Promise<void> {
    await jfetch('/api/navicat/test', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(p) });
  }

  async function exec(id: string, sql: string, database = '', confirm = false): Promise<ExecOutcome> {
    const j = await jfetch('/api/navicat/exec', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, sql, database, confirm }) });
    if (j.needConfirm) return { needConfirm: true };
    return { needConfirm: false, result: j.result as ExecResult };
  }

  async function reveal(id: string): Promise<string> {
    const j = await jfetch('/api/navicat/reveal', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id }) });
    return String(j.password || '');
  }

  async function connstr(id: string, withPassword: boolean): Promise<string> {
    const j = await jfetch('/api/navicat/connstr', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, withPassword }) });
    return String(j.text || '');
  }

  async function exportNcx(ids: string[]): Promise<string> {
    const j = await jfetch('/api/navicat/ncx', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ids }) });
    return String(j.xml || '');
  }

  async function listDatabases(id: string): Promise<string[]> {
    const j = await jfetch(`/api/navicat/schema/databases?id=${encodeURIComponent(id)}`);
    return Array.isArray(j.items) ? j.items.map(String) : [];
  }

  async function listTables(id: string, database: string): Promise<string[]> {
    const q = new URLSearchParams({ id, database: database || '' });
    const j = await jfetch(`/api/navicat/schema/tables?${q.toString()}`);
    return Array.isArray(j.items) ? j.items.map(String) : [];
  }

  return { profiles, load, save, remove, rename, test, exec, reveal, connstr, exportNcx, listDatabases, listTables };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/useNavicat.test.ts`
Expected: PASS（7 个用例）。

- [ ] **Step 5: Commit**

```powershell
git add web/src/tools/navicat/useNavicat.ts web/src/tools/navicat/useNavicat.test.ts
git commit -m "feat(navicat): 数据层新增 schema 查询与库覆盖"
```

---

## Task 5: 树组件 `NavicatTree.vue`

**Files:**
- Create: `web/src/tools/navicat/NavicatTree.test.ts`
- Create: `web/src/tools/navicat/NavicatTree.vue`

- [ ] **Step 1: 写失败测试**

创建 `web/src/tools/navicat/NavicatTree.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import NavicatTree from './NavicatTree.vue';

const MYSQL = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', hasPassword: true };
const SQLITE = { id: '2', name: 'S', type: 'sqlite', host: '', port: '', user: '', database: 'C:/a.db', hasPassword: false };
const REDIS = { id: '3', name: 'R', type: 'redis', host: 'h', port: '6379', user: '', database: '0', hasPassword: false };

afterEach(() => { vi.restoreAllMocks(); });

function mount(props: Record<string, unknown> = {}) {
  return mountC(NavicatTree, {
    props: {
      profiles: [],
      activeId: '',
      activeDatabase: '',
      version: 0,
      fetchDatabases: vi.fn(async () => []),
      fetchTables: vi.fn(async () => []),
      ...props,
    },
  });
}

describe('NavicatTree', () => {
  it('展开 mysql 连接加载库并渲染库节点', async () => {
    const fetchDatabases = vi.fn(async () => ['db1', 'db2']);
    const w = mount({ profiles: [MYSQL], fetchDatabases });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    expect(fetchDatabases).toHaveBeenCalledWith('1');
    expect(w.text()).toContain('db1');
    expect(w.find('.nvdbitem').exists()).toBe(true);
  });

  it('展开库加载表，点表发出 pick-table', async () => {
    const fetchTables = vi.fn(async () => ['users']);
    const w = mount({ profiles: [MYSQL], fetchDatabases: vi.fn(async () => ['db1']), fetchTables });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    await w.find('.nvdbitem .nvchev').trigger('click');
    await flushPromises();
    expect(fetchTables).toHaveBeenCalledWith('1', 'db1');
    await w.find('.nvtbname').trigger('click');
    expect(w.emitted('pick-table')?.[0]).toEqual(['db1', 'users']);
  });

  it('点库名发出 select-database', async () => {
    const w = mount({ profiles: [MYSQL], fetchDatabases: vi.fn(async () => ['db1']) });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    await w.find('.nvdname').trigger('click');
    expect(w.emitted('select-database')?.[0]).toEqual(['db1']);
  });

  it('sqlite 展开直接列表（用档案文件路径），点表 database 为空', async () => {
    const fetchTables = vi.fn(async () => ['t1']);
    const w = mount({ profiles: [SQLITE], fetchTables });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    expect(fetchTables).toHaveBeenCalledWith('2', 'C:/a.db');
    await w.find('.nvtbname').trigger('click');
    expect(w.emitted('pick-table')?.[0]).toEqual(['', 't1']);
  });

  it('redis 展开列出数字库，点库发出 select-database', async () => {
    const w = mount({ profiles: [REDIS], fetchDatabases: vi.fn(async () => ['0', '1']) });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    await w.find('.nvdname').trigger('click');
    expect(w.emitted('select-database')?.[0]).toEqual(['0']);
  });

  it('选中连接名发出 select-conn；连接操作按钮发 edit/rename/remove', async () => {
    const w = mount({ profiles: [MYSQL] });
    await w.find('.nvconnname').trigger('click');
    expect(w.emitted('select-conn')?.[0]?.[0]).toMatchObject({ id: '1' });
    await w.find('.nvedit').trigger('click');
    expect(w.emitted('edit')?.[0]?.[0]).toMatchObject({ id: '1' });
    await w.find('.nvrename').trigger('click');
    expect(w.emitted('rename')?.[0]?.[0]).toMatchObject({ id: '1' });
    await w.find('.nvremove').trigger('click');
    expect(w.emitted('remove')?.[0]?.[0]).toMatchObject({ id: '1' });
  });

  it('加载失败显示错误文案', async () => {
    const w = mount({ profiles: [MYSQL], fetchDatabases: vi.fn(async () => { throw new Error('boom'); }) });
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    expect(w.find('.nverr').text()).toContain('boom');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatTree.test.ts`
Expected: FAIL —— 组件不存在，解析失败。

- [ ] **Step 3: 创建 `NavicatTree.vue`**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '../../i18n';
import type { NavicatProfile } from './useNavicat';

const props = defineProps<{
  profiles: NavicatProfile[];
  activeId: string;
  activeDatabase: string;
  version: number;
  fetchDatabases: (id: string) => Promise<string[]>;
  fetchTables: (id: string, database: string) => Promise<string[]>;
}>();
const emit = defineEmits<{
  (e: 'select-conn', p: NavicatProfile): void;
  (e: 'select-database', db: string): void;
  (e: 'pick-table', database: string, table: string): void;
  (e: 'edit', p: NavicatProfile): void;
  (e: 'rename', p: NavicatProfile): void;
  (e: 'remove', p: NavicatProfile): void;
}>();

const expanded = ref<Record<string, boolean>>({});
const databases = ref<Record<string, string[]>>({});
const tables = ref<Record<string, string[]>>({});
const loading = ref<Record<string, boolean>>({});
const errors = ref<Record<string, string>>({});

function setKey(store: { value: Record<string, any> }, key: string, value: any) {
  store.value = { ...store.value, [key]: value };
}
function clearKey(store: { value: Record<string, any> }, key: string) {
  const next = { ...store.value };
  delete next[key];
  store.value = next;
}

function dbKey(id: string) { return `d:${id}`; }
function tbKey(id: string, db: string) { return `t:${id}\u0000${db}`; }
function connExpanded(id: string) { return !!expanded.value[`c:${id}`]; }
function dbExpanded(id: string, db: string) { return !!expanded.value[`${id}\u0000${db}`]; }
function dbList(id: string) { return databases.value[id] || []; }
function tbList(id: string, db: string) { return tables.value[tbKey(id, db)] || []; }
function dbLoaded(id: string) { return databases.value[id] !== undefined; }
function tbLoaded(id: string, db: string) { return tables.value[tbKey(id, db)] !== undefined; }
function isLoading(key: string) { return !!loading.value[key]; }
function errorOf(key: string) { return errors.value[key] || ''; }

async function loadDatabases(p: NavicatProfile) {
  const id = p.id as string;
  const key = dbKey(id);
  if (databases.value[id] || loading.value[key]) return;
  setKey(loading, key, true);
  clearKey(errors, key);
  try {
    setKey(databases, id, await props.fetchDatabases(id));
  } catch (e) {
    setKey(errors, key, (e as Error).message || t('nv.schema_load_failed'));
  } finally {
    clearKey(loading, key);
  }
}

async function loadTables(id: string, db: string) {
  const key = tbKey(id, db);
  if (tables.value[key] || loading.value[key]) return;
  setKey(loading, key, true);
  clearKey(errors, key);
  try {
    setKey(tables, key, await props.fetchTables(id, db));
  } catch (e) {
    setKey(errors, key, (e as Error).message || t('nv.schema_load_failed'));
  } finally {
    clearKey(loading, key);
  }
}

async function toggleConn(p: NavicatProfile) {
  const id = p.id as string;
  const key = `c:${id}`;
  if (expanded.value[key]) { clearKey(expanded, key); return; }
  setKey(expanded, key, true);
  if (p.type === 'sqlite') await loadTables(id, p.database || '');
  else await loadDatabases(p);
}

async function toggleDb(p: NavicatProfile, db: string) {
  const id = p.id as string;
  const key = `${id}\u0000${db}`;
  if (expanded.value[key]) { clearKey(expanded, key); return; }
  setKey(expanded, key, true);
  await loadTables(id, db);
}

function retryDb(p: NavicatProfile) { clearKey(errors, dbKey(p.id as string)); void loadDatabases(p); }
function retryTables(id: string, db: string) { clearKey(errors, tbKey(id, db)); void loadTables(id, db); }

watch(() => props.version, () => {
  expanded.value = {};
  databases.value = {};
  tables.value = {};
  loading.value = {};
  errors.value = {};
});
</script>

<template>
  <div class="nvtree">
    <div v-for="p in profiles" :key="p.id" class="nvblock">
      <div class="nvconn" :class="{ on: p.id === activeId }">
        <span class="nvchev" :class="{ collapsed: !connExpanded(p.id as string) }" @click.stop="toggleConn(p)">▸</span>
        <span class="nvbtype">{{ p.type }}</span>
        <span class="nvconnname" @click="emit('select-conn', p)">{{ p.name }}</span>
        <span class="nvacts">
          <button class="nvedit" :title="$t('nv.edit')" @click.stop="emit('edit', p)">✎</button>
          <button class="nvrename" :title="$t('nv.rename')" @click.stop="emit('rename', p)">⇄</button>
          <button class="nvremove" :title="$t('nv.delete')" @click.stop="emit('remove', p)">×</button>
        </span>
      </div>

      <div v-if="connExpanded(p.id as string)" class="nvchildren">
        <template v-if="p.type === 'redis'">
          <div v-for="db in dbList(p.id as string)" :key="db" class="nvdbitem"
               :class="{ on: p.id === activeId && db === activeDatabase }">
            <span class="nvchev invisible">▸</span>
            <span class="nvdname" @click="emit('select-database', db)">{{ db }}</span>
          </div>
          <div v-if="isLoading(dbKey(p.id as string))" class="nvloading">{{ $t('nv.loading') }}</div>
          <div v-else-if="errorOf(dbKey(p.id as string))" class="nverr" @click="retryDb(p)">{{ errorOf(dbKey(p.id as string)) }}</div>
        </template>

        <template v-else-if="p.type === 'sqlite'">
          <div v-for="tb in tbList(p.id as string, p.database || '')" :key="tb" class="nvtb">
            <span class="nvchev invisible">▸</span>
            <span class="nvtbname" @click="emit('pick-table', '', tb)">{{ tb }}</span>
          </div>
          <div v-if="isLoading(tbKey(p.id as string, p.database || ''))" class="nvloading">{{ $t('nv.loading') }}</div>
          <div v-else-if="errorOf(tbKey(p.id as string, p.database || ''))" class="nverr" @click="retryTables(p.id as string, p.database || '')">{{ errorOf(tbKey(p.id as string, p.database || '')) }}</div>
          <div v-else-if="tbLoaded(p.id as string, p.database || '') && !tbList(p.id as string, p.database || '').length" class="nvempty">{{ $t('nv.tables') }}</div>
        </template>

        <template v-else>
          <div v-for="db in dbList(p.id as string)" :key="db" class="nvdbnode">
            <div class="nvdbitem" :class="{ on: p.id === activeId && db === activeDatabase }">
              <span class="nvchev" :class="{ collapsed: !dbExpanded(p.id as string, db) }" @click.stop="toggleDb(p, db)">▸</span>
              <span class="nvdname" @click="emit('select-database', db)">{{ db }}</span>
            </div>
            <div v-if="dbExpanded(p.id as string, db)" class="nvchildren">
              <div v-for="tb in tbList(p.id as string, db)" :key="tb" class="nvtb">
                <span class="nvchev invisible">▸</span>
                <span class="nvtbname" @click="emit('pick-table', db, tb)">{{ tb }}</span>
              </div>
              <div v-if="isLoading(tbKey(p.id as string, db))" class="nvloading">{{ $t('nv.loading') }}</div>
              <div v-else-if="errorOf(tbKey(p.id as string, db))" class="nverr" @click="retryTables(p.id as string, db)">{{ errorOf(tbKey(p.id as string, db)) }}</div>
              <div v-else-if="tbLoaded(p.id as string, db) && !tbList(p.id as string, db).length" class="nvempty">{{ $t('nv.tables') }}</div>
            </div>
          </div>
          <div v-if="isLoading(dbKey(p.id as string))" class="nvloading">{{ $t('nv.loading') }}</div>
          <div v-else-if="errorOf(dbKey(p.id as string))" class="nverr" @click="retryDb(p)">{{ errorOf(dbKey(p.id as string)) }}</div>
          <div v-else-if="dbLoaded(p.id as string) && !dbList(p.id as string).length" class="nvempty">{{ $t('nv.databases') }}</div>
        </template>
      </div>
    </div>

    <div v-if="!profiles.length" class="nvempty">{{ $t('nv.empty') }}</div>
  </div>
</template>

<style scoped>
.nvtree { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; font-size: 12px; }
.nvblock { display: flex; flex-direction: column; }
.nvconn, .nvdbitem { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: 6px; cursor: pointer; color: var(--tx2); }
.nvconn:hover, .nvdbitem:hover { background: var(--bg4); }
.nvconn.on { background: var(--bg4); color: var(--ac2); }
.nvdbitem.on { background: var(--bg4); color: var(--ac2); }
.nvchildren { display: flex; flex-direction: column; gap: 2px; padding-left: 14px; }
.nvchildren .nvchildren { padding-left: 14px; }
.nvchev { flex: none; width: 12px; text-align: center; color: var(--tx4); transition: transform .12s; }
.nvchev.invisible { visibility: hidden; }
.nvchev.collapsed { transform: rotate(-90deg); }
.nvbtype { flex: none; font-size: 10px; color: var(--tx4); border: 1px solid var(--bd); border-radius: 3px; padding: 0 4px; text-transform: uppercase; }
.nvconnname, .nvdname, .nvtbname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nvacts { display: none; flex: none; gap: 2px; }
.nvconn:hover .nvacts { display: inline-flex; }
.nvacts button { border: none; background: none; color: var(--tx4); cursor: pointer; font-size: 12px; line-height: 1; padding: 2px 3px; }
.nvacts button:hover { color: var(--ac2); }
.nvdbnode { display: flex; flex-direction: column; }
.nvtb { display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 6px; color: var(--tx3); cursor: pointer; }
.nvtb:hover { background: var(--bg4); color: var(--ac2); }
.nvloading, .nvempty { padding: 4px 8px; color: var(--tx4); font-size: 11px; }
.nverr { padding: 4px 8px; color: #e06c75; font-size: 11px; cursor: pointer; }
</style>
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatTree.test.ts`
Expected: PASS（7 个用例）。

- [ ] **Step 5: Commit**

```powershell
git add web/src/tools/navicat/NavicatTree.vue web/src/tools/navicat/NavicatTree.test.ts
git commit -m "feat(navicat): 新增左栏树组件（懒加载库/表）"
```

---

## Task 6: 重写 `NavicatTool.vue` 为两栏布局

**Files:**
- Modify: `web/src/tools/navicat/NavicatTool.test.ts`（整文件替换）
- Modify: `web/src/tools/navicat/NavicatTool.vue`（整文件替换）

- [ ] **Step 1: 用下方内容整体替换 `NavicatTool.test.ts`**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { mountC } from '../../test-utils';
import NavicatTool from './NavicatTool.vue';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const P = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', hasPassword: true };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  return mountC(NavicatTool, { global: { plugins: [ElementPlus] } });
}

function stubFetch(extra: (u: string, init?: RequestInit) => any) {
  return vi.fn(async (u: string, init?: RequestInit) => {
    const s = String(u);
    if (s === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [P] });
    if (s.startsWith('/api/navicat/schema/databases')) return okJson({ items: ['db1'] });
    if (s.startsWith('/api/navicat/schema/tables')) return okJson({ items: ['users'] });
    if (s === '/api/navicat/reveal') return okJson({ password: '' });
    return extra(s, init);
  });
}

describe('NavicatTool', () => {
  it('新建连接对话框：保存走 POST', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      calls.push([u, init?.method]);
      return okJson({ ok: true, item: { ...P, id: '2', name: 'B' } });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nvnewbtn').trigger('click');
    await flushPromises();
    expect(w.find('.nv-name-input input').exists()).toBe(true);
    await w.find('.nv-name-input input').setValue('B');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'POST')).toBe(true);
  });

  it('编辑连接对话框：保存走 PATCH', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      calls.push([u, init?.method]);
      return okJson({ ok: true, item: P });
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nvedit').trigger('click');
    await flushPromises();
    await w.find('.nv-name-input input').setValue('A2');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'PATCH')).toBe(true);
  });

  it('选中连接：工具栏显示连接名', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const w = mount();
    await flushPromises();
    await w.find('.nvconnname').trigger('click');
    await flushPromises();
    expect(w.find('.nvactive').text()).toBe('A');
  });

  it('展开库并点表：生成 SELECT * 且执行带 database', async () => {
    let execBody: any = null;
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      if (u === '/api/navicat/exec') {
        execBody = init?.body ? JSON.parse(String(init.body)) : {};
        return okJson({ ok: true, result: { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 2 } });
      }
      return okJson({});
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nvconnname').trigger('click');
    await w.find('.nvconn .nvchev').trigger('click');
    await flushPromises();
    await w.find('.nvdbitem .nvchev').trigger('click');
    await flushPromises();
    await w.find('.nvtbname').trigger('click');
    expect((w.find('.nv-sql').element as HTMLTextAreaElement).value).toBe('SELECT * FROM `users`');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(execBody.database).toBe('db1');
    expect(w.find('.nv-table').exists()).toBe(true);
  });

  it('写语句先弹确认，确认后执行', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      if (u === '/api/navicat/exec' && b.confirm) return okJson({ ok: true, result: { columns: [], rows: [], affected: 1, truncated: false, durationMs: 1 } });
      if (u === '/api/navicat/exec') return okJson({ needConfirm: true, kind: 'write' });
      return okJson({});
    }));
    const w = mount();
    await flushPromises();
    await w.find('.nvconnname').trigger('click');
    await w.find('.nv-sql').setValue('INSERT INTO t VALUES (1)');
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalled();
    expect(w.find('.nv-meta').text()).toContain('1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatTool.test.ts`
Expected: FAIL —— 找不到 `.nvnewbtn` / `.nvconnname`。

- [ ] **Step 3: 用下方内容整体替换 `NavicatTool.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { quoteIdent, useNavicat, type ExecResult, type NavicatProfile, type NavicatType } from './useNavicat';
import NavicatTree from './NavicatTree.vue';

const { profiles, load, save, remove, rename, test, exec, reveal, connstr, exportNcx, listDatabases, listTables } = useNavicat();

const TYPES: NavicatType[] = ['mysql', 'postgres', 'sqlite', 'redis'];

const search = ref('');
const activeId = ref('');
const activeDatabase = ref('');
const sql = ref('');
const busy = ref(false);
const testing = ref(false);
const saving = ref(false);
const msg = ref('');
const result = ref<ExecResult | null>(null);
const treeVersion = ref(0);

const dlg = ref(false);
const dlgMsg = ref('');
const form = ref<NavicatProfile>(blank());

const isSqlite = computed(() => form.value.type === 'sqlite');
const isRedis = computed(() => form.value.type === 'redis');
const dbLabel = computed(() => (isRedis.value ? t('nv.db_index') : t('nv.database')));
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? profiles.value.filter((p) => p.name.toLowerCase().includes(q)) : profiles.value;
});
const activeProfile = computed(() => profiles.value.find((p) => p.id === activeId.value) || null);

function blank(): NavicatProfile {
  return { name: '', type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', database: '', password: '' };
}

function defaultPort(type: NavicatType): string {
  return type === 'mysql' ? '3306' : type === 'postgres' ? '5432' : type === 'redis' ? '6379' : '';
}

function onTypeChange() {
  if (!form.value.port || ['3306', '5432', '6379', ''].includes(form.value.port)) form.value.port = defaultPort(form.value.type);
}

function openNew() {
  form.value = blank();
  dlgMsg.value = '';
  dlg.value = true;
}

async function openEdit(p: NavicatProfile) {
  form.value = { ...blank(), ...p, password: '' };
  dlgMsg.value = '';
  dlg.value = true;
  if (p.hasPassword && p.id) {
    try { form.value.password = await reveal(p.id); } catch { /* ignore */ }
  }
}

function editActive() { if (activeProfile.value) void openEdit(activeProfile.value); }

async function doSave() {
  if (!form.value.name.trim()) { dlgMsg.value = t('nv.required_name'); return; }
  saving.value = true; dlgMsg.value = '';
  try {
    const saved = await save({ ...form.value });
    dlg.value = false;
    activeId.value = saved.id || '';
    activeDatabase.value = form.value.type === 'sqlite' ? '' : (saved.database || '');
    treeVersion.value += 1;
    msg.value = t('nv.saved');
  } catch (e) { dlgMsg.value = (e as Error).message; } finally { saving.value = false; }
}

async function doTest() {
  testing.value = true; dlgMsg.value = '';
  try {
    if (form.value.id && !form.value.password) await test({ id: form.value.id });
    else await test({ profile: form.value });
    dlgMsg.value = t('nv.test_ok');
  } catch (e) { dlgMsg.value = (e as Error).message; } finally { testing.value = false; }
}

function onSelectConn(p: NavicatProfile) {
  activeId.value = p.id || '';
  activeDatabase.value = p.type === 'sqlite' ? '' : (p.database || '');
  result.value = null;
  msg.value = '';
}

function onSelectDatabase(db: string) { activeDatabase.value = db; }

function onPickTable(db: string, table: string) {
  const p = activeProfile.value;
  if (!p) return;
  if (p.type !== 'sqlite') activeDatabase.value = db;
  const stmt = `SELECT * FROM ${quoteIdent(p.type, table)}`;
  const cur = sql.value.replace(/\s+$/, '');
  sql.value = cur ? `${cur}\n${stmt}` : stmt;
}

async function doExec() {
  if (!activeId.value) { msg.value = t('nv.save_first'); return; }
  if (!sql.value.trim()) return;
  busy.value = true; msg.value = '';
  try {
    let out = await exec(activeId.value, sql.value, activeDatabase.value);
    if (out.needConfirm) {
      try {
        await ElMessageBox.confirm(t('nv.confirm_write'), t('nv.confirm_title'), { type: 'warning' });
      } catch { busy.value = false; return; }
      out = await exec(activeId.value, sql.value, activeDatabase.value, true);
    }
    result.value = out.result || null;
  } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
}

async function copyConn(withPassword: boolean) {
  if (!activeId.value) { msg.value = t('nv.save_first'); return; }
  try {
    const text = await connstr(activeId.value, withPassword);
    await navigator.clipboard.writeText(text);
    msg.value = t('nv.copied');
  } catch (e) { msg.value = (e as Error).message; }
}

async function doExport() {
  if (!activeId.value) { msg.value = t('nv.save_first'); return; }
  try {
    const xml = await exportNcx([activeId.value]);
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'navicat.ncx';
    a.click();
    URL.revokeObjectURL(a.href);
    msg.value = t('nv.exported');
  } catch (e) { msg.value = (e as Error).message; }
}

async function onRename(p: NavicatProfile) {
  try {
    const res = await ElMessageBox.prompt(t('nv.rename'), t('nv.rename_ph'), { inputValue: p.name }) as any;
    if (res?.value) await rename(p.id!, res.value);
  } catch { /* cancelled */ }
}

async function onRemove(p: NavicatProfile) {
  try {
    await ElMessageBox.confirm(t('nv.delete_confirm'), t('nv.delete'), { type: 'warning' });
  } catch { return; }
  await remove(p.id!);
  if (activeId.value === p.id) { activeId.value = ''; activeDatabase.value = ''; result.value = null; }
  treeVersion.value += 1;
}

function exportCsv() {
  if (!result.value) return;
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [result.value.columns.map(esc).join(',')];
  for (const row of result.value.rows) lines.push(row.map(esc).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'result.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

onMounted(() => { void load(); });
</script>

<template>
  <div class="nvbody">
    <aside class="nvside">
      <div class="nvsidehead">
        <button class="nvbtn primary nvnewbtn" @click="openNew">{{ $t('nv.new') }}</button>
        <button class="nvmini" :title="$t('nv.refresh')" @click="treeVersion += 1">⟳</button>
      </div>
      <input v-model="search" class="nvsearch" :placeholder="$t('nv.search_ph')" />
      <NavicatTree
        :profiles="filtered"
        :active-id="activeId"
        :active-database="activeDatabase"
        :version="treeVersion"
        :fetch-databases="listDatabases"
        :fetch-tables="listTables"
        @select-conn="onSelectConn"
        @select-database="onSelectDatabase"
        @pick-table="onPickTable"
        @edit="openEdit"
        @rename="onRename"
        @remove="onRemove"
      />
    </aside>

    <section class="nvmain">
      <div class="nvtoolbar">
        <span class="nvactive">{{ activeProfile ? activeProfile.name : $t('nv.empty') }}</span>
        <span v-if="activeProfile && activeDatabase" class="nvactivedb">· {{ activeDatabase }}</span>
        <button v-if="activeProfile" class="nvbtn" @click="editActive">{{ $t('nv.edit') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-copy" @click="copyConn(false)">{{ $t('nv.copy_connstr') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-copy-pw" @click="copyConn(true)">{{ $t('nv.copy_with_pw') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-export" @click="doExport">{{ $t('nv.export_ncx') }}</button>
      </div>

      <div v-if="msg" class="nvmsg">{{ msg }}</div>

      <textarea v-model="sql" class="nv-sql" :placeholder="$t('nv.sql_ph')" spellcheck="false" />

      <div class="nvresbar">
        <button class="nvbtn primary nv-run" :disabled="busy" @click="doExec">{{ busy ? $t('nv.running') : $t('nv.exec') }}</button>
        <button class="nvbtn" @click="sql = ''; result = null; msg = ''">{{ $t('nv.clear') }}</button>
        <span class="nv-meta">
          <template v-if="result">
            <span v-if="result.truncated">{{ $t('nv.truncated', { n: result.rows.length }) }} · </span>
            <span v-if="result.affected !== null">{{ $t('nv.affected', { n: result.affected }) }} · </span>
            <span>{{ $t('nv.duration', { ms: result.durationMs }) }}</span>
          </template>
        </span>
        <button v-if="result && result.columns.length" class="nvbtn nvexport" style="margin-left:auto" @click="exportCsv">CSV</button>
      </div>

      <div class="nvresult">
        <table v-if="result && result.columns.length" class="nv-table">
          <thead><tr><th v-for="c in result.columns" :key="c">{{ c }}</th></tr></thead>
          <tbody><tr v-for="(row, i) in result.rows" :key="i"><td v-for="(cell, j) in row" :key="j">{{ cell }}</td></tr></tbody>
        </table>
        <pre v-else-if="result && result.raw" class="nv-raw">{{ result.raw }}</pre>
        <div v-else class="nv-noresult">{{ $t('nv.no_result') }}</div>
      </div>
    </section>

    <el-dialog v-model="dlg" :title="form.id ? $t('nv.edit_title') : $t('nv.new_title')" width="520px" class="nvdlg">
      <div class="nvform">
        <el-input v-model="form.name" class="nv-name-input" size="small" :placeholder="$t('nv.name')" />
        <select v-model="form.type" class="nv-type" @change="onTypeChange">
          <option v-for="ty in TYPES" :key="ty" :value="ty">{{ ty }}</option>
        </select>
        <template v-if="!isSqlite">
          <el-input v-model="form.host" size="small" class="nv-host" :placeholder="$t('nv.host')" />
          <el-input v-model="form.port" size="small" class="nv-port" :placeholder="$t('nv.port')" />
          <el-input v-if="!isRedis" v-model="form.user" size="small" class="nv-user" :placeholder="$t('nv.user')" />
          <div v-if="!isRedis" class="nv-pw">
            <el-input v-model="form.password" size="small" type="password" show-password :placeholder="form.hasPassword && !form.password ? '••••••' : $t('nv.password')" />
          </div>
        </template>
        <el-input v-model="form.database" size="small" class="nv-db" :placeholder="dbLabel" />
      </div>
      <div v-if="dlgMsg" class="nvmsg nvdlgmsg">{{ dlgMsg }}</div>
      <template #footer>
        <button class="nvbtn nv-test" :disabled="testing" @click="doTest">{{ testing ? $t('nv.testing') : $t('nv.test') }}</button>
        <button class="nvbtn" @click="dlg = false">{{ $t('nv.cancel') }}</button>
        <button class="nvbtn primary nv-save" :disabled="saving" @click="doSave">{{ $t('nv.save') }}</button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.nvbody { display: flex; flex-direction: row; gap: 12px; height: calc(100vh - 150px); }
.nvside { width: 260px; flex: none; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--bd); border-radius: 8px; background: var(--bg2); overflow: hidden; padding: 6px; box-sizing: border-box; }
.nvsidehead { display: flex; align-items: center; gap: 6px; }
.nvsidehead .nvnewbtn { flex: 1; }
.nvsearch { width: 100%; box-sizing: border-box; background: var(--bg1); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; font-size: 12px; }
.nvsearch:focus { outline: none; border-color: var(--ac2); }
.nvmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.nvtoolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.nvactive { color: var(--tx); font-size: 13px; font-weight: 600; }
.nvactivedb { color: var(--tx4); font-size: 12px; }
.nvbtn { background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.nvbtn:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.nvbtn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
.nvbtn:disabled { opacity: .55; cursor: default; }
.nvmini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
.nvmini:hover { border-color: var(--ac2); color: var(--ac2); }
.nvmsg { color: var(--tx3); font-size: 12px; }
.nv-sql { flex: none; min-height: 140px; resize: vertical; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.6; font-family: ui-monospace, Consolas, monospace; box-sizing: border-box; }
.nv-sql:focus { outline: none; border-color: var(--ac2); }
.nvresbar { display: flex; gap: 8px; align-items: center; }
.nv-meta { color: var(--tx4); font-size: 12px; }
.nvresult { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg2); }
.nv-table { border-collapse: collapse; font-size: 12px; font-family: ui-monospace, Consolas, monospace; width: max-content; min-width: 100%; }
.nv-table th, .nv-table td { border: 1px solid var(--bd); padding: 4px 8px; text-align: left; white-space: nowrap; color: var(--tx); }
.nv-table th { background: var(--bg4); position: sticky; top: 0; }
.nv-raw { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--tx); white-space: pre-wrap; }
.nv-noresult { color: var(--tx4); font-size: 12px; padding: 14px; text-align: center; }
.nvform { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.nv-name-input { width: 150px; }
.nv-type { width: 110px; height: 28px; background: var(--bg2); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 0 6px; font-size: 13px; }
.nv-type:focus { outline: none; border-color: var(--ac2); }
.nv-host { width: 150px; }
.nv-port { width: 90px; }
.nv-user { width: 110px; }
.nv-db { width: 200px; }
.nv-pw { display: flex; gap: 4px; align-items: center; width: 200px; }
.nvform .el-input { flex: none; }
</style>
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatTool.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: Commit**

```powershell
git add web/src/tools/navicat/NavicatTool.vue web/src/tools/navicat/NavicatTool.test.ts
git commit -m "feat(navicat): 左栏树导航 + 右侧上 SQL 下结果"
```

---

## Task 7: 全量校验

- [ ] **Step 1: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误。

- [ ] **Step 2: i18n 校验**

Run: `npm.cmd run check:i18n`
Expected: 无错误。

- [ ] **Step 3: 全量测试**

Run: `npm.cmd test`
Expected: server + web 全部 PASS。

- [ ] **Step 4: 提交前检查**（`docs/learn/git仓库提交检查和提交事项.md`）

```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat_|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git ls-files env
git status --short
```

Expected: 敏感扫描无命中；`git ls-files env` 为空；工作区无未跟踪的临时文件。

---

## Self-Review

**Spec coverage：**
- 左栏 aside + 新建/搜索：Task 6（`.nvside`/`.nvnewbtn`/`.nvsearch`）。
- 树按类型呈现（mysql/pg 库→表、sqlite 直接表、redis 数字库）：Task 5 模板三分支 + Task 5 测试。
- 懒加载 + 缓存 + 错误重试：Task 5 `loadDatabases`/`loadTables`/`nverr`。
- 点库设为当前库、点表生成 `SELECT *` 加引号：Task 5 `select-database`/`pick-table` + Task 6 `onPickTable`/`quoteIdent` + Task 4 `quoteIdent` 测试。
- 新建/编辑走对话框（含测试连接）：Task 6 `el-dialog` + `doTest` + 测试 1/2。
- 执行带当前库：Task 2 mount 覆盖 + Task 4 exec body + Task 6 测试 4。
- schema 端点：Task 2。
- exec 层 schema 方法：Task 1。
- i18n 9 词条：Task 3。
- 档案结构/ncx/crypto 不动：未涉及。

**Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码。

**Type consistency：** `listDatabases(id)`/`listTables(id, database)`（前端）与 `listDatabases(profile, password)`/`listTables(profile, password, database)`（后端）命名一致；`exec(id, sql, database?, confirm?)` 与测试 `s.exec('1', sql, '', true)` 一致；树事件 `select-conn`/`select-database`/`pick-table`/`edit`/`rename`/`remove` 与 `NavicatTool` 模板监听一致；选择器 `.nvconn .nvchev`/`.nvdbitem .nvchev`/`.nvdname`/`.nvtbname`/`.nvnewbtn`/`.nvconnname`/`.nvactive`/`.nv-sql`/`.nv-run`/`.nv-save`/`.nv-meta` 在组件与测试间一致；状态键 `c:`/`d:`/`t:` 与 helper 一致。

**已知风险：**
- `el-dialog` 在 happy-dom 下需 `append-to-body=false`（默认）才能被 wrapper 找到；本计划未使用 `append-to-body`，也未加 `teleport` stub（历史上 ElSelect+teleport stub 会递归，本方案已无 ElSelect）。
- `NavicatTool` 传入的 `fetchDatabases`/`listTables` 直接引用 `useNavicat` 的函数，测试通过 stub `fetch` 驱动，无需额外 mock。
