# 会话消息 / 阶段提示「+」收藏进工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给左侧历史面板「消息」的每条消息、以及终端输入框上方「常用」阶段提示 chips 各加一个「+」按钮，点一下就把它追加进任意工作流的任意阶段并立即保存。

**Architecture:** 新增独立模块 `web/src/prompts/`：纯函数 `promptCollect.ts` 负责追加/去重，模块级单例 `usePromptCollect.ts` 负责「当前工作流/高亮阶段」「上次使用目标」与 `GET /api/workflows-xml → 改 → POST /api/workflows` 编排，`PromptCollectAddon.vue` 作为可复用控件。`TerminalView.vue` 只上报当前目标，`HistoryList.vue` 只挂控件；服务端零改动（复用既有全量读写端点 + `CONFIG_CHANGED` 广播）。

**Tech Stack:** Vue 3 + TS + vitest + happy-dom + Element Plus（`ElMessage`）；Windows PowerShell 5.1，一律 `npm.cmd`。

设计文档：`docs/superpowers/specs/2026-09-21-collect-prompt-to-workflow-design.md`。

---

## File Structure

- Create: `web/src/prompts/promptCollect.ts` — 纯函数追加/去重（无副作用）。
- Create: `web/src/prompts/usePromptCollect.ts` — 模块级单例状态 + collect 编排。
- Create: `web/src/prompts/PromptCollectAddon.vue` — 「+」控件（快速追加 + 两级选择面板）。
- Create: `web/src/prompts/promptCollect.test.ts` — 纯函数单测。
- Create: `web/src/prompts/usePromptCollect.test.ts` — 编排单测（mock fetch）。
- Modify: `shared/i18n/zh-CN.js` + `shared/i18n/en.js` — 新增 `pc.*` 词条。
- Modify: `web/src/components/TerminalView.vue` — chips 挂控件 + 上报当前目标。
- Modify: `web/src/components/HistoryList.vue` — 消息行挂控件 + 样式。
- Modify: `web/src/components/HistoryList.test.ts` — 消息行控件断言。
- Modify: `AGENTS.md` — 「目录速览」补一行。

---

### Task 1: 纯函数 `appendPromptToWorkflow`

**Files:**
- Create: `web/src/prompts/promptCollect.ts`
- Test: `web/src/prompts/promptCollect.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/prompts/promptCollect.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { appendPromptToWorkflow } from './promptCollect';
import type { Workflow } from '../workflowModel';

function seed(): Workflow[] {
  return [
    {
      id: 'w1', label: 'W1',
      stages: [
        { id: 's1', label: 'S1', prompts: ['a', 'b'] },
        { id: 's2', label: 'S2', prompts: [] },
      ],
    },
    { id: 'w2', label: 'W2', stages: [] },
  ];
}

describe('appendPromptToWorkflow', () => {
  it('追加成功：返回 ok，目标阶段末尾新增原文本，入参不被修改', () => {
    const list = seed();
    const snapshot = JSON.stringify(list);
    const r = appendPromptToWorkflow(list, 'w1', 's2', 'hello');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.list[0].stages[1].prompts).toEqual(['hello']);
    expect(JSON.stringify(list)).toBe(snapshot);           // 原列表未变
    expect(r.list).not.toBe(list);
    expect(r.list[0]).not.toBe(list[0]);
    expect(r.list[0].stages).not.toBe(list[0].stages);
    expect(r.list[0].stages[1]).not.toBe(list[0].stages[1]);
  });

  it('保留原始文本（含换行与首尾空白）', () => {
    const r = appendPromptToWorkflow(seed(), 'w1', 's2', '  line1\nline2  ');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.list[0].stages[1].prompts).toEqual(['  line1\nline2  ']);
  });

  it('同阶段已有相同 trim 文本 → exists，列表不变', () => {
    const list = seed();
    const r = appendPromptToWorkflow(list, 'w1', 's1', '  a  ');
    expect(r.status).toBe('exists');
    if (r.status !== 'exists') return;
    expect(r.list[0].stages[0].prompts).toEqual(['a', 'b']);
  });

  it('不同阶段相同文本不算重复', () => {
    const r = appendPromptToWorkflow(seed(), 'w1', 's2', 'a');
    expect(r.status).toBe('ok');
  });

  it('空 / 纯空白文本 → exists，不追加', () => {
    expect(appendPromptToWorkflow(seed(), 'w1', 's2', '').status).toBe('exists');
    expect(appendPromptToWorkflow(seed(), 'w1', 's2', '   ').status).toBe('exists');
  });

  it('工作流不存在 → no-workflow', () => {
    expect(appendPromptToWorkflow(seed(), 'nope', 's1', 'x').status).toBe('no-workflow');
  });

  it('阶段不存在 / 工作流无阶段 / 空列表 → no-stage', () => {
    expect(appendPromptToWorkflow(seed(), 'w1', 'nope', 'x').status).toBe('no-stage');
    expect(appendPromptToWorkflow(seed(), 'w2', 's1', 'x').status).toBe('no-stage');
    expect(appendPromptToWorkflow([], 'w1', 's1', 'x').status).toBe('no-workflow');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- promptCollect`
Expected: FAIL（`Cannot find module './promptCollect'` 或 `appendPromptToWorkflow is not a function`）

- [ ] **Step 3: 实现 `web/src/prompts/promptCollect.ts`**

```ts
import type { Workflow } from '../workflowModel';

export type CollectResult =
  | { status: 'ok'; list: Workflow[] }
  | { status: 'exists'; list: Workflow[] }
  | { status: 'no-workflow' }
  | { status: 'no-stage' };

// 把 text 追加到 workflowId.stages[stageId].prompts 末尾。
// - 目标工作流/阶段不存在 → no-workflow / no-stage；
// - text 为空白，或该阶段已含相同 trim 文本 → exists（不改动）；
// - 成功 → ok，返回逐层浅拷贝的新列表（入参不被修改），写入的是未 trim 的原文本。
export function appendPromptToWorkflow(
  list: Workflow[],
  workflowId: string,
  stageId: string,
  text: string,
): CollectResult {
  const wfs = Array.isArray(list) ? list : [];
  const wi = wfs.findIndex((w) => w && w.id === workflowId);
  if (wi < 0) return { status: 'no-workflow' };
  const stages = wfs[wi].stages || [];
  const si = stages.findIndex((s) => s && s.id === stageId);
  if (si < 0) return { status: 'no-stage' };
  const plain = String(text == null ? '' : text);
  const key = plain.trim();
  const prompts = stages[si].prompts || [];
  if (!key || prompts.some((p) => String(p).trim() === key)) {
    return { status: 'exists', list: wfs };
  }
  const nextStages = stages.map((s, i) => (i === si ? { ...s, prompts: [...(s.prompts || []), plain] } : s));
  const next = wfs.map((w, i) => (i === wi ? { ...w, stages: nextStages } : w));
  return { status: 'ok', list: next };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- promptCollect`
Expected: PASS（7 项）

- [ ] **Step 5: 提交**

```powershell
git add web/src/prompts/promptCollect.ts web/src/prompts/promptCollect.test.ts
git commit -m "feat(prompts): 工作流阶段提示语追加去重纯函数"
```

---

### Task 2: i18n 词条 `pc.*`

**Files:**
- Modify: `shared/i18n/zh-CN.js:688`
- Modify: `shared/i18n/en.js:688`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 的 `'wfe.valid': '校验通过',` 之后插入：

```js
  'pc.add': '添加到工作流',
  'pc.quick': '快速添加到「{wf} / {stage}」',
  'pc.choose': '选择工作流与阶段',
  'pc.last_used': '上次使用',
  'pc.workflow': '工作流',
  'pc.stage': '阶段',
  'pc.no_workflows': '还没有工作流，请先在「编辑工作流」里新建',
  'pc.no_stages': '该工作流还没有阶段',
  'pc.ok': '已添加到「{wf} / {stage}」',
  'pc.exists': '「{stage}」已存在该提示语，未重复添加',
  'pc.failed': '添加失败：{msg}',
  'pc.network': '网络或服务端错误',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 的 `'wfe.valid': 'Valid',` 之后插入：

```js
  'pc.add': 'Add to workflow',
  'pc.quick': 'Quick-add to "{wf} / {stage}"',
  'pc.choose': 'Choose workflow and stage',
  'pc.last_used': 'Last used',
  'pc.workflow': 'Workflow',
  'pc.stage': 'Stage',
  'pc.no_workflows': 'No workflows yet — create one in "Edit workflow" first',
  'pc.no_stages': 'This workflow has no stages',
  'pc.ok': 'Added to "{wf} / {stage}"',
  'pc.exists': 'Already exists in "{stage}"',
  'pc.failed': 'Add failed: {msg}',
  'pc.network': 'Network or server error',
```

> 说明：设计文档给了 `pc.failed`（带 `{msg}`），这里额外补一条 `pc.network` 作为错误原因文案，供 `pc.failed` 的 `{msg}` 使用。

- [ ] **Step 3: 校验中英键对称**

Run: `npm.cmd run check:i18n`
Expected: 通过（无缺失/多余键告警）

- [ ] **Step 4: 提交**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 提示词收藏进工作流词条"
```

---

### Task 3: 共享状态 `usePromptCollect`

**Files:**
- Create: `web/src/prompts/usePromptCollect.ts`
- Test: `web/src/prompts/usePromptCollect.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/prompts/usePromptCollect.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePromptCollect, __resetPromptCollect } from './usePromptCollect';

function wfs() {
  return [
    { id: 'w1', label: 'W1', stages: [{ id: 's1', label: 'S1', prompts: ['a'] }, { id: 's2', label: 'S2', prompts: [] }] },
    { id: 'w2', label: 'W2', stages: [] },
  ];
}

let calls: { url: string; method: string; body: any }[];
function mockFetch(initial = wfs()) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method, body });
    if (method === 'GET') return { ok: true, json: async () => ({ workflows: initial }) };
    return { ok: true, json: async () => ({ workflows: (body && body.workflows) || [] }) };
  }));
}

describe('usePromptCollect', () => {
  const pc = usePromptCollect();
  beforeEach(() => { __resetPromptCollect(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('显式目标：GET 最新 → 追加 → POST，并记录 lastTarget', async () => {
    mockFetch();
    const st = await pc.collect('hello', { workflowId: 'w1', stageId: 's2' });
    expect(st).toBe('ok');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1].body.workflows[0].stages[1].prompts).toContain('hello');
    expect(pc.lastTarget.value).toEqual({ workflowId: 'w1', stageId: 's2' });
  });

  it('重复文本 → exists，且不发 POST', async () => {
    mockFetch();
    const st = await pc.collect('a', { workflowId: 'w1', stageId: 's1' });
    expect(st).toBe('exists');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('无工作流 → no-workflow，且不发 POST', async () => {
    mockFetch([]);
    const st = await pc.collect('x');
    expect(st).toBe('no-workflow');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('setCurrent 后快速追加到当前工作流/阶段', async () => {
    mockFetch();
    pc.setCurrent('w1', 's2');
    const st = await pc.collect('quick');
    expect(st).toBe('ok');
    expect(calls[1].body.workflows[0].stages[1].prompts).toContain('quick');
  });

  it('lastTarget 优先于 current', async () => {
    mockFetch();
    pc.setCurrent('w1', 's2');
    await pc.collect('first', { workflowId: 'w1', stageId: 's1' });   // 记录 lastTarget=w1/s1
    const st = await pc.collect('second');
    expect(st).toBe('ok');
    expect(pc.lastTarget.value).toEqual({ workflowId: 'w1', stageId: 's1' });
    // 第二次快速追加落到 w1/s1（lastTarget），而不是 current 的 w1/s2
    const posted = calls.filter((c) => c.method === 'POST').pop();
    expect(posted?.body.workflows[0].stages[0].prompts).toContain('second');
  });

  it('无可用目标时回退到第一个工作流的第一阶段', async () => {
    mockFetch();
    const st = await pc.collect('fallback');
    expect(st).toBe('ok');
    expect(calls[1].body.workflows[0].stages[0].prompts).toContain('fallback');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- usePromptCollect`
Expected: FAIL（`Cannot find module './usePromptCollect'`）

- [ ] **Step 3: 实现 `web/src/prompts/usePromptCollect.ts`**

```ts
import { ref, type Ref } from 'vue';
import type { Workflow } from '../workflowModel';
import { appendPromptToWorkflow } from './promptCollect';

export interface CollectTarget { workflowId: string; stageId: string; }
export type CollectStatus = 'ok' | 'exists' | 'no-workflow' | 'no-stage' | 'error';

const TARGET_KEY = 'devflow-prompt-collect-target';

// 模块级单例：终端上报当前工作流/高亮阶段，历史面板与 chips 共用同一份收藏状态。
const workflows = ref<Workflow[]>([]);
const current = ref<CollectTarget>({ workflowId: '', stageId: '' });
const lastTarget = ref<CollectTarget | null>(readTarget());

function readTarget(): CollectTarget | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(TARGET_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<CollectTarget>;
    if (o && typeof o.workflowId === 'string' && typeof o.stageId === 'string' && o.workflowId && o.stageId) {
      return { workflowId: o.workflowId, stageId: o.stageId };
    }
  } catch { /* ignore */ }
  return null;
}
function writeTarget(t: CollectTarget | null) {
  lastTarget.value = t;
  try {
    if (typeof localStorage === 'undefined') return;
    if (t) localStorage.setItem(TARGET_KEY, JSON.stringify(t));
    else localStorage.removeItem(TARGET_KEY);
  } catch { /* ignore */ }
}

function hasStage(t: CollectTarget): boolean {
  const w = workflows.value.find((x) => x.id === t.workflowId);
  return !!w && (w.stages || []).some((s) => s.id === t.stageId);
}
function resolveTarget(explicit?: CollectTarget): CollectTarget | null {
  if (explicit) return explicit;
  if (lastTarget.value && hasStage(lastTarget.value)) return lastTarget.value;
  if (current.value.workflowId && current.value.stageId && hasStage(current.value)) return current.value;
  const w = workflows.value[0];
  const s = w && (w.stages || [])[0];
  return w && s ? { workflowId: w.id, stageId: s.id } : null;
}

export function usePromptCollect(): {
  workflows: Ref<Workflow[]>;
  current: Ref<CollectTarget>;
  lastTarget: Ref<CollectTarget | null>;
  setCurrent(workflowId: string, stageId: string): void;
  loadWorkflows(): Promise<void>;
  collect(text: string, target?: CollectTarget): Promise<CollectStatus>;
} {
  function setCurrent(workflowId: string, stageId: string) {
    current.value = { workflowId, stageId };
  }
  async function loadWorkflows() {
    try {
      const r = await fetch('/api/workflows-xml').then((x) => x.json());
      workflows.value = Array.isArray(r && r.workflows) ? r.workflows : [];
    } catch { /* 保留旧缓存 */ }
  }
  async function collect(text: string, target?: CollectTarget): Promise<CollectStatus> {
    await loadWorkflows();
    const tgt = resolveTarget(target);
    if (!tgt) return 'no-workflow';
    const res = appendPromptToWorkflow(workflows.value, tgt.workflowId, tgt.stageId, text);
    if (res.status === 'no-workflow') return 'no-workflow';
    if (res.status === 'no-stage') return 'no-stage';
    if (res.status === 'exists') return 'exists';
    try {
      const r = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflows: res.list }),
      });
      if (!r.ok) return 'error';
      const j: any = await r.json().catch(() => ({}));
      workflows.value = Array.isArray(j && j.workflows) ? j.workflows : res.list;
      writeTarget(tgt);
      return 'ok';
    } catch { return 'error'; }
  }
  return { workflows, current, lastTarget, setCurrent, loadWorkflows, collect };
}

// 仅供测试重置模块级状态；运行时代码不要调用。
export function __resetPromptCollect() {
  workflows.value = [];
  current.value = { workflowId: '', stageId: '' };
  writeTarget(null);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- usePromptCollect`
Expected: PASS（6 项）

- [ ] **Step 5: 提交**

```powershell
git add web/src/prompts/usePromptCollect.ts web/src/prompts/usePromptCollect.test.ts
git commit -m "feat(prompts): 提示词收藏共享状态与保存编排"
```

---

### Task 4: 控件 `PromptCollectAddon.vue`

**Files:**
- Create: `web/src/prompts/PromptCollectAddon.vue`

- [ ] **Step 1: 创建组件**

创建 `web/src/prompts/PromptCollectAddon.vue`：

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { t } from '../i18n';
import { usePromptCollect, type CollectTarget } from './usePromptCollect';

const props = defineProps<{ text: string }>();
const pc = usePromptCollect();

const rootEl = ref<HTMLElement | null>(null);
const open = ref(false);
const selWf = ref('');

const workflows = computed(() => pc.workflows.value);
const hasWorkflows = computed(() => workflows.value.length > 0);
const stages = computed(() => {
  const w = workflows.value.find((x) => x.id === selWf.value);
  return w ? (w.stages || []) : [];
});

function wfLabel(id: string): string {
  const w = workflows.value.find((x) => x.id === id);
  return w ? (w.label || w.id) : id;
}
function stageLabel(wfId: string, stageId: string): string {
  const s = (workflows.value.find((x) => x.id === wfId)?.stages || []).find((y) => y.id === stageId);
  return s ? (s.label || s.id) : stageId;
}
function resolveWfId(): string {
  const lt = pc.lastTarget.value;
  if (lt && workflows.value.some((w) => w.id === lt.workflowId)) return lt.workflowId;
  const cur = pc.current.value;
  if (cur.workflowId && workflows.value.some((w) => w.id === cur.workflowId)) return cur.workflowId;
  return workflows.value[0]?.id || '';
}
const lastLabel = computed(() => {
  const lt = pc.lastTarget.value;
  if (!lt || !workflows.value.some((w) => w.id === lt.workflowId)) return '';
  return `${wfLabel(lt.workflowId)} / ${stageLabel(lt.workflowId, lt.stageId)}`;
});
const quickTitle = computed(() => {
  const lt = pc.lastTarget.value;
  if (lt && workflows.value.some((w) => w.id === lt.workflowId)) {
    return t('pc.quick', { wf: wfLabel(lt.workflowId), stage: stageLabel(lt.workflowId, lt.stageId) });
  }
  const cur = pc.current.value;
  if (cur.workflowId && cur.stageId) return t('pc.quick', { wf: wfLabel(cur.workflowId), stage: stageLabel(cur.workflowId, cur.stageId) });
  return t('pc.add');
});

function toast(status: string, target: CollectTarget | null) {
  if (status === 'ok' && target) {
    ElMessage.success(t('pc.ok', { wf: wfLabel(target.workflowId), stage: stageLabel(target.workflowId, target.stageId) }));
  } else if (status === 'exists') {
    ElMessage.warning(t('pc.exists', { stage: target ? stageLabel(target.workflowId, target.stageId) : '' }));
  } else if (status === 'no-workflow') {
    ElMessage.error(t('pc.no_workflows'));
  } else if (status === 'no-stage') {
    ElMessage.error(t('pc.no_stages'));
  } else {
    ElMessage.error(t('pc.failed', { msg: t('pc.network') }));
  }
}

async function quickAdd() {
  if (!hasWorkflows.value) { ElMessage.error(t('pc.no_workflows')); return; }
  const status = await pc.collect(props.text);
  toast(status, pc.lastTarget.value);
}
async function pick(target: CollectTarget) {
  const status = await pc.collect(props.text, target);
  toast(status, target);
  open.value = false;
}
async function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  await pc.loadWorkflows();
  selWf.value = resolveWfId();
}
function onDocDown(e: MouseEvent) {
  if (!open.value) return;
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocDown));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown));
</script>

<template>
  <span ref="rootEl" class="pcwrap">
    <span class="pcadd" :title="quickTitle" @mousedown.stop @click.stop="quickAdd">＋</span>
    <span class="pccaret" :title="$t('pc.choose')" @mousedown.stop @click.stop="toggle">▾</span>
    <div v-if="open" class="pcpanel" @mousedown.stop @click.stop>
      <template v-if="hasWorkflows">
        <div v-if="lastLabel" class="pclast" @click="pc.lastTarget.value && pick(pc.lastTarget.value)">{{ $t('pc.last_used') }}：{{ lastLabel }}</div>
        <div class="pccols">
          <div class="pccol">
            <div class="pch">{{ $t('pc.workflow') }}</div>
            <button v-for="w in workflows" :key="w.id" class="pcwf" :class="{ on: w.id === selWf }" @click="selWf = w.id">{{ w.label || w.id }}</button>
          </div>
          <div class="pccol">
            <div class="pch">{{ $t('pc.stage') }}</div>
            <button v-for="s in stages" :key="s.id" class="pcst" @click="pick({ workflowId: selWf, stageId: s.id })">{{ s.label || s.id }}</button>
            <div v-if="!stages.length" class="pcempty">{{ $t('pc.no_stages') }}</div>
          </div>
        </div>
      </template>
      <div v-else class="pcempty">{{ $t('pc.no_workflows') }}</div>
    </div>
  </span>
</template>

<style scoped>
.pcwrap { position: relative; display: inline-flex; align-items: center; flex: none; }
.pcadd, .pccaret { cursor: pointer; color: var(--tx5); user-select: none; line-height: 1; }
.pcadd { font-size: 13px; padding: 0 2px; }
.pcadd:hover { color: var(--ac2); }
.pccaret { font-size: 9px; padding: 0 1px; }
.pccaret:hover { color: var(--ac2); }
.pcpanel { position: absolute; bottom: 100%; left: 0; z-index: 70; margin-bottom: 4px; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35); padding: 6px; min-width: 260px; font-size: 12px; }
.pclast { padding: 4px 6px; margin-bottom: 4px; border-bottom: 1px solid var(--bd2); color: var(--ac2); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pccols { display: flex; gap: 6px; }
.pccol { display: flex; flex-direction: column; gap: 2px; min-width: 110px; max-height: 220px; overflow-y: auto; }
.pch { color: var(--tx5); font-size: 11px; padding: 2px 4px; }
.pcwf, .pcst { text-align: left; background: none; border: 1px solid transparent; color: var(--tx2); border-radius: 4px; padding: 3px 6px; cursor: pointer; font-family: inherit; font-size: 12px; white-space: nowrap; }
.pcwf:hover, .pcst:hover { background: var(--bg3); }
.pcwf.on { color: var(--ac2); border-color: var(--ac2); }
.pcempty { color: var(--tx6); padding: 8px; }
</style>
```

> **执行时修正（已实施）**：就地 `position:absolute` 面板会被 `.composer{overflow:hidden}`、`.chipstage{overflow-y:auto}`、侧栏 `.list{overflow-y:auto}` 裁掉。实际实现改为 `Teleport to="body"` + `position:fixed`，按触发点 `getBoundingClientRect()` 计算位置（下方空间不足则向上弹），并加 `defineOptions({ inheritAttrs:false })` + `v-bind="$attrs"` 让外部 `class="mpc"` 落到触发区（否则 fragment 根会导致 Vue 警告且样式失效）。脚本与模板以仓库文件 `web/src/prompts/PromptCollectAddon.vue` 为准。

- [ ] **Step 2: 类型检查确认

Run: `npm.cmd --prefix web run typecheck`
Expected: 通过（无 `PromptCollectAddon` 相关报错）

- [ ] **Step 3: 提交**

```powershell
git add web/src/prompts/PromptCollectAddon.vue
git commit -m "feat(prompts): 可复用的提示词收藏 + 控件"
```

---

### Task 5: `TerminalView.vue` 集成（阶段提示 chips）

**Files:**
- Modify: `web/src/components/TerminalView.vue`（import 区、`wfKind` 附近、`activeStage` 附近、chips 模板）

- [ ] **Step 1: 加 import**

在 `web/src/components/TerminalView.vue` 第 18 行 `import WorkflowEditor from './WorkflowEditor.vue';` 之后加：

```ts
import { usePromptCollect } from '../prompts/usePromptCollect';
import PromptCollectAddon from '../prompts/PromptCollectAddon.vue';
```

- [ ] **Step 2: 取实例 + 上报当前目标**

在 `const wfKind = ref<string>('dev');`（约 274 行）之后加：

```ts
const promptCollect = usePromptCollect();
```

在 `const activeStage = ref('');`（约 709 行）之后加：

```ts
// 把当前工作流/高亮阶段上报给提示词收藏（供历史面板与 chips 的「+」快速追加）
watch([wfKind, activeStage], () => { promptCollect.setCurrent(wfKind.value, activeStage.value); }, { immediate: true });
```

（`watch` 已在文件中从 `vue` 导入并使用，无需改 import。）

- [ ] **Step 3: chips 模板挂控件**

把 `TerminalView.vue` 第 1286-1294 行的 `.chipwrap` 块改为（只在 `.rback` 之后追加一行 `<PromptCollectAddon>`）：

```html
            <span v-for="(c, i) in stageChips" :key="i" class="chipwrap">
              <button
                class="chip"
                :class="[{ on: composerText === c.text }, chipStatus(c)]"
                :title="c.text"
                @click="onChipClick(c)"
              ><span class="cdot" />{{ chipText(c.text) }}<span v-if="stageIcon(chipStatus(c))" class="stic">{{ stageIcon(chipStatus(c)) }}</span></button>
              <button v-if="chipRetryable(c)" class="rback" :title="$t('wf.step.rollback')" @mousedown.stop @click.stop="rollbackStep(chipStepId(c))">↺</button>
              <PromptCollectAddon :text="c.text" />
            </span>
```

- [ ] **Step 4: 启动 dev 手工验证（可与其他任务合并一次做）**

Run: `npm.cmd run dev`（后台异步；日志写 `logs\`）
Expected: http://localhost:5173 打开某个 Agent 会话 → chips 每条右侧出现「＋/▾」；点 ▾ 能选工作流与阶段；点「＋」快速追加并按 `pc.*` 文案提示。

- [ ] **Step 5: 提交**

```powershell
git add web/src/components/TerminalView.vue
git commit -m "feat(terminal): 阶段提示 chips 支持收藏进工作流"
```

---

### Task 6: `HistoryList.vue` 集成 + 测试 + AGENTS.md + 全量校验

**Files:**
- Modify: `web/src/components/HistoryList.vue`
- Modify: `web/src/components/HistoryList.test.ts`
- Modify: `AGENTS.md`

- [ ] **Step 1: 写失败测试**

在 `web/src/components/HistoryList.test.ts` 的 `describe('HistoryList', ...)` 内追加：

```ts
  it('消息行渲染收藏控件，点 + 不触发 open-message', async () => {
    const messages = [{ text: 'collect me', ts: 1, tabName: 't' }];
    const w = mount({ tab: 'messages', messages });
    await w.vm.$nextTick();
    const add = w.find('.mrow .pcadd');
    expect(add.exists()).toBe(true);
    await add.trigger('click');
    expect(w.emitted('open-message')).toBeUndefined();
  });

  it('会话树消息行也渲染收藏控件', async () => {
    const messages = [{ text: 'm1', ts: 100, sessionId: 's1', tabName: 'A' }];
    const w = mount({ tab: 'messages', filter: false, allStyle: 'tree', messages });
    await w.vm.$nextTick();
    await w.find('.tnode').trigger('click');   // 展开分组
    expect(w.find('.mrow .pcadd').exists()).toBe(true);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- HistoryList`
Expected: FAIL（`.pcadd` 不存在）

- [ ] **Step 3: 实现挂载**

在 `web/src/components/HistoryList.vue` 的 `<script setup>` import 区（第 6 行 `import FileTree from './FileTree.vue';` 之后）加：

```ts
import PromptCollectAddon from '../prompts/PromptCollectAddon.vue';
```

平铺消息行（约 279-289 行）在 `.x` 之前插入 `<PromptCollectAddon class="mpc" :text="row.item.text" />`：

```html
            <button v-else class="mrow" :class="dayClass(row.item.ts)" :title="row.item.text" @click="emit('open-message', row.item.text)">
              <span class="ic">💬</span>
              <span class="mbody">
                <span class="mtext">{{ row.item.text }}</span>
                <span class="mmeta">
                  <span v-if="row.item.tabName" class="mtab" :class="[msgSessionClass(row.item), { clickable: !!row.item.sessionId }]" :title="row.item.sessionId ? $t('hist.tree.open_title') : ''" @click.stop="openMsgSession(row.item)">{{ row.item.tabName }}</span>
                  <span v-if="row.item.ts" class="mdate">{{ fmtBelow(row.item.ts) }}</span>
                </span>
              </span>
              <PromptCollectAddon class="mpc" :text="row.item.text" />
              <span class="x" :title="$t('hist.remove_message')" @click.stop="emit('remove-message', row.item)">×</span>
            </button>
```

会话树消息行（约 261-268 行）同样在 `.x` 之前插入：

```html
                  <button v-else class="mrow" :class="dayClass(row.item.ts)" :title="row.item.text" @click="emit('open-message', row.item.text)">
                    <span class="ic">💬</span>
                    <span class="mbody">
                      <span class="mtext">{{ row.item.text }}</span>
                      <span class="mmeta"><span v-if="row.item.ts" class="mdate">{{ fmtBelow(row.item.ts) }}</span></span>
                    </span>
                    <PromptCollectAddon class="mpc" :text="row.item.text" />
                    <span class="x" :title="$t('hist.remove_message')" @click.stop="emit('remove-message', row.item)">×</span>
                  </button>
```

在 `<style scoped>` 里 `.mrow` 规则（336 行）之后加：

```css
.mpc { flex: none; opacity: 0; pointer-events: none; transition: opacity .12s; }
.mrow:hover .mpc { opacity: 1; pointer-events: auto; }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- HistoryList`
Expected: PASS（含新增 2 项 + 原有用例）

- [ ] **Step 5: 更新 AGENTS.md 目录速览**

在 `AGENTS.md` 的「手机遥控（remote_coder）」条目之后插入一行：

```markdown
- 提示词收藏（prompts）：`web/src/prompts/`（`promptCollect.ts` 纯函数追加/去重、`usePromptCollect.ts` 模块级共享状态、`PromptCollectAddon.vue` 可复用「+」控件）；左侧历史「消息」行与终端阶段提示 chips 的「＋」都走它，点选即追加进目标工作流的阶段并保存（`GET /api/workflows-xml` → 去重 → `POST /api/workflows`，服务端零改动）。
```

- [ ] **Step 6: 全量校验**

Run: `npm.cmd test`
Expected: 服务端 + web 全部通过

Run: `npm.cmd run typecheck`
Expected: 通过

Run: `npm.cmd run check:i18n`
Expected: 通过（零中文命中于 `web/src`、`server` 用户可见范围）

- [ ] **Step 7: 手工验收**

`npm.cmd run dev` →

1. 左侧历史 → 消息 → 点某条消息的「＋」→ 提示「已添加到 …」；打开「编辑工作流 → 表单」→ 对应阶段末尾出现该条。
2. 重复追加同一条 → 提示「已存在」，工作流不新增重复项。
3. 卡片 chips 上点「＋」→ 追加到上次使用目标；点「▾」可选其他工作流/阶段；保存后 chips 自动刷新。
4. 刷新页面后「＋」快速追加仍指向「上次使用目标」。

- [ ] **Step 8: 提交**

```powershell
git add web/src/components/HistoryList.vue web/src/components/HistoryList.test.ts AGENTS.md
git commit -m "feat(history): 消息行支持收藏进工作流 + 目录速览"
```

---

## 验证清单（全部任务完成后）

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run check:i18n
```

三项必须全绿；再按 Task 6 Step 7 手工验收一遍主链路。

---

## 备注

- 按 `AGENTS.md`「计划执行方式（强制）」，本计划使用 **inline（本会话内执行）**，不返回执行方式选择题。
- 服务端零改动：复用 `GET /api/workflows-xml`（`server/index.js:612-617`）与 `POST /api/workflows`（`server/index.js:809-822`）；后者成功后广播 `S2C.CONFIG_CHANGED`，`TerminalView.vue:955-960` 已有监听会 `loadWorkflows()` 刷新 chips。
- 不做：新增「我的提示词」独立库、输入框实时内容收藏、固定 1-5 chips 收藏、编辑器自动刷新、拖拽/批量收藏。
