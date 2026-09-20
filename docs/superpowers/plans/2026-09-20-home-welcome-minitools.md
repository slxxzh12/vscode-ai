# 空白首页（欢迎页 + 小工具入口）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 本仓库按 AGENTS.md：执行用 **inline（本会话）**，且**未经用户明确要求不 commit**——下方每一步的「Commit」已省略，改为本地验证。

**Goal:** 首次进入无页签时不再强开 Agent，改为显示欢迎页（新建 Agent 为主按钮 + 小工具介绍卡片，点击跳到应用市场并打开该工具）。

**Architecture:** 纯前端。新增两个模块（`tools/catalog.ts` 工具元数据单一来源、`uiIntents.ts` 跨挂载待办意图）；新增 `WelcomeView.vue` 作为空白覆盖层由 `TerminalView` 渲染；`TerminalView` 删除自动 `startAgent()`；`MiniTools`/`AppMarketView`/`App` 做小接入。

**Tech Stack:** Vue 3 `<script setup>` + TS、vitest + happy-dom、vue-tsc、Element Plus（仅 MiniTools 现有弹窗）。

**Spec:** `docs/superpowers/specs/2026-09-20-home-welcome-minitools-design.md`

---

## File Structure

- Create `web/src/tools/catalog.ts` — 工具元数据（id/icon/labelKey/descKey）。
- Create `web/src/uiIntents.ts` — `pendingTool` / `pendingStartAgent` 及读写函数。
- Create `web/src/components/WelcomeView.vue` — 欢迎页（覆盖层）。
- Create `web/src/uiIntents.test.ts`、`web/src/components/WelcomeView.test.ts`。
- Modify `web/src/components/MiniTools.vue` — 改用 `MINI_TOOLS`；监听 `pendingTool`。
- Modify `web/src/components/TerminalView.vue` — 删自动 `startAgent()`；渲染欢迎页；处理 `pendingStartAgent`。
- Modify `web/src/components/AppMarketView.vue` — 顶部「新建 Agent」入口。
- Modify `web/src/App.vue` — 监听 `df-add-folder`。
- Modify `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — 新增 `welcome.*`、`tools.desc.*`。
- Test `web/src/components/MiniTools.test.ts` — 增加 `pendingTool` 用例。

---

## Task 1: 工具元数据单一来源 `tools/catalog.ts`

**Files:**
- Create: `web/src/tools/catalog.ts`

- [ ] **Step 1: 新建 catalog.ts**

```ts
export type ToolId = 'translate' | 'yaml' | 'js' | 'sort' | 'postman';

export interface MiniToolMeta {
  id: ToolId;
  icon: string;
  labelKey: string;
  descKey: string;
  disabled?: boolean;
  hint?: string;
}

export const MINI_TOOLS: MiniToolMeta[] = [
  { id: 'translate', icon: '🌐', labelKey: 'tools.translate', descKey: 'tools.desc.translate' },
  { id: 'yaml', icon: '🧾', labelKey: 'tools.yaml', descKey: 'tools.desc.yaml' },
  { id: 'js', icon: '⚙', labelKey: 'tools.js', descKey: 'tools.desc.js' },
  { id: 'sort', icon: '↕', labelKey: 'tools.sort', descKey: 'tools.desc.sort' },
  { id: 'postman', icon: '📮', labelKey: 'tools.postman', descKey: 'tools.desc.postman' },
];
```

- [ ] **Step 2: 接入 MiniTools（本任务先只替换元数据）**

`web/src/components/MiniTools.vue`：删除顶部 `type ToolId = ...` 与内联 `TOOLS`，改为：

```ts
import { MINI_TOOLS, type ToolId } from '../tools/catalog';
...
const TOOLS = MINI_TOOLS;
```

其余逻辑与模板保持不变（`TOOLS` 名字不变，`openTool`、模板 `v-for="x in TOOLS"` 均复用）。

- [ ] **Step 3: 运行 MiniTools 现有测试**

Run: `npm.cmd test --workspace web -- MiniTools`（若脚本不便，直接 `npx vitest run src/components/MiniTools.test.ts`，workdir=`web`）
Expected: 8 条全 PASS（渲染仍为 5 个 `.mticon`）。

---

## Task 2: 待办意图 `uiIntents.ts`

**Files:**
- Create: `web/src/uiIntents.ts`
- Test: `web/src/uiIntents.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  pendingTool, pendingStartAgent,
  requestTool, clearPendingTool,
  requestStartAgent, clearPendingStartAgent,
} from './uiIntents';

beforeEach(() => { clearPendingTool(); clearPendingStartAgent(); });

describe('uiIntents', () => {
  it('requestTool 置位并可清除', () => {
    expect(pendingTool.value).toBeNull();
    requestTool('yaml');
    expect(pendingTool.value).toBe('yaml');
    clearPendingTool();
    expect(pendingTool.value).toBeNull();
  });

  it('requestStartAgent 置位并可清除', () => {
    expect(pendingStartAgent.value).toBe(false);
    requestStartAgent();
    expect(pendingStartAgent.value).toBe(true);
    clearPendingStartAgent();
    expect(pendingStartAgent.value).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/uiIntents.test.ts`（workdir=`web`）
Expected: FAIL（模块不存在 / 导入失败）。

- [ ] **Step 3: 实现**

```ts
import { ref } from 'vue';
import type { ToolId } from './tools/catalog';

// 跨组件/跨挂载的「待处理意图」：组件可能因 rail 切换被卸载，一次性事件会丢，故用模块级标记。
export const pendingTool = ref<ToolId | null>(null);
export const pendingStartAgent = ref(false);

export function requestTool(id: ToolId) { pendingTool.value = id; }
export function clearPendingTool() { pendingTool.value = null; }

export function requestStartAgent() { pendingStartAgent.value = true; }
export function clearPendingStartAgent() { pendingStartAgent.value = false; }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/uiIntents.test.ts`（workdir=`web`）
Expected: PASS（2 条）。

---

## Task 3: MiniTools 响应 `pendingTool` 自动打开

**Files:**
- Modify: `web/src/components/MiniTools.vue`
- Test: `web/src/components/MiniTools.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `MiniTools.test.ts` 顶部导入并扩展 `afterEach`：

```ts
import { pendingTool, clearPendingTool } from '../uiIntents';

afterEach(() => { vi.unstubAllGlobals(); writeText.mockClear(); clearPendingTool(); });
```

在 `describe('MiniTools', ...)` 内追加：

```ts
  it('pendingTool 置值时自动打开对应工具', async () => {
    pendingTool.value = 'yaml';
    const w = mount();
    await flushPromises();
    expect(w.find('.mtbody').exists()).toBe(true);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/MiniTools.test.ts`（workdir=`web`）
Expected: 新增用例 FAIL（弹窗未打开）。

- [ ] **Step 3: 实现**

`MiniTools.vue` `<script setup>` 中导入并在 `openTool` 定义之后加：

```ts
import { pendingTool, clearPendingTool } from '../uiIntents';
...
watch(pendingTool, (id) => {
  if (!id) return;
  openTool(id);
  clearPendingTool();
}, { immediate: true });
```

（`watch` 需从 `vue` 导入：`import { computed, ref, watch } from 'vue';`）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/MiniTools.test.ts`（workdir=`web`）
Expected: 9 条全 PASS。

---

## Task 4: 欢迎页 `WelcomeView.vue`

**Files:**
- Create: `web/src/components/WelcomeView.vue`
- Test: `web/src/components/WelcomeView.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountC } from '../test-utils';
import WelcomeView from './WelcomeView.vue';

function mount() { return mountC(WelcomeView); }

describe('WelcomeView', () => {
  it('渲染主按钮与 5 张工具卡片', () => {
    const w = mount();
    expect(w.find('.wprimary').exists()).toBe(true);
    expect(w.findAll('.tcard')).toHaveLength(5);
  });

  it('点主按钮 emit new-agent', async () => {
    const w = mount();
    await w.find('.wprimary').trigger('click');
    expect(w.emitted('new-agent')).toHaveLength(1);
  });

  it('点工具卡片 emit open-tool 带 id', async () => {
    const w = mount();
    await w.findAll('.tcard')[1].trigger('click');
    expect(w.emitted('open-tool')?.[0]).toEqual(['yaml']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/WelcomeView.test.ts`（workdir=`web`）
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现组件**

```vue
<script setup lang="ts">
import { MINI_TOOLS, type ToolId } from '../tools/catalog';

const emit = defineEmits<{ (e: 'new-agent'): void; (e: 'open-tool', id: ToolId): void }>();
</script>

<template>
  <div class="welcome">
    <div class="whero">
      <div class="wtitle">{{ $t('welcome.title') }}</div>
      <div class="wsub">{{ $t('welcome.subtitle') }}</div>
      <button class="wprimary" @click="emit('new-agent')">
        <span class="wplus">＋</span>
        <span class="wtext">
          <span class="wmain">{{ $t('welcome.new_agent') }}</span>
          <span class="whint">{{ $t('welcome.new_agent_hint') }}</span>
        </span>
      </button>
    </div>

    <div class="wtools">
      <div class="wthead">{{ $t('welcome.tools_title') }}</div>
      <div class="wthint">{{ $t('welcome.tools_hint') }}</div>
      <div class="wgrid">
        <button v-for="x in MINI_TOOLS" :key="x.id" class="tcard" :title="$t(x.labelKey)" @click="emit('open-tool', x.id)">
          <span class="ticon">{{ x.icon }}</span>
          <span class="tname">{{ $t(x.labelKey) }}</span>
          <span class="tdesc">{{ $t(x.descKey) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome { position: absolute; inset: 0; z-index: 4; background: var(--bg3); color: var(--tx); overflow: auto; display: flex; flex-direction: column; align-items: center; padding: 40px 24px; box-sizing: border-box; gap: 28px; }
.whero { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; max-width: 640px; }
.wtitle { color: var(--tx1); font-size: 24px; font-weight: 700; }
.wsub { color: var(--tx3); font-size: 13px; line-height: 1.6; }
.wprimary { margin-top: 8px; display: flex; align-items: center; gap: 14px; background: var(--ac); color: var(--onac); border: none; border-radius: 12px; padding: 14px 26px; cursor: pointer; }
.wprimary:hover { filter: brightness(1.08); }
.wplus { font-size: 28px; line-height: 1; }
.wtext { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.wmain { font-size: 17px; font-weight: 700; }
.whint { font-size: 12px; opacity: .85; }
.wtools { width: 100%; max-width: 760px; }
.wthead { color: var(--tx1); font-size: 14px; font-weight: 700; margin-bottom: 4px; }
.wthint { color: var(--tx4); font-size: 12px; margin-bottom: 12px; }
.wgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.tcard { display: flex; flex-direction: column; align-items: center; gap: 6px; background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 14px; padding: 18px 12px; cursor: pointer; text-align: center; }
.tcard:hover { border-color: var(--ac2); color: var(--ac2); }
.ticon { font-size: 30px; line-height: 1; }
.tname { font-size: 14px; font-weight: 600; }
.tdesc { color: var(--tx4); font-size: 11px; line-height: 1.4; }
</style>
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/WelcomeView.test.ts`（workdir=`web`）
Expected: PASS（3 条）。

---

## Task 5: i18n 词条（中英同步）

**Files:**
- Modify: `shared/i18n/zh-CN.js`（`tools.pm_rename_failed` 之后、`term.new_session_btn` 之前插入）
- Modify: `shared/i18n/en.js`（对应位置）

- [ ] **Step 1: 中文词条**

```js
  'tools.desc.translate': '文本翻译',
  'tools.desc.yaml': 'YAML 校验 / 格式化',
  'tools.desc.js': 'JS 代码压缩',
  'tools.desc.sort': '文本排序 / 去重',
  'tools.desc.postman': '粘贴 curl 直接执行',
  'welcome.title': '开始使用',
  'welcome.subtitle': '新建 Agent 开始对话，或使用下方小工具',
  'welcome.new_agent': '新建 Agent',
  'welcome.new_agent_hint': '推荐 · 在所选项目目录启动 Agent',
  'welcome.tools_title': '小工具',
  'welcome.tools_hint': '点击卡片跳转到应用市场并打开对应小工具',
```

- [ ] **Step 2: 英文词条（同一位置）**

```js
  'tools.desc.translate': 'Translate text',
  'tools.desc.yaml': 'Validate / format YAML',
  'tools.desc.js': 'Minify JS',
  'tools.desc.sort': 'Sort / dedupe text',
  'tools.desc.postman': 'Paste cURL and run it',
  'welcome.title': 'Get started',
  'welcome.subtitle': 'Start an Agent session, or pick a mini tool below',
  'welcome.new_agent': 'New Agent',
  'welcome.new_agent_hint': 'Recommended · launch an Agent in the selected project',
  'welcome.tools_title': 'Mini tools',
  'welcome.tools_hint': 'Click a card to open that tool in the App Market',
```

- [ ] **Step 3: 校验对称**

Run: `npm.cmd run check:i18n`
Expected: PASS（无缺失/不对称、用户可见范围无硬编码中文）。

---

## Task 6: TerminalView 接入（删自动 Agent + 欢迎页 + 意图）

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 新增导入**

在文件顶部导入区加：

```ts
import WelcomeView from './WelcomeView.vue';
import { pendingStartAgent, clearPendingStartAgent, requestTool } from '../uiIntents';
import type { ToolId } from '../tools/catalog';
```

- [ ] **Step 2: 删除「无会话强开 Agent」**

`SESSION_LIST` 处理（约 861-883 行）中，把：

```ts
    if (existing) {
      agentSid.value = existing.id;                       // 重新挂载后绑定回固定 Agent 会话
      agentProjectId.value = existing.projectId ?? null;
      props.terminal.switchTo(existing.id);               // 复用已存在的 Agent 会话
      if (props.projectId && existing.projectId !== props.projectId) void restartAgentForProject();   // 项目已切换：换到当前目录
    } else startAgent();                                  // 默认先开一个默认 Agent 会话
```

改为（去掉 `else startAgent();`）：

```ts
    if (existing) {
      agentSid.value = existing.id;                       // 重新挂载后绑定回固定 Agent 会话
      agentProjectId.value = existing.projectId ?? null;
      props.terminal.switchTo(existing.id);               // 复用已存在的 Agent 会话
      if (props.projectId && existing.projectId !== props.projectId) void restartAgentForProject();   // 项目已切换：换到当前目录
    }
```

- [ ] **Step 3: 新增欢迎页状态与处理（放在 `restartAgentForProject` 的 `watch(...)` 之后，约 528 行后）**

```ts
// —— 空白首页：无页签时显示欢迎页（不再自动强开 Agent）——
const showWelcome = computed(() => !props.phone && props.center.tabs.value.length === 0);
function onWelcomeNewAgent() {
  if (props.phone) return;
  if (!props.projectId) { window.dispatchEvent(new CustomEvent('df-add-folder')); return; }
  void startAgent();
}
function onWelcomeOpenTool(id: ToolId) {
  requestTool(id);
  window.location.hash = '#mobile';
}
watch(pendingStartAgent, () => {
  if (!pendingStartAgent.value) return;
  clearPendingStartAgent();
  onWelcomeNewAgent();
}, { immediate: true });
```

- [ ] **Step 4: 模板加欢迎页覆盖层**

在 `<div class="center-wrap">` 内、`<div v-show="isSessionView" class="term-wrap">`（约 1169 行）之前插入：

```html
    <WelcomeView v-if="showWelcome" @new-agent="onWelcomeNewAgent" @open-tool="onWelcomeOpenTool" />
```

- [ ] **Step 5: 类型检查与既有测试**

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npx vitest run src/useTerminal.test.ts src/sessionRestore.test.ts`（workdir=`web`）
Expected: PASS（本改动不影响这两个模块）。

---

## Task 7: 应用市场页「新建 Agent」入口

**Files:**
- Modify: `web/src/components/AppMarketView.vue`

- [ ] **Step 1: 导入与处理函数**

`<script setup>` 加：

```ts
import { requestStartAgent } from '../uiIntents';
...
function startAgentNow() {
  requestStartAgent();
  window.location.hash = '#explorer/tree';
}
```

- [ ] **Step 2: 模板加显眼入口**

在 `.col-main` 的第一个 `<section class="block tools-block">` 之前插入：

```html
      <section class="block newagent-block">
        <button class="newagent" @click="startAgentNow">＋ {{ $t('welcome.new_agent') }}</button>
      </section>
```

- [ ] **Step 3: 样式**

`<style scoped>` 追加：

```css
  .newagent-block { border: 1px solid var(--ac); border-radius: 14px; padding: 12px; background: color-mix(in srgb, var(--ac) 12%, var(--bg2)); }
  .newagent { width: 100%; background: var(--ac); color: var(--onac); border: none; border-radius: 10px; padding: 12px 18px; font-size: 15px; font-weight: 700; cursor: pointer; }
  .newagent:hover { filter: brightness(1.08); }
```

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

---

## Task 8: App 监听 `df-add-folder`

**Files:**
- Modify: `web/src/App.vue`

- [ ] **Step 1: 注册监听**

`onMounted` 内、`window.addEventListener('df-open-history', onOpenHistory);` 附近加：

```ts
  window.addEventListener('df-add-folder', openAddFolder);
```

- [ ] **Step 2: 注销监听**

`onBeforeUnmount` 内、对应位置加：

```ts
  window.removeEventListener('df-add-folder', openAddFolder);
```

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

---

## Task 9: 全量验证

- [ ] **Step 1: 前端单测**

Run: `npx vitest run`（workdir=`web`）
Expected: 全 PASS（含新增 `uiIntents` 2 条、`WelcomeView` 3 条、`MiniTools` 9 条）。

- [ ] **Step 2: 服务端测试**

Run: `npm.cmd run test:server`
Expected: 全 PASS（无服务端改动，回归）。

- [ ] **Step 3: i18n 与类型**

Run: `npm.cmd run check:i18n`；然后 `npm.cmd run typecheck`
Expected: 均 PASS。

- [ ] **Step 4: 手工验收（dev，端口 33333）**

1. 全新档案（清空/换端口）启动 dev：进入界面**无任何页签、无 Agent 会话**，中心显示欢迎页。
2. 点「新建 Agent」：出现会话页签并进入终端，欢迎页消失。
3. 关闭全部页签：欢迎页重现；点某小工具卡片 → 跳到「应用市场」且该工具面板已打开。
4. 应用市场顶部「新建 Agent」→ 回到终端并新建 Agent 会话。
5. 无项目时点「新建 Agent」→ 弹出「添加目录」。
6. 有历史页签时刷新：仍按最近 N 个恢复，行为不变。

---

## Self-Review

- **Spec coverage：** §4.1→Task6 Step2；§4.2→Task1；§4.3→Task2；§4.4→Task4+Task6；§4.5→Task3/6/7/8；§4.6→Task5；§4.7 数据流由 6/7 共同实现；§6 测试→Task2/3/4/9。
- **Placeholder：** 无 TBD/TODO；每个代码步骤给出完整片段。
- **Type consistency：** `pendingTool`/`pendingStartAgent`/`requestTool`/`clearPendingTool`/`requestStartAgent`/`clearPendingStartAgent` 在 Task2 定义，Task3/6/7 使用一致；`ToolId`、`MINI_TOOLS` 在 Task1 定义并在 3/4/6 使用一致。
