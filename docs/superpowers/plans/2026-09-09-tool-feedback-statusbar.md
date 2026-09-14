# FilePreview 工具反馈 → 底部常驻状态栏 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 FilePreview 顶栏工具按钮（格式化/压成一行/排序/运行）的反馈与保存状态，统一收敛到文件预览区底部的常驻单行状态栏，替代顶栏闪字与 `alert()` 弹窗。

**Architecture:** 改动全部集中在 `web/src/components/FilePreview.vue`。新增两个 ref（`toolMsg` 文本 + `toolOk` 是否成功）作为"最近工具反馈"单一事实源，各工具函数经 `setToolMsg()` 写入；删除 `fmtMsg`/`runMsg`/`flashFmt`/两个定时器及顶栏内嵌保存/反馈 span；模板在 `.preview` flex 列末尾追加常驻 `statusbar`。保存状态段读现有 `saveState`/`saveMsg`，位于状态栏最左。

**Tech Stack:** Vue 3 `<script setup>`、CodeMirror 6（既有）、无新增依赖。测试沿用 web 惯例：`vue-tsc` typecheck + vitest（现有无组件测试基建，逻辑改动以 typecheck、现有测试、生产构建与手动清单验证）。

**Spec:** `docs/superpowers/specs/2026-09-09-tool-feedback-statusbar-design.md`

---

### Task 1: 新增工具反馈状态（`toolMsg`/`toolOk`/`setToolMsg`），替换 minify 的 `alert()`

**Files:**
- Modify: `web/src/components/FilePreview.vue`（script 区 + `minifyOneLine`）

- [ ] **Step 1: 在 Base64 区之前新增状态 ref 与写入函数**

在 `function nowTime()` 上方（约 111 行前）加：

```ts
// —— 底部常驻状态栏：最近一次工具反馈（保存状态单独在最左）——
const toolMsg = ref('');
const toolOk = ref(true);
function setToolMsg(text: string, ok = true) {
  toolMsg.value = text;
  toolOk.value = ok;
}
```

`ref` 已 import，无需改 import。

- [ ] **Step 2: `load()` 切文件时清空工具反馈**

在 `load()` 开头（现 190 行）加 `toolMsg.value = '';`：

```ts
async function load() {
  toolMsg.value = '';
  resetB64Panel();
  closeDetail();
```

- [ ] **Step 3: `minifyOneLine` 失败改用 `setToolMsg`，成功补文案，去掉 `alert()`**

将 `minifyOneLine` 整体替换为：

```ts
async function minifyOneLine() {
  if (!view || minifying.value) return;
  const src = view.state.doc.toString();
  minifying.value = true;
  try {
    const r = await format(props.name, src);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.content } });
    requestMeasure();
    setToolMsg('✓ 已压缩为一行');
  } catch (e: any) {
    setToolMsg(`压缩失败：${e?.message || e}`, false);
  } finally {
    minifying.value = false;
  }
}
```

- [ ] **Step 4: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无错误退出。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "feat(preview): 新增底部状态栏工具反馈状态，压成一行失败不再弹 alert"
```

---

### Task 2: formatDoc 与 runFile 改用状态栏，删除旧 flash 反馈与定时器

**Files:**
- Modify: `web/src/components/FilePreview.vue`

- [ ] **Step 1: 删除 runFile 区的 `runMsg`/`runTimer`，改 `setToolMsg`**

将（现约 438-450 行）：

```ts
// —— 运行脚本（bat/cmd/ps1/sh）——
const runMsg = ref('');
let runTimer: ReturnType<typeof setTimeout> | null = null;
async function runFile() {
  try {
    await runScript(props.projectId, props.path);
    runMsg.value = '已在系统中执行';
  } catch (e: any) {
    runMsg.value = `执行失败：${e?.message || e}`;
  }
  if (runTimer) clearTimeout(runTimer);
  runTimer = setTimeout(() => { runMsg.value = ''; }, 3200);
}
```

替换为：

```ts
// —— 运行脚本（bat/cmd/ps1/sh）——
async function runFile() {
  try {
    await runScript(props.projectId, props.path);
    setToolMsg('✓ 已在系统中执行');
  } catch (e: any) {
    setToolMsg(`执行失败：${e?.message || e}`, false);
  }
}
```

- [ ] **Step 2: 删除 formatDoc 区的 `fmtMsg`/`fmtTimer`/`flashFmt`，改 `setToolMsg`**

将（现约 504-546 行）整个块替换：

```ts
// —— 一键格式化（Prettier 按需加载）——
const PARSER_BY_EXT: Record<string, string> = {
  js: 'babel', mjs: 'babel', cjs: 'babel', jsx: 'babel',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', css: 'css', html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml',
};
const canFormat = computed(() => kind.value === 'text' && !!PARSER_BY_EXT[ext.value]);
async function formatDoc() {
  if (!view || !canFormat.value) return;
  const parser = PARSER_BY_EXT[ext.value];
  const doc = view.state.doc.toString();
  try {
    const [{ default: prettierAny }, babelM, estreeM, tsM, htmlM, postcssM, mdM] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
      import('prettier/plugins/typescript'),
      import('prettier/plugins/html'),
      import('prettier/plugins/postcss'),
      import('prettier/plugins/markdown'),
    ]);
    const prettier = (prettierAny as any).default ?? prettierAny;
    const pl = (m: any) => (m.default ?? m);
    const plugins = [pl(babelM), pl(estreeM), pl(tsM), pl(htmlM), pl(postcssM), pl(mdM)];
    const out = await prettier.format(doc, { parser, plugins });
    if (out !== doc) {
      view.dispatch({ changes: { from: 0, to: doc.length, insert: out } });
      setToolMsg('✓ 已格式化');
    } else {
      setToolMsg('格式已是最佳');
    }
  } catch (e: any) {
    setToolMsg(`格式化失败：${e?.message || e}`, false);
  }
}
```

（已删除 `fmtMsg`、`fmtTimer`、`flashFmt`；`canFormat` 保留。）

- [ ] **Step 3: 移除 `onBeforeUnmount` 里的 `runTimer` 清理**

将 `onBeforeUnmount` 内的 `if (runTimer) clearTimeout(runTimer);` 一行删除，保留其余（`unbindSort?.()`、`flush()`、`view.destroy()`）。

- [ ] **Step 4: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无错误退出（确认无 `runMsg`/`fmtMsg`/`runTimer`/`fmtTimer` 残留引用）。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "feat(preview): 格式化/运行反馈改用底部状态栏，删除顶栏闪字与定时器"
```

---

### Task 3: 排序成功补状态栏反馈文案

**Files:**
- Modify: `web/src/components/FilePreview.vue`

- [ ] **Step 1: 增加排序模式→中文标签映射**

在 `SORT_ITEMS` 定义之后加：

```ts
const SORT_LABEL: Record<SortMode, string> = {
  asc: '升序', desc: '降序', 'asc-ci': '升序（不分大小写）', 'desc-ci': '降序（不分大小写）',
  'num-asc': '数字升序', 'num-desc': '数字降序',
};
```

- [ ] **Step 2: `applySort` 成功后写入反馈**

将 `applySort` 末尾（`sortOpen.value = false;` 之后）补一行：

```ts
function applySort(mode: SortMode) {
  if (!view) return;
  const out = sortLines(mode);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out } });
  sortOpen.value = false;
  requestMeasure();
  setToolMsg(`✓ 已按${SORT_LABEL[mode]}排列`);
}
```

- [ ] **Step 3: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无错误退出。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "feat(preview): 文本排序成功后在状态栏反馈"
```

---

### Task 4: 模板顶栏移除保存状态与 fmtMsg/runMsg 内嵌文字

**Files:**
- Modify: `web/src/components/FilePreview.vue`（文本分支 `.head .right`）

- [ ] **Step 1: 删除顶栏四个内嵌反馈 span**

删除 `.right` 内以下四行（现 581-584 与 597 行）：

```html
          <span v-if="saveState === 'saving'" class="save saveing">保存中…</span>
          <span v-else-if="saveState === 'saved'" class="save saveok">✓ {{ saveMsg }} 已保存</span>
          <span v-else-if="saveState === 'error'" class="save saveerr" title="点击重试" @click="onRetrySave">⚠ 保存失败：{{ saveMsg }}</span>
          <span v-if="fmtMsg" class="save fmtmsg" :class="{ ok: fmtMsg.startsWith('✓') }">{{ fmtMsg }}</span>
```

以及：

```html
          <span v-if="runMsg" class="save runmsg">{{ runMsg }}</span>
```

`onRetrySave` 函数保留（状态栏错误段复用）。

- [ ] **Step 2: 删除不再使用的 CSS 规则**

从 `<style scoped>` 删除以下规则块：`.save`、`.saveok`、`.saveing`、`.saveerr`、`.fmtmsg`、`.fmtmsg.ok`、`.runmsg`。（保留 `.run-btn`；顶栏按钮 `fmt-btn` 系列保留。）

- [ ] **Step 3: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无错误退出。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "feat(preview): 顶栏移除保存/反馈内嵌文字，仅保留按钮"
```

---

### Task 5: 模板底部追加常驻状态栏

**Files:**
- Modify: `web/src/components/FilePreview.vue`（模板根 `.preview` 末尾 + `<style scoped>`）

- [ ] **Step 1: `.preview` 末尾追加状态栏元素**

在 `.preview` 根 div 的**最后一个子元素**（现为 `detailpanel` div 之后）追加：

```html
    <div class="statusbar">
      <span v-if="saveState === 'saving'" class="st saveing">保存中…</span>
      <span v-else-if="saveState === 'saved'" class="st saveok">✓ {{ saveMsg }} 已保存</span>
      <span v-else-if="saveState === 'error'" class="st saveerr" title="点击重试" @click="onRetrySave">⚠ 保存失败：{{ saveMsg }}</span>
      <span v-if="toolMsg" class="st toolmsg" :class="{ err: !toolOk }" :title="toolMsg">{{ toolMsg }}</span>
    </div>
```

注意：`saveMsg` 在 `saved` 时已是 `nowTime()`（如 `12:03:45`），展示 `✓ 12:03:45 已保存` 与旧文案一致。

- [ ] **Step 2: 追加状态栏样式**

在 `<style scoped>` 末尾追加：

```css
.statusbar { flex: none; display: flex; align-items: center; gap: 14px; height: 24px; padding: 0 10px; border-top: 1px solid var(--bd); background: var(--bg2); overflow: hidden; white-space: nowrap; box-sizing: border-box; }
.st { font-size: 11px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st.saveing { color: var(--warn); }
.st.saveok { color: var(--ok); }
.st.saveerr { color: var(--errtx); cursor: pointer; }
.st.toolmsg { color: var(--tx2); }
.st.toolmsg.err { color: var(--errtx); }
```

说明：`.statusbar` 为 `.preview` flex 列最后一个 `flex: none` 子项，永久占 24px → 上方预览/编辑区高度恒定；空态（无保存且无反馈）时仅留一条空栏，布局不变。

- [ ] **Step 3: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无错误退出。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "feat(preview): 底部新增常驻单行状态栏（保存状态最左 + 工具反馈）"
```

---

### Task 6: 全量验证（test + build）

**Files:** 无改动

- [ ] **Step 1: 运行全部测试**

Run: `npm.cmd test`
Expected: server 测试 + web vitest 全部通过（本改动不涉及 server，主要用于回归确认）。

- [ ] **Step 2: 生产构建**

Run: `npm.cmd run build:web`
Expected: `vue-tsc --noEmit && vite build` 成功，产出 `web/dist`。

- [ ] **Step 3: 手动验证清单（浏览器 dev:server + dev:web）**

逐项确认：
1. 打开文本文件，点 ⇥ 格式化 → 状态栏出现 `✓ 已格式化`，保留不消失；再次点格式化（内容已最佳）→ `格式已是最佳` 覆盖上一条。
2. 打开 js/json，点 ⇣ 压成一行 → `✓ 已压缩为一行`；在非 js/json 无此按钮。构造含语法错误的压缩（若 format 抛错）→ 失败文案进状态栏、无 `alert()` 弹窗。
3. ⇅ 排序选任一项 → `✓ 已按数字升序排列` 等。
4. 打开 .bat/.ps1 点 ▶ 运行 → `✓ 已在系统中执行`；人为造失败（路径不存在）→ `⚠ 执行失败：…`。
5. 编辑文件触发自动保存 → 状态栏最左依次 `保存中…` → `✓ 12:03:45 已保存`。
6. 打开只读文件（改权限或只读属性）编辑 → `⚠ 保存失败：…` 出现在最左，点击可重试。
7. 打开图片/PDF → 底部同样有常驻空状态栏；点 ⓘ 详细信息面板在状态栏上方弹出，布局稳定无跳动。
8. 无任何操作时状态栏整条留白；切换文件后工具反馈段被清空。
9. 打开 Base64 面板 + 状态栏共存，上方高度随 Base64 开关变化（既有行为），状态栏始终贴底。

- [ ] **Step 4: Commit（如有验证期小修正，随修正一并提交）**

---

### Task 7: 同步远端（master）与 devflow

按仓库既定工作流：statistic 分支提交 → push 到远端 master → devflow pull。

**Files:** 无（仅 git 操作，在 `D:\root\devflow_statistic\statistic_devflow` 执行）

- [ ] **Step 1: 推送本地 HEAD 到远端 master**

Run: `git push "https://gitee.com/wglj/devflow.git" HEAD:master`（凭据从 `env/` 读取，禁止写入文档）
Expected: `old..new HEAD -> master` 成功。

- [ ] **Step 2: devflow 拉取**

Run: `git -C "D:\root\devflow\devflow" pull origin master`
Expected: fast-forward 到与远端一致（仅更新 `FilePreview.vue`）。

- [ ] **Step 3: 确认 devflow 状态**

Run: `git -C "D:\root\devflow\devflow" rev-parse HEAD origin/master`
Expected: 两者输出一致。

- [ ] **Step 4: 告知用户刷新 devflow 的 :5173 页面验证**
