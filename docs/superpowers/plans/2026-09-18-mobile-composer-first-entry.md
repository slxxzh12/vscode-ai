# 移动端首次进入底部 composer 放大 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机远程页首次进入即展开底部 composer，并放大其按钮与输入面板。

**Architecture:** 纯前端增量，全部集中在 `web/src/components/TerminalView.vue`：改两个 `ref` 的默认值（`composerMin`、`composerH`）并追加 `.composer.phone` 作用域样式覆盖。无后端、无协议、无数据结构改动。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript + Vite；`vue-tsc` 类型检查。

**Spec:** `docs/superpowers/specs/2026-09-18-mobile-composer-first-entry-design.md`

---

## 前置说明

- `AGENTS.md` 规定：执行实现计划默认 **inline（本会话内执行）**，不使用 subagent；一律在 `master` 操作；命令用 `npm.cmd`。
- 提交前执行 `docs/learn/git仓库提交检查和提交事项.md` 检查清单。
- 本改动为纯视觉/默认值，无既有 `TerminalView` 组件测试；自动化验证为 `typecheck`，其余为手动验收。

---

## File Structure

- Modify: `web/src/components/TerminalView.vue` —— `composerMin`/`composerH` 默认值 + `.composer.phone` 样式。

---

## Task 1: 手机默认展开 + 默认高度

**Files:**
- Modify: `web/src/components/TerminalView.vue:616-617`

- [ ] **Step 1: 改默认值**

把：

```typescript
const composerH = ref(props.phone ? 150 : 240);
const composerMin = ref(true);
```

改为：

```typescript
const composerH = ref(props.phone ? 200 : 240);
const composerMin = ref(props.phone ? false : true);   // 手机首次进入即展开；桌面保持收起
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: `vue-tsc --noEmit` 无报错。

- [ ] **Step 3: 提交**

```bash
git add web/src/components/TerminalView.vue
git commit -m "feat(web): 手机端首次进入默认展开 composer 并加高"
```

---

## Task 2: 手机端底部控件放大

**Files:**
- Modify: `web/src/components/TerminalView.vue`（`.composer.phone` 样式段）

- [ ] **Step 1: 替换手机样式段**

把当前整段：

```css
.composer.phone { padding: 0 8px 8px; gap: 4px; }
.composer.phone:not(.min) { min-height: 148px; }
.composer.phone .cbar { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.composer.phone .cbar::-webkit-scrollbar { display: none; }
.composer.phone .flowbar,
.composer.phone .chipbar { flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.composer.phone .flowbar::-webkit-scrollbar,
.composer.phone .chipbar::-webkit-scrollbar { display: none; }
.composer.phone .fgroup { flex: none; }
.composer.phone .chipstage { flex: none; flex-wrap: nowrap; max-height: none; overflow: visible; }
.composer.phone .chipextra { flex-wrap: nowrap; }
.composer.phone .cwrap { min-height: 46px; }
.composer.phone .cinput { padding: 30px 12px 8px 12px; }
.composer.phone .csend { min-width: 0; padding: 0 16px; font-size: 14px; }
.composer.phone .cagentacts { min-width: 60px; }
```

改为：

```css
.composer.phone { padding: 0 8px 8px; gap: 4px; }
.composer.phone:not(.min) { min-height: 148px; }
.composer.phone .cbar { height: 30px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.composer.phone .cbar::-webkit-scrollbar { display: none; }
.composer.phone .flowbar,
.composer.phone .chipbar { flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.composer.phone .flowbar::-webkit-scrollbar,
.composer.phone .chipbar::-webkit-scrollbar { display: none; }
.composer.phone .fgroup { flex: none; }
.composer.phone .chipstage { flex: none; flex-wrap: nowrap; max-height: none; overflow: visible; }
.composer.phone .chipextra { flex-wrap: nowrap; }
.composer.phone .stage { font-size: 13px; padding: 4px 14px; }
.composer.phone .chip { font-size: 12px; padding: 3px 12px; }
.composer.phone .cwrap { min-height: 46px; }
.composer.phone .cinput { padding: 30px 12px 8px 12px; font-size: 15px; }
.composer.phone .cbtn { font-size: 13px; padding: 3px 10px; line-height: 20px; }
.composer.phone .csend { min-width: 0; padding: 0 20px; font-size: 17px; }
.composer.phone .cact { font-size: 14px; }
.composer.phone .cagentacts { min-width: 72px; }
```

要点：`.cbar` 加 `height: 30px`；新增 `.stage`/`.chip`/`.cbtn`/`.cact` 手机覆盖；`.cinput` 加 `font-size: 15px`；`.csend` 改 `padding: 0 20px; font-size: 17px`；`.cagentacts` 由 60 改 72。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: `vue-tsc --noEmit` 无报错。

- [ ] **Step 3: 提交**

```bash
git add web/src/components/TerminalView.vue
git commit -m "style(web): 放大手机端 composer 按钮与输入面板"
```

---

## Task 3: 手动验收

- [ ] **Step 1: 起 dev**

按 `AGENTS.md` 异步后台起 `npm.cmd run dev`（日志写 `logs\`），访问 http://localhost:5173/?phone=1（或桌面窄屏）。

- [ ] **Step 2: 检查**

- 首次进入 composer 直接展开（高度约 200px），不再只有一排按钮。
- 工作流 stage、常用语 chip、动作按钮（压缩/暂停/清空）、发送按钮、输入框字号均明显变大。
- 顶部 `—`/`❐` 收起按钮仍可正常收起/展开；收起后仍为 40px。
- 桌面端（`/`，非 phone）首次进入仍默认收起。

---

## Self-Review

- **Spec coverage**：默认展开（Task 1 Step 1）、默认高度 200（Task 1 Step 1）、手机控件放大（Task 2）均有对应；非目标未触碰（桌面默认值、顶部工具栏、持久化均未改）。
- **Placeholder scan**：无 TBD/TODO；CSS 与 TS 均给出完整前后内容。
- **Type consistency**：`composerMin`/`composerH` 名称与 spec 一致；选择器均限定 `.composer.phone` 作用域，与 spec 一致。
