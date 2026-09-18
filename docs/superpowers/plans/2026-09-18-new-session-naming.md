# 新建会话命名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建会话弹窗支持输入「任务名」，非空则设置页签显示名并同步 Agent 对话名；留空则创建后提示可双击页签改名；去掉 3 秒自动创建倒计时。

**Architecture:** 纯逻辑抽到 `sessionNaming.ts`（可单测的就绪门 `createReadyGate`），组件 `TerminalView.vue` 负责弹窗交互、页签名写入与 `/rename` 同步触发。

**Tech Stack:** Vue 3 `<script setup>` + vitest；i18n 走 `@devflow/shared/i18n`。

**Spec:** `docs/superpowers/specs/2026-09-18-new-session-naming-design.md`

---

### Task 1: 就绪门纯逻辑 `sessionNaming.ts`

**Files:**
- Create: `web/src/components/sessionNaming.ts`
- Test: `web/src/components/sessionNaming.test.ts`

- [ ] **Step 1: Write the failing test**

创建 `web/src/components/sessionNaming.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { createReadyGate } from './sessionNaming';

describe('createReadyGate', () => {
  it('最短时长内即使静默也不就绪', () => {
    let now = 0;
    const g = createReadyGate({ now: () => now });
    now = 2999;
    expect(g.poll()).toBe('waiting');
  });

  it('过了最短时长且静默达标即就绪', () => {
    let now = 0;
    const g = createReadyGate({ now: () => now });
    now = 3000;
    expect(g.poll()).toBe('ready');
  });

  it('输出会重置静默计时', () => {
    let now = 0;
    const g = createReadyGate({ now: () => now });
    now = 3000;
    g.output();
    expect(g.poll()).toBe('waiting');
    now = 4000;
    expect(g.poll()).toBe('waiting');
    now = 4200;
    expect(g.poll()).toBe('ready');
  });

  it('超时返回 timeout', () => {
    let now = 0;
    const g = createReadyGate({ now: () => now });
    for (let i = 0; i < 100; i += 1) { now += 500; g.output(); }
    expect(now).toBe(50000);
    expect(g.poll()).toBe('timeout');
  });

  it('可覆盖默认阈值', () => {
    let now = 0;
    const g = createReadyGate({ now: () => now, minMs: 100, quietMs: 50, timeoutMs: 1000 });
    now = 100;
    expect(g.poll()).toBe('ready');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- src/components/sessionNaming.test.ts`
Expected: FAIL — 无法解析 `./sessionNaming`。

- [ ] **Step 3: Write minimal implementation**

创建 `web/src/components/sessionNaming.ts`：

```ts
// 新建 Agent 会话后判断 CLI 是否就绪：最短时长 + 输出静默，超时放弃。
export type GateState = 'waiting' | 'ready' | 'timeout';

export interface ReadyGateOptions {
  now: () => number;
  minMs?: number;
  quietMs?: number;
  timeoutMs?: number;
}

export function createReadyGate(opts: ReadyGateOptions): { output(): void; poll(): GateState } {
  const minMs = opts.minMs ?? 3000;
  const quietMs = opts.quietMs ?? 1200;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const start = opts.now();
  let last = start;
  return {
    output() { last = opts.now(); },
    poll(): GateState {
      const t = opts.now();
      if (t - start >= timeoutMs) return 'timeout';
      if (t - start >= minMs && t - last >= quietMs) return 'ready';
      return 'waiting';
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test -- src/components/sessionNaming.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/sessionNaming.ts web/src/components/sessionNaming.test.ts
git commit -m "feat(term): 新建会话就绪门 createReadyGate"
```

---

### Task 2: i18n 词条（中英对称）

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 中文：加新键、删旧键**

在 `shared/i18n/zh-CN.js` 的 `'term.new_session': '新建会话 —— 选择要执行的命令',` 之后插入：

```js
  'term.new_task_name': '任务名（可选）',
  'term.new_task_name_hint': '留空用默认名，创建后双击页签可改名',
  'term.rename_hint': '可双击页签修改名字',
```

删除该文件中的这一行：

```js
  'term.auto_start_in': '{n} 秒后自动创建选中项',
```

- [ ] **Step 2: 英文：加新键、删旧键**

在 `shared/i18n/en.js` 的 `'term.new_session': 'New session — choose a command',` 之后插入：

```js
  'term.new_task_name': 'Task name (optional)',
  'term.new_task_name_hint': 'Leave empty for the default; double-click the tab to rename',
  'term.rename_hint': 'Double-click the tab to rename',
```

删除该文件中的这一行：

```js
  'term.auto_start_in': 'Creating selected in {n}s',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`（退出码 0）。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(term): 新建会话任务名词条；移除自动创建提示"
```

---

### Task 3: `TerminalView.vue` 弹窗命名与同步

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 引入就绪门**

在 `web/src/components/TerminalView.vue` 的 `import { isAgentSession, phoneHintKey } from '../remote-coder/phoneMode';` 之后加：

```ts
import { createReadyGate } from './sessionNaming';
```

- [ ] **Step 2: 替换新建会话状态与函数**

把这段（约 264-298 行）：

```ts
// 新建会话：先选择要执行的命令（终端 cmd / 各 Agent），3 秒后自动执行选中项
const newOpen = ref(false);
const newSelected = ref('cmd');
const newCountdown = ref(3);
let newTimer: ReturnType<typeof setInterval> | null = null;
const newChoices = computed(() => [
  { id: 'cmd', label: t('term.new_cmd'), cmd: '' },
  ...agents.value.map((a) => ({ id: a.id, label: a.name, cmd: a.cmd })),
]);
function stopNewTimer() { if (newTimer) { clearInterval(newTimer); newTimer = null; } }
function openNew() {
  const ids = newChoices.value.map((c) => c.id);
  newSelected.value = ids.includes(agentId.value) ? agentId.value : (ids[0] || 'cmd');
  newOpen.value = true;
  newCountdown.value = 3;
  stopNewTimer();
  newTimer = setInterval(() => {
    newCountdown.value -= 1;
    if (newCountdown.value <= 0) { stopNewTimer(); createNew(newSelected.value); }
  }, 1000);
}
function closeNew() { stopNewTimer(); newOpen.value = false; }
async function createNew(id: string) {
  stopNewTimer();
  newOpen.value = false;
  const c = newChoices.value.find((x) => x.id === id) || newChoices.value[0];
  const s = await props.terminal.createSession({
    projectId: props.projectId, cols: 80, rows: 24,
    kind: c.cmd ? 'agent' : 'shell', agentId: c.cmd ? c.id : null, agentCmd: c.cmd || null,
  });
  if (c.cmd) markAgent(s.id);
  props.center.ensureSession(s.id, c.cmd ? `◈ ${c.label}` : c.label, s.state || 'running');
  props.terminal.switchTo(s.id);
  if (c.cmd) setTimeout(() => { props.terminal.input(`${c.cmd}`); setTimeout(() => props.terminal.input('\r'), 200); }, 1200);
}
```

替换为：

```ts
// 新建会话：先输入任务名（可选）再选择要执行的命令；不再倒计时自动创建
const newOpen = ref(false);
const newSelected = ref('cmd');
const newName = ref('');
const newChoices = computed(() => [
  { id: 'cmd', label: t('term.new_cmd'), cmd: '' },
  ...agents.value.map((a) => ({ id: a.id, label: a.name, cmd: a.cmd })),
]);
function openNew() {
  const ids = newChoices.value.map((c) => c.id);
  newSelected.value = ids.includes(agentId.value) ? agentId.value : (ids[0] || 'cmd');
  newName.value = '';
  newOpen.value = true;
}
function closeNew() { newOpen.value = false; }
// 名字留空时创建后的短暂提示
const renameHint = ref('');
let renameHintTimer: ReturnType<typeof setTimeout> | null = null;
function showRenameHint() {
  renameHint.value = t('term.rename_hint');
  if (renameHintTimer) clearTimeout(renameHintTimer);
  renameHintTimer = setTimeout(() => { renameHint.value = ''; renameHintTimer = null; }, 4000);
}
async function createNew(id: string) {
  newOpen.value = false;
  const c = newChoices.value.find((x) => x.id === id) || newChoices.value[0];
  const name = newName.value.trim();
  newName.value = '';
  const s = await props.terminal.createSession({
    projectId: props.projectId, cols: 80, rows: 24,
    kind: c.cmd ? 'agent' : 'shell', agentId: c.cmd ? c.id : null, agentCmd: c.cmd || null,
  });
  if (c.cmd) markAgent(s.id);
  const label = c.cmd ? `◈ ${c.label}` : c.label;
  props.center.ensureSession(s.id, name || label, s.state || 'running');
  if (name) {
    const next = { ...tabNames.value };
    next[s.id] = name;
    tabNames.value = next;
    persistTabNames();
    msgHistory.renameTab(s.id, name);
  } else {
    showRenameHint();
  }
  props.terminal.switchTo(s.id);
  if (c.cmd) setTimeout(() => {
    props.terminal.input(`${c.cmd}`);
    setTimeout(() => props.terminal.input('\r'), 200);
    if (name) void syncNewAgentName(s.id, name);
  }, 1200);
}
// 新 Agent 会话就绪后同步对话名：最短 3s + 输出静默 1.2s，超时 30s 放弃
async function syncNewAgentName(sid: string, name: string) {
  const gate = createReadyGate({ now: () => Date.now() });
  const unsub = props.terminal.on(S2C.OUTPUT, (msg: any) => { if (msg.sessionId === sid) gate.output(); });
  const ok = await new Promise<boolean>((resolve) => {
    const timer = setInterval(() => {
      if (props.terminal.state.activeSessionId !== sid) { clearInterval(timer); unsub(); resolve(false); return; }
      const st = gate.poll();
      if (st === 'waiting') return;
      clearInterval(timer);
      unsub();
      resolve(st === 'ready');
    }, 200);
  });
  if (ok) syncAgentRename(sid, name);
}
```

- [ ] **Step 3: 更新卸载清理**

把 `onBeforeUnmount` 里的 `stopNewTimer();`（约 883 行）替换为：

```ts
  if (renameHintTimer) { clearTimeout(renameHintTimer); renameHintTimer = null; }
```

- [ ] **Step 4: 更新弹窗模板**

把新建会话弹窗（约 895-906 行）：

```html
    <div v-if="newOpen" class="setmask" @click.self="closeNew">
      <div class="newmodal">
        <header class="seth"><span>{{ $t('term.new_session') }}</span><button class="setx" @click="closeNew">×</button></header>
        <div class="newlist">
          <button v-for="c in newChoices" :key="c.id" class="newitem" :class="{ on: newSelected === c.id }" @click="createNew(c.id)">
            <span class="ni-label">{{ c.label }}</span>
            <span class="ni-cmd">{{ c.cmd || $t('term.default_shell') }}</span>
          </button>
        </div>
        <div class="newhint">{{ $t('term.auto_start_in', { n: newCountdown }) }}</div>
      </div>
    </div>
```

替换为（新增名字输入 + 常驻提示；去掉倒计时提示；随后新增 toast）：

```html
    <div v-if="newOpen" class="setmask" @click.self="closeNew">
      <div class="newmodal">
        <header class="seth"><span>{{ $t('term.new_session') }}</span><button class="setx" @click="closeNew">×</button></header>
        <div class="newname">
          <input v-model="newName" class="newname-input" :placeholder="$t('term.new_task_name')" @keyup.enter="createNew(newSelected)" />
          <div class="newname-hint">{{ $t('term.new_task_name_hint') }}</div>
        </div>
        <div class="newlist">
          <button v-for="c in newChoices" :key="c.id" class="newitem" :class="{ on: newSelected === c.id }" @click="createNew(c.id)">
            <span class="ni-label">{{ c.label }}</span>
            <span class="ni-cmd">{{ c.cmd || $t('term.default_shell') }}</span>
          </button>
        </div>
      </div>
    </div>
    <div v-if="renameHint" class="renamehint">{{ renameHint }}</div>
```

- [ ] **Step 5: 更新样式**

在 `web/src/components/TerminalView.vue` 的 `<style scoped>` 中，把 `.newhint { ... }` 这一行替换为：

```css
.newname { padding: 10px 12px 0; }
.newname-input { width: 100%; box-sizing: border-box; background: var(--bg4); color: var(--tx1); border: 1px solid var(--bd); border-radius: 6px; padding: 7px 10px; font-size: 13px; outline: none; }
.newname-input:focus { border-color: var(--ac2); }
.newname-hint { margin-top: 6px; color: var(--tx6); font-size: 11px; }
.renamehint { position: absolute; left: 50%; transform: translateX(-50%); bottom: 16px; z-index: 3000; background: var(--bg1); border: 1px solid var(--bd2); color: var(--tx1); border-radius: 6px; padding: 8px 16px; font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.4); }
```

- [ ] **Step 6: 类型检查 + 单测**

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd test`
Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add web/src/components/TerminalView.vue
git commit -m "feat(term): 新建会话可输入任务名并同步 Agent 对话名"
```

---

### Task 4: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 测试**

Run: `npm.cmd test`
Expected: 全绿。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 4: 前端构建**

Run: `npm.cmd run build:web`
Expected: 构建成功。

- [ ] **Step 5: 人工验收（dev，端口 33333）**

起服务（后台，日志写 `logs\`）：

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:server" -RedirectStandardOutput "logs\dev-server.log" -RedirectStandardError "logs\dev-server.err.log" -WindowStyle Hidden
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:web" -RedirectStandardOutput "logs\dev-web.log" -RedirectStandardError "logs\dev-web.err.log" -WindowStyle Hidden
```

打开 `http://localhost:5173` → 点「＋ 新建会话」→ 确认弹窗**不再倒计时**、有任务名输入框与常驻提示 → 输入「登录改造」点 OpenCode → 页签显示「登录改造」，Agent 启动完成后其内部对话名同步；再开一次留空创建 → 页签默认名 + 底部短暂提示「可双击页签修改名字」。

---

## Self-Review

**1. Spec coverage**

- 去倒计时、手动点选 → Task 3 Step 2/4。
- 任务名输入 + 常驻提示 → Task 3 Step 4/5、Task 2。
- 非空设页签名 + 同步历史页签名 → Task 3 Step 2。
- Agent 对话名同步（最短 3s + 静默 1.2s + 超时 30s）→ Task 1 + Task 3 Step 2。
- 空名 toast → Task 3 Step 2/4/5、Task 2。
- i18n 中英对称、删 `auto_start_in` → Task 2。
- 纯逻辑单测 → Task 1。

**2. Placeholder scan**

无 TBD/TODO；每个代码步骤给出完整代码与命令。

**3. Type consistency**

- `createReadyGate({ now })` 返回 `{ output, poll }`：Task 1 定义，Task 3 使用一致。
- `syncNewAgentName(sid, name)`、`syncAgentRename(sid, name)`、`showRenameHint()`、`renameHint`：Task 3 内一致。
- i18n 键 `term.new_task_name` / `term.new_task_name_hint` / `term.rename_hint`：Task 2 定义，Task 3 使用一致。
- 选择器 `.newname-input` / `.renamehint`：Task 3 Step 4 与 Step 5 一致。
