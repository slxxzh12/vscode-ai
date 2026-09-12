# 网页截图（Snapshot）功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 devflow 网页顶栏加一个相机按钮，点击后把当前页面截取为 PNG 并触发下载。

**Architecture:** 新增纯逻辑模块 `web/src/snapshot.ts`（文件名生成、背景色解析、filter、选项构造、`captureToPng`），用 `html-to-image` 的 `toPng` 把 `.app` DOM 节点序列化为 PNG；`App.vue` 负责按钮、忙碌态与错误提示；文案走 `shared/i18n` 中英词条。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、vitest、`html-to-image`、npm workspaces。

---

## 文件结构

- 修改：`web/package.json` —— 新增 `html-to-image` 依赖。
- 新建：`web/src/snapshot.ts` —— 截图纯逻辑 + 下载副作用。
- 新建：`web/src/snapshot.test.ts` —— vitest 单测。
- 修改：`shared/i18n/zh-CN.js`、`shared/i18n/en.js` —— 新增 2 个词条。
- 修改：`web/src/App.vue` —— 根节点 ref、相机按钮、`onSnapshot`、样式。

---

## Task 1: 安装 html-to-image 依赖

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: 安装依赖**

Run（在仓库根目录）:
```powershell
npm.cmd install html-to-image --workspace @devflow/web
```
Expected: 命令成功；`web/package.json` 的 `dependencies` 出现 `"html-to-image": "^1.x.x"`。

- [ ] **Step 2: 验证依赖落盘**

Run:
```powershell
Test-Path "node_modules\html-to-image"
```
Expected: `True`。

- [ ] **Step 3: Commit**

```powershell
git add web/package.json package-lock.json; git commit -m "chore(web): 新增 html-to-image 依赖"
```

---

## Task 2: `snapshotFileName` 文件名生成

**Files:**
- Create: `web/src/snapshot.ts`
- Test: `web/src/snapshot.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `web/src/snapshot.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { snapshotFileName } from './snapshot';

describe('snapshotFileName', () => {
  it('固定日期 → devflow-YYYYMMDD-HHmmss.png（各段补零）', () => {
    const d = new Date(2026, 8, 12, 9, 30, 5);
    expect(snapshotFileName(d)).toBe('devflow-20260912-093005.png');
  });

  it('月在个位时补零', () => {
    const d = new Date(2026, 0, 3, 0, 0, 0);
    expect(snapshotFileName(d)).toBe('devflow-20260103-000000.png');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```powershell
npm.cmd --prefix web run test -- snapshot
```
Expected: FAIL —— 无法解析 `./snapshot`（模块不存在）。

- [ ] **Step 3: 写最小实现**

创建 `web/src/snapshot.ts`：

```typescript
export function snapshotFileName(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ymd = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const hms = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `devflow-${ymd}-${hms}.png`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```powershell
npm.cmd --prefix web run test -- snapshot
```
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```powershell
git add web/src/snapshot.ts web/src/snapshot.test.ts; git commit -m "feat(web): snapshot 文件名生成"
```

---

## Task 3: `snapshotBackground` 背景色解析

**Files:**
- Modify: `web/src/snapshot.ts`
- Test: `web/src/snapshot.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `web/src/snapshot.test.ts` 末尾追加：

```typescript
import { snapshotBackground } from './snapshot';

type FakeStyle = { getPropertyValue(name: string): string };
function styleReader(vars: Record<string, string>) {
  return (): FakeStyle => ({ getPropertyValue: (name: string) => vars[name] ?? '' });
}

describe('snapshotBackground', () => {
  it('优先取 --bg1', () => {
    const el = {} as HTMLElement;
    const get = styleReader({ '--bg1': '#282c34', '--bg0': '#111111' });
    expect(snapshotBackground(el, get)).toBe('#282c34');
  });

  it('--bg1 为空时回退 --bg0', () => {
    const el = {} as HTMLElement;
    const get = styleReader({ '--bg1': '  ', '--bg0': '#111111' });
    expect(snapshotBackground(el, get)).toBe('#111111');
  });

  it('都为空时回退兜底色 #1e1e1e', () => {
    const el = {} as HTMLElement;
    const get = styleReader({});
    expect(snapshotBackground(el, get)).toBe('#1e1e1e');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```powershell
npm.cmd --prefix web run test -- snapshot
```
Expected: FAIL —— `snapshotBackground` 未导出。

- [ ] **Step 3: 写最小实现**

在 `web/src/snapshot.ts` 追加：

```typescript
export type StyleReader = (el: HTMLElement) => { getPropertyValue(name: string): string };

export function snapshotBackground(
  el: HTMLElement,
  getStyle: StyleReader = (e) => getComputedStyle(e),
): string {
  const s = getStyle(el);
  return (s.getPropertyValue('--bg1') || '').trim()
    || (s.getPropertyValue('--bg0') || '').trim()
    || '#1e1e1e';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```powershell
npm.cmd --prefix web run test -- snapshot
```
Expected: PASS（5 passed）。

- [ ] **Step 5: Commit**

```powershell
git add web/src/snapshot.ts web/src/snapshot.test.ts; git commit -m "feat(web): snapshot 背景色解析（含三级回退）"
```

---

## Task 4: `snapshotFilter` 与 `snapshotOptions`

**Files:**
- Modify: `web/src/snapshot.ts`
- Test: `web/src/snapshot.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `web/src/snapshot.test.ts` 末尾追加：

```typescript
import { snapshotFilter, snapshotOptions } from './snapshot';

describe('snapshotFilter', () => {
  it('带 data-snapshot-skip 的节点被跳过', () => {
    const node = { hasAttribute: (n: string) => n === 'data-snapshot-skip' } as unknown as HTMLElement;
    expect(snapshotFilter(node)).toBe(false);
  });

  it('普通节点保留', () => {
    const node = { hasAttribute: () => false } as unknown as HTMLElement;
    expect(snapshotFilter(node)).toBe(true);
  });

  it('无 hasAttribute 的对象也保留（不抛错）', () => {
    expect(snapshotFilter({} as unknown as HTMLElement)).toBe(true);
  });
});

describe('snapshotOptions', () => {
  it('组合 cacheBust / pixelRatio / backgroundColor / filter', () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (n: string) => (n === '--bg1' ? '#abcdef' : '') }));
    try {
      const o = snapshotOptions({} as HTMLElement, 2);
      expect(o).toMatchObject({ cacheBust: true, pixelRatio: 2, backgroundColor: '#abcdef' });
      expect(typeof o.filter).toBe('function');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```powershell
npm.cmd --prefix web run test -- snapshot
```
Expected: FAIL —— `snapshotFilter` / `snapshotOptions` 未导出。

- [ ] **Step 3: 写最小实现**

在 `web/src/snapshot.ts` 追加：

```typescript
export interface SnapshotOptions {
  cacheBust: boolean;
  pixelRatio: number;
  backgroundColor: string;
  filter: (node: HTMLElement) => boolean;
}

export function snapshotFilter(node: HTMLElement): boolean {
  return !(node && typeof node.hasAttribute === 'function' && node.hasAttribute('data-snapshot-skip'));
}

export function snapshotOptions(
  el: HTMLElement,
  pixelRatio: number = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1,
): SnapshotOptions {
  return {
    cacheBust: true,
    pixelRatio,
    backgroundColor: snapshotBackground(el),
    filter: snapshotFilter,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```powershell
npm.cmd --prefix web run test -- snapshot
```
Expected: PASS（9 passed）。

- [ ] **Step 5: Commit**

```powershell
git add web/src/snapshot.ts web/src/snapshot.test.ts; git commit -m "feat(web): snapshot filter 与选项构造"
```

---

## Task 5: `captureToPng` 与下载副作用

**Files:**
- Modify: `web/src/snapshot.ts`
- Test: `web/src/snapshot.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `web/src/snapshot.test.ts` 末尾追加：

```typescript
import { captureToPng } from './snapshot';

describe('captureToPng', () => {
  it('调用 toPng 并把结果交给 download（文件名符合规范）', async () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#010203' }));
    const calls: { dataUrl: string; filename: string }[] = [];
    let passedEl: HTMLElement | null = null;
    let passedRatio = -1;
    try {
      await captureToPng({} as HTMLElement, {
        toPng: async (target, options) => {
          passedEl = target;
          passedRatio = options.pixelRatio;
          expect(options.backgroundColor).toBe('#010203');
          return 'data:image/png;base64,AAAA';
        },
        download: (dataUrl, filename) => { calls.push({ dataUrl, filename }); },
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(passedEl).not.toBeNull();
    expect(passedRatio).toBeGreaterThanOrEqual(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].dataUrl).toBe('data:image/png;base64,AAAA');
    expect(calls[0].filename).toMatch(/^devflow-\d{8}-\d{6}\.png$/);
  });

  it('toPng 抛错时向上抛出', async () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#000' }));
    try {
      await expect(captureToPng({} as HTMLElement, {
        toPng: async () => { throw new Error('boom'); },
        download: () => { /* not reached */ },
      })).rejects.toThrow('boom');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```powershell
npm.cmd --prefix web run test -- snapshot
```
Expected: FAIL —— `captureToPng` 未导出。

- [ ] **Step 3: 写最小实现**

在 `web/src/snapshot.ts` 顶部加导入，并追加实现：

```typescript
import { toPng } from 'html-to-image';
```

```typescript
export interface SnapshotDeps {
  toPng: (el: HTMLElement, options: SnapshotOptions) => Promise<string>;
  download: (dataUrl: string, filename: string) => void;
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function captureToPng(
  el: HTMLElement,
  deps: SnapshotDeps = { toPng, download: downloadDataUrl },
): Promise<void> {
  const dataUrl = await deps.toPng(el, snapshotOptions(el));
  deps.download(dataUrl, snapshotFileName());
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```powershell
npm.cmd --prefix web run test -- snapshot
```
Expected: PASS（11 passed）。

- [ ] **Step 5: Commit**

```powershell
git add web/src/snapshot.ts web/src/snapshot.test.ts; git commit -m "feat(web): snapshot 截图并下载 PNG"
```

---

## Task 6: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:28`
- Modify: `shared/i18n/en.js:28`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 的 `'top.add_failed'` 行之后插入：

```javascript
  'top.snapshot': '截图当前页面',
  'top.snapshot.failed': '截图失败，请重试。',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 的 `'top.add_failed'` 行之后插入（与中文键一一对应）：

```javascript
  'top.snapshot': 'Capture current page',
  'top.snapshot.failed': 'Failed to capture the page, please try again.',
```

- [ ] **Step 3: 校验 i18n**

Run:
```powershell
npm.cmd run check:i18n
```
Expected: 输出 `check-i18n: 未发现中文命中`（退出码 0）。

- [ ] **Step 4: Commit**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js; git commit -m "feat(i18n): 截图功能中英词条"
```

---

## Task 7: App.vue 接入相机按钮

**Files:**
- Modify: `web/src/App.vue`

- [ ] **Step 1: 引入依赖与状态**

在 `web/src/App.vue` 的 `<script setup>` 顶部导入区（现有 `import WorkspacePicker from './components/WorkspacePicker.vue';` 之后）加：

```typescript
import { captureToPng } from './snapshot';
```

在 `const ws = useWorkspace();` 附近加：

```typescript
const appRef = ref<HTMLDivElement | null>(null);
const snapshotting = ref(false);
async function onSnapshot() {
  if (snapshotting.value) return;
  const el = appRef.value;
  if (!el) return;
  snapshotting.value = true;
  try {
    await nextTick();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await captureToPng(el);
  } catch {
    alert(t('top.snapshot.failed'));
  } finally {
    snapshotting.value = false;
  }
}
```

> 注意：`nextTick` 已在文件首行 `import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue';` 中导入，需确保改为包含 `nextTick`。

- [ ] **Step 2: 根节点绑定 ref**

把模板中的

```html
  <div class="app">
```

改为

```html
  <div class="app" ref="appRef">
```

- [ ] **Step 3: 添加相机按钮**

在 `.top` 里主题按钮（`<button class="theme-btn" ...>`）之前插入：

```html
      <button class="snap-btn" :disabled="snapshotting" :class="{ 'snap-hidden': snapshotting }" :title="$t('top.snapshot')" @click="onSnapshot">📷</button>
```

- [ ] **Step 4: 添加样式**

在 `<style scoped>` 的 `.theme-btn:hover { border-color: var(--ac2); }` 之后加：

```css
.snap-btn { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 9px; cursor: pointer; font-size: 14px; line-height: 1; }
.snap-btn:hover { border-color: var(--ac2); }
.snap-btn:disabled { opacity: .6; cursor: default; }
.snap-hidden { visibility: hidden; }
```

并把「顶栏着色」规则中的 `.theme-btn` 一并包含 `.snap-btn`：

```css
.top.colored .lang-btn, .top.colored .theme-btn, .top.colored .snap-btn, .top.colored .addproj { background: rgba(255,255,255,.16); color: #fff; border-color: rgba(255,255,255,.45); }
```

- [ ] **Step 5: 类型检查**

Run:
```powershell
npm.cmd run typecheck
```
Expected: 无错误（退出码 0）。

- [ ] **Step 6: Commit**

```powershell
git add web/src/App.vue; git commit -m "feat(web): 顶栏相机按钮触发页面截图下载"
```

---

## Task 8: 全量验证与人工验收

**Files:** 无（验证任务）

- [ ] **Step 1: 全量单测**

Run:
```powershell
npm.cmd test
```
Expected: server + web 全部通过。

- [ ] **Step 2: i18n 与类型**

Run:
```powershell
npm.cmd run check:i18n; if ($?) { npm.cmd run typecheck }
```
Expected: `check-i18n: 未发现中文命中`；typecheck 无错误。

- [ ] **Step 3: 前端可构建**

Run:
```powershell
npm.cmd run build:web
```
Expected: vite build 成功，产物在 `web/dist`。

- [ ] **Step 4: 人工验收（浏览器）**

Run（后台非阻塞启动，按 AGENTS.md 规范）:
```powershell
npm.cmd run dev:web
```
打开 http://localhost:5173：
1. 亮色与暗色主题各点一次相机按钮；
2. 确认下载得到 `devflow-<时间戳>.png`；
3. 图片内容 = 整个 devflow 界面（顶栏/侧栏/终端或预览），相机按钮自身不出现在图中；
4. 快捷键无冲突、连续点击不产生并发下载。

- [ ] **Step 5: 最终提交（如验收中改了代码）**

```powershell
git add -A
git commit -m "fix(web): 截图验收问题修正"
```

---

## 自检记录

- **Spec 覆盖**：截取范围（`.app` 根）→ Task 7；下载 PNG → Task 5；顶栏按钮 → Task 7；`html-to-image` → Task 1；`snapshot.ts` 各函数 → Task 2-5；i18n → Task 6；单测/类型/i18n/人工验收 → Task 8。已全覆盖。
- **无占位符**：每个代码步骤均给出完整代码与命令。
- **类型一致**：`SnapshotOptions`、`SnapshotDeps`、`snapshotFileName/snapshotBackground/snapshotFilter/snapshotOptions/captureToPng` 全程同名同签名。
