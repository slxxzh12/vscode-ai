# 用量采集文件化 + 趋势图 K/M 单位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用量采集命令后台运行、输出原子落盘 `stats.txt`、下次读文件上报，并让趋势图纵轴/tooltip 用 K/M 显示。

**Architecture:** 采集拆成「生产-消费」两段：`readStatsFile()` 同步读文件解析（消费），`refreshStatsOutput()` 后台 spawn 命令写 `.tmp` 再原子改名（生产）。`usage-report.js` 的 `reportNow` 默认走这条链路（claude 系除外，仍本机日志同步解析）。前端 `UsageTrendChart.vue` 复用 `fmtNum` 格式化。

**Tech Stack:** Node ESM（`node --test`）、Vue 3 + Vitest/happy-dom、ECharts（测试中 mock）。

**Spec:** `docs/superpowers/specs/2026-09-29-usage-stats-file-pipeline-design.md`

---

## File Structure

- Modify: `server/collaboration/agent-stats.js` — `parseStats` 末尾解析；新增 `readStatsFile`、`refreshStatsOutput`。
- Modify: `server/test/agent-stats.test.js` — 三个新函数的测试。
- Modify: `server/usage-report.js` — `reportNow` 默认走文件链路；新增 `readStats`/`refresh` 注入项；`no-data` 跳过上报。
- Modify: `server/test/usage-report.test.js` — 文件链路测试。
- Modify: `web/src/collaboration/UsageTrendChart.vue` — 纵轴/tooltip K/M。
- Create: `web/src/collaboration/UsageTrendChart.test.ts` — 格式化测试。

---

### Task 1: `parseStats` 末尾解析

**Files:**
- Modify: `server/collaboration/agent-stats.js:185-201`
- Test: `server/test/agent-stats.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/agent-stats.test.js` 的 `parseStats 提取关键字段` 用例后追加：

```js
test('parseStats：取最后一次出现的指标，忽略前面的噪音与旧值', () => {
  const noisy = ['error: stats failed', 'Messages 1', 'Sessions 2', 'Total Cost $9.99', SAMPLE].join('\n');
  const s = parseStats(noisy);
  assert.equal(s.sessions, 21, '取末尾 SAMPLE 里的 21，而不是前面的 2');
  assert.equal(s.messages, 3986);
  assert.equal(s.totalCost, 4.83);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/agent-stats.test.js"`
Expected: FAIL —— `sessions` 为 2（首个匹配）。

- [ ] **Step 3: 实现末尾匹配**

把 `server/collaboration/agent-stats.js` 的 `parseStats` 中 `grab` 改为全局匹配取最后一个：

```js
export function parseStats(text) {
  const t = stripAnsi(text || '');
  const grab = (label) => {
    const re = new RegExp(label + '\\s+\\$?([\\d.,]+\\s*[KMBT]?)', 'gi');
    let m;
    let last = null;
    while ((m = re.exec(t)) !== null) last = m[1];
    return last == null ? null : parseNum(last);
  };
  return {
    sessions: grab('Sessions'),
    messages: grab('Messages'),
    days: grab('Days'),
    totalCost: grab('Total Cost'),
    input: grab('Input'),
    output: grab('Output'),
    cacheRead: grab('Cache Read'),
    cacheWrite: grab('Cache Write'),
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/agent-stats.test.js"`
Expected: PASS（含原 `parseStats 提取关键字段`）。

- [ ] **Step 5: 提交**

```bash
git add server/collaboration/agent-stats.js server/test/agent-stats.test.js
git commit -m "feat(usage): parseStats 取末尾指标，忽略前置噪音"
```

---

### Task 2: `readStatsFile`

**Files:**
- Modify: `server/collaboration/agent-stats.js`（`parseStats` 之后新增导出）
- Test: `server/test/agent-stats.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/agent-stats.test.js` 文件末尾追加：

```js
import { readStatsFile } from '../collaboration/agent-stats.js';

test('readStatsFile：存在返回 raw/mtime/parsed；不存在 exists=false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-read-'));
  const statsFile = path.join(dir, 'stats.txt');
  assert.equal(readStatsFile(statsFile).exists, false);
  fs.writeFileSync(statsFile, SAMPLE, 'utf8');
  const r = readStatsFile(statsFile);
  assert.equal(r.exists, true);
  assert.equal(r.raw, SAMPLE);
  assert.equal(r.parsed.sessions, 21);
  assert.ok(r.mtimeMs > 0);
});
```

同时把文件顶部 `import { ... } from '../collaboration/agent-stats.js';` 加上 `readStatsFile`。

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/agent-stats.test.js"`
Expected: FAIL —— `readStatsFile is not a function`。

- [ ] **Step 3: 实现**

在 `server/collaboration/agent-stats.js` 的 `parseStats` 之后新增：

```js
// 读采集结果文件：不存在或读失败返回 exists:false（不抛错）
export function readStatsFile(statsFile, { fsImpl = fs } = {}) {
  const empty = { exists: false, raw: '', mtimeMs: null, parsed: parseStats('') };
  if (!statsFile) return empty;
  try {
    const raw = fsImpl.readFileSync(statsFile, 'utf8');
    const mtimeMs = fsImpl.statSync(statsFile).mtimeMs;
    return { exists: true, raw, mtimeMs, parsed: parseStats(raw) };
  } catch {
    return empty;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/agent-stats.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/collaboration/agent-stats.js server/test/agent-stats.test.js
git commit -m "feat(usage): 新增 readStatsFile 读取采集结果文件"
```

---

### Task 3: `refreshStatsOutput`（后台刷新 + 原子落盘）

**Files:**
- Modify: `server/collaboration/agent-stats.js`（顶部 import 与追加导出）
- Test: `server/test/agent-stats.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/agent-stats.test.js` 末尾追加（顶部 import 加 `refreshStatsOutput`）：

```js
import { refreshStatsOutput } from '../collaboration/agent-stats.js';

function fakeChild() {
  const listeners = {};
  return { pid: 4321, listeners, on(ev, cb) { listeners[ev] = cb; return this; } };
}

test('refreshStatsOutput：输出写 tmp，close 后原子改名到 statsFile 并释放锁', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-refresh-'));
  const statsFile = path.join(dir, 'cache', 'collaboration', 'stats.txt');
  const tmp = `${statsFile}.tmp`;
  const child = fakeChild();
  let seenStdio = null;
  const lock = new Set();
  const r = refreshStatsOutput({
    cmd: 'opencode', env: { PATH: '' }, resolveCwd: () => '/git/root',
    statsFile, lock,
    spawnFn: (_bin, _args, opts) => { seenStdio = opts.stdio; fs.writeFileSync(tmp, SAMPLE, 'utf8'); return child; },
  });
  assert.equal(r.started, true);
  assert.equal(r.tmp, tmp);
  assert.equal(typeof seenStdio[1], 'number', 'stdout 直接指向文件 fd');
  assert.equal(lock.has(statsFile), true);
  child.listeners.close();
  assert.equal(fs.readFileSync(statsFile, 'utf8'), SAMPLE);
  assert.equal(fs.existsSync(tmp), false);
  assert.equal(lock.has(statsFile), false);
});

test('refreshStatsOutput：命令无输出则保留旧文件并删 tmp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-refresh-'));
  const statsFile = path.join(dir, 'stats.txt');
  fs.writeFileSync(statsFile, SAMPLE, 'utf8');
  const child = fakeChild();
  const r = refreshStatsOutput({
    cmd: 'opencode', env: { PATH: '' }, statsFile, lock: new Set(),
    spawnFn: () => child,
  });
  assert.equal(r.started, true);
  child.listeners.close();
  assert.equal(fs.readFileSync(statsFile, 'utf8'), SAMPLE);
  assert.equal(fs.existsSync(`${statsFile}.tmp`), false);
});

test('refreshStatsOutput：同一文件并发第二次跳过；无 statsFile 时 no-op', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-refresh-'));
  const statsFile = path.join(dir, 'stats.txt');
  const child = fakeChild();
  const lock = new Set();
  const spawnFn = () => child;
  const r1 = refreshStatsOutput({ cmd: 'opencode', env: { PATH: '' }, statsFile, lock, spawnFn });
  const r2 = refreshStatsOutput({ cmd: 'opencode', env: { PATH: '' }, statsFile, lock, spawnFn });
  assert.equal(r1.started, true);
  assert.deepEqual(r2, { started: false, reason: 'busy' });
  child.listeners.close();
  assert.deepEqual(refreshStatsOutput({ statsFile: null }), { started: false, reason: 'no-file' });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/agent-stats.test.js"`
Expected: FAIL —— `refreshStatsOutput is not a function`。

- [ ] **Step 3: 实现**

3a. 顶部 import 增加 `spawn`：

```js
import { execFile, spawn } from 'node:child_process';
```

3b. 在 `agent-stats.js` 内（`readStatsFile` 之后）新增模块级锁与函数：

```js
const refreshLocks = new Set();

// 后台刷新采集文件：不等待、不超时；stdout+stderr 写 <statsFile>.tmp，子进程 close 后原子改名。
// 同一 statsFile 已有刷新在跑时跳过（返回 started:false）。输出为空时不覆盖旧文件。
export function refreshStatsOutput({
  cmd = 'opencode', statsCmd = '', days = 60, env = process.env,
  cwd = null, resolveCwd = resolveStatsCwd, startDir = undefined, home = os.homedir(),
  statsFile = null, spawnFn = spawn, fsImpl = fs, lock = refreshLocks, onDone = null,
} = {}) {
  if (!statsFile) return { started: false, reason: 'no-file' };
  if (lock.has(statsFile)) return { started: false, reason: 'busy' };
  const spec = parseStatsCmd(statsCmd, days, { env })
    || { bin: resolveAgentBin(cmd, { env }), args: ['stats', '--days', String(days)] };
  const { bin, args } = wrapCmdBin(spec.bin, spec.args);
  const runCwd = cwd || resolveCwd({ startDir, home });
  const tmp = `${statsFile}.tmp`;
  let fd;
  try {
    fsImpl.mkdirSync(path.dirname(statsFile), { recursive: true });
    fd = fsImpl.openSync(tmp, 'w');
  } catch (e) {
    return { started: false, reason: 'open-failed', error: String((e && e.message) || e) };
  }
  let child;
  try {
    child = spawnFn(bin, args, { cwd: runCwd, windowsHide: true, env: withAgentEnv(env), stdio: ['ignore', fd, fd] });
  } catch (e) {
    try { fsImpl.closeSync(fd); } catch { /* ignore */ }
    return { started: false, reason: 'spawn-failed', error: String((e && e.message) || e) };
  }
  try { fsImpl.closeSync(fd); } catch { /* ignore */ }
  lock.add(statsFile);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    lock.delete(statsFile);
    let raw = '';
    try { raw = fsImpl.readFileSync(tmp, 'utf8'); } catch { raw = ''; }
    try {
      if (raw.trim()) fsImpl.renameSync(tmp, statsFile);
      else fsImpl.unlinkSync(tmp);
    } catch { /* ignore */ }
    try { onDone?.({ statsFile, ok: !!raw.trim() }); } catch { /* ignore */ }
  };
  if (typeof child.on === 'function') {
    child.on('close', finish);
    child.on('error', finish);
  } else {
    finish();
  }
  return { started: true, pid: child.pid, tmp };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/agent-stats.test.js"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/collaboration/agent-stats.js server/test/agent-stats.test.js
git commit -m "feat(usage): 后台刷新采集并原子落盘（不超时、不杀、并发去重）"
```

---

### Task 4: `usage-report` 走文件链路

**Files:**
- Modify: `server/usage-report.js`
- Test: `server/test/usage-report.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/usage-report.test.js` 末尾追加：

```js
test('reportNow：读 statsFile 解析上报，并触发一次后台刷新', async () => {
  const file = tmpFile();
  saveReportConfig(file, { masterUrl: 'http://h:22222', token: 'tk' });
  const refreshed = [];
  let wireBody = null;
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    statsFile: '/data/stats.txt',
    readStats: () => ({ exists: true, raw: 'RAW', mtimeMs: 123, parsed: { sessions: 5, messages: 50 } }),
    refresh: (args) => { refreshed.push(args); },
    fetchFn: async (_u, opts) => { wireBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true }) }; },
  });
  const out = await r.reportNow();
  assert.equal(out.ok, true);
  assert.equal(wireBody.usage.sessions, 5);
  assert.equal(wireBody.usage.raw, undefined);
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].statsFile, '/data/stats.txt');
});

test('reportNow：无 statsFile 数据时跳过上报但仍触发刷新', async () => {
  const file = tmpFile();
  saveReportConfig(file, { masterUrl: 'http://h:22222', token: 'tk' });
  let posted = 0;
  const refreshed = [];
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    statsFile: '/data/stats.txt',
    readStats: () => ({ exists: false, raw: '', mtimeMs: null, parsed: {} }),
    refresh: (args) => { refreshed.push(args); },
    fetchFn: async () => { posted += 1; return { ok: true, json: async () => ({ ok: true }) }; },
  });
  const out = await r.reportNow();
  assert.equal(out.ok, false);
  assert.equal(out.error, 'no-data');
  assert.equal(posted, 0);
  assert.equal(refreshed.length, 1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/usage-report.test.js"`
Expected: FAIL —— 首次上报走默认 `collectAgentStats` 会真去 spawn，断言不通过。

- [ ] **Step 3: 实现**

3a. import 增加：

```js
import { collectAgentStats, isClaudeFamily, readStatsFile, refreshStatsOutput } from './collaboration/agent-stats.js';
```

3b. `createUsageReporter` 参数：把 `collect = collectAgentStats` 改为 `collect = null`，并新增两项（在 `statsFile = null,` 之后）：

```js
  readStats = readStatsFile,   // 读采集结果文件
  refresh = refreshStatsOutput, // 后台刷新采集文件
```

3c. 在 `reportNow` 定义前，新增默认采集周期（claude 系走同步，其余读文件+刷新）：

```js
  // 默认采集周期：claude 系本机日志同步解析；其余读 stats.txt（消费）+ 触发后台刷新（生产）
  async function collectFromFile(args) {
    if (isClaudeFamily(args.cmd) && !String(args.statsCmd || '').trim()) return collectAgentStats(args);
    const snap = readStats(args.statsFile);
    try { refresh({ cmd: args.cmd, statsCmd: args.statsCmd, days: args.days, startDir: args.startDir, statsFile: args.statsFile }); }
    catch (e) { logger?.warn?.('usage refresh failed', (e && e.message) || e); }
    if (!snap.exists) return { agent: args.cmd, days: args.days, error: 'no-data', raw: '', statsFileMtime: snap.mtimeMs };
    return { agent: args.cmd, days: args.days, ...(snap.parsed || {}), raw: snap.raw, statsFileMtime: snap.mtimeMs };
  }
  const runCollect = typeof collect === 'function' ? collect : collectFromFile;
```

3d. `reportNow` 改用 `runCollect` 并在 `no-data` 时跳过上报：

```js
  async function reportNow() {
    const cfg = config();
    const a = currentAgent();
    let usage;
    try { usage = await runCollect({ cmd: a.cmd, statsCmd: a.statsCmd, days: cfg.days, startDir: (typeof getStartDir === 'function' ? getStartDir() : null) || undefined, statsFile }); }
    catch (e) { usage = { agent: a.cmd, days: cfg.days, error: String((e && e.message) || e) }; }
    // 本机缓存一份带原文的采集结果，供「采集信息」弹窗即时展示
    try { onCollected?.(usage); } catch (e) { logger?.warn?.('usage onCollected failed', (e && e.message) || e); }
    if (usage && usage.error === 'no-data') return { ok: false, error: 'no-data' };
    // raw/cmdline 只留本机，不进 peers/上报体
    const { raw: _raw, cmdline: _cmdline, ...usageClean } = usage || {};
    return submit(usageClean);
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/usage-report.test.js" "server/test/usage-report-http.test.js" "server/test/agent-stats.test.js"`
Expected: PASS（既有注入 `collect` 的用例不受影响）。

- [ ] **Step 5: 提交**

```bash
git add server/usage-report.js server/test/usage-report.test.js
git commit -m "feat(usage): reportNow 默认读采集文件并触发后台刷新"
```

---

### Task 5: 趋势图 K/M 单位

**Files:**
- Modify: `web/src/collaboration/UsageTrendChart.vue`
- Test: `web/src/collaboration/UsageTrendChart.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/collaboration/UsageTrendChart.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { mountC } from '../test-utils';
import { EMPTY_SNAPSHOT } from './types';

const h = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  return { chart, init: vi.fn(() => chart), use: vi.fn() };
});
vi.mock('echarts/core', () => ({ use: h.use, init: h.init }));
vi.mock('echarts/charts', () => ({ LineChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

import UsageTrendChart from './UsageTrendChart.vue';

afterEach(() => { h.chart.setOption.mockClear(); h.init.mockClear(); vi.unstubAllGlobals(); });

describe('UsageTrendChart', () => {
  it('纵轴与 tooltip 用 K/M 格式化', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ daily: {} }) })));
    const collab = { state: ref(EMPTY_SNAPSHOT) } as any;
    const w = mountC(UsageTrendChart, { props: { collab, peers: {} } });
    await flushPromises();
    const opt: any = h.chart.setOption.mock.calls.at(-1)?.[0];
    expect(typeof opt.yAxis.axisLabel.formatter).toBe('function');
    expect(opt.yAxis.axisLabel.formatter(1500)).toBe('1.5K');
    expect(opt.yAxis.axisLabel.formatter(2_000_000)).toBe('2.0M');
    expect(opt.tooltip.valueFormatter(1500)).toBe('1.5K');
    w.unmount();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- UsageTrendChart`
Expected: FAIL —— `opt.yAxis.axisLabel.formatter` 为 undefined。

- [ ] **Step 3: 实现**

3a. 第 8 行 import 增加 `fmtNum`：

```ts
import { machineLabel, mergeMachines, fmtNum } from './usagePeers';
```

3b. 第 80 行的 `tooltip` 与第 83 行的 `yAxis` 改为：

```ts
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtNum(v) },
```
```ts
    yAxis: { type: 'value', axisLabel: { color: axis, fontSize: 10, formatter: (v: number) => fmtNum(v) }, splitLine: { lineStyle: { color: split } } },
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- UsageTrendChart`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/collaboration/UsageTrendChart.vue web/src/collaboration/UsageTrendChart.test.ts
git commit -m "feat(collab): 用量趋势图纵轴/tooltip 用 K/M 单位"
```

---

### Task 6: 全量校验

**Files:** 无（验证）

- [ ] **Step 1: 单测**

Run: `npm.cmd test`
Expected: server + web 全部通过。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过。

- [ ] **Step 3: i18n**

Run: `npm.cmd run check:i18n`
Expected: 通过。

- [ ] **Step 4: 手动（dev）**

删除 `<数据目录>/cache/collaboration/stats.txt` 后启动 `npm.cmd run dev`：观察启动触发一次采样命令、命令结束后文件出现完整输出、下次上报用该文件；趋势图纵轴显示 `K/M`。

---

## Self-Review

**Spec coverage：**
- A 趋势图 K/M → Task 5。
- B 生产-消费、不超时、并发、启动触发、周期不变、首次跳过 → Task 3 + Task 4 + Task 6。
- C 末尾解析 → Task 1。
- D probe 不变 → 未改 `probeAgentStats`（Task 4 不动它）。
- E claude 系同步 → Task 4 Step 3c。
- 测试 → 各任务 Step 1。

**Placeholder scan：** 无 TBD；每步含完整代码/命令。

**Type consistency：** `readStatsFile` 返回 `{ exists, raw, mtimeMs, parsed }` 与 Task 4 消费一致；`refreshStatsOutput` 返回 `{ started, reason }` 与测试一致；`collectFromFile` 产出 `{ agent, days, error?, raw, statsFileMtime, ...parsed }` 与 `submit`/剥 raw 逻辑一致。
