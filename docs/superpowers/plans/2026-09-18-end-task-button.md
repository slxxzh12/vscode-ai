# 结束当前任务按钮（发送 /clear）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 composer 的 `取消执行` 按钮下方新增 `结束当前任务` 按钮，点击直接向当前会话发送 `/clear`，并把 `压缩上下文` 按钮缩小。

**Architecture:** 纯前端增量。复用 `TerminalView.vue` 既有的 `sendToActive()` 发送机制（与 `compactContext`/`undoContext` 一致），在 `.cagentacts` 竖排按钮组追加第三个按钮并重排 flex 比例；中英 i18n 各补两条词条。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript + Vite（web），共享 i18n 词条 `shared/i18n/*.js`。

**Spec:** `docs/superpowers/specs/2026-09-18-end-task-button-design.md`

---

## 前置说明

- 仓库 `AGENTS.md` 规定：执行实现计划默认 **inline（本会话内执行）**，不使用 subagent。
- 提交前必须执行 `docs/learn/git仓库提交检查和提交事项.md` 的检查清单（敏感信息扫描、`env/` 为空、只暂存本次文件）。
- **注意**：当前工作区在 `web/src/components/TerminalView.vue`、`shared/i18n/en.js`、`shared/i18n/zh-CN.js` 上已有与本功能无关的未提交改动（页签描述就地编辑、关闭会话不再确认）。本计划的提交步骤只应包含本功能新增的 hunk；若无法按文件干净分离，先与用户确认再提交，禁止把无关改动一起提交。

---

## File Structure

- Modify: `shared/i18n/zh-CN.js` — 新增 `term.end_task`、`term.end_task_hint` 中文词条。
- Modify: `shared/i18n/en.js` — 新增对应英文词条（键集合必须与 zh-CN 对称）。
- Modify: `web/src/components/TerminalView.vue` — 新增 `endTask()` 函数、模板按钮、`.cact.endtask` 样式与 flex 比例调整。

---

## Task 1: 新增 i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`（`term.cancel_exec` 之后）
- Modify: `shared/i18n/en.js`（`term.cancel_exec` 之后）

- [ ] **Step 1: 在 zh-CN.js 新增中文词条**

在 `shared/i18n/zh-CN.js` 中，把：

```javascript
  'term.cancel_exec': '取消执行',
```

改为：

```javascript
  'term.cancel_exec': '取消执行',
  'term.end_task': '结束当前任务',
  'term.end_task_hint': '向 Agent 发送 /clear 结束当前会话并开始新会话',
```

- [ ] **Step 2: 在 en.js 新增英文词条**

在 `shared/i18n/en.js` 中，把：

```javascript
  'term.cancel_exec': 'Cancel run',
```

改为：

```javascript
  'term.cancel_exec': 'Cancel run',
  'term.end_task': 'End Task',
  'term.end_task_hint': 'Send /clear to the agent to end the current session and start a new one',
```

- [ ] **Step 3: 校验中英词条对称、无硬编码中文**

Run: `npm.cmd run check:i18n`
Expected: 通过（无报错）。若报键缺失/不对称，按提示补齐后重跑。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 新增结束当前任务按钮词条"
```

（若无法按文件干净分离无关改动，见「前置说明」，先与用户确认。）

---

## Task 2: 新增按钮、行为与样式

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 新增 `endTask()` 函数**

在 `web/src/components/TerminalView.vue` 中，紧接 `undoContext()` 之后。把：

```javascript
// 取消：给当前会话发 /undo，撤销 Agent 上一步操作
function undoContext() {
  sendToActive('/undo');
}
```

改为：

```javascript
// 取消：给当前会话发 /undo，撤销 Agent 上一步操作
function undoContext() {
  sendToActive('/undo');
}
// 结束当前任务：给当前会话发 /clear（opencode 里是 /new 的别名，结束当前会话并开始新会话）
function endTask() {
  resetAutoCompact();
  sendToActive('/clear');
}
```

- [ ] **Step 2: 在模板中新增按钮**

在同一文件的 `.cagentacts` 按钮组里，`取消执行` 按钮之后。把：

```html
          <div v-if="activeIsAgent" class="cagentacts">
            <button class="cact compact" :title="$t('term.compact_hint')" @click="compactContext">{{ $t('term.compact') }}</button>
            <button class="cact cancel" :title="$t('term.undo_hint')" @click="undoContext">{{ $t('term.cancel_exec') }}</button>
          </div>
```

改为：

```html
          <div v-if="activeIsAgent" class="cagentacts">
            <button class="cact compact" :title="$t('term.compact_hint')" @click="compactContext">{{ $t('term.compact') }}</button>
            <button class="cact cancel" :title="$t('term.undo_hint')" @click="undoContext">{{ $t('term.cancel_exec') }}</button>
            <button class="cact endtask" :title="$t('term.end_task_hint')" @click="endTask">{{ $t('term.end_task') }}</button>
          </div>
```

- [ ] **Step 3: 调整 flex 比例并新增按钮样式**

在同文件 `<style scoped>` 中。把：

```css
.cact.compact { flex: 65; border-color: var(--ok); color: var(--ok); }
.cact.compact:hover { background: color-mix(in srgb, var(--ok) 18%, transparent); }
.cact.cancel { flex: 35; border-color: var(--err); color: var(--err); }
.cact.cancel:hover { background: color-mix(in srgb, var(--err) 18%, transparent); }
```

改为：

```css
.cact.compact { flex: 30; border-color: var(--ok); color: var(--ok); }
.cact.compact:hover { background: color-mix(in srgb, var(--ok) 18%, transparent); }
.cact.cancel { flex: 35; border-color: var(--err); color: var(--err); }
.cact.cancel:hover { background: color-mix(in srgb, var(--err) 18%, transparent); }
.cact.endtask { flex: 35; }
.cact.endtask:hover { background: color-mix(in srgb, var(--tx1) 12%, transparent); }
```

说明：`.cagentacts` 为竖排（`flex-direction: column`），`flex` 即高度占比。`压缩上下文` 从 65 降到 30（缩小），`取消执行` 维持 35，`结束当前任务` 35，三者合计 100。

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过（`vue-tsc` 无报错）。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/TerminalView.vue
git commit -m "feat(web): composer 新增结束当前任务按钮（发送 /clear）"
```

（若无法按文件干净分离无关改动，见「前置说明」，先与用户确认。）

---

## Task 3: 手动验收

- [ ] **Step 1: 启动 dev**

按 `AGENTS.md`：用带 opencode 的终端，异步后台起 `npm.cmd run dev`（日志写 `logs\`），访问 http://localhost:5173。

- [ ] **Step 2: 验证按钮与行为**

- 打开一个 opencode Agent 会话（`activeIsAgent` 为真时按钮组才显示）。
- 确认 `结束当前任务` 出现在 `取消执行` 下方，`压缩上下文` 比之前更矮。
- 点击 `结束当前任务`，确认当前会话收到 `/clear` 并开始新会话（与手动输入 `/clear` 效果一致）。
- 悬停按钮，确认 tooltip 显示 `term.end_task_hint` 文案。

- [ ] **Step 3: 结果确认**

三项均通过即完成；任一不通过回到 Task 2 修正后重验。

---

## Self-Review

- **Spec coverage**：按钮/行为（Task 2 Step 1-2）、i18n（Task 1）、样式缩小（Task 2 Step 3）、直接发送不弹确认（Task 2 Step 1，无 confirm 调用）、`resetAutoCompact()`（Task 2 Step 1）——均有对应任务。
- **Placeholder scan**：无 TBD/TODO；所有代码步骤均给出完整前后代码。
- **Type consistency**：函数名统一为 `endTask`，样式类统一为 `.cact.endtask`，i18n 键统一为 `term.end_task` / `term.end_task_hint`，与 spec 一致。
