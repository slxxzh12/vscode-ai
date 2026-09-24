# 「我的工作流」页签内联增删改工作流 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在左侧「我的工作流」页签内，把当前扁平的收藏提示词列表替换为一棵可增删改的工作流树（工作流 → 阶段 → 提示词，每级带 `＋`/`−`，名称/文本就地编辑）。

**Architecture:** 把 CRUD 逻辑收敛到数据层 `usePromptCollect`（模块级单例，`GET /api/workflows-xml` 读、`POST /api/workflows` 全量写），新建纯渲染组件 `WorkflowListPane.vue` 复用同一单例；`HistoryList.vue` 的 prompts 页签改挂该组件。服务端零改动。

**Tech Stack:** Vue 3 + TypeScript + Element Plus（仅 `ElMessage`）、vitest + @vue/test-utils + happy-dom、现有 `workflowModel.ts` 的 `newWorkflow`/`newStage`/`uid`。

---

## 文件结构

- 修改 `shared/i18n/zh-CN.js` / `shared/i18n/en.js`：新增 `pc.*` 词条。
- 修改 `web/src/prompts/usePromptCollect.ts`：新增 `persist` 私有助手 + 9 个 CRUD 方法；`collect` 复用 `persist`。
- 修改 `web/src/prompts/usePromptCollect.test.ts`：新增 CRUD 方法测试。
- 新增 `web/src/prompts/WorkflowListPane.vue`：内联工作流树组件。
- 新增 `web/src/prompts/WorkflowListPane.test.ts`：组件交互测试。
- 修改 `web/src/components/HistoryList.vue`：prompts 页签改挂 `WorkflowListPane`，删除摊平计算。
- 修改 `web/src/components/HistoryList.test.ts`：改写 prompts 页签测试。
- 修改 `AGENTS.md`：「目录速览」补一行。

---

## Task 1: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:758`（`pc.network` 行后）
- Modify: `shared/i18n/en.js:758`（`pc.network` 行后）

- [ ] **Step 1: 在 zh-CN.js 的 `pc.network` 行后插入新词条**

在 `shared/i18n/zh-CN.js` 找到这一行：

```js
  'pc.network': '网络或服务端错误',
```

在其后插入（保持缩进与逗号风格一致）：

```js
  'pc.new_workflow': '新工作流',
  'pc.new_stage': '新阶段',
  'pc.add_workflow': '新增工作流',
  'pc.del_workflow': '删除工作流',
  'pc.del_workflow_confirm': '删除整个工作流及其所有阶段？',
  'pc.del_stage': '删除阶段',
  'pc.del_stage_confirm': '删除该阶段及其所有提示词？',
  'pc.del_prompt': '删除提示词',
  'pc.add_prompt': '添加提示词',
  'pc.empty': '还没有工作流',
```

- [ ] **Step 2: 在 en.js 的 `pc.network` 行后插入对应英文词条**

在 `shared/i18n/en.js` 找到：

```js
  'pc.network': 'Network or server error',
```

在其后插入：

```js
  'pc.new_workflow': 'New workflow',
  'pc.new_stage': 'New stage',
  'pc.add_workflow': 'Add workflow',
  'pc.del_workflow': 'Delete workflow',
  'pc.del_workflow_confirm': 'Delete this workflow and all its stages?',
  'pc.del_stage': 'Delete stage',
  'pc.del_stage_confirm': 'Delete this stage and all its prompts?',
  'pc.del_prompt': 'Delete prompt',
  'pc.add_prompt': 'Add prompt',
  'pc.empty': 'No workflows yet',
```

- [ ] **Step 3: 校验 i18n 对称**

Run: `npm.cmd run check:i18n`
Expected: 零命中（无中英文键不对称报告）。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 我的工作流页签增删改词条"
```

---

## Task 2: `usePromptCollect` 新增 CRUD 方法

**Files:**
- Modify: `web/src/prompts/usePromptCollect.ts`
- Test: `web/src/prompts/usePromptCollect.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/prompts/usePromptCollect.test.ts` 的 `describe('usePromptCollect', ...)` 内（最后一个 `it` 之后、`});` 之前）追加以下测试块。注意现有 `mockFetch` 对 POST 返回 `{ workflows: body.workflows }`，因此可通过 `calls` 断言每次 POST 的 body。

```ts
  it('addWorkflow：追加一个空工作流并 POST', async () => {
    mockFetch();
    const ok = await pc.addWorkflow();
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows).toHaveLength(3);
    expect(post.body.workflows[2].id).toMatch(/^wf-/);
  });

  it('removeWorkflow：过滤掉整棵子树并 POST', async () => {
    mockFetch();
    const ok = await pc.removeWorkflow('w1');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows.map((w: any) => w.id)).toEqual(['w2']);
  });

  it('removeWorkflow：目标不存在 → false 且不发 POST', async () => {
    mockFetch();
    const ok = await pc.removeWorkflow('nope');
    expect(ok).toBe(false);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('renameWorkflow：改 label 并 POST', async () => {
    mockFetch();
    const ok = await pc.renameWorkflow('w1', 'Renamed');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].label).toBe('Renamed');
    expect(post.body.workflows[0].id).toBe('w1');
  });

  it('addStage：在指定工作流末尾追加新阶段', async () => {
    mockFetch();
    const ok = await pc.addStage('w2');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[1].stages).toHaveLength(1);
    expect(post.body.workflows[1].stages[0].id).toMatch(/^st-/);
  });

  it('removeStage：移除阶段并保留工作流', async () => {
    mockFetch();
    const ok = await pc.removeStage('w1', 's2');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].stages.map((s: any) => s.id)).toEqual(['s1']);
  });

  it('renameStage：改阶段 label 并 POST', async () => {
    mockFetch();
    const ok = await pc.renameStage('w1', 's1', 'S1x');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].stages[0].label).toBe('S1x');
  });

  it('addPrompt：在阶段末尾追加空字符串', async () => {
    mockFetch();
    const ok = await pc.addPrompt('w1', 's1');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].stages[0].prompts).toEqual(['a', '']);
  });

  it('removePrompt：按 index 移除提示词', async () => {
    mockFetch();
    const ok = await pc.removePrompt('w1', 's1', 0);
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].stages[0].prompts).toEqual([]);
  });

  it('setPrompt：按 index 覆盖文本', async () => {
    mockFetch();
    const ok = await pc.setPrompt('w1', 's1', 0, 'new text');
    expect(ok).toBe(true);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.workflows[0].stages[0].prompts).toEqual(['new text']);
  });

  it('POST 失败：返回 false 且不改本地 workflows', async () => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      const method = (init && init.method) || 'GET';
      const body = init && init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url: String(url), method, body });
      if (method === 'GET') return { ok: true, json: async () => ({ workflows: wfs() }) };
      return { ok: false, json: async () => ({ error: 'bad' }) };
    }));
    const before = JSON.stringify(pc.workflows.value);
    const ok = await pc.renameWorkflow('w1', 'X');
    expect(ok).toBe(false);
    expect(JSON.stringify(pc.workflows.value)).toBe(before);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix web run test -- prompts/usePromptCollect.test.ts`
Expected: 新增用例 FAIL（`pc.addWorkflow is not a function`）。

- [ ] **Step 3: 实现 `persist` + CRUD 方法**

修改 `web/src/prompts/usePromptCollect.ts`。

将顶部 import 改为（新增 `newWorkflow`、`newStage`）：

```ts
import { newWorkflow, newStage, type Workflow } from '../workflowModel';
```

（原文件第 2 行是 `import type { Workflow } from '../workflowModel';`，替换为上面这行。）

在 `usePromptCollect()` 函数体内，`async function collect(...)` 之前新增 `persist` 助手：

```ts
  async function persist(next: Workflow[]): Promise<boolean> {
    try {
      const r = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflows: next }),
      });
      if (!r.ok) return false;
      const j: any = await r.json().catch(() => ({}));
      workflows.value = Array.isArray(j && j.workflows) ? j.workflows : next;
      return true;
    } catch { return false; }
  }
```

将 `collect` 里两处内联 POST 改为复用 `persist`。原 `collect`（当前 `usePromptCollect.ts:67-107`）整体替换为：

```ts
  async function collect(text: string, target?: CollectTarget): Promise<CollectStatus> {
    await loadWorkflows();
    const tgt = resolveTarget(target);
    if (!tgt) {
      const labels = {
        wfId: MY_WF_ID,
        wfLabel: t('pc.my_workflow'),
        stageId: MY_STAGE_ID,
        stageLabel: t('pc.my_stage'),
      };
      const res = collectToMyWorkflow(workflows.value, text, labels);
      if (res.status === 'exists') return 'exists';
      if (!(await persist(res.list))) return 'error';
      writeTarget({ workflowId: res.workflowId, stageId: res.stageId });
      return 'ok';
    }
    const res = appendPromptToWorkflow(workflows.value, tgt.workflowId, tgt.stageId, text);
    if (res.status === 'no-workflow' || res.status === 'no-stage') return 'no-stage';
    if (res.status === 'exists') return 'exists';
    if (!(await persist(res.list))) return 'error';
    writeTarget(tgt);
    return 'ok';
  }
```

在 `collect` 之后、`return { ... }` 之前新增 9 个 CRUD 方法：

```ts
  async function addWorkflow(): Promise<boolean> {
    return persist([...workflows.value, newWorkflow(t('pc.new_workflow'))]);
  }
  async function removeWorkflow(wfId: string): Promise<boolean> {
    if (!workflows.value.some((w) => w.id === wfId)) return false;
    return persist(workflows.value.filter((w) => w.id !== wfId));
  }
  async function renameWorkflow(wfId: string, label: string): Promise<boolean> {
    if (!workflows.value.some((w) => w.id === wfId)) return false;
    return persist(workflows.value.map((w) => (w.id === wfId ? { ...w, label } : w)));
  }
  async function addStage(wfId: string): Promise<boolean> {
    const wi = workflows.value.findIndex((w) => w.id === wfId);
    if (wi < 0) return false;
    const next = workflows.value.slice();
    next[wi] = { ...next[wi], stages: [...(next[wi].stages || []), newStage(t('pc.new_stage'))] };
    return persist(next);
  }
  async function removeStage(wfId: string, stageId: string): Promise<boolean> {
    const w = workflows.value.find((x) => x.id === wfId);
    if (!w || !(w.stages || []).some((s) => s.id === stageId)) return false;
    const next = workflows.value.map((x) => (x.id === wfId
      ? { ...x, stages: (x.stages || []).filter((s) => s.id !== stageId) }
      : x));
    return persist(next);
  }
  async function renameStage(wfId: string, stageId: string, label: string): Promise<boolean> {
    const w = workflows.value.find((x) => x.id === wfId);
    if (!w || !(w.stages || []).some((s) => s.id === stageId)) return false;
    const next = workflows.value.map((x) => (x.id === wfId
      ? { ...x, stages: (x.stages || []).map((s) => (s.id === stageId ? { ...s, label } : s)) }
      : x));
    return persist(next);
  }
  async function addPrompt(wfId: string, stageId: string): Promise<boolean> {
    const w = workflows.value.find((x) => x.id === wfId);
    if (!w) return false;
    const si = (w.stages || []).findIndex((s) => s.id === stageId);
    if (si < 0) return false;
    const next = workflows.value.map((x) => (x.id === wfId
      ? { ...x, stages: (x.stages || []).map((s, i) => (i === si ? { ...s, prompts: [...(s.prompts || []), ''] } : s)) }
      : x));
    return persist(next);
  }
  async function removePrompt(wfId: string, stageId: string, index: number): Promise<boolean> {
    const w = workflows.value.find((x) => x.id === wfId);
    if (!w) return false;
    const si = (w.stages || []).findIndex((s) => s.id === stageId);
    if (si < 0) return false;
    const prompts = (w.stages || [])[si].prompts || [];
    if (index < 0 || index >= prompts.length) return false;
    const next = workflows.value.map((x) => (x.id === wfId
      ? { ...x, stages: (x.stages || []).map((s, i) => (i === si ? { ...s, prompts: prompts.filter((_, pi) => pi !== index) } : s)) }
      : x));
    return persist(next);
  }
  async function setPrompt(wfId: string, stageId: string, index: number, text: string): Promise<boolean> {
    const w = workflows.value.find((x) => x.id === wfId);
    if (!w) return false;
    const si = (w.stages || []).findIndex((s) => s.id === stageId);
    if (si < 0) return false;
    const prompts = (w.stages || [])[si].prompts || [];
    if (index < 0 || index >= prompts.length) return false;
    const next = workflows.value.map((x) => (x.id === wfId
      ? { ...x, stages: (x.stages || []).map((s, i) => (i === si ? { ...s, prompts: prompts.map((p, pi) => (pi === index ? text : p)) } : s)) }
      : x));
    return persist(next);
  }
```

更新 `usePromptCollect` 的返回类型签名（第 50-57 行）与 `return` 语句（第 108 行），加入新方法。将函数签名里的返回类型改为：

```ts
export function usePromptCollect(): {
  workflows: Ref<Workflow[]>;
  current: Ref<CollectTarget>;
  lastTarget: Ref<CollectTarget | null>;
  setCurrent(workflowId: string, stageId: string): void;
  loadWorkflows(): Promise<void>;
  collect(text: string, target?: CollectTarget): Promise<CollectStatus>;
  addWorkflow(): Promise<boolean>;
  removeWorkflow(wfId: string): Promise<boolean>;
  renameWorkflow(wfId: string, label: string): Promise<boolean>;
  addStage(wfId: string): Promise<boolean>;
  removeStage(wfId: string, stageId: string): Promise<boolean>;
  renameStage(wfId: string, stageId: string, label: string): Promise<boolean>;
  addPrompt(wfId: string, stageId: string): Promise<boolean>;
  removePrompt(wfId: string, stageId: string, index: number): Promise<boolean>;
  setPrompt(wfId: string, stageId: string, index: number, text: string): Promise<boolean>;
} {
```

`return` 语句改为：

```ts
  return { workflows, current, lastTarget, setCurrent, loadWorkflows, collect, addWorkflow, removeWorkflow, renameWorkflow, addStage, removeStage, renameStage, addPrompt, removePrompt, setPrompt };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix web run test -- prompts/usePromptCollect.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/prompts/usePromptCollect.ts web/src/prompts/usePromptCollect.test.ts
git commit -m "feat(prompts): usePromptCollect 增加工作流增删改方法"
```

---

## Task 3: 新建 `WorkflowListPane.vue` 组件

**Files:**
- Create: `web/src/prompts/WorkflowListPane.vue`
- Test: `web/src/prompts/WorkflowListPane.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `web/src/prompts/WorkflowListPane.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import { __resetPromptCollect } from './usePromptCollect';
import WorkflowListPane from './WorkflowListPane.vue';

const WFS = [
  { id: 'w1', label: 'W1', stages: [{ id: 's1', label: 'S1', prompts: ['a', 'b'] }] },
  { id: 'w2', label: 'W2', stages: [] },
];

function mockFetch(list: any[] = WFS) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    if (method === 'GET') return { ok: true, json: async () => ({ workflows: list }) };
    return { ok: true, json: async () => ({ workflows: (body && body.workflows) || [] }) };
  }));
}

describe('WorkflowListPane', () => {
  beforeEach(() => { __resetPromptCollect(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('渲染工作流/阶段/提示词层级', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    expect(w.findAll('.wcard')).toHaveLength(2);
    expect(w.find('.wlabel').element.getAttribute('value')).toBe('W1');
    expect(w.findAll('.slabel')).toHaveLength(1);
    expect(w.findAll('.ptext')).toHaveLength(2);
  });

  it('无工作流时显示空态', async () => {
    mockFetch([]);
    const w = mountC(WorkflowListPane);
    await flushPromises();
    expect(w.find('.empty').exists()).toBe(true);
  });

  it('顶部 + 新增工作流', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    await w.find('.wadd').trigger('click');
    await flushPromises();
    expect(w.findAll('.wcard')).toHaveLength(3);
  });

  it('工作流 − 触发删除（确认后）', async () => {
    mockFetch();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const w = mountC(WorkflowListPane);
    await flushPromises();
    await w.find('.wdel').trigger('click');
    await flushPromises();
    expect(w.findAll('.wcard')).toHaveLength(1);
  });

  it('工作流 − 取消确认则不删除', async () => {
    mockFetch();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const w = mountC(WorkflowListPane);
    await flushPromises();
    await w.find('.wdel').trigger('click');
    await flushPromises();
    expect(w.findAll('.wcard')).toHaveLength(2);
  });

  it('阶段 + 新增空提示词', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    await w.find('.sadd').trigger('click');
    await flushPromises();
    expect(w.findAll('.ptext')).toHaveLength(3);
  });

  it('提示词 − 删除一条', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    await w.find('.pdel').trigger('click');
    await flushPromises();
    expect(w.findAll('.ptext')).toHaveLength(1);
  });

  it('工作流名失焦触发 renameWorkflow', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    const input = w.find('.wlabel');
    await input.setValue('NewName');
    await input.trigger('change');
    await flushPromises();
    expect(w.find('.wlabel').element.getAttribute('value')).toBe('NewName');
  });

  it('提示词文本失焦触发 setPrompt', async () => {
    mockFetch();
    const w = mountC(WorkflowListPane);
    await flushPromises();
    const ta = w.find('.ptext');
    await ta.setValue('edited');
    await ta.trigger('change');
    await flushPromises();
    expect(w.findAll('.ptext')[0].element.getAttribute('value')).toBe('edited');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix web run test -- prompts/WorkflowListPane.test.ts`
Expected: FAIL（模块 `./WorkflowListPane.vue` 找不到）。

- [ ] **Step 3: 实现组件**

新建 `web/src/prompts/WorkflowListPane.vue`：

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { t } from '../i18n';
import { usePromptCollect } from './usePromptCollect';

const pc = usePromptCollect();
const workflows = pc.workflows;
const collapsed = ref<Set<string>>(new Set());

function toggle(wfId: string) {
  const next = new Set(collapsed.value);
  if (next.has(wfId)) next.delete(wfId); else next.add(wfId);
  collapsed.value = next;
}
function val(e: Event): string {
  return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
}
function fail() { ElMessage.error(t('pc.failed', { msg: t('pc.network') })); }

async function addWorkflow() { if (!(await pc.addWorkflow())) fail(); }
async function removeWorkflow(wfId: string) {
  if (!window.confirm(t('pc.del_workflow_confirm'))) return;
  if (!(await pc.removeWorkflow(wfId))) fail();
}
async function renameWorkflow(wfId: string, label: string) { if (!(await pc.renameWorkflow(wfId, label))) fail(); }
async function addStage(wfId: string) { if (!(await pc.addStage(wfId))) fail(); }
async function removeStage(wfId: string, stageId: string) {
  if (!window.confirm(t('pc.del_stage_confirm'))) return;
  if (!(await pc.removeStage(wfId, stageId))) fail();
}
async function renameStage(wfId: string, stageId: string, label: string) { if (!(await pc.renameStage(wfId, stageId, label))) fail(); }
async function addPrompt(wfId: string, stageId: string) { if (!(await pc.addPrompt(wfId, stageId))) fail(); }
async function removePrompt(wfId: string, stageId: string, index: number) { if (!(await pc.removePrompt(wfId, stageId, index))) fail(); }
async function setPrompt(wfId: string, stageId: string, index: number, text: string) { if (!(await pc.setPrompt(wfId, stageId, index, text))) fail(); }

onMounted(() => { void pc.loadWorkflows(); });
</script>

<template>
  <div class="wlp">
    <div v-if="workflows.length === 0" class="empty">{{ $t('pc.empty') }}</div>
    <button class="wadd" @click="addWorkflow">{{ $t('pc.add_workflow') }}</button>
    <div v-for="w in workflows" :key="w.id" class="wcard">
      <div class="wrow">
        <button class="caret" @click="toggle(w.id)">{{ collapsed.has(w.id) ? '▸' : '▾' }}</button>
        <input class="wlabel" :value="w.label" :placeholder="$t('pc.new_workflow')"
          @change="renameWorkflow(w.id, val($event))" />
        <button class="wdel" :title="$t('pc.del_workflow')" @click="removeWorkflow(w.id)">−</button>
      </div>
      <template v-if="!collapsed.has(w.id)">
        <div v-for="s in w.stages" :key="s.id" class="scard">
          <div class="srow">
            <input class="slabel" :value="s.label" :placeholder="$t('pc.new_stage')"
              @change="renameStage(w.id, s.id, val($event))" />
            <button class="sadd" :title="$t('pc.add_prompt')" @click="addPrompt(w.id, s.id)">＋</button>
            <button class="sdel" :title="$t('pc.del_stage')" @click="removeStage(w.id, s.id)">−</button>
          </div>
          <div v-for="(p, pi) in s.prompts" :key="pi" class="prow">
            <textarea class="ptext" :value="p" :placeholder="$t('wfe.prompt')"
              @change="setPrompt(w.id, s.id, pi, val($event))" />
            <button class="pdel" :title="$t('pc.del_prompt')" @click="removePrompt(w.id, s.id, pi)">−</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wlp { display: flex; flex-direction: column; gap: 6px; }
.empty { color: var(--tx6); padding: 16px 12px; font-size: 12px; }
.wadd { align-self: flex-start; background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer; font-family: inherit; }
.wadd:hover { border-color: var(--ac2); color: var(--ac2); }
.wcard { border: 1px solid var(--bd); border-radius: 6px; padding: 6px; background: var(--bg2); display: flex; flex-direction: column; gap: 4px; }
.wrow, .srow, .prow { display: flex; gap: 4px; align-items: center; }
.caret { flex: none; width: 14px; background: none; border: none; color: var(--tx5); cursor: pointer; font-size: 10px; }
.wlabel { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 6px; font-size: 12px; font-weight: 700; font-family: inherit; box-sizing: border-box; }
.slabel { flex: 1; min-width: 0; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 6px; font-size: 12px; font-family: inherit; box-sizing: border-box; }
.wlabel:focus, .slabel:focus, .ptext:focus { outline: none; border-color: var(--ac2); }
.wdel, .sdel, .pdel, .sadd { flex: none; background: none; border: 1px solid var(--bd); color: var(--tx5); border-radius: 4px; font-size: 12px; line-height: 1; padding: 2px 6px; cursor: pointer; }
.wdel:hover, .sdel:hover, .pdel:hover { color: var(--err); border-color: var(--err); }
.sadd:hover { color: var(--ac2); border-color: var(--ac2); }
.scard { border-left: 2px solid var(--bd); padding-left: 6px; display: flex; flex-direction: column; gap: 4px; }
.prow { align-items: flex-start; }
.ptext { flex: 1; min-width: 0; min-height: 28px; background: var(--bg1); color: var(--tx1); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 6px; font-size: 12px; font-family: inherit; box-sizing: border-box; resize: vertical; white-space: pre-wrap; }
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix web run test -- prompts/WorkflowListPane.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/prompts/WorkflowListPane.vue web/src/prompts/WorkflowListPane.test.ts
git commit -m "feat(prompts): 我的工作流内联树组件 WorkflowListPane"
```

---

## Task 4: `HistoryList.vue` 接入新组件

**Files:**
- Modify: `web/src/components/HistoryList.vue`
- Test: `web/src/components/HistoryList.test.ts`

- [ ] **Step 1: 改写失败测试**

在 `web/src/components/HistoryList.test.ts` 中，将现有的「我的工作流页签」测试（第 287-307 行）整体替换为：

```ts
  it('我的工作流页签：渲染内联工作流树组件', async () => {
    __resetPromptCollect();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ workflows: [] }) })));
    const w = mount({ tab: 'prompts' });
    await flushPromises();
    expect(w.find('.wlp').exists()).toBe(true);
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix web run test -- components/HistoryList.test.ts`
Expected: FAIL（`.wlp` 不存在）。

- [ ] **Step 3: 修改 `HistoryList.vue`**

1. 删除 `promptAbbr, MY_WF_ID` 的 import（第 10 行）：

```ts
import { promptAbbr, MY_WF_ID } from '../prompts/promptCollect';
```

  替换为（新增组件 import）：

```ts
import WorkflowListPane from '../prompts/WorkflowListPane.vue';
```

2. 删除 `usePromptCollect` 的 import（第 9 行）：

```ts
import { usePromptCollect } from '../prompts/usePromptCollect';
```

3. 删除 `pc` 常量与 prompts 加载 watch（第 67-69 行）：

```ts
// 左侧「我的工作流」页签：读收藏模块的共享状态（无收藏时为空列表，不提示「没有工作流」）
const pc = usePromptCollect();
watch(() => props.tab, (tb) => { if (tb === 'prompts') void pc.loadWorkflows(); }, { immediate: true });
```

4. 删除摊平计算（第 71-89 行的 `PromptRow`、`myPrompts`、`filteredPrompts`）。

5. 将模板里 prompts 页签分支（第 286-295 行）：

```html
      <template v-else-if="tab === 'prompts'">
        <div v-if="filteredPrompts.length === 0" class="empty">{{ $t('hist.empty_prompts') }}</div>
        <button v-for="(r, i) in filteredPrompts" :key="i" class="mrow" :title="r.text" @click="emit('open-message', r.text)">
          <span class="ic">➕</span>
          <span class="mbody">
            <span class="mtext">{{ promptAbbr(r.text) }}</span>
            <span class="mmeta"><span class="mtab">{{ r.stage }}</span></span>
          </span>
        </button>
      </template>
```

  替换为：

```html
      <template v-else-if="tab === 'prompts'">
        <WorkflowListPane />
      </template>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix web run test -- components/HistoryList.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/HistoryList.vue web/src/components/HistoryList.test.ts
git commit -m "feat(ui): 我的工作流页签改挂内联工作流树"
```

---

## Task 5: 更新 AGENTS.md 目录速览

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 补一行说明**

在 `AGENTS.md`「目录速览」的提示词收藏（prompts）条目末尾（第 81 行该条最后）追加一句，描述新组件与增删改能力：

```markdown
  ；左侧「我的工作流」页签现改为内联工作流树（`WorkflowListPane.vue`），可增删改工作流/阶段/提示词（`usePromptCollect` 新增 `addWorkflow`/`removeWorkflow`/`renameWorkflow`/`addStage`/`removeStage`/`renameStage`/`addPrompt`/`removePrompt`/`setPrompt`，均走 `POST /api/workflows` 全量写回，服务端零改动）。
```

- [ ] **Step 2: 提交**

```bash
git add AGENTS.md
git commit -m "docs: 目录速览补充我的工作流内联增删改"
```

---

## Task 6: 全量校验

- [ ] **Step 1: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无 TS 错误。

- [ ] **Step 2: 全量测试**

Run: `npm.cmd test`
Expected: server + web 全部通过。

- [ ] **Step 3: i18n 校验**

Run: `npm.cmd run check:i18n`
Expected: 零命中。

---

## 自审结论

- **Spec 覆盖**：§4.1（CRUD 方法）→ Task 2；§4.2（组件）→ Task 3；§4.3（HistoryList 接入）→ Task 4；§5（i18n）→ Task 1；§7（测试）→ Task 2/3/4 的测试步骤 + Task 6；§8（影响面含 AGENTS.md）→ Task 5。
- **占位符**：无 TBD/TODO；每处代码步骤均给出完整代码。
- **类型一致**：`usePromptCollect` 新方法签名（`addWorkflow()`、`removeWorkflow(wfId)`、`renameWorkflow(wfId, label)`、`addStage(wfId)`、`removeStage(wfId, stageId)`、`renameStage(wfId, stageId, label)`、`addPrompt(wfId, stageId)`、`removePrompt(wfId, stageId, index)`、`setPrompt(wfId, stageId, index, text)`）在测试（Task 2）与组件（Task 3）中完全一致；组件 CSS 类名（`.wlp`/`.wcard`/`.wrow`/`.wlabel`/`.wdel`/`.srow`/`.slabel`/`.sadd`/`.sdel`/`.prow`/`.ptext`/`.pdel`/`.wadd`/`.caret`/`.empty`）与测试选择器一致。
