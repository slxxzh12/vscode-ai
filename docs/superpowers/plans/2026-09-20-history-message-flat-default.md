# 历史面板「全部会话」平铺默认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在历史面板「全部会话」下恢复平铺视图并设为默认，保留会话树作为可切换样式，选择随窗口状态持久化。

**Architecture:** 纯前端改动。`windowState` 增加 `msgAllStyle` 字段与合法性校验；`App.vue` 持状态并随 `msgFilter` 一起持久化；`HistoryList.vue` 新增 `allStyle` prop / `update:all-style` emit、`treeView` 派生与筛选栏子切换，平铺分支复用现有模板。服务端与 `void.db` 均不改。

**Tech Stack:** Vue 3 + TypeScript、Vitest + happy-dom + @vue/test-utils、Element Plus、仓库内 i18n（`shared/i18n/zh-CN.js` + `en.js`）。

**依据设计：** `docs/superpowers/specs/2026-09-20-history-message-flat-default-design.md`

**提交规范：** 每次 commit 前先执行 `docs/learn/git仓库提交检查和提交事项.md` 的检查清单；只 `git add` 本次任务涉及的文件（工作区可能有其它未提交改动）。

**测试命令约定：** 在仓库根运行；单文件用 `npm.cmd --prefix web run test -- <相对 web 的路径>`，全量用 `npm.cmd test`。

---

## 文件结构

- Modify: `web/src/windowState.ts` — 新增 `AllStyle` 类型、`WindowState`/`RestorePlan` 字段、`planRestore` 校验。
- Modify: `web/src/windowState.test.ts` — 覆盖 `planRestore` 对 `msgAllStyle` 的合法/非法处理。
- Modify: `shared/i18n/zh-CN.js` / `shared/i18n/en.js` — 新增 3 个 `hist.style.*` 词条（中英对称）。
- Modify: `web/src/components/HistoryList.vue` — prop/emit、`treeView`、子切换、模板分支与分页判定。
- Modify: `web/src/components/HistoryList.test.ts` — 既有树测试补 `allStyle:'tree'`，新增平铺默认/切换/可见性测试。
- Modify: `web/src/App.vue` — `msgAllStyle` 状态、持久化、传参与回传。

无新增文件（除本计划与设计文档）。

---

## Task 1: windowState 增加 msgAllStyle 字段与校验

**Files:**
- Modify: `web/src/windowState.ts:8-22`, `web/src/windowState.ts:51-75`
- Test: `web/src/windowState.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/windowState.test.ts` 的 `describe('planRestore', ...)` 块内（`新窗口无存档时...` 那个 `it` 之后、块结束 `});` 之前）追加：

```ts
  it('恢复合法的 msgAllStyle，忽略非法值', () => {
    const opts = { projectIds: [], hashRail: null, hashHistoryTab: null, deepLinkOpened: false };
    expect(planRestore({ msgAllStyle: 'flat' }, opts).msgAllStyle).toBe('flat');
    expect(planRestore({ msgAllStyle: 'tree' }, opts).msgAllStyle).toBe('tree');
    expect(planRestore({ msgAllStyle: 'nope' } as unknown as WindowState, opts).msgAllStyle).toBeUndefined();
    expect(planRestore({}, opts).msgAllStyle).toBeUndefined();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/windowState.test.ts`
Expected: 类型检查/断言失败（`msgAllStyle` 不在 `WindowState`/`RestorePlan` 类型上，运行时 `plan.msgAllStyle` 为 `undefined`，`'flat'` 断言失败）。

- [ ] **Step 3: 实现**

`web/src/windowState.ts`：

1) 在第 5 行 `HistoryTab` 定义之后新增类型：

```ts
export type AllStyle = 'flat' | 'tree';
```

2) `WindowState`（第 8-14 行）内、`msgFilter?: boolean;` 之后加一行：

```ts
  msgAllStyle?: AllStyle;
```

3) `RestorePlan`（第 16-22 行）内、`msgFilter?: boolean;` 之后加一行：

```ts
  msgAllStyle?: AllStyle;
```

4) `planRestore` 中，`if (typeof state.msgFilter === 'boolean') plan.msgFilter = state.msgFilter;`（第 68 行）之后加：

```ts
  if (state.msgAllStyle === 'flat' || state.msgAllStyle === 'tree') plan.msgAllStyle = state.msgAllStyle;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/windowState.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add web/src/windowState.ts web/src/windowState.test.ts
git commit -m "feat(web): windowState 增加 msgAllStyle 存档与恢复校验"
```

---

## Task 2: 新增 hist.style.* 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:387`（`hist.filter.title` 之后）
- Modify: `shared/i18n/en.js:387`（`hist.filter.title` 之后）

- [ ] **Step 1: 加中文词条**

`shared/i18n/zh-CN.js`，在 `'hist.filter.title': ...` 行之后插入：

```js
  'hist.style.flat': '平铺',
  'hist.style.tree': '分会话',
  'hist.style.title': '平铺：全部消息混排；分会话：按会话分组的树',
```

- [ ] **Step 2: 加英文词条**

`shared/i18n/en.js`，在 `'hist.filter.title': ...` 行之后插入：

```js
  'hist.style.flat': 'Flat',
  'hist.style.tree': 'By session',
  'hist.style.title': 'Flat: all messages mixed; By session: grouped tree',
```

- [ ] **Step 3: 校验中英键对称**

Run: `npm.cmd run check:i18n`
Expected: 通过（无缺失/多余键告警）。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n(hist): 全部会话平铺/分会话样式词条"
```

---

## Task 3: HistoryList 支持平铺/分会话切换

**Files:**
- Modify: `web/src/components/HistoryList.vue`
- Test: `web/src/components/HistoryList.test.ts`

- [ ] **Step 1: 改写并新增测试**

`web/src/components/HistoryList.test.ts`：

1) 给既有 4 个「全部会话」树测试的 `mount(...)` 补 `allStyle: 'tree'`：
   - `mount({ tab: 'messages', filter: false, messages, liveSessionIds: ['s2'] })` → 追加 `allStyle: 'tree'`
   - `mount({ tab: 'messages', filter: false, messages: [], sessions: [{ id: 's9', name: '空会话' }] })` → 追加 `allStyle: 'tree'`
   - `mount({ tab: 'messages', filter: false, messages: [{ text: 'x', ts: 1, tabName: 'only' }] })` → 追加 `allStyle: 'tree'`
   - `mount({ tab: 'messages', filter: false, messages, sessions: [...], sessionNames: {...} })` → 追加 `allStyle: 'tree'`

2) 在 `仅当前会话：仍是平铺消息` 那个 `it` 之后、`describe` 结束前追加：

```ts
  it('全部会话：默认平铺，不渲染会话树', async () => {
    const messages = [
      { text: 'm1', ts: 100, sessionId: 's1', tabName: 'A' },
      { text: 'm2', ts: 200, sessionId: 's2', tabName: 'B' },
    ];
    const w = mount({ tab: 'messages', filter: false, messages });
    await w.vm.$nextTick();
    expect(w.findAll('.tnode')).toHaveLength(0);
    expect(w.findAll('.mrow')).toHaveLength(2);
    expect(w.findAll('.mtab').map((x) => x.text())).toEqual(['A', 'B']);
  });

  it('全部会话：显式 allStyle=tree 时渲染会话树', async () => {
    const messages = [{ text: 'm1', ts: 100, sessionId: 's1', tabName: 'A' }];
    const w = mount({ tab: 'messages', filter: false, allStyle: 'tree', messages });
    await w.vm.$nextTick();
    expect(w.findAll('.tnode')).toHaveLength(1);
    expect(w.findAll('.mrow')).toHaveLength(0);
  });

  it('样式子切换仅在全部会话出现，点击 emit update:all-style', async () => {
    const cur = mount({ tab: 'messages', filter: true });
    expect(cur.find('.stylebtn').exists()).toBe(false);

    const off = mount({ tab: 'messages', filter: false });
    const btns = off.findAll('.stylebtn');
    expect(btns).toHaveLength(2);
    expect(btns[0].text()).toBe(t('hist.style.flat'));
    expect(btns[1].text()).toBe(t('hist.style.tree'));
    expect(btns[0].classes()).toContain('on');
    expect(btns[1].classes()).not.toContain('on');
    await btns[1].trigger('click');
    expect(off.emitted('update:all-style')?.[0]).toEqual(['tree']);
    await btns[0].trigger('click');
    expect(off.emitted('update:all-style')?.[1]).toEqual(['flat']);

    const files = mount({ tab: 'files' });
    expect(files.find('.stylebtn').exists()).toBe(false);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/components/HistoryList.test.ts`
Expected: 新增三个用例 FAIL（无 `.stylebtn`；`allStyle` 未定义时树仍按 `!filter` 渲染导致「默认平铺」用例 FAIL）；4 个改过的树用例仍 PASS。

- [ ] **Step 3: 实现组件**

`web/src/components/HistoryList.vue`：

1) props（第 10-22 行）：在 props 类型里加 `allStyle?: 'flat' | 'tree';`，并在 `withDefaults` 默认值里加 `allStyle: 'flat',`：

```ts
const props = withDefaults(defineProps<{
  items: HistoryEntry[]; tab: SideTab; messages: HistoryMessage[];
  filter?: boolean; liveSessionIds?: string[]; sessions?: SessionExtra[];
  projectId?: string | null; activePath?: string | null;
  sessionNames?: Record<string, string>;
  allStyle?: 'flat' | 'tree';
}>(), {
  filter: true,
  liveSessionIds: () => [],
  sessions: () => [],
  projectId: null,
  activePath: null,
  sessionNames: () => ({}),
  allStyle: 'flat',
});
```

2) emits（第 23-35 行）内加一行：

```ts
  (e: 'update:all-style', v: 'flat' | 'tree'): void;
```

3) 在第 49 行 `watch(query, ...)` 之后加派生与重置：

```ts
// 全部会话的展示样式：tree=会话树；其余（含 filter=true）走平铺
const treeView = computed(() => !props.filter && props.allStyle === 'tree');
watch(() => props.allStyle, () => { msgLimit.value = PAGE; });
```

4) `hasMore`（第 67-69 行）改为：

```ts
const hasMore = computed(() => props.tab === 'files'
  ? fileLimit.value < filteredItems.value.length
  : msgLimit.value < (treeView.value ? treeTotal.value : filteredMessages.value.length));
```

5) `noMatch`（第 71-77 行）改为：

```ts
const noMatch = computed(() => {
  if (!searching.value) return false;
  if (props.tab === 'files') return props.items.length > 0 && filteredItems.value.length === 0;
  if (treeView.value) return (props.messages.length > 0 || props.sessions.length > 0) && treeNodes.value.length === 0;
  return props.messages.length > 0 && filteredMessages.value.length === 0;
});
```

6) `onScroll`（第 90-98 行）的消息分支改为：

```ts
  } else if (msgLimit.value < (treeView.value ? treeTotal.value : filteredMessages.value.length)) {
    msgLimit.value += PAGE;
  }
```

7) 筛选栏（第 190-193 行）整体替换为：

```html
    <div v-if="tab === 'messages'" class="filterbar" :title="$t('hist.filter.title')">
      <button class="filterbtn" :class="{ on: filter }" @click="emit('update:filter', true)">{{ $t('hist.filter.on') }}</button>
      <button class="filterbtn" :class="{ on: !filter }" @click="emit('update:filter', false)">{{ $t('hist.filter.off') }}</button>
      <template v-if="!filter">
        <span class="filtergap" />
        <button class="stylebtn" :class="{ on: allStyle === 'flat' }" :title="$t('hist.style.title')" @click="emit('update:all-style', 'flat')">{{ $t('hist.style.flat') }}</button>
        <button class="stylebtn" :class="{ on: allStyle === 'tree' }" :title="$t('hist.style.title')" @click="emit('update:all-style', 'tree')">{{ $t('hist.style.tree') }}</button>
      </template>
    </div>
```

8) 模板分支（第 221 行）：把 `<template v-if="!filter">` 改为 `<template v-if="treeView">`（其后的 `<template v-else>` 不动）。

9) 底部统计（第 271 行）改为：

```html
      <div v-else-if="(tab === 'files' ? filteredItems.length : (treeView ? treeTotal : filteredMessages.length)) > 0" class="foot">{{ $t('hist.foot') }}</div>
```

10) 样式（第 289-292 行附近）：把 `.filterbtn` 三条规则扩成同时作用于 `.stylebtn`，并加 `.filtergap`：

```css
.filterbtn, .stylebtn { background: none; border: 1px solid var(--bd); color: var(--tx5); border-radius: 4px; padding: 1px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; }
.filterbtn:hover, .stylebtn:hover { border-color: var(--ac2); color: var(--ac2); }
.filterbtn.on, .stylebtn.on { color: var(--ac2); border-color: var(--ac2); }
.filtergap { flex: 1 1 auto; }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/components/HistoryList.test.ts`
Expected: PASS（含既有全部用例）。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/HistoryList.vue web/src/components/HistoryList.test.ts
git commit -m "feat(web): 全部会话支持平铺/分会话切换并默认平铺"
```

---

## Task 4: App.vue 接线并持久化选择

**Files:**
- Modify: `web/src/App.vue:23`, `web/src/App.vue:193`, `web/src/App.vue:254-262`, `web/src/App.vue:275`, `web/src/App.vue:293-296`, `web/src/App.vue:674-679`

- [ ] **Step 1: 导入类型**

`web/src/App.vue` 第 23 行，`windowState` 导入里加 `type AllStyle`：

```ts
import { fetchWindowState, planRestore, saveWindowState, flushWindowState, toSavedTabs, type HistoryTab, type Rail, type AllStyle } from './windowState';
```

- [ ] **Step 2: 新增状态**

第 193 行 `const msgFilter = ref(true);` 之后加：

```ts
const msgAllStyle = ref<AllStyle>('flat');   // 「全部会话」的展示样式：flat=平铺（默认），tree=会话树
```

- [ ] **Step 3: 存档**

`currentWindowState()`（第 254-262 行）在 `msgFilter: msgFilter.value,` 之后加：

```ts
    msgAllStyle: msgAllStyle.value,
```

- [ ] **Step 4: 恢复**

`restoreWindowState` 中 `if (typeof plan.msgFilter === 'boolean') msgFilter.value = plan.msgFilter;`（第 275 行）之后加：

```ts
  if (plan.msgAllStyle) msgAllStyle.value = plan.msgAllStyle;
```

- [ ] **Step 5: 触发存档的依赖**

第 294 行的 watch 依赖数组：

```ts
  [() => center.tabs.value.map((t) => `${t.id}|${t.label}`).join(','), center.activeId, rail, historyTab, msgFilter, msgAllStyle],
```

- [ ] **Step 6: 传参与回传**

第 674-679 行 `<HistoryList ... />` 两处修改：
- 属性行加 `:all-style="msgAllStyle"`（放在 `:filter="msgFilter"` 之后或同段任意位置）；
- 事件行在 `@update:filter="msgFilter = $event"` 之后加 `@update:all-style="msgAllStyle = $event"`。

改完后该元素为：

```html
          <HistoryList :items="historyItems" :tab="historyTab" :messages="visibleMessages" :filter="msgFilter" :all-style="msgAllStyle"
            :live-session-ids="liveSessionIds" :sessions="sessionExtras" :session-names="sessionNames" :project-id="currentProject" :active-path="activeFilePath"
            @update:tab="historyTab = $event" @open="openFromHistory" @remove="(pid, p) => removeFileHistory(pid, p)"
            @clear="clearFileHistory" @open-message="onOpenMessage" @remove-message="(m) => msgHistory.remove(m)"
            @update:filter="msgFilter = $event" @update:all-style="msgAllStyle = $event" @open-session="openHistorySession" @edit-session="editHistorySession"
            @open-file="openFile" @detail-file="onDetailFile" />
```

- [ ] **Step 7: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过（无 TS 报错）。

- [ ] **Step 8: 提交**

```bash
git add web/src/App.vue
git commit -m "feat(web): 接线全部会话平铺默认样式并随窗口状态持久化"
```

---

## Task 5: 全量验证与手工验收

- [ ] **Step 1: 全量测试**

Run: `npm.cmd test`
Expected: server + web 全部 PASS。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: PASS。

- [ ] **Step 4: 手工验收**

启动：另开终端 `npm.cmd run dev:server`（:33333），再 `npm.cmd run dev:web`（:5173），访问 http://localhost:5173 → 左侧历史 → 消息：
1. 默认仍是「仅当前会话」，平铺当前会话消息；
2. 点「全部会话」→ 默认**平铺**所有消息（带页签名标签 + 日期分隔）；此时出现 `[平铺] [分会话]`，`平铺` 高亮；
3. 点「分会话」→ 显示会话树；展开/打开/编辑行为与之前一致；
4. 保持「全部会话 + 分会话」，刷新页面 → 仍为「全部会话 + 分会话」；
5. 切回「平铺」，刷新 → 仍为平铺；
6. 「仅当前会话」下不显示 `[平铺] [分会话]`。

---

## 自检

- **Spec 覆盖：** 设计 §3.1 → Task 1；§4 → Task 2；§3.3 → Task 3；§3.2 → Task 4；§2/§5/§6 → Task 5 + 各任务测试；§7 影响面与 §8 排除项均按最小改动落实。
- **占位符：** 无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性：** `AllStyle = 'flat' | 'tree'` 在 `windowState.ts` 定义，`App.vue`（`ref<AllStyle>`）与 `HistoryList.vue`（prop/emit 字面量联合）一致；`msgAllStyle` 字段名在 `WindowState`/`RestorePlan`/`currentWindowState`/`planRestore` 统一；DOM class 统一为 `stylebtn`（可点击样式切换）与既有 `filterbtn`（筛选）区分。
