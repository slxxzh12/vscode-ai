# 定时任务清单 `void_manifest.json`（导出/导入）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个定时任务在其目录下自动维护 `void_manifest.json`（相对路径），并在定时任务页签提供「导入」按钮，选定目录后递归扫描清单重建任务。

**Architecture:** 新增纯模块 `server/scheduler/manifest.js`（任务↔清单转换、读写、递归扫描）；`SchedulerStore` 在增删改时同步清单并负责导入；`http-mount.js` 暴露 `pick-folder`、`import` 端点；前端 `SchedulerView.vue` 加导入弹窗。

**Tech Stack:** Node ESM、`node:test`、Vue 3 + TS + vitest、现有 i18n（`shared/i18n`）。

**Spec:** `docs/superpowers/specs/2026-09-20-scheduler-void-manifest-design.md`

**测试命令约定（Windows / PowerShell 5.1，无 bash）：**
- 单个后端测试：`node --test server/test/<file>.test.js`
- 全部后端：`npm.cmd test:server`
- 前端单文件：`npx vitest run web/src/scheduler/useScheduler.test.ts`（或 `npm.cmd test` 全量）
- 类型：`npm.cmd run typecheck`；i18n：`npm.cmd run check:i18n`

---

### Task 1: 纯模块 `manifest.js`

**Files:**
- Create: `server/scheduler/manifest.js`
- Test: `server/test/scheduler-manifest.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-manifest.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MANIFEST_NAME, toRel, toAbs, manifestDirOf, toManifest, fromManifest,
  writeManifest, removeManifest, scanManifests,
} from '../scheduler/manifest.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-manifest-')); }

test('toRel/toAbs 在目录内往返', () => {
  const base = tmpDir();
  const abs = path.join(base, 'scripts', 'build.ps1');
  assert.equal(toRel(abs, base), 'scripts/build.ps1');
  assert.equal(toAbs('scripts/build.ps1', base), abs);
});

test('toRel 对相对路径统一为正斜杠；toAbs 对绝对路径原样返回', () => {
  assert.equal(toRel('a\\b\\c.ps1', '/x'), 'a/b/c.ps1');
  const abs = path.join(tmpDir(), 'f.txt');
  assert.equal(toAbs(abs, '/other'), abs);
});

test('manifestDirOf：有 cwd 用 cwd，无 cwd 落到 manifestRoot/<id>', () => {
  const root = tmpDir();
  const cwd = tmpDir();
  assert.equal(manifestDirOf({ id: 't1', cwd }, root), path.resolve(cwd));
  assert.equal(manifestDirOf({ id: 't1', cwd: null }, root), path.join(root, 't1'));
});

test('toManifest/fromManifest 往返（script + runtime）', () => {
  const dir = tmpDir();
  const task = {
    id: 't1', name: 'build', enabled: false, type: 'script', cwd: dir,
    script: { path: path.join(dir, 'scripts', 'build.ps1') },
    schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  };
  const m = toManifest(task, dir, { nextRunAt: 123, lastRun: { startedAt: 1, status: 'success', exitCode: 0, durationMs: 5 } });
  assert.equal(m.format, 'void_manifest');
  assert.equal(m.version, 1);
  assert.equal(m.script.path, 'scripts/build.ps1');
  assert.equal(m.runtime.nextRunAt, 123);
  assert.equal(m.runtime.lastRun.status, 'success');
  assert.equal('id' in m, false);
  assert.equal('cwd' in m, false);

  const back = fromManifest(m, dir);
  assert.equal(back.cwd, dir);
  assert.equal(back.script.path, path.join(dir, 'scripts', 'build.ps1'));
  assert.equal(back.enabled, false);
});

test('toManifest ai file 源转相对、fromManifest 转回绝对', () => {
  const dir = tmpDir();
  const task = {
    id: 't2', name: 'a', enabled: true, type: 'ai', cwd: dir,
    ai: { source: 'file', prompt: 'go' }, filePath: path.join(dir, 'commands', 'x.md'),
    schedule: { mode: 'daily', daily: { at: '09:00', weekdays: [] } },
  };
  const m = toManifest(task, dir);
  assert.equal(m.filePath, 'commands/x.md');
  const back = fromManifest(m, dir);
  assert.equal(back.filePath, path.join(dir, 'commands', 'x.md'));
  assert.deepEqual(back.ai, { source: 'file', prompt: 'go' });
});

test('fromManifest 校验 format/version', () => {
  const dir = tmpDir();
  assert.throws(() => fromManifest({ format: 'x', version: 1 }, dir), (e) => e.code === 'bad-format');
  assert.throws(() => fromManifest({ format: 'void_manifest', version: 99 }, dir), (e) => e.code === 'bad-version');
  assert.throws(() => fromManifest(null, dir), (e) => e.code === 'bad-manifest');
});

test('scanManifests 递归查找并跳过忽略目录', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a', 'b', MANIFEST_NAME), '{}');
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', MANIFEST_NAME), '{}');
  const found = scanManifests(root);
  assert.equal(found.length, 1);
  assert.equal(found[0], path.join(root, 'a', 'b', MANIFEST_NAME));
});

test('writeManifest / removeManifest', () => {
  const dir = tmpDir();
  const task = {
    id: 't3', name: 'n', enabled: true, type: 'shell', command: 'echo', cwd: dir,
    schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } },
  };
  writeManifest(dir, task, { nextRunAt: 9, lastRun: null });
  const file = path.join(dir, MANIFEST_NAME);
  assert.ok(fs.existsSync(file));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).runtime.nextRunAt, 9);
  removeManifest(dir);
  assert.equal(fs.existsSync(file), false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/scheduler-manifest.test.js`
Expected: FAIL — `Cannot find module '../scheduler/manifest.js'`

- [ ] **Step 3: 实现 `server/scheduler/manifest.js`**

```js
import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_NAME = 'void_manifest.json';
export const MANIFEST_FORMAT = 'void_manifest';
export const MANIFEST_VERSION = 1;
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-portable', '.venv', 'venv']);

function manifestError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

export function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// 绝对路径 → 相对 baseDir 的正斜杠路径；无法相对化（跨盘符/空）则保留原绝对路径
export function toRel(p, baseDir) {
  if (!p || typeof p !== 'string') return null;
  if (!path.isAbsolute(p)) return p.split(path.sep).join('/');
  const rel = path.relative(baseDir, p);
  if (!rel || path.isAbsolute(rel)) return p;
  return rel.split(path.sep).join('/');
}

// 相对路径 → 相对 baseDir 的绝对路径；已是绝对则原样返回
export function toAbs(p, baseDir) {
  if (!p || typeof p !== 'string') return null;
  return path.isAbsolute(p) ? p : path.resolve(baseDir, p);
}

// 任务所属目录：显式 cwd 优先，否则落到调度器 manifests/<id>
export function manifestDirOf(task, manifestRoot) {
  if (!task) return null;
  return task.cwd ? path.resolve(task.cwd) : path.join(manifestRoot, task.id);
}

function pickRuntime(runtime) {
  if (!runtime) return { nextRunAt: null, lastRun: null };
  const lr = runtime.lastRun || null;
  return {
    nextRunAt: runtime.nextRunAt ?? null,
    lastRun: lr ? {
      startedAt: lr.startedAt ?? null,
      status: lr.status ?? null,
      exitCode: lr.exitCode ?? null,
      durationMs: lr.durationMs ?? null,
    } : null,
  };
}

export function toManifest(task, dir, runtime = null) {
  const m = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    name: task.name,
    type: task.type,
    enabled: task.enabled !== false,
    schedule: task.schedule,
  };
  if (task.type === 'shell') m.command = task.command;
  if (task.type === 'ai') {
    m.ai = { ...(task.ai || {}) };
    if (task.filePath) m.filePath = toRel(task.filePath, dir);
  }
  if (task.type === 'script') m.script = { path: toRel(task.script && task.script.path, dir) };
  m.runtime = pickRuntime(runtime);
  return m;
}

export function fromManifest(obj, dir) {
  if (!obj || typeof obj !== 'object') throw manifestError('bad-manifest');
  if (obj.format !== MANIFEST_FORMAT) throw manifestError('bad-format');
  if (Number(obj.version) !== MANIFEST_VERSION) throw manifestError('bad-version');
  const task = {
    name: String(obj.name || '').trim(),
    enabled: obj.enabled !== false,
    type: obj.type,
    schedule: obj.schedule,
    cwd: dir,
  };
  if (obj.type === 'shell') task.command = obj.command;
  if (obj.type === 'ai') {
    task.ai = { ...(obj.ai || {}) };
    if (obj.filePath) task.filePath = toAbs(obj.filePath, dir);
  }
  if (obj.type === 'script') task.script = { path: toAbs(obj.script && obj.script.path, dir) };
  return task;
}

export function writeManifest(dir, task, runtime = null) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, MANIFEST_NAME);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(toManifest(task, dir, runtime), null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function removeManifest(dir) {
  try { fs.rmSync(path.join(dir, MANIFEST_NAME), { force: true }); } catch { /* ignore */ }
}

export function scanManifests(root, { skipDirs = SKIP_DIRS } = {}) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.isFile() && e.name === MANIFEST_NAME) {
        found.push(path.join(dir, e.name));
      }
    }
  };
  walk(path.resolve(root));
  return found;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/scheduler-manifest.test.js`
Expected: PASS（7 tests）

- [ ] **Step 5: 提交**

```powershell
git add server/scheduler/manifest.js server/test/scheduler-manifest.test.js
git commit -m "feat(scheduler): void_manifest 纯模块（转换/读写/扫描）"
```

---

### Task 2: `SchedulerStore` 同步清单 + 目录规则

**Files:**
- Modify: `server/scheduler/store.js`
- Test: `server/test/scheduler-store.test.js`（追加）

- [ ] **Step 1: 追加失败测试**

在 `server/test/scheduler-store.test.js` 顶部 import 增补（改为）：

```js
import { SchedulerStore, validateTask } from '../scheduler/store.js';
```

在文件末尾追加：

```js
test('createTask/updateTask/deleteTask 同步 void_manifest.json', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const cwd = tmpDir();
  const { task } = store.createTask(shellTask({ cwd }));
  const mf = path.join(cwd, 'void_manifest.json');
  assert.ok(fs.existsSync(mf));
  assert.equal(JSON.parse(fs.readFileSync(mf, 'utf8')).command, 'echo hi');

  store.updateTask(task.id, { name: 'b' });
  assert.equal(JSON.parse(fs.readFileSync(mf, 'utf8')).name, 'b');

  store.deleteTask(task.id);
  assert.equal(fs.existsSync(mf), false);
});

test('无 cwd 的任务清单落到 manifests/<id>，删除时整目录清掉', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask(shellTask());
  const mf = path.join(dir, 'manifests', task.id, 'void_manifest.json');
  assert.ok(fs.existsSync(mf));
  store.deleteTask(task.id);
  assert.equal(fs.existsSync(path.dirname(mf)), false);
});

test('cwd 不存在返回 cwd-missing 且不落库', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const r = store.createTask(shellTask({ cwd: path.join(os.tmpdir(), 'nope-' + Date.now()) }));
  assert.equal(r.error, 'cwd-missing');
  assert.equal(store.listTasks().length, 0);
});

test('同目录第二个任务返回 dir-taken', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const cwd = tmpDir();
  assert.ok(store.createTask(shellTask({ cwd })).task);
  assert.equal(store.createTask(shellTask({ cwd, name: 'b' })).error, 'dir-taken');
});

test('改 cwd 时旧目录清单删除、新目录写入', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const a = tmpDir();
  const b = tmpDir();
  const { task } = store.createTask(shellTask({ cwd: a }));
  store.updateTask(task.id, { cwd: b });
  assert.equal(fs.existsSync(path.join(a, 'void_manifest.json')), false);
  assert.ok(fs.existsSync(path.join(b, 'void_manifest.json')));
});

test('syncManifest 写入 runtime（nextRunAt / lastRun）', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const cwd = tmpDir();
  store.setRuntimeProvider((id) => ({ nextRunAt: 555, lastRun: store.listRuns({ taskId: id, limit: 1 })[0] || null }));
  const { task } = store.createTask(shellTask({ cwd }));
  store.addRun({ id: 'r1', taskId: task.id, status: 'success', startedAt: 1, exitCode: 0, durationMs: 2, logFile: 'x' });
  store.syncManifest(task.id);
  const m = JSON.parse(fs.readFileSync(path.join(cwd, 'void_manifest.json'), 'utf8'));
  assert.equal(m.runtime.nextRunAt, 555);
  assert.equal(m.runtime.lastRun.status, 'success');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/scheduler-store.test.js`
Expected: FAIL — 清单文件不存在 / `cwd-missing` 未实现（`createTask` 返回 `{task}` 而非 error）

- [ ] **Step 3: 改 `server/scheduler/store.js`**

顶部 import 追加：

```js
import { manifestDirOf, writeManifest, removeManifest, scanManifests, fromManifest, isDir } from './manifest.js';
```

构造函数替换为（新增 `manifestRoot` / `runtimeProvider`）：

```js
  constructor({ dir, logger = console, runLimit = DEFAULT_RUN_LIMIT, manifestRoot = path.join(dir, 'manifests') }) {
    this.dir = dir;
    this.log = logger;
    this.runLimit = runLimit;
    this.manifestRoot = manifestRoot;
    this.runtimeProvider = null;
    this.tasksFile = path.join(dir, 'tasks.json');
    this.runsFile = path.join(dir, 'runs.json');
    this.logsDir = path.join(dir, 'logs');
    const tasks = readJson(this.tasksFile, []);
    const runs = readJson(this.runsFile, []);
    this.tasks = Array.isArray(tasks) ? tasks : [];
    this.runs = Array.isArray(runs) ? runs : [];
  }
  setRuntimeProvider(fn) { this.runtimeProvider = fn; }
```

在 `saveTasks()` 之后插入内部辅助方法：

```js
  _key(p) {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  }
  _dirOf(task) { return path.resolve(manifestDirOf(task, this.manifestRoot)); }
  _sameDir(a, b) { return this._key(this._dirOf(a)) === this._key(this._dirOf(b)); }
  _dirConflict(task) {
    return this.tasks.some((t) => t.id !== task.id && this._key(this._dirOf(t)) === this._key(this._dirOf(task)));
  }
  _cwdMissing(task) { return !!(task.cwd && !isDir(task.cwd)); }
  _buildTask(input, base = {}) {
    const now = Date.now();
    return {
      id: base.id || 't_' + crypto.randomBytes(4).toString('hex'),
      name: String(input.name).trim(),
      enabled: input.enabled !== false,
      projectId: input.projectId || null,
      cwd: input.cwd || null,
      filePath: toAbs(input.filePath, input.cwd),
      type: input.type,
      command: input.type === 'shell' ? input.command : undefined,
      ai: input.type === 'ai' ? { ...input.ai } : undefined,
      script: input.type === 'script' ? { ...input.script, path: toAbs(input.script.path, input.cwd) } : undefined,
      schedule: { ...input.schedule },
      createdAt: base.createdAt || now,
      updatedAt: now,
    };
  }
  _syncManifest(task) {
    try {
      const runtime = this.runtimeProvider ? this.runtimeProvider(task.id) : null;
      writeManifest(this._dirOf(task), task, runtime);
    } catch (e) { this.log?.error?.('scheduler manifest write failed', e); }
  }
  _removeManifest(task) {
    const dir = this._dirOf(task);
    removeManifest(dir);
    if (!task.cwd) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
  }
  syncManifest(id) { const t = this.getTask(id); if (t) this._syncManifest(t); }
```

`createTask` 替换为：

```js
  createTask(input) {
    const v = validateTask(input);
    if (v.error) return { error: v.error };
    const task = this._buildTask(input);
    if (this._cwdMissing(task)) return { error: 'cwd-missing' };
    if (this._dirConflict(task)) return { error: 'dir-taken' };
    this.tasks.push(task);
    this.saveTasks();
    this._syncManifest(task);
    return { task: { ...task } };
  }
```

`updateTask` 替换为：

```js
  updateTask(id, patch) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'not-found' };
    const prev = this.tasks[i];
    const merged = { ...prev, ...patch, id, createdAt: prev.createdAt, updatedAt: Date.now() };
    merged.filePath = toAbs(merged.filePath, merged.cwd);
    if (merged.type === 'script' && merged.script) merged.script = { ...merged.script, path: toAbs(merged.script.path, merged.cwd) };
    const v = validateTask(merged);
    if (v.error) return { error: v.error };
    if (this._cwdMissing(merged)) return { error: 'cwd-missing' };
    if (this._dirConflict(merged)) return { error: 'dir-taken' };
    const moved = !this._sameDir(prev, merged);
    this.tasks[i] = merged;
    this.saveTasks();
    if (moved) this._removeManifest(prev);
    this._syncManifest(merged);
    return { task: { ...merged } };
  }
```

新增 `replaceTask`（导入覆盖用，保持 id/createdAt）：

```js
  replaceTask(id, input) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'not-found' };
    const v = validateTask(input);
    if (v.error) return { error: v.error };
    const prev = this.tasks[i];
    const task = this._buildTask(input, { id, createdAt: prev.createdAt });
    if (this._cwdMissing(task)) return { error: 'cwd-missing' };
    const moved = !this._sameDir(prev, task);
    this.tasks[i] = task;
    this.saveTasks();
    if (moved) this._removeManifest(prev);
    this._syncManifest(task);
    return { task: { ...task } };
  }
```

`deleteTask` 改为：

```js
  deleteTask(id) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'not-found' };
    const [task] = this.tasks.splice(i, 1);
    this.saveTasks();
    this._removeManifest(task);
    const removed = this.runs.filter((r) => r.taskId === id);
    this.runs = this.runs.filter((r) => r.taskId !== id);
    this.saveRuns();
    for (const r of removed) { try { fs.rmSync(this.logPath(r.logFile), { force: true }); } catch { /* ignore */ } }
    try { fs.rmSync(path.join(this.logsDir, id), { recursive: true, force: true }); } catch { /* ignore */ }
    return { ok: true };
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/scheduler-store.test.js`
Expected: PASS（原 7 + 新 6 = 13 tests）

- [ ] **Step 5: 提交**

```powershell
git add server/scheduler/store.js server/test/scheduler-store.test.js
git commit -m "feat(scheduler): 任务增删改同步 void_manifest，一目录一任务校验"
```

---

### Task 3: `SchedulerStore.importManifestDir`

**Files:**
- Modify: `server/scheduler/store.js`
- Test: `server/test/scheduler-import.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-import.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SchedulerStore } from '../scheduler/store.js';
import { MANIFEST_NAME } from '../scheduler/manifest.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-import-')); }
function manifest(over = {}) {
  return {
    format: 'void_manifest', version: 1, name: 'x', type: 'shell', enabled: true,
    command: 'echo hi', schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
    ...over,
  };
}
function writeAt(dir, obj) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, MANIFEST_NAME), JSON.stringify(obj)); }

test('importManifestDir 新建任务，cwd = 清单所在目录', () => {
  const root = tmpDir();
  const proj = path.join(root, 'proj');
  writeAt(proj, manifest());
  const store = new SchedulerStore({ dir: tmpDir() });
  const s = store.importManifestDir(root);
  assert.equal(s.imported, 1);
  assert.equal(s.overwritten, 0);
  assert.equal(store.listTasks()[0].cwd, proj);
});

test('importManifestDir 再次导入覆盖（沿用 id）', () => {
  const root = tmpDir();
  const proj = path.join(root, 'proj');
  writeAt(proj, manifest());
  const store = new SchedulerStore({ dir: tmpDir() });
  store.importManifestDir(root);
  const firstId = store.listTasks()[0].id;
  writeAt(proj, manifest({ name: 'x2' }));
  const s = store.importManifestDir(root);
  assert.equal(s.overwritten, 1);
  assert.equal(store.listTasks().length, 1);
  assert.equal(store.listTasks()[0].id, firstId);
  assert.equal(store.listTasks()[0].name, 'x2');
});

test('importManifestDir 单条失败不中断', () => {
  const root = tmpDir();
  writeAt(path.join(root, 'bad'), { oops: true });
  writeAt(path.join(root, 'good'), manifest({ name: 'g' }));
  const store = new SchedulerStore({ dir: tmpDir() });
  const s = store.importManifestDir(root);
  assert.equal(s.imported, 1);
  assert.equal(s.failed.length, 1);
  assert.equal(s.failed[0].error, 'bad-format');
});

test('importManifestDir 覆盖时旧类型字段不残留', () => {
  const root = tmpDir();
  const proj = path.join(root, 'proj');
  writeAt(proj, manifest());                       // shell
  const store = new SchedulerStore({ dir: tmpDir() });
  store.importManifestDir(root);
  fs.writeFileSync(path.join(proj, 'run.ps1'), 'x');
  writeAt(proj, manifest({ type: 'script', command: undefined, script: { path: 'run.ps1' } }));
  store.importManifestDir(root);
  const t = store.listTasks()[0];
  assert.equal(t.type, 'script');
  assert.equal(t.command, undefined);
  assert.equal(t.script.path, path.join(proj, 'run.ps1'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/scheduler-import.test.js`
Expected: FAIL — `store.importManifestDir is not a function`

- [ ] **Step 3: 在 `store.js` 加 `importManifestDir`**

在 `syncManifest(id)` 之后插入：

```js
  importManifestDir(root) {
    const summary = { imported: 0, overwritten: 0, failed: [] };
    for (const file of scanManifests(root)) {
      const dir = path.dirname(file);
      let input;
      try {
        input = fromManifest(JSON.parse(fs.readFileSync(file, 'utf8')), dir);
      } catch (e) {
        summary.failed.push({ path: file, error: String(e && e.code || e && e.message || e) });
        continue;
      }
      const existing = this.tasks.find((t) => this._key(this._dirOf(t)) === this._key(dir));
      const r = existing ? this.replaceTask(existing.id, input) : this.createTask(input);
      if (r.error) { summary.failed.push({ path: file, error: r.error }); continue; }
      if (existing) summary.overwritten += 1; else summary.imported += 1;
    }
    return summary;
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/scheduler-import.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```powershell
git add server/scheduler/store.js server/test/scheduler-import.test.js
git commit -m "feat(scheduler): importManifestDir 扫描导入并覆盖已有任务"
```

---

### Task 4: HTTP 端点 `pick-folder` / `import`

**Files:**
- Modify: `server/scheduler/http-mount.js`
- Test: `server/test/scheduler-http.test.js`（追加）

- [ ] **Step 1: 追加失败测试**

在 `server/test/scheduler-http.test.js` 顶部，把

```js
import { createSchedulerMount } from '../scheduler/http-mount.js';
```

下面的 `setup` 函数替换为（支持注入 `pickFolder`）：

```js
function setup(runner = fakeRunner(), pickFolder = undefined) {
  const store = new SchedulerStore({ dir: tmpDir() });
  const engine = createEngine({ store, runner, now: () => 1000 });
  const mount = createSchedulerMount({ engine, store, pickFolder });
  return { store, engine, runner, mount };
}
```

文件末尾追加：

```js
test('POST /pick-folder 返回所选目录', async () => {
  const { mount } = setup(fakeRunner(), async () => ({ path: 'C:/some/dir' }));
  const res = await call(mount, 'POST', '/api/scheduler/pick-folder');
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).path, 'C:/some/dir');
});

test('POST /pick-folder 取消与不支持', async () => {
  const cancelled = setup(fakeRunner(), async () => ({ cancelled: true }));
  assert.equal(JSON.parse((await call(cancelled.mount, 'POST', '/api/scheduler/pick-folder')).body).cancelled, true);
  const unsupported = setup(fakeRunner(), async () => ({ error: 'unsupported' }));
  assert.equal(JSON.parse((await call(unsupported.mount, 'POST', '/api/scheduler/pick-folder')).body).error, 'unsupported');
});

test('POST /import 扫描目录导入并汇总', async () => {
  const { mount, store } = setup();
  const root = tmpDir();
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'void_manifest.json'), JSON.stringify({
    format: 'void_manifest', version: 1, name: 'i', type: 'shell', enabled: true,
    command: 'echo', schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  }));
  const res = await call(mount, 'POST', '/api/scheduler/import', { dir: root });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).imported, 1);
  assert.equal(store.listTasks().length, 1);
});

test('POST /import 非法目录返回 400', async () => {
  const { mount } = setup();
  assert.equal((await call(mount, 'POST', '/api/scheduler/import', { dir: '' })).status, 400);
  assert.equal((await call(mount, 'POST', '/api/scheduler/import', { dir: path.join(tmpDir(), 'nope') })).status, 400);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/scheduler-http.test.js`
Expected: FAIL — `/pick-folder` 404、`/import` 404

- [ ] **Step 3: 改 `server/scheduler/http-mount.js`**

顶部 import 与签名：

```js
import fs from 'node:fs';
import { listAiCommands } from './ai-commands.js';
import { pickFile, pickFolder as defaultPickFolder } from '../native-dialog.js';

const LOG_TAIL_MAX = 256 * 1024;

export function createSchedulerMount({ engine, store, logger = console, pickFolder = defaultPickFolder }) {
```

在 `pick-file` 分支之后、`return sendJson(res, 404, ...)` 之前插入：

```js
      if (p === '/api/scheduler/pick-folder' && req.method === 'POST') {
        const r = await pickFolder();
        if (r.error) return sendJson(res, 200, { error: r.error, message: r.message || null });
        if (r.cancelled || !r.path) return sendJson(res, 200, { cancelled: true });
        return sendJson(res, 200, { path: r.path });
      }
      if (p === '/api/scheduler/import' && req.method === 'POST') {
        const body = await readBody(req);
        const dir = body && typeof body.dir === 'string' ? body.dir.trim() : '';
        if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          return sendJson(res, 400, { error: 'bad-dir' });
        }
        const summary = store.importManifestDir(dir);
        engine.refreshAll();
        for (const t of store.listTasks()) store.syncManifest(t.id);
        engine.notifyTasksChanged();
        return sendJson(res, 200, summary);
```

同时在 POST 创建、PUT 更新的分支里，把 `engine.reschedule(r.task);` 之后补一行清单刷新：

```js
          engine.reschedule(r.task);
          store.syncManifest(r.task.id);
          engine.notifyTasksChanged();
```

（POST 分支同样改。）

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/scheduler-http.test.js`
Expected: PASS（原 5 + 新 4 = 9 tests）

- [ ] **Step 5: 提交**

```powershell
git add server/scheduler/http-mount.js server/test/scheduler-http.test.js
git commit -m "feat(scheduler): pick-folder 与 import HTTP 端点"
```

---

### Task 5: 服务端装配（runtimeProvider + run-end 刷新）

**Files:**
- Modify: `server/index.js:387-398`
- Modify: `server/scheduler/index.js`（透传 `manifestRoot`）

- [ ] **Step 1: 改 `server/scheduler/index.js`**

把 `createScheduler` 签名与 store 构造改为：

```js
export function createScheduler({ dir, projectResolver = () => null, logger = console, runner = null, agentCmd = 'opencode', opencodeDataDir = null, manifestRoot = null }) {
  const store = new SchedulerStore({ dir, logger, ...(manifestRoot ? { manifestRoot } : {}) });
  const engine = createEngine({ store, runner: runner || createRunner(), logger, aiBin: agentCmd, opencodeDataDir });
  engine.setProjectResolver(projectResolver);
  engine.setAiPromptLoader((name) => readAiCommand(name));
  const mount = createSchedulerMount({ engine, store, logger });
  return { store, engine, mount };
}
```

- [ ] **Step 2: 改 `server/index.js`**

把 `const scheduler = createScheduler({...})` 与其后的 `onEvent`（约 387-398 行）替换为：

```js
  const scheduler = createScheduler({
    dir: paths.schedulerDir,
    manifestRoot: path.join(paths.schedulerDir, 'manifests'),
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    logger: log,
    opencodeDataDir: path.join(paths.dir, 'opencode-data'),
  });
  scheduler.store.setRuntimeProvider((id) => ({
    nextRunAt: scheduler.engine.nextRunAtOf(id),
    lastRun: scheduler.store.listRuns({ taskId: id, limit: 1 })[0] || null,
  }));
  scheduler.engine.onEvent((evt, payload) => {
    if (evt === 'run-end' && payload && payload.run && payload.run.taskId) {
      try { scheduler.store.syncManifest(payload.run.taskId); } catch { /* 清单刷新失败不影响运行 */ }
    }
    const type = evt === 'run-start' ? SchedulerS2C.SCHED_RUN_START
      : evt === 'run-end' ? SchedulerS2C.SCHED_RUN_END
      : SchedulerS2C.SCHED_TASKS_CHANGED;
    broadcastSched(type, payload);
  });
```

- [ ] **Step 3: 跑后端全量测试**

Run: `npm.cmd test:server`
Expected: PASS（含前 4 个任务新增用例；装配不引入回归）

- [ ] **Step 4: 提交**

```powershell
git add server/index.js server/scheduler/index.js
git commit -m "feat(scheduler): 装配 manifestRoot 与运行结束清单刷新"
```

---

### Task 6: 前端导入弹窗 + i18n

**Files:**
- Modify: `web/src/scheduler/useScheduler.ts`
- Modify: `web/src/scheduler/SchedulerView.vue`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- Test: `web/src/scheduler/useScheduler.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

在 `web/src/scheduler/useScheduler.test.ts` 的 `loadRuns/loadLog/pickFile` 测试之后追加：

```ts
  it('pickFolder/importManifests 走对应路由并刷新', async () => {
    const s = useScheduler();
    await s.pickFolder();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/scheduler/pick-folder')).toBe(true);
    const r = await s.importManifests('C:/x');
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/scheduler/import')).toBe(true);
    expect(r).toBeTruthy();
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run web/src/scheduler/useScheduler.test.ts`
Expected: FAIL — `s.pickFolder is not a function`

- [ ] **Step 3: 改 `web/src/scheduler/useScheduler.ts`**

在 `pickFile()` 之后插入：

```ts
  function pickFolder(): Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }> {
    return api('POST', '/api/scheduler/pick-folder');
  }
  async function importManifests(dir: string): Promise<{ imported: number; overwritten: number; failed: { path: string; error: string }[] }> {
    const d = await api('POST', '/api/scheduler/import', { dir });
    await refresh();
    return d;
  }
```

把返回值改为：

```ts
  return { state, refresh, createTask, updateTask, removeTask, runNow, stopTask, loadRuns, loadLog, loadAiCommands, pickFile, pickFolder, importManifests, dispose: () => unsubs.forEach((u) => u()) };
```

- [ ] **Step 4: 改 i18n 词条**

`shared/i18n/zh-CN.js`：在 `'sched.unsupported_file': ...` 之后插入：

```js
  'sched.import': '导入',
  'sched.import.title': '导入任务清单',
  'sched.import.dir': '目录',
  'sched.import.dir_placeholder': '选择或填写包含 void_manifest.json 的目录',
  'sched.import.browse': '浏览…',
  'sched.import.run': '开始导入',
  'sched.import.unsupported': '当前系统不支持文件夹选择，请手动填写目录',
  'sched.import.pick_failed': '选择目录失败：{msg}',
  'sched.import.bad_dir': '目录不存在或不可用',
  'sched.import.result': '导入完成：新增 {imported}，覆盖 {overwritten}，失败 {failed}',
```

`shared/i18n/en.js`：同位置插入对应英文：

```js
  'sched.import': 'Import',
  'sched.import.title': 'Import task manifests',
  'sched.import.dir': 'Directory',
  'sched.import.dir_placeholder': 'Choose or type a directory containing void_manifest.json',
  'sched.import.browse': 'Browse…',
  'sched.import.run': 'Import',
  'sched.import.unsupported': 'Folder picker unsupported on this system; type the directory manually',
  'sched.import.pick_failed': 'Failed to choose folder: {msg}',
  'sched.import.bad_dir': 'Directory does not exist or is unavailable',
  'sched.import.result': 'Import done: added {imported}, overwritten {overwritten}, failed {failed}',
```

- [ ] **Step 5: 改 `web/src/scheduler/SchedulerView.vue`**

`<script setup>` 里 `pickCommandFile` 之后插入：

```ts
const showImport = ref(false);
const importDir = ref('');
const importMsg = ref('');
async function browseImportDir() {
  state.error = '';
  try {
    const r = await sched.pickFolder();
    if (r.error) { state.error = r.error === 'unsupported' ? t('sched.import.unsupported') : t('sched.import.pick_failed', { msg: r.message || r.error }); return; }
    if (r.cancelled || !r.path) return;
    importDir.value = r.path;
  } catch (e: any) { state.error = String(e?.message || e); }
}
async function doImport() {
  state.error = '';
  importMsg.value = '';
  const dir = importDir.value.trim();
  if (!dir) { state.error = t('sched.import.bad_dir'); return; }
  try {
    const r = await sched.importManifests(dir);
    importMsg.value = t('sched.import.result', { imported: r.imported || 0, overwritten: r.overwritten || 0, failed: (r.failed || []).length });
    showImport.value = false;
  } catch (e: any) { state.error = String(e?.message || e); }
}
```

顶栏 `新建` 按钮之后加：

```html
      <button @click="showImport = true">{{ $t('sched.import') }}</button>
```

在运行历史弹层之前的模板末尾（`</div>` 之前）插入导入弹窗：

```html
    <div v-if="showImport" class="overlay" @click.self="showImport = false">
      <div class="modal">
        <h3>{{ $t('sched.import.title') }}</h3>
        <label>{{ $t('sched.import.dir') }}
          <input v-model="importDir" :placeholder="$t('sched.import.dir_placeholder')" />
        </label>
        <button class="pickfile" @click="browseImportDir">{{ $t('sched.import.browse') }}</button>
        <div v-if="importMsg" class="dim">{{ importMsg }}</div>
        <div class="modalacts">
          <button @click="showImport = false">{{ $t('sched.cancel') }}</button>
          <button class="primary" @click="doImport">{{ $t('sched.import.run') }}</button>
        </div>
      </div>
    </div>
```

顶栏错误区旁边（可选）在 `<header class="bar">` 里已有 `state.error` 展示，无需改动。

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run web/src/scheduler/useScheduler.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```powershell
git add web/src/scheduler/useScheduler.ts web/src/scheduler/SchedulerView.vue web/src/scheduler/useScheduler.test.ts shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(scheduler): 导入按钮与 void_manifest 导入弹窗"
```

---

### Task 7: 全量门禁

- [ ] **Step 1: 后端 + 前端测试**

Run: `npm.cmd test`
Expected: PASS

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 通过（中英键对称、`web/src` 与 `server` 用户可见范围零中文命中）

- [ ] **Step 4: 手工冒烟（dev）**

起 `npm.cmd run dev`，定时任务页：
1. 新建一个 `cwd` 为本机某目录的 shell 任务 → 该目录出现 `void_manifest.json`，内容含 `schedule`/`command`/`runtime`，路径为相对。
2. 把该目录拷到别处 → 点「导入」选新目录 → 任务出现在列表、`cwd` 指向新目录。
3. 同一目录再建任务 → 报错 `dir-taken`；不存在目录建任务 → 报错 `cwd-missing`。
4. 运行一次任务 → 清单 `runtime.lastRun` 更新。

- [ ] **Step 5: 若有偏差，修正后重跑上述门禁**

---

## 自检对照（Spec ↔ Task）

- manifest 结构 + 路径规则 → Task 1
- 自动同步/删除/启停/改 cwd/目录校验（`cwd-missing`/`dir-taken`）→ Task 2
- run-end 刷新 runtime → Task 2 + Task 5
- 导入扫描/覆盖/汇总/单条失败 → Task 3
- `pick-folder` / `import` 端点 → Task 4
- 装配 runtimeProvider → Task 5
- 前端导入按钮/弹窗 + i18n → Task 6
- 门禁（test/typecheck/check:i18n）→ Task 7
