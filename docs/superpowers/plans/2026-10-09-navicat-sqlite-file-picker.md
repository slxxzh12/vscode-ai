# Navicat SQLite 本地文件选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **提交约定（本仓库 AGENTS.md）：** 未明确要求不得 commit。下列 Commit 步骤仅作为原子检查点，实际提交须等用户明确指示。

**Goal:** 让 Navicat 小工具在新建 SQLite 连接时，用系统文件对话框选择本机已存在的库文件，路径写回「数据库文件」输入框，随后照常在网页里对该 SQLite 执行操作。

**Architecture:** 复用现有 `server/native-dialog.js` 的 `runDialog`（仅 Windows，非 Windows 返回 `{error:'unsupported'}`），新增带 SQLite 过滤的 `pickSqliteFile`，经 `server/navicat-mount.js` 的 `POST /api/navicat/pick-file` 暴露；前端 `useNavicat.pickFile` → `useNavicatWorkbench.browseFile` → `NavicatTool.vue` 的「浏览…」按钮写入 `form.database`。执行 SQLite 的链路（`navicat-exec.js` 的 `sqliteRun`）本就已实现，不改。

**Tech Stack:** Node ESM（`node:test`）、Vue 3 + TS + Element Plus（vitest）、`shared/i18n` 双语词条。

---

## File Structure

- `server/native-dialog.js` — 新增导出 `pickSqliteFile`（OpenFileDialog + SQLite 过滤）。
- `server/navicat-mount.js` — 注入 `pickFile`，新增 `POST /api/navicat/pick-file` 路由。
- `server/index.js` — 装配时把 `pickSqliteFile` 注入 `createNavicatMount`。
- `server/test/native-dialog.test.js` — `pickSqliteFile` 用例。
- `server/test/navicat-http.test.js` — pick-file 路由三种返回用例。
- `web/src/tools/navicat/useNavicat.ts` — 新增 `pickFile`。
- `web/src/tools/navicat/useNavicatWorkbench.ts` — 新增 `browseFile`。
- `web/src/tools/navicat/NavicatTool.vue` — 「浏览…」按钮。
- `web/src/tools/navicat/useNavicat.test.ts` / `useNavicatWorkbench.test.ts` / `NavicatTool.test.ts` — 对应测试。
- `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — `nv.browse`、`nv.pick_failed`。

---

## Task 1: 后端原生对话框 `pickSqliteFile`

**Files:**
- Modify: `server/native-dialog.js`
- Test: `server/test/native-dialog.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/native-dialog.test.js` 顶部 import 增加 `pickSqliteFile`：

```js
import { pickFile, pickAnyFile, pickFolder, askPortConflict, pickSqliteFile } from '../native-dialog.js';
```

在文件末尾追加两个用例（复用已有的 `fakeChild` / `spawnOnce`）：

```js
test('pickSqliteFile: 非 win 返回 unsupported 且不 spawn', async () => {
  let called = false;
  const r = await pickSqliteFile({ platform: 'linux', spawnFn: () => { called = true; } });
  assert.deepEqual(r, { error: 'unsupported' });
  assert.equal(called, false);
});

test('pickSqliteFile: 脚本含 OpenFileDialog 与 sqlite 过滤，无输出视为取消', async () => {
  const child = fakeChild();
  const rec = [];
  const p = pickSqliteFile({ platform: 'win32', spawnFn: spawnOnce(child, rec) });
  child.emit('close');
  assert.deepEqual(await p, { cancelled: true });
  const script = rec[0].args[rec[0].args.length - 1];
  assert.match(script, /OpenFileDialog/);
  assert.match(script, /\*\.db/);
  assert.match(script, /\*\.sqlite/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:server -- --test-name-pattern "pickSqliteFile"`
Expected: FAIL（`pickSqliteFile is not a function` / 导入报错）

- [ ] **Step 3: 实现 `pickSqliteFile`**

在 `server/native-dialog.js` 的 `pickAnyFile` 之后新增：

```js
export function pickSqliteFile(opts) {
  return runDialog([
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    "$d.Filter = 'SQLite|*.db;*.sqlite;*.sqlite3;*.db3|All files|*.*'",
  ], '$d.FileName', opts);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test:server -- --test-name-pattern "pickSqliteFile"`
Expected: PASS（2 个用例）

- [ ] **Step 5: Commit（待用户明确要求）**

```bash
git add server/native-dialog.js server/test/native-dialog.test.js
git commit -m "feat(navicat): add pickSqliteFile native dialog"
```

---

## Task 2: 后端路由 `POST /api/navicat/pick-file`

**Files:**
- Modify: `server/navicat-mount.js`
- Modify: `server/index.js:72,614-619`
- Test: `server/test/navicat-http.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/navicat-http.test.js` 中，把 `start()` 改为可注入 `pickFile`：

```js
async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-nvhttp-'));
  const store = createNavicatStore({ file: path.join(dir, 'profiles.json'), crypto: createNavicatCrypto({ keyFile: path.join(dir, '.key') }) });
  const exec = fakeExec();
  const mount = createNavicatMount({
    store, exec, ncx: { buildNcx, connectionString },
    ...(opts.pickFile ? { pickFile: opts.pickFile } : {}),
  });
  const server = http.createServer((req, res) => mount(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, server, exec, store };
}
```

在文件末尾追加：

```js
test('pick-file：返回路径 / 取消 / 不支持', async (t) => {
  const A = await start({ pickFile: async () => ({ path: 'C:\\data\\a.db' }) });
  t.after(() => A.server.close());
  const ok = await call(A.port, 'POST', '/api/navicat/pick-file', {});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.path, 'C:\\data\\a.db');

  const B = await start({ pickFile: async () => ({ cancelled: true }) });
  t.after(() => B.server.close());
  const c = await call(B.port, 'POST', '/api/navicat/pick-file', {});
  assert.equal(c.body.cancelled, true);

  const C = await start({ pickFile: async () => ({ error: 'unsupported' }) });
  t.after(() => C.server.close());
  const e = await call(C.port, 'POST', '/api/navicat/pick-file', {});
  assert.equal(e.body.error, 'unsupported');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:server -- --test-name-pattern "pick-file"`
Expected: FAIL（`/api/navicat/pick-file` 返回 404）

- [ ] **Step 3: 实现路由与注入**

`server/navicat-mount.js` 顶部新增 import：

```js
import { pickSqliteFile } from './native-dialog.js';
```

修改签名（`server/navicat-mount.js:32`）：

```js
export function createNavicatMount({ store, exec, ncx, pickFile = pickSqliteFile, logger = console }) {
```

在 `head === 'exec'` 分支之后、末尾 404 之前插入：

```js
    if (head === 'pick-file' && m === 'POST') {
      const r = await pickFile();
      if (r.error) return sendJson(res, 200, { error: r.error, message: r.message || null });
      if (r.cancelled || !r.path) return sendJson(res, 200, { cancelled: true });
      return sendJson(res, 200, { path: r.path });
    }
```

`server/index.js:72` 改为：

```js
import { askPortConflict, pickSqliteFile } from './native-dialog.js';
```

`server/index.js:614-619` 的 `createNavicatMount` 增加一行：

```js
  const navicatMount = createNavicatMount({
    store: navicatStore,
    exec: createNavicatExec({}),
    ncx: { buildNcx, connectionString },
    pickFile: pickSqliteFile,
    logger: log,
  });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test:server -- --test-name-pattern "pick-file"`
Expected: PASS

- [ ] **Step 5: Commit（待用户明确要求）**

```bash
git add server/navicat-mount.js server/index.js server/test/navicat-http.test.js
git commit -m "feat(navicat): add /api/navicat/pick-file route"
```

---

## Task 3: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:945`
- Modify: `shared/i18n/en.js:945`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 的 `'nv.database_file'` 行之后插入：

```js
  'nv.browse': '浏览…',
  'nv.pick_failed': '当前平台不支持文件选择，请手动输入路径',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 的 `'nv.database_file'` 行之后插入：

```js
  'nv.browse': 'Browse…',
  'nv.pick_failed': 'File picker is not supported on this platform; enter the path manually',
```

- [ ] **Step 3: 校验键对称**

Run: `npm.cmd run check:i18n`
Expected: PASS（无缺键/多余键）

- [ ] **Step 4: Commit（待用户明确要求）**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(navicat): i18n for sqlite file picker"
```

---

## Task 4: 前端数据层 `useNavicat.pickFile`

**Files:**
- Modify: `web/src/tools/navicat/useNavicat.ts`
- Test: `web/src/tools/navicat/useNavicat.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/tools/navicat/useNavicat.test.ts` 的 `describe` 内追加：

```ts
  it('pickFile 打 pick-file 端点', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); return okJson({ path: 'C:\\a\\x.db' }); }));
    const s = useNavicat();
    expect(await s.pickFile()).toEqual({ path: 'C:\\a\\x.db' });
    expect(urls[0]).toBe('/api/navicat/pick-file');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run（工作目录 `web`）: `npx.cmd vitest run src/tools/navicat/useNavicat.test.ts`
Expected: FAIL（`s.pickFile is not a function`）

- [ ] **Step 3: 实现 `pickFile`**

`web/src/tools/navicat/useNavicat.ts` 的返回类型里，在 `listTables` 之后加一行：

```ts
  pickFile: () => Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }>;
```

在函数体内（`listTables` 实现之后）新增：

```ts
  async function pickFile(): Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }> {
    return jfetch('/api/navicat/pick-file', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
  }
```

在末尾 `return { ... }` 对象中把 `pickFile` 加进列表：

```ts
  return { profiles, load, save, remove, rename, test, exec, reveal, connstr, exportNcx, listDatabases, listTables, pickFile };
```

- [ ] **Step 4: 运行测试确认通过**

Run（工作目录 `web`）: `npx.cmd vitest run src/tools/navicat/useNavicat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit（待用户明确要求）**

```bash
git add web/src/tools/navicat/useNavicat.ts web/src/tools/navicat/useNavicat.test.ts
git commit -m "feat(navicat): add pickFile client call"
```

---

## Task 5: 工作台 `browseFile`

**Files:**
- Modify: `web/src/tools/navicat/useNavicatWorkbench.ts`
- Test: `web/src/tools/navicat/useNavicatWorkbench.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/tools/navicat/useNavicatWorkbench.test.ts` 的 `describe` 内追加：

```ts
  it('browseFile：选中写回 form.database', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u) === '/api/navicat/pick-file' ? okJson({ path: 'C:\\a\\x.db' }) : okJson({ items: [P] }))));
    const wb = useNavicatWorkbench();
    wb.openNew();
    wb.form.value = { ...wb.form.value, type: 'sqlite' };
    await wb.browseFile();
    expect(wb.form.value.database).toBe('C:\\a\\x.db');
  });

  it('browseFile：unsupported 置 dlgMsg', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u) === '/api/navicat/pick-file' ? okJson({ error: 'unsupported' }) : okJson({ items: [P] }))));
    const wb = useNavicatWorkbench();
    wb.dlgMsg.value = '';
    await wb.browseFile();
    expect(wb.dlgMsg.value).not.toBe('');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run（工作目录 `web`）: `npx.cmd vitest run src/tools/navicat/useNavicatWorkbench.test.ts`
Expected: FAIL（`wb.browseFile is not a function`）

- [ ] **Step 3: 实现 `browseFile`**

`web/src/tools/navicat/useNavicatWorkbench.ts` 的 `NavicatWorkbench` 接口中，`editActive(): void;` 之后加一行：

```ts
  browseFile(): Promise<void>;
```

在 `editActive` 实现之后新增：

```ts
  async function browseFile() {
    dlgMsg.value = '';
    try {
      const r = await nav.pickFile();
      if (r.path) { form.value = { ...form.value, database: r.path }; return; }
      if (r.error) dlgMsg.value = t('nv.pick_failed');
    } catch (e) { dlgMsg.value = (e as Error).message; }
  }
```

在末尾 `cache = { ... }` 的返回对象中，`editActive` 之后加 `browseFile`：

```ts
    load: nav.load, onFolder, onTypeChange, pickTable, openNew, openEdit, doSave, doTest, onRemove, doExec, copyConn, doExport, editActive, browseFile,
```

- [ ] **Step 4: 运行测试确认通过**

Run（工作目录 `web`）: `npx.cmd vitest run src/tools/navicat/useNavicatWorkbench.test.ts`
Expected: PASS

- [ ] **Step 5: Commit（待用户明确要求）**

```bash
git add web/src/tools/navicat/useNavicatWorkbench.ts web/src/tools/navicat/useNavicatWorkbench.test.ts
git commit -m "feat(navicat): workbench browseFile"
```

---

## Task 6: UI「浏览…」按钮

**Files:**
- Modify: `web/src/tools/navicat/NavicatTool.vue`
- Test: `web/src/tools/navicat/NavicatTool.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/tools/navicat/NavicatTool.test.ts` 的 `describe` 内追加：

```ts
  it('SQLite 连接对话框：浏览按钮写回文件路径', async () => {
    vi.stubGlobal('fetch', stubFetch((u) => (u === '/api/navicat/pick-file' ? okJson({ path: 'C:\\data\\x.db' }) : okJson({}))));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.openNew();
    wb.form.value = { ...wb.form.value, type: 'sqlite' };
    const w = mount();
    await flushPromises();
    await w.find('.nv-browse').trigger('click');
    await flushPromises();
    expect((w.find('.nv-db-file input').element as HTMLInputElement).value).toBe('C:\\data\\x.db');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run（工作目录 `web`）: `npx.cmd vitest run src/tools/navicat/NavicatTool.test.ts`
Expected: FAIL（找不到 `.nv-browse`）

- [ ] **Step 3: 实现按钮**

`web/src/tools/navicat/NavicatTool.vue` 的 `<script setup>` 中，解构增加 `browseFile`：

```js
const {
  activeProfile, activeDatabase, sql, result, busy, msg,
  dlg, dlgTab, dlgMsg, form, saving, testing,
  load, doSave, doTest, doExec, copyConn, doExport, editActive, onTypeChange, browseFile,
} = useNavicatWorkbench();
```

模板中 SQLite 分支改为（`el-input` 后加按钮）：

```html
            <template v-if="isSqlite">
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.database_file') }}</span>
                <el-input v-model="form.database" size="small" class="nv-db-file" />
                <button type="button" class="nvbtn nv-browse" @click="browseFile">{{ $t('nv.browse') }}</button>
              </label>
            </template>
```

`<style scoped>` 末尾追加（让按钮不被输入框拉伸）：

```css
.nv-browse { flex: none; white-space: nowrap; }
```

- [ ] **Step 4: 运行测试确认通过**

Run（工作目录 `web`）: `npx.cmd vitest run src/tools/navicat/NavicatTool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit（待用户明确要求）**

```bash
git add web/src/tools/navicat/NavicatTool.vue web/src/tools/navicat/NavicatTool.test.ts
git commit -m "feat(navicat): sqlite browse button"
```

---

## Task 7: 全量验证

- [ ] **Step 1: 跑全部测试**

Run: `npm.cmd test`
Expected: PASS（server + web）

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（无 TS 错误）

- [ ] **Step 3: i18n 校验**

Run: `npm.cmd run check:i18n`
Expected: PASS

- [ ] **Step 4: 敏感信息自查（提交前）**

Run: `git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat_|-----BEGIN [A-Z ]*PRIVATE KEY-----"`
Expected: 无命中

---

## 手动验收（Windows）

- [ ] `npm.cmd run dev:server` + `npm.cmd run dev:web`，打开 http://localhost:5173，进入 Navicat 工具。
- [ ] 新建连接 → 类型选 `sqlite` → 点「浏览…」弹出系统对话框 → 选中一个已存在的 `.db` → 路径写入「数据库文件」。
- [ ] 填连接名 → 确定保存 → 左栏出现该连接 → 展开能看到表 → 点表生成 `SELECT` → 执行，结果表正常渲染。
- [ ] 非 Windows 环境：点「浏览…」提示「当前平台不支持文件选择，请手动输入路径」，手动输入路径仍可保存并执行。
