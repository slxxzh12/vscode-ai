# Agent 启动弹框自动 ESC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent 会话启动后的固定时间窗内盲发 ESC，顶掉 opencode 的升级框/告警框，覆盖自动恢复与手动新开的 agent 会话。

**Architecture:** 新增独立纯逻辑模块 `server/agent-startup-guard.js`（可注入定时器，便于单测）；在 `server/index.js` 的 `SessionManager.onCreated` 对 `kind:'agent'` 会话 arm，`exit`/`removed` 时 disarm。服务端统一处理，前端零改动、无新 WS 协议。

**Tech Stack:** Node ESM、`node:test` + `node:assert/strict`、现有 `SessionManager.write`。

**Spec:** `docs/superpowers/specs/2026-09-18-agent-startup-esc-design.md`

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `server/agent-startup-guard.js`（新建） | guard 工厂：`arm(session)` 排定时写 ESC、`disarm(id)` 清理；纯逻辑，`schedule`/`clear` 可注入 |
| `server/test/agent-startup-guard.test.js`（新建） | 手推时钟单测：agent 触发、shell/workflow 不触发、退出跳过、disarm、重复 arm |
| `server/index.js`（修改） | 创建 guard 并接线到 `onCreated` / `exit` / `removed` |

---

### Task 1: `agent-startup-guard` 模块

**Files:**
- Create: `server/agent-startup-guard.js`
- Test: `server/test/agent-startup-guard.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/agent-startup-guard.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentStartupGuard } from '../agent-startup-guard.js';

// 手动时钟 harness：schedule 只登记任务，测试里手动 fire
function harness({ sessions = new Map() } = {}) {
  const tasks = [];
  const cleared = [];
  let seq = 0;
  const schedule = (fn, delay) => {
    const id = ++seq;
    tasks.push({ id, fn, delay });
    return id;
  };
  const clear = (id) => {
    cleared.push(id);
    const i = tasks.findIndex((t) => t.id === id);
    if (i >= 0) tasks.splice(i, 1);
  };
  const writes = [];
  const sessionManager = {
    get: (id) => sessions.get(id) || null,
    write: (id, data) => { writes.push([id, data]); return true; },
  };
  const guard = createAgentStartupGuard({ sessionManager, schedule, clear });
  return { guard, tasks, writes, cleared, sessions };
}

test('agent 会话到点各盲发一次 ESC', () => {
  const sessions = new Map([['s1', { id: 's1', kind: 'agent', alive: true }]]);
  const { guard, tasks, writes } = harness({ sessions });
  guard.arm(sessions.get('s1'));
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map((t) => t.delay), [3000, 4500]);
  for (const t of [...tasks]) t.fn();
  assert.deepEqual(writes, [['s1', '\x1b'], ['s1', '\x1b']]);
});

test('shell / workflow 会话不 arm', () => {
  const { guard, tasks } = harness();
  guard.arm({ id: 's1', kind: 'shell', alive: true });
  guard.arm({ id: 's2', kind: 'workflow', alive: true });
  assert.equal(tasks.length, 0);
});

test('会话不存在或已退出时到点跳过', () => {
  const sessions = new Map([['s1', { id: 's1', kind: 'agent', alive: false }]]);
  const { guard, tasks, writes } = harness({ sessions });
  guard.arm({ id: 's1', kind: 'agent', alive: true });   // 第二个会话不存在
  guard.arm({ id: 's2', kind: 'agent', alive: true });
  for (const t of [...tasks]) t.fn();
  assert.equal(writes.length, 0);
});

test('disarm 后到点不再写', () => {
  const sessions = new Map([['s1', { id: 's1', kind: 'agent', alive: true }]]);
  const { guard, tasks, writes, cleared } = harness({ sessions });
  guard.arm(sessions.get('s1'));
  guard.disarm('s1');
  assert.ok(cleared.length >= 2);
  for (const t of [...tasks]) t.fn();   // clear 后 tasks 已空
  assert.equal(writes.length, 0);
});

test('同一 id 重复 arm 只保留最新一批定时器', () => {
  const sessions = new Map([['s1', { id: 's1', kind: 'agent', alive: true }]]);
  const { guard, tasks } = harness({ sessions });
  guard.arm(sessions.get('s1'));
  guard.arm(sessions.get('s1'));
  assert.equal(tasks.length, 2);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/test/agent-startup-guard.test.js`
Expected: FAIL，`Cannot find module '../agent-startup-guard.js'`

- [ ] **Step 3: 写最小实现**

创建 `server/agent-startup-guard.js`：

```js
// Agent 会话启动弹框兜底：启动命令提交后，在固定时间窗内盲发 ESC，
// 顶掉 opencode 的升级框/告警框（不做内容识别，避免受版本/i18n 影响）。
export function createAgentStartupGuard({
  sessionManager,
  delaysMs = [3000, 4500],
  esc = '\x1b',
  schedule = setTimeout,
  clear = clearTimeout,
  logger = console,
} = {}) {
  const timers = new Map();   // sessionId -> handle[]

  function disarm(id) {
    const handles = timers.get(id);
    if (!handles) return;
    for (const h of handles) { try { clear(h); } catch { /* ignore */ } }
    timers.delete(id);
  }

  function arm(session) {
    if (!session || session.kind !== 'agent' || !session.id) return;
    disarm(session.id);
    const handles = delaysMs.map((delay) => schedule(() => {
      const cur = sessionManager.get(session.id);
      if (!cur || !cur.alive || cur.kind !== 'agent') return;
      try { sessionManager.write(session.id, esc); }
      catch (e) { logger?.warn?.('agent startup esc failed', e && e.message); }
    }, delay));
    timers.set(session.id, handles);
  }

  return { arm, disarm };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test server/test/agent-startup-guard.test.js`
Expected: PASS，5 个用例全过

- [ ] **Step 5: 提交**

```bash
git add server/agent-startup-guard.js server/test/agent-startup-guard.test.js
git commit -m "feat(server): add agent startup ESC guard module"
```

---

### Task 2: 接线到 `server/index.js`

**Files:**
- Modify: `server/index.js`（import 段；`buildWorkspace` 内 `SessionManager` 构造与生命周期监听）

- [ ] **Step 1: 加 import**

在 `server/index.js:22`（`import { discoverAgentSessionId } from './agent-resume.js';`）之后插入：

```js
import { createAgentStartupGuard } from './agent-startup-guard.js';
```

- [ ] **Step 2: 在 SessionManager 前声明变量，onCreated 里 arm**

把这段（约 `server/index.js:239-252`）：

```js
  const sessionManager = new SessionManager({
    logger: log,
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    onCreated: (s) => {
      sessionProjects.record(s.id, s.projectId);
      if (s.kind === 'workflow') return;
      sessionLedger.upsert({
        id: s.id, name: s.name, projectId: s.projectId, cwd: s.cwd, kind: s.kind,
        agentId: s.agentId, agentCmd: s.agentCmd, cols: s.cols, rows: s.rows,
        createdAt: s.createdAt, updatedAt: Date.now(), state: 'running',
      });
      if (s.kind === 'agent') scheduleAgentDiscovery(s);
    },
  });
```

改为：

```js
  let startupGuard = null;   // 构造 SessionManager 后立即赋值；onCreated 触发时已就绪
  const sessionManager = new SessionManager({
    logger: log,
    projectResolver: (id) => projects.listProjects().find((p) => p.id === id)?.root ?? null,
    onCreated: (s) => {
      sessionProjects.record(s.id, s.projectId);
      if (s.kind === 'workflow') return;
      sessionLedger.upsert({
        id: s.id, name: s.name, projectId: s.projectId, cwd: s.cwd, kind: s.kind,
        agentId: s.agentId, agentCmd: s.agentCmd, cols: s.cols, rows: s.rows,
        createdAt: s.createdAt, updatedAt: Date.now(), state: 'running',
      });
      if (s.kind === 'agent') {
        scheduleAgentDiscovery(s);
        startupGuard?.arm(s);
      }
    },
  });
  startupGuard = createAgentStartupGuard({ sessionManager, logger: log });
```

- [ ] **Step 3: exit / removed 里 disarm**

把 `sessionManager.on('exit', ...)` 的开头（`server/index.js:254-256`）：

```js
  sessionManager.on('exit', (s) => {
    sessionLedger.flushLog(s.id);
```

改为：

```js
  sessionManager.on('exit', (s) => {
    startupGuard.disarm(s.id);
    sessionLedger.flushLog(s.id);
```

把 `sessionManager.on('removed', ...)` 的开头（`server/index.js:262-263`）：

```js
  sessionManager.on('removed', (id) => {
    sessionLedger.close(id);
```

改为：

```js
  sessionManager.on('removed', (id) => {
    startupGuard.disarm(id);
    sessionLedger.close(id);
```

- [ ] **Step 4: 语法/加载自检**

Run: `node --check server/index.js`
Expected: 无输出（退出码 0）

- [ ] **Step 5: 提交**

```bash
git add server/index.js
git commit -m "feat(server): arm startup ESC guard for agent sessions"
```

---

### Task 3: 回归与手工验证

**Files:** 无改动（仅验证）

- [ ] **Step 1: 全量 server 测试**

Run: `npm.cmd run test:server`
Expected: 全部通过（含新 guard 单测）

- [ ] **Step 2: i18n 检查（无新增文案，应保持通过）**

Run: `npm.cmd run check:i18n`
Expected: 通过

- [ ] **Step 3: 手工验证（dev）**

Run: `npm.cmd run dev`（后台起，日志 `logs\`）
验证：

1. 打开一个 agent 页签：启动后 3s / 4.5s 各有一枚 ESC 写入，agent 正常进入 TUI。
2. 临时制造告警框（如把 provider 模型名改错）后启 agent：框自动消失、会话可用。
3. 恢复一个已关闭的 agent 会话（重启后端 → 打开页签）：能续回原对话，框被 ESC 顶掉。
4. 开 shell 页签：无多余 ESC。

- [ ] **Step 4: 提交（如手工验证通过且用户同意提交）**

```bash
git add docs/superpowers/specs/2026-09-18-agent-startup-esc-design.md docs/superpowers/plans/2026-09-18-agent-startup-esc.md
git commit -m "docs: agent startup ESC design and plan"
```

---

## 自检

- **Spec 覆盖**：范围 1+2（服务端 `kind:'agent'` 统一处理）→ Task 2；盲发时间窗 +3000/+4500 → Task 1 默认值与测试；仅 agent、不动 shell/workflow → Task 1 测试；无 i18n 词条 → Task 3 Step 2。
- **占位符**：无 TBD/TODO，所有步骤含完整代码与命令。
- **类型/命名一致**：`createAgentStartupGuard`、`arm`/`disarm`、`delaysMs`、`esc` 在 Task 1/2 中一致；`startupGuard` 变量名在 Task 2 内一致。
