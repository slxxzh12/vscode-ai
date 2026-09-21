# 拖入本地文件直接预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 OS 文件/文件夹拖到网页上直接展示内容（Markdown 预览等），可编辑并写回原文件；拖文件夹时左侧出现目录树、Markdown 相对图片可解析。

**Architecture:** 全程浏览器 `FileSystemHandle`（不碰服务端）：拖入的句柄存入模块级单例 `useLocalSources`，新增中心页签 kind `local`；内容复用现有 `DocViewer`，注入新的本地 `DocSource`；树复用现有 `TreeView`，注入新的 `localTreeSource`；Markdown 相对资源在 `DocViewer` 预解析成 `blob:` URL 后传给 `markdown.ts`。

**Tech Stack:** Vue 3 + Vite + TypeScript（`web/`）、vitest + happy-dom、现有 `DocViewer` / `TreeView` / `useCenter` / `markdown.ts`。无新依赖。

**参考设计：** `docs/superpowers/specs/2026-09-21-local-file-drop-preview-design.md`

**关键环境注意：**
- Windows + PowerShell 5.1，**无 bash**；统一用 `npm.cmd`。
- 本机 TS 的 `lib.dom` **没有** `FileSystemHandle.requestPermission/queryPermission`、`FileSystemDirectoryHandle.values()`、`DataTransferItem.getAsFileSystemHandle()` 的类型 → 这些位置一律 `as any` 转换，勿硬写类型。
- 每个测试文件首行按需加 `// @vitest-environment happy-dom`（需要 `File`/`Blob`/DOM 时）。
- 单测命令：`npm.cmd --prefix web run test -- <关键字>`；全量：`npm.cmd test`；类型：`npm.cmd run typecheck`；词条：`npm.cmd run check:i18n`。
- 提交前按 `docs/learn/git仓库提交检查和提交事项.md` 执行检查（只 `git add` 本次文件，禁止 `git add -A`）。

---

## 文件结构

新增（`web/src/local/`）：
- `localHandles.ts` — 纯函数：扩展名/种类、相对路径规范化、大小上限、二进制探测、handles 支持探测、handle 分组。
- `localBlobs.ts` — `blob:` URL 作用域登记与回收（防泄漏）。
- `useLocalSources.ts` — 模块级单例状态：本地根 + 单文件条目 + 激活路径。
- `localDocSource.ts` — `DocSource` 实现（读/写/blob/相对资源）。
- `localTreeSource.ts` — `TreeSource` 实现（目录句柄懒加载）。
- `useLocalDrop.ts` — window 级拖拽监听。
- `LocalDropOverlay.vue` — 全屏拖拽提示。
- `LocalSidebar.vue` — 左侧本地目录树。
- 对应 5 个 `*.test.ts`。

修改：
- `web/src/tools/doc/docSource.ts` — 契约加两个可选方法。
- `web/src/markdown.ts` + `web/src/markdown.test.ts` — `collectAssetRefs` + `assetMap`。
- `web/src/components/DocViewer.vue` — 预览前预解析相对资源。
- `web/src/useCenter.ts` + `web/src/useCenter.test.ts` — `local` 页签。
- `web/src/components/TerminalView.vue` — `local` 内容层。
- `web/src/App.vue` — 挂拖拽监听、左侧分支、overlay。
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js` — `local.*` 词条。

---

### Task 1: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 加中文词条**

在 `shared/i18n/zh-CN.js` 中，用编辑工具把唯一出现的 `  'llm.failed':` 替换为下面内容（保留 `'llm.failed'` 原文，仅在其前插入）：

```
  'local.drop_hint': '松开以打开文件',
  'local.unsupported': '当前浏览器不支持读取拖入的文件夹，请使用 Chrome / Edge',
  'local.write_unsupported': '当前浏览器不支持写回原文件（仅只读预览）',
  'local.permission_needed': '需要写入授权：请点击“保存”重试以授予权限',
  'local.too_large': '文件超过 {max}，已拒绝打开',
  'local.read_failed': '读取失败：{msg}',
  'local.empty': '未选择文件',
  'local.extra_folders': '一次只能挂载一个文件夹，已使用第一个',
  'local.too_many_files': '一次最多打开 {max} 个文件，多余的已忽略',
  'llm.failed':
```

- [ ] **Step 2: 加英文词条**

在 `shared/i18n/en.js` 中，把唯一出现的 `  'llm.failed':` 替换为：

```
  'local.drop_hint': 'Drop to open',
  'local.unsupported': 'This browser cannot read dropped folders; use Chrome / Edge',
  'local.write_unsupported': 'This browser cannot write back to the original file (read-only preview)',
  'local.permission_needed': 'Write permission required: click "Save" again to grant it',
  'local.too_large': 'File exceeds {max}; open refused',
  'local.read_failed': 'Read failed: {msg}',
  'local.empty': 'No file selected',
  'local.extra_folders': 'Only one folder can be mounted at a time; using the first',
  'local.too_many_files': 'At most {max} files per drop; the rest were ignored',
  'llm.failed':
```

- [ ] **Step 3: 校验词条对称**

Run: `npm.cmd run check:i18n`
Expected: 通过（无缺失键报错）。

- [ ] **Step 4: Commit**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 新增拖入本地文件的 local.* 词条"
```

---

### Task 2: 纯函数 `localHandles.ts`

**Files:**
- Create: `web/src/local/localHandles.ts`
- Test: `web/src/local/localHandles.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/local/localHandles.test.ts`:

```ts
import { test, expect, vi, afterEach } from 'vitest';
import { extOf, kindOf, isTooLarge, splitRel, joinRel, isProbablyBinary, supportsHandles, partitionHandles, MAX_TEXT_BYTES } from './localHandles';

afterEach(() => { vi.unstubAllGlobals(); });

test('extOf / kindOf 与 DocViewer 判定一致', () => {
  expect(extOf('a.PNG')).toBe('png');
  expect(extOf('noext')).toBe('');
  expect(kindOf('a.png')).toBe('image');
  expect(kindOf('a.svg')).toBe('image');
  expect(kindOf('a.pdf')).toBe('pdf');
  expect(kindOf('a.md')).toBe('text');
  expect(kindOf('a')).toBe('text');
});

test('splitRel 规范化并阻止越界', () => {
  expect(splitRel('a/b/c.txt')).toEqual(['a', 'b', 'c.txt']);
  expect(splitRel('a\\b')).toEqual(['a', 'b']);
  expect(splitRel('/a//./b')).toEqual(['a', 'b']);
  expect(splitRel('a/../b')).toEqual(['b']);
  expect(splitRel('../x')).toBeNull();
  expect(splitRel('a/../../x')).toBeNull();
  expect(splitRel('')).toEqual([]);
});

test('joinRel 拼接并归一', () => {
  expect(joinRel('docs/sub', 'a.png')).toBe('docs/sub/a.png');
  expect(joinRel('docs', '../a.png')).toBe('a.png');
});

test('isTooLarge 边界', () => {
  expect(isTooLarge(MAX_TEXT_BYTES)).toBe(false);
  expect(isTooLarge(MAX_TEXT_BYTES + 1)).toBe(true);
});

test('isProbablyBinary 检测 NUL', () => {
  expect(isProbablyBinary(new Uint8Array([104, 105]))).toBe(false);
  expect(isProbablyBinary(new Uint8Array([104, 0, 105]))).toBe(true);
});

test('supportsHandles 依据 DataTransferItem', () => {
  vi.stubGlobal('DataTransferItem', undefined);
  expect(supportsHandles()).toBe(false);
  vi.stubGlobal('DataTransferItem', function () {} as unknown);
  expect(supportsHandles()).toBe(false);
  vi.stubGlobal('DataTransferItem', { prototype: { getAsFileSystemHandle() {} } } as unknown);
  expect(supportsHandles()).toBe(true);
});

test('partitionHandles 按 kind 分组并丢弃 null', () => {
  const f = { kind: 'file', name: 'a' };
  const d = { kind: 'directory', name: 'dir' };
  const r = partitionHandles([f, null, d] as unknown as Array<{ kind: string; name: string } | null>);
  expect(r.files.map((x) => x.name)).toEqual(['a']);
  expect(r.dirs.map((x) => x.name)).toEqual(['dir']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- localHandles`
Expected: FAIL（`Failed to resolve import './localHandles'`）。

- [ ] **Step 3: 实现**

Create `web/src/local/localHandles.ts`:

```ts
// 拖入本地文件的纯函数工具（无副作用，便于单测）。

const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);

export const MAX_TEXT_BYTES = 10 * 1024 * 1024;
export const MAX_DROP_FILES = 20;

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function kindOf(name: string): 'image' | 'pdf' | 'text' {
  const e = extOf(name);
  if (IMG.has(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  return 'text';
}

export function isTooLarge(size: number): boolean {
  return size > MAX_TEXT_BYTES;
}

// POSIX 风格相对路径 → 段数组；越界（.. 穿出根）返回 null
export function splitRel(path: string): string[] | null {
  const segs: string[] = [];
  for (const part of String(path ?? '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!segs.length) return null;
      segs.pop();
      continue;
    }
    segs.push(part);
  }
  return segs;
}

export function joinRel(dir: string, name: string): string {
  const segs = splitRel(`${dir}/${name}`);
  return segs ? segs.join('/') : '';
}

export function supportsHandles(): boolean {
  return typeof DataTransferItem !== 'undefined'
    && 'getAsFileSystemHandle' in DataTransferItem.prototype;
}

export function isProbablyBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 64 * 1024);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export function partitionHandles(handles: Array<{ kind: string; name: string } | null>): {
  dirs: FileSystemDirectoryHandle[];
  files: FileSystemFileHandle[];
} {
  const dirs: FileSystemDirectoryHandle[] = [];
  const files: FileSystemFileHandle[] = [];
  for (const h of handles) {
    if (!h) continue;
    if (h.kind === 'directory') dirs.push(h as unknown as FileSystemDirectoryHandle);
    else files.push(h as unknown as FileSystemFileHandle);
  }
  return { dirs, files };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- localHandles`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/local/localHandles.ts web/src/local/localHandles.test.ts
git commit -m "feat(local-drop): 本地来源纯函数工具与单测"
```

---

### Task 3: blob URL 登记与回收 `localBlobs.ts`

**Files:**
- Create: `web/src/local/localBlobs.ts`
- Test: `web/src/local/localBlobs.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/local/localBlobs.test.ts`:

```ts
import { test, expect, vi, afterEach } from 'vitest';
import { trackBlob, releaseBlob, releaseBlobs, resetBlobs } from './localBlobs';

afterEach(() => { resetBlobs(); vi.unstubAllGlobals(); });

test('trackBlob 返回值；releaseBlobs 回收该作用域全部 URL', () => {
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: (b: unknown) => `blob:${String(b)}`, revokeObjectURL: revoke });
  expect(trackBlob('s1', 'blob:a')).toBe('blob:a');
  trackBlob('s1', 'blob:b');
  trackBlob('s2', 'blob:c');
  releaseBlobs('s1');
  expect(revoke.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:a', 'blob:b']);
  releaseBlobs('s2');
  expect(revoke).toHaveBeenCalledTimes(3);
});

test('releaseBlob 只释放单个', () => {
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: revoke });
  trackBlob('s', 'blob:x');
  releaseBlob('s', 'blob:x');
  expect(revoke).toHaveBeenCalledWith('blob:x');
  releaseBlob('s', 'blob:x');
  expect(revoke).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- localBlobs`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `web/src/local/localBlobs.ts`:

```ts
// 按作用域登记 blob URL，页签关闭/预览重建时统一回收，避免内存泄漏。
const scopes = new Map<string, Set<string>>();

export function trackBlob(scope: string, url: string): string {
  let s = scopes.get(scope);
  if (!s) { s = new Set(); scopes.set(scope, s); }
  s.add(url);
  return url;
}

export function releaseBlob(scope: string, url: string): void {
  const s = scopes.get(scope);
  if (!s || !s.delete(url)) return;
  try { URL.revokeObjectURL(url); } catch { /* ignore */ }
}

export function releaseBlobs(scope: string): void {
  const s = scopes.get(scope);
  if (!s) return;
  for (const u of s) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } }
  s.clear();
  scopes.delete(scope);
}

export function resetBlobs(): void {
  for (const scope of [...scopes.keys()]) releaseBlobs(scope);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- localBlobs`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/local/localBlobs.ts web/src/local/localBlobs.test.ts
git commit -m "feat(local-drop): blob URL 作用域登记与回收"
```

---

### Task 4: 单例状态 `useLocalSources.ts`

**Files:**
- Create: `web/src/local/useLocalSources.ts`
- Test: `web/src/local/useLocalSources.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/local/useLocalSources.test.ts`:

```ts
import { test, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLocalSources, MAX_DROP_FILES } from './useLocalSources';

const dirHandle = (name: string) => ({ kind: 'directory', name }) as unknown as FileSystemDirectoryHandle;
const fileHandle = (name: string) => ({ kind: 'file', name }) as unknown as FileSystemFileHandle;
const fakeFile = (name: string) => ({ name }) as unknown as File;

beforeEach(() => { useLocalSources().clearAll(); });
afterEach(() => { vi.unstubAllGlobals(); });

test('mountFolder 替换旧根并清 activePath，保留单文件条目', () => {
  const s = useLocalSources();
  s.mountFolder(dirHandle('a'));
  s.activePath.value = 'x.md';
  const { keys } = s.addFiles([{ name: 'f.txt', handle: fileHandle('f.txt'), file: null }]);
  s.mountFolder(dirHandle('b'));
  expect(s.root.value?.name).toBe('b');
  expect(s.activePath.value).toBe('');
  expect(s.files.value.has(keys[0])).toBe(true);
});

test('addFiles 返回 key，超上限截断', () => {
  const s = useLocalSources();
  const many = Array.from({ length: MAX_DROP_FILES + 3 }, (_, i) => ({ name: `f${i}.txt`, handle: fileHandle(`f${i}.txt`), file: null }));
  const r = s.addFiles(many);
  expect(r.keys).toHaveLength(MAX_DROP_FILES);
  expect(r.truncated).toBe(3);
  expect(s.files.value.size).toBe(MAX_DROP_FILES);
});

test('unmountRoot 与 removeFile 互不影响', () => {
  const s = useLocalSources();
  s.mountFolder(dirHandle('a'));
  const { keys } = s.addFiles([{ name: 'f.txt', handle: null, file: fakeFile('f.txt') }]);
  s.unmountRoot();
  expect(s.root.value).toBeNull();
  expect(s.files.value.size).toBe(1);
  s.removeFile(keys[0]);
  expect(s.files.value.size).toBe(0);
});

test('状态是模块级单例（多次调用共享）', () => {
  const a = useLocalSources();
  a.mountFolder(dirHandle('shared'));
  const b = useLocalSources();
  expect(b.root.value?.name).toBe('shared');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- useLocalSources`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `web/src/local/useLocalSources.ts`:

```ts
import { ref, type Ref } from 'vue';
import { releaseBlobs } from './localBlobs';
import { MAX_DROP_FILES } from './localHandles';

export interface LocalRoot { name: string; handle: FileSystemDirectoryHandle | null }
export interface LocalFile { key: string; name: string; handle: FileSystemFileHandle | null; file: File | null }
export interface LocalFileInput { name: string; handle: FileSystemFileHandle | null; file: File | null }

export const ROOT_SCOPE = 'local-root';
export { MAX_DROP_FILES };

// 模块级单例：同一会话内跨组件共享；刷新页面自然清空。
const root = ref<LocalRoot | null>(null);
const files = ref<Map<string, LocalFile>>(new Map());
const activePath = ref('');
let seq = 0;

export function useLocalSources(): {
  root: Ref<LocalRoot | null>;
  files: Ref<Map<string, LocalFile>>;
  activePath: Ref<string>;
  mountFolder: (handle: FileSystemDirectoryHandle) => void;
  addFiles: (entries: LocalFileInput[]) => { keys: string[]; truncated: number };
  unmountRoot: () => void;
  removeFile: (key: string) => void;
  clearAll: () => void;
} {
  function mountFolder(handle: FileSystemDirectoryHandle): void {
    releaseBlobs(ROOT_SCOPE);
    root.value = { name: handle.name, handle };
    activePath.value = '';
  }

  function addFiles(entries: LocalFileInput[]): { keys: string[]; truncated: number } {
    const list = entries.slice(0, MAX_DROP_FILES);
    const next = new Map(files.value);
    const keys: string[] = [];
    for (const e of list) {
      const key = String(++seq);
      next.set(key, { key, name: e.name, handle: e.handle, file: e.file });
      keys.push(key);
    }
    files.value = next;
    return { keys, truncated: entries.length - list.length };
  }

  function unmountRoot(): void {
    releaseBlobs(ROOT_SCOPE);
    root.value = null;
    activePath.value = '';
  }

  function removeFile(key: string): void {
    releaseBlobs(key);
    const next = new Map(files.value);
    next.delete(key);
    files.value = next;
  }

  function clearAll(): void {
    releaseBlobs(ROOT_SCOPE);
    for (const k of [...files.value.keys()]) releaseBlobs(k);
    root.value = null;
    files.value = new Map();
    activePath.value = '';
  }

  return { root, files, activePath, mountFolder, addFiles, unmountRoot, removeFile, clearAll };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- useLocalSources`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/local/useLocalSources.ts web/src/local/useLocalSources.test.ts
git commit -m "feat(local-drop): 本地来源单例状态"
```

---

### Task 5: 扩展 `DocSource` 契约

**Files:**
- Modify: `web/src/tools/doc/docSource.ts`

- [ ] **Step 1: 加可选方法**

把 `web/src/tools/doc/docSource.ts` 整体替换为：

```ts
import type { TreeItem } from '@devflow/shared';
import type { FileMeta, FileHashes } from '../../useProjects';

// 文档查看器（DocViewer）的数据源契约：能力（方法）缺省即隐藏对应按钮/面板。
export interface DocReadResult {
  name: string;
  content: string;
  size: number;
  mtime?: number;
  abs?: string;
  binary?: boolean;
}

export interface MarkdownAssetRef { rel: string; suffix: string }

export interface DocSource {
  kind: 'project' | 'tool' | 'local';
  read(path: string): Promise<DocReadResult>;
  write(path: string, content: string): Promise<void>;
  rawUrl?(path: string): string;
  list?(dir: string): Promise<TreeItem[]>;
  meta?(path: string): Promise<FileMeta>;
  hash?(path: string): Promise<FileHashes>;
  reveal?(path: string): Promise<void>;
  run?(path: string): Promise<void>;
  pickExternal?(): Promise<DocReadResult | { cancelled: true } | { error: string; message?: string | null }>;
  markdownImageBase?: { projectId: string };
  // 本地来源：把 markdown 里的相对资源解析为可直接使用的 URL（如 blob:）
  resolveMarkdownAssets?(refs: MarkdownAssetRef[]): Promise<Map<string, string>>;
  releaseMarkdownAssets?(): void;
}
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS（现有 `kind: 'project' | 'tool'` 实现仍合法）。

- [ ] **Step 3: Commit**

```powershell
git add web/src/tools/doc/docSource.ts
git commit -m "feat(docviewer): DocSource 增加 markdown 资源解析能力"
```

---

### Task 6: `markdown.ts` 相对资源预解析

**Files:**
- Modify: `web/src/markdown.ts`
- Test: `web/src/markdown.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/markdown.test.ts` 顶部 import 改为：

```ts
import { isMarkdownFile, renderMarkdown, renderRemoteMarkdown, printMarkdown, collectAssetRefs } from './markdown';
```

在 `describe('renderMarkdown', ...)` 内追加两个用例：

```ts
  it('assetMap 命中相对图片/链接时替换为给定 URL', () => {
    const map = new Map([['assets/logo.png', 'blob:abc'], ['docs/other.md', 'blob:def']]);
    const h = renderMarkdown('![logo](../assets/logo.png)\n\n[doc](./other.md)', { projectId: '', fileDir: 'docs', assetMap: map });
    expect(h).toContain('src="blob:abc"');
    expect(h).toContain('href="blob:def"');
    expect(h).not.toContain('/api/raw');
  });

  it('无 projectId 且未命中 assetMap 时保持原始相对路径', () => {
    const h = renderMarkdown('![x](imgs/a.png)', { projectId: '', fileDir: 'docs' });
    expect(h).toContain('src="imgs/a.png"');
    expect(h).not.toContain('/api/raw');
  });
```

追加到文件末尾：

```ts
describe('collectAssetRefs', () => {
  it('抽取相对 image/link、去重、过滤外链/锚点/绝对 URL', () => {
    const refs = collectAssetRefs(
      '![a](./x.png)\n![b](./x.png)\n[c](../y.md)\n[d](https://e.com/z.png)\n[e](#sec)',
      'docs',
    );
    expect(refs.map((r) => r.rel).sort()).toEqual(['docs/x.png', 'y.md']);
  });

  it('保留 query/hash 后缀', () => {
    const refs = collectAssetRefs('![a](./x.png?v=1#f)', 'docs');
    expect(refs).toEqual([{ rel: 'docs/x.png', suffix: '?v=1#f' }]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- markdown`
Expected: FAIL（`collectAssetRefs` 未导出 / assetMap 未生效）。

- [ ] **Step 3: 实现**

在 `web/src/markdown.ts` 中：

(a) 改 `MarkdownOptions`：

```ts
export interface MarkdownOptions {
  projectId: string;
  fileDir: string;
  assetMap?: Map<string, string>;
}
```

(b) 改 `rewriteTokenAttrs` 的 image/link 分支：

```ts
    if (t.type === 'image') {
      const src = t.attrGet('src') || '';
      const r = resolveTarget(src, opt.fileDir);
      if (r) {
        const mapped = opt.assetMap?.get(r.rel);
        if (mapped) t.attrSet('src', mapped);
        else if (opt.projectId) t.attrSet('src', buildRaw(opt.projectId, r.rel, r.suffix));
      }
    } else if (t.type === 'link_open') {
      const href = t.attrGet('href') || '';
      const r = resolveTarget(href, opt.fileDir);
      if (r) {
        const mapped = opt.assetMap?.get(r.rel);
        if (mapped) {
          t.attrSet('href', mapped);
          t.attrSet('target', '_blank');
          t.attrSet('rel', 'noopener');
        } else if (opt.projectId) {
          t.attrSet('href', buildRaw(opt.projectId, r.rel, r.suffix));
          t.attrSet('target', '_blank');
          t.attrSet('rel', 'noopener');
        }
      }
    }
```

(c) 在 `renderMarkdown` 之前新增导出函数：

```ts
// 抽取 markdown 里的相对资源引用（图片/链接），供本地来源预解析成 blob URL。
export function collectAssetRefs(mdText: string, fileDir: string): { rel: string; suffix: string }[] {
  const found = new Map<string, { rel: string; suffix: string }>();
  const walk = (tokens: unknown[]): void => {
    for (const tok of tokens as Array<{ type: string; children?: unknown[]; attrGet(n: string): string | null }>) {
      if (tok.type === 'inline' && tok.children) { walk(tok.children); continue; }
      if (tok.type !== 'image' && tok.type !== 'link_open') continue;
      const raw = (tok.type === 'image' ? tok.attrGet('src') : tok.attrGet('href')) || '';
      const r = resolveTarget(raw, fileDir);
      if (r) found.set(r.rel, r);
    }
  };
  walk(md.parse(mdText, {}));
  return [...found.values()];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- markdown`
Expected: PASS（含原有用例）。

- [ ] **Step 5: Commit**

```powershell
git add web/src/markdown.ts web/src/markdown.test.ts
git commit -m "feat(markdown): 支持 assetMap 相对资源替换与引用抽取"
```

---

### Task 7: 本地文档来源 `localDocSource.ts`

**Files:**
- Create: `web/src/local/localDocSource.ts`
- Test: `web/src/local/localDocSource.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/local/localDocSource.test.ts`:

```ts
// @vitest-environment happy-dom
import { test, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLocalSources } from './useLocalSources';
import { localRootDocSource, localFileDocSource } from './localDocSource';
import { resetBlobs } from './localBlobs';

function fakeFile(name: string, content: string | Uint8Array): File {
  const body: BlobPart[] = [typeof content === 'string' ? content : (content.buffer as ArrayBuffer)];
  return new File(body, name);
}

function fakeFileHandle(file: File, perm: 'granted' | 'denied' = 'granted') {
  const h: any = {
    kind: 'file',
    name: file.name,
    written: null as string | null,
    getFile: async () => file,
    queryPermission: async () => perm,
    requestPermission: async () => perm,
    createWritable: async () => ({
      write: async (c: string) => { h.written = c; },
      close: async () => { /* done */ },
    }),
    getDirectoryHandle: async () => { throw new Error('not-a-dir'); },
  };
  return h as any;
}

function fakeDirHandle(name: string, entries: Record<string, any>) {
  const h: any = {
    kind: 'directory',
    name,
    getFileHandle: async (n: string) => { if (!entries[n]) throw new Error('missing'); return entries[n]; },
    getDirectoryHandle: async (n: string) => {
      const e = entries[n];
      if (!e || e.kind !== 'directory') throw new Error('missing');
      return e;
    },
    *values() { for (const [k, v] of Object.entries(entries)) yield { name: k, kind: v.kind }; },
  };
  return h as any;
}

beforeEach(() => {
  useLocalSources().clearAll();
  resetBlobs();
  let n = 0;
  vi.stubGlobal('URL', {
    createObjectURL: () => `blob:obj-${++n}`,
    revokeObjectURL: () => {},
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

test('根来源：读文本文件', async () => {
  const fileHandle = fakeFileHandle(fakeFile('a.txt', 'hello'));
  const s = useLocalSources();
  s.mountFolder(fakeDirHandle('proj', { 'a.txt': fileHandle }));
  const r = await localRootDocSource().read('a.txt');
  expect(r).toMatchObject({ name: 'a.txt', content: 'hello', size: 5 });
});

test('根来源：二进制文件返回 binary', async () => {
  const fileHandle = fakeFileHandle(fakeFile('a.bin', new Uint8Array([1, 0, 2])));
  useLocalSources().mountFolder(fakeDirHandle('proj', { 'a.bin': fileHandle }));
  const r = await localRootDocSource().read('a.bin');
  expect(r.binary).toBe(true);
});

test('根来源：图片返回 blob URL 且 rawUrl 同步可得', async () => {
  const fileHandle = fakeFileHandle(fakeFile('a.png', new Uint8Array([137, 80])));
  useLocalSources().mountFolder(fakeDirHandle('proj', { 'a.png': fileHandle }));
  const src = localRootDocSource();
  const r = await src.read('a.png');
  expect(r.binary).toBe(true);
  expect(src.rawUrl!('a.png')).toBe('blob:obj-1');
});

test('根来源：超过 10MB 文本拒绝', async () => {
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  const fileHandle = fakeFileHandle(fakeFile('big.txt', big));
  useLocalSources().mountFolder(fakeDirHandle('proj', { 'big.txt': fileHandle }));
  await expect(localRootDocSource().read('big.txt')).rejects.toThrow(/超过|exceeds/);
});

test('根来源：写回调用 createWritable', async () => {
  const fileHandle = fakeFileHandle(fakeFile('a.txt', 'old'));
  useLocalSources().mountFolder(fakeDirHandle('proj', { 'a.txt': fileHandle }));
  await localRootDocSource().write('a.txt', 'new');
  expect(fileHandle.written).toBe('new');
});

test('写回被拒：抛出授权提示', async () => {
  const fileHandle = fakeFileHandle(fakeFile('a.txt', 'old'), 'denied');
  useLocalSources().mountFolder(fakeDirHandle('proj', { 'a.txt': fileHandle }));
  await expect(localRootDocSource().write('a.txt', 'new')).rejects.toThrow(/授权|permission/i);
});

test('单文件来源：无句柄（降级）时读 File、写抛不支持', async () => {
  const s = useLocalSources();
  const { keys } = s.addFiles([{ name: 'f.txt', handle: null, file: fakeFile('f.txt', 'ro') }]);
  const src = localFileDocSource(keys[0]);
  expect((await src.read('f.txt')).content).toBe('ro');
  await expect(src.write('f.txt', 'x')).rejects.toThrow(/写回|write/i);
});

test('根来源：解析 markdown 相对资源为 blob URL', async () => {
  const img = fakeFileHandle(fakeFile('logo.png', new Uint8Array([1, 2])));
  useLocalSources().mountFolder(fakeDirHandle('proj', { assets: fakeDirHandle('assets', { 'logo.png': img }) }));
  const m = await localRootDocSource().resolveMarkdownAssets!([{ rel: 'assets/logo.png', suffix: '' }]);
  expect(m.get('assets/logo.png')).toBe('blob:obj-1');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- localDocSource`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `web/src/local/localDocSource.ts`:

```ts
import type { DocSource, DocReadResult, MarkdownAssetRef } from '../tools/doc/docSource';
import { t } from '../i18n';
import { useLocalSources } from './useLocalSources';
import { kindOf, isTooLarge, isProbablyBinary, splitRel, MAX_TEXT_BYTES } from './localHandles';
import { trackBlob, releaseBlob, releaseBlobs } from './localBlobs';

const MAX_LABEL = `${Math.round(MAX_TEXT_BYTES / 1024 / 1024)} MB`;

type AnyHandle = { queryPermission?(o: { mode: string }): Promise<string>; requestPermission?(o: { mode: string }): Promise<string> };

async function ensurePermission(handle: unknown, mode: 'read' | 'readwrite'): Promise<void> {
  const h = handle as AnyHandle;
  try {
    if (typeof h.queryPermission === 'function' && (await h.queryPermission({ mode })) === 'granted') return;
  } catch { /* fall through to request */ }
  if (typeof h.requestPermission !== 'function') throw new Error(t('local.write_unsupported'));
  let r: string | undefined;
  try { r = await h.requestPermission({ mode }); } catch { throw new Error(t('local.permission_needed')); }
  if (r !== 'granted') throw new Error(t('local.permission_needed'));
}

async function traverse(dir: FileSystemDirectoryHandle, rel: string): Promise<{ parent: FileSystemDirectoryHandle; leaf: string }> {
  const segs = splitRel(rel);
  if (!segs || !segs.length) throw new Error(t('local.read_failed', { msg: rel || '-' }));
  let cur = dir;
  for (let i = 0; i < segs.length - 1; i++) cur = await cur.getDirectoryHandle(segs[i]);
  return { parent: cur, leaf: segs[segs.length - 1] };
}

async function readText(file: File): Promise<{ content: string; binary: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isProbablyBinary(bytes)) return { content: '', binary: true };
  return { content: new TextDecoder('utf-8').decode(bytes), binary: false };
}

// 每个作用域只保留「当前文件」的 blob URL（图片/PDF 用）
const currentBlob = new Map<string, { path: string; url: string }>();

function recycleCurrent(scope: string): void {
  const cur = currentBlob.get(scope);
  if (cur) { releaseBlob(scope, cur.url); currentBlob.delete(scope); }
}

async function readViaFile(file: File, path: string, scope: string): Promise<DocReadResult> {
  const kind = kindOf(file.name);
  if (kind === 'image' || kind === 'pdf') {
    recycleCurrent(scope);
    const url = trackBlob(scope, URL.createObjectURL(file));
    currentBlob.set(scope, { path, url });
    return { name: file.name, content: '', size: file.size, binary: true };
  }
  if (isTooLarge(file.size)) throw new Error(t('local.too_large', { max: MAX_LABEL }));
  const { content, binary } = await readText(file);
  return { name: file.name, content, size: file.size, binary };
}

async function writeToHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
  const w = await handle.createWritable();
  try { await w.write(content); } finally { await w.close(); }
}

let rootSource: DocSource | null = null;

// 本地根来源：单例；路径为根目录下的相对路径。
export function localRootDocSource(): DocSource {
  if (rootSource) return rootSource;
  const { root, activePath } = useLocalSources();
  const mdScope = 'local-root-md';
  rootSource = {
    kind: 'local',
    async read(path) {
      const r = root.value;
      const rel = path || activePath.value;
      if (!r?.handle) throw new Error(t('local.read_failed', { msg: rel || '-' }));
      try {
        const { parent, leaf } = await traverse(r.handle, rel);
        const file = await (await parent.getFileHandle(leaf)).getFile();
        return await readViaFile(file, rel, 'local-root');
      } catch (e: any) {
        if (e?.message && /授权|exceeds|超过/.test(e.message)) throw e;
        throw new Error(t('local.read_failed', { msg: e?.message || rel }));
      }
    },
    async write(path, content) {
      const r = root.value;
      const rel = path || activePath.value;
      if (!r?.handle) throw new Error(t('local.permission_needed'));
      const { parent, leaf } = await traverse(r.handle, rel);
      const fh = await parent.getFileHandle(leaf);
      await ensurePermission(fh, 'readwrite');
      await writeToHandle(fh, content);
    },
    rawUrl(path) {
      const cur = currentBlob.get('local-root');
      const rel = path || activePath.value;
      return cur && cur.path === rel ? cur.url : '';
    },
    async resolveMarkdownAssets(refs: MarkdownAssetRef[]): Promise<Map<string, string>> {
      const r = root.value;
      const map = new Map<string, string>();
      if (!r?.handle) return map;
      for (const ref of refs) {
        try {
          const { parent, leaf } = await traverse(r.handle, ref.rel);
          const file = await (await parent.getFileHandle(leaf)).getFile();
          map.set(ref.rel, trackBlob(mdScope, URL.createObjectURL(file)));
        } catch { /* 缺失/越界的资源直接跳过 */ }
      }
      return map;
    },
    releaseMarkdownAssets() { releaseBlobs(mdScope); },
  };
  return rootSource;
}

const fileSources = new Map<string, DocSource>();

// 单文件来源（拖入的单个文件）：按 key 缓存，忽略传入 path。
export function localFileDocSource(key: string): DocSource {
  const hit = fileSources.get(key);
  if (hit) return hit;
  const { files } = useLocalSources();
  const src: DocSource = {
    kind: 'local',
    async read(path) {
      const entry = files.value.get(key);
      if (!entry) throw new Error(t('local.read_failed', { msg: path }));
      const file = entry.handle ? await entry.handle.getFile() : entry.file;
      if (!file) throw new Error(t('local.read_failed', { msg: path }));
      return await readViaFile(file, path || entry.name, key);
    },
    async write(_path, content) {
      const entry = files.value.get(key);
      if (!entry?.handle) throw new Error(t('local.write_unsupported'));
      await ensurePermission(entry.handle, 'readwrite');
      await writeToHandle(entry.handle, content);
    },
    rawUrl(path) {
      const entry = files.value.get(key);
      const rel = path || entry?.name || '';
      const cur = currentBlob.get(key);
      return cur && cur.path === rel ? cur.url : '';
    },
  };
  fileSources.set(key, src);
  return src;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- localDocSource`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/local/localDocSource.ts web/src/local/localDocSource.test.ts
git commit -m "feat(local-drop): 本地 DocSource（读/写/相对资源）"
```

---

### Task 8: 本地目录树来源 `localTreeSource.ts`

**Files:**
- Create: `web/src/local/localTreeSource.ts`
- Test: `web/src/local/localTreeSource.test.ts`

- [ ] **Step 1: 写失败测试**

Create `web/src/local/localTreeSource.test.ts`:

```ts
import { test, expect, beforeEach, vi } from 'vitest';
import { useLocalSources } from './useLocalSources';
import { localTreeSource } from './localTreeSource';

function fakeDir(name: string, entries: Record<string, any>): any {
  return {
    kind: 'directory',
    name,
    getDirectoryHandle: async (n: string) => {
      const e = entries[n];
      if (!e || e.kind !== 'directory') throw new Error('missing');
      return e;
    },
    getFileHandle: async (n: string) => { if (!entries[n]) throw new Error('missing'); return entries[n]; },
    *values() { for (const [k, v] of Object.entries(entries)) yield { name: k, kind: v.kind }; },
  };
}

const fileIn = (n: string) => ({ kind: 'file', name: n });

beforeEach(() => { useLocalSources().clearAll(); });

test('loadChildren 目录在前、文件在后并按名排序', async () => {
  useLocalSources().mountFolder(fakeDir('proj', {
    'z.txt': fileIn('z.txt'),
    'a.txt': fileIn('a.txt'),
    sub: fakeDir('sub', {}),
    b: fakeDir('b', {}),
  }));
  const src = localTreeSource(vi.fn());
  const rows = await src.loadChildren('');
  expect(rows.map((r) => `${r.kind}:${r.name}`)).toEqual(['dir:b', 'dir:sub', 'item:a.txt', 'item:z.txt']);
});

test('loadChildren 子目录用相对路径 key', async () => {
  useLocalSources().mountFolder(fakeDir('proj', { sub: fakeDir('sub', { 'x.md': fileIn('x.md') }) }));
  const rows = await localTreeSource(vi.fn()).loadChildren('sub');
  expect(rows).toEqual([{ key: 'sub/x.md', name: 'x.md', kind: 'item' }]);
});

test('越界/不存在的目录返回空；无根返回空', async () => {
  expect(await localTreeSource(vi.fn()).loadChildren('../x')).toEqual([]);
  useLocalSources().mountFolder(fakeDir('proj', {}));
  expect(await localTreeSource(vi.fn()).loadChildren('nope')).toEqual([]);
});

test('open 只对 item 回调', () => {
  const cb = vi.fn();
  const src = localTreeSource(cb);
  src.open({ key: 'a.txt', name: 'a.txt', kind: 'item' });
  expect(cb).toHaveBeenCalledWith({ key: 'a.txt', name: 'a.txt', kind: 'item' });
  src.open({ key: 'sub', name: 'sub', kind: 'dir' });
  expect(cb).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- localTreeSource`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `web/src/local/localTreeSource.ts`:

```ts
import type { TreeSource, TreeSourceNode } from '../tree/treeSource';
import { useLocalSources } from './useLocalSources';
import { splitRel } from './localHandles';

// 本地目录树数据源：只提供读能力（创建/重命名/删除/移动缺省即隐藏）。
export function localTreeSource(open: (node: TreeSourceNode) => void): TreeSource {
  const { root } = useLocalSources();

  async function dirOf(dirKey: string): Promise<FileSystemDirectoryHandle | null> {
    const r = root.value;
    if (!r?.handle) return null;
    const segs = splitRel(dirKey);
    if (segs === null) return null;
    let cur = r.handle;
    for (const s of segs) cur = await cur.getDirectoryHandle(s);
    return cur;
  }

  return {
    async loadChildren(dirKey) {
      let dir: FileSystemDirectoryHandle;
      try {
        const d = await dirOf(dirKey);
        if (!d) return [];
        dir = d;
      } catch {
        return [];
      }
      const dirs: TreeSourceNode[] = [];
      const items: TreeSourceNode[] = [];
      const iter = (dir as unknown as { values(): AsyncIterable<{ name: string; kind: string }> }).values();
      for await (const h of iter) {
        const key = dirKey ? `${dirKey}/${h.name}` : h.name;
        if (h.kind === 'directory') dirs.push({ key, name: h.name, kind: 'dir' });
        else items.push({ key, name: h.name, kind: 'item' });
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      items.sort((a, b) => a.name.localeCompare(b.name));
      return [...dirs, ...items];
    },
    open(node) {
      if (node.kind === 'item') open(node);
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- localTreeSource`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/local/localTreeSource.ts web/src/local/localTreeSource.test.ts
git commit -m "feat(local-drop): 本地目录树数据源"
```

---

### Task 9: 拖拽监听与提示 UI

**Files:**
- Create: `web/src/local/useLocalDrop.ts`
- Create: `web/src/local/LocalDropOverlay.vue`
- Create: `web/src/local/LocalSidebar.vue`

- [ ] **Step 1: 实现 `useLocalDrop.ts`**

Create `web/src/local/useLocalDrop.ts`:

```ts
import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue';
import { partitionHandles } from './localHandles';

export interface LocalDropPayload {
  dirHandles: FileSystemDirectoryHandle[];
  fileHandles: FileSystemFileHandle[];
  files: File[];
}

type HandleLike = { kind: string; name: string } | null;

// window 级拖拽监听：只在拖入文件时介入，避免影响浏览器默认行为与应用内拖拽。
export function useLocalDrop(onDrop: (p: LocalDropPayload) => void): { dragging: Ref<boolean> } {
  const dragging = ref(false);
  let depth = 0;
  const hasFiles = (e: DragEvent): boolean =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  function onEnter(e: DragEvent): void {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    dragging.value = true;
  }
  function onOver(e: DragEvent): void {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }
  function onLeave(e: DragEvent): void {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) dragging.value = false;
  }
  async function onDropEvt(e: DragEvent): Promise<void> {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dragging.value = false;
    const dt = e.dataTransfer;
    if (!dt) return;
    const items = Array.from(dt.items || []).filter((i) => i.kind === 'file');
    // 必须同步快照：drop 事件结束后 DataTransfer 失效
    const pending = items.map((i) => {
      const fn = (i as unknown as { getAsFileSystemHandle?: () => Promise<unknown> }).getAsFileSystemHandle;
      return typeof fn === 'function' ? Promise.resolve(fn.call(i)) : Promise.resolve(null);
    });
    const handles = (await Promise.all(pending)) as HandleLike[];
    const { dirs, files: fileHandles } = partitionHandles(handles);
    onDrop({ dirHandles: dirs, fileHandles, files: Array.from(dt.files || []) });
  }

  onMounted(() => {
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDropEvt);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('dragenter', onEnter);
    window.removeEventListener('dragover', onOver);
    window.removeEventListener('dragleave', onLeave);
    window.removeEventListener('drop', onDropEvt);
  });

  return { dragging };
}
```

- [ ] **Step 2: 实现 `LocalDropOverlay.vue`**

Create `web/src/local/LocalDropOverlay.vue`:

```vue
<script setup lang="ts">
// 全屏拖拽提示：由 App.vue 在 dragging 时挂载。
</script>

<template>
  <div class="ldrop">
    <div class="ldrop-box">
      <div class="ldrop-ic">⬇</div>
      <div class="ldrop-txt">{{ $t('local.drop_hint') }}</div>
    </div>
  </div>
</template>

<style scoped>
.ldrop { position: fixed; inset: 0; z-index: 200; background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center; pointer-events: none; }
.ldrop-box { border: 2px dashed var(--ac); border-radius: 12px; padding: 28px 44px; background: var(--bg1); color: var(--tx1); display: flex; flex-direction: column; align-items: center; gap: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, .4); }
.ldrop-ic { font-size: 30px; color: var(--ac2); }
.ldrop-txt { font-size: 14px; }
</style>
```

- [ ] **Step 3: 实现 `LocalSidebar.vue`**

Create `web/src/local/LocalSidebar.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import TreeView from '../components/TreeView.vue';
import { useLocalSources } from './useLocalSources';
import { localTreeSource } from './localTreeSource';
import { useCenter } from '../useCenter';

// 左侧面板：活动页签是本地根时显示该目录树；点文件在根页签内就地切换。
const local = useLocalSources();
const center = useCenter();
const source = computed(() => localTreeSource((node) => {
  local.activePath.value = node.key;
  center.openLocalRoot(local.root.value?.name || '');
}));
</script>

<template>
  <div class="lside">
    <TreeView
      :source="source"
      :title="local.root.value?.name || ''"
      :active-key="local.activePath.value"
      storage-key="devflow-local-collapsed"
    />
  </div>
</template>

<style scoped>
.lside { height: 100%; padding: 6px; box-sizing: border-box; }
</style>
```

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/local/useLocalDrop.ts web/src/local/LocalDropOverlay.vue web/src/local/LocalSidebar.vue
git commit -m "feat(local-drop): 拖拽监听、提示遮罩与左侧本地树"
```

---

### Task 10: `useCenter` 支持 `local` 页签

**Files:**
- Modify: `web/src/useCenter.ts`
- Modify: `web/src/useCenter.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/useCenter.test.ts` 顶部加：

```ts
import { useLocalSources } from './local/useLocalSources';
```

追加：

```ts
test('openLocalRoot 新增并激活；重复打开只更新 label', () => {
  const c = useCenter();
  c.openLocalRoot('proj-a');
  expect(c.tabs.value[0]).toMatchObject({ id: 'l:root', kind: 'local', label: 'proj-a' });
  expect(c.activeId.value).toBe('l:root');
  c.openLocalRoot('proj-b');
  expect(c.tabs.value).toHaveLength(1);
  expect(c.tabs.value[0].label).toBe('proj-b');
});

test('openLocalFile 新增并激活；closeById 关闭时清状态', () => {
  const c = useCenter();
  const s = useLocalSources();
  s.clearAll();
  s.mountFolder({ kind: 'directory', name: 'proj' } as unknown as FileSystemDirectoryHandle);
  const { keys } = s.addFiles([{ name: 'f.txt', handle: null, file: null }]);
  c.openLocalFile(keys[0], 'f.txt');
  expect(c.activeId.value).toBe(`l:f:${keys[0]}`);
  c.closeById(`l:f:${keys[0]}`);
  expect(s.files.value.size).toBe(0);
  expect(c.tabs.value).toHaveLength(0);
});

test('closeById 关闭本地根页签卸载根且不影响单文件页签', () => {
  const c = useCenter();
  const s = useLocalSources();
  s.clearAll();
  s.mountFolder({ kind: 'directory', name: 'proj' } as unknown as FileSystemDirectoryHandle);
  const { keys } = s.addFiles([{ name: 'f.txt', handle: null, file: null }]);
  c.openLocalFile(keys[0], 'f.txt');
  c.openLocalRoot('proj');
  c.closeById('l:root');
  expect(s.root.value).toBeNull();
  expect(s.files.value.size).toBe(1);
  expect(c.tabs.value.some((t) => t.id === `l:f:${keys[0]}`)).toBe(true);
});
```

同时在 `web/src/windowState.test.ts` 的 `describe('toSavedTabs', ...)` 内追加一条守护用例（本地/工具页签不入档）：

```ts
  it('本地来源与工具页签不写入存档', () => {
    const tabs: CenterTab[] = [
      tab({ id: 'l:root', kind: 'local', label: 'proj', projectId: undefined, path: undefined }),
      tab({ id: 'l:f:1', kind: 'local', label: 'f.txt', projectId: undefined, path: undefined }),
      tab({ id: 't:notepad', kind: 'tool', label: 'notepad', projectId: undefined, path: undefined }),
      tab({ id: 'f:p1|a.ts', path: 'a.ts', label: 'a.ts' }),
    ];
    expect(toSavedTabs(tabs)).toEqual([{ projectId: 'p1', path: 'a.ts', label: 'a.ts' }]);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- useCenter`
Expected: FAIL（`openLocalRoot` 不存在）。`windowState` 用例应直接通过（守护既有行为）。

- [ ] **Step 3: 实现**

在 `web/src/useCenter.ts` 中：

(a) 顶部加 import：

```ts
import { useLocalSources } from './local/useLocalSources';
```

(b) `CenterTab.kind` 增加 `'local'`：

```ts
export interface CenterTab {
  id: string;
  kind: 'session' | 'file' | 'tool' | 'local';
  label: string;
  sub?: string;
  projectId?: string | null;
  path?: string;
  tool?: string;
}
```

(c) 加 id 助手：

```ts
const lidRoot = 'l:root';
const lidFile = (key: string) => `l:f:${key}`;
```

(d) 在 `openTool` 之后加：

```ts
  function openLocalRoot(label: string) {
    const ex = tabs.value.find((t) => t.id === lidRoot);
    if (ex) { ex.label = label || ex.label; setActive(lidRoot); return; }
    tabs.value.push({ id: lidRoot, kind: 'local', label: label || 'local' });
    setActive(lidRoot);
  }
  function openLocalFile(key: string, label: string) {
    const id = lidFile(key);
    const ex = tabs.value.find((t) => t.id === id);
    if (ex) { ex.label = label || ex.label; setActive(id); return; }
    tabs.value.push({ id, kind: 'local', label });
    setActive(id);
  }
```

(e) `closeById` 开头加 `l:` 分支（在 `f:` 分支之前）：

```ts
    if (id.startsWith('l:')) {
      const local = useLocalSources();
      if (id === lidRoot) local.unmountRoot();
      else local.removeFile(id.slice('l:f:'.length));
      tabs.value = tabs.value.filter((x) => x.id !== id);
      if (activeId.value === id) {
        const s = activeSessionTab.value;
        setActive(s ? s.id : tabs.value[0]?.id ?? null);
      }
      return;
    }
```

(f) 返回对象里加 `openLocalRoot, openLocalFile`：

```ts
  return { tabs, activeId, active, activeKind, ensureSession, hasSession, removeSession, activateSession, openFile, closeFile, closeById, setActive, activateFileTab, openTool, openLocalRoot, openLocalFile };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- useCenter`
Expected: PASS（含原有用例）。

Run: `npm.cmd --prefix web run test -- windowState`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/useCenter.ts web/src/useCenter.test.ts web/src/windowState.test.ts
git commit -m "feat(center): 支持本地来源页签（l:root / l:f:<key>）"
```

---

### Task 11: `DocViewer` 预览前预解析相对资源

**Files:**
- Modify: `web/src/components/DocViewer.vue`

- [ ] **Step 1: 改 import**

把 `web/src/components/DocViewer.vue` 第 11 行：

```ts
import { isMarkdownFile, renderMarkdown, renderMermaid, printMarkdown } from '../markdown';
```

改为：

```ts
import { isMarkdownFile, renderMarkdown, renderMermaid, printMarkdown, collectAssetRefs } from '../markdown';
```

- [ ] **Step 2: 改 `applyPreview()`**

把现有 `applyPreview`（约 260-282 行）整体替换为：

```ts
async function applyPreview() {
  const seq = ++previewSeq;
  mdErr.value = '';
  if (viewMode.value !== 'preview' || status.value !== 'ok') return;
  try {
    props.source.releaseMarkdownAssets?.();
    let assetMap: Map<string, string> | undefined;
    if (props.source.resolveMarkdownAssets) {
      const refs = collectAssetRefs(raw.value, fileDirOf(props.path));
      if (refs.length) assetMap = await props.source.resolveMarkdownAssets(refs);
    }
    mdHtml.value = renderMarkdown(raw.value, {
      projectId: props.source.markdownImageBase?.projectId || '',
      fileDir: fileDirOf(props.path),
      assetMap,
    });
  } catch (e: any) {
    mdErr.value = String(e?.message || e);
    return;
  }
  await nextTick();
  if (seq !== previewSeq) return;
  const body = mdBodyRef.value;
  if (!body) return;
  try {
    await renderMermaid(body);
  } catch (e: any) {
    mdErr.value = String(e?.message || e);
  }
}
```

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```powershell
git add web/src/components/DocViewer.vue
git commit -m "feat(docviewer): markdown 预览前预解析本地相对资源"
```

---

### Task 12: `TerminalView` 渲染本地内容层

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 加 import 与计算属性**

在 import 区加：

```ts
import { useLocalSources } from '../local/useLocalSources';
import { localRootDocSource, localFileDocSource } from '../local/localDocSource';
import type { DocSource } from '../tools/doc/docSource';
```

在 `const activeTool = computed(...)`（约 62 行）之后加：

```ts
// 本地来源页签（拖入文件/文件夹）
const local = useLocalSources();
const activeLocal = computed(() => (props.center.active.value?.kind === 'local' ? props.center.active.value : null));
const localIsRoot = computed(() => activeLocal.value?.id === 'l:root');
const localRootSource = localRootDocSource();
const localLeafName = computed(() => {
  const p = local.activePath.value;
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
});
const localFileEntry = computed(() => {
  const id = activeLocal.value?.id || '';
  if (!id.startsWith('l:f:')) return null;
  return local.files.value.get(id.slice(4)) || null;
});
const localFileSource = computed<DocSource | null>(() => {
  const e = localFileEntry.value;
  return e ? localFileDocSource(e.key) : null;
});
```

- [ ] **Step 2: 加模板层**

在 `<div v-show="!!activeTool" class="tool-layer"> ... </div>`（约 1333-1336 行）之后加：

```html
    <div v-show="!!activeLocal" class="local-layer">
      <template v-if="localIsRoot">
        <DocViewer
          v-if="local.activePath.value"
          :source="localRootSource"
          :path="local.activePath.value"
          :name="localLeafName"
        />
        <div v-else class="local-empty">{{ $t('local.empty') }}</div>
      </template>
      <DocViewer
        v-else-if="localFileSource && localFileEntry"
        :key="localFileEntry.key"
        :source="localFileSource"
        :path="localFileEntry.name"
        :name="localFileEntry.name"
      />
    </div>
```

并在 import 区加 `DocViewer`：

```ts
import DocViewer from './DocViewer.vue';
```

- [ ] **Step 3: 加样式**

在 `.tool-layer { flex: 1; min-height: 0; overflow: hidden; }`（约 1614 行）之后加：

```css
.local-layer { flex: 1; min-height: 0; overflow: hidden; }
.local-empty { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--tx4); font-size: 13px; }
```

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add web/src/components/TerminalView.vue
git commit -m "feat(terminal): 渲染本地来源内容层"
```

---

### Task 13: `App.vue` 接线

**Files:**
- Modify: `web/src/App.vue`

- [ ] **Step 1: 加 import**

在 import 区加：

```ts
import { useLocalSources } from './local/useLocalSources';
import { useLocalDrop, type LocalDropPayload } from './local/useLocalDrop';
import { MAX_DROP_FILES } from './local/localHandles';
import LocalDropOverlay from './local/LocalDropOverlay.vue';
import LocalSidebar from './local/LocalSidebar.vue';
```

- [ ] **Step 2: 加状态与 drop 处理**

在 `const terminal = useTerminal({}); const center = useCenter();`（约 49-50 行）之后加：

```ts
const local = useLocalSources();
function onLocalDrop(p: LocalDropPayload) {
  rail.value = 'explorer';
  if (p.dirHandles.length) {
    const folder = p.dirHandles[0];
    local.mountFolder(folder);
    center.openLocalRoot(folder.name);
    if (p.dirHandles.length > 1) alert(t('local.extra_folders'));
  }
  if (p.fileHandles.length) {
    const { keys, truncated } = local.addFiles(p.fileHandles.map((h) => ({ name: h.name, handle: h, file: null })));
    keys.forEach((key, i) => center.openLocalFile(key, p.fileHandles[i].name));
    if (truncated > 0) alert(t('local.too_many_files', { max: MAX_DROP_FILES }));
  } else if (!p.dirHandles.length && p.files.length) {
    // 非 Chromium 降级：只读打开文件
    const { keys, truncated } = local.addFiles(p.files.map((f) => ({ name: f.name, handle: null, file: f })));
    keys.forEach((key, i) => center.openLocalFile(key, p.files[i].name));
    if (truncated > 0) alert(t('local.too_many_files', { max: MAX_DROP_FILES }));
  }
}
const { dragging: localDragging } = useLocalDrop(onLocalDrop);
const activeLocalRoot = computed(() => center.active.value?.kind === 'local' && center.active.value.id === 'l:root' && !!local.root.value);
```

> 注意：`rail.value = 'explorer'` 与 `alert` 均为既有用法；`t` 已在本组件内可用。

- [ ] **Step 3: 左侧面板加本地树分支**

把（约 718-726 行）：

```html
        <aside class="side" :style="{ width: sideW + 'px' }">
          <ToolSidebar v-if="activeTool" :tool="activeTool" />
          <HistoryList v-else :items="historyItems" ...
```

改为（仅插入一行 `LocalSidebar` 分支）：

```html
        <aside class="side" :style="{ width: sideW + 'px' }">
          <ToolSidebar v-if="activeTool" :tool="activeTool" />
          <LocalSidebar v-else-if="activeLocalRoot" />
          <HistoryList v-else :items="historyItems" ...
```

- [ ] **Step 4: 挂 overlay**

在模板末尾 `<DistTaskNotifier :terminal="terminal" />`（约 748 行）之前加：

```html
    <LocalDropOverlay v-if="localDragging" />
```

- [ ] **Step 5: 类型检查**

Run: `npm.cmd run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
git add web/src/App.vue
git commit -m "feat(app): 拖入文件/文件夹接入本地来源与左侧树"
```

---

### Task 14: 全量验证与手动验证

- [ ] **Step 1: 跑全量单测与类型检查**

Run: `npm.cmd test`
Expected: server + web 全部 PASS。

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd run check:i18n`
Expected: PASS。

- [ ] **Step 2: 启动 dev 手动验证**

按 `AGENTS.md` 用后台方式启动（日志写 `logs\`）：

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -WorkingDirectory "D:\root\devflow\devflow" -RedirectStandardOutput "logs\dev-server.log" -RedirectStandardError "logs\dev-server.err.log" -WindowStyle Hidden
```

访问 `http://localhost:5173`，在 Chrome/Edge 逐项验证：
- 拖入单个 `.md`（含外链图片）→ 自动预览。
- 拖入含相对图片的文件夹 → 左侧出现树，点文件右侧预览，图片正常。
- 拖入图片 / PDF → 正常展示。
- 打开文本 → 编辑 → Ctrl+S → 在外部编辑器确认原文件已改。
- 编辑后等自动保存（10s）触发授权失败提示 → 点保存重试并授权 → 文件写回成功。
- 拖入 >10MB 文本 → 报「文件超过 10 MB」。
- 关闭本地根页签 → 树消失、单文件页签保留。
- 刷新页面 → 本地页签与来源消失。

- [ ] **Step 3: 若一切通过，收尾提交（仅当手动验证期间有改动时才提交）**

```powershell
git status --short
```

若无改动 → 结束；若有 → 只 `git add` 对应文件并按 Conventional Commits 提交。

---

## 完成标准

- `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 全绿。
- 手动验证全部通过（上列 8 条）。
- 未改服务端、未新增依赖、未写死绝对路径、无中文明文文案（i18n 除外）。
