# 远程访问页实时终端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/?phone=1` 的「远程访问」手机页从「截图 + 文本框」改为实时遥控终端（会话页签 + 终端黑框 + 工作流 + 输入/发送），界面逻辑直接复用主页的 `TerminalView`。

**Architecture:** `PhoneView` 变薄：自建 `useTerminal` + `useCenter` 连 WS，顶部保留「截图」按钮，主体渲染 `<TerminalView phone>`。`TerminalView` 新增 `phone` 开关：不自动建会话、隐藏新建/历史按钮、无会话显示空态、工作流按会话 `kind` 判定、composer 用独立高度键。服务端不改。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、xterm、vitest + happy-dom、Node ESM 后端（本任务不改）。

**Spec:** `docs/superpowers/specs/2026-09-18-remote-phone-live-terminal-design.md`

---

## File Structure

- **Create** `web/src/remote-coder/phoneMode.ts` — 手机模式纯判定（`isAgentSession`、`phoneHintKey`）。
- **Create** `web/src/remote-coder/phoneMode.test.ts` — 上述纯函数单测。
- **Modify** `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — 新增 `remote.no_sessions`、`remote.pick_session`，删除 5 个旧词条。
- **Modify** `web/src/components/TerminalView.vue` — 新增 `phone` prop 与手机模式分支。
- **Modify** `web/src/remote-coder/PhoneView.vue` — 重写为外壳（header + TerminalView）。
- **Modify** `web/src/remote-coder/PhoneView.test.ts` — 按新结构重写。

---

## Task 1: 手机模式纯函数 `phoneMode.ts`

**Files:**
- Create: `web/src/remote-coder/phoneMode.ts`
- Test: `web/src/remote-coder/phoneMode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/remote-coder/phoneMode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAgentSession, phoneHintKey } from './phoneMode';

describe('isAgentSession', () => {
  it('kind=agent 或带 agentId 视为 Agent 会话', () => {
    expect(isAgentSession({ id: 's1', kind: 'agent' })).toBe(true);
    expect(isAgentSession({ id: 's2', kind: 'shell', agentId: 'opencode' })).toBe(true);
    expect(isAgentSession({ id: 's3', kind: 'shell', agentId: null })).toBe(false);
    expect(isAgentSession({ id: 's4' })).toBe(false);
    expect(isAgentSession(null)).toBe(false);
    expect(isAgentSession(undefined)).toBe(false);
  });
});

describe('phoneHintKey', () => {
  it('已选会话 → 无提示', () => {
    expect(phoneHintKey({ sessions: [{ id: 's1', state: 'running' }], activeSessionId: 's1' })).toBeNull();
  });

  it('有运行中会话但未选 → 提示点页签', () => {
    expect(phoneHintKey({ sessions: [{ id: 's1', state: 'running' }], activeSessionId: null })).toBe('remote.pick_session');
  });

  it('无运行中会话 → 提示去桌面开', () => {
    expect(phoneHintKey({ sessions: [{ id: 's1', state: 'exited' }], activeSessionId: null })).toBe('remote.no_sessions');
    expect(phoneHintKey({ sessions: [], activeSessionId: null })).toBe('remote.no_sessions');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- src/remote-coder/phoneMode.test.ts`
Expected: FAIL —— `Failed to resolve import "./phoneMode"`。

- [ ] **Step 3: Write minimal implementation**

Create `web/src/remote-coder/phoneMode.ts`:

```ts
// 手机页（远程访问）模式的纯判定：是否 Agent 会话、无会话时的空态提示词条。
export interface PhoneSession {
  id: string;
  kind?: 'agent' | 'shell' | 'workflow';
  agentId?: string | null;
  state?: 'running' | 'exited';
}

// Agent 会话判定：kind 为 agent，或带 agentId（恢复的会话可能只留 agentId）
export function isAgentSession(session: PhoneSession | null | undefined): boolean {
  return !!session && (session.kind === 'agent' || !!session.agentId);
}

// 未选会话时给空态提示：有运行中会话 → 让用户点页签；没有 → 让用户去桌面开
export function phoneHintKey(input: {
  sessions: PhoneSession[];
  activeSessionId: string | null;
}): 'remote.pick_session' | 'remote.no_sessions' | null {
  if (input.activeSessionId) return null;
  return input.sessions.some((s) => s.state === 'running') ? 'remote.pick_session' : 'remote.no_sessions';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test -- src/remote-coder/phoneMode.test.ts`
Expected: PASS（2 个 describe、4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add web/src/remote-coder/phoneMode.ts web/src/remote-coder/phoneMode.test.ts
git commit -m "feat(remote): 手机模式纯判定 phoneMode（Agent 会话/空态提示）"
```

---

## Task 2: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:38-42`
- Modify: `shared/i18n/en.js:38-42`

> 说明：`remote.title` 在 `zh-CN.js` / `en.js` 里出现两次（后面的「远程访问」定义覆盖前面的「手机遥控」），手机页 header 显示的正是「远程访问」，本次不动它。

- [ ] **Step 1: 改 `shared/i18n/zh-CN.js`**

把第 38–42 行：

```js
  'remote.no_screen': '还没有截图，点「截图」',
  'remote.placeholder': '输入消息发给当前会话…',
  'remote.send': '发送',
  'remote.sent': '已发送',
  'remote.send_failed': '发送失败：{msg}',
```

替换为：

```js
  'remote.no_sessions': '当前没有运行中的会话，请先在桌面端打开',
  'remote.pick_session': '点上方页签选择要控制的会话',
```

- [ ] **Step 2: 改 `shared/i18n/en.js`**

把第 38–42 行：

```js
  'remote.no_screen': 'No capture yet — tap "Capture"',
  'remote.placeholder': 'Message the active session…',
  'remote.send': 'Send',
  'remote.sent': 'Sent',
  'remote.send_failed': 'Send failed: {msg}',
```

替换为：

```js
  'remote.no_sessions': 'No running sessions. Open one on the desktop first.',
  'remote.pick_session': 'Tap a tab above to pick a session.',
```

- [ ] **Step 3: 校验词条对称**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`（退出码 0）。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 手机页空态词条（remote.no_sessions/pick_session），移除旧截图/文本框词条"
```

---

## Task 3: `TerminalView` 新增 `phone` 模式

**Files:**
- Modify: `web/src/components/TerminalView.vue`（多处）

- [ ] **Step 1: 加 import 与 prop**

在 `web/src/components/TerminalView.vue` 顶部 import 区（第 22 行 `restorePrefs` 之后）加：

```ts
import { isAgentSession, phoneHintKey } from '../remote-coder/phoneMode';
```

把 `defineProps`（第 24–31 行）改成：

```ts
const props = defineProps<{
  terminal: ReturnType<typeof useTerminal>;
  center: ReturnType<typeof useCenter>;
  projectId: string | null;
  detailToken?: number;
  detailPath?: string;
  visibleSessionIds?: string[] | null;   // 非 null 时只自动建这些会话的页签（刷新恢复最近 N 个）
  phone?: boolean;                       // 手机页（/?phone=1）：不自动建会话、无会话显示空态
}>();
```

- [ ] **Step 2: 改 `activeIsAgent` 并加空态 computed**

把第 60–63 行：

```ts
const activeIsAgent = computed(() => {
  const sid = props.terminal.state.activeSessionId;
  return !!sid && agentSids.value.has(sid);
});
```

替换为：

```ts
const activeIsAgent = computed(() => {
  const sid = props.terminal.state.activeSessionId;
  if (!sid) return false;
  // 手机端 localStorage 没有 agentSids：按会话自身 kind/agentId 判定，保证工作流面板能显示
  if (props.phone) return isAgentSession(props.terminal.state.sessions.find((s) => s.id === sid) || null);
  return agentSids.value.has(sid);
});
// 手机模式：未选会话时的空态提示词条（桌面模式恒为 null）
const phoneHint = computed(() => (props.phone
  ? phoneHintKey({ sessions: props.terminal.state.sessions, activeSessionId: props.terminal.state.activeSessionId })
  : null));
```

- [ ] **Step 3: 手机模式把选中会话绑定为固定 Agent 会话**

在 `sendAgentText` 函数（第 392–399 行）之后加：

```ts
// 手机模式：把当前选中的 Agent 会话绑定为「固定会话」，复用现有发送/工作流逻辑，且绝不新建会话
watch(() => props.terminal.state.activeSessionId, (sid) => {
  if (!props.phone) return;
  if (!sid) { agentSid.value = null; return; }
  const s = props.terminal.state.sessions.find((x) => x.id === sid) || null;
  if (!isAgentSession(s)) { agentSid.value = null; return; }
  agentSid.value = sid;
  agentProjectId.value = s?.projectId ?? null;
  agentAtStart.value = s?.agentId || agentId.value;
  agentStarted.value = true;
  agentCliReady.value = true;   // 会话里 CLI 已在运行，手机端不再注入启动命令
}, { immediate: true });
```

- [ ] **Step 4: composer 高度用手机独立键**

把第 502–504 行：

```ts
const COMPOSER_H_KEY = 'devflow-composer-h';
const composerH = ref(240);
const composerMin = ref(true);
```

替换为：

```ts
const COMPOSER_H_KEY = props.phone ? 'devflow-composer-h-phone' : 'devflow-composer-h';
const composerH = ref(props.phone ? 150 : 240);
const composerMin = ref(true);
```

- [ ] **Step 5: composer 展开判定改用 `activeIsAgent`**

把第 525–528 行：

```ts
// 当前是 Agent 会话才默认展开；其他（含未选中）默认最小化；用户仍可手动折叠/展开
watch([() => props.terminal.state.activeSessionId, agentSids], ([sid]) => {
  composerMin.value = !(sid && agentSids.value.has(sid));
});
```

替换为：

```ts
// 当前是 Agent 会话才默认展开；其他（含未选中）默认最小化；用户仍可手动折叠/展开
watch(activeIsAgent, (v) => { composerMin.value = !v; });
```

- [ ] **Step 6: `sendToActive` 手机模式不新建会话**

把第 595–605 行 `sendToActive` 里的：

```ts
  if (!sid) { sendToAgent(t); return; }   // 没有任何会话时回退：启动 Agent 会话再发送
```

替换为：

```ts
  if (!sid) { if (props.phone) return; sendToAgent(t); return; }   // 手机模式没有选中会话就不发；桌面回退：启动 Agent 会话再发送
```

- [ ] **Step 7: `runWorkflow` 手机模式不新建/不杀会话**

把第 684–693 行：

```ts
async function runWorkflow() {
  const cmd = wfCmds.value[wfKind.value] || '';
  if (!cmd) return;
  // Agent 变更时先重启固定会话
  if (agentSid.value && agentActive() && agentAtStart.value !== agentId.value) {
```

替换为：

```ts
async function runWorkflow() {
  const cmd = wfCmds.value[wfKind.value] || '';
  if (!cmd) return;
  if (props.phone && !(agentSid.value && agentActive())) return;   // 手机模式只往已选会话发，不新建
  // Agent 变更时先重启固定会话（手机模式不重启主机会话）
  if (!props.phone && agentSid.value && agentActive() && agentAtStart.value !== agentId.value) {
```

- [ ] **Step 8: `SESSION_LIST` 手机模式不自动 adopt/新建**

把第 733–735 行：

```ts
  unsubList = props.terminal.on(S2C.SESSION_LIST, () => {
    if (autoTried || props.terminal.state.activeSessionId) return;
    autoTried = true;
```

替换为：

```ts
  unsubList = props.terminal.on(S2C.SESSION_LIST, () => {
    if (props.phone) return;   // 手机模式：不自动 adopt/新建会话，交给用户点页签
    if (autoTried || props.terminal.state.activeSessionId) return;
    autoTried = true;
```

- [ ] **Step 9: 模板——终端区空态 + 隐藏新建/历史按钮**

把第 1010–1013 行：

```html
    <div v-show="isSessionView" class="term-wrap">
      <div class="term-layer" ref="hostRef" />
      <button class="copyfloat" :disabled="!hasSelection" :title="$t('term.copy_sel')" @mousedown.stop @click="copySel">{{ copiedSel ? $t('term.copied') : $t('term.copy_sel') }}</button>
    </div>
```

替换为：

```html
    <div v-show="isSessionView" class="term-wrap">
      <div class="term-layer" ref="hostRef" />
      <div v-if="phoneHint" class="phone-empty">{{ $t(phoneHint) }}</div>
      <button class="copyfloat" :disabled="!hasSelection" :title="$t('term.copy_sel')" @mousedown.stop @click="copySel">{{ copiedSel ? $t('term.copied') : $t('term.copy_sel') }}</button>
    </div>
```

把第 1006 行：

```html
      <button class="new" @click="openNew">{{ $t('term.new_session_btn') }}</button>
```

替换为：

```html
      <button v-if="!phone" class="new" @click="openNew">{{ $t('term.new_session_btn') }}</button>
```

把第 1076 行：

```html
              <button class="cbtn" :title="$t('term.history')" @mousedown.stop @click="openHistory">{{ $t('term.history') }}</button>
```

替换为：

```html
              <button v-if="!phone" class="cbtn" :title="$t('term.history')" @mousedown.stop @click="openHistory">{{ $t('term.history') }}</button>
```

- [ ] **Step 10: 加空态样式**

在 `<style scoped>` 里 `.file-layer`（第 1244 行）之后加：

```css
.phone-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 0 24px; text-align: center; color: var(--tx4); font-size: 13px; background: var(--bg3); z-index: 2; }
```

- [ ] **Step 11: 类型检查 + 单测**

Run: `npm.cmd run typecheck`
Expected: 无报错（vue-tsc 通过）。

Run: `npm.cmd --prefix web run test`
Expected: 全绿（现有用例不受影响）。

- [ ] **Step 12: Commit**

```bash
git add web/src/components/TerminalView.vue
git commit -m "feat(remote): TerminalView 支持手机模式（不自动建会话/空态/工作流按会话 kind）"
```

---

## Task 4: `PhoneView` 改为外壳 + 更新测试

**Files:**
- Modify: `web/src/remote-coder/PhoneView.vue`（整体替换）
- Modify: `web/src/remote-coder/PhoneView.test.ts`（整体替换）

- [ ] **Step 1: 写新的测试**

把 `web/src/remote-coder/PhoneView.test.ts` 整体替换为：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import { t } from '../i18n';

vi.mock('../components/TerminalView.vue', () => ({
  default: {
    name: 'TerminalView',
    props: ['terminal', 'center', 'projectId', 'phone'],
    template: '<div class="tv-stub" />',
  },
}));

import PhoneView from './PhoneView.vue';

class FakeWS {
  readyState = 0;
  private listeners: Record<string, Array<(e: any) => void>> = {};
  constructor(public url: string) {}
  addEventListener(type: string, cb: (e: any) => void) { (this.listeners[type] ||= []).push(cb); }
  send() { /* noop */ }
  close() { /* noop */ }
}

type Call = { url: string; init?: RequestInit };

function stubFetch(state = { rev: 'r1' }) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit): Promise<any> => {
    calls.push({ url, init });
    if (url.startsWith('/api/remote-coder/state')) {
      return { ok: true, status: 200, json: async () => ({ rev: state.rev }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, rev: state.rev }) };
  });
  vi.stubGlobal('fetch', fetchFn);
  return { fetchFn, calls, state };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('PhoneView', () => {
  it('以 phone=true 渲染 TerminalView，且没有图片/文本框', async () => {
    stubFetch();
    vi.stubGlobal('WebSocket', FakeWS as any);
    const w = mountC(PhoneView);
    await flushPromises();
    const tv = w.findComponent({ name: 'TerminalView' });
    expect(tv.exists()).toBe(true);
    expect(tv.props('phone')).toBe(true);
    expect(w.find('img').exists()).toBe(false);
    expect(w.find('textarea').exists()).toBe(false);
  });

  it('点「截图」发截图命令并提示已更新', async () => {
    const s = stubFetch({ rev: 'r1' });
    vi.stubGlobal('WebSocket', FakeWS as any);
    const w = mountC(PhoneView);
    await flushPromises();
    s.state.rev = 'r2';                        // 桌面端截完图后的新版本
    await w.find('.shot').trigger('click');
    await flushPromises();
    const shotCall = s.calls.find((c) => c.url === '/api/remote-coder/message');
    expect(JSON.parse(String(shotCall?.init?.body))).toEqual({ kind: 'screenshot' });
    expect(w.find('.st').text()).toContain(t('remote.shot_done', { time: '' }).trim());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test -- src/remote-coder/PhoneView.test.ts`
Expected: FAIL —— 当前 `PhoneView` 没有 `.tv-stub`/没有 `phone=true` 的 `TerminalView`，且 `.st` 文案与断言不符。

- [ ] **Step 3: 重写 `PhoneView.vue`**

把 `web/src/remote-coder/PhoneView.vue` 整体替换为：

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useTerminal } from '../useTerminal';
import { useCenter } from '../useCenter';
import TerminalView from '../components/TerminalView.vue';
import { fetchScreenRev, requestShot, waitForNewScreen } from './useRemoteCoder';
import { t } from '../i18n';

const terminal = useTerminal({});
const center = useCenter();

const rev = ref('');
const pending = ref(false);
const status = ref('');
let statusTimer: ReturnType<typeof setTimeout> | null = null;

function showStatus(msg: string, autoClearMs = 4000) {
  status.value = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = null;
  if (autoClearMs > 0) statusTimer = setTimeout(() => { status.value = ''; statusTimer = null; }, autoClearMs);
}

function clockLabel(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function onShot() {
  if (pending.value) return;
  pending.value = true;
  const prev = rev.value;
  showStatus(t('remote.shot_pending'), 0);
  try {
    await requestShot();
    const next = await waitForNewScreen(prev);
    if (!next) { showStatus(t('remote.shot_timeout')); return; }
    rev.value = next.rev;
    showStatus(t('remote.shot_done', { time: clockLabel() }));
  } catch (e) {
    showStatus((e as Error).message || String(e));
  } finally {
    pending.value = false;
  }
}

onMounted(async () => {
  rev.value = await fetchScreenRev();
  terminal.connect();
});
onBeforeUnmount(() => {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = null;
  terminal.disconnect();
});
</script>

<template>
  <div class="phone">
    <header class="ph">
      <span class="ttl">{{ $t('remote.title') }}</span>
      <button class="shot" :disabled="pending" @click="onShot">{{ $t('remote.shot') }}</button>
      <span class="st" :title="status">{{ status }}</span>
    </header>
    <div class="body">
      <TerminalView :terminal="terminal" :center="center" :project-id="null" :phone="true" />
    </div>
  </div>
</template>

<style scoped>
.phone { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--bg0); color: var(--tx); }
.ph { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--bg1); border-bottom: 1px solid var(--bd2); }
.ttl { font-weight: 700; color: var(--tx1); }
.shot { background: var(--ac); color: var(--onac); border: none; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 13px; font-weight: 600; }
.shot:disabled { opacity: .6; cursor: default; }
.st { flex: 1; min-width: 0; color: var(--tx3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { flex: 1; min-height: 0; display: flex; }
.body :deep(.center-wrap) { flex: 1; min-width: 0; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test -- src/remote-coder/PhoneView.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: Commit**

```bash
git add web/src/remote-coder/PhoneView.vue web/src/remote-coder/PhoneView.test.ts
git commit -m "feat(remote): 手机页改为实时终端外壳（复用 TerminalView，保留截图）"
```

---

## Task 5: 全量验证与人工验收

**Files:** 无（只验证）

- [ ] **Step 1: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过，无输出报错。

- [ ] **Step 2: 全量测试**

Run: `npm.cmd test`
Expected: server 全绿 + web 全绿（含新增 `phoneMode.test.ts`、更新后的 `PhoneView.test.ts`）。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 4: 前端构建**

Run: `npm.cmd run build:web`
Expected: `web/dist` 构建成功。

- [ ] **Step 5: 人工验收（dev，端口 33333）**

1. 启动：`npm.cmd run dev:server` + `npm.cmd run dev:web`（或用带 opencode 的终端起 `npm.cmd run dev`）。
2. 桌面先开一个会话（终端/Agent），再新标签打开 `http://localhost:5173/?phone=1`。
3. 期望：顶部显示「远程访问」+「截图」；下方列出主机会话页签；点某个 Agent 会话页签 → 看到终端实时输出 + 工作流按钮/阶段/chips + 输入框与发送。
4. 在手机页输入框输入 `echo hi` 回车 → 终端出现输出。
5. 没有选中会话时终端区显示空态（有会话→「点上方页签…」；无会话→「当前没有运行中的会话…」）。
6. 点「截图」→ 桌面 `remote_coder/screen.png` 更新，`git log` 出现 `snapshot(remote)` 提交，手机页状态显示「已更新 HH:MM:SS」。

- [ ] **Step 6: Commit（如有验收期小修）**

```bash
git add <本次涉及文件>
git commit -m "fix(remote): 手机页验收修正"
```

---

## Self-Review

**Spec coverage:**
- §1 入口不变 → Task 3/4（main.ts 不动，`PhoneView` 仍由 `isPhoneEntry` 挂载）。
- §1 保留截图 + 文件通道 → Task 4（截图按钮 + `requestShot`；`messages.jsonc` 服务端不改）。
- §1 移除静态画面/文本框 → Task 4（模板无 `<img>`/`textarea`）。
- §3.1 PhoneView → Task 4。
- §3.2 TerminalView phone 模式 6 点 → Task 3 Step 2–10（不自动建会话 Step 8；隐藏新建 Step 9；空态 Step 2/9/10；工作流判定 Step 2；composer 高度 Step 4；隐藏历史 Step 9）。
- §3.3 phoneMode.ts → Task 1。
- §3.4 i18n → Task 2。
- §4 服务端不改 → 无任务（正确）。
- §5 测试/验收 → Task 1、4、5。

**Placeholder scan:** 无 TBD/TODO；所有代码步骤含完整代码。

**Type consistency:** `isAgentSession` / `phoneHintKey` 在 Task 1 定义，Task 3 import 使用一致；`phone` prop 在 Task 3 定义、Task 4 传入一致；i18n key `remote.pick_session` / `remote.no_sessions` 在 Task 1、2、3 中一致。
