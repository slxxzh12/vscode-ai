# 页签双击弹框（页签名 + 详细描述）与输入区黄色提示框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 双击会话页签弹出「页签名 + 详细描述」弹框；确定后回写页签并同步 Agent 会话名，并把详细描述以只读黄色提示框显示在 composer 的「选择文件」同一行。

**Architecture:** 新增纯函数模块管理描述的读写，新增独立弹框组件 `TabRenameDialog.vue`，`TerminalView.vue` 持有状态并替换原内联改名逻辑、渲染黄色提示框。描述按会话存 localStorage（与现有 `tabNames` 平行）。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、vitest + `@vue/test-utils` + happy-dom、Vite。

> **提交说明（本仓库规则优先）：** 未经用户明确要求不 `git commit`；且当前工作树含无关改动。因此本计划各任务**不含 commit 步骤**，全部验证通过后由用户决定是否提交（提交前须跑 `docs/learn/git仓库提交检查和提交事项.md` 清单）。

---

## File Structure

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `web/src/components/tabDescriptions.ts` | 纯函数：会话描述的 set/clear（trim，空即删，返回新对象） | Create |
| `web/src/components/tabDescriptions.test.ts` | 上述纯函数单测 | Create |
| `web/src/components/TabRenameDialog.vue` | 弹框组件（页签名 + 详细描述，emit confirm/cancel） | Create |
| `web/src/components/TabRenameDialog.test.ts` | 组件挂载测试 | Create |
| `shared/i18n/zh-CN.js` / `shared/i18n/en.js` | 新增 4 个词条（中英对称） | Modify |
| `web/src/components/TerminalView.vue` | 接入弹框、移除内联改名、描述持久化、黄色提示框 | Modify |

---

## Task 1: 描述纯函数模块

**Files:**
- Create: `web/src/components/tabDescriptions.ts`
- Test: `web/src/components/tabDescriptions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/components/tabDescriptions.test.ts
import { test, expect } from 'vitest';
import { setTabDescription } from './tabDescriptions';

test('setTabDescription：非空写入并 trim；空/纯空白删除；不改原对象', () => {
  const base = { a: 'x' };
  const r1 = setTabDescription(base, 'b', '  hi  ');
  expect(r1).toEqual({ a: 'x', b: 'hi' });
  expect(base).toEqual({ a: 'x' });

  const r2 = setTabDescription({ a: 'x' }, 'a', '   ');
  expect(r2).toEqual({});

  const r3 = setTabDescription({}, 'c', '');
  expect(r3).toEqual({});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run src/components/tabDescriptions.test.ts` (workdir `web`)
Expected: FAIL —— 找不到模块 `./tabDescriptions`。

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/components/tabDescriptions.ts
// 会话详细描述：仅提示展示，按会话持久化。trim 后非空写入，空/纯空白即删除。
export function setTabDescription(
  map: Record<string, string>,
  sid: string,
  description: string,
): Record<string, string> {
  const next = { ...map };
  const v = description.trim();
  if (v) next[sid] = v;
  else delete next[sid];
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run src/components/tabDescriptions.test.ts` (workdir `web`)
Expected: PASS（1 test）。

---

## Task 2: i18n 词条（中英对称）

**Files:**
- Modify: `shared/i18n/zh-CN.js`（`term.tab_rename` 附近）
- Modify: `shared/i18n/en.js`（`term.tab_rename` 附近）

- [ ] **Step 1: 新增中文词条**

在 `shared/i18n/zh-CN.js` 的 `'term.tab_rename': '双击重命名页签',` 之后插入：

```js
  'term.tab_dialog_title': '编辑页签',
  'term.tab_dialog_name': '页签名',
  'term.tab_dialog_desc': '详细描述',
  'term.tab_dialog_desc_ph': '填写任务的详细描述（仅作提示，不会自动发送）',
```

- [ ] **Step 2: 新增英文词条**

在 `shared/i18n/en.js` 的 `'term.tab_rename': 'Double-click to rename tab',` 之后插入：

```js
  'term.tab_dialog_title': 'Edit tab',
  'term.tab_dialog_name': 'Tab name',
  'term.tab_dialog_desc': 'Details',
  'term.tab_dialog_desc_ph': 'Describe the task (hint only, not sent automatically)',
```

- [ ] **Step 3: 校验词条对称**

Run: `npm.cmd run check:i18n` (repo root)
Expected: PASS（无缺失/多余键告警）。

---

## Task 3: 弹框组件 `TabRenameDialog.vue`

**Files:**
- Create: `web/src/components/TabRenameDialog.vue`
- Test: `web/src/components/TabRenameDialog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/components/TabRenameDialog.test.ts
// @vitest-environment happy-dom
import { test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TabRenameDialog from './TabRenameDialog.vue';

const global = { mocks: { $t: (k: string) => k } };

test('确定：emit confirm，name/description 均 trim', async () => {
  const w = mount(TabRenameDialog, {
    props: { name: '  旧名  ', description: '  旧描述  ', placeholder: '默认名' },
    global,
  });
  await w.find('input').setValue('  新名  ');
  await w.find('textarea').setValue('  新描述  ');
  await w.find('.tabdlg-btn.primary').trigger('click');
  expect(w.emitted('confirm')?.[0]?.[0]).toEqual({ name: '新名', description: '新描述' });
});

test('取消：emit cancel，无 confirm', async () => {
  const w = mount(TabRenameDialog, {
    props: { name: '', description: '', placeholder: '默认名' },
    global,
  });
  await w.find('.tabdlg-btn').trigger('click');
  expect(w.emitted('cancel')).toBeTruthy();
  expect(w.emitted('confirm')).toBeFalsy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run src/components/TabRenameDialog.test.ts` (workdir `web`)
Expected: FAIL —— 找不到模块 `./TabRenameDialog.vue`。

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- web/src/components/TabRenameDialog.vue -->
<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';

const props = defineProps<{
  name: string;
  description: string;
  placeholder: string;
}>();

const emit = defineEmits<{
  confirm: [payload: { name: string; description: string }];
  cancel: [];
}>();

const name = ref(props.name);
const desc = ref(props.description);
const nameEl = ref<HTMLInputElement | null>(null);

function onConfirm() {
  emit('confirm', { name: name.value.trim(), description: desc.value.trim() });
}

onMounted(() => {
  void nextTick(() => { nameEl.value?.focus(); nameEl.value?.select(); });
});
</script>

<template>
  <div class="tabdlg-mask" @click.self="emit('cancel')">
    <div class="tabdlg" role="dialog" aria-modal="true">
      <header class="tabdlg-head">{{ $t('term.tab_dialog_title') }}</header>
      <label class="tabdlg-row">
        <span class="tabdlg-label">{{ $t('term.tab_dialog_name') }}</span>
        <input
          ref="nameEl"
          v-model="name"
          class="tabdlg-input"
          :placeholder="placeholder"
          @keyup.enter="onConfirm"
          @keyup.esc="emit('cancel')"
        />
      </label>
      <label class="tabdlg-row">
        <span class="tabdlg-label">{{ $t('term.tab_dialog_desc') }}</span>
        <textarea
          v-model="desc"
          class="tabdlg-area"
          :placeholder="$t('term.tab_dialog_desc_ph')"
          @keyup.esc="emit('cancel')"
        />
      </label>
      <footer class="tabdlg-foot">
        <button type="button" class="tabdlg-btn" @click="emit('cancel')">{{ $t('common.cancel') }}</button>
        <button type="button" class="tabdlg-btn primary" @click="onConfirm">{{ $t('common.ok') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.tabdlg-mask { position: fixed; inset: 0; z-index: 4000; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; }
.tabdlg { width: min(520px, 92vw); background: var(--bg1); border: 1px solid var(--bd); border-radius: 10px; box-shadow: 0 16px 48px rgba(0,0,0,.45); color: var(--tx1); display: flex; flex-direction: column; gap: 12px; padding: 16px 18px 14px; }
.tabdlg-head { font-size: 14px; font-weight: 700; }
.tabdlg-row { display: flex; flex-direction: column; gap: 6px; }
.tabdlg-label { font-size: 12px; color: var(--tx3); }
.tabdlg-input, .tabdlg-area { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx1); border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; outline: none; }
.tabdlg-input:focus, .tabdlg-area:focus { border-color: var(--ac2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac2) 22%, transparent); }
.tabdlg-area { min-height: 96px; resize: vertical; line-height: 1.6; }
.tabdlg-foot { display: flex; justify-content: flex-end; gap: 8px; }
.tabdlg-btn { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx2); border-radius: 8px; padding: 5px 16px; cursor: pointer; font-size: 13px; }
.tabdlg-btn:hover { border-color: var(--ac2); color: var(--ac2); }
.tabdlg-btn.primary { background: var(--ac); border-color: var(--ac); color: var(--onac); font-weight: 600; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run src/components/TabRenameDialog.test.ts` (workdir `web`)
Expected: PASS（2 tests）。

---

## Task 4: TerminalView 接入弹框（替换内联改名）

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 新增 import**

在 `web/src/components/TerminalView.vue` 顶部 import 区（现有 `import { createReadyGate } from './sessionNaming';` 之后）加入：

```ts
import TabRenameDialog from './TabRenameDialog.vue';
import { setTabDescription } from './tabDescriptions';
```

- [ ] **Step 2: 用弹框状态与处理函数替换内联改名逻辑**

把现有第 99–126 行（`const renamingId = ref...` 到 `function cancelRename() { renamingId.value = null; }`）整体替换为：

```ts
// —— 页签双击弹框：页签名 + 详细描述（描述仅提示展示，随会话持久化）——
const tabDescs = ref<Record<string, string>>({});
let tabDescsKey = 'devflow-tab-descs-none';
function loadTabDescs() {
  try {
    const a = JSON.parse(localStorage.getItem(tabDescsKey) || '{}');
    tabDescs.value = (a && typeof a === 'object' && !Array.isArray(a)) ? a : {};
  } catch { tabDescs.value = {}; }
}
function persistTabDescs() { try { localStorage.setItem(tabDescsKey, JSON.stringify(tabDescs.value)); } catch { /* ignore */ } }

const dialogSid = ref<string | null>(null);
const dialogName = ref('');
const dialogDesc = ref('');
const dialogPlaceholder = ref('');
function openTabDialog(tabId: string) {
  if (!tabId.startsWith('s:')) return;   // 仅会话页签
  const sid = tabId.slice(2);
  dialogSid.value = sid;
  dialogName.value = (tabNames.value[sid] || '').trim();
  dialogDesc.value = tabDescs.value[sid] || '';
  dialogPlaceholder.value = tabLabel(sid);   // 无自定义名时即默认显示名
}
function onTabDialogCancel() { dialogSid.value = null; }
function onTabDialogConfirm(payload: { name: string; description: string }) {
  const sid = dialogSid.value;
  if (!sid) return;
  dialogSid.value = null;
  const name = payload.name.trim();
  const next = { ...tabNames.value };
  if (name) next[sid] = name; else delete next[sid];
  tabNames.value = next;
  persistTabNames();
  props.center.ensureSession(sid, tabLabel(sid), sessionState(sid));
  msgHistory.renameTab(sid, tabLabel(sid));   // 同步更新历史消息里记录的页签名
  if (name) syncAgentRename(sid, name);       // 同步改 Agent 内的对话名
  tabDescs.value = setTabDescription(tabDescs.value, sid, payload.description);
  persistTabDescs();
}
```

注意：`loadTabNames` / `persistTabNames` / `tabLabel` / `syncAgentRename` / `msgHistory` 均保持不变，且必须在替换块**之前/之后仍可访问**（`tabLabel`、`syncAgentRename`、`msgHistory` 定义在本块之后，函数体内引用不受影响）。

- [ ] **Step 3: 初始化时加载描述（按节点指纹隔离）**

在 `onMounted` 内 `tabNamesKey = \`devflow-tab-names-${fp}\`;` 之后，把 `loadTabNames();` 前后补上描述键与加载：

```ts
  tabNamesKey = `devflow-tab-names-${fp}`;
  tabDescsKey = `devflow-tab-descs-${fp}`;
  loadAgentSids();
  void loadComposerPrefs();
  loadTabNames();
  loadTabDescs();
```

- [ ] **Step 4: 页签模板改为打开弹框**

把 `web/src/components/TerminalView.vue` 第 1036–1046 行的页签循环替换为：

```html
      <div v-for="t in center.tabs.value" :key="t.id" class="tab"
        :class="{ active: center.activeId.value === t.id }" @click="onTabClick(t.id)"
        @dblclick="t.kind === 'session' && openTabDialog(t.id)">
        <span v-if="t.kind === 'session'" :class="['dot', sessionState(t.id.slice(2))]" />
        <span v-else class="file-ic">▤</span>
        <span class="nm" :title="t.kind === 'file' ? t.path : (t.label + ' — ' + $t('term.tab_rename'))">{{ t.label }}</span>
        <span v-if="t.id !== 's:' + agentSid" class="x" @click="onTabClose(t.id, $event)" @dblclick.stop>×</span>
      </div>
```

- [ ] **Step 5: 渲染弹框组件**

在 `web/src/components/TerminalView.vue` 的 `<div v-if="syncingRename" ...>...</div>`（第 1032–1034 行）之后插入：

```html
    <TabRenameDialog v-if="dialogSid"
      :name="dialogName" :description="dialogDesc" :placeholder="dialogPlaceholder"
      @confirm="onTabDialogConfirm" @cancel="onTabDialogCancel" />
```

- [ ] **Step 6: 移除已无用的内联输入样式**

删除 `web/src/components/TerminalView.vue` 样式中的这一行：

```css
.tab .rename-input { background: var(--bg4); color: var(--tx1); border: 1px solid var(--ac2); border-radius: 3px; padding: 1px 6px; font-size: 12px; min-width: 60px; max-width: 160px; outline: none; }
```

- [ ] **Step 7: 类型检查 + 构建**

Run: `npm.cmd run typecheck` (workdir `web`)
Expected: PASS，无 `renamingId` / `renameValue` / `rename-input` 未使用报错。

Run: `npm.cmd run build` (workdir `web`)
Expected: 构建成功。

---

## Task 5: 输入区黄色提示框

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 新增当前会话描述 computed**

在 `web/src/components/TerminalView.vue` 的 `activeIsAgent` computed 之后加入：

```ts
// composer 上当前会话的详细描述（只读提示）
const activeTabDesc = computed(() => {
  const sid = props.terminal.state.activeSessionId;
  return sid ? (tabDescs.value[sid] || '') : '';
});
```

- [ ] **Step 2: 在 `.ctools` 行插入黄色提示框（与「选择文件」同一行，置于按钮左侧）**

把第 1113–1119 行的 `.ctools` 块改为：

```html
            <div class="ctools">
              <span v-if="activeTabDesc" class="cdsc" :title="activeTabDesc">{{ activeTabDesc }}</span>
              <button class="cbtn" :title="$t('term.pick_file')" @mousedown.stop @click="pickFileForPrompt">{{ $t('term.pick_file') }}</button>
              <button class="cbtn" :disabled="!composerText && !translatedText && !activeStage" :title="$t('term.clear_prompt')" @mousedown.stop @click="clearPrompt">{{ $t('term.clear_prompt') }}</button>
              <button v-if="translateMode" class="cbtn" :disabled="translating || !composerText.trim()" :title="$t('term.translate')" @mousedown.stop @click="translateNow">{{ translating ? $t('term.translating') : $t('term.translate') }}</button>
              <button class="cbtn" :class="{ on: translateMode }" :title="$t('term.translate_toggle')" @mousedown.stop @click="toggleTranslate">{{ $t('term.translate_toggle') }}</button>
              <button v-if="!phone" class="cbtn" :title="$t('term.history')" @mousedown.stop @click="openHistory">{{ $t('term.history') }}</button>
            </div>
```

- [ ] **Step 3: 新增黄色提示框样式**

在 `web/src/components/TerminalView.vue` 的 `.ctools { ... }` 规则之后加入：

```css
.ctools .cdsc { flex: 0 1 auto; min-width: 0; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: color-mix(in srgb, var(--warn2) 16%, transparent); border: 1px solid color-mix(in srgb, var(--warn2) 60%, transparent); color: var(--warn2); border-radius: 6px; padding: 1px 8px; line-height: 18px; font-size: 11px; }
```

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck` (workdir `web`)
Expected: PASS。

---

## Task 6: 全量验证

**Files:** 无（仅运行）

- [ ] **Step 1: 全量单测**

Run: `npm.cmd test` (repo root)
Expected: server 与 web 全绿（含新增 3 个测试文件）。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck` (repo root)
Expected: PASS。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n` (repo root)
Expected: PASS。

- [ ] **Step 4: 前端构建**

Run: `npm.cmd run build:web` (repo root)
Expected: 构建成功。

- [ ] **Step 5: 人工验收（dev：`npm.cmd run dev`，访问 http://localhost:5173）**

1. 双击任意会话页签 → 弹框出现，页签名预填/占位为默认名，描述预填。
2. 填名 + 描述 → 确定 → 页签名更新；agent 会话名同步（`/rename`）；composer 的「选择文件」左侧出现黄色提示框。
3. hover 黄色提示框 → tooltip 显示完整描述。
4. 刷新页面 → 页签名与黄色提示框仍在。
5. 再次双击 → 两栏预填；清空描述 → 确定 → 黄色提示框消失。
6. Esc / 点遮罩 / 取消 → 弹框关闭且无任何改动。

---

## Self-Review

**Spec coverage:**
- 双击所有会话页签弹框、取代内联改名 → Task 4。
- 页签名回写 + 同步 Agent 会话名 → Task 4（`onTabDialogConfirm` 复用 `syncAgentRename`）。
- 详细描述仅提示 + 随会话持久化 → Task 1（`setTabDescription`）+ Task 4（`tabDescs`/`load`/`persist`）。
- 黄色提示框：同「选择文件」一行、只读、单行省略 + tooltip、无描述不显示 → Task 5。
- 中英词条对称 → Task 2。
- 测试/typecheck/i18n/build/人工验收 → Task 3、4、6。
- 明确不做（不拼提示词、不框内编辑/清除、不服务端持久化、不改协议）→ 未纳入任何任务。

**Placeholder scan:** 无 TBD/TODO；每个代码步骤均给出完整代码。

**Type consistency:** 组件 props 为 `name`/`description`/`placeholder`，emit `confirm({ name, description })`；TerminalView 的 `onTabDialogConfirm(payload: { name: string; description: string })` 与之一致。`setTabDescription(map, sid, description)` 签名在 Task 1 定义、Task 4 调用一致。`activeTabDesc` 在 Task 5 定义并使用。

**Gaps found:** 无。
