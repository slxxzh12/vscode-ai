# 文档型工具主区双击新建文件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 notepad / yaml / markdown 工具的主内容区在「未选择文件」空状态下，双击即在该工具当前目录自动新建并打开一个文件。

**Architecture:** 在 `useToolWorkbench`（按 tool 共享的工作台状态）上新增 `newFile()`：取默认名 → `files.createFile(activeFolder, name)` → 设为 `activeId` → 派发 `df-refresh-tree` 刷新左侧树。`ToolDocPane.vue` 的空状态面板挂 `@dblclick` 调它。扩展名集中在 `DEFAULT_EXT` 补齐。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、Vitest + happy-dom、`@vue/test-utils`、shared i18n（zh-CN/en）。

---

## File Structure

- Modify: `web/src/tools/useToolWorkbench.ts` — 工作台状态层，新增 `DEFAULT_EXT` 项与 `newFile()`。
- Modify: `web/src/tools/useToolWorkbench.test.ts` — `newFile()` 单测。
- Modify: `shared/i18n/zh-CN.js` + `shared/i18n/en.js` — 新增 `files.dblclick_new` 词条。
- Modify: `web/src/tools/doc/ToolDocPane.vue` — 空状态挂双击 + 提示文案。
- Create: `web/src/tools/doc/ToolDocPane.test.ts` — 空状态双击行为测试。

参考（不改）：`web/src/tools/files/useToolFiles.ts`（`createFile` 返回新文件 id）、`web/src/tree/toolFileTreeSource.ts`（`defaultName()`）、`web/src/components/TreeView.vue`（监听 `df-refresh-tree`）。

---

### Task 1: 工作台 `newFile()`

**Files:**
- Modify: `web/src/tools/useToolWorkbench.ts`
- Test: `web/src/tools/useToolWorkbench.test.ts`

- [ ] **Step 1: 写失败测试**

把 `web/src/tools/useToolWorkbench.test.ts` 整体替换为：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useToolWorkbench } from './useToolWorkbench';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('useToolWorkbench', () => {
  it('同一 tool 返回同一实例（activeId 共享）', () => {
    const a = useToolWorkbench('notepad');
    const b = useToolWorkbench('notepad');
    expect(a).toBe(b);
    a.activeId.value = 'x.txt';
    expect(b.activeId.value).toBe('x.txt');
    a.activeId.value = '';
  });

  it('不同 tool 相互隔离', () => {
    const a = useToolWorkbench('yaml');
    const b = useToolWorkbench('translate');
    expect(a).not.toBe(b);
    a.activeId.value = 'a.yaml';
    expect(b.activeId.value).toBe('');
    a.activeId.value = '';
  });

  it('newFile：在当前目录按日期时间命名创建并打开', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 15, 30, 12)); // 2026-09-29 15:30:12
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/tree')) return { ok: true, json: async () => ({ items: [], folders: [] }) };
      return { ok: true, json: async () => ({ id: 'sub/20260929-153012.txt' }) };
    }));
    const wb = useToolWorkbench('notepad');
    wb.activeFolder.value = 'sub';
    await wb.newFile();
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe('/api/files/notepad/file');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ folder: 'sub', name: '20260929-153012.txt' });
    expect(wb.activeId.value).toBe('sub/20260929-153012.txt');
    wb.activeId.value = '';
    wb.activeFolder.value = '';
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- useToolWorkbench`
Expected: FAIL —— `wb.newFile is not a function`。

- [ ] **Step 3: 实现 `newFile()`**

在 `web/src/tools/useToolWorkbench.ts`：

3a. 顶部 import 增加 `t`：

```ts
import { t } from '../i18n';
```

3b. `DEFAULT_EXT` 补齐（第 24 行附近）：

```ts
// 各工具新建文件的默认扩展名：缺省则新建时用空文件名（用户手输）
const DEFAULT_EXT: Partial<Record<FileTool, string>> = { notepad: '.txt', yaml: '.yaml', markdown: '.md' };
```

3c. `ToolWorkbench` 接口增加方法（在 `reload(): Promise<void>;` 之前）：

```ts
  newFile(): Promise<void>;
```

3d. 在 `useToolWorkbench` 内、`const wb: ToolWorkbench = {` 之前定义函数：

```ts
  // 主区空状态双击：在当前目录按「日期时间+扩展名」自动新建并打开
  async function newFile(): Promise<void> {
    const name = treeSource.defaultName?.() || '';
    try {
      const id = await files.createFile(activeFolder.value, name);
      if (!id) throw new Error('create failed');
      activeId.value = id;
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('df-refresh-tree'));
    } catch (e) {
      if (typeof window !== 'undefined') alert(t('tree.create_failed', { msg: (e as Error)?.message || String(e) }));
    }
  }
```

3e. 把 `newFile` 加入返回对象（`reload: () => files.load(),` 之前）：

```ts
    newFile,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- useToolWorkbench`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/useToolWorkbench.ts web/src/tools/useToolWorkbench.test.ts
git commit -m "feat(tools): 工作台新增 newFile（当前目录自动命名创建并打开）"
```

---

### Task 2: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:852`
- Modify: `shared/i18n/en.js:852`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 的 `'files.no_file': '未选择文件',` 后新增一行：

```js
  'files.dblclick_new': '双击此处新建文件',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 的 `'files.no_file': 'No file selected',` 后新增一行：

```js
  'files.dblclick_new': 'Double-click to create a file',
```

- [ ] **Step 3: 校验对称**

Run: `npm.cmd run check:i18n`
Expected: 通过，无「键集合不对称」报错。

- [ ] **Step 4: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 新增 files.dblclick_new 词条"
```

---

### Task 3: 主区空状态双击

**Files:**
- Modify: `web/src/tools/doc/ToolDocPane.vue`
- Test: `web/src/tools/doc/ToolDocPane.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/tools/doc/ToolDocPane.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountC } from '../../test-utils';

const h = vi.hoisted(() => ({
  newFile: vi.fn(),
  activeId: { value: '' },
}));

vi.mock('../../components/DocViewer.vue', () => ({
  default: { name: 'DocViewer', template: '<div class="dv" />' },
}));
vi.mock('../useToolWorkbench', () => ({
  useToolWorkbench: () => ({
    tool: 'notepad',
    activeId: h.activeId,
    leafName: { value: '' },
    docSource: {},
    newFile: h.newFile,
  }),
}));

import ToolDocPane from './ToolDocPane.vue';

describe('ToolDocPane', () => {
  beforeEach(() => { h.newFile.mockReset(); h.activeId.value = ''; });

  it('空状态双击 → 调用 newFile', async () => {
    const w = mountC(ToolDocPane, { props: { tool: 'notepad' } });
    expect(w.find('.tdp-empty').exists()).toBe(true);
    await w.find('.tdp-empty').trigger('dblclick');
    expect(h.newFile).toHaveBeenCalledTimes(1);
  });

  it('有活动文件时不渲染空状态，改为显示 DocViewer', () => {
    h.activeId.value = 'a.txt';
    const w = mountC(ToolDocPane, { props: { tool: 'notepad' } });
    expect(w.find('.tdp-empty').exists()).toBe(false);
    expect(w.find('.dv').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- ToolDocPane`
Expected: FAIL —— 第一个用例 `.tdp-empty` 存在但 `h.newFile` 未被调用（尚未绑定双击）。

- [ ] **Step 3: 改 `ToolDocPane.vue`**

将 `<template>` 内的空状态分支替换为：

```html
    <div v-else class="tdp-empty" @dblclick="wb.newFile()">
      <div class="tdp-empty-main">{{ $t('files.no_file') }}</div>
      <div class="tdp-empty-hint">{{ $t('files.dblclick_new') }}</div>
    </div>
```

将 `<style scoped>` 内容替换为：

```css
.tdp { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.tdp-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--tx4); font-size: 13px; cursor: pointer; }
.tdp-empty-hint { font-size: 12px; opacity: .8; }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- ToolDocPane`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/doc/ToolDocPane.vue web/src/tools/doc/ToolDocPane.test.ts
git commit -m "feat(tools): 主区空状态双击新建并打开文件"
```

---

### Task 4: 全量校验与手动验收

**Files:** 无（验证）

- [ ] **Step 1: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过，无错误。

- [ ] **Step 2: 全部单测**

Run: `npm.cmd test`
Expected: server + web 全部通过。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 通过。

- [ ] **Step 4: 手动验收（dev）**

启动 `npm.cmd run dev`（后端 33333 / 前端 5173），打开 notepad：
1. 在左侧树选中一个文件夹 → 双击右侧主区空白 → 左侧树出现 `YYYYMMDD-HHMMSS.txt`，主区已打开该文件且可输入。
2. 有文件打开时双击编辑器内文字 = 选词，不新建。
3. 切到 yaml / markdown 重复，扩展名分别为 `.yaml` / `.md`。
4. 同一秒内重复双击（极端）不应导致页面报错（弹出创建失败提示属预期）。

---

## Self-Review

**Spec coverage：**
- 行为（空状态双击、当前目录、不弹窗、立即打开、有文件不触发）→ Task 1（`newFile`）+ Task 3（`@dblclick`）。
- 命名/扩展名 → Task 1 Step 3b。
- i18n → Task 2。
- 测试 → Task 1 Step 1、Task 3 Step 1。
- 验收 → Task 4。

**Placeholder scan：** 无 TBD/TODO；所有步骤含完整代码与命令。

**Type consistency：** `newFile(): Promise<void>` 在接口与实现一致；`files.createFile(folder, name): Promise<string>` 返回 id 用于 `activeId`；`treeSource.defaultName?()` 存在于 `TreeSource` 契约。
