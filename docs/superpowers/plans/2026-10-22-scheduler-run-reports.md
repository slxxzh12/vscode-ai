# 定时任务运行报告 Implementation Plan

> **For agentic workers:** 按 AGENTS.md 用 inline 方式执行（superpowers:executing-plans），不要用 subagent 驱动。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每次定时任务运行都生成并归档 Markdown 报告，成功/失败都有报告；定时任务汇总页显示总成功/总失败/运行中，点任务进入详情查看全部历史报告。

**Architecture:** 每次运行由系统创建 `scheduler/reports/<taskId>/<runId>/run.json` 与 `report.md`，把 `run.json` 绝对路径通过 `DEVFLOW_RUN_CONTEXT` 注入任务环境；任务写 `report.md`，缺失时后端生成兜底报告。新增 summary / report HTTP 接口，前端把运行历史弹窗改为任务详情页。

**Tech Stack:** Node ESM（`node --test`）、Vue 3 + TypeScript（`vitest`）、markdown-it（`renderRemoteMarkdown`）。

**Spec:** `docs/superpowers/specs/2026-10-22-scheduler-run-reports-design.md`

---

## Task 1: 共享类型与 i18n 词条

**Files:**
- Modify: `shared/scheduler.d.ts`
- Modify: `shared/i18n/zh-CN.js:404-406`
- Modify: `shared/i18n/en.js:404-406`
- Test: `npm.cmd run check:i18n`

- [ ] **Step 1: 扩展共享类型**

在 `shared/scheduler.d.ts` 的 `SchedulerRun` 中加 `reportFile`，并新增 summary / context 类型：

```ts
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
  reportFile?: string | null;
  error: string | null;
  sessionId?: string | null;
}

export interface SchedulerSummary {
  total: number;
  success: number;
  failed: number;
  running: number;
}

export interface SchedulerRunContext {
  runId: string;
  taskId: string;
  taskName: string;
  trigger: 'schedule' | 'manual';
  startedAt: number;
  reportPath: string;
  logPath: string;
  outputDir: string;
}
```

- [ ] **Step 2: 补中文词条**

在 `shared/i18n/zh-CN.js` 的 `sched.runs.select` 之后追加：

```js
  'sched.summary.total': '总运行',
  'sched.summary.success': '总成功',
  'sched.summary.failed': '总失败',
  'sched.summary.running': '运行中',
  'sched.detail.back': '返回',
  'sched.detail.report': '报告',
  'sched.detail.raw_log': '原始日志',
  'sched.detail.runs': '历史报告',
  'sched.detail.empty': '还没有运行记录',
  'sched.report.empty': '本次运行没有报告内容',
  'sched.report.truncated': '报告过长，已截断',
  'sched.report.run': '运行',
  'sched.report.trigger': '触发',
  'sched.report.started': '开始',
  'sched.report.duration': '耗时',
  'sched.report.exit': '退出码',
  'sched.report.error': '错误',
  'sched.report.log_tail': '日志末尾',
  'sched.trigger.schedule': '定时',
  'sched.trigger.manual': '手动',
```

- [ ] **Step 3: 补英文词条**

在 `shared/i18n/en.js` 的 `sched.runs.select` 之后追加：

```js
  'sched.summary.total': 'Total runs',
  'sched.summary.success': 'Succeeded',
  'sched.summary.failed': 'Failed',
  'sched.summary.running': 'Running',
  'sched.detail.back': 'Back',
  'sched.detail.report': 'Report',
  'sched.detail.raw_log': 'Raw log',
  'sched.detail.runs': 'Run reports',
  'sched.detail.empty': 'No runs yet',
  'sched.report.empty': 'This run has no report content',
  'sched.report.truncated': 'Report too long; truncated',
  'sched.report.run': 'Run',
  'sched.report.trigger': 'Trigger',
  'sched.report.started': 'Started',
  'sched.report.duration': 'Duration',
  'sched.report.exit': 'Exit code',
  'sched.report.error': 'Error',
  'sched.report.log_tail': 'Log tail',
  'sched.trigger.schedule': 'Scheduled',
  'sched.trigger.manual': 'Manual',
```

- [ ] **Step 4: 运行 i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 通过（无缺失/多余键）。

- [ ] **Step 5: Commit**

```powershell
git add shared/scheduler.d.ts shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(scheduler): 报告类型与词条"
```

---

## Task 2: Store 增加报告路径、汇总与保留策略

**Files:**
- Modify: `server/scheduler/store.js`
- Test: `server/test/scheduler-store.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/scheduler-store.test.js` 末尾追加：

```js
test('报告路径按 taskId/runId 归档', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  assert.equal(store.reportFileFor('t1', 'r1'), path.join('t1', 'r1', 'report.md'));
  assert.equal(store.contextFileFor('t1', 'r1'), path.join('t1', 'r1', 'run.json'));
  assert.equal(store.reportPath(store.reportFileFor('t1', 'r1')), path.join(store.dir, 'reports', 't1', 'r1', 'report.md'));
});

test('summary 统计成功、失败、运行中', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  store.addRun({ id: 'r1', taskId: 't1', status: 'success' });
  store.addRun({ id: 'r2', taskId: 't1', status: 'failed' });
  store.addRun({ id: 'r3', taskId: 't1', status: 'timeout' });
  store.addRun({ id: 'r4', taskId: 't1', status: 'killed' });
  store.addRun({ id: 'r5', taskId: 't1', status: 'running' });
  store.addRun({ id: 'r6', taskId: 't1', status: 'paused' });
  assert.deepEqual(store.summary(), { total: 6, success: 1, failed: 3, running: 2 });
});

test('默认保留全部运行记录', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  for (let i = 0; i < 60; i += 1) store.addRun({ id: `r${i}`, taskId: 't1', status: 'success' });
  assert.equal(store.listRuns({ taskId: 't1' }).length, 60);
});

test('显式 runLimit 时连带删除报告目录', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir, runLimit: 1 });
  const { task } = store.createTask(shellTask());
  const reportFile = store.reportFileFor(task.id, 'r1');
  fs.mkdirSync(path.dirname(store.reportPath(reportFile)), { recursive: true });
  fs.writeFileSync(store.reportPath(reportFile), '# r1');
  store.addRun({ id: 'r1', taskId: task.id, status: 'success', reportFile });
  store.addRun({ id: 'r2', taskId: task.id, status: 'success' });
  assert.equal(store.listRuns({ taskId: task.id }).length, 1);
  assert.equal(fs.existsSync(path.dirname(store.reportPath(reportFile))), false);
});

test('deleteTask 连带删除报告目录', () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const { task } = store.createTask(shellTask());
  const reportFile = store.reportFileFor(task.id, 'r1');
  fs.mkdirSync(path.dirname(store.reportPath(reportFile)), { recursive: true });
  fs.writeFileSync(store.reportPath(reportFile), '# r1');
  store.addRun({ id: 'r1', taskId: task.id, status: 'success', reportFile });
  store.deleteTask(task.id);
  assert.equal(fs.existsSync(path.join(dir, 'reports', task.id)), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/scheduler-store.test.js"`
Expected: FAIL（`reportFileFor is not a function` / `summary is not a function`）。

- [ ] **Step 3: 实现 store 变更**

`server/scheduler/store.js` 顶部常量改为：

```js
const DEFAULT_RUN_LIMIT = Number(process.env.DEVFLOW_SCHED_RUN_LIMIT) || 0;
```

构造函数里加 `reportsDir`：

```js
    this.logsDir = path.join(dir, 'logs');
    this.reportsDir = path.join(dir, 'reports');
```

在 `logFileFor` 后加：

```js
  reportFileFor(taskId, runId) { return path.join(taskId, runId, 'report.md'); }
  contextFileFor(taskId, runId) { return path.join(taskId, runId, 'run.json'); }
  reportPath(rel) { return path.join(this.reportsDir, rel); }
```

`addRun` 改为只在 `runLimit > 0` 时裁剪，并删除对应报告：

```js
  addRun(run) {
    this.runs.unshift(run);
    if (this.runLimit > 0) {
      const overflow = this.runs.splice(this.runLimit);
      for (const r of overflow) {
        try { fs.rmSync(this.logPath(r.logFile), { force: true }); } catch { /* ignore */ }
        if (r.reportFile) {
          try { fs.rmSync(path.dirname(this.reportPath(r.reportFile)), { recursive: true, force: true }); } catch { /* ignore */ }
        }
      }
    }
    this.saveRuns();
    return run;
  }
```

`listRuns` 支持不传 limit 返回全部：

```js
  listRuns({ taskId = null, limit = null } = {}) {
    const arr = taskId ? this.runs.filter((r) => r.taskId === taskId) : this.runs.slice();
    if (limit == null) return arr;
    return arr.slice(0, Math.max(1, Math.min(5000, limit | 0 || 50)));
  }
```

新增 `summary`：

```js
  summary() {
    const out = { total: this.runs.length, success: 0, failed: 0, running: 0 };
    for (const r of this.runs) {
      if (r.status === 'success') out.success += 1;
      else if (r.status === 'running' || r.status === 'paused') out.running += 1;
      else out.failed += 1;
    }
    return out;
  }
```

`deleteTask` 中已有删除日志循环，改为同时删报告：

```js
    for (const r of removed) {
      try { fs.rmSync(this.logPath(r.logFile), { force: true }); } catch { /* ignore */ }
      if (r.reportFile) {
        try { fs.rmSync(path.dirname(this.reportPath(r.reportFile)), { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
    try { fs.rmSync(path.join(this.logsDir, id), { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(path.join(this.reportsDir, id), { recursive: true, force: true }); } catch { /* ignore */ }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/scheduler-store.test.js"`
Expected: PASS（全部）。

- [ ] **Step 5: Commit**

```powershell
git add server/scheduler/store.js server/test/scheduler-store.test.js
git commit -m "feat(scheduler): 报告路径与运行汇总统计"
```

---

## Task 3: 运行上下文与兜底报告模块

**Files:**
- Create: `server/scheduler/report.js`
- Test: `server/test/scheduler-report.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/scheduler-report.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SchedulerStore } from '../scheduler/store.js';
import { writeRunContext, ensureReport, legacyReport, stripAnsi } from '../scheduler/report.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sched-report-')); }
function mkStore() {
  const store = new SchedulerStore({ dir: tmpDir() });
  return { store, task: store.createTask({ name: 'scan', type: 'shell', command: 'echo', schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } } }).task };
}

test('writeRunContext 生成 run.json 与报告目录', () => {
  const { store, task } = mkStore();
  const run = { id: 'r1', taskId: task.id, trigger: 'manual', startedAt: 100, logFile: store.logFileFor(task.id, 'r1') };
  const ctx = writeRunContext({ store, task, run });
  const json = JSON.parse(fs.readFileSync(ctx.contextPath, 'utf8'));
  assert.equal(json.runId, 'r1');
  assert.equal(json.taskName, 'scan');
  assert.equal(json.reportPath, ctx.reportPath);
  assert.equal(json.outputDir, path.dirname(ctx.reportPath));
  assert.equal(json.logPath, store.logPath(run.logFile));
});

test('ensureReport 保留任务写入的报告', () => {
  const { store, task } = mkStore();
  const run = { id: 'r2', taskId: task.id, trigger: 'manual', startedAt: 100, logFile: store.logFileFor(task.id, 'r2') };
  const ctx = writeRunContext({ store, task, run });
  fs.writeFileSync(ctx.reportPath, '# custom');
  const rel = ensureReport({ store, task, run, result: { status: 'success' } });
  assert.equal(fs.readFileSync(store.reportPath(rel), 'utf8'), '# custom');
});

test('ensureReport 缺失时生成兜底报告并去掉 ANSI', () => {
  const { store, task } = mkStore();
  const run = { id: 'r3', taskId: task.id, trigger: 'schedule', startedAt: 100, logFile: store.logFileFor(task.id, 'r3'), status: 'failed', error: 'boom' };
  fs.mkdirSync(path.dirname(store.logPath(run.logFile)), { recursive: true });
  fs.writeFileSync(store.logPath(run.logFile), '\u001b[31mboom\u001b[0m');
  writeRunContext({ store, task, run });
  const rel = ensureReport({ store, task, run, result: { status: 'failed', error: 'boom', exitCode: 1, durationMs: 12 } });
  const text = fs.readFileSync(store.reportPath(rel), 'utf8');
  assert.match(text, /# scan/);
  assert.match(text, /失败/);
  assert.match(text, /boom/);
  assert.equal(text.includes('\u001b'), false);
});

test('legacyReport 给旧运行记录即时生成报告', () => {
  const { store, task } = mkStore();
  const run = { id: 'r4', taskId: task.id, trigger: 'manual', startedAt: 100, logFile: store.logFileFor(task.id, 'r4'), status: 'success' };
  const text = legacyReport({ store, run, task });
  assert.match(text, /# scan/);
  assert.match(text, /成功/);
});

test('stripAnsi 去除颜色码', () => {
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/scheduler-report.test.js"`
Expected: FAIL（`Cannot find module '../scheduler/report.js'`）。

- [ ] **Step 3: 实现 report.js**

创建 `server/scheduler/report.js`：

```js
import fs from 'node:fs';
import path from 'node:path';
import { t } from '../i18n.js';

const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripAnsi(s) {
  return String(s ?? '').replace(ANSI_RE, '');
}

export function readLogTail(file, maxLines = 100) {
  if (!file) return '';
  try {
    const text = stripAnsi(fs.readFileSync(file, 'utf8')).trim();
    if (!text) return '';
    return text.split(/\r?\n/).slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

function logFileOf(store, run) {
  return run.logFile ? store.logPath(run.logFile) : '';
}

export function writeRunContext({ store, task, run }) {
  const reportFile = store.reportFileFor(task.id, run.id);
  const contextFile = store.contextFileFor(task.id, run.id);
  const reportPath = store.reportPath(reportFile);
  const contextPath = store.reportPath(contextFile);
  const outputDir = path.dirname(reportPath);
  fs.mkdirSync(outputDir, { recursive: true });
  const context = {
    runId: run.id,
    taskId: task.id,
    taskName: task.name,
    trigger: run.trigger,
    startedAt: run.startedAt,
    reportPath,
    logPath: store.logPath(run.logFile),
    outputDir,
  };
  fs.writeFileSync(contextPath, JSON.stringify(context, null, 2), 'utf8');
  return { contextPath, reportPath, reportFile };
}

export function fallbackMarkdown({ task, run, result = {}, logText = '' }) {
  const status = result.status || run.status || 'failed';
  const label = t(`sched.status.${status}`);
  const started = new Date(run.startedAt || Date.now()).toLocaleString();
  const duration = result.durationMs ?? run.durationMs;
  const exitCode = result.exitCode ?? run.exitCode;
  const error = result.error || run.error || '';
  const lines = [
    `# ${task.name} · ${label}`,
    '',
    `- ${t('sched.report.run')}: ${run.id}`,
    `- ${t('sched.report.trigger')}: ${t(`sched.trigger.${run.trigger || 'schedule'}`)}`,
    `- ${t('sched.report.started')}: ${started}`,
    `- ${t('sched.report.duration')}: ${duration == null ? '—' : `${duration} ms`}`,
    `- ${t('sched.report.exit')}: ${exitCode == null ? '—' : exitCode}`,
    `- ${t('sched.report.error')}: ${error || '—'}`,
  ];
  if (logText) lines.push('', `## ${t('sched.report.log_tail')}`, '', '```text', logText, '```');
  return lines.join('\n') + '\n';
}

export function ensureReport({ store, task, run, result = {} }) {
  const reportFile = store.reportFileFor(task.id, run.id);
  const reportPath = store.reportPath(reportFile);
  let text = '';
  try { text = fs.readFileSync(reportPath, 'utf8'); } catch { /* missing */ }
  if (!text.trim()) {
    text = fallbackMarkdown({ task, run, result, logText: readLogTail(logFileOf(store, run)) });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, text, 'utf8');
  }
  return reportFile;
}

export function legacyReport({ store, run, task }) {
  return fallbackMarkdown({
    task: task || { name: run.taskId },
    run,
    result: { status: run.status, error: run.error, exitCode: run.exitCode, durationMs: run.durationMs },
    logText: readLogTail(logFileOf(store, run)),
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/scheduler-report.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add server/scheduler/report.js server/test/scheduler-report.test.js
git commit -m "feat(scheduler): 运行上下文与兜底报告"
```

---

## Task 4: Runner 注入 DEVFLOW_RUN_CONTEXT

**Files:**
- Modify: `server/scheduler/runner.js`
- Test: `server/test/scheduler-runner.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/scheduler-runner.test.js` 的 `buildSpawnSpec` 测试后追加：

```js
test('buildSpawnSpec：传入 runContextPath 时注入 DEVFLOW_RUN_CONTEXT', () => {
  const ctx = 'C:/data/scheduler/reports/t/r/run.json';
  const shell = buildSpawnSpec({ type: 'shell', command: 'echo' }, { cwd: 'C:/p', runContextPath: ctx });
  assert.equal(shell.env.DEVFLOW_RUN_CONTEXT, ctx);

  const script = buildSpawnSpec({ type: 'script', script: { path: 'x.ps1' } }, { cwd: 'C:/p', runContextPath: ctx });
  assert.equal(script.env.DEVFLOW_RUN_CONTEXT, ctx);

  const ai = buildSpawnSpec({ type: 'ai', ai: { source: 'prompt', prompt: 'x' } }, { cwd: 'C:/p', runContextPath: ctx });
  assert.equal(ai.env.DEVFLOW_RUN_CONTEXT, ctx);
  assert.equal(ai.env.OPENCODE_SKIP_SAFE_CHECK, '1');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/scheduler-runner.test.js"`
Expected: FAIL（`Cannot read properties of undefined (reading 'DEVFLOW_RUN_CONTEXT')`）。

- [ ] **Step 3: 实现注入**

`server/scheduler/runner.js` 的 `buildSpawnSpec` 参数加 `runContextPath = null`：

```js
export function buildSpawnSpec(task, { cwd, aiBin = 'opencode', aiPrompt = null, opencodeDataDir = null, runContextPath = null } = {}) {
```

函数内先定义合并助手：

```js
  const withContext = (spec) => {
    if (!runContextPath) return spec;
    return { ...spec, env: { ...(spec.env || {}), DEVFLOW_RUN_CONTEXT: runContextPath } };
  };
```

把四个 `return` 包上 `withContext(...)`：shell、ai 的三个分支、script 的四个分支。例如：

```js
  if (task.type === 'shell') {
    if (process.platform === 'win32') return withContext({ bin: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', task.command], cwd });
    return withContext({ bin: '/bin/sh', args: ['-c', task.command], cwd });
  }
```

AI 分支示例：

```js
      return withContext({ bin: aiBin, args: ['run', '--command', name], cwd, env: ocEnv });
```

脚本分支全部改成 `return withContext({ ... })`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/scheduler-runner.test.js"`
Expected: PASS（原有断言仍通过）。

- [ ] **Step 5: Commit**

```powershell
git add server/scheduler/runner.js server/test/scheduler-runner.test.js
git commit -m "feat(scheduler): 任务启动注入运行上下文"
```

---

## Task 5: 会话环境透传与 workflow 任务

**Files:**
- Modify: `server/session-manager.js:22-34`
- Modify: `server/pty-runner.js:24-31`
- Modify: `server/scheduler/workflow-executor.js:19-40`
- Test: `server/test/session-manager.test.js`
- Test: `server/test/scheduler-workflow-executor.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/session-manager.test.js` 末尾追加（并把顶部导入改为同时引入 `makeFakePty`）：

```js
import { makeFakePty, makeFakePtyFactory } from './helpers/fake-pty.js';
```

```js
test('create 把 env 透传给 ptyFactory', async () => {
  const seen = [];
  const sm = new SessionManager({ ptyFactory: async (opts) => { seen.push(opts); return makeFakePty(); } });
  await sm.create({ env: { DEVFLOW_RUN_CONTEXT: 'C:/ctx.json' } });
  assert.deepEqual(seen[0].env, { DEVFLOW_RUN_CONTEXT: 'C:/ctx.json' });
});
```

在 `server/test/scheduler-workflow-executor.test.js` 的成功用例中，给 `executor.start` 传 `runContextPath` 并断言：

```js
  const handle = executor.start({ task, runId: 'r1', logFile, runContextPath: 'C:/ctx.json', onStatus: (s) => statuses.push(s) });
  await tick();
  assert.equal(created[0].env.DEVFLOW_RUN_CONTEXT, 'C:/ctx.json');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/session-manager.test.js" "server/test/scheduler-workflow-executor.test.js"`
Expected: FAIL（env 未透传 / `created[0].env` 为 undefined）。

- [ ] **Step 3: 实现 session/pty env**

`server/session-manager.js` 的 `create` 参数加 `env = null`，并传给 ptyFactory：

```js
  async create({ projectId = null, cwd = null, name = null, cols = 80, rows = 24,
                 id = null, kind = 'shell', agentId = null, agentCmd = null,
                 createdAt = null, replay = null, env = null } = {}) {
```

```js
    const pty = await this.ptyFactory({ cwd: workdir, cols, rows, env });
```

`server/pty-runner.js` 的 `createPty` 支持 env：

```js
export async function createPty({ cwd = process.cwd(), cols = 80, rows = 24, env = null } = {}) {
  const { spawn } = await import('node-pty');
  const shell = pickShell();
  const raw = spawn(shell.file, shell.args, {
    name: 'xterm-256color', cols, rows, cwd,
    env: withAgentEnv(env ? { ...process.env, ...env } : process.env),
  });
  return makePseudoPty(raw, process.platform === 'win32' ? 'win' : 'unix');
}
```

`server/scheduler/workflow-executor.js` 的 `start` 参数加 `runContextPath = null`，创建会话时注入：

```js
  function start({ task, runId, logFile, runContextPath = null, onStatus = () => {} }) {
```

```js
    sessionManager.create({
      projectId: task.projectId || null,
      cwd: task.cwd || null,
      kind: 'agent',
      agentId: agent.id,
      agentCmd: agent.cmd,
      name: t('sched.wf.session_name', { name: task.name, time: timeLabel() }),
      env: runContextPath ? { DEVFLOW_RUN_CONTEXT: runContextPath } : null,
    }).then((session) => {
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/session-manager.test.js" "server/test/scheduler-workflow-executor.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add server/session-manager.js server/pty-runner.js server/scheduler/workflow-executor.js server/test/session-manager.test.js server/test/scheduler-workflow-executor.test.js
git commit -m "feat(scheduler): workflow 会话透传运行上下文"
```

---

## Task 6: Engine 创建上下文、归档报告

**Files:**
- Modify: `server/scheduler/engine.js`
- Test: `server/test/scheduler-engine.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/scheduler-engine.test.js` 的 `fakeRunner` 中支持 `onSpawn` 与退出码：

```js
function fakeRunner(onSpawn) {
  const calls = [];
  const pending = [];
  let running = 0;
  return {
    calls,
    run(args) {
      calls.push(args);
      running += 1;
      onSpawn?.(args);
      return new Promise((resolve) => pending.push((code = 0) => {
        running -= 1;
        const res = { exitCode: code, timedOut: false, durationMs: 1 };
        args.onExit?.(res);
        resolve(res);
      }));
    },
    stop() { return true; },
    isRunning() { return true; },
    count() { return running; },
    finishAll(code = 0) { while (pending.length) pending.shift()(code); },
  };
}
```

在文件末尾追加测试：

```js
test('运行前写 run.json 并注入 DEVFLOW_RUN_CONTEXT；成功后归档任务报告', async () => {
  const dir = tmpDir();
  const store = new SchedulerStore({ dir });
  const runner = fakeRunner((args) => {
    const ctx = JSON.parse(fs.readFileSync(args.spec.env.DEVFLOW_RUN_CONTEXT, 'utf8'));
    assert.equal(ctx.runId, args.runId);
    assert.equal(ctx.taskId, store.listTasks()[0].id);
    fs.writeFileSync(ctx.reportPath, '# 扫描报告\n\n全部通过');
  });
  const { task } = store.createTask(task());
  const engine = createEngine({ store, runner, now: () => 1000 });
  const r = engine.manualRun(task.id);
  runner.finishAll(0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const run = store.getRun(r.run.id);
  assert.equal(run.status, 'success');
  assert.equal(run.reportFile, store.reportFileFor(task.id, r.run.id));
  assert.match(fs.readFileSync(store.reportPath(run.reportFile), 'utf8'), /扫描报告/);
});

test('失败时生成兜底报告并去掉 ANSI', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const runner = fakeRunner((args) => {
    fs.mkdirSync(path.dirname(args.logPath), { recursive: true });
    fs.writeFileSync(args.logPath, '\u001b[31mboom\u001b[0m');
  });
  const { task } = store.createTask(task());
  const engine = createEngine({ store, runner, now: () => 1000 });
  const r = engine.manualRun(task.id);
  runner.finishAll(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const run = store.getRun(r.run.id);
  assert.equal(run.status, 'failed');
  assert.ok(run.reportFile);
  const text = fs.readFileSync(store.reportPath(run.reportFile), 'utf8');
  assert.match(text, /失败/);
  assert.match(text, /boom/);
  assert.equal(text.includes('\u001b'), false);
});

test('workflow 任务拿到 runContextPath，结束后生成兜底报告', async () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const executor = fakeExecutor();
  const engine = createEngine({ store, runner: fakeRunner(), workflowExecutor: executor, now: () => 1000 });
  const { task } = store.createTask(wfTask());
  const r = engine.manualRun(task.id);
  assert.ok(executor.calls[0].runContextPath);
  const ctx = JSON.parse(fs.readFileSync(executor.calls[0].runContextPath, 'utf8'));
  assert.equal(ctx.runId, r.run.id);
  executor.handles.get(r.run.id).emit({ status: 'success', sessionId: 's1' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const run = store.getRun(r.run.id);
  assert.ok(run.reportFile);
  assert.match(fs.readFileSync(store.reportPath(run.reportFile), 'utf8'), /成功/);
});

test('executor 不可用时立即失败也有报告', () => {
  const store = new SchedulerStore({ dir: tmpDir() });
  const engine = createEngine({ store, runner: fakeRunner(), now: () => 1000 });
  const { task } = store.createTask(wfTask());
  const r = engine.manualRun(task.id);
  const run = store.getRun(r.run.id);
  assert.equal(run.status, 'failed');
  assert.ok(run.reportFile);
  assert.ok(fs.existsSync(store.reportPath(run.reportFile)));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/scheduler-engine.test.js"`
Expected: FAIL（未生成 run.json / `reportFile` 为空）。

- [ ] **Step 3: 实现 engine 变更**

`server/scheduler/engine.js` 顶部加：

```js
import { writeRunContext, ensureReport } from './report.js';
```

`finishImmediate` 改为生成上下文与兜底报告：

```js
  function finishImmediate(task, trigger, message) {
    const id = runIdGen();
    const logFile = store.logFileFor(task.id, id);
    const run = { id, taskId: task.id, status: 'failed', trigger, startedAt: now(), finishedAt: now(), exitCode: null, durationMs: 0, logFile, error: message };
    store.addRun(run);
    let reportFile = null;
    try {
      writeRunContext({ store, task, run });
      reportFile = ensureReport({ store, task, run, result: { status: 'failed', error: message, exitCode: null, durationMs: 0 } });
    } catch (e) {
      logger.error('scheduler report failed', e);
    }
    const updated = store.updateRun(id, reportFile ? { reportFile } : {});
    emit('run-end', { run: { ...(updated || run) } });
    return updated || run;
  }
```

`startRun` 中，创建 `run` 并 `store.addRun` 之后改为：

```js
    store.addRun(run);
    let ctx;
    try {
      ctx = writeRunContext({ store, task, run });
    } catch (e) {
      let reportFile = null;
      try {
        reportFile = ensureReport({ store, task, run, result: { status: 'failed', error: String(e && e.message || e), durationMs: 0 } });
      } catch { /* ignore */ }
      const updated = store.updateRun(id, { status: 'failed', finishedAt: now(), durationMs: 0, error: String(e && e.message || e), reportFile });
      emit('run-end', { run: { ...(updated || run) } });
      return { run: { ...(updated || run) } };
    }
    taskRuns.set(task.id, id);
    emit('run-start', { run: { ...run } });
    runner.run({ runId: id, spec, logPath: store.logPath(logFile), timeoutMs: timeoutFor(task) })
```

`buildSpawnSpec` 调用加：

```js
      spec = buildSpawnSpec(task, { cwd, aiPrompt, aiBin, opencodeDataDir, runContextPath: ctx.contextPath });
```

`complete` 改为先归档报告：

```js
  function complete(task, id, status, res) {
    taskRuns.delete(task.id);
    const cur = store.getRun(id) || { id, taskId: task.id, logFile: store.logFileFor(task.id, id), startedAt: now(), trigger: 'schedule' };
    let reportFile = null;
    try {
      reportFile = ensureReport({ store, task, run: cur, result: { ...res, status } });
    } catch (e) {
      logger.error('scheduler report failed', e);
    }
    const patch = { status, finishedAt: now(), exitCode: res.exitCode ?? null, durationMs: res.durationMs ?? null, error: res.error || null };
    if (reportFile) patch.reportFile = reportFile;
    const run = store.updateRun(id, patch);
    const fresh = store.getTask(task.id);
    if (fresh) scheduleTask(fresh, now());
    emit('run-end', { run: run ? { ...run } : { id, taskId: task.id, ...patch } });
  }
```

`startWorkflowRun` 中，创建 run 并 `store.addRun(run)` 后加：

```js
    let ctx;
    try {
      ctx = writeRunContext({ store, task, run });
    } catch (e) {
      const finishFail = () => {
        let reportFile = null;
        try { reportFile = ensureReport({ store, task, run, result: { status: 'failed', error: String(e && e.message || e), durationMs: 0 } }); } catch { /* ignore */ }
        const updated = store.updateRun(id, { status: 'failed', finishedAt: now(), durationMs: 0, error: String(e && e.message || e), reportFile });
        emit('run-end', { run: { ...(updated || run) } });
      };
      finishFail();
      return { run: { ...store.getRun(id) } };
    }
```

`finish` 内，在 `updateRun` 前归档报告：

```js
    const finish = (status, extra = {}) => {
      const cur = activeWorkflow.get(task.id);
      if (!cur || cur.runId !== id) return;
      activeWorkflow.delete(task.id);
      taskRuns.delete(task.id);
      let reportFile = null;
      try {
        reportFile = ensureReport({ store, task, run: store.getRun(id) || run, result: { status, ...extra } });
      } catch (e) { logger.error('scheduler report failed', e); }
      const patch = { status, finishedAt: now(), durationMs: now() - run.startedAt, ...extra };
      if (reportFile) patch.reportFile = reportFile;
      const updated = store.updateRun(id, patch);
      const fresh = store.getTask(task.id);
      if (fresh) scheduleTask(fresh, now());
      emit('run-end', { run: updated ? { ...updated } : { id, taskId: task.id, ...patch } });
    };
```

调用 executor 时传上下文：

```js
      handle = workflowExecutor.start({ task, runId: id, logFile, runContextPath: ctx.contextPath, onStatus });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/scheduler-engine.test.js" "server/test/scheduler-report.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add server/scheduler/engine.js server/test/scheduler-engine.test.js
git commit -m "feat(scheduler): 运行报告生成与归档"
```

---

## Task 7: HTTP 汇总与报告接口

**Files:**
- Modify: `server/scheduler/http-mount.js`
- Test: `server/test/scheduler-http.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/scheduler-http.test.js` 末尾追加：

```js
test('GET /summary 返回成功/失败/运行中总数', async () => {
  const { mount, store } = setup();
  store.addRun({ id: 'r1', taskId: 't1', status: 'success' });
  store.addRun({ id: 'r2', taskId: 't1', status: 'failed' });
  store.addRun({ id: 'r3', taskId: 't1', status: 'timeout' });
  store.addRun({ id: 'r4', taskId: 't1', status: 'running' });
  const res = await call(mount, 'GET', '/api/scheduler/summary');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { total: 4, success: 1, failed: 2, running: 1 });
});

test('GET /runs/:id/report 返回 Markdown', async () => {
  const { mount, store } = setup();
  const reportFile = store.reportFileFor('t1', 'r1');
  fs.mkdirSync(path.dirname(store.reportPath(reportFile)), { recursive: true });
  fs.writeFileSync(store.reportPath(reportFile), '# 报告\n\nok');
  store.addRun({ id: 'r1', taskId: 't1', status: 'success', reportFile });
  const res = await call(mount, 'GET', '/api/scheduler/runs/r1/report');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.equal(res.body, '# 报告\n\nok');
});

test('GET /runs/:id/report 对旧记录即时兜底', async () => {
  const { mount, store } = setup();
  store.addRun({ id: 'r2', taskId: 't1', status: 'failed', error: 'x' });
  const res = await call(mount, 'GET', '/api/scheduler/runs/r2/report');
  assert.equal(res.status, 200);
  assert.match(res.body, /# t1/);
  assert.match(res.body, /失败/);
});

test('GET /runs 不传 limit 返回全部', async () => {
  const { mount, store } = setup();
  for (let i = 0; i < 60; i += 1) store.addRun({ id: `r${i}`, taskId: 't1', status: 'success' });
  const res = await call(mount, 'GET', '/api/scheduler/runs?taskId=t1');
  assert.equal(JSON.parse(res.body).runs.length, 60);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/scheduler-http.test.js"`
Expected: FAIL（summary 404 / report 404 / runs 只有 50 条）。

- [ ] **Step 3: 实现 HTTP 变更**

`server/scheduler/http-mount.js` 顶部加：

```js
import { legacyReport } from './report.js';
import { t } from '../i18n.js';

const REPORT_MAX = 2 * 1024 * 1024;
```

在 `/api/scheduler/runs` 处理前加 summary：

```js
      if (p === '/api/scheduler/summary' && req.method === 'GET') {
        return sendJson(res, 200, store.summary());
      }
```

`/api/scheduler/runs` 改为：

```js
      if (p === '/api/scheduler/runs' && req.method === 'GET') {
        const taskId = url.searchParams.get('taskId');
        const rawLimit = url.searchParams.get('limit');
        const limit = rawLimit == null ? null : Number(rawLimit);
        return sendJson(res, 200, { runs: store.listRuns({ taskId, limit }) });
      }
```

在 log 路由前加报告路由：

```js
      const rep = p.match(/^\/api\/scheduler\/runs\/([^/]+)\/report$/);
      if (rep && req.method === 'GET') {
        const run = store.getRun(decodeURIComponent(rep[1]));
        if (!run) return sendJson(res, 404, { error: 'not-found' });
        let text = '';
        if (run.reportFile) {
          try { text = fs.readFileSync(store.reportPath(run.reportFile), 'utf8'); } catch { /* missing */ }
        }
        if (!text) text = legacyReport({ store, run, task: store.getTask(run.taskId) });
        if (text.length > REPORT_MAX) text = text.slice(0, REPORT_MAX) + `\n\n---\n\n${t('sched.report.truncated')}`;
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(text);
      }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/scheduler-http.test.js"`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add server/scheduler/http-mount.js server/test/scheduler-http.test.js
git commit -m "feat(scheduler): 报告与汇总 HTTP 接口"
```

---

## Task 8: 前端 useScheduler 支持 summary / report

**Files:**
- Modify: `web/src/scheduler/useScheduler.ts`
- Test: `web/src/scheduler/useScheduler.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/scheduler/useScheduler.test.ts` 的 fetch stub 中补 summary 分支：

```ts
    if (url === '/api/scheduler/summary') {
      return { ok: true, text: async () => JSON.stringify({ total: 3, success: 2, failed: 1, running: 0 }) } as any;
    }
```

在 describe 末尾追加：

```ts
  it('loadSummary 写入 state.summary', async () => {
    const s = useScheduler();
    await s.loadSummary();
    expect(s.state.summary).toEqual({ total: 3, success: 2, failed: 1, running: 0 });
  });

  it('loadReport 返回 Markdown 文本', async () => {
    const s = useScheduler();
    expect(await s.loadReport('r1')).toBe('{}');
    expect(calls.some((c) => c.url === '/api/scheduler/runs/r1/report')).toBe(true);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test --run src/scheduler/useScheduler.test.ts`
Expected: FAIL（`loadSummary is not a function`）。

- [ ] **Step 3: 实现**

`web/src/scheduler/useScheduler.ts` 顶部类型导入加：

```ts
import type { SchedulerTask, SchedulerRun, SchedulerSummary } from '@devflow/shared/scheduler';
```

`state` 加：

```ts
    summary: { total: 0, success: 0, failed: 0, running: 0 } as SchedulerSummary,
```

`refresh` 中在 `state.tasks = d.tasks || [];` 后加：

```ts
      void loadSummary();
```

新增函数：

```ts
  async function loadSummary() {
    try {
      const d = await api('GET', '/api/scheduler/summary');
      state.summary = { total: d.total || 0, success: d.success || 0, failed: d.failed || 0, running: d.running || 0 };
    } catch { /* 汇总失败不影响任务列表 */ }
  }
```

`loadLog` 后加：

```ts
  async function loadReport(runId: string): Promise<string> {
    const res = await fetch(`/api/scheduler/runs/${encodeURIComponent(runId)}/report`);
    return res.ok ? res.text() : '';
  }
```

返回对象加 `loadSummary, loadReport`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test --run src/scheduler/useScheduler.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/scheduler/useScheduler.ts web/src/scheduler/useScheduler.test.ts
git commit -m "feat(scheduler): 前端汇总与报告数据层"
```

---

## Task 9: 任务详情报告组件

**Files:**
- Create: `web/src/scheduler/SchedulerReportView.vue`
- Test: `web/src/scheduler/SchedulerReportView.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/scheduler/SchedulerReportView.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import SchedulerReportView from './SchedulerReportView.vue';

const task = { id: 't1', name: 'scan', enabled: true, type: 'shell', schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } } } as any;
const runs = [
  { id: 'r1', taskId: 't1', status: 'success', trigger: 'manual', startedAt: 1, durationMs: 5, logFile: 'a', reportFile: 'x' },
  { id: 'r2', taskId: 't1', status: 'failed', trigger: 'schedule', startedAt: 2, durationMs: 7, logFile: 'b', reportFile: 'y' },
];

function mountView(over = {}) {
  return mountC(SchedulerReportView, {
    props: {
      task,
      loadRuns: vi.fn(async () => runs),
      loadReport: vi.fn(async (id: string) => (id === 'r1' ? '# 报告一' : '# 报告二')),
      loadLog: vi.fn(async () => 'raw log'),
      onBack: vi.fn(),
      ...over,
    },
  });
}

describe('SchedulerReportView', () => {
  it('加载历史报告并默认渲染第一条 Markdown', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.findAll('.report-item').length).toBe(2);
    expect(w.find('.md-body').html()).toContain('<h1>报告一</h1>');
  });

  it('切换运行与原始日志', async () => {
    const w = mountView();
    await flushPromises();
    await w.findAll('.report-item')[1].trigger('click');
    await flushPromises();
    expect(w.find('.md-body').html()).toContain('<h1>报告二</h1>');
    await w.find('.raw-tab').trigger('click');
    await flushPromises();
    expect(w.find('.raw-log').text()).toBe('raw log');
  });

  it('空历史显示空状态', async () => {
    const w = mountView({ loadRuns: vi.fn(async () => []) });
    await flushPromises();
    expect(w.find('.rv-empty').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test --run src/scheduler/SchedulerReportView.test.ts`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现组件**

创建 `web/src/scheduler/SchedulerReportView.vue`：

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { SchedulerRun } from '@devflow/shared/scheduler';
import type { TaskView } from './useScheduler';
import { formatTime, runStatusLabel } from './format';
import { renderRemoteMarkdown } from '../markdown';

const props = defineProps<{
  task: TaskView;
  loadRuns: (taskId: string) => Promise<SchedulerRun[]>;
  loadReport: (runId: string) => Promise<string>;
  loadLog: (runId: string) => Promise<string>;
  onBack: () => void;
  onOpenSession?: (sessionId: string) => void;
}>();

const runs = ref<SchedulerRun[]>([]);
const activeId = ref('');
const report = ref('');
const logText = ref('');
const mode = ref<'report' | 'raw'>('report');
let timer: ReturnType<typeof setInterval> | null = null;

const activeRun = computed(() => runs.value.find((r) => r.id === activeId.value) || null);
const reportHtml = computed(() => (report.value ? renderRemoteMarkdown(report.value) : ''));
const hasRunning = computed(() => runs.value.some((r) => r.status === 'running' || r.status === 'paused'));

function statusClass(s: string) {
  if (s === 'success') return 'ok';
  if (s === 'failed' || s === 'timeout' || s === 'killed') return 'bad';
  return 'run';
}

async function selectRun(id: string) {
  activeId.value = id;
  report.value = await props.loadReport(id);
  logText.value = '';
  if (mode.value === 'raw') logText.value = await props.loadLog(id);
}

async function refreshRuns() {
  runs.value = await props.loadRuns(props.task.id);
  if (!activeId.value && runs.value.length) await selectRun(runs.value[0].id);
  else if (activeId.value) await selectRun(activeId.value);
}

async function setMode(m: 'report' | 'raw') {
  mode.value = m;
  if (m === 'raw' && activeId.value && !logText.value) logText.value = await props.loadLog(activeId.value);
}

onMounted(async () => {
  await refreshRuns();
  timer = setInterval(() => { if (hasRunning.value) void refreshRuns(); }, 2000);
});
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="report-view">
    <header class="rv-head">
      <button class="rv-back" @click="onBack">← {{ $t('sched.detail.back') }}</button>
      <span class="rv-title">{{ task.name }}</span>
      <span v-if="activeRun" class="rv-meta">{{ runStatusLabel(activeRun.status) }} · {{ formatTime(activeRun.startedAt) }}</span>
      <button v-if="activeRun?.sessionId" class="rv-session" @click="onOpenSession?.(activeRun.sessionId || '')">{{ $t('sched.open_session') }}</button>
    </header>
    <div class="rv-body">
      <div class="rv-list">
        <div class="rv-list-title">{{ $t('sched.detail.runs') }}</div>
        <button
          v-for="r in runs"
          :key="r.id"
          class="report-item"
          :class="{ on: r.id === activeId }"
          @click="selectRun(r.id)"
        >
          <span class="status-dot" :class="statusClass(r.status)" />
          <span class="ri-time">{{ formatTime(r.startedAt) }}</span>
          <span class="ri-status">{{ runStatusLabel(r.status) }}</span>
          <span class="ri-dur">{{ r.durationMs == null ? '—' : `${r.durationMs}ms` }}</span>
        </button>
        <div v-if="!runs.length" class="rv-empty">{{ $t('sched.detail.empty') }}</div>
      </div>
      <div class="rv-main">
        <div class="rv-tabs">
          <button :class="{ on: mode === 'report' }" @click="setMode('report')">{{ $t('sched.detail.report') }}</button>
          <button class="raw-tab" :class="{ on: mode === 'raw' }" @click="setMode('raw')">{{ $t('sched.detail.raw_log') }}</button>
        </div>
        <div v-if="mode === 'report'" class="md-body" v-html="reportHtml" />
        <pre v-else class="raw-log">{{ logText }}</pre>
        <div v-if="mode === 'report' && !report" class="rv-empty">{{ $t('sched.report.empty') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.report-view { display: flex; flex-direction: column; height: 100%; background: var(--bg0, var(--bg1)); }
.rv-head { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border-bottom: 1px solid var(--bd); }
.rv-back, .rv-session { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.rv-title { font-weight: 700; color: var(--tx1); }
.rv-meta { color: var(--tx5); font-size: 12px; }
.rv-body { flex: 1; display: flex; min-height: 0; }
.rv-list { width: 300px; flex: none; border-right: 1px solid var(--bd); overflow: auto; padding: 8px; }
.rv-list-title { color: var(--tx5); font-size: 11px; padding: 2px 6px 6px; }
.report-item { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; border-radius: 4px; color: var(--tx2); padding: 6px; cursor: pointer; font-size: 12px; text-align: left; }
.report-item:hover, .report-item.on { background: var(--bg5, var(--bg4)); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--tx5); }
.status-dot.ok { background: #3fb950; }
.status-dot.bad { background: #e5534b; }
.status-dot.run { background: var(--ac2); }
.ri-time { flex: 1; }
.ri-status { color: var(--tx4); }
.ri-dur { color: var(--tx5); }
.rv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.rv-tabs { display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--bd); }
.rv-tabs button { background: var(--bg5, var(--bg4)); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.rv-tabs button.on { background: var(--ac2); color: #fff; }
.md-body { flex: 1; overflow: auto; padding: 12px 16px; color: var(--tx); }
.raw-log { flex: 1; margin: 0; overflow: auto; padding: 12px; background: var(--bg6, var(--bg1)); color: var(--tx2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; white-space: pre-wrap; }
.rv-empty { color: var(--tx5); padding: 24px; text-align: center; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test --run src/scheduler/SchedulerReportView.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/scheduler/SchedulerReportView.vue web/src/scheduler/SchedulerReportView.test.ts
git commit -m "feat(scheduler): 任务历史报告详情组件"
```

---

## Task 10: 汇总页与详情页接线

**Files:**
- Modify: `web/src/scheduler/SchedulerView.vue`
- Test: `web/src/scheduler/SchedulerView.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/scheduler/SchedulerView.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import SchedulerView from './SchedulerView.vue';

function ok(data: unknown) { return { ok: true, text: async () => JSON.stringify(data) } as any; }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/scheduler/tasks') return ok({ tasks: [{ id: 't1', name: 'scan', enabled: true, type: 'shell', schedule: { mode: 'interval', interval: { every: 1, unit: 'hour' } } }] });
    if (url === '/api/scheduler/summary') return ok({ total: 3, success: 2, failed: 1, running: 0 });
    if (String(url).startsWith('/api/scheduler/runs?')) return ok({ runs: [] });
    if (String(url).endsWith('/report')) return { ok: true, text: async () => '# 报告' } as any;
    return ok({});
  }));
});

describe('SchedulerView', () => {
  it('顶部显示总成功/总失败，点任务进入详情', async () => {
    const w = mountC(SchedulerView, { props: { terminal: { on: () => () => {} } } });
    await flushPromises();
    expect(w.find('.sum-success .num').text()).toBe('2');
    expect(w.find('.sum-failed .num').text()).toBe('1');
    await w.find('.row').trigger('click');
    await flushPromises();
    expect(w.find('.report-view').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test --run src/scheduler/SchedulerView.test.ts`
Expected: FAIL（无统计节点 / 点击不进详情）。

- [ ] **Step 3: 修改 SchedulerView**

`<script setup>`：
- 导入详情组件：

```ts
import SchedulerReportView from './SchedulerReportView.vue';
```

- 删除 `runs` 弹窗相关状态：`runs`、`runsTaskId`、`logText`、`logRunId`、`logTimer`、`currentRun`、`openRuns`、`openLog`、`startLogTimer`、`stopLogTimer`、`closeRuns`。
- 新增：

```ts
const detailTask = ref<TaskView | null>(null);
function openDetail(t: TaskView) { detailTask.value = t; }
```

- `remove` 后关闭详情：

```ts
async function remove(task: TaskView) {
  if (!confirm(t('sched.remove_confirm', { name: task.name }))) return;
  await sched.removeTask(task.id);
  if (detailTask.value?.id === task.id) detailTask.value = null;
}
```

- `onBeforeUnmount` 去掉 `stopLogTimer()`。
- 模板最外层 `.sched` 内改成：

```vue
    <template v-if="!detailTask">
      <header class="bar">...原样保留...</header>
      <div class="body">
        <div class="summary">
          <div class="sum-card sum-success"><span class="num">{{ sched.state.summary.success }}</span><span>{{ $t('sched.summary.success') }}</span></div>
          <div class="sum-card sum-failed"><span class="num">{{ sched.state.summary.failed }}</span><span>{{ $t('sched.summary.failed') }}</span></div>
          <div class="sum-card sum-running"><span class="num">{{ sched.state.summary.running }}</span><span>{{ $t('sched.summary.running') }}</span></div>
          <div class="sum-card sum-total"><span class="num">{{ sched.state.summary.total }}</span><span>{{ $t('sched.summary.total') }}</span></div>
        </div>
        <div class="list">...原任务列表...</div>
      </div>
      ...原编辑器/导入弹窗...
    </template>
    <SchedulerReportView
      v-else-if="detailTask"
      :task="detailTask"
      :load-runs="sched.loadRuns"
      :load-report="sched.loadReport"
      :load-log="sched.loadLog"
      :on-back="() => (detailTask = null)"
      :on-open-session="props.onOpenSession"
    />
```

- 任务行加点击：

```vue
        <div v-for="t in state.tasks" :key="t.id" class="row" @click="openDetail(t)">
```

- 所有行内按钮加 `.stop`，例如：

```vue
            <button v-if="t.enabled" @click.stop="toggle(t)">{{ $t('sched.pause') }}</button>
            <button v-else @click.stop="toggle(t)">{{ $t('sched.start') }}</button>
            <button v-if="!isRunning(t)" @click.stop="runNow(t)">{{ $t('sched.run') }}</button>
            <button v-else-if="t.runningRunId" @click.stop="stop(t)">{{ $t('sched.stop') }}</button>
            <button v-if="t.type === 'workflow'" @click.stop="openWfRun(t)">{{ $t('sched.wf.open') }}</button>
            <button @click.stop="openDetail(t)">{{ $t('sched.history') }}</button>
            <button @click.stop="openEdit(t)">{{ $t('sched.edit') }}</button>
            <button @click.stop="remove(t)">{{ $t('sched.delete') }}</button>
```

- 删除原「运行历史」弹窗（`v-if="runsTaskId"` 的 `.overlay`）。
- 样式追加：

```css
.summary { display: flex; gap: 8px; margin-bottom: 10px; }
.sum-card { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg1); color: var(--tx5); font-size: 12px; }
.sum-card .num { font-size: 22px; font-weight: 700; color: var(--tx1); }
.sum-success .num { color: #3fb950; }
.sum-failed .num { color: #e5534b; }
.sum-running .num { color: var(--ac2); }
.row { cursor: pointer; }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test --run src/scheduler/SchedulerView.test.ts src/scheduler/SchedulerReportView.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/scheduler/SchedulerView.vue web/src/scheduler/SchedulerView.test.ts
git commit -m "feat(scheduler): 汇总统计与任务报告详情页"
```

---

## Task 11: 文档与全量验证

**Files:**
- Modify: `AGENTS.md`（目录速览补一行）
- Test: `npm.cmd test`
- Test: `npm.cmd run typecheck`
- Test: `npm.cmd run check:i18n`

- [ ] **Step 1: 更新 AGENTS 目录速览**

在 `AGENTS.md` 与协作/定时任务相关的目录说明处补一行：

```md
- 定时任务报告：`server/scheduler/report.js`（运行上下文 `run.json`、兜底报告）+ `web/src/scheduler/SchedulerReportView.vue`（任务详情 + 历史 Markdown 报告）；每次运行通过 `DEVFLOW_RUN_CONTEXT` 注入运行上下文路径。
```

- [ ] **Step 2: 跑服务端全量测试**

Run: `npm.cmd run test:server`
Expected: PASS（全部 server test）。

- [ ] **Step 3: 跑前端全量测试**

Run: `npm.cmd run test:web`
Expected: PASS（全部 web test）。

- [ ] **Step 4: 跑类型检查和 i18n**

Run: `npm.cmd run typecheck`
Expected: PASS（无 TS 错误）。

Run: `npm.cmd run check:i18n`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add AGENTS.md
git commit -m "docs(scheduler): 运行报告目录说明"
```

---

## Self-Review Record

- Spec coverage：每次运行的 `run.json`、`report.md`、`DEVFLOW_RUN_CONTEXT`、成功/失败兜底报告（Task 3/4/6）、summary 与 report API（Task 7）、汇总页与详情页（Task 9/10）、保留策略与删除（Task 2）、i18n（Task 1）、测试（各任务）均有对应任务。
- 类型一致性：`SchedulerRun.reportFile`、`SchedulerSummary`、`SchedulerRunContext` 在 Task 1 定义，后续任务按同名使用；`store.reportFileFor/contextFileFor/reportPath` 在 Task 2 定义，Task 3/7 使用。
- 无占位符：所有步骤包含实际代码或命令。
