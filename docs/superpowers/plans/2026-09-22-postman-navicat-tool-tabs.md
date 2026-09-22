# Postman / Navicat 迁移主区工具页签 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task（本仓库 AGENTS 规定默认 inline 执行，不用 subagent）。步骤用 checkbox（`- [ ]`）跟踪。

**Goal:** 让 Postman / Navicat 不再是 `MiniTools` 全屏弹窗，而以主区「工具页签」呈现：左侧统一 `ToolSidebar` + `TreeView`（与 notepad 同壳），右侧各自内容；搜索复用首页 `FileSearchPanel`（名字+内容）；Postman 增加「批量执行」。

**Architecture:** 两工具各一份**模块级单例 workbench**（`usePostmanWorkbench`/`useNavicatWorkbench`，仿 `useToolWorkbench`），供左侧树/工具条与右侧内容共用；各自配一个 `TreeSource` 适配器；`ToolSidebar` 按 `ToolId` 分派；`TerminalView` 按 tool 渲染右侧内容；删除弹窗与遗留组件。

**Tech Stack:** Vue 3 `<script setup>` + TS、Vite、vitest + @vue/test-utils（happy-dom）、Element Plus、CodeMirror 6（Node 后端不动）。

**规格来源:** `docs/superpowers/specs/2026-09-22-postman-navicat-tool-tabs-design.md`

**通用命令（Windows/PowerShell）:**

- 单测（web）: `npm.cmd --prefix web run test -- src/path/to/x.test.ts`
- 全量测试: `npm.cmd test`
- 类型检查: `npm.cmd run typecheck`
- i18n 检查: `npm.cmd run check:i18n`
- 提交前先跑 `docs/learn/git仓库提交检查和提交事项.md` 清单；只 `git add` 本次文件。

---

## 文件结构

**新增**
- `web/src/tools/postman/usePostmanWorkbench.ts` — Postman 模块级单例状态 + 批量执行
- `web/src/tools/postman/postmanTreeSource.ts` — Postman 树适配器（含名字/内容搜索）
- `web/src/tools/postman/PostmanSidebarBar.vue` — 左树上方「▶ 批量执行」条
- `web/src/tools/navicat/useNavicatWorkbench.ts` — Navicat 模块级单例状态 + 连接弹窗状态
- `web/src/tools/navicat/navicatTreeSource.ts` — 连接→库→表 懒加载树适配器（含搜索）
- `web/src/tools/navicat/NavicatSidebarBar.vue` — 左树上方「＋新建连接」条

**修改**：`web/src/components/ToolSidebar.vue`、`web/src/components/TerminalView.vue`、`web/src/App.vue`、`web/src/components/MiniTools.vue`、`web/src/tools/postman/PostmanTool.vue`、`web/src/tools/navicat/NavicatTool.vue`、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`、`AGENTS.md`

**删除**：`web/src/tools/dialogActions.ts`、`web/src/components/FileSidebar.vue`、`web/src/components/ItemTree.vue`（+test）、`web/src/tools/notepad/NotepadTool.vue`（+test）、`web/src/tools/postman/PostmanTree.vue`（+test）、`web/src/tools/navicat/NavicatTree.vue`（+test）

**测试**：新增上表各新文件对应 `.test.ts`；重写 `PostmanTool.test.ts`、`NavicatTool.test.ts`、`MiniTools.test.ts`；补 `ToolSidebar.test.ts`

---

# Phase A：Postman

### Task 1: Postman 工作台 `usePostmanWorkbench.ts`

**Files:**
- Create: `web/src/tools/postman/usePostmanWorkbench.ts`
- Test: `web/src/tools/postman/usePostmanWorkbench.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/tools/postman/usePostmanWorkbench.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { usePostmanWorkbench } from './usePostmanWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }

afterEach(() => { vi.unstubAllGlobals(); });

const REC = (id: string, command: string, folder: string) => ({ id, command, folder, result: {}, updatedAt: '2026-09-01T00:00:00.000Z' });

describe('usePostmanWorkbench', () => {
  it('同一实例（模块级单例）', () => {
    expect(usePostmanWorkbench()).toBe(usePostmanWorkbench());
  });

  it('runFolder：批量跑目录内记录并逐条标状态', async () => {
    const records = [REC('foo/a.json', 'curl A', 'foo'), REC('foo/b.json', 'curl B', 'foo')];
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u === '/api/postman/history') return okJson({ items: records, folders: ['foo'] });
      if (u === '/api/curl') {
        const b = JSON.parse(opt.body);
        calls.push(b.command);
        return okJson({ ok: true, code: 0, status: b.command === 'curl A' ? 200 : 500, headers: '', body: '', stdout: '', stderr: '', timedOut: false });
      }
      return okJson({});
    }));
    const wb = usePostmanWorkbench();
    await wb.load();
    await wb.runFolder('foo');
    expect(calls).toEqual(['curl A', 'curl B']);
    expect(wb.runStatus.value['foo/a.json']).toBe('pass');
    expect(wb.runStatus.value['foo/b.json']).toBe('fail');
  });

  it('batchRun：未选目录时跑全部（含子目录）', async () => {
    const records = [REC('a.json', 'curl A', ''), REC('sub/b.json', 'curl B', 'sub')];
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u === '/api/postman/history') return okJson({ items: records, folders: ['sub'] });
      if (u === '/api/curl') { calls.push(JSON.parse(opt.body).command); return okJson({ ok: true, code: 0, status: 200, headers: '', body: '', stdout: '', stderr: '', timedOut: false }); }
      return okJson({});
    }));
    const wb = usePostmanWorkbench();
    await wb.load();
    wb.activeFolder.value = '';
    await wb.batchRun();
    expect(calls.sort()).toEqual(['curl A', 'curl B']);
  });

  it('openRecord 载入命令并选中', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [], folders: [] })));
    const wb = usePostmanWorkbench();
    wb.openRecord(REC('x.json', 'curl X', ''));
    expect(wb.curlCmd.value).toBe('curl X');
    expect(wb.activeId.value).toBe('x.json');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/tools/postman/usePostmanWorkbench.test.ts`
Expected: FAIL（找不到模块）

- [ ] **Step 3: 实现**

```ts
// web/src/tools/postman/usePostmanWorkbench.ts
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { t } from '../../i18n';
import { usePostmanHistory, type CurlResult, type PostmanRecord } from './usePostmanHistory';
import { postmanTreeSource } from './postmanTreeSource';
import type { TreeSource } from '../../tree/treeSource';

// Postman 工作台：模块级单例，左侧工具条/树与右侧内容共用同一份状态。
export interface PostmanWorkbench {
  history: Ref<PostmanRecord[]>;
  folders: Ref<string[]>;
  activeId: Ref<string>;
  activeFolder: Ref<string>;
  activeRecord: ComputedRef<PostmanRecord | null>;
  runStatus: Ref<Record<string, 'pass' | 'fail'>>;
  curlCmd: Ref<string>;
  respHeaders: Ref<string>;
  respBody: Ref<string>;
  respStderr: Ref<string>;
  status: Ref<number>;
  failed: Ref<boolean>;
  busy: Ref<boolean>;
  msg: Ref<string>;
  treeSource: TreeSource;
  load(): Promise<void>;
  openRecord(r: PostmanRecord): void;
  runCurlCmd(): Promise<void>;
  runOne(rec: PostmanRecord): Promise<CurlResult>;
  runFolder(path: string): Promise<void>;
  batchRun(): Promise<void>;
  clearResult(): void;
  clear(): void;
}

let cache: PostmanWorkbench | null = null;

export function usePostmanWorkbench(): PostmanWorkbench {
  if (cache) return cache;
  const hist = usePostmanHistory();
  const activeId = ref('');
  const activeFolder = ref('');
  const runStatus = ref<Record<string, 'pass' | 'fail'>>({});
  const curlCmd = ref('');
  const respHeaders = ref('');
  const respBody = ref('');
  const respStderr = ref('');
  const status = ref(0);
  const failed = ref(false);
  const busy = ref(false);
  const msg = ref('');

  const activeRecord = computed(() => hist.history.value.find((r) => r.id === activeId.value) || null);
  const recordById = (id: string) => hist.history.value.find((r) => r.id === id) || null;

  function clearResult() { respHeaders.value = ''; respBody.value = ''; respStderr.value = ''; status.value = 0; failed.value = false; }
  function openRecord(r: PostmanRecord) { curlCmd.value = r.command; activeId.value = r.id; clearResult(); msg.value = ''; }
  function setStatus(id: string, pass: boolean) { runStatus.value = { ...runStatus.value, [id]: pass ? 'pass' : 'fail' }; }
  function clearStatuses(ids: string[]) { const next = { ...runStatus.value }; for (const id of ids) delete next[id]; runStatus.value = next; }
  function isPass(j: CurlResult) { return !!j.ok && !j.error && !j.timedOut && (Number(j.status) || 0) < 400; }

  async function execCurl(command: string, folder: string): Promise<CurlResult> {
    const j = await hist.runCurl(command, folder);
    status.value = Number(j.status) || 0;
    respHeaders.value = j.headers ?? '';
    respBody.value = j.body ?? j.stdout ?? '';
    respStderr.value = j.stderr ?? '';
    failed.value = !j.ok || !!j.error || (status.value === 0 && j.code !== 0);
    msg.value = j.timedOut ? t('tools.pm_timeout') : t('tools.pm_exit', { code: j.code });
    return j;
  }

  async function runCurlCmd(): Promise<void> {
    if (busy.value) return;
    if (!curlCmd.value.trim()) { msg.value = t('et.empty'); return; }
    busy.value = true; msg.value = ''; clearResult();
    try { await execCurl(curlCmd.value, activeFolder.value); }
    catch (e) { failed.value = true; msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) }); }
    finally { busy.value = false; }
  }

  async function runOne(rec: PostmanRecord): Promise<CurlResult> {
    curlCmd.value = rec.command; activeId.value = rec.id;
    try {
      const j = await execCurl(rec.command, rec.folder || '');
      setStatus(rec.id, isPass(j));
      return j;
    } catch (e) {
      setStatus(rec.id, false);
      failed.value = true;
      msg.value = t('tools.failed', { msg: (e as Error)?.message || String(e) });
      throw e;
    }
  }

  function folderRecords(path: string) {
    return hist.history.value.filter((r) => { const f = r.folder || ''; return f === path || f.startsWith(`${path}/`); });
  }

  async function runList(list: PostmanRecord[]): Promise<void> {
    if (busy.value) return;
    if (!list.length) { msg.value = t('tools.pm_folder_empty'); return; }
    clearStatuses(list.map((r) => r.id));
    busy.value = true; msg.value = ''; clearResult();
    try {
      for (let i = 0; i < list.length; i += 1) {
        msg.value = t('tools.pm_run_progress', { i: i + 1, total: list.length });
        await runOne(list[i]);
      }
      msg.value = t('tools.pm_run_done', { n: list.length });
    } catch { /* runOne 已记录失败；保持与旧行为一致：遇错停止 */ }
    finally { busy.value = false; }
  }

  async function runFolder(path: string): Promise<void> { await runList(folderRecords(path)); }
  // 未选目录时跑全部（含子目录）；选了目录只跑该目录。
  async function batchRun(): Promise<void> {
    await runList(activeFolder.value ? folderRecords(activeFolder.value) : hist.history.value);
  }
  function clear() { curlCmd.value = ''; clearResult(); msg.value = ''; }

  const treeSource = postmanTreeSource({
    history: () => hist.history.value,
    folders: () => hist.folders.value,
    statusOf: (id) => runStatus.value[id],
    recordById,
    openRecord,
    createFolder: (parent, name) => hist.createFolder(parent, name),
    renameFolder: (path, name) => hist.renameFolder(path, name),
    renameRecord: (id, title) => hist.renameRecord(id, title),
    removeFolder: async (path) => { const r = await hist.removeFolder(path); if (r.ok && (activeFolder.value === path || activeFolder.value.startsWith(`${path}/`))) activeFolder.value = ''; return r; },
    removeRecord: async (id) => { const r = await hist.removeRecord(id); if (r.ok && activeId.value === id) activeId.value = ''; return r; },
    moveRecord: (id, folder) => hist.moveRecord(id, folder),
    runRecord: (r) => { void runOne(r); },
    runFolder: (path) => { void runFolder(path); },
  });

  cache = {
    history: hist.history, folders: hist.folders, activeId, activeFolder, activeRecord, runStatus,
    curlCmd, respHeaders, respBody, respStderr, status, failed, busy, msg, treeSource,
    load: hist.load, openRecord, runCurlCmd, runOne, runFolder, batchRun, clearResult, clear,
  };
  return cache;
}
```

- [ ] **Step 4: 运行确认通过**（Task 2 未完成前此测试会因缺 `postmanTreeSource` 失败；先建 Task 2，再一起跑）
Run: `npm.cmd --prefix web run test -- src/tools/postman/usePostmanWorkbench.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**（与 Task 2 合并提交，见 Task 2 Step 5）

---

### Task 2: Postman 树数据源 `postmanTreeSource.ts`

**Files:**
- Create: `web/src/tools/postman/postmanTreeSource.ts`
- Test: `web/src/tools/postman/postmanTreeSource.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/tools/postman/postmanTreeSource.test.ts
import { describe, it, expect, vi } from 'vitest';
import { postmanTreeSource } from './postmanTreeSource';
import type { PostmanRecord } from './usePostmanHistory';

const REC = (id: string, command: string, folder: string, title?: string, updatedAt?: string): PostmanRecord =>
  ({ id, command, folder, title, updatedAt, result: {}, name: id.slice(id.lastIndexOf('/') + 1) });

function make(records: PostmanRecord[], folders: string[], over: Record<string, unknown> = {}) {
  const opened: PostmanRecord[] = [];
  const ran: string[] = [];
  const src = postmanTreeSource({
    history: () => records,
    folders: () => folders,
    statusOf: (id) => (id === 'foo/a.json' ? 'pass' : undefined),
    recordById: (id) => records.find((r) => r.id === id) || null,
    openRecord: (r) => opened.push(r),
    createFolder: vi.fn(async () => ({ ok: true })),
    renameFolder: vi.fn(async () => ({ ok: true })),
    renameRecord: vi.fn(async () => ({ ok: true })),
    removeFolder: vi.fn(async () => ({ ok: true })),
    removeRecord: vi.fn(async () => ({ ok: true })),
    moveRecord: vi.fn(async () => ({ ok: true })),
    runRecord: (r) => ran.push(r.id),
    runFolder: (p) => ran.push(`dir:${p}`),
    ...over,
  });
  return { src, opened, ran };
}

describe('postmanTreeSource', () => {
  it('loadChildren：根=根级文件夹+记录，子目录只取直接子级；带状态点与展示名', async () => {
    const { src } = make(
      [REC('foo/a.json', 'curl A', 'foo'), REC('root.json', 'curl R', '')],
      ['foo', 'foo/bar'],
    );
    expect(await src.loadChildren('')).toEqual([
      { key: 'foo', name: 'foo', kind: 'dir' },
      { key: 'root.json', name: 'curl R', kind: 'item', time: '', status: undefined },
    ]);
    expect(await src.loadChildren('foo')).toEqual([
      { key: 'foo/bar', name: 'bar', kind: 'dir' },
      { key: 'foo/a.json', name: 'curl A', kind: 'item', time: '', status: 'pass' },
    ]);
  });

  it('标题优先作为展示名', async () => {
    const { src } = make([REC('a.json', 'curl A', '', 'My A')], []);
    const rows = await src.loadChildren('');
    expect(rows[0].name).toBe('My A');
  });

  it('open 与右键运行调用对应记录', async () => {
    const { src, opened, ran } = make([REC('foo/a.json', 'curl A', 'foo')], ['foo']);
    src.open({ key: 'foo/a.json', name: 'curl A', kind: 'item' });
    expect(opened.map((r) => r.id)).toEqual(['foo/a.json']);
    src.run!({ key: 'foo/a.json', name: 'curl A', kind: 'item' });
    src.runFolder!('foo');
    expect(ran).toEqual(['foo/a.json', 'dir:foo']);
  });

  it('search：名字命中与内容命中；openHit 打开记录', async () => {
    const recs = [REC('a.json', 'curl https://target.com', '', 'Alpha'), REC('b.json', 'curl other', '', 'Beta')];
    const { src, opened } = make(recs, []);
    const byName = await src.search!('alpha', { caseSensitive: false, name: true, content: false });
    expect(byName.nameHits).toEqual([{ path: 'a.json', name: 'Alpha' }]);
    const byContent = await src.search!('target', { caseSensitive: false, name: false, content: true });
    expect(byContent.contentHits[0].path).toBe('a.json');
    src.openHit!({ path: 'b.json', name: 'Beta' });
    expect(opened[0].id).toBe('b.json');
  });
});
```

- [ ] **Step 2: 运行确认失败** → `npm.cmd --prefix web run test -- src/tools/postman/postmanTreeSource.test.ts`（FAIL）

- [ ] **Step 3: 实现**

```ts
// web/src/tools/postman/postmanTreeSource.ts
import { copyText } from '../../clipboard';
import type { TreeSource, TreeSourceNode, SearchResult, SearchHit } from '../../tree/treeSource';
import type { PostmanRecord } from './usePostmanHistory';

export interface PostmanTreeDeps {
  history: () => PostmanRecord[];
  folders: () => string[];
  statusOf: (id: string) => 'pass' | 'fail' | undefined;
  recordById: (id: string) => PostmanRecord | null;
  openRecord: (r: PostmanRecord) => void;
  createFolder: (parent: string, name: string) => Promise<unknown>;
  renameFolder: (path: string, name: string) => Promise<unknown>;
  renameRecord: (id: string, title: string) => Promise<unknown>;
  removeFolder: (path: string) => Promise<unknown>;
  removeRecord: (id: string) => Promise<unknown>;
  moveRecord: (id: string, folder: string) => Promise<unknown>;
  runRecord: (r: PostmanRecord) => void;
  runFolder: (path: string) => void;
}

function labelOf(r: PostmanRecord): string {
  return (r.title && r.title.trim()) || r.command;
}

function splitTerms(query: string, caseSensitive: boolean): string[] {
  const out: string[] = [];
  for (const raw of String(query).trim().split(/\s+/)) {
    if (raw.length < 2) continue;
    const t = caseSensitive ? raw : raw.toLowerCase();
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function searchRecords(records: PostmanRecord[], query: string, o: { caseSensitive: boolean; name: boolean; content: boolean }): SearchResult {
  const nameHits: SearchResult['nameHits'] = [];
  const contentHits: SearchResult['contentHits'] = [];
  let scanned = 0;
  const terms = splitTerms(query, o.caseSensitive);
  if (!terms.length || (!o.name && !o.content)) return { nameHits, contentHits, truncated: false, scanned };
  const hayOf = (s: string) => (o.caseSensitive ? s : s.toLowerCase());
  for (const r of records) {
    scanned++;
    const label = labelOf(r);
    if (o.name && terms.some((t) => hayOf(label).includes(t))) nameHits.push({ path: r.id, name: label });
    if (o.content) {
      const lines = JSON.stringify(r, null, 2).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (terms.some((t) => hayOf(lines[i]).includes(t))) {
          contentHits.push({ path: r.id, name: label, line: i + 1, text: lines[i].slice(0, 400) });
          break;
        }
      }
    }
  }
  return { nameHits, contentHits, truncated: false, scanned };
}

export function postmanTreeSource(deps: PostmanTreeDeps): TreeSource {
  const fmt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  };
  const dirsOf = (dirKey: string) => {
    const prefix = dirKey ? `${dirKey}/` : '';
    return deps.folders()
      .filter((f) => (dirKey ? f.startsWith(prefix) : true))
      .filter((f) => (dirKey ? f.slice(prefix.length) : f).split('/').length === 1)
      .map((f) => ({ key: f, name: f.slice(f.lastIndexOf('/') + 1), kind: 'dir' as const }));
  };
  const leavesOf = (dirKey: string) => deps.history()
    .filter((r) => (r.folder || '') === dirKey)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map((r) => ({ key: r.id, name: labelOf(r), kind: 'item' as const, time: fmt(r.updatedAt), status: deps.statusOf(r.id) }));

  return {
    async loadChildren(dirKey: string): Promise<TreeSourceNode[]> {
      return [...dirsOf(dirKey), ...leavesOf(dirKey)];
    },
    open(node) { const r = deps.recordById(node.key); if (r) deps.openRecord(r); },
    async createFolder(dirKey, name) { await deps.createFolder(dirKey, name); },
    async rename(node, name) {
      if (node.kind === 'dir') await deps.renameFolder(node.key, name);
      else await deps.renameRecord(node.key, name);
    },
    async remove(node) {
      if (node.kind === 'dir') await deps.removeFolder(node.key);
      else await deps.removeRecord(node.key);
    },
    async move(node, dirKey) { await deps.moveRecord(node.key, dirKey); },
    run(node) { const r = deps.recordById(node.key); if (r) deps.runRecord(r); },
    runFolder(dirKey) { deps.runFolder(dirKey); },
    copyName(node) { void copyText(node.name); },
    copyPath(node) { void copyText(node.key); },
    async search(query, o): Promise<SearchResult> { return searchRecords(deps.history(), query, o); },
    openHit(hit: SearchHit) { const r = deps.recordById(hit.path); if (r) deps.openRecord(r); },
  };
}
```

- [ ] **Step 4: 运行确认通过**
Run: `npm.cmd --prefix web run test -- src/tools/postman/postmanTreeSource.test.ts src/tools/postman/usePostmanWorkbench.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/postman/usePostmanWorkbench.ts web/src/tools/postman/usePostmanWorkbench.test.ts web/src/tools/postman/postmanTreeSource.ts web/src/tools/postman/postmanTreeSource.test.ts
git commit -m "feat(postman): 工作台共享状态与树数据源（含批量执行/搜索）"
```

---

### Task 3: Postman 左侧工具条 `PostmanSidebarBar.vue`

**Files:**
- Create: `web/src/tools/postman/PostmanSidebarBar.vue`
- Test: `web/src/tools/postman/PostmanSidebarBar.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/tools/postman/PostmanSidebarBar.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import PostmanSidebarBar from './PostmanSidebarBar.vue';
import { usePostmanWorkbench } from './usePostmanWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
afterEach(() => { vi.unstubAllGlobals(); usePostmanWorkbench().runStatus.value = {}; });

describe('PostmanSidebarBar', () => {
  it('点击批量执行 → 跑当前目录记录', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, opt?: any) => {
      if (u === '/api/postman/history') return okJson({ items: [{ id: 'a.json', command: 'curl A', folder: '', result: {} }], folders: [] });
      if (u === '/api/curl') { calls.push(JSON.parse(opt.body).command); return okJson({ ok: true, code: 0, status: 200, headers: '', body: '', stdout: '', stderr: '', timedOut: false }); }
      return okJson({});
    }));
    const wb = usePostmanWorkbench();
    await wb.load();
    wb.activeFolder.value = '';
    const w = mountC(PostmanSidebarBar);
    await flushPromises();
    await w.find('.pmsb-run').trigger('click');
    await flushPromises();
    expect(calls).toEqual(['curl A']);
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL（找不到组件）

- [ ] **Step 3: 实现**

```vue
<!-- web/src/tools/postman/PostmanSidebarBar.vue -->
<script setup lang="ts">
import { usePostmanWorkbench } from './usePostmanWorkbench';

const { busy, batchRun } = usePostmanWorkbench();
</script>

<template>
  <div class="pmsb">
    <button class="pmsb-run" :disabled="busy" :title="$t('tools.pm_run_all_tip')" @click="batchRun">
      ▶ {{ $t('tools.pm_run_all') }}
    </button>
  </div>
</template>

<style scoped>
.pmsb { display: flex; align-items: center; gap: 6px; padding: 0 2px 6px; flex: none; }
.pmsb-run { flex: 1; min-width: 0; background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.pmsb-run:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.pmsb-run:disabled { opacity: .55; cursor: default; }
</style>
```

- [ ] **Step 4: 运行确认通过** → `npm.cmd --prefix web run test -- src/tools/postman/PostmanSidebarBar.test.ts`（PASS）

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/postman/PostmanSidebarBar.vue web/src/tools/postman/PostmanSidebarBar.test.ts
git commit -m "feat(postman): 左树上方批量执行工具条"
```

---

### Task 4: 改造 `PostmanTool.vue`（去左树/Teleport，接工作台）

**Files:**
- Modify: `web/src/tools/postman/PostmanTool.vue`
- Modify: `web/src/tools/postman/PostmanTool.test.ts`
- Delete: `web/src/tools/postman/PostmanTree.vue`、`web/src/tools/postman/PostmanTree.test.ts`（树用例已由 Task 2 覆盖）

> 样式块 `<style scoped>` 保持不变；只替换 `<script setup>` 与 `<template>`。

- [ ] **Step 1: 重写测试（只测右侧内容）**

```ts
// web/src/tools/postman/PostmanTool.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../../test-utils';
import PostmanTool from './PostmanTool.vue';
import CodeEditor from '../../components/CodeEditor.vue';
import { usePostmanWorkbench } from './usePostmanWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
function setCmd(w: any, text: string) { w.findAllComponents(CodeEditor)[0].vm.$emit('update:modelValue', text); }
function fieldOf(w: any, i: number) { return w.findAllComponents(CodeEditor)[i].props('modelValue'); }

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); usePostmanWorkbench().msg.value = ''; });

async function runWith(result: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/postman/history' ? okJson({ items: [], folders: [] }) : okJson(result))));
  const w = mountC(PostmanTool);
  await flushPromises();
  setCmd(w, 'curl https://a.com');
  await w.find('.pmrun').trigger('click');
  await flushPromises();
  return w;
}

describe('PostmanTool', () => {
  it('执行 curl 显示输出并提示退出码', async () => {
    const w = await runWith({ ok: true, code: 0, stdout: 'hi', stderr: '', timedOut: false });
    expect(fieldOf(w, 2)).toBe('hi');
    expect(w.find('.pmmsg').exists()).toBe(true);
  });

  it('状态码 200 结果框绿色，响应头/体分框', async () => {
    const w = await runWith({ ok: true, code: 0, status: 200, headers: 'HTTP/1.1 200 OK', body: 'hi', stdout: 'hi', stderr: '', timedOut: false });
    expect(w.find('.pmresp').classes()).toContain('ok');
    expect(fieldOf(w, 1)).toBe('HTTP/1.1 200 OK');
    expect(fieldOf(w, 2)).toBe('hi');
  });

  it('状态码 500 结果框红色', async () => {
    const w = await runWith({ ok: true, code: 0, status: 500, headers: 'HTTP/1.1 500', body: 'boom', stdout: 'boom', stderr: '', timedOut: false });
    expect(w.find('.pmresp').classes()).toContain('err');
  });

  it('连接失败黄色，stderr 单独成框', async () => {
    const w = await runWith({ ok: false, code: 7, status: 0, headers: '', body: '', stdout: '', stderr: 'curl: (7) failed', timedOut: false });
    expect(w.find('.pmresp').classes()).toContain('warn');
    expect(fieldOf(w, 3)).toBe('curl: (7) failed');
  });

  it('放大浮层展示内容，关闭后消失', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/postman/history'
      ? okJson({ items: [], folders: [] })
      : okJson({ ok: true, code: 0, status: 200, headers: 'HTTP/1.1 200', body: 'BODY-TEXT', stdout: '', stderr: 'ERR-TEXT', timedOut: false }))));
    const w = mountC(PostmanTool, { global: { stubs: { teleport: true } } });
    await flushPromises();
    setCmd(w, 'curl https://a.com');
    await w.find('.pmrun').trigger('click');
    await flushPromises();
    expect(w.find('.pmmodal').exists()).toBe(false);
    await w.findAll('.pmenlarge')[1].trigger('click');
    const editors = w.findAllComponents(CodeEditor);
    expect(editors[editors.length - 1].props('modelValue')).toBe('BODY-TEXT');
    await w.find('.pmclose').trigger('click');
    expect(w.find('.pmmodal').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败** → `npm.cmd --prefix web run test -- src/tools/postman/PostmanTool.test.ts`（FAIL：仍渲染左树/或选择器不存在）

- [ ] **Step 3: 替换 `PostmanTool.vue` 的 script 与 template**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../../i18n';
import { usePostmanWorkbench } from './usePostmanWorkbench';
import CodeEditor from '../../components/CodeEditor.vue';

const {
  activeFolder, respHeaders, respBody, respStderr, status, failed, busy, msg,
  curlCmd, load, runCurlCmd, batchRun, clear,
} = usePostmanWorkbench();

const hasOutput = computed(() => !!(respHeaders.value || respBody.value || respStderr.value));
const respState = computed(() => {
  if (status.value >= 400) return 'err';
  if (status.value >= 200 && status.value < 300) return 'ok';
  if (status.value > 0) return 'neutral';
  return failed.value ? 'warn' : 'neutral';
});
const saveTo = computed(() => (activeFolder.value ? `/${activeFolder.value}` : '/'));

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copied.value = false; copyTimer = null; }, 2000);
}
async function copyOut() {
  if (!hasOutput.value) return;
  await copyText([respHeaders.value, respBody.value, respStderr.value].filter(Boolean).join('\n'));
}

type EnlargeKey = 'headers' | 'body' | 'stderr';
const enlarged = ref<{ title: string; value: string; placeholder: string } | null>(null);
const enlargeMeta: Record<EnlargeKey, { titleKey: string; phKey: string; read: () => string }> = {
  headers: { titleKey: 'tools.pm_headers', phKey: 'tools.pm_noheaders', read: () => respHeaders.value },
  body: { titleKey: 'tools.pm_body', phKey: 'tools.output', read: () => respBody.value },
  stderr: { titleKey: 'tools.pm_stderr', phKey: 'tools.pm_nostderr', read: () => respStderr.value },
};
function openEnlarge(key: EnlargeKey) { const m = enlargeMeta[key]; enlarged.value = { title: t(m.titleKey), value: m.read(), placeholder: t(m.phKey) }; }
function closeEnlarge() { enlarged.value = null; }
function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape' && enlarged.value) closeEnlarge(); }

onMounted(() => { void load(); window.addEventListener('keydown', onKeydown); });
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="pmbody">
    <section class="pmmain">
      <div class="pmactsbar">
        <button class="pmbtn primary pmrun" :disabled="busy" @click="runCurlCmd">{{ busy ? $t('tools.pm_running') : $t('tools.run') }}</button>
        <button class="pmbtn" @click="clear">{{ $t('tools.clear') }}</button>
        <button class="pmbtn pmrunall" :disabled="busy" :title="$t('tools.pm_run_all_tip')" @click="batchRun">{{ $t('tools.pm_run_all') }}</button>
        <span class="pmsave">{{ $t('tools.pm_saveto', { path: saveTo }) }}</span>
      </div>

      <div class="pmmsgrow"><div v-if="msg" class="pmmsg">{{ msg }}</div></div>

      <div class="pmcurlbox">
        <div class="pmcurlbar"><span class="pmcurlprompt">curl</span><span class="pmcurltip">{{ $t('tools.pm_tip') }}</span></div>
        <CodeEditor v-model="curlCmd" class="pmcurl" language="cmd.sh" :placeholder="$t('tools.pm_ph')" />
      </div>

      <label class="pmlabel">{{ $t('tools.pm_resp') }}</label>
      <div class="pmresp" :class="respState">
        <div class="pmfieldbox">
          <div class="pmfieldhead">
            <span class="pmfieldlabel">{{ $t('tools.pm_headers') }}</span>
            <button class="pmmini pmenlarge" :disabled="!respHeaders" @click="openEnlarge('headers')">{{ $t('tools.pm_enlarge') }}</button>
          </div>
          <CodeEditor v-model="respHeaders" class="pmfield pmheaders" readonly :placeholder="$t('tools.pm_noheaders')" />
        </div>
        <div class="pmfieldbox">
          <div class="pmfieldhead">
            <span class="pmfieldlabel">{{ $t('tools.pm_body') }}</span>
            <button class="pmmini pmenlarge" :disabled="!respBody" @click="openEnlarge('body')">{{ $t('tools.pm_enlarge') }}</button>
          </div>
          <CodeEditor v-model="respBody" class="pmfield pmout" readonly :placeholder="$t('tools.output')" />
        </div>
        <div class="pmfieldbox">
          <div class="pmfieldhead">
            <span class="pmfieldlabel">{{ $t('tools.pm_stderr') }}</span>
            <button class="pmmini pmenlarge" :disabled="!respStderr" @click="openEnlarge('stderr')">{{ $t('tools.pm_enlarge') }}</button>
          </div>
          <CodeEditor v-model="respStderr" class="pmfield pmstderr" readonly :placeholder="$t('tools.pm_nostderr')" />
        </div>
        <div class="pmoutacts">
          <button class="pmmini" :disabled="!hasOutput" @click="copyOut">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="enlarged" class="pmoverlay" @click.self="closeEnlarge">
        <div class="pmmodal" role="dialog" aria-modal="true">
          <header class="pmmodalhead">
            <span class="pmmodaltitle">{{ enlarged?.title }}</span>
            <div class="pmmodalacts">
              <button class="pmmini" @click="copyText(enlarged?.value ?? '')">{{ copied ? $t('tools.copied') : $t('tools.copy') }}</button>
              <button class="pmmini pmclose" @click="closeEnlarge">{{ $t('tools.pm_close') }}</button>
            </div>
          </header>
          <CodeEditor :model-value="enlarged?.value ?? ''" class="pmmodaledit" readonly :placeholder="enlarged?.placeholder ?? ''" />
        </div>
      </div>
    </Teleport>
  </div>
</template>
```

- [ ] **Step 4: 删除旧树组件**

```bash
git rm web/src/tools/postman/PostmanTree.vue web/src/tools/postman/PostmanTree.test.ts
```

- [ ] **Step 5: 运行确认通过 + 类型**
Run: `npm.cmd --prefix web run test -- src/tools/postman/PostmanTool.test.ts` 与 `npm.cmd run typecheck`
Expected: PASS / 无错误

- [ ] **Step 6: 提交**

```bash
git add web/src/tools/postman/PostmanTool.vue web/src/tools/postman/PostmanTool.test.ts
git commit -m "refactor(postman): 右侧内容接工作台，移除自带左树"
```

---

### Task 5: 接入主区（Postman 分支）

**Files:**
- Modify: `web/src/components/ToolSidebar.vue`、`web/src/components/ToolSidebar.test.ts`
- Modify: `web/src/components/TerminalView.vue`
- Modify: `web/src/App.vue`

- [ ] **Step 1: 改 `ToolSidebar.vue`（按 ToolId 分派，先只支持文件型 + postman）**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import TreeView from './TreeView.vue';
import { useToolWorkbench } from '../tools/useToolWorkbench';
import { usePostmanWorkbench } from '../tools/postman/usePostmanWorkbench';
import PostmanSidebarBar from '../tools/postman/PostmanSidebarBar.vue';
import type { FileTool } from '../tools/files/useToolFiles';
import type { ToolId } from '../tools/catalog';

const props = defineProps<{ tool: ToolId }>();

// 三份 workbench 都暴露 treeSource/activeId/activeFolder，统一取用。
const wb = computed(() => {
  if (props.tool === 'postman') return usePostmanWorkbench();
  return useToolWorkbench(props.tool as FileTool);
});

function onFolder(k: string) {
  const w: any = wb.value;
  w.activeFolder.value = k;
  w.onFolder?.(k);
}
</script>

<template>
  <div class="tside">
    <PostmanSidebarBar v-if="tool === 'postman'" />
    <TreeView
      :source="wb.treeSource"
      :title="$t('tools.' + tool)"
      :active-key="wb.activeId.value"
      :active-folder="wb.activeFolder.value"
      :storage-key="'devflow-' + tool + '-collapsed'"
      @update:active-folder="onFolder"
    />
  </div>
</template>

<style scoped>
.tside { height: 100%; padding: 6px; box-sizing: border-box; display: flex; flex-direction: column; }
</style>
```

- [ ] **Step 2: 改 `TerminalView.vue` 工具分支**

在 `activeDocTool` 附近加：

```ts
const activeToolName = computed(() => activeTool.value?.tool ?? '');
```

模板中 `tool-layer` 内（`ToolDocPane`/`TextToolBody` 之后）追加：

```vue
<PostmanTool v-else-if="activeToolName === 'postman'" />
```

并在 `<script setup>` 顶部加 `import PostmanTool from '../tools/postman/PostmanTool.vue';`。

- [ ] **Step 3: 改 `App.vue` 的 `activeTool` 类型**

把 `const activeTool = computed(() => activeToolTab.value?.tool as FileTool | undefined);` 改为：

```ts
const activeTool = computed(() => activeToolTab.value?.tool as ToolId | undefined);
```

并确保 `App.vue` 已 `import type { ToolId } from './tools/catalog';`（若无则加；若 `FileTool` 导入变为未使用则移除）。

- [ ] **Step 4: 补 `ToolSidebar.test.ts`（postman 渲染批量执行条）**

在现有文件追加：

```ts
it('postman：渲染批量执行条与树', async () => {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u) === '/api/postman/history'
    ? okJson({ items: [], folders: [] })
    : okJson({}))));
  const w = mountC(ToolSidebar, { props: { tool: 'postman' } });
  await flushPromises();
  expect(w.find('.pmsb-run').exists()).toBe(true);
  expect(w.find('.ftv').exists()).toBe(true);
});
```

- [ ] **Step 5: 测试 + 类型**
Run: `npm.cmd --prefix web run test -- src/components/ToolSidebar.test.ts` 与 `npm.cmd run typecheck`
Expected: PASS / 无错误

- [ ] **Step 6: 提交**

```bash
git add web/src/components/ToolSidebar.vue web/src/components/ToolSidebar.test.ts web/src/components/TerminalView.vue web/src/App.vue
git commit -m "feat(tools): Postman 接入主区工具页签（左树+批量执行）"
```

---

# Phase B：Navicat

### Task 6: Navicat 工作台 `useNavicatWorkbench.ts`

**Files:**
- Create: `web/src/tools/navicat/useNavicatWorkbench.ts`
- Test: `web/src/tools/navicat/useNavicatWorkbench.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/tools/navicat/useNavicatWorkbench.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ElMessageBox } from 'element-plus';
import { useNavicatWorkbench } from './useNavicatWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const P = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', hasPassword: false };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useNavicatWorkbench', () => {
  it('单例', () => { expect(useNavicatWorkbench()).toBe(useNavicatWorkbench()); });

  it('onFolder 选中连接/库，pickTable 追加 SELECT', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/navicat/profiles' ? okJson({ items: [P] }) : okJson({}))));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('c:1');
    expect(wb.activeId.value).toBe('1');
    wb.sql.value = 'SELECT 1';
    wb.pickTable('1', 'db1', 'users');
    expect(wb.sql.value).toBe('SELECT 1\nSELECT * FROM `users`');
  });

  it('onFolder 选库设置 activeDatabase 并高亮', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/navicat/profiles' ? okJson({ items: [P] }) : okJson({}))));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('d:1\u0000db1');
    expect(wb.activeId.value).toBe('1');
    expect(wb.activeDatabase.value).toBe('db1');
    expect(wb.activeFolder.value).toBe('d:1\u0000db1');
  });

  it('delete 当前连接清空活动项', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === '/api/navicat/profiles' ? okJson({ items: [P] }) : okJson({ ok: true }))));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('c:1');
    await wb.onRemove(P as any);
    expect(wb.activeId.value).toBe('');
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

```ts
// web/src/tools/navicat/useNavicatWorkbench.ts
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { t } from '../../i18n';
import { quoteIdent, useNavicat, type ExecResult, type NavicatProfile, type NavicatType } from './useNavicat';
import { navicatTreeSource } from './navicatTreeSource';
import type { TreeSource } from '../../tree/treeSource';

export interface NavicatWorkbench {
  profiles: Ref<NavicatProfile[]>;
  activeId: Ref<string>;
  activeFolder: Ref<string>;
  activeDatabase: Ref<string>;
  activeProfile: ComputedRef<NavicatProfile | null>;
  sql: Ref<string>;
  result: Ref<ExecResult | null>;
  busy: Ref<boolean>;
  msg: Ref<string>;
  dlg: Ref<boolean>;
  dlgTab: Ref<string>;
  dlgMsg: Ref<string>;
  form: Ref<NavicatProfile>;
  saving: Ref<boolean>;
  testing: Ref<boolean>;
  treeSource: TreeSource;
  load(): Promise<void>;
  onFolder(key: string): void;
  onTypeChange(): void;
  pickTable(id: string, db: string, table: string): void;
  openNew(): void;
  openEdit(p: NavicatProfile): Promise<void>;
  doSave(): Promise<void>;
  doTest(): Promise<void>;
  onRemove(p: NavicatProfile): Promise<void>;
  doExec(): Promise<void>;
  copyConn(withPassword: boolean): Promise<void>;
  doExport(): Promise<void>;
  editActive(): void;
}

function blank(): NavicatProfile {
  return { name: '', type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', database: '', password: '', options: { ssl: false } };
}
function defaultPort(type: NavicatType): string {
  return type === 'mysql' ? '3306' : type === 'postgres' ? '5432' : type === 'redis' ? '6379' : '';
}

let cache: NavicatWorkbench | null = null;

export function useNavicatWorkbench(): NavicatWorkbench {
  if (cache) return cache;
  const nav = useNavicat();
  const activeId = ref('');
  const activeFolder = ref('');
  const activeDatabase = ref('');
  const sql = ref('');
  const result = ref<ExecResult | null>(null);
  const busy = ref(false);
  const msg = ref('');
  const dlg = ref(false);
  const dlgTab = ref('general');
  const dlgMsg = ref('');
  const form = ref<NavicatProfile>(blank());
  const saving = ref(false);
  const testing = ref(false);

  const activeProfile = computed(() => nav.profiles.value.find((p) => p.id === activeId.value) || null);
  const profileById = (id: string) => nav.profiles.value.find((p) => String(p.id) === id) || null;

  function selectConn(p: NavicatProfile) {
    activeId.value = p.id || '';
    activeDatabase.value = p.type === 'sqlite' ? '' : (p.database || '');
    result.value = null;
    msg.value = '';
  }

  function onFolder(key: string) {
    activeFolder.value = key;
    if (!key) { activeId.value = ''; activeDatabase.value = ''; return; }
    const parts = key.split('\u0000');
    const [kind, id] = parts[0].split(':');
    const p = profileById(id);
    if (!p) return;
    if (kind === 'c') selectConn(p);
    else if (kind === 'd') { selectConn(p); activeDatabase.value = parts[1] || ''; }
  }

  function pickTable(id: string, db: string, table: string) {
    const p = profileById(id);
    if (!p) return;
    if (p.type !== 'sqlite') activeDatabase.value = db;
    const stmt = `SELECT * FROM ${quoteIdent(p.type, table)}`;
    const cur = sql.value.replace(/\s+$/, '');
    sql.value = cur ? `${cur}\n${stmt}` : stmt;
  }

  function onTypeChange() {
    if (!form.value.port || ['3306', '5432', '6379', ''].includes(form.value.port)) form.value.port = defaultPort(form.value.type);
    if (form.value.type === 'sqlite') dlgTab.value = 'general';
  }

  function openNew() { form.value = blank(); dlgMsg.value = ''; dlgTab.value = 'general'; dlg.value = true; }
  async function openEdit(p: NavicatProfile) {
    form.value = { ...blank(), ...p, password: '', options: { ssl: false, ...(p.options || {}) } };
    dlgMsg.value = ''; dlgTab.value = 'general'; dlg.value = true;
    if (p.hasPassword && p.id) { try { form.value.password = await nav.reveal(p.id); } catch { /* ignore */ } }
  }
  function editActive() { if (activeProfile.value) void openEdit(activeProfile.value); }

  async function doSave() {
    if (!form.value.name.trim()) { dlgMsg.value = t('nv.required_name'); return; }
    saving.value = true; dlgMsg.value = '';
    try {
      const payload = { ...form.value, database: form.value.type === 'sqlite' ? form.value.database : '' };
      const saved = await nav.save(payload);
      dlg.value = false;
      activeId.value = saved.id || '';
      activeDatabase.value = saved.type === 'sqlite' ? '' : (saved.database || '');
      activeFolder.value = saved.id ? `c:${saved.id}` : '';
      msg.value = t('nv.saved');
    } catch (e) { dlgMsg.value = (e as Error).message; } finally { saving.value = false; }
  }

  async function doTest() {
    testing.value = true; dlgMsg.value = '';
    try {
      if (form.value.id && !form.value.password) await nav.test({ id: form.value.id });
      else await nav.test({ profile: form.value });
      dlgMsg.value = t('nv.test_ok');
    } catch (e) { dlgMsg.value = (e as Error).message; } finally { testing.value = false; }
  }

  async function onRemove(p: NavicatProfile) {
    try { await ElMessageBox.confirm(t('nv.delete_confirm'), t('nv.delete'), { type: 'warning' }); }
    catch { return; }
    await nav.remove(p.id!);
    if (activeId.value === p.id) { activeId.value = ''; activeDatabase.value = ''; activeFolder.value = ''; result.value = null; }
  }

  async function doExec() {
    if (!activeId.value) { msg.value = t('nv.save_first'); return; }
    if (!sql.value.trim()) return;
    busy.value = true; msg.value = '';
    try {
      let out = await nav.exec(activeId.value, sql.value, activeDatabase.value);
      if (out.needConfirm) {
        try { await ElMessageBox.confirm(t('nv.confirm_write'), t('nv.confirm_title'), { type: 'warning' }); }
        catch { busy.value = false; return; }
        out = await nav.exec(activeId.value, sql.value, activeDatabase.value, true);
      }
      result.value = out.result || null;
    } catch (e) { msg.value = (e as Error).message; } finally { busy.value = false; }
  }

  async function copyConn(withPassword: boolean) {
    if (!activeId.value) { msg.value = t('nv.save_first'); return; }
    try { const text = await nav.connstr(activeId.value, withPassword); await navigator.clipboard.writeText(text); msg.value = t('nv.copied'); }
    catch (e) { msg.value = (e as Error).message; }
  }

  async function doExport() {
    if (!activeId.value) { msg.value = t('nv.save_first'); return; }
    try {
      const xml = await nav.exportNcx([activeId.value]);
      const blob = new Blob([xml], { type: 'application/xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'navicat.ncx';
      a.click();
      URL.revokeObjectURL(a.href);
      msg.value = t('nv.exported');
    } catch (e) { msg.value = (e as Error).message; }
  }

  const treeSource = navicatTreeSource({
    profiles: () => nav.profiles.value,
    profileById,
    databases: (id) => nav.listDatabases(id),
    tables: (id, db) => nav.listTables(id, db),
    openConnection: (id) => { const p = profileById(id); if (p) selectConn(p); },
    openDatabase: (id, db) => { const p = profileById(id); if (p) { selectConn(p); activeDatabase.value = db; } },
    pickTable,
    renameConnection: async (id, name) => { await nav.rename(id, name); if (activeId.value === id) msg.value = ''; },
    removeConnection: async (id) => { const p = profileById(id); if (p) await onRemove(p); },
  });

  cache = {
    profiles: nav.profiles, activeId, activeFolder, activeDatabase, activeProfile, sql, result, busy, msg,
    dlg, dlgTab, dlgMsg, form, saving, testing, treeSource,
    load: nav.load, onFolder, onTypeChange, pickTable, openNew, openEdit, doSave, doTest, onRemove, doExec, copyConn, doExport, editActive,
  };
  return cache;
}
```

- [ ] **Step 4: 运行确认通过**（需 Task 7 的 `navicatTreeSource`；见 Task 7 Step 4）

---

### Task 7: Navicat 树数据源 `navicatTreeSource.ts`

**Files:**
- Create: `web/src/tools/navicat/navicatTreeSource.ts`
- Test: `web/src/tools/navicat/navicatTreeSource.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/tools/navicat/navicatTreeSource.test.ts
import { describe, it, expect, vi } from 'vitest';
import { navicatTreeSource } from './navicatTreeSource';
import type { NavicatProfile } from './useNavicat';

const MYSQL: NavicatProfile = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd' };
const SQLITE: NavicatProfile = { id: '2', name: 'S', type: 'sqlite', host: '', port: '', user: '', database: 'f.db' };

function make(over: Record<string, unknown> = {}) {
  const picked: string[] = [];
  const opened: string[] = [];
  const src = navicatTreeSource({
    profiles: () => [MYSQL, SQLITE],
    profileById: (id) => [MYSQL, SQLITE].find((p) => p.id === id) || null,
    databases: vi.fn(async () => ['db1']),
    tables: vi.fn(async () => ['users', 'orders']),
    openConnection: (id) => opened.push(`c:${id}`),
    openDatabase: (id, db) => opened.push(`d:${id}:${db}`),
    pickTable: (id, db, table) => picked.push(`${id}:${db}:${table}`),
    renameConnection: vi.fn(async () => {}),
    removeConnection: vi.fn(async () => {}),
    ...over,
  });
  return { src, picked, opened };
}

describe('navicatTreeSource', () => {
  it('连接为 dir；mysql 展开为库 dir，库展开为表 item；sqlite 直接表', async () => {
    const { src } = make();
    const roots = await src.loadChildren('');
    expect(roots.map((n) => [n.key, n.kind])).toEqual([['c:1', 'dir'], ['c:2', 'dir']]);
    expect(await src.loadChildren('c:1')).toEqual([{ key: 'd:1\u0000db1', name: 'db1', kind: 'dir' }]);
    expect(await src.loadChildren('d:1\u0000db1')).toEqual([
      { key: 't:1\u0000db1\u0000users', name: 'users', kind: 'item' },
      { key: 't:1\u0000db1\u0000orders', name: 'orders', kind: 'item' },
    ]);
    expect(await src.loadChildren('c:2')).toEqual([
      { key: 't:2\u0000f.db\u0000users', name: 'users', kind: 'item' },
      { key: 't:2\u0000f.db\u0000orders', name: 'orders', kind: 'item' },
    ]);
  });

  it('open 表 → pickTable；search/openHit → 选中连接', async () => {
    const { src, picked, opened } = make();
    src.open({ key: 't:1\u0000db1\u0000users', name: 'users', kind: 'item' });
    expect(picked).toEqual(['1:db1:users']);
    const byName = await src.search!('A', { caseSensitive: false, name: true, content: false });
    expect(byName.nameHits[0].path).toBe('c:1');
    src.openHit!({ path: 'c:1', name: 'A' });
    expect(opened).toEqual(['c:1']);
  });

  it('rename/remove 只作用于连接', async () => {
    const rename = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const { src } = make({ renameConnection: rename, removeConnection: remove });
    await src.rename!({ key: 'c:1', name: 'A', kind: 'dir' }, 'A2');
    await src.remove!({ key: 'c:1', name: 'A', kind: 'dir' });
    expect(rename).toHaveBeenCalledWith('1', 'A2');
    expect(remove).toHaveBeenCalledWith('1');
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

```ts
// web/src/tools/navicat/navicatTreeSource.ts
import { copyText } from '../../clipboard';
import type { TreeSource, TreeSourceNode, SearchResult, SearchHit } from '../../tree/treeSource';
import type { NavicatProfile } from './useNavicat';

export interface NavicatTreeDeps {
  profiles: () => NavicatProfile[];
  profileById: (id: string) => NavicatProfile | null;
  databases: (id: string) => Promise<string[]>;
  tables: (id: string, db: string) => Promise<string[]>;
  openConnection: (id: string) => void;
  openDatabase: (id: string, db: string) => void;
  pickTable: (id: string, db: string, table: string) => void;
  renameConnection: (id: string, name: string) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
}

const cKey = (id: string) => `c:${id}`;
const dKey = (id: string, db: string) => `d:${id}\u0000${db}`;
const tKey = (id: string, db: string, table: string) => `t:${id}\u0000${db}\u0000${table}`;

function parse(key: string): { kind: string; id: string; db: string; table: string } {
  const parts = key.split('\u0000');
  const [kind, id] = parts[0].split(':');
  return { kind, id, db: parts[1] || '', table: parts[2] || '' };
}

function splitTerms(query: string, caseSensitive: boolean): string[] {
  const out: string[] = [];
  for (const raw of String(query).trim().split(/\s+/)) {
    if (raw.length < 2) continue;
    const t = caseSensitive ? raw : raw.toLowerCase();
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function searchProfiles(profiles: NavicatProfile[], query: string, o: { caseSensitive: boolean; name: boolean; content: boolean }): SearchResult {
  const nameHits: SearchResult['nameHits'] = [];
  const contentHits: SearchResult['contentHits'] = [];
  let scanned = 0;
  const terms = splitTerms(query, o.caseSensitive);
  if (!terms.length || (!o.name && !o.content)) return { nameHits, contentHits, truncated: false, scanned };
  const hayOf = (s: string) => (o.caseSensitive ? s : s.toLowerCase());
  for (const p of profiles) {
    scanned++;
    const key = cKey(String(p.id));
    if (o.name && terms.some((t) => hayOf(p.name).includes(t))) nameHits.push({ path: key, name: p.name });
    if (o.content) {
      const lines = JSON.stringify(p, null, 2).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (terms.some((t) => hayOf(lines[i]).includes(t))) { contentHits.push({ path: key, name: p.name, line: i + 1, text: lines[i].slice(0, 400) }); break; }
      }
    }
  }
  return { nameHits, contentHits, truncated: false, scanned };
}

export function navicatTreeSource(deps: NavicatTreeDeps): TreeSource {
  return {
    async loadChildren(dirKey: string): Promise<TreeSourceNode[]> {
      if (!dirKey) return deps.profiles().map((p) => ({ key: cKey(String(p.id)), name: p.name, kind: 'dir' as const }));
      const pl = parse(dirKey);
      const p = deps.profileById(pl.id);
      if (!p) return [];
      if (pl.kind === 'c') {
        if (p.type === 'sqlite') {
          const list = await deps.tables(pl.id, p.database || '');
          return list.map((t) => ({ key: tKey(pl.id, p.database || '', t), name: t, kind: 'item' as const }));
        }
        const list = await deps.databases(pl.id);
        if (p.type === 'redis') return list.map((db) => ({ key: dKey(pl.id, db), name: db, kind: 'item' as const }));
        return list.map((db) => ({ key: dKey(pl.id, db), name: db, kind: 'dir' as const }));
      }
      if (pl.kind === 'd') {
        const list = await deps.tables(pl.id, pl.db);
        return list.map((t) => ({ key: tKey(pl.id, pl.db, t), name: t, kind: 'item' as const }));
      }
      return [];
    },
    open(node) {
      const pl = parse(node.key);
      if (pl.kind === 't') deps.pickTable(pl.id, pl.db, pl.table);
      else if (pl.kind === 'd') deps.openDatabase(pl.id, pl.db);
    },
    async rename(node, name) { const pl = parse(node.key); if (pl.kind === 'c') await deps.renameConnection(pl.id, name); },
    async remove(node) { const pl = parse(node.key); if (pl.kind === 'c') await deps.removeConnection(pl.id); },
    copyName(node) { void copyText(node.name); },
    copyPath(node) { void copyText(node.key); },
    async search(query, o): Promise<SearchResult> { return searchProfiles(deps.profiles(), query, o); },
    openHit(hit: SearchHit) { const pl = parse(hit.path); if (pl.kind === 'c') deps.openConnection(pl.id); },
  };
}
```

- [ ] **Step 4: 运行确认通过**
Run: `npm.cmd --prefix web run test -- src/tools/navicat/navicatTreeSource.test.ts src/tools/navicat/useNavicatWorkbench.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/navicat/useNavicatWorkbench.ts web/src/tools/navicat/useNavicatWorkbench.test.ts web/src/tools/navicat/navicatTreeSource.ts web/src/tools/navicat/navicatTreeSource.test.ts
git commit -m "feat(navicat): 工作台共享状态与连接/库/表树数据源"
```

---

### Task 8: Navicat 左侧工具条 `NavicatSidebarBar.vue`

**Files:**
- Create: `web/src/tools/navicat/NavicatSidebarBar.vue`
- Test: `web/src/tools/navicat/NavicatSidebarBar.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/tools/navicat/NavicatSidebarBar.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountC } from '../../test-utils';
import NavicatSidebarBar from './NavicatSidebarBar.vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';

afterEach(() => { vi.unstubAllGlobals(); useNavicatWorkbench().dlg.value = false; });

describe('NavicatSidebarBar', () => {
  it('点击新建连接 → 置位弹窗状态', async () => {
    const w = mountC(NavicatSidebarBar);
    await w.find('.nvsb-new').trigger('click');
    expect(useNavicatWorkbench().dlg.value).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

```vue
<!-- web/src/tools/navicat/NavicatSidebarBar.vue -->
<script setup lang="ts">
import { useNavicatWorkbench } from './useNavicatWorkbench';

const { openNew } = useNavicatWorkbench();
</script>

<template>
  <div class="nvsb">
    <button class="nvsb-new" @click="openNew">＋ {{ $t('nv.new') }}</button>
  </div>
</template>

<style scoped>
.nvsb { display: flex; align-items: center; gap: 6px; padding: 0 2px 6px; flex: none; }
.nvsb-new { flex: 1; min-width: 0; background: var(--bg4); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.nvsb-new:hover { border-color: var(--ac2); color: var(--ac2); }
</style>
```

- [ ] **Step 4: 运行确认通过** → PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/tools/navicat/NavicatSidebarBar.vue web/src/tools/navicat/NavicatSidebarBar.test.ts
git commit -m "feat(navicat): 左树上方新建连接工具条"
```

---

### Task 9: 改造 `NavicatTool.vue`（去左树/搜索框/Teleport，接工作台）

**Files:**
- Modify: `web/src/tools/navicat/NavicatTool.vue`
- Modify: `web/src/tools/navicat/NavicatTool.test.ts`
- Delete: `web/src/tools/navicat/NavicatTree.vue`、`web/src/tools/navicat/NavicatTree.test.ts`

> 弹窗与右侧 UI 从原文件搬迁，样式块 `<style scoped>` 保持不变（`.nvside`/`.nvsearch`/`.nvsidehead` 相关样式可删）。

- [ ] **Step 1: 重写测试（右侧内容 + 连接弹窗）**

```ts
// web/src/tools/navicat/NavicatTool.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../../test-utils';
import NavicatTool from './NavicatTool.vue';
import CodeEditor from '../../components/CodeEditor.vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';

function okJson(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
const P = { id: '1', name: 'A', type: 'mysql', host: 'h', port: '3306', user: 'u', database: 'd', hasPassword: false };

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  const wb = useNavicatWorkbench();
  wb.activeId.value = ''; wb.activeDatabase.value = ''; wb.activeFolder.value = ''; wb.dlg.value = false;
});

function stubFetch(extra: (u: string, init?: RequestInit) => any) {
  return vi.fn(async (u: string, init?: RequestInit) => {
    const s = String(u);
    if (s === '/api/navicat/profiles' && (!init || !init.method)) return okJson({ items: [P] });
    if (s === '/api/navicat/reveal') return okJson({ password: '' });
    return extra(s, init);
  });
}

function mount() { return mountC(NavicatTool, { global: { plugins: [ElementPlus] } }); }

describe('NavicatTool', () => {
  it('选中连接后工具栏显示连接名', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('c:1');
    const w = mount();
    await flushPromises();
    expect(w.find('.nvactive').text()).toBe('A');
  });

  it('工作台点表生成的 SQL 会出现在编辑器', async () => {
    vi.stubGlobal('fetch', stubFetch(() => okJson({})));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('c:1');
    wb.pickTable('1', 'db1', 'users');
    const w = mount();
    await flushPromises();
    expect(w.findComponent(CodeEditor).props('modelValue')).toBe('SELECT * FROM `users`');
  });

  it('执行查询渲染结果表', async () => {
    vi.stubGlobal('fetch', stubFetch((u, init) => {
      if (u === '/api/navicat/exec') return okJson({ ok: true, result: { columns: ['a'], rows: [[1]], affected: null, truncated: false, durationMs: 2 } });
      return okJson({});
    }));
    const wb = useNavicatWorkbench();
    await wb.load();
    wb.onFolder('c:1');
    wb.sql.value = 'SELECT 1';
    const w = mount();
    await flushPromises();
    await w.find('.nv-run').trigger('click');
    await flushPromises();
    expect(w.find('.nv-table').exists()).toBe(true);
  });

  it('新建连接对话框：保存走 POST', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', stubFetch((u, init) => { calls.push([u, init?.method]); return okJson({ ok: true, item: { ...P, id: '2', name: 'B' } }); }));
    const wb = useNavicatWorkbench();
    await wb.load();
    const w = mount();
    await flushPromises();
    wb.openNew();
    await flushPromises();
    await w.find('.nv-name-input input').setValue('B');
    await w.find('.nv-save').trigger('click');
    await flushPromises();
    expect(calls.some(([u, m]) => u === '/api/navicat/profiles' && m === 'POST')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 替换 `NavicatTool.vue` 的 script 与 template**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useNavicatWorkbench } from './useNavicatWorkbench';
import CodeEditor from '../../components/CodeEditor.vue';
import type { NavicatType } from './useNavicat';

const {
  activeProfile, activeDatabase, sql, result, busy, msg,
  dlg, dlgTab, dlgMsg, form, saving, testing,
  load, doSave, doTest, doExec, copyConn, doExport, editActive, onTypeChange,
} = useNavicatWorkbench();

const TYPES: NavicatType[] = ['mysql', 'postgres', 'sqlite', 'redis'];

const isSqlite = computed(() => form.value.type === 'sqlite');
const isRedis = computed(() => form.value.type === 'redis');
const ssl = computed({
  get: () => !!form.value.options?.ssl,
  set: (v: boolean) => { form.value = { ...form.value, options: { ...(form.value.options || {}), ssl: v } }; },
});

const exporting = ref(false);
async function onExport() { exporting.value = true; try { await doExport(); } finally { exporting.value = false; } }

function exportCsv() {
  if (!result.value) return;
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [result.value.columns.map(esc).join(',')];
  for (const row of result.value.rows) lines.push(row.map(esc).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'result.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

onMounted(() => { void load(); });
</script>

<template>
  <div class="nvbody">
    <section class="nvmain">
      <div class="nvtoolbar">
        <span class="nvactive">{{ activeProfile ? activeProfile.name : $t('nv.empty') }}</span>
        <span v-if="activeProfile && activeDatabase" class="nvactivedb">· {{ activeDatabase }}</span>
        <button v-if="activeProfile" class="nvbtn" @click="editActive">{{ $t('nv.edit') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-copy" @click="copyConn(false)">{{ $t('nv.copy_connstr') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-copy-pw" @click="copyConn(true)">{{ $t('nv.copy_with_pw') }}</button>
        <button v-if="activeProfile" class="nvbtn nv-export" :disabled="exporting" @click="onExport">{{ $t('nv.export_ncx') }}</button>
      </div>

      <div class="nvmsgrow"><div v-if="msg" class="nvmsg">{{ msg }}</div></div>

      <CodeEditor v-model="sql" class="nv-sql" language="query.sql" :placeholder="$t('nv.sql_ph')" />

      <div class="nvresbar">
        <button class="nvbtn primary nv-run" :disabled="busy" @click="doExec">{{ busy ? $t('nv.running') : $t('nv.exec') }}</button>
        <button class="nvbtn" @click="sql = ''; result = null; msg = ''">{{ $t('nv.clear') }}</button>
        <span class="nv-meta">
          <template v-if="result">
            <span v-if="result.truncated">{{ $t('nv.truncated', { n: result.rows.length }) }} · </span>
            <span v-if="result.affected !== null">{{ $t('nv.affected', { n: result.affected }) }} · </span>
            <span>{{ $t('nv.duration', { ms: result.durationMs }) }}</span>
          </template>
        </span>
        <button v-if="result && result.columns.length" class="nvbtn nvexport" style="margin-left:auto" @click="exportCsv">CSV</button>
      </div>

      <div class="nvresult">
        <table v-if="result && result.columns.length" class="nv-table">
          <thead><tr><th v-for="c in result.columns" :key="c">{{ c }}</th></tr></thead>
          <tbody><tr v-for="(row, i) in result.rows" :key="i"><td v-for="(cell, j) in row" :key="j">{{ cell }}</td></tr></tbody>
        </table>
        <pre v-else-if="result && result.raw" class="nv-raw">{{ result.raw }}</pre>
        <div v-else class="nv-noresult">{{ $t('nv.no_result') }}</div>
      </div>
    </section>

    <el-dialog v-model="dlg" :title="form.id ? $t('nv.edit_title') : $t('nv.new_title')" width="560px" class="nvdlg">
      <el-tabs v-model="dlgTab" class="nv-tabs">
        <el-tab-pane :label="$t('nv.tab_general')" name="general">
          <div class="nvform">
            <label class="nvrow">
              <span class="nvlbl">{{ $t('nv.name') }}</span>
              <el-input v-model="form.name" size="small" class="nv-name-input" />
            </label>
            <label class="nvrow">
              <span class="nvlbl">{{ $t('nv.type') }}</span>
              <select v-model="form.type" class="nv-type" @change="onTypeChange">
                <option v-for="ty in TYPES" :key="ty" :value="ty">{{ ty }}</option>
              </select>
            </label>
            <template v-if="isSqlite">
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.database_file') }}</span>
                <el-input v-model="form.database" size="small" class="nv-db-file" />
              </label>
            </template>
            <template v-else>
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.host') }}</span>
                <el-input v-model="form.host" size="small" class="nv-host" />
              </label>
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.port') }}</span>
                <el-input v-model="form.port" size="small" class="nv-port" />
              </label>
              <label v-if="!isRedis" class="nvrow">
                <span class="nvlbl">{{ $t('nv.user') }}</span>
                <el-input v-model="form.user" size="small" class="nv-user" />
              </label>
              <label class="nvrow">
                <span class="nvlbl">{{ $t('nv.password') }}</span>
                <el-input v-model="form.password" size="small" type="password" show-password class="nv-pw"
                          :placeholder="form.hasPassword && !form.password ? '••••••' : ''" />
              </label>
            </template>
          </div>
        </el-tab-pane>
        <el-tab-pane v-if="!isSqlite" :label="$t('nv.tab_advanced')" name="advanced">
          <div class="nvform">
            <label class="nvrow">
              <span class="nvlbl">{{ $t('nv.ssl') }}</span>
              <el-switch v-model="ssl" class="nv-ssl" />
            </label>
          </div>
        </el-tab-pane>
      </el-tabs>
      <div v-if="dlgMsg" class="nvmsg nvdlgmsg">{{ dlgMsg }}</div>
      <template #footer>
        <button class="nvbtn nv-test" :disabled="testing" @click="doTest">{{ testing ? $t('nv.testing') : $t('nv.test') }}</button>
        <button class="nvbtn nv-cancel" @click="dlg = false">{{ $t('nv.cancel') }}</button>
        <button class="nvbtn primary nv-save" :disabled="saving" @click="doSave">{{ $t('nv.ok') }}</button>
      </template>
    </el-dialog>
  </div>
</template>
```

> 原「类型切换时补默认端口」（`onTypeChange`）合并进 workbench 的 `save` 归一化即可；如需保留前端补默认端口，在 `useNavicatWorkbench` 的 `form` 上加 `watch`，不在本任务强制。

- [ ] **Step 4: 删除旧树组件**

```bash
git rm web/src/tools/navicat/NavicatTree.vue web/src/tools/navicat/NavicatTree.test.ts
```

- [ ] **Step 5: 运行确认通过 + 类型**
Run: `npm.cmd --prefix web run test -- src/tools/navicat/NavicatTool.test.ts` 与 `npm.cmd run typecheck`
Expected: PASS / 无错误

- [ ] **Step 6: 提交**

```bash
git add web/src/tools/navicat/NavicatTool.vue web/src/tools/navicat/NavicatTool.test.ts
git commit -m "refactor(navicat): 右侧内容接工作台，移除自带左树与搜索框"
```

---

### Task 10: 接入主区（Navicat 分支）

**Files:**
- Modify: `web/src/components/ToolSidebar.vue`、`web/src/components/ToolSidebar.test.ts`
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: `ToolSidebar.vue` 增加 navicat 分派**

script 顶部加导入：

```ts
import { useNavicatWorkbench } from '../tools/navicat/useNavicatWorkbench';
import NavicatSidebarBar from '../tools/navicat/NavicatSidebarBar.vue';
```

`wb` computed 改为：

```ts
const wb = computed(() => {
  if (props.tool === 'postman') return usePostmanWorkbench();
  if (props.tool === 'navicat') return useNavicatWorkbench();
  return useToolWorkbench(props.tool as FileTool);
});
```

template 增加：

```vue
<NavicatSidebarBar v-else-if="tool === 'navicat'" />
```

- [ ] **Step 2: `TerminalView.vue` 增加 navicat 分支**

script 加 `import NavicatTool from '../tools/navicat/NavicatTool.vue';`，模板 `tool-layer` 内追加：

```vue
<NavicatTool v-else-if="activeToolName === 'navicat'" />
```

- [ ] **Step 3: 补 `ToolSidebar.test.ts`**

追加：

```ts
it('navicat：渲染新建连接条与树', async () => {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u) === '/api/navicat/profiles' ? okJson({ items: [] }) : okJson({}))));
  const w = mountC(ToolSidebar, { props: { tool: 'navicat' } });
  await flushPromises();
  expect(w.find('.nvsb-new').exists()).toBe(true);
  expect(w.find('.ftv').exists()).toBe(true);
});
```

- [ ] **Step 4: 测试 + 类型**
Run: `npm.cmd --prefix web run test -- src/components/ToolSidebar.test.ts` 与 `npm.cmd run typecheck`
Expected: PASS / 无错误

- [ ] **Step 5: 提交**

```bash
git add web/src/components/ToolSidebar.vue web/src/components/ToolSidebar.test.ts web/src/components/TerminalView.vue
git commit -m "feat(tools): Navicat 接入主区工具页签（左树+新建连接）"
```

---

# Phase C：入口收敛与清理

### Task 11: `MiniTools.vue` 收敛为纯磁贴

**Files:**
- Modify: `web/src/components/MiniTools.vue`
- Modify: `web/src/components/MiniTools.test.ts`

- [ ] **Step 1: 重写 `MiniTools.test.ts`**

```ts
// web/src/components/MiniTools.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import MiniTools from './MiniTools.vue';
import { pendingTool, clearPendingTool, pendingToolTab, clearPendingToolTab } from '../uiIntents';

afterEach(() => { clearPendingTool(); clearPendingToolTab(); });

const IDS = ['notepad', 'postman', 'navicat', 'translate', 'yaml'];

describe('MiniTools', () => {
  it('渲染 5 个工具磁贴', () => {
    const w = mountC(MiniTools);
    expect(w.findAll('.mticon')).toHaveLength(5);
  });

  it('任一磁贴点击 → 请求主区工具页签', async () => {
    for (let i = 0; i < IDS.length; i += 1) {
      clearPendingToolTab();
      const w = mountC(MiniTools);
      await w.findAll('.mticon')[i].trigger('click');
      expect(pendingToolTab.value).toBe(IDS[i]);
    }
  });

  it('pendingTool 置位时同样请求工具页签', async () => {
    pendingTool.value = 'postman';
    const w = mountC(MiniTools);
    await flushPromises();
    expect(pendingToolTab.value).toBe('postman');
  });
});
```

- [ ] **Step 2: 运行确认失败** → `npm.cmd --prefix web run test -- src/components/MiniTools.test.ts`（FAIL）

- [ ] **Step 3: 实现（整文件替换）**

```vue
<!-- web/src/components/MiniTools.vue -->
<script setup lang="ts">
import { watch } from 'vue';
import { MINI_TOOLS, type ToolId } from '../tools/catalog';
import { pendingTool, clearPendingTool, requestToolTab } from '../uiIntents';

const TOOLS = MINI_TOOLS;

function openTool(id: ToolId) {
  if (TOOLS.find((x) => x.id === id)?.disabled) return;
  requestToolTab(id);
}

watch(pendingTool, (id) => {
  if (!id) return;
  openTool(id);
  clearPendingTool();
}, { immediate: true });
</script>

<template>
  <div class="mt">
    <div class="mtrow">
      <button v-for="x in TOOLS" :key="x.id" class="mticon" :disabled="x.disabled" :title="x.disabled && x.hint ? $t(x.hint) : $t(x.labelKey)" @click="openTool(x.id)">
        <span class="mtglyph">{{ x.icon }}</span><span class="mtname">{{ $t(x.labelKey) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mt { margin: 0 0 16px; }
.mtrow { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 14px; }
.mticon { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 16px; padding: 22px 12px; cursor: pointer; font-size: 15px; }
.mticon:hover:not(:disabled) { border-color: var(--ac2); color: var(--ac2); }
.mticon:disabled { opacity: .5; cursor: default; }
.mtglyph { font-size: 40px; line-height: 1; }
.mtname { text-align: center; line-height: 1.3; }
</style>
```

- [ ] **Step 4: 运行确认通过** → PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/components/MiniTools.vue web/src/components/MiniTools.test.ts
git commit -m "refactor(tools): 小工具磁贴统一改为打开主区工具页签"
```

---

### Task 12: 删除遗留组件与弹窗动作目标

**Files:**
- Delete: `web/src/tools/dialogActions.ts`
- Delete: `web/src/components/FileSidebar.vue`
- Delete: `web/src/components/ItemTree.vue`、`web/src/components/ItemTree.test.ts`
- Delete: `web/src/tools/notepad/NotepadTool.vue`、`web/src/tools/notepad/NotepadTool.test.ts`

- [ ] **Step 1: 确认无引用**

Run: `git grep -n "dialogActions\|FileSidebar\|ItemTree\|NotepadTool" -- web/src`
Expected: 仅剩将被删除的文件自身（`FileSidebar.vue` 引用 `ItemTree`、`NotepadTool.vue` 引用 `FileSidebar`）。若还有别的引用，先处理再删。

- [ ] **Step 2: 删除**

```bash
git rm web/src/tools/dialogActions.ts web/src/components/FileSidebar.vue web/src/components/ItemTree.vue web/src/components/ItemTree.test.ts web/src/tools/notepad/NotepadTool.vue web/src/tools/notepad/NotepadTool.test.ts
```

- [ ] **Step 3: 全量测试 + 类型**

Run: `npm.cmd test` 与 `npm.cmd run typecheck`
Expected: 全绿

- [ ] **Step 4: 提交**（`git rm` 已在 Step 2 暂存删除，此处直接提交）

```bash
git commit -m "chore(tools): 移除弹窗动作目标与遗留树组件"
```

---

### Task 13: i18n 词条 + AGENTS.md + 全量验证

**Files:**
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- Modify: `AGENTS.md`

- [ ] **Step 1: 补 i18n（中英对称）**

`shared/i18n/zh-CN.js` 在 `'tools.pm_run_folder'` 一行附近插入：

```js
  'tools.pm_run_all': '批量执行',
  'tools.pm_run_all_tip': '执行当前目录内全部用例（含子目录）；未选目录时为全部',
```

`shared/i18n/en.js` 对应插入：

```js
  'tools.pm_run_all': 'Run all',
  'tools.pm_run_all_tip': 'Run every case in the current folder (including subfolders); all cases when none selected',
```

- [ ] **Step 2: 更新 `AGENTS.md` 目录速览**

把「Postman 小工具…前端 `web/src/tools/postman/`…**待迁移**到统一壳子，当前仍走 `MiniTools` 弹窗」一类描述，改为：`postman`/`navicat` 已迁到主区工具页签；各配 `usePostmanWorkbench`/`postmanTreeSource` 与 `useNavicatWorkbench`/`navicatTreeSource`；左树统一 `TreeView`，搜索复用 `FileSearchPanel`；Postman 左树含批量执行条。并说明 `MiniTools` 现仅剩磁贴。

- [ ] **Step 3: 运行 i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 通过（web/src 与 server 用户可见范围零中文命中）

- [ ] **Step 4: 全量验证**

Run: `npm.cmd test` 与 `npm.cmd run typecheck`
Expected: 全绿

- [ ] **Step 5: 手工验证（dev）**

Run: `npm.cmd run dev`（另开终端），浏览器打开 http://localhost:5173
检查：应用市场磁贴打开 Postman / Navicat → 主区工具页签；左侧树展开/折叠、右键（Postman：新建文件夹/重命名/删除/运行/运行文件夹；Navicat：重命名/删除）、拖拽移动；🔍 搜「名字/内容」并点命中定位；Postman「▶ 批量执行」跑当前目录/全部 → 左树状态点 + 进度；Navicat「＋新建连接」→ 表单保存后树上出现 → 点表把 `SELECT` 追加进 SQL；右侧原功能不回归。

- [ ] **Step 6: 提交**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js AGENTS.md
git commit -m "docs(i18n): Postman/Navicat 工具页签词条与目录速览"
```

---

## Self-Review（写完计划后自查）

- **规格覆盖**：spec 4.1 入口 → Task 11；4.2 左侧 → Task 5/10；4.3 数据源/工作台 → Task 1/2/6/7；4.4 搜索 → Task 2/7（`search`+`openHit`）；4.5 右侧 → Task 4/9；4.6 清理 → Task 12；批量执行 → Task 1/3/4；i18n/AGENTS → Task 13。
- **占位符**：无 TBD/TODO；每个改动步骤都给了完整代码（Vue 样式块未变者明确「保持不变」）。
- **类型一致**：`TreeSource`/`TreeSourceNode`/`SearchResult`/`SearchHit`（`web/src/tree/treeSource.ts`）贯穿 Task 2/7；`PostmanWorkbench`（Task 1）字段在 Task 3/4/5 引用一致；`NavicatWorkbench`（Task 6）字段在 Task 8/9/10 引用一致；navicat 节点 key 前缀 `c:`/`d:`/`t:` 在 Task 6/7 一致。

## 执行说明（本仓库约定）

- 默认 **inline 执行**（AGENTS.md「计划执行方式」），不用 subagent。
- 每个 Task 走 TDD：先写失败测试 → 跑失败 → 最小实现 → 跑通过 → 提交。
- 每完成一个 Phase 跑一次 `npm.cmd test` + `npm.cmd run typecheck` + `npm.cmd run check:i18n`。
- 提交前执行 `docs/learn/git仓库提交检查和提交事项.md` 清单；只 `git add` 本次文件，不 `git add -A`。
