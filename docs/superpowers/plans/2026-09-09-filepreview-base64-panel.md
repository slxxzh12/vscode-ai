# FilePreview Base64 结果面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 FilePreview 现有的「Base64 复制到剪贴板」改成编辑器下方一块结果面板：左列实时编码、右列可粘贴解码，均在面板内展示结果并可手动复制。

**Architecture:** 纯前端 SFC 改动，全部落在 `web/src/components/FilePreview.vue`。把旧的 Base64 下拉/剪贴板逻辑整体替换为面板式状态与函数；编辑器 CodeMirror 的 updateListener 增加选区变化钩子驱动左列实时刷新。面板作为 `.preview` flex 列内、编辑器之后的一个 `flex:none` 子元素，由 `b64Open` 开关控制。

**Tech Stack:** Vue3 `<script setup lang="ts">`、CodeMirror 6（EditorView updateListener）、本地 `btoa`/`atob` + `unescape`/`escape` 路径。Windows + `npm.cmd`。

**Spec:** `docs/superpowers/specs/2026-09-09-filepreview-base64-panel-design.md`

**计划偏差说明：** 左列是只读实时结果，随时由编辑器内容推导，「清空」语义与实时刷新冲突，故左列只保留「复制」按钮；右列（可编辑输入）保留「复制 / 清空 / 编码结果→解码」。Spec 未规定组件级单测且仓库无 FilePreview 组件测试先例 → 不新增组件测试，验证走 `typecheck` + 全量 `test` + dev 手动验证。

---

### Task 1: 替换 Base64 逻辑为面板式状态与函数

**Files:**
- Modify: `web/src/components/FilePreview.vue:308-352`

- [ ] **Step 1: 替换整个旧 Base64 区块的 `<script>` 代码**

把文件中从 `// —— Base64 编解码 ——` 起到 `watch(b64Open, (o) => { ... });` 结尾的整段（当前第 308–352 行）替换为：

```ts
// —— Base64 编解码结果面板 ——
const b64Open = ref(false);
const b64EncodeOut = ref('');
const b64DecodeInput = ref('');
const b64DecodeOut = ref('');
const b64DecodeErr = ref('');
function encodeB64(src: string): string {
  return btoa(unescape(encodeURIComponent(src)));
}
function decodeB64(src: string): string {
  return decodeURIComponent(escape(atob(src.trim())));
}
function currentText(): string {
  if (!view) return '';
  const s = view.state.selection.main;
  return s.empty ? view.state.doc.toString() : view.state.sliceDoc(s.from, s.to);
}
function refreshB64Encode() {
  if (!b64Open.value) return;
  try {
    b64EncodeOut.value = encodeB64(currentText());
  } catch {
    b64EncodeOut.value = '';
  }
}
function refreshB64Decode() {
  const src = b64DecodeInput.value;
  b64DecodeErr.value = '';
  b64DecodeOut.value = '';
  if (!src.trim()) return;
  try {
    b64DecodeOut.value = decodeB64(src);
  } catch {
    b64DecodeErr.value = '不是合法的 Base64 内容';
  }
}
watch(b64DecodeInput, refreshB64Decode);
function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  document.execCommand('copy'); ta.remove();
}
async function b64Copy(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackCopy(text);
  }
}
function feedDecodeFromEncode() {
  b64DecodeInput.value = b64EncodeOut.value;   // watch 自动触发解码
}
function toggleB64() {
  b64Open.value = !b64Open.value;
  if (b64Open.value) { refreshB64Encode(); refreshB64Decode(); }
}
function resetB64Panel() {
  b64Open.value = false;
  b64EncodeOut.value = '';
  b64DecodeInput.value = '';
  b64DecodeOut.value = '';
  b64DecodeErr.value = '';
}
```

注意：删除了旧的 `b64Msg`、`flashB64`、`b64Apply`、`unbindB64`、`b64Timer`、`watch(b64Open)` 外部点击关闭逻辑。`currentText()` 移到本区块内定义（避免与 313 行旧定义重复，删除旧定义后此处是唯一定义）。

- [ ] **Step 2: 同步替换模板中旧的 Base64 工具条 UI**

把第 503–510 行（`<span v-if="b64Msg" ...>` 与 `<span v-if="canB64" class="b64wrap">...</span>` 两段）替换为单个开关按钮：

```html
          <span v-if="canB64" class="b64wrap">
            <button class="fmt-btn" :class="{ on: b64Open }" title="打开/关闭 Base64 编解码结果面板（编辑器下方）" @click="toggleB64">⇆ Base64</button>
          </span>
```

- [ ] **Step 3: 验证 typecheck 通过**

Run: `npm.cmd run typecheck`
Expected: 退出码 0，无 `b64Msg`/`b64Apply`/`flashB64`/`unbindB64` 相关报错（模板已不再引用这些标识符）。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "feat(preview): Base64 改为下方结果面板的开关状态与逻辑"
```

---

### Task 2: 新增结果面板标记

**Files:**
- Modify: `web/src/components/FilePreview.vue`（`<template>`，编辑器 div 之后）

- [ ] **Step 1: 在编辑器 div 后追加结果面板**

第 530 行 `<div v-show="showEditor" ref="editorHost" class="editor" />` 之后插入：

```html
        <div v-if="b64Open && status === 'ok'" class="b64panel">
          <div class="b64col">
            <div class="b64ch">
              <span class="b64t">Base64 编码（实时）</span>
              <div class="b64btns">
                <button class="b64b" :disabled="!b64EncodeOut" @click="b64Copy(b64EncodeOut)">复制</button>
              </div>
            </div>
            <pre class="b64pre">{{ b64EncodeOut }}</pre>
          </div>
          <div class="b64col">
            <div class="b64ch">
              <span class="b64t">Base64 解码</span>
              <div class="b64btns">
                <button class="b64b" :disabled="!b64EncodeOut" @click="feedDecodeFromEncode()">编码结果→解码</button>
                <button class="b64b" :disabled="!b64DecodeOut" @click="b64Copy(b64DecodeOut)">复制</button>
                <button class="b64b" :disabled="!b64DecodeInput" @click="b64DecodeInput = ''">清空</button>
              </div>
            </div>
            <textarea v-model="b64DecodeInput" class="b64ta" rows="2" spellcheck="false" placeholder="在此粘贴 Base64，自动实时解码…" />
            <div v-if="b64DecodeErr" class="b64err">{{ b64DecodeErr }}</div>
            <pre v-else class="b64pre">{{ b64DecodeOut }}</pre>
          </div>
        </div>
```

`b64panel` 是 `.preview` flex 列的直接子元素，位于 `.editor`（`flex:1`）之后，自身 `flex:none` 且固定高，编辑器自动让位。

- [ ] **Step 2: 验证 typecheck 通过**

Run: `npm.cmd run typecheck`
Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "feat(preview): 编辑器下方新增 Base64 编解码结果面板标记"
```

---

### Task 3: 面板样式

**Files:**
- Modify: `web/src/components/FilePreview.vue`（`<style scoped>`，`.b64wrap` 附近）

- [ ] **Step 1: 删除不再使用的 `.b64ok` 规则**

删除样式块中的 `.b64ok { color: var(--ok); }` 一行（旧 toast 文案类已移除）。

- [ ] **Step 2: 追加面板样式**

在 `<style scoped>` 末尾（`.note.err` 规则后）追加：

```css
.b64panel { flex: none; display: flex; gap: 8px; height: 220px; padding: 8px 10px; border-top: 1px solid var(--bd); background: var(--bg2); box-sizing: border-box; }
.b64col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; background: var(--bg3); border: 1px solid var(--bd); border-radius: 6px; padding: 6px; }
.b64ch { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; }
.b64t { font-size: 11px; font-weight: 600; color: var(--tx2); white-space: nowrap; }
.b64btns { display: flex; gap: 6px; flex: none; }
.b64b { background: transparent; border: 1px solid var(--bd); color: var(--tx2); font-size: 11px; padding: 1px 8px; border-radius: 4px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.b64b:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.b64b:disabled { opacity: .45; cursor: default; }
.b64pre { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 6px 8px; background: var(--bg3); border: 1px solid var(--bd); border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--tx); box-sizing: border-box; }
.b64ta { width: 100%; box-sizing: border-box; flex: none; resize: vertical; max-height: 45%; background: var(--bg3); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 8px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.b64err { color: var(--err); font-size: 12px; flex: none; }
```

- [ ] **Step 3: 验证 typecheck 通过**

Run: `npm.cmd run typecheck`
Expected: 退出码 0。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "style(preview): Base64 结果面板样式（双列布局/等宽字体/滚动区）"
```

---

### Task 4: 实时刷新接线 + 状态重置清理

**Files:**
- Modify: `web/src/components/FilePreview.vue`（`docChanged`、`mountEditor` 的 updateListener、`load`、`onBeforeUnmount`）

- [ ] **Step 1: 编辑器输入 / 选区变化时刷新左列**

把 155–159 行的 `docChanged()` 末尾追加左列刷新，并把 170 行 updateListener 扩展为同时监听选区变化：

```ts
function docChanged() {
  if (!view) return;
  raw.value = view.state.doc.toString();   // 供 md 预览实时使用
  scheduleSave();
  if (b64Open.value) refreshB64Encode();
}
```

```ts
EditorView.updateListener.of((u) => {
  if (u.docChanged) docChanged();
  if (u.selectionSet && b64Open.value) refreshB64Encode();
}),
```

（更新 170–171 行的 updateListener 语句即可，其余 mountEditor 逻辑不变。）

- [ ] **Step 2: `load()` 开头重置面板状态**

`load()` 函数体开头（`status.value = 'loading';` 之前）追加一行 `resetB64Panel();`，确保切换文件时面板关闭、输入与结果清空：

```ts
async function load() {
  resetB64Panel();
  status.value = 'loading';
```

- [ ] **Step 3: 清理 `onBeforeUnmount`**

`onBeforeUnmount`（472–480 行）删除 `unbindB64?.();` 与 `if (b64Timer) clearTimeout(b64Timer);` 两行（标识符已不存在），保留其余清理逻辑：

```ts
onBeforeUnmount(() => {
  disposed = true;
  unbindSort?.();
  if (runTimer) clearTimeout(runTimer);
  flush();
  if (view) { view.destroy(); view = null; }
});
```

- [ ] **Step 4: 验证 typecheck 与全量测试**

Run: `npm.cmd run typecheck` then `npm.cmd test`
Expected: typecheck 退出码 0；`npm.cmd test` 全部通过（server + web vitest 无回归）。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "feat(preview): Base64 编码列随编辑/选区实时刷新，切文件时重置面板"
```

---

### Task 5: 手动验证（开发模式）

**Files:** 无（运行验证）

- [ ] **Step 1: 启动 dev server（异步，勿阻塞）**

两个终端分别运行：
- `npm.cmd run dev:server`（后端 :3001）
- `npm.cmd run dev:web`（前端 :5173）

或已有 `node server/index.js`（生产，托管 `web/dist`）时先 `npm.cmd run build:web` 再访问 http://127.0.0.1:3001。

- [ ] **Step 2: 验证用例**

1. 打开任意 `.txt` / `.js` / `.json` 文本文件 → 工具条显示 `⇆ Base64`。
2. 点击 `⇆ Base64` → 编辑器下方出现双列面板；无选区时左列显示整个文件的 base64。
3. 在编辑器中框选一段文字 → 左列实时变为选中内容的编码；取消选区 → 回到整个文件编码；键入内容左列同步刷新。
4. 右列粘贴 `SGVsbG8gV29ybGQ=` → 解码显示 `Hello World`；粘贴乱码（如 `!!!`）→ 显示红字「不是合法的 Base64 内容」。
5. 点「编码结果→解码」→ 右列输入框填入左列编码结果并自动解回原文。
6. 各「复制」按钮可把结果写入剪贴板；「清空」可复位右列。
7. 再次点击 `⇆ Base64` → 面板收起；切换打开另一个文件 → 面板自动关闭且状态清空。
8. 改 `web/src/components/FilePreview.vue` 后 Vite HMR 生效，观察无布局溢出（大文件长行在 `<pre>` 内换行滚动正常）。

---

## Self-Review

**Spec 覆盖：**
- 开关按钮替换下拉、面板编辑器下方 → Task 1/2 ✔
- 左列实时编码（选区优先、随输入/选区刷新）→ Task 4 Step 1 + Task 2 左列 ✔
- 右列可粘贴解码、非法 base64 红字错误 → Task 1 `refreshB64Decode` + Task 2 右列 ✔
- 复制/清空/编码结果→解码、不自动写剪贴板 → Task 1 函数 + Task 2 按钮 ✔
- 错误列内显示不弹窗 ✔；关闭/切文件重置 → Task 4 Step 2 ✔；typecheck/test → Task 4 Step 4 ✔

**Placeholder 扫描：** 无 TBD/待补内容；每步代码完整、命令含期望输出。

**类型一致性：** `b64Open/b64EncodeOut/b64DecodeInput/b64DecodeOut/b64DecodeErr`、`currentText/encodeB64/decodeB64/refreshB64Encode/refreshB64Decode/b64Copy/fallbackCopy/feedDecodeFromEncode/toggleB64/resetB64Panel` 在 Task 1 定义后，于 Task 2–4 中引用，命名与签名一致；模板 v-model 绑定 `b64DecodeInput` 与 script 一致。

**已知取舍：** 左列无「清空」按钮（实时推导，清空无意义），已在文首偏差说明记录。
