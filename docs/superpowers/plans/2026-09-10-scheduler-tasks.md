# 定时任务（左栏页签）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个与现有终端/工作流隔离的「定时任务」左栏页签：用户定义任务，按间隔或每日时刻自动触发，执行 shell 命令、AI 命令（`opencode run`）或脚本文件，后台独立进程运行，结果在页签内查看。

**Architecture:** 新增 `shared/scheduler.js`（S2C 事件常量）与 `server/scheduler/**`（纯调度计算 + 存储 + 无头执行器 + 引擎 + HTTP 挂载）。控制命令走 HTTP `/api/scheduler/*`，状态事件经 `server/index.js` 广播到现有 `/ws`（与 collaboration 子系统同构）。前端新增 `web/src/scheduler/**`，在 `App.vue` 加一个 rail 入口与视图分支。不改动 `ws-gateway.js` / `session-manager.js` / `workflow-runner.js`。

**Tech Stack:** Node 24 ESM（`node --test`，glob 方式）、Vue3 + Vite + TS（vitest + vue-tsc）、Node 内置 `child_process.spawn` / `fs`。

**环境提醒（AGENTS.md）：** Windows + PowerShell 5.1；一律 `npm.cmd`；服务端测试 `npm.cmd run test:server`（= `node --test "server/test/*.test.js"`）；类型检查 `npm.cmd run typecheck`。

**Spec:** `docs/superpowers/specs/2026-09-10-scheduler-tasks-design.md`

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `shared/scheduler.js` | `SchedulerS2C` 事件常量（唯一事实源） |
| `shared/scheduler.d.ts` | 前端类型（Task/Schedule/Run） |
| `shared/package.json` | 新增 `./scheduler` 子路径导出 |
| `server/scheduler/schedule.js` | 纯函数：间隔毫秒、`computeNextRun` |
| `server/scheduler/store.js` | 任务/运行记录校验、原子持久化、日志路径 |
| `server/scheduler/runner.js` | 构造 spawn 参数（纯）+ 无头执行 + 超时/停止 |
| `server/scheduler/ai-commands.js` | 扫描/读取 opencode command 文件 |
| `server/scheduler/engine.js` | 1s tick、到期触发、并发/重叠控制、事件 |
| `server/scheduler/http-mount.js` | `/api/scheduler/*` REST |
| `server/scheduler/index.js` | barrel：组装 store/engine/runner/mount |
| `server/index.js` | 组装 scheduler、挂 `/api/scheduler`、广播事件 |
| `web/src/scheduler/format.ts` | 纯前端格式化（摘要/时间/状态） |
| `web/src/scheduler/useScheduler.ts` | REST 客户端 + 响应式 state + WS 订阅 |
| `web/src/scheduler/SchedulerView.vue` | 页签 UI（列表/编辑器/历史） |
| `web/src/App.vue` | rail 入口与视图分支 |

---

## Task 1: shared 常量、类型与子路径导出

**Files:**
- Create: `shared/scheduler.js`
- Create: `shared/scheduler.d.ts`
- Modify: `shared/package.json`
- Test: `server/test/scheduler-const.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-const.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SchedulerS2C } from '@devflow/shared/scheduler';

test('SchedulerS2C 已冻结且值唯一', () => {
  assert.ok(Object.isFrozen(SchedulerS2C));
  const vals = Object.values(SchedulerS2C);
  assert.equal(new Set(vals).size, vals.length);
  assert.equal(SchedulerS2C.SCHED_TASKS_CHANGED, 'sched-tasks-changed');
  assert.equal(SchedulerS2C.SCHED_RUN_START, 'sched-run-start');
  assert.equal(SchedulerS2C.SCHED_RUN_END, 'sched-run-end');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL —— `Cannot find package '@devflow/shared/scheduler'` 或找不到导出。

- [ ] **Step 3: 写实现**

Create `shared/scheduler.js`:

```js
// 定时任务子系统独立常量（勿并入 shared/index.js，避免与 master 冲突）
export const SchedulerS2C = Object.freeze({
  SCHED_TASKS_CHANGED: 'sched-tasks-changed',
  SCHED_RUN_START: 'sched-run-start',
  SCHED_RUN_END: 'sched-run-end',
});
```

Create `shared/scheduler.d.ts`:

```ts
export type ScheduleUnit = 'second' | 'minute' | 'hour' | 'day';

export type Schedule =
  | { mode: 'interval'; interval: { every: number; unit: ScheduleUnit } }
  | { mode: 'daily'; daily: { at: string; weekdays: number[] } };

export interface SchedulerTask {
  id: string;
  name: string;
  enabled: boolean;
  projectId: string | null;
  cwd: string | null;
  type: 'shell' | 'ai' | 'script';
  command?: string;
  ai?: { source: 'command' | 'prompt'; commandName?: string; prompt?: string };
  script?: { path: string };
  schedule: Schedule;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = 'running' | 'success' | 'failed' | 'timeout' | 'killed';

export interface SchedulerRun {
  id: string;
  taskId: string;
  status: RunStatus;
  trigger: 'schedule' | 'manual';
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  durationMs: number | null;
  logFile: string;
  error: string | null;
}

export const SchedulerS2C: Readonly<{
  SCHED_TASKS_CHANGED: 'sched-tasks-changed';
  SCHED_RUN_START: 'sched-run-start';
  SCHED_RUN_END: 'sched-run-end';
}>;
```

Modify `shared/package.json` `exports` to add the `./scheduler` entry:

```json
  "exports": {
    ".": { "types": "./index.d.ts", "default": "./index.js" },
    "./collab": { "types": "./collab.d.ts", "default": "./collab.js" },
    "./scheduler": { "types": "./scheduler.d.ts", "default": "./scheduler.js" }
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test:server`
Expected: PASS（至少 `scheduler-const` 全绿）。

- [ ] **Step 5: 提交**

```bash
git add shared/scheduler.js shared/scheduler.d.ts shared/package.json server/test/scheduler-const.test.js
git commit -m "feat(scheduler): shared 事件常量与类型"
```

---

## Task 2: 调度计算 `computeNextRun`

**Files:**
- Create: `server/scheduler/schedule.js`
- Test: `server/test/scheduler-schedule.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-schedule.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextRun, intervalMs } from '../scheduler/schedule.js';

const DAY = 86400000;

test('intervalMs 按单位换算', () => {
  assert.equal(intervalMs({ interval: { every: 30, unit: 'minute' } }), 1800000);
  assert.equal(intervalMs({ interval: { every: 2, unit: 'hour' } }), 7200000);
  assert.equal(intervalMs({ interval: { every: 1, unit: 'day' } }), DAY);
});

test('interval 模式 next = now + 间隔', () => {
  const now = 1000;
  assert.equal(computeNextRun({ mode: 'interval', interval: { every: 5, unit: 'minute' } }, now), now + 300000);
});

test('daily 每天：当天时刻未到取当天，已过取次日', () => {
  const base = new Date('2026-09-10T08:00:00');   // 周四
  const at = { mode: 'daily', daily: { at: '09:30', weekdays: [] } };
  const n1 = computeNextRun(at, base.getTime());
  assert.equal(new Date(n1).getDate(), 10);
  assert.equal(new Date(n1).getHours(), 9);
  const n2 = computeNextRun(at, new Date('2026-09-10T10:00:00').getTime());
  assert.equal(new Date(n2).getDate(), 11);
});

test('daily 仅工作日：周六顺延到周一', () => {
  const sat = new Date('2026-09-12T08:00:00');    // 周六
  const n = computeNextRun({ mode: 'daily', daily: { at: '09:00', weekdays: [1, 2, 3, 4, 5] } }, sat.getTime());
  assert.equal(new Date(n).getDay(), 1);          // 周一
});

test('daily 仅某天：跨周找到下一个选中日', () => {
  const wed = new Date('2026-09-09T08:00:00');    // 周三
  const n = computeNextRun({ mode: 'daily', daily: { at: '09:00', weekdays: [1] } }, wed.getTime());
  assert.equal(new Date(n).getDay(), 1);          // 下周一
});

test('无 schedule 返回 null', () => {
  assert.equal(computeNextRun(null, Date.now()), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL —— 找不到 `../scheduler/schedule.js`。

- [ ] **Step 3: 写实现**

Create `server/scheduler/schedule.js`:

```js
const UNIT_MS = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 };

export function intervalMs(schedule) {
  return schedule.interval.every * UNIT_MS[schedule.interval.unit];
}

function nextDaily(schedule, now) {
  const [h, m] = schedule.daily.at.split(':').map(Number);
  const days = Array.isArray(schedule.daily.weekdays) ? schedule.daily.weekdays : [];
  for (let add = 0; add <= 7; add++) {
    const d = new Date(now);
    d.setDate(d.getDate() + add);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now) continue;
    const wd = d.getDay() === 0 ? 7 : d.getDay();
    if (days.length && !days.includes(wd)) continue;
    return d.getTime();
  }
  return null;
}

export function computeNextRun(schedule, now) {
  if (!schedule) return null;
  if (schedule.mode === 'interval') return now + intervalMs(schedule);
  if (schedule.mode === 'daily') return nextDaily(schedule, now);
  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test:server`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/scheduler/schedule.js server/test/scheduler-schedule.test.js
git commit -m "feat(scheduler): 调度时间计算 computeNextRun"
```

---

## Task 3: 任务/运行存储 `SchedulerStore`

**Files:**
- Create: `server/scheduler/store.js`
- Test: `server/test/scheduler-store.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-store.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SchedulerStore, validateTask } from '../scheduler/store.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-store-')); }
function shellTask(over = {}) {
  return { name: 'a', enabled: true, type: 'shell', command: 'echo hi',
    schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } }, ...over };
}

test('validateTask 校验各字段', () => {
  assert.ok(validateTask(shellTask()).ok);
  assert.equal(validateTask({}).error, 'name required');
  assert.equal(validateTask(shellTask({ type: 'x' })).error, 'type must be shell|ai|script');
  assert.equal(validateTask(shellTask({ ai: { source: 'command' } })).error, 'ai.commandName required');
  assert.equal(validateTask(shellTask({ schedule: { mode: 'daily', daily: { at: 'x' } } })).error, 'daily.at must be HH:MM');
  assert.equal(validateTask(shellTask({ schedule: { mode: 'interval', interval: { every: 0, unit: 'minute' } } })).error, 'interval.every must be > 0');
});

test('createTask 生成 id 并持久化', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask(shellTask());
  assert.match(task.id, /^t_/);
  const store2 = new SchedulerStore({ dir });
  assert.equal(store2.listTasks().length, 1);
  assert.equal(store2.getTask(task.id).command, 'echo hi');
});

test('updateTask 合并并刷新 updatedAt；未知 id 返回 not-found', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const { task } = store.createTask(shellTask());
  const r = store.updateTask(task.id, { name: 'b', enabled: false });
  assert.equal(r.task.name, 'b');
  assert.equal(r.task.enabled, false);
  assert.equal(store.updateTask('nope', {}).error, 'not-found');
});

test('deleteTask 连带删除运行记录与日志文件', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask(shellTask());
  const logFile = store.logFileFor(task.id, 'r_x');
  fs.mkdirSync(path.dirname(store.logPath(logFile)), { recursive: true });
  fs.writeFileSync(store.logPath(logFile), 'out');
  store.addRun({ id: 'r_x', taskId: task.id, status: 'success', logFile });
  store.deleteTask(task.id);
  assert.equal(store.listTasks().length, 0);
  assert.equal(store.getRun('r_x'), null);
  assert.equal(fs.existsSync(store.logPath(logFile)), false);
});

test('addRun 超过 runLimit 淘汰最旧并删除日志', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir, runLimit: 2 });
  const { task } = store.createTask(shellTask());
  for (const id of ['r1', 'r2', 'r3']) {
    const logFile = store.logFileFor(task.id, id);
    fs.mkdirSync(path.dirname(store.logPath(logFile)), { recursive: true });
    fs.writeFileSync(store.logPath(logFile), id);
    store.addRun({ id, taskId: task.id, status: 'success', logFile });
  }
  assert.deepEqual(store.listRuns({ taskId: task.id }).map((r) => r.id), ['r3', 'r2']);
  assert.equal(fs.existsSync(store.logPath(store.logFileFor(task.id, 'r1'))), false);
});

test('updateRun 修改并持久化', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  store.addRun({ id: 'r1', taskId: 't1', status: 'running' });
  const r = store.updateRun('r1', { status: 'success', exitCode: 0 });
  assert.equal(r.status, 'success');
  assert.equal(new SchedulerStore({ dir: store.dir }).getRun('r1').exitCode, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL —— 找不到 `../scheduler/store.js`。

- [ ] **Step 3: 写实现**

Create `server/scheduler/store.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TYPES = new Set(['shell', 'ai', 'script']);
const UNITS = new Set(['second', 'minute', 'hour', 'day']);
const WEEKDAYS = new Set([1, 2, 3, 4, 5, 6, 7]);
const DEFAULT_RUN_LIMIT = 500;

function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  return fallback;
}

export function validateTask(input) {
  const t = input || {};
  if (!t.name || typeof t.name !== 'string') return { error: 'name required' };
  if (!TYPES.has(t.type)) return { error: 'type must be shell|ai|script' };
  if (t.type === 'shell' && typeof t.command !== 'string') return { error: 'command required' };
  if (t.type === 'ai') {
    const ai = t.ai || {};
    if (ai.source !== 'command' && ai.source !== 'prompt') return { error: 'ai.source must be command|prompt' };
    if (ai.source === 'command' && !ai.commandName) return { error: 'ai.commandName required' };
    if (ai.source === 'prompt' && typeof ai.prompt !== 'string') return { error: 'ai.prompt required' };
  }
  if (t.type === 'script') {
    const s = t.script || {};
    if (!s.path || typeof s.path !== 'string') return { error: 'script.path required' };
  }
  const sc = t.schedule || {};
  if (sc.mode !== 'interval' && sc.mode !== 'daily') return { error: 'schedule.mode must be interval|daily' };
  if (sc.mode === 'interval') {
    const iv = sc.interval || {};
    if (!(Number(iv.every) > 0)) return { error: 'interval.every must be > 0' };
    if (!UNITS.has(iv.unit)) return { error: 'interval.unit invalid' };
  } else {
    const d = sc.daily || {};
    if (!/^\d{2}:\d{2}$/.test(d.at || '')) return { error: 'daily.at must be HH:MM' };
    const wd = d.weekdays || [];
    if (!Array.isArray(wd) || wd.some((w) => !WEEKDAYS.has(w))) return { error: 'daily.weekdays invalid' };
  }
  return { ok: true };
}

export class SchedulerStore {
  constructor({ dir, logger = console, runLimit = DEFAULT_RUN_LIMIT }) {
    this.dir = dir;
    this.log = logger;
    this.runLimit = runLimit;
    this.tasksFile = path.join(dir, 'tasks.json');
    this.runsFile = path.join(dir, 'runs.json');
    this.logsDir = path.join(dir, 'logs');
    const tasks = readJson(this.tasksFile, []);
    const runs = readJson(this.runsFile, []);
    this.tasks = Array.isArray(tasks) ? tasks : [];
    this.runs = Array.isArray(runs) ? runs : [];
  }
  saveTasks() { atomicWriteJson(this.tasksFile, this.tasks); }
  saveRuns() { atomicWriteJson(this.runsFile, this.runs); }
  listTasks() { return this.tasks.map((t) => ({ ...t })); }
  getTask(id) { const t = this.tasks.find((x) => x.id === id); return t ? { ...t } : null; }
  createTask(input) {
    const v = validateTask(input);
    if (v.error) return { error: v.error };
    const now = Date.now();
    const task = {
      id: 't_' + crypto.randomBytes(4).toString('hex'),
      name: String(input.name).trim(),
      enabled: input.enabled !== false,
      projectId: input.projectId || null,
      cwd: input.cwd || null,
      type: input.type,
      command: input.type === 'shell' ? input.command : undefined,
      ai: input.type === 'ai' ? { ...input.ai } : undefined,
      script: input.type === 'script' ? { ...input.script } : undefined,
      schedule: { ...input.schedule },
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.push(task);
    this.saveTasks();
    return { task: { ...task } };
  }
  updateTask(id, patch) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'not-found' };
    const merged = { ...this.tasks[i], ...patch, id, createdAt: this.tasks[i].createdAt, updatedAt: Date.now() };
    const v = validateTask(merged);
    if (v.error) return { error: v.error };
    this.tasks[i] = merged;
    this.saveTasks();
    return { task: { ...merged } };
  }
  deleteTask(id) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'not-found' };
    this.tasks.splice(i, 1);
    this.saveTasks();
    const removed = this.runs.filter((r) => r.taskId === id);
    this.runs = this.runs.filter((r) => r.taskId !== id);
    this.saveRuns();
    for (const r of removed) { try { fs.rmSync(this.logPath(r.logFile), { force: true }); } catch { /* ignore */ } }
    try { fs.rmSync(path.join(this.logsDir, id), { recursive: true, force: true }); } catch { /* ignore */ }
    return { ok: true };
  }
  logFileFor(taskId, runId) { return path.join(taskId, runId + '.log'); }
  logPath(rel) { return path.join(this.logsDir, rel); }
  addRun(run) {
    this.runs.unshift(run);
    const overflow = this.runs.splice(this.runLimit);
    for (const r of overflow) { try { fs.rmSync(this.logPath(r.logFile), { force: true }); } catch { /* ignore */ } }
    this.saveRuns();
    return run;
  }
  listRuns({ taskId = null, limit = 50 } = {}) {
    const arr = taskId ? this.runs.filter((r) => r.taskId === taskId) : this.runs.slice();
    return arr.slice(0, Math.max(1, Math.min(500, limit | 0 || 50)));
  }
  getRun(id) { return this.runs.find((r) => r.id === id) || null; }
  updateRun(id, patch) {
    const r = this.runs.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, patch);
    this.saveRuns();
    return r;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test:server`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/scheduler/store.js server/test/scheduler-store.test.js
git commit -m "feat(scheduler): 任务与运行记录存储"
```

---

## Task 4: 无头执行器 `runner`

**Files:**
- Create: `server/scheduler/runner.js`
- Test: `server/test/scheduler-runner.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-runner.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { buildSpawnSpec, createRunner, resolveCwd } from '../scheduler/runner.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-run-')); }

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit('close', null);
  return child;
}

test('resolveCwd 优先级：task.cwd > 项目根 > fallback', () => {
  assert.equal(resolveCwd({ cwd: 'C:/a' }, 'C:/proj', 'C:/fb'), 'C:/a');
  assert.equal(resolveCwd({ cwd: null }, 'C:/proj', 'C:/fb'), 'C:/proj');
  assert.equal(resolveCwd({ cwd: null }, null, 'C:/fb'), 'C:/fb');
});

test('buildSpawnSpec：shell / ai / script', () => {
  const shell = buildSpawnSpec({ type: 'shell', command: 'echo hi' }, { cwd: 'C:/p' });
  if (process.platform === 'win32') {
    assert.equal(shell.bin, 'powershell.exe');
    assert.deepEqual(shell.args, ['-NoProfile', '-NonInteractive', '-Command', 'echo hi']);
  } else {
    assert.deepEqual(shell.args, ['-c', 'echo hi']);
  }
  assert.equal(shell.cwd, 'C:/p');

  const ai = buildSpawnSpec({ type: 'ai' }, { cwd: 'C:/p', aiBin: 'myopencode', aiPrompt: 'do it' });
  assert.equal(ai.bin, 'myopencode');
  assert.deepEqual(ai.args, ['run', 'do it']);

  const ps = buildSpawnSpec({ type: 'script', script: { path: 'x/y.ps1' } }, { cwd: 'C:/p' });
  assert.deepEqual(ps.args.slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.ok(ps.args[4].endsWith(path.join('x', 'y.ps1')));
});

test('buildSpawnSpec：不支持的脚本扩展名抛错', () => {
  assert.throws(() => buildSpawnSpec({ type: 'script', script: { path: 'a.txt' } }, { cwd: '.' }), /unsupported script type/);
});

test('run 把 stdout/stderr 写入日志并返回退出码', async () => {
  const dir = tmpDir();
  const child = fakeChild();
  let captured = null;
  const runner = createRunner({ spawnFn: (bin, args, opts) => { captured = { bin, args, opts }; return child; }, killChild: () => {} });
  const logPath = path.join(dir, 'r1.log');
  const p = runner.run({ runId: 'r1', spec: { bin: 'echo', args: ['hi'], cwd: dir }, logPath, timeoutMs: 0 });
  child.stdout.emit('data', 'out-');
  child.stderr.emit('data', 'err');
  child.emit('close', 0);
  const res = await p;
  assert.equal(res.exitCode, 0);
  assert.equal(res.timedOut, false);
  assert.equal(fs.readFileSync(logPath, 'utf8'), 'out-err');
  assert.equal(captured.bin, 'echo');
});

test('run 超时 kill 子进程并标记 timedOut', async () => {
  const dir = tmpDir();
  const child = fakeChild();
  let killed = false;
  const runner = createRunner({ spawnFn: () => child, killChild: () => { killed = true; } });
  const p = runner.run({ runId: 'r2', spec: { bin: 'sleep', args: [], cwd: dir }, logPath: path.join(dir, 'r2.log'), timeoutMs: 20 });
  const res = await p;
  assert.equal(res.timedOut, true);
  assert.equal(killed, true);
});

test('stop 终止运行中的子进程', () => {
  const dir = tmpDir();
  const child = fakeChild();
  let killed = 0;
  const runner = createRunner({ spawnFn: () => child, killChild: () => { killed++; child.emit('close', null); } });
  runner.run({ runId: 'r3', spec: { bin: 'x', args: [], cwd: dir }, logPath: path.join(dir, 'r3.log'), timeoutMs: 0 });
  assert.equal(runner.isRunning('r3'), true);
  assert.equal(runner.stop('r3'), true);
  assert.equal(killed, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL —— 找不到 `../scheduler/runner.js`。

- [ ] **Step 3: 写实现**

Create `server/scheduler/runner.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function resolveCwd(task, projectRoot, fallback) {
  return task.cwd || projectRoot || fallback;
}

export function buildSpawnSpec(task, { cwd, aiBin = 'opencode', aiPrompt = null }) {
  if (task.type === 'shell') {
    if (process.platform === 'win32') return { bin: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', task.command], cwd };
    return { bin: '/bin/sh', args: ['-c', task.command], cwd };
  }
  if (task.type === 'ai') return { bin: aiBin, args: ['run', aiPrompt ?? ''], cwd };
  if (task.type === 'script') {
    const abs = path.isAbsolute(task.script.path) ? task.script.path : path.join(cwd, task.script.path);
    const ext = path.extname(abs).toLowerCase();
    if (ext === '.ps1') return { bin: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', abs], cwd };
    if (ext === '.bat' || ext === '.cmd') return { bin: 'cmd.exe', args: ['/c', abs], cwd };
    if (ext === '.sh') return { bin: 'bash', args: [abs], cwd };
    throw Object.assign(new Error('unsupported script type'), { code: 'unsupported-script' });
  }
  throw Object.assign(new Error('unknown task type'), { code: 'bad-task' });
}

function defaultKill(child) {
  if (!child) return;
  try {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else child.kill('SIGKILL');
  } catch { /* ignore */ }
}

export function createRunner({ spawnFn = spawn, killChild = defaultKill } = {}) {
  const running = new Map();

  function run({ runId, spec, logPath, timeoutMs = 0, onData, onExit }) {
    return new Promise((resolve) => {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const stream = fs.createWriteStream(logPath, { flags: 'a' });
      let child;
      try {
        child = spawnFn(spec.bin, spec.args, { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch (e) {
        stream.end();
        const result = { exitCode: -1, timedOut: false, spawnError: true, error: String(e && e.message || e), durationMs: 0 };
        onExit?.(result);
        return resolve(result);
      }
      running.set(runId, child);
      const startedAt = Date.now();
      let done = false;
      let timedOut = false;
      const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killChild(child); finish(null); }, timeoutMs) : null;
      const write = (c) => { stream.write(c); onData?.(String(c)); };
      child.stdout?.on('data', write);
      child.stderr?.on('data', write);
      const finish = (code, spawnError = false, errMsg = null) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        running.delete(runId);
        stream.end();
        const result = { exitCode: code ?? null, timedOut, spawnError, error: errMsg, durationMs: Date.now() - startedAt };
        onExit?.(result);
        resolve(result);
      };
      child.on('error', (e) => finish(-1, true, String(e && e.message || e)));
      child.on('close', (code) => finish(code, false, null));
    });
  }

  function stop(runId) {
    const child = running.get(runId);
    if (!child) return false;
    killChild(child);
    return true;
  }
  return { run, stop, isRunning: (id) => running.has(id), count: () => running.size };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test:server`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/scheduler/runner.js server/test/scheduler-runner.test.js
git commit -m "feat(scheduler): 无头子进程执行器"
```

---

## Task 5: opencode command 扫描

**Files:**
- Create: `server/scheduler/ai-commands.js`
- Test: `server/test/scheduler-ai-commands.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-ai-commands.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listAiCommands, readAiCommand } from '../scheduler/ai-commands.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-ai-')); }

test('listAiCommands 列出 .md 并提取预览', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'command'), { recursive: true });
  fs.writeFileSync(path.join(root, 'command', 'review.md'), '---\ndesc: x\n---\n请评审这段代码');
  fs.writeFileSync(path.join(root, 'command', 'notes.txt'), 'ignore');
  const list = listAiCommands({ configRoot: root });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'review.md');
  assert.match(list[0].preview, /请评审/);
});

test('listAiCommands 目录不存在返回空数组', () => {
  assert.deepEqual(listAiCommands({ configRoot: tmpDir() }), []);
});

test('readAiCommand 读取正文；非法名抛错', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'command'), { recursive: true });
  fs.writeFileSync(path.join(root, 'command', 'a.md'), 'BODY');
  assert.equal(readAiCommand('a.md', { configRoot: root }), 'BODY');
  assert.throws(() => readAiCommand('../secret', { configRoot: root }), /bad name|unsafe name/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL —— 找不到 `../scheduler/ai-commands.js`。

- [ ] **Step 3: 写实现**

Create `server/scheduler/ai-commands.js`:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultConfigRoot() {
  return process.env.DEVFLOW_OPENCODE_CONFIG || path.join(os.homedir(), '.config', 'opencode');
}
function assertSafeRel(name) {
  if (!name || typeof name !== 'string') throw new Error('bad name');
  if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('unsafe name');
}
export function listAiCommands({ configRoot = defaultConfigRoot() } = {}) {
  const dir = path.join(configRoot, 'command');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const full = path.join(dir, e.name);
    let preview = '';
    try { preview = fs.readFileSync(full, 'utf8').replace(/^---[\s\S]*?---/, '').trim().slice(0, 200); } catch { /* ignore */ }
    out.push({ name: e.name, path: full, preview });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
export function readAiCommand(name, { configRoot = defaultConfigRoot() } = {}) {
  assertSafeRel(name);
  return fs.readFileSync(path.join(configRoot, 'command', name), 'utf8');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test:server`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/scheduler/ai-commands.js server/test/scheduler-ai-commands.test.js
git commit -m "feat(scheduler): opencode command 扫描与读取"
```

---

## Task 6: 调度引擎 `createEngine`

**Files:**
- Create: `server/scheduler/engine.js`
- Test: `server/test/scheduler-engine.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-engine.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SchedulerStore } from '../scheduler/store.js';
import { createEngine } from '../scheduler/engine.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-eng-')); }
function task(over = {}) {
  return { name: 'a', enabled: true, type: 'shell', command: 'echo hi',
    schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } }, ...over };
}
function fakeRunner() {
  const calls = [];
  const pending = [];
  let running = 0;
  return {
    calls,
    run(args) { calls.push(args); running++; return new Promise((resolve) => pending.push(() => { running--; const res = { exitCode: 0, timedOut: false, durationMs: 1 }; args.onExit?.(res); resolve(res); })); },
    stop() { return true; },
    isRunning() { return true; },
    count() { return running; },
    finishAll() { while (pending.length) pending.shift()(); },
  };
}
const HOUR = 3600000;

test('到期触发一次并 emit run-start/run-end', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const events = [];
  const now = { v: 1000 };
  const engine = createEngine({ store, runner, now: () => now.v });
  engine.onEvent((e) => events.push(e));
  store.createTask(task());
  engine.refreshAll();
  now.v += HOUR;
  engine.tick();
  assert.equal(runner.calls.length, 1);
  runner.finishAll();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(events, ['run-start', 'run-end']);
});

test('禁用任务不触发', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const now = { v: 1000 };
  const engine = createEngine({ store, runner, now: () => now.v });
  store.createTask(task({ enabled: false }));
  engine.refreshAll();
  now.v += HOUR * 2;
  engine.tick();
  assert.equal(runner.calls.length, 0);
});

test('运行中不重叠（跳过本次）', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const now = { v: 1000 };
  const engine = createEngine({ store, runner, now: () => now.v });
  store.createTask(task());
  engine.refreshAll();
  now.v += HOUR; engine.tick();
  now.v += HOUR; engine.tick();
  assert.equal(runner.calls.length, 1);
});

test('并发上限：到上限时跳过', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const now = { v: 1000 };
  const engine = createEngine({ store, runner, now: () => now.v, maxConcurrent: 1 });
  store.createTask(task({ name: 'a' }));
  store.createTask(task({ name: 'b' }));
  engine.refreshAll();
  now.v += HOUR; engine.tick();
  assert.equal(runner.calls.length, 1);
});

test('manualRun 立即执行；未知任务返回 not-found', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner();
  const engine = createEngine({ store, runner, now: () => 1000 });
  const { task: t } = store.createTask(task());
  const r = engine.manualRun(t.id);
  assert.equal(r.run.trigger, 'manual');
  assert.equal(engine.manualRun('nope').error, 'not-found');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL —— 找不到 `../scheduler/engine.js`。

- [ ] **Step 3: 写实现**

Create `server/scheduler/engine.js`:

```js
import crypto from 'node:crypto';
import { computeNextRun } from './schedule.js';
import { buildSpawnSpec, createRunner } from './runner.js';

const TICK_MS = 1000;
const runIdGen = () => 'r_' + crypto.randomBytes(4).toString('hex');

function timeoutFor(task) {
  const env = Number(process.env.DEVFLOW_SCHED_TIMEOUT_MS);
  if (Number.isFinite(env) && env >= 0) return env;
  return task.type === 'ai' ? 1800000 : 600000;
}

export function createEngine({
  store, runner = createRunner(), logger = console,
  now = () => Date.now(), tickMs = TICK_MS,
  maxConcurrent = Number(process.env.DEVFLOW_SCHED_MAX_CONCURRENT) || 3,
} = {}) {
  const nextAt = new Map();
  const taskRuns = new Map();
  const listeners = new Set();
  let timer = null;
  let projectResolver = () => null;
  let aiPromptLoader = null;

  function emit(evt, payload) { for (const cb of listeners) { try { cb(evt, payload); } catch (e) { logger.error('sched listener', e); } } }
  function onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); }
  function setProjectResolver(fn) { projectResolver = fn; }
  function setAiPromptLoader(fn) { aiPromptLoader = fn; }

  function scheduleTask(task, from = now()) {
    if (!task.enabled) { nextAt.delete(task.id); return null; }
    const n = computeNextRun(task.schedule, from);
    if (n == null) nextAt.delete(task.id); else nextAt.set(task.id, n);
    return n;
  }
  function nextRunAtOf(id) { return nextAt.has(id) ? nextAt.get(id) : null; }
  function refreshAll() { for (const t of store.listTasks()) scheduleTask(t); }
  function reschedule(task) { scheduleTask(task); }
  function notifyTasksChanged() { emit('tasks-changed', {}); }

  function finishImmediate(task, trigger, message) {
    const id = runIdGen();
    const logFile = store.logFileFor(task.id, id);
    const run = { id, taskId: task.id, status: 'failed', trigger, startedAt: now(), finishedAt: now(), exitCode: null, durationMs: 0, logFile, error: message };
    store.addRun(run);
    emit('run-end', { run: { ...run } });
    return run;
  }

  function startRun(task, trigger) {
    if (taskRuns.has(task.id)) return { error: 'already-running' };
    if (runner.count() >= maxConcurrent) return { error: 'max-concurrent' };
    const cwd = task.cwd || projectResolver(task.projectId) || process.cwd();
    let aiPrompt = null;
    if (task.type === 'ai') {
      aiPrompt = task.ai.source === 'command' ? (aiPromptLoader ? aiPromptLoader(task.ai.commandName) : '') : (task.ai.prompt || '');
    }
    let spec;
    try { spec = buildSpawnSpec(task, { cwd, aiPrompt }); }
    catch (e) { return { run: finishImmediate(task, trigger, String(e.message)) }; }
    const id = runIdGen();
    const logFile = store.logFileFor(task.id, id);
    const run = { id, taskId: task.id, status: 'running', trigger, startedAt: now(), finishedAt: null, exitCode: null, durationMs: null, logFile, error: null };
    store.addRun(run);
    taskRuns.set(task.id, id);
    emit('run-start', { run: { ...run } });
    runner.run({ runId: id, spec, logPath: store.logPath(logFile), timeoutMs: timeoutFor(task) })
      .then((res) => {
        const status = res.spawnError ? 'failed' : res.timedOut ? 'timeout' : (res.exitCode === 0 ? 'success' : 'failed');
        complete(task, id, status, res);
      })
      .catch((e) => complete(task, id, 'failed', { exitCode: null, durationMs: 0, error: String(e && e.message || e) }));
    return { run: { ...run } };
  }

  function complete(task, id, status, res) {
    taskRuns.delete(task.id);
    const patch = { status, finishedAt: now(), exitCode: res.exitCode ?? null, durationMs: res.durationMs ?? null, error: res.error || null };
    const run = store.updateRun(id, patch);
    const fresh = store.getTask(task.id);
    if (fresh) scheduleTask(fresh, now());
    emit('run-end', { run: run ? { ...run } : { id, taskId: task.id, ...patch } });
  }

  function manualRun(taskId) {
    const task = store.getTask(taskId);
    if (!task) return { error: 'not-found' };
    return startRun(task, 'manual');
  }
  function stop(taskId) {
    const rid = taskRuns.get(taskId);
    if (!rid) return false;
    return runner.stop(rid);
  }
  function tick() {
    const t = now();
    for (const task of store.listTasks()) {
      if (!task.enabled) continue;
      if (!nextAt.has(task.id)) { scheduleTask(task, t); continue; }
      if (nextAt.get(task.id) > t) continue;
      scheduleTask(task, t);
      if (taskRuns.has(task.id)) continue;
      startRun(task, 'schedule');
    }
  }
  function start() {
    refreshAll();
    if (!timer) { timer = setInterval(tick, tickMs); if (timer.unref) timer.unref(); }
  }
  function stopAll() { if (timer) { clearInterval(timer); timer = null; } }

  return {
    start, stopAll, tick, onEvent, manualRun, stop, scheduleTask, reschedule,
    nextRunAtOf, refreshAll, notifyTasksChanged, setProjectResolver, setAiPromptLoader,
    isRunning: (id) => taskRuns.has(id),
    runIdOf: (id) => (taskRuns.has(id) ? taskRuns.get(id) : null),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test:server`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/scheduler/engine.js server/test/scheduler-engine.test.js
git commit -m "feat(scheduler): 调度引擎"
```

---

## Task 7: HTTP 挂载 `createSchedulerMount`

**Files:**
- Create: `server/scheduler/http-mount.js`
- Test: `server/test/scheduler-http.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-http.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { SchedulerStore } from '../scheduler/store.js';
import { createEngine } from '../scheduler/engine.js';
import { createSchedulerMount } from '../scheduler/http-mount.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-http-')); }

function fakeRunner() {
  const calls = [];
  const pending = [];
  return {
    calls,
    run(args) { calls.push(args); return new Promise((resolve) => pending.push(() => { const res = { exitCode: 0, timedOut: false, durationMs: 1 }; args.onExit?.(res); resolve(res); })); },
    stop() { return true; }, isRunning() { return false; }, count() { return 0; }, finishAll() { while (pending.length) pending.shift()(); },
  };
}

function call(mount, method, urlStr, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = urlStr;
  const res = { status: 0, headers: null, body: '', writeHead(s, h) { this.status = s; this.headers = h; }, end(s) { this.body = s || ''; } };
  const p = new Promise((resolve) => { res.end = (s) => { res.body = s || ''; resolve(res); }; });
  const callP = mount(req, res);
  if (body !== undefined) { req.emit('data', Buffer.from(JSON.stringify(body))); }
  req.emit('end');
  return Promise.resolve(callP).then(() => p);
}

function setup(runner = fakeRunner()) {
  const store = new SchedulerStore({ dir: tmpDir() });
  const engine = createEngine({ store, runner, now: () => 1000 });
  const mount = createSchedulerMount({ engine, store });
  return { store, engine, runner, mount };
}

test('POST 创建 / GET 列表 / PUT 更新 / DELETE', async () => {
  const { mount } = setup();
  const create = await call(mount, 'POST', '/api/scheduler/tasks', {
    name: 'a', type: 'shell', command: 'echo', schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  });
  assert.equal(create.status, 200);
  const task = JSON.parse(create.body).task;
  assert.ok(task.id);

  const list = await call(mount, 'GET', '/api/scheduler/tasks');
  assert.equal(JSON.parse(list.body).tasks.length, 1);

  const upd = await call(mount, 'PUT', `/api/scheduler/tasks/${task.id}`, { name: 'b' });
  assert.equal(JSON.parse(upd.body).task.name, 'b');

  const del = await call(mount, 'DELETE', `/api/scheduler/tasks/${task.id}`);
  assert.equal(JSON.parse(del.body).ok, true);
  assert.equal(JSON.parse((await call(mount, 'GET', '/api/scheduler/tasks')).body).tasks.length, 0);
});

test('创建非法任务返回 400', async () => {
  const { mount } = setup();
  const res = await call(mount, 'POST', '/api/scheduler/tasks', { name: 'a' });
  assert.equal(res.status, 400);
});

test('立即运行 / 列表 / 停止', async () => {
  const { mount } = setup();
  const created = await call(mount, 'POST', '/api/scheduler/tasks', {
    name: 'a', type: 'shell', command: 'echo', schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  });
  const id = JSON.parse(created.body).task.id;
  const run = await call(mount, 'POST', `/api/scheduler/tasks/${id}/run`);
  assert.equal(run.status, 200);
  assert.ok(JSON.parse(run.body).run.id);
  const runs = await call(mount, 'GET', `/api/scheduler/runs?taskId=${id}`);
  assert.equal(JSON.parse(runs.body).runs.length, 1);
  const stop = await call(mount, 'POST', `/api/scheduler/tasks/${id}/stop`);
  assert.equal(JSON.parse(stop.body).ok, true);
});

test('运行日志端点返回文本', async () => {
  const { mount, store } = setup();
  store.addRun({ id: 'r1', taskId: 't1', status: 'success', logFile: 't1/r1.log' });
  const p = store.logPath('t1/r1.log');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'hello-log');
  const res = await call(mount, 'GET', '/api/scheduler/runs/r1/log');
  assert.equal(res.body, 'hello-log');
});

test('未知路由 404', async () => {
  const { mount } = setup();
  const res = await call(mount, 'GET', '/api/scheduler/nope');
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL —— 找不到 `../scheduler/http-mount.js`。

- [ ] **Step 3: 写实现**

Create `server/scheduler/http-mount.js`:

```js
import fs from 'node:fs';
import { listAiCommands } from './ai-commands.js';

const LOG_TAIL_MAX = 256 * 1024;

export function createSchedulerMount({ engine, store, logger = console }) {
  const sendJson = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req, limit = 1024 * 1024) => new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
  const withNext = (task) => ({ ...task, nextRunAt: engine.nextRunAtOf(task.id), runningRunId: engine.runIdOf(task.id) });

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p === '/api/scheduler/tasks' && req.method === 'GET') {
        return sendJson(res, 200, { tasks: store.listTasks().map(withNext), serverTime: Date.now() });
      }
      if (p === '/api/scheduler/tasks' && req.method === 'POST') {
        const r = store.createTask(await readBody(req));
        if (r.error) return sendJson(res, 400, { error: r.error });
        engine.reschedule(r.task);
        engine.notifyTasksChanged();
        return sendJson(res, 200, { task: withNext(r.task) });
      }
      const m = p.match(/^\/api\/scheduler\/tasks\/([^/]+)(?:\/(run|stop))?$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const action = m[2];
        if (action === 'run' && req.method === 'POST') {
          const r = engine.manualRun(id);
          if (r.error === 'not-found') return sendJson(res, 404, { error: 'not-found' });
          if (r.error) return sendJson(res, 409, { error: r.error });
          return sendJson(res, 200, { run: r.run });
        }
        if (action === 'stop' && req.method === 'POST') {
          return sendJson(res, 200, { ok: engine.stop(id) });
        }
        if (!action && req.method === 'PUT') {
          const r = store.updateTask(id, await readBody(req));
          if (r.error === 'not-found') return sendJson(res, 404, { error: 'not-found' });
          if (r.error) return sendJson(res, 400, { error: r.error });
          engine.reschedule(r.task);
          engine.notifyTasksChanged();
          return sendJson(res, 200, { task: withNext(r.task) });
        }
        if (!action && req.method === 'DELETE') {
          const r = store.deleteTask(id);
          if (r.error) return sendJson(res, 404, { error: 'not-found' });
          engine.notifyTasksChanged();
          return sendJson(res, 200, { ok: true });
        }
      }
      if (p === '/api/scheduler/runs' && req.method === 'GET') {
        const taskId = url.searchParams.get('taskId');
        const limit = Number(url.searchParams.get('limit')) || 50;
        return sendJson(res, 200, { runs: store.listRuns({ taskId, limit }) });
      }
      const rm = p.match(/^\/api\/scheduler\/runs\/([^/]+)\/log$/);
      if (rm && req.method === 'GET') {
        const run = store.getRun(decodeURIComponent(rm[1]));
        if (!run) return sendJson(res, 404, { error: 'not-found' });
        let text = '';
        try { text = fs.readFileSync(store.logPath(run.logFile), 'utf8'); } catch { text = ''; }
        if (text.length > LOG_TAIL_MAX) text = text.slice(text.length - LOG_TAIL_MAX);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(text);
      }
      if (p === '/api/scheduler/ai-commands' && req.method === 'GET') {
        return sendJson(res, 200, { commands: listAiCommands() });
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      logger.error('scheduler http', err);
      return sendJson(res, 500, { error: 'internal', message: String(err && err.message || err) });
    }
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test:server`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/scheduler/http-mount.js server/test/scheduler-http.test.js
git commit -m "feat(scheduler): HTTP 挂载"
```

---

## Task 8: barrel 与 server 接线

**Files:**
- Create: `server/scheduler/index.js`
- Modify: `server/index.js`
- Test: `server/test/scheduler-index.test.js`

- [ ] **Step 1: 写失败测试**

Create `server/test/scheduler-index.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScheduler } from '../scheduler/index.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-idx-')); }
function fakeRunner() {
  const calls = [];
  return {
    calls,
    run(a) { calls.push(a); return Promise.resolve({ exitCode: 0, timedOut: false, durationMs: 1 }); },
    stop() { return true; }, isRunning() { return false; }, count() { return 0; },
  };
}

test('createScheduler 组装 store/engine/mount 并解析项目 cwd', () => {
  const runner = fakeRunner();
  const sched = createScheduler({ dir: tmpDir(), runner, projectResolver: (id) => (id === 'p1' ? 'C:/proj' : null) });
  const { task } = sched.store.createTask({
    name: 'a', projectId: 'p1', type: 'shell', command: 'echo',
    schedule: { mode: 'interval', interval: { every: 5, unit: 'minute' } },
  });
  assert.equal(typeof sched.mount, 'function');
  const r = sched.engine.manualRun(task.id);
  assert.equal(r.run.status, 'running');
  assert.equal(runner.calls[0].spec.cwd, 'C:/proj');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test:server`
Expected: FAIL —— 找不到 `../scheduler/index.js`。

- [ ] **Step 3: 写实现**

Create `server/scheduler/index.js`:

```js
import { SchedulerStore } from './store.js';
import { createEngine } from './engine.js';
import { createRunner } from './runner.js';
import { createSchedulerMount } from './http-mount.js';
import { readAiCommand } from './ai-commands.js';

export function createScheduler({ dir, projectResolver = () => null, logger = console, runner = null }) {
  const store = new SchedulerStore({ dir, logger });
  const engine = createEngine({ store, runner: runner || createRunner(), logger });
  engine.setProjectResolver(projectResolver);
  engine.setAiPromptLoader((name) => readAiCommand(name));
  const mount = createSchedulerMount({ engine, store, logger });
  return { store, engine, mount };
}

export { SchedulerStore } from './store.js';
export { createEngine } from './engine.js';
export { createRunner } from './runner.js';
export { computeNextRun } from './schedule.js';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test:server`
Expected: PASS。

- [ ] **Step 5: 接线 `server/index.js`**

Add imports near the collaboration imports:

```js
import { SchedulerS2C } from '@devflow/shared/scheduler';
import { createScheduler } from './scheduler/index.js';
```

同时把现有 `data-home.js` 的导入补上 `dataHome`（原导入缺它，新块要用）——将

```js
import { collabDir, uploadDir, downloadDir, seedFromLegacy, instanceName, instanceSeedDir, instanceFpRoot } from './data-home.js';
```

改为

```js
import { collabDir, uploadDir, downloadDir, seedFromLegacy, instanceName, instanceSeedDir, instanceFpRoot, dataHome } from './data-home.js';
```

After the `collabEngine` / `broadcastCollab` block (before `const server = http.createServer(...)`), add:

```js
// ---- 定时任务子系统（隔离目录 server/scheduler/**，数据存用户数据目录）----
const scheduler = createScheduler({
  dir: path.join(dataHome(), 'scheduler'),
  projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
  logger: log,
});
const broadcastSched = (type, payload) => {
  if (!gateway) return;
  for (const c of gateway.conns) c.send({ type, ...payload });
};
scheduler.engine.onEvent((evt, payload) => {
  const type = evt === 'run-start' ? SchedulerS2C.SCHED_RUN_START
    : evt === 'run-end' ? SchedulerS2C.SCHED_RUN_END
    : SchedulerS2C.SCHED_TASKS_CHANGED;
  broadcastSched(type, payload);
});
```

> 注意：**不要**在这里再写 `let gateway;`。现有 `server/index.js` 协作段（约第 96 行）已经声明，`broadcastSched` 复用它即可。

Inside the HTTP handler, before the generic `/api/` fallthrough (right after the `/api/collab` branch), add:

```js
    if (url.pathname.startsWith('/api/scheduler')) { await scheduler.mount(req, res); return; }
```

In `server.listen` callback, after the existing `log.info` lines, add:

```js
  if (!['0', 'off', 'false'].includes(String(process.env.DEVFLOW_SCHEDULER || '').toLowerCase())) {
    scheduler.engine.start();
    log.info('scheduler started');
  }
```

- [ ] **Step 6: 冒烟启动服务**

Run（后台，遵守 AGENTS 非阻塞规范）:

```powershell
$out="C:\Users\slxxzh11\AppData\Local\Temp\opencode\sched-server.out.log"; $err="C:\Users\slxxzh11\AppData\Local\Temp\opencode\sched-server.err.log"; Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory "D:\baobiao\devflow_statistic\statistic_devflow" -RedirectStandardOutput $out -RedirectStandardError $err; Start-Sleep -Seconds 2; Get-Content $out; Get-Content $err
```

Expected: 日志出现 `listening on http://127.0.0.1:3001` 与 `scheduler started`；随后用 `Invoke-RestMethod http://127.0.0.1:3001/api/scheduler/tasks` 得到 `{ tasks: [] }`。测完 `Get-Process node | Stop-Process`（仅停本机测试实例）。

- [ ] **Step 7: 提交**

```bash
git add server/scheduler/index.js server/test/scheduler-index.test.js server/index.js
git commit -m "feat(scheduler): 组装并接入服务端"
```

---

## Task 9: 前端格式化工具

**Files:**
- Create: `web/src/scheduler/format.ts`
- Test: `web/src/scheduler/format.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/scheduler/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scheduleSummary, runStatusLabel, formatTime } from './format';

describe('scheduleSummary', () => {
  it('间隔', () => {
    expect(scheduleSummary({ mode: 'interval', interval: { every: 30, unit: 'minute' } })).toBe('每 30 分钟');
  });
  it('每天', () => {
    expect(scheduleSummary({ mode: 'daily', daily: { at: '09:30', weekdays: [] } })).toBe('每天 09:30');
  });
  it('工作日', () => {
    expect(scheduleSummary({ mode: 'daily', daily: { at: '09:30', weekdays: [1, 2, 3, 4, 5] } })).toBe('工作日 09:30');
  });
  it('指定星期', () => {
    expect(scheduleSummary({ mode: 'daily', daily: { at: '08:00', weekdays: [1, 3] } })).toBe('周一、周三 08:00');
  });
});

describe('runStatusLabel / formatTime', () => {
  it('状态中文', () => {
    expect(runStatusLabel('success')).toBe('成功');
    expect(runStatusLabel('timeout')).toBe('超时');
  });
  it('空时间显示破折号', () => {
    expect(formatTime(null)).toBe('—');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test`
Expected: FAIL —— 找不到 `./format`。

- [ ] **Step 3: 写实现**

Create `web/src/scheduler/format.ts`:

```ts
import type { Schedule } from '@devflow/shared/scheduler';

const UNIT_LABEL: Record<string, string> = { second: '秒', minute: '分钟', hour: '小时', day: '天' };
const WD = ['', '一', '二', '三', '四', '五', '六', '日'];

export function scheduleSummary(s: Schedule): string {
  if (s.mode === 'interval') return `每 ${s.interval.every} ${UNIT_LABEL[s.interval.unit] || s.interval.unit}`;
  const days = (s.daily.weekdays || []).slice().sort((a, b) => a - b);
  let dayText: string;
  if (days.length === 0) dayText = '每天';
  else if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) dayText = '工作日';
  else dayText = '周' + days.map((d) => WD[d]).join('、');
  return `${dayText} ${s.daily.at}`;
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const STATUS_LABEL: Record<string, string> = { running: '运行中', success: '成功', failed: '失败', timeout: '超时', killed: '已停止' };
export function runStatusLabel(s: string): string {
  return STATUS_LABEL[s] || s;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/scheduler/format.ts web/src/scheduler/format.test.ts
git commit -m "feat(scheduler): 前端格式化工具"
```

---

## Task 10: 前端 API 客户端 `useScheduler`

**Files:**
- Create: `web/src/scheduler/useScheduler.ts`
- Test: `web/src/scheduler/useScheduler.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/scheduler/useScheduler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useScheduler } from './useScheduler';

const calls: Array<{ url: string; method: string }> = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url === '/api/scheduler/tasks' && (init.method || 'GET') === 'GET') {
      return { ok: true, text: async () => JSON.stringify({ tasks: [{ id: 't1', name: 'a' }] }) } as any;
    }
    return { ok: true, text: async () => JSON.stringify({}) } as any;
  }));
});

describe('useScheduler', () => {
  it('refresh 拉取任务', async () => {
    const s = useScheduler();
    await s.refresh();
    expect(s.state.tasks.length).toBe(1);
    expect(s.state.tasks[0].id).toBe('t1');
  });

  it('createTask 后刷新', async () => {
    const s = useScheduler();
    await s.createTask({ name: 'a' });
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/scheduler/tasks')).toBe(true);
    expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(0);
  });

  it('订阅 WS 事件后自动 refresh', async () => {
    const handlers: Record<string, () => void> = {};
    const terminal = { on: (t: string, h: () => void) => { handlers[t] = h; return () => {}; } };
    const s = useScheduler(terminal);
    handlers['sched-run-end']?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.method === 'GET')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test`
Expected: FAIL —— 找不到 `./useScheduler`。

- [ ] **Step 3: 写实现**

Create `web/src/scheduler/useScheduler.ts`:

```ts
import { reactive } from 'vue';
import { SchedulerS2C } from '@devflow/shared/scheduler';
import type { SchedulerTask, SchedulerRun } from '@devflow/shared/scheduler';

export interface TaskView extends SchedulerTask {
  nextRunAt: number | null;
  runningRunId: string | null;
}
export interface AiCommandInfo { name: string; preview: string; }

async function api(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

type TerminalLike = { on: (type: string, handler: (msg: any) => void) => () => void };

export function useScheduler(terminal?: TerminalLike) {
  const state = reactive({
    tasks: [] as TaskView[],
    aiCommands: [] as AiCommandInfo[],
    loading: false,
    error: '',
  });

  async function refresh() {
    state.loading = true;
    try {
      const d = await api('GET', '/api/scheduler/tasks');
      state.tasks = d.tasks || [];
      state.error = '';
    } catch (e: any) {
      state.error = String(e?.message || e);
    } finally {
      state.loading = false;
    }
  }
  async function createTask(input: unknown) {
    const d = await api('POST', '/api/scheduler/tasks', input);
    await refresh();
    return d.task;
  }
  async function updateTask(id: string, patch: unknown) {
    const d = await api('PUT', `/api/scheduler/tasks/${encodeURIComponent(id)}`, patch);
    await refresh();
    return d.task;
  }
  async function removeTask(id: string) {
    await api('DELETE', `/api/scheduler/tasks/${encodeURIComponent(id)}`);
    await refresh();
  }
  function runNow(id: string) { return api('POST', `/api/scheduler/tasks/${encodeURIComponent(id)}/run`); }
  function stopTask(id: string) { return api('POST', `/api/scheduler/tasks/${encodeURIComponent(id)}/stop`); }
  async function loadRuns(taskId: string, limit = 50): Promise<SchedulerRun[]> {
    const d = await api('GET', `/api/scheduler/runs?taskId=${encodeURIComponent(taskId)}&limit=${limit}`);
    return d.runs || [];
  }
  async function loadLog(runId: string): Promise<string> {
    const res = await fetch(`/api/scheduler/runs/${encodeURIComponent(runId)}/log`);
    return res.ok ? res.text() : '';
  }
  async function loadAiCommands() {
    try {
      const d = await api('GET', '/api/scheduler/ai-commands');
      state.aiCommands = d.commands || [];
    } catch { state.aiCommands = []; }
  }

  const unsubs: Array<() => void> = [];
  if (terminal) {
    const onAny = () => { refresh(); };
    unsubs.push(terminal.on(SchedulerS2C.SCHED_TASKS_CHANGED, onAny));
    unsubs.push(terminal.on(SchedulerS2C.SCHED_RUN_START, onAny));
    unsubs.push(terminal.on(SchedulerS2C.SCHED_RUN_END, onAny));
  }

  return { state, refresh, createTask, updateTask, removeTask, runNow, stopTask, loadRuns, loadLog, loadAiCommands, dispose: () => unsubs.forEach((u) => u()) };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/scheduler/useScheduler.ts web/src/scheduler/useScheduler.test.ts
git commit -m "feat(scheduler): 前端 API 客户端与事件订阅"
```

---

## Task 11: `SchedulerView.vue` 与 `App.vue` 入口

**Files:**
- Create: `web/src/scheduler/SchedulerView.vue`
- Modify: `web/src/App.vue`

- [ ] **Step 1: 写组件**

Create `web/src/scheduler/SchedulerView.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useScheduler, type TaskView } from './useScheduler';
import { scheduleSummary, formatTime, runStatusLabel } from './format';
import type { SchedulerRun } from '@devflow/shared/scheduler';

const props = defineProps<{ terminal: any }>();
const sched = useScheduler(props.terminal);
const { state } = sched;

const projects = ref<{ id: string; name: string; root: string }[]>([]);
const showEditor = ref(false);
const editingId = ref<string | null>(null);
const form = ref<any>(emptyForm());
const runs = ref<SchedulerRun[]>([]);
const runsTaskId = ref<string | null>(null);
const logText = ref('');
const logRunId = ref<string | null>(null);
let logTimer: ReturnType<typeof setInterval> | null = null;

function emptyForm() {
  return {
    name: '', enabled: true, projectId: '', cwd: '', type: 'shell', command: '',
    ai: { source: 'command', commandName: '', prompt: '' }, script: { path: '' },
    schedule: { mode: 'interval', interval: { every: 30, unit: 'minute' }, daily: { at: '09:30', weekdays: [] } },
  };
}
async function loadProjects() {
  try { const d = await fetch('/api/projects').then((r) => r.json()); projects.value = d.projects || []; }
  catch { projects.value = []; }
}
function openCreate() { editingId.value = null; form.value = emptyForm(); showEditor.value = true; }
function openEdit(t: TaskView) {
  editingId.value = t.id;
  form.value = JSON.parse(JSON.stringify({
    name: t.name, enabled: t.enabled, projectId: t.projectId || '', cwd: t.cwd || '', type: t.type,
    command: t.command || '', ai: t.ai || { source: 'command', commandName: '', prompt: '' },
    script: t.script || { path: '' }, schedule: t.schedule,
  }));
  showEditor.value = true;
}
async function save() {
  const body = JSON.parse(JSON.stringify(form.value));
  if (!body.projectId) body.projectId = null;
  if (!body.cwd) body.cwd = null;
  if (body.type !== 'shell') delete body.command;
  if (body.type !== 'ai') delete body.ai;
  if (body.type !== 'script') delete body.script;
  try {
    if (editingId.value) await sched.updateTask(editingId.value, body);
    else await sched.createTask(body);
    showEditor.value = false;
  } catch (e: any) { state.error = String(e?.message || e); }
}
async function remove(t: TaskView) {
  if (!confirm(`删除任务「${t.name}」？`)) return;
  await sched.removeTask(t.id);
}
async function runNow(t: TaskView) {
  try { await sched.runNow(t.id); await sched.refresh(); }
  catch (e: any) { state.error = String(e?.message || e); }
}
async function stop(t: TaskView) { await sched.stopTask(t.id); await sched.refresh(); }
async function toggle(t: TaskView) { await sched.updateTask(t.id, { enabled: !t.enabled }); }
async function openRuns(t: TaskView) {
  runsTaskId.value = t.id;
  runs.value = await sched.loadRuns(t.id);
  logText.value = '';
  logRunId.value = null;
  startLogTimer();
}
async function openLog(r: SchedulerRun) { logRunId.value = r.id; logText.value = await sched.loadLog(r.id); }
function startLogTimer() {
  stopLogTimer();
  logTimer = setInterval(async () => {
    if (!runsTaskId.value) return;
    runs.value = await sched.loadRuns(runsTaskId.value);
    if (logRunId.value) logText.value = await sched.loadLog(logRunId.value);
  }, 2000);
}
function stopLogTimer() { if (logTimer) { clearInterval(logTimer); logTimer = null; } }
function closeRuns() { runsTaskId.value = null; logRunId.value = null; logText.value = ''; stopLogTimer(); }
const WEEKDAYS = [{ v: 1, t: '一' }, { v: 2, t: '二' }, { v: 3, t: '三' }, { v: 4, t: '四' }, { v: 5, t: '五' }, { v: 6, t: '六' }, { v: 7, t: '日' }];
function toggleWeekday(v: number) {
  const arr: number[] = form.value.schedule.daily.weekdays;
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1); else arr.push(v);
}

onMounted(async () => { await loadProjects(); await sched.refresh(); sched.loadAiCommands(); });
onBeforeUnmount(() => { stopLogTimer(); sched.dispose(); });
</script>

<template>
  <div class="sched">
    <header class="bar">
      <span class="title">定时任务</span>
      <span v-if="state.error" class="err">{{ state.error }}</span>
      <div class="spacer" />
      <button @click="sched.refresh()">刷新</button>
      <button class="primary" @click="openCreate">新建任务</button>
    </header>

    <div class="body">
      <div class="list">
        <div v-if="!state.tasks.length" class="empty">暂无定时任务，点右上角新建</div>
        <div v-for="t in state.tasks" :key="t.id" class="row">
          <div class="rowmain">
            <div class="name">
              <span class="badge" :class="t.type">{{ t.type === 'shell' ? '命令' : t.type === 'ai' ? 'AI' : '脚本' }}</span>
              {{ t.name }}
              <span class="dim">{{ scheduleSummary(t.schedule) }}</span>
            </div>
            <div class="meta">
              <span v-if="t.runningRunId" class="dot running" />{{ t.runningRunId ? '运行中' : '' }}
              <span class="dim">下次 {{ formatTime(t.nextRunAt) }}</span>
            </div>
          </div>
          <div class="acts">
            <label class="sw"><input type="checkbox" :checked="t.enabled" @change="toggle(t)" /> 启用</label>
            <button v-if="!t.runningRunId" @click="runNow(t)">运行</button>
            <button v-else @click="stop(t)">停止</button>
            <button @click="openRuns(t)">历史</button>
            <button @click="openEdit(t)">编辑</button>
            <button @click="remove(t)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showEditor" class="overlay" @click.self="showEditor = false">
      <div class="modal">
        <h3>{{ editingId ? '编辑任务' : '新建任务' }}</h3>
        <label>名称 <input v-model="form.name" /></label>
        <label>项目
          <select v-model="form.projectId">
            <option value="">（不绑定）</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
        <label>目录覆盖（可选） <input v-model="form.cwd" placeholder="留空则用项目根" /></label>
        <label>类型
          <select v-model="form.type">
            <option value="shell">命令</option>
            <option value="ai">AI 命令</option>
            <option value="script">脚本</option>
          </select>
        </label>
        <template v-if="form.type === 'shell'">
          <label>命令内容 <textarea v-model="form.command" rows="3" /></label>
        </template>
        <template v-else-if="form.type === 'ai'">
          <label>来源
            <select v-model="form.ai.source">
              <option value="command">从 command 列表选</option>
              <option value="prompt">手写 prompt</option>
            </select>
          </label>
          <label v-if="form.ai.source === 'command'">Command
            <select v-model="form.ai.commandName">
              <option value="">请选择</option>
              <option v-for="c in state.aiCommands" :key="c.name" :value="c.name">{{ c.name }}</option>
            </select>
          </label>
          <label v-else>Prompt <textarea v-model="form.ai.prompt" rows="4" /></label>
        </template>
        <template v-else>
          <label>脚本路径（相对项目根或绝对） <input v-model="form.script.path" /></label>
        </template>

        <label>调度方式
          <select v-model="form.schedule.mode">
            <option value="interval">按周期</option>
            <option value="daily">每日时刻</option>
          </select>
        </label>
        <template v-if="form.schedule.mode === 'interval'">
          <label>每 <input type="number" min="1" v-model.number="form.schedule.interval.every" style="width:80px" />
            <select v-model="form.schedule.interval.unit">
              <option value="second">秒</option>
              <option value="minute">分钟</option>
              <option value="hour">小时</option>
              <option value="day">天</option>
            </select>
          </label>
        </template>
        <template v-else>
          <label>时刻 <input type="time" v-model="form.schedule.daily.at" /></label>
          <div class="wd">
            星期（不选=每天）：
            <label v-for="w in WEEKDAYS" :key="w.v" class="wditem">
              <input type="checkbox" :checked="form.schedule.daily.weekdays.includes(w.v)" @change="toggleWeekday(w.v)" />{{ w.t }}
            </label>
          </div>
        </template>

        <div class="modalacts">
          <button @click="showEditor = false">取消</button>
          <button class="primary" @click="save">保存</button>
        </div>
      </div>
    </div>

    <div v-if="runsTaskId" class="overlay" @click.self="closeRuns">
      <div class="modal wide">
        <h3>运行历史</h3>
        <div class="histwrap">
          <div class="histlist">
            <div v-for="r in runs" :key="r.id" class="histitem" :class="{ on: r.id === logRunId }" @click="openLog(r)">
              <span class="dot" :class="r.status" />{{ formatTime(r.startedAt) }}
              <span class="dim">{{ runStatusLabel(r.status) }} · {{ r.durationMs ?? '—' }}ms</span>
            </div>
            <div v-if="!runs.length" class="empty">暂无运行记录</div>
          </div>
          <pre class="logview">{{ logText || '（选择一次运行查看输出）' }}</pre>
        </div>
        <div class="modalacts"><button @click="closeRuns">关闭</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sched { display: flex; flex-direction: column; height: 100%; background: var(--bg0, var(--bg1)); }
.bar { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-bottom: 1px solid var(--bd); }
.bar .title { font-weight: 700; color: var(--tx1); }
.bar .spacer { flex: 1; }
.bar .err { color: var(--warn, #e5534b); font-size: 12px; }
.bar button, .modalacts button { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.bar button.primary, .modalacts button.primary { background: var(--ac3, var(--ac2)); border-color: var(--ac3, var(--ac2)); color: #fff; }
.body { flex: 1; overflow: auto; padding: 8px 12px; }
.empty { color: var(--tx5); padding: 24px; text-align: center; }
.row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--bd); border-radius: 6px; margin-bottom: 6px; background: var(--bg1); }
.rowmain { flex: 1; min-width: 0; }
.name { color: var(--tx1); display: flex; align-items: center; gap: 8px; }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 3px; background: var(--bg5, var(--bg4)); color: var(--tx2); }
.badge.ai { background: var(--ac2); color: #fff; }
.badge.script { background: var(--warn, #b58900); color: #000; }
.meta { color: var(--tx4); font-size: 12px; margin-top: 2px; display: flex; gap: 12px; align-items: center; }
.dim { color: var(--tx5); font-size: 12px; }
.acts { display: flex; gap: 4px; align-items: center; flex: none; }
.acts button { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
.sw { color: var(--tx4); font-size: 12px; display: flex; align-items: center; gap: 3px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--tx5); margin-right: 4px; }
.dot.running { background: var(--ac2); }
.dot.success { background: #3fb950; }
.dot.failed, .dot.timeout { background: #e5534b; }
.dot.killed { background: var(--tx5); }
.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 16px; width: 460px; max-height: 86vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.modal.wide { width: 720px; }
.modal h3 { margin: 0 0 6px; color: var(--tx1); }
.modal label { display: flex; flex-direction: column; gap: 3px; color: var(--tx3); font-size: 12px; }
.modal input, .modal select, .modal textarea { background: var(--bg4, var(--bg5)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 6px; font-family: inherit; }
.wd { color: var(--tx3); font-size: 12px; }
.wditem { display: inline-flex; flex-direction: row; align-items: center; gap: 2px; margin-right: 6px; }
.modalacts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.histwrap { display: flex; gap: 8px; min-height: 260px; }
.histlist { width: 220px; overflow: auto; border-right: 1px solid var(--bd); }
.histitem { padding: 5px 6px; cursor: pointer; border-radius: 4px; font-size: 12px; color: var(--tx2); }
.histitem.on { background: var(--bg5, var(--bg4)); }
.logview { flex: 1; margin: 0; overflow: auto; background: var(--bg6, var(--bg1)); color: var(--tx2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; padding: 8px; white-space: pre-wrap; }
</style>
```

- [ ] **Step 2: 接线 `App.vue`**

`web/src/App.vue` 改动：

1. 顶部 import 增加：
```ts
import SchedulerView from './scheduler/SchedulerView.vue';
```
2. `rail` 联合类型加入 `'scheduler'`（约第 20 行）：
```ts
const rail = ref<'explorer' | 'history' | 'contacts' | 'stat' | 'scheduler'>('explorer');
```
3. activity rail 增加按钮（在 `stat` 按钮之后、`gearbot` 之前）：
```html
<button class="a-btn" :class="{ on: rail === 'scheduler' }" title="定时任务" @click="rail = 'scheduler'">⏰</button>
```
4. 在 `rail === 'stat'` 分支之后增加：
```html
<template v-else-if="rail === 'scheduler'">
  <section class="center">
    <SchedulerView :terminal="terminal" />
  </section>
</template>
```

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（`vue-tsc` 无错误）。

- [ ] **Step 4: 前端测试**

Run: `npm.cmd --prefix web run test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/scheduler/SchedulerView.vue web/src/App.vue
git commit -m "feat(scheduler): 定时任务页签 UI 与入口"
```

---

## Task 12: 全量验证与构建

**Files:** 无新增（仅验证）

- [ ] **Step 1: 服务端全量测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS。

- [ ] **Step 2: 前端全量测试**

Run: `npm.cmd --prefix web run test`
Expected: 全部 PASS。

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 4: 前端构建**

Run: `npm.cmd run build:web`
Expected: 产物生成到 `web/dist`，无报错。

- [ ] **Step 5: 端到端冒烟（dev 模式）**

先按 AGENTS 非阻塞方式启动后端与前端 dev：

```powershell
$out="C:\Users\slxxzh11\AppData\Local\Temp\opencode\sched-dev.out.log"; $err="C:\Users\slxxzh11\AppData\Local\Temp\opencode\sched-dev.err.log"; Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:server" -WorkingDirectory "D:\baobiao\devflow_statistic\statistic_devflow" -RedirectStandardOutput $out -RedirectStandardError $err; Start-Sleep -Seconds 2; Get-Content $out
```

访问 http://localhost:5173 ，点左侧 `⏰`：
- 新建一个 `shell` 任务，内容 `echo scheduler-smoke`，周期「每 1 分钟」，保存；
- 点「运行」，在「历史」里看到状态 `成功` 且输出含 `scheduler-smoke`；
- 刷新页面，任务仍在（持久化生效）；
- 停掉 node 进程清理。

- [ ] **Step 6: 提交（如有验证期微调）**

```bash
git add -A
git commit -m "test(scheduler): 全量验证与冒烟修正"
```

---

## 自检记录（Self-Review）

- **Spec 覆盖**：shared 常量（Task 1）、存储（Task 3）、调度语义 computeNextRun（Task 2）+ 引擎（Task 6）、执行器三类与超时/停止（Task 4）、opencode command 扫描（Task 5）、HTTP 九个端点（Task 7）、barrel+接线+广播（Task 8）、前端格式化/客户端/UI/入口（Task 9-11）、env 配置（Task 8/6/5 分散读取）、测试与门禁（Task 12）全部有对应任务。
- **占位符扫描**：无 TBD/TODO；每个代码步骤给出完整代码与预期输出。
- **类型一致性**：`computeNextRun(schedule, now)`、`buildSpawnSpec(task, opts)`、`createRunner({spawnFn,killChild})`、`createEngine({store,runner,now,tickMs,maxConcurrent})`、`SchedulerStore`（`logFileFor/logPath/addRun/updateRun/listRuns/getRun`）、`createSchedulerMount({engine,store})`、`SchedulerS2C` 三个事件名在前后端一致。
- **已知偏差**：新增 `server/scheduler/schedule.js`（spec 已同步补入）；`runStatusLabel` 仅前端展示映射。
