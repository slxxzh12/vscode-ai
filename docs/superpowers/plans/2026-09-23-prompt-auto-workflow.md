# 无工作流自动建「我的工作流」+ 左侧缩写页签 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 没有工作流时不再报错，而是自动新建「我的工作流 / 常用提示词」并写入选中的提示词；同时在工作流编辑器与左侧新增的「我的工作流」页签里，以首行缩写展示收藏的提示词（悬停看全文）。

**Architecture:** 自动建逻辑下沉到数据层 `usePromptCollect.collect()`（方案 1），`PromptCollectAddon` 只做 UI，左侧页签读同一份模块级 `pc.workflows`。缩写由纯函数 `promptAbbr` 在 UI 层派生，**不改数据结构**（工作流里仍存完整原文）。服务端零改动（复用 `GET /api/workflows-xml` / `POST /api/workflows`）。

**Tech Stack:** Vue 3 + TS + vitest + happy-dom + Element Plus；Windows PowerShell 5.1，一律 `npm.cmd`。

设计文档：`docs/superpowers/specs/2026-09-23-prompt-auto-workflow-design.md`。

---

## File Structure

- Modify: `web/src/prompts/promptCollect.ts` — 新增 `promptAbbr`、`MY_WF_ID`/`MY_STAGE_ID`、`collectToMyWorkflow`（纯函数）。
- Modify: `web/src/prompts/usePromptCollect.ts` — `collect` 无可用目标时自动建；移除 `no-workflow` 状态。
- Modify: `web/src/prompts/PromptCollectAddon.vue` — 去掉「无工作流」报错，弹层无工作流改为「添加到我的工作流」按钮。
- Modify: `web/src/components/HistoryList.vue` — 新增「我的工作流」页签（缩写列表 + 点击回填）。
- Modify: `web/src/components/WorkflowFormTab.vue` — 提示词行加缩写标签。
- Modify: `web/src/windowState.ts` + `web/src/App.vue` — `HistoryTab`/`SIDE_TABS`/`historyTab` 增加 `'prompts'`。
- Modify: `shared/i18n/zh-CN.js` + `shared/i18n/en.js` — 新增词条、删除 `pc.no_workflows`。
- Modify: `web/src/prompts/promptCollect.test.ts`、`usePromptCollect.test.ts`、`web/src/components/HistoryList.test.ts`。
- Create: `web/src/components/WorkflowFormTab.test.ts`。
- Modify: `AGENTS.md` — 「目录速览」补一行。
- 不改：服务端、`workflowModel.ts` 数据结构、XML 读写协议、`open-message` 行为、打包脚本。

---

### Task 1: 纯函数 `promptAbbr` + `collectToMyWorkflow`

**Files:**
- Modify: `web/src/prompts/promptCollect.ts`
- Test: `web/src/prompts/promptCollect.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `web/src/prompts/promptCollect.test.ts` 顶部 import 后补充以下内容（放在文件末尾即可）：

```ts
import { promptAbbr, collectToMyWorkflow, MY_WF_ID, MY_STAGE_ID } from './promptCollect';

const LABELS = { wfId: MY_WF_ID, wfLabel: 'Mine', stageId: MY_STAGE_ID, stageLabel: 'Common' };

describe('promptAbbr', () => {
  it('取第一个换行前的内容并 trim', () => {
    expect(promptAbbr('  line1\nline2  ')).toBe('line1');
  });
  it('单行原样返回', () => {
    expect(promptAbbr('hello')).toBe('hello');
  });
  it('超过 max 截断并加省略号', () => {
    const s = promptAbbr('x'.repeat(50), 40);
    expect(s).toBe('x'.repeat(40) + '…');
  });
  it('空 / 纯空白返回空串', () => {
    expect(promptAbbr('')).toBe('');
    expect(promptAbbr('   \n ')).toBe('');
    expect(promptAbbr(null as unknown as string)).toBe('');
  });
});

describe('collectToMyWorkflow', () => {
  it('空列表 → 新建「我的工作流」，完整原文写入', () => {
    const list: Workflow[] = [];
    const snapshot = JSON.stringify(list);
    const r = collectToMyWorkflow(list, 'hello', LABELS);
    expect(r.status).toBe('ok');
    expect(r.workflowId).toBe(MY_WF_ID);
    expect(r.stageId).toBe(MY_STAGE_ID);
    expect(r.list[0].id).toBe(MY_WF_ID);
    expect(r.list[0].label).toBe('Mine');
    expect(r.list[0].stages[0].id).toBe(MY_STAGE_ID);
    expect(r.list[0].stages[0].label).toBe('Common');
    expect(r.list[0].stages[0].prompts).toEqual(['hello']);
    expect(JSON.stringify(list)).toBe(snapshot);
  });

  it('已有同 id 工作流 → 复用它并追加（不新建重复）', () => {
    const list: Workflow[] = [{ id: MY_WF_ID, label: 'Mine', stages: [{ id: MY_STAGE_ID, label: 'Common', prompts: ['a'] }] }];
    const r = collectToMyWorkflow(list, 'b', LABELS);
    expect(r.status).toBe('ok');
    expect(r.list).toHaveLength(1);
    expect(r.list[0].stages[0].prompts).toEqual(['a', 'b']);
  });

  it('已有同 id 工作流但无阶段 → 补一个阶段后写入', () => {
    const list: Workflow[] = [{ id: MY_WF_ID, label: 'Mine', stages: [] }];
    const r = collectToMyWorkflow(list, 'b', LABELS);
    expect(r.status).toBe('ok');
    expect(r.list[0].stages[0].id).toBe(MY_STAGE_ID);
    expect(r.list[0].stages[0].prompts).toEqual(['b']);
  });

  it('重复文本 → exists 且列表不变', () => {
    const list: Workflow[] = [{ id: MY_WF_ID, label: 'Mine', stages: [{ id: MY_STAGE_ID, label: 'Common', prompts: ['a'] }] }];
    const r = collectToMyWorkflow(list, '  a  ', LABELS);
    expect(r.status).toBe('exists');
    expect(r.list[0].stages[0].prompts).toEqual(['a']);
  });

  it('空 / 纯空白文本 → exists 且不创建工作流', () => {
    const r = collectToMyWorkflow([], '   ', LABELS);
    expect(r.status).toBe('exists');
    expect(r.list).toEqual([]);
  });
});
```

> 注意：文件已有的 `import { appendPromptToWorkflow } from './promptCollect';` 不要重复；把 `promptAbbr, collectToMyWorkflow, MY_WF_ID, MY_STAGE_ID` 合并进该 import。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- promptCollect`
Expected: FAIL（`promptAbbr is not a function` / `collectToMyWorkflow is not a function`）

- [ ] **Step 3: 实现**

在 `web/src/prompts/promptCollect.ts` 末尾追加：

```ts
export const MY_WF_ID = 'my-prompts';
export const MY_STAGE_ID = 'my-prompts-stage';

export interface MyWorkflowLabels {
  wfId: string;
  wfLabel: string;
  stageId: string;
  stageLabel: string;
}

export interface MyCollectResult {
  status: 'ok' | 'exists';
  list: Workflow[];
  workflowId: string;
  stageId: string;
}

// 取第一个换行前的内容 → trim → 超 max 截断加 '…'；空 / 纯空白 → ''
export function promptAbbr(text: string, max = 40): string {
  const s = String(text == null ? '' : text);
  const nl = s.search(/[\r\n]/);
  const first = (nl >= 0 ? s.slice(0, nl) : s).trim();
  if (first.length <= max) return first;
  return first.slice(0, max) + '…';
}

// 把完整原文收进「我的工作流」：已有同 id 工作流则复用（缺阶段则补阶段），否则新建。
// 空 / 纯空白文本按 exists 处理且不创建工作流；入参不被修改。
export function collectToMyWorkflow(list: Workflow[], text: string, labels: MyWorkflowLabels): MyCollectResult {
  const wfs = Array.isArray(list) ? list : [];
  const plain = String(text == null ? '' : text);
  const key = plain.trim();
  const wi = wfs.findIndex((w) => w && w.id === labels.wfId);
  if (wi >= 0) {
    const stages = wfs[wi].stages || [];
    if (stages.length === 0) {
      if (!key) return { status: 'exists', list: wfs, workflowId: labels.wfId, stageId: labels.stageId };
      const withStage = wfs.map((w, i) => (i === wi
        ? { ...w, stages: [{ id: labels.stageId, label: labels.stageLabel, group: '', prompts: [plain] }] }
        : w));
      return { status: 'ok', list: withStage, workflowId: labels.wfId, stageId: labels.stageId };
    }
    const si = stages.findIndex((s) => s && s.id === labels.stageId);
    const target = si >= 0 ? stages[si] : stages[0];
    const res = appendPromptToWorkflow(wfs, labels.wfId, target.id, plain);
    if (res.status === 'ok') return { status: 'ok', list: res.list, workflowId: labels.wfId, stageId: target.id };
    return { status: 'exists', list: wfs, workflowId: labels.wfId, stageId: target.id };
  }
  if (!key) return { status: 'exists', list: wfs, workflowId: labels.wfId, stageId: labels.stageId };
  const wf: Workflow = {
    id: labels.wfId,
    label: labels.wfLabel,
    stages: [{ id: labels.stageId, label: labels.stageLabel, group: '', prompts: [plain] }],
  };
  return { status: 'ok', list: [wf, ...wfs], workflowId: labels.wfId, stageId: labels.stageId };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- promptCollect`
Expected: PASS（原 7 项 + 新增 9 项）

- [ ] **Step 5: 提交**

```powershell
git add web/src/prompts/promptCollect.ts web/src/prompts/promptCollect.test.ts
git commit -m "feat(prompts): 提示词缩写与自动建「我的工作流」纯函数"
```

---

### Task 2: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 中文**

`shared/i18n/zh-CN.js`：

- 在 `'hist.empty_messages': '还没有发送过消息，在底部输入框发送后会记录在这里',`（约 437 行）之后插入：
```js
  'hist.empty_prompts': '还没有收藏的提示词',
```
- 删除 `'pc.no_workflows': '还没有工作流，请先在「编辑工作流」里新建',`（约 750 行）。
- 在 `'pc.no_stages': '该工作流还没有阶段',`（约 751 行）之后插入：
```js
  'pc.my_workflow': '我的工作流',
  'pc.my_stage': '常用提示词',
  'pc.add_to_mine': '添加到「我的工作流 / 常用提示词」',
```

- [ ] **Step 2: 英文**

`shared/i18n/en.js`：

- 在 `'hist.empty_messages': 'No messages sent yet. Messages you send appear here',`（约 437 行）之后插入：
```js
  'hist.empty_prompts': 'No saved prompts yet',
```
- 删除 `'pc.no_workflows': 'No workflows yet — create one in "Edit workflow" first',`（约 750 行）。
- 在 `'pc.no_stages': 'This workflow has no stages',`（约 751 行）之后插入：
```js
  'pc.my_workflow': 'My workflows',
  'pc.my_stage': 'Common prompts',
  'pc.add_to_mine': 'Add to "My workflows / Common prompts"',
```

- [ ] **Step 3: 校验中英键对称**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`（本步只管中文命中；键对称由 Task 3 的测试覆盖）

- [ ] **Step 4: 提交**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(prompts): 我的工作流/常用提示词/空态词条，移除 no_workflows"
```

---

### Task 3: `usePromptCollect.collect` 自动建工作流

**Files:**
- Modify: `web/src/prompts/usePromptCollect.ts`
- Test: `web/src/prompts/usePromptCollect.test.ts`

- [ ] **Step 1: 改测试（先失败）**

在 `web/src/prompts/usePromptCollect.test.ts` 中，把第 45-50 行的用例：

```ts
  it('无工作流 → no-workflow，且不发 POST', async () => {
    mockFetch([]);
    const st = await pc.collect('x');
    expect(st).toBe('no-workflow');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });
```

替换为：

```ts
  it('无工作流 → 自动建「我的工作流」并写入，返回 ok', async () => {
    mockFetch([]);
    const st = await pc.collect('x');
    expect(st).toBe('ok');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    const posted = calls[1].body.workflows;
    expect(posted[0].id).toBe('my-prompts');
    expect(posted[0].stages[0].id).toBe('my-prompts-stage');
    expect(posted[0].stages[0].prompts).toEqual(['x']);
    expect(pc.lastTarget.value).toEqual({ workflowId: 'my-prompts', stageId: 'my-prompts-stage' });
  });

  it('无工作流且文本为空白 → exists，不发 POST、不建工作流', async () => {
    mockFetch([]);
    const st = await pc.collect('   ');
    expect(st).toBe('exists');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- usePromptCollect`
Expected: FAIL（实际得到 `no-workflow`）

- [ ] **Step 3: 实现**

`web/src/prompts/usePromptCollect.ts`：

顶部 import 改为：
```ts
import { ref, type Ref } from 'vue';
import type { Workflow } from '../workflowModel';
import { t } from '../i18n';
import { appendPromptToWorkflow, collectToMyWorkflow, MY_WF_ID, MY_STAGE_ID } from './promptCollect';
```

类型改为（移除 `no-workflow`）：
```ts
export type CollectStatus = 'ok' | 'exists' | 'no-stage' | 'error';
```

`collect` 函数整体替换为：
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
      try {
        const r = await fetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflows: res.list }),
        });
        if (!r.ok) return 'error';
        const j: any = await r.json().catch(() => ({}));
        workflows.value = Array.isArray(j && j.workflows) ? j.workflows : res.list;
        writeTarget({ workflowId: res.workflowId, stageId: res.stageId });
        return 'ok';
      } catch { return 'error'; }
    }
    const res = appendPromptToWorkflow(workflows.value, tgt.workflowId, tgt.stageId, text);
    if (res.status === 'no-workflow' || res.status === 'no-stage') return 'no-stage';
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- usePromptCollect`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/prompts/usePromptCollect.ts web/src/prompts/usePromptCollect.test.ts
git commit -m "feat(prompts): 无工作流时自动建「我的工作流」并写入"
```

---

### Task 4: `PromptCollectAddon.vue` 去掉「无工作流」报错

**Files:**
- Modify: `web/src/prompts/PromptCollectAddon.vue`

- [ ] **Step 1: `quickAdd` 去掉守卫**

把：
```ts
async function quickAdd() {
  if (!hasWorkflows.value) { ElMessage.error(t('pc.no_workflows')); return; }
  const status = await pc.collect(props.text);
  toast(status, pc.lastTarget.value);
}
```
改为：
```ts
async function quickAdd() {
  const status = await pc.collect(props.text);
  toast(status, pc.lastTarget.value);
}
```

- [ ] **Step 2: `toast` 去掉 no-workflow 分支**

把：
```ts
  } else if (status === 'no-workflow') {
    ElMessage.error(t('pc.no_workflows'));
  } else if (status === 'no-stage') {
```
改为：
```ts
  } else if (status === 'no-stage') {
```

- [ ] **Step 3: 弹层空态改为「添加到我的工作流」按钮**

把模板中的：
```html
      <div v-else class="pcempty">{{ $t('pc.no_workflows') }}</div>
```
改为：
```html
      <div v-else class="pcnone">
        <button class="pcaddmine" @click="addToMine">{{ $t('pc.add_to_mine') }}</button>
      </div>
```
并在 `<script setup>` 中 `pickLast` 附近加：
```ts
function addToMine() { open.value = false; void quickAdd(); }
```

- [ ] **Step 4: 加样式**

在 `<style scoped>` 末尾追加：
```css
.pcnone { padding: 4px; }
.pcaddmine { width: 100%; text-align: left; background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 5px 8px; cursor: pointer; font-family: inherit; font-size: 12px; }
.pcaddmine:hover { border-color: var(--ac2); color: var(--ac2); }
```

- [ ] **Step 5: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（确认已无 `pc.no_workflows` / `'no-workflow'` 引用）

- [ ] **Step 6: 提交**

```powershell
git add web/src/prompts/PromptCollectAddon.vue
git commit -m "feat(prompts): 收藏控件无工作流时改为添加进我的工作流"
```

---

### Task 5: 左侧「我的工作流」页签

**Files:**
- Modify: `web/src/components/HistoryList.vue`
- Modify: `web/src/windowState.ts:5`
- Modify: `web/src/App.vue:191,196`
- Test: `web/src/components/HistoryList.test.ts`

- [ ] **Step 1: 类型扩展**

`web/src/windowState.ts:5`：
```ts
export type HistoryTab = 'files' | 'messages' | 'tree' | 'prompts';
```

`web/src/components/HistoryList.vue:11`：
```ts
export type SideTab = 'files' | 'messages' | 'tree' | 'prompts';
```

`web/src/App.vue:191`：
```ts
const historyTab = ref<HistoryTab>(NEW_WINDOW ? 'messages' : 'tree');
```
（`HistoryTab` 第 30 行已 import）

`web/src/App.vue:196`：
```ts
const SIDE_TABS = ['messages', 'files', 'tree', 'prompts'];
```

- [ ] **Step 2: HistoryList 脚本 — import 与数据**

在 `HistoryList.vue` 的 import 区加：
```ts
import { usePromptCollect } from '../prompts/usePromptCollect';
import { promptAbbr, MY_WF_ID } from '../prompts/promptCollect';
```

在 `const query = ref('');`（约 61 行）之后加：
```ts
const pc = usePromptCollect();
watch(() => props.tab, (tb) => { if (tb === 'prompts') void pc.loadWorkflows(); }, { immediate: true });

interface PromptRow { stage: string; text: string; }
const myPrompts = computed<PromptRow[]>(() => {
  const w = pc.workflows.value.find((x) => x.id === MY_WF_ID);
  if (!w) return [];
  const out: PromptRow[] = [];
  for (const s of w.stages || []) {
    const label = s.label || s.id;
    for (const p of s.prompts || []) {
      const text = String(p);
      if (text.trim()) out.push({ stage: label, text });
    }
  }
  return out;
});
const filteredPrompts = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return myPrompts.value;
  return myPrompts.value.filter((r) => r.text.toLowerCase().includes(q));
});
```

- [ ] **Step 3: HistoryList 脚本 — 分页/空态守卫**

`hasMore`（约 85-87 行）改为：
```ts
const hasMore = computed(() => {
  if (props.tab === 'files') return fileLimit.value < filteredItems.value.length;
  if (props.tab === 'prompts') return false;
  return msgLimit.value < (treeView.value ? treeTotal.value : filteredMessages.value.length);
});
```

`noMatch`（约 89-94 行）开头加一行：
```ts
  if (props.tab === 'prompts') return false;
```

`onScroll`（约 107-115 行）改为：
```ts
function onScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 40) return;
  if (props.tab === 'files') {
    if (fileLimit.value < filteredItems.value.length) fileLimit.value += PAGE;
  } else if (props.tab === 'prompts') {
    return;
  } else if (msgLimit.value < (treeView.value ? treeTotal.value : filteredMessages.value.length)) {
    msgLimit.value += PAGE;
  }
}
```

- [ ] **Step 4: HistoryList 模板 — 页签与内容**

表头（约 210-214 行）改为：
```html
      <el-tabs v-model="activeTab" class="hltabs">
        <el-tab-pane :label="$t('pc.my_workflow')" name="prompts" />
        <el-tab-pane :label="$t('hist.tab.messages')" name="messages" />
        <el-tab-pane :label="$t('hist.tab.tree')" name="tree" />
        <el-tab-pane :label="$t('hist.tab.files')" name="files" />
      </el-tabs>
```

把 `<div class="list" @scroll.passive="onScroll">` 内、files 的 `</template>` 之后那个 `<template v-else>`（约 254 行）改为在其前插入 prompts 分支：

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
      <template v-else>
```
（即原来的 `<template v-else>` 保持不变，只是前面多了一个 `v-else-if` 分支。）

- [ ] **Step 5: 改测试（先失败）**

`web/src/components/HistoryList.test.ts`：

- 顶部 import 增加 `vi` 与 `flushPromises`、`__resetPromptCollect`：
```ts
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { __resetPromptCollect } from '../prompts/usePromptCollect';
```
- 把「页签切换」用例（约 54-64 行）改为 4 个页签、新顺序：
```ts
  it('页签切换 emit update:tab（我的工作流 / 消息 / 目录 / 最近文件 四个页签）', async () => {
    const w = mount();
    const items = w.findAll('.el-tabs__item');
    expect(items).toHaveLength(4);
    await items[0].trigger('click');
    expect(w.emitted('update:tab')?.[0]).toEqual(['prompts']);
    await items[1].trigger('click');
    expect(w.emitted('update:tab')?.[1]).toEqual(['messages']);
    await items[2].trigger('click');
    expect(w.emitted('update:tab')?.[2]).toEqual(['tree']);
    await items[3].trigger('click');
    expect(w.emitted('update:tab')?.[3]).toEqual(['files']);
  });
```
- 文件末尾追加：
```ts
  it('我的工作流页签：空态提示、收藏展示首行缩写、点击回填完整原文', async () => {
    __resetPromptCollect();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ workflows: [] }) })));
    const empty = mount({ tab: 'prompts' });
    await flushPromises();
    expect(empty.find('.empty').text()).toBe(t('hist.empty_prompts'));

    __resetPromptCollect();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ workflows: [
      { id: 'my-prompts', label: 'Mine', stages: [{ id: 'st1', label: 'Common', prompts: ['first line\nsecond line'] }] },
    ] }) })));
    const w = mount({ tab: 'prompts' });
    await flushPromises();
    const row = w.find('.mrow');
    expect(row.exists()).toBe(true);
    expect(row.find('.mtext').text()).toBe('first line');
    expect(row.attributes('title')).toBe('first line\nsecond line');
    await row.trigger('click');
    expect(w.emitted('open-message')?.[0]).toEqual(['first line\nsecond line']);
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 6: 运行确认失败**

Run: `npm.cmd --prefix web run test -- HistoryList`
Expected: FAIL（页签数量/mount 报错，`.empty` 文案不符）

- [ ] **Step 7: 运行确认通过**

Run: `npm.cmd --prefix web run test -- HistoryList`
Expected: PASS

- [ ] **Step 8: 提交**

```powershell
git add web/src/components/HistoryList.vue web/src/windowState.ts web/src/App.vue web/src/components/HistoryList.test.ts
git commit -m "feat(prompts): 左侧新增「我的工作流」页签展示提示词缩写"
```

---

### Task 6: 工作流编辑器提示词缩写标签

**Files:**
- Modify: `web/src/components/WorkflowFormTab.vue`
- Create: `web/src/components/WorkflowFormTab.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/WorkflowFormTab.test.ts`：
```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountC } from '../test-utils';
import WorkflowFormTab from './WorkflowFormTab.vue';

describe('WorkflowFormTab', () => {
  it('提示词展示首行缩写标签，title 为完整原文', () => {
    const model = [{ id: 'w', label: 'W', stages: [{ id: 's', label: 'S', prompts: ['first line\nsecond line'] }] }];
    const w = mountC(WorkflowFormTab, { props: { model }, global: { stubs: { CodeEditor: true } } });
    const abbr = w.find('.pabbr');
    expect(abbr.exists()).toBe(true);
    expect(abbr.text()).toBe('first line');
    expect(abbr.attributes('title')).toBe('first line\nsecond line');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- WorkflowFormTab`
Expected: FAIL（`.pabbr` 不存在）

- [ ] **Step 3: 实现**

`web/src/components/WorkflowFormTab.vue`：

import 区加：
```ts
import { promptAbbr } from '../prompts/promptCollect';
```

模板 `.prow`（约 172-178 行）中，在 `.handle` 之后、`CodeEditor` 之前插入：
```html
            <span v-if="p.trim()" class="pabbr" :title="p">{{ promptAbbr(p) }}</span>
```

`<style scoped>` 末尾追加：
```css
.pabbr { flex: none; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--tx3); align-self: center; }
```

- [ ] **Step 4: 运行确认通过**

Run: `npm.cmd --prefix web run test -- WorkflowFormTab`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/components/WorkflowFormTab.vue web/src/components/WorkflowFormTab.test.ts
git commit -m "feat(prompts): 工作流编辑器提示词展示首行缩写"
```

---

### Task 7: 文档与全量验证

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 更新 AGENTS.md「目录速览」**

在既有 `提示词收藏（prompts）：` 一节末尾补一句（保持该行风格）：
```
无工作流时点「＋」自动建「我的工作流 / 常用提示词」并写入；左侧历史面板新增「我的工作流」页签，按首行缩写展示收藏的提示词（点击回填完整原文），缩写规则见 `web/src/prompts/promptCollect.ts` 的 `promptAbbr`。
```

- [ ] **Step 2: 全量测试**

Run: `npm.cmd test`
Expected: server 与 web 全部 PASS

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 4: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`

- [ ] **Step 5: 手工验收（dev）**

Run（两个后台终端，日志写 `logs\`）：
```powershell
npm.cmd run dev:server
npm.cmd run dev:web
```
在 http://localhost:5173 验收：
1. 清空所有工作流（编辑工作流里删光）后，左侧「消息」点 `＋` → 不再报「还没有工作流」，提示成功；
2. 左侧切到「我的工作流」页签 → 看到该条首行缩写，悬停显示全文，点击后完整原文填入终端输入框；
3. 再收藏一条多行消息 → 列表新增其首行缩写；
4. 打开「编辑工作流」→ 该提示词行左侧显示首行缩写，悬停看全文；
5. 重复收藏同一条 → 提示「已存在」，不重复。

- [ ] **Step 6: 提交**

```powershell
git add AGENTS.md
git commit -m "docs(prompts): 目录速览补充我的工作流与缩写说明"
```

---

## 提交前检查（每次 commit / push 前）

按 `AGENTS.md`「提交/推送」执行 `docs/learn/git仓库提交检查和提交事项.md` 的清单，尤其敏感信息扫描：

```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat_|-----BEGIN [A-Z ]*PRIVATE KEY-----"
```

---

## Self-Review 记录

- **Spec 覆盖**：4.1→Task1；4.2→Task3；4.3→Task4；4.4→Task5；4.5→Task6；i18n→Task2；测试/验证/文档→Task7。无缺口。
- **占位符扫描**：无 TBD/TODO；每个代码步骤给出完整代码与命令。
- **类型一致性**：`CollectStatus` 统一为 `'ok' | 'exists' | 'no-stage' | 'error'`；`MY_WF_ID='my-prompts'`、`MY_STAGE_ID='my-prompts-stage'` 在纯函数、数据层、页签、测试中一致；`promptAbbr` 默认 `max=40` 一致。
