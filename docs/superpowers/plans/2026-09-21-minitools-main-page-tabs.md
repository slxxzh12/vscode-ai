# 小工具并入主页面统一壳子 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (本仓库 AGENTS 规定默认 inline 执行，不用 subagent)。步骤用 checkbox（`- [ ]`）跟踪。

**Goal:** 让小工具不再弹窗，而以主页面（explorer）的「工具页签」呈现：左侧面板显示该工具的固定树、中央显示该工具内容；主页项目树与工具树统一为同一个 `TreeView` 组件；`notepad`/`yaml` 直接复用主页面文档查看器。

**Architecture:** 三层拆分——`TreeView.vue`（展示 + 交互规则）、`TreeSource`（数据源契约）、各源适配器（项目 / 工具文件 / navicat）。主区页签在 `useCenter` 增加 `kind: 'tool'`；`App.vue` 左侧 `aside` 与 `TerminalView` 主区按活动页签切换。文档显示抽 `DocViewer.vue`（`FilePreview.vue` 退化为项目适配层）。

**Tech Stack:** Vue 3 `<script setup>` + TS、Vite、vitest + @vue/test-utils（happy-dom）、Element Plus、CodeMirror 6、Node ESM 后端（本轮基本不动）。

**规格来源:** `docs/superpowers/specs/2026-09-21-minitools-main-page-tabs-design.md`

**通用命令（本仓库 Windows/PowerShell 注意）:**

- 单测（web）: `npm.cmd --prefix web run test -- src/path/to/x.test.ts`
- 全量测试: `npm.cmd test`
- 类型检查: `npm.cmd run typecheck`
- i18n 检查: `npm.cmd run check:i18n`
- 提交前先跑 `docs/learn/git仓库提交检查和提交事项.md` 清单（敏感信息扫描、`git ls-files env` 必须为空、只 `git add` 本次文件）。

---

## 执行进度（2026-09-21）

- ✅ **Phase 1**（统一 `TreeView` + 主页面迁移）：T1-T4 完成（含删除 `FileTree.vue`/`TreeNode.vue` 及其测试）。
- ✅ **Phase 2**（工具壳子 + `DocViewer` 抽取 + notepad/yaml）：T5-T10 完成。
- ✅ **Phase 3 T11**（translate 迁移）：完成。
- ⬜ **Phase 3 T12**（postman 迁移）/ **T13**（navicat 迁移）/ **T14**（清理弹窗 + i18n + 文档）：**待做**。
- 验收现状：`npm.cmd test`（web 98 files / 592 tests 全绿）、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 均通过。
- 遗留：`MiniTools` 弹窗当前仅承载 postman/navicat；`NotepadTool.vue`、`PostmanTree.vue`、`NavicatTree.vue`、`FileSidebar.vue`、`ItemTree.vue`、`tools/dialogActions.ts` 仍存在，待 T14 清理。
- T12/T13 提示：postman/navicat 需把「树 + 内容」的选中状态抽成模块级共享（参考 `useToolWorkbench`），并同步改写 `PostmanTool.test`（8 条）、`PostmanTree.test`（15 条）、`NavicatTool.test`（9 条）、`NavicatTree.test`（7 条）。

---

## 分阶段

- **Phase 1**：统一 `TreeView` + 主页面项目树迁移（基础设施，主页面行为不回退）。
- **Phase 2**：工具壳子 + `DocViewer` 抽取 + `notepad`/`yaml`。
- **Phase 3**：`postman`/`navicat`/`translate` 迁移 + 清理弹窗。

每完成一个 Phase 各自跑一次 `npm.cmd test` + `typecheck` + `check:i18n` 再进入下一个。

---

# Phase 1：统一 TreeView + 主页面项目树迁移

**Phase 1 完成标准**：主页面左侧「目录」页签仍能浏览/新建项目文件，交互与外观与现状一致或更好；`FileTree.vue`/`TreeNode.vue` 被删除，主页面改用 `TreeView.vue` + `projectTreeSource`；全部现有测试通过。

---

### Task 1: 树数据源契约 + 可见行纯函数

**Files:**
- Create: `web/src/tree/treeSource.ts`
- Create: `web/src/tree/treeRows.ts`
- Test: `web/src/tree/treeRows.test.ts`

- [ ] **Step 1: 写失败测试（可见行展开逻辑）**

```ts
// web/src/tree/treeRows.test.ts
import { describe, it, expect } from 'vitest';
import { flattenVisible, type TreeRowNode } from './treeRows';

function n(key: string, kind: 'dir' | 'item', children: TreeRowNode[] = []): TreeRowNode {
  return { key, name: key, kind, children, loaded: true, loading: false };
}

describe('flattenVisible', () => {
  it('展开的目录递归输出子节点，折叠的目录只输出自身', () => {
    const tree = [n('a', 'dir', [n('a/1', 'item'), n('a/b', 'dir', [n('a/b/1', 'item')])]), n('z', 'item')];
    const rows = flattenVisible(tree, new Set(['a']));
    expect(rows.map((r) => r.node.key)).toEqual(['a', 'a/1', 'a/b', 'a/b/1', 'z']);
    expect(rows.find((r) => r.node.key === 'a/b/1')!.depth).toBe(2);
    expect(rows.find((r) => r.node.key === 'a')!.expanded).toBe(false);
  });

  it('未展开（不在折叠集合）时子节点也输出', () => {
    const rows = flattenVisible([n('a', 'dir', [n('a/1', 'item')])], new Set());
    expect(rows.map((r) => r.node.key)).toEqual(['a', 'a/1']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd --prefix web run test -- src/tree/treeRows.test.ts`
Expected: FAIL（找不到模块 `./treeRows`）

- [ ] **Step 3: 写契约与纯函数**

```ts
// web/src/tree/treeSource.ts
// 统一树的数据源契约：TreeView 只依赖本契约；能力（方法）缺省即隐藏对应菜单/按钮。
export interface TreeSourceNode {
  key: string;                       // 唯一 id：项目=相对路径；工具文件=文件/目录 id；navicat=连接/库/表 key
  name: string;                      // 显示名
  kind: 'dir' | 'item';
  icon?: string;                     // 可选图标；缺省由 TreeView 按 kind 给默认图标
  time?: string;                     // 可选时间（ISO 或已格式化字符串）
  status?: 'pass' | 'fail';          // 可选状态点（postman 运行结果）
}

export interface TreeSource {
  loadChildren(dirKey: string): Promise<TreeSourceNode[]>;   // '' = 根
  open(node: TreeSourceNode): void;

  createFile?(dirKey: string, name: string): Promise<void>;
  createFolder?(dirKey: string, name: string): Promise<void>;
  rename?(node: TreeSourceNode, name: string): Promise<void>;
  remove?(node: TreeSourceNode): Promise<void>;
  move?(node: TreeSourceNode, dirKey: string): Promise<void>;
  run?(node: TreeSourceNode): Promise<void>;
  runFolder?(dirKey: string): Promise<void>;
  reveal?(node: TreeSourceNode): Promise<void>;
  detail?(node: TreeSourceNode): Promise<void>;
  copyName?(node: TreeSourceNode): void;
  copyPath?(node: TreeSourceNode): void;
  copyContent?(node: TreeSourceNode): Promise<void>;
}

export type { TreeRowNode, TreeRow } from './treeRows';
```

```ts
// web/src/tree/treeRows.ts
// 把树（含展开状态）压平成可见行；纯函数便于单测。
export interface TreeRowNode {
  key: string;
  name: string;
  kind: 'dir' | 'item';
  icon?: string;
  time?: string;
  status?: 'pass' | 'fail';
  children: TreeRowNode[];
  loaded: boolean;
  loading: boolean;
}

export interface TreeRow {
  node: TreeRowNode;
  depth: number;
  expanded: boolean;
}

export function flattenVisible(nodes: TreeRowNode[], collapsed: Set<string>): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (list: TreeRowNode[], depth: number) => {
    for (const node of list) {
      const expanded = node.kind === 'dir' && !collapsed.has(node.key);
      out.push({ node, depth, expanded });
      if (node.kind === 'dir' && expanded && node.children.length) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/tree/treeRows.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/tree/treeSource.ts web/src/tree/treeRows.ts web/src/tree/treeRows.test.ts
git commit -m "feat(tree): 统一树数据源契约与可见行纯函数"
```

---

### Task 2: `TreeView.vue` 组件

**Files:**
- Create: `web/src/components/TreeView.vue`
- Create: `web/src/tree/fileIcon.ts`
- Create: `web/src/tree/fileIcon.test.ts`
- Test: `web/src/components/TreeView.test.ts`

外观/交互对齐现有实现：行样式抄 `web/src/components/ItemTree.vue` 的 `.fttree/.ftroot/.ftrow/...` 与 `TreeNode.vue` 的行（`ui-monospace`、`--bg4` 悬停/选中、`--ac2` 选中字色）；右键菜单抄 `FileTree.vue` 的 `.ctx`；小标题/按钮抄 `FileTree.vue` 的 `.head/.ic`。

- [ ] **Step 1: 写失败测试（假的 TreeSource，验证核心交互）**

```ts
// web/src/components/TreeView.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { mountC } from '../test-utils';
import TreeView from './TreeView.vue';
import type { TreeSource, TreeSourceNode } from '../tree/treeSource';

function fakeSource(over: Partial<TreeSource> = {}): TreeSource {
  const root: TreeSourceNode[] = [
    { key: 'docs', name: 'docs', kind: 'dir' },
    { key: 'a.txt', name: 'a.txt', kind: 'item' },
  ];
  return {
    async loadChildren(dir) { return dir === '' ? root : dir === 'docs' ? [{ key: 'docs/b.txt', name: 'b.txt', kind: 'item' }] : []; },
    open: vi.fn(),
    createFile: vi.fn(async () => {}),
    createFolder: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    copyName: vi.fn(),
    copyPath: vi.fn(),
    ...over,
  };
}

describe('TreeView', () => {
  it('加载根节点并渲染行', async () => {
    const w = mountC(TreeView, { props: { source: fakeSource() } });
    await flushPromises();
    const rows = w.findAll('.ftrow');
    expect(rows.map((r) => r.text())).toEqual(expect.arrayContaining([expect.stringContaining('docs'), expect.stringContaining('a.txt')]));
  });

  it('点目录懒加载子节点；点文件调用 source.open', async () => {
    const src = fakeSource();
    const w = mountC(TreeView, { props: { source: src } });
    await flushPromises();
    await w.findAll('.ftrow')[0].find('.ftname').trigger('click');
    await flushPromises();
    expect(w.findAll('.ftrow').length).toBe(3);
    await w.findAll('.ftrow')[2].find('.ftname').trigger('click');
    expect(src.open).toHaveBeenCalled();
  });

  it('右键菜单按能力显隐；重命名调用 source.rename', async () => {
    const src = fakeSource({ createFile: undefined });
    const w = mountC(TreeView, { props: { source: src } });
    await flushPromises();
    await w.findAll('.ftrow')[1].trigger('contextmenu');
    expect(w.find('.ftmenuitem.ftmenu-new').exists()).toBe(false);
    await w.find('.ftmenuitem.ftmenu-rename').trigger('click');
    await w.find('.ftedit').setValue('renamed.txt');
    await w.find('.ftedit').trigger('keydown.enter');
    await flushPromises();
    expect(src.rename).toHaveBeenCalledWith(expect.objectContaining({ key: 'a.txt' }), 'renamed.txt');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/components/TreeView.test.ts`
Expected: FAIL（找不到 `./TreeView.vue`）

- [ ] **Step 3: 实现 `TreeView.vue`**

要求（照此实现）：

- 图标：把 `TreeNode.vue:15-35` 的「按扩展名给图标」抽成 `web/src/tree/fileIcon.ts` 的 `fileIcon(name): string`（附 `fileIcon.test.ts` 用例照搬 `TreeNode.test.ts` 的图标用例）；TreeView 对 `kind==='item'` 且未显式给 `icon` 时用它。
- Props：`source: TreeSource`、`title?: string`（非空才显示头部标题）、`showRoot?: boolean`（是否渲染「🏠 根」行，默认 `false`）、`activeKey?: string`、`activeFolder?: string`、`storageKey?: string`。Emits：`update:activeFolder(key)`。
- 内部节点类型：`TreeSourceNode & { children: Internal[]; loaded: boolean; loading: boolean }`；`collapsed: Set<string>`（`storageKey` 存在时读写 `localStorage`，键名沿用原工具：调用方传 `devflow-<tool>-collapsed`/`devflow-postman-collapsed`）。
- 头部：`title` 非空时渲染 `.fthead`：左 `.fttitle`，右按钮 `⟳`（刷新，始终有）、`📄＋`（`source.createFile` 存在时）、`📁＋`（`source.createFolder` 存在时）；新建走 `window.prompt`（与 `FileTree.vue:126-152` 一致），成功后刷新并把新目录展开。
- 行：`.ftrow`，`paddingLeft = 8 + depth*14 px`；目录有 `▸/▾`（点箭头 `toggle`；点名字：选中目录 `emit('update:activeFolder', key)` 并 `toggle`）、`📁`；文件 `📄`、可选状态点 `.ftstatus`（`status`）、可选 `.fttime`（`time`）；点文件名调 `source.open(node)`；选中态：`activeFolder === key`（目录）/ `activeKey === key`（文件）。
- 根行：仅 `showRoot` 为真时渲染「🏠 根」行（`activeFolder === ''`，点它 `emit('update:activeFolder','')`）；不渲染根行时点列表空白 = 选中根（`emit('update:activeFolder','')`）。
- 右键菜单（`.ftmenu`，fixed 定位）：目录 = 新建文件 / 新建文件夹 / 运行（`runFolder`）/ 重命名 / 删除 / 复制名称 / 复制相对路径 / 定位（`reveal`）；文件 = 运行（`run`）/ 详情（`detail`）/ 复制内容（`copyContent`）/ 重命名 / 删除 / 复制名称 / 复制相对路径 / 定位。按 `source` 能力显隐（`reveal`/新建/复制内容/详情来自项目源；`rename`/`remove`/`move`/`run` 来自工具源）；无任何项时点右键不弹菜单。菜单文案复用 `tree.ctx.new_file`/`tree.ctx.new_dir`/`tree.rename`/`tree.delete`/`tree.copy_file_name`/`tree.copy_dir_name`/`tree.copy_path`/`tree.copy_content`/`tree.reveal_os`/`tree.detail`/`tree.run_item`/`tree.run_folder`。
- 行内重命名：`.ftedit` 输入，Enter 提交（调 `source.rename`，失败时把 `exists` 映射为 `t('tree.exists')` 显示在 `.fterr`），Esc 取消。
- 拖拽：文件行 `draggable`，drop 到目录行/根行调 `source.move(node, dirKey)`。
- 生命周期：`watch(() => props.source, reload, { immediate: true })`；`onMounted` 绑 `document` click/keydown 关菜单；`onBeforeUnmount` 解绑；`defineExpose({ reload })`。
- 文案一律走 `t()`/`$t()`，禁止硬编码中文。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/components/TreeView.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add web/src/components/TreeView.vue web/src/components/TreeView.test.ts
git commit -m "feat(tree): 新增统一 TreeView 组件"
```

---

### Task 3: 项目数据源适配器

**Files:**
- Create: `web/src/tree/projectTreeSource.ts`
- Test: `web/src/tree/projectTreeSource.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/tree/projectTreeSource.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { projectTreeSource } from './projectTreeSource';

afterEach(() => vi.unstubAllGlobals());

function okJson(body: unknown) { return { ok: true, json: async () => body }; }

describe('projectTreeSource', () => {
  it('loadChildren 调 /api/tree 并映射为节点', async () => {
    const fetchMock = vi.fn(async () => okJson({ items: [{ name: 'src', type: 'dir' }, { name: 'a.txt', type: 'file' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const src = projectTreeSource({ projectId: 'p1', onOpenFile: vi.fn(), onDetailFile: vi.fn() });
    const nodes = await src.loadChildren('');
    expect(fetchMock).toHaveBeenCalledWith('/api/tree?project=p1&path=');
    expect(nodes).toEqual([
      { key: 'src', name: 'src', kind: 'dir' },
      { key: 'a.txt', name: 'a.txt', kind: 'item' },
    ]);
  });

  it('open 触发 onOpenFile(projectId, key, name)', async () => {
    const onOpenFile = vi.fn();
    const src = projectTreeSource({ projectId: 'p1', onOpenFile, onDetailFile: vi.fn() });
    src.open({ key: 'src/a.txt', name: 'a.txt', kind: 'item' });
    expect(onOpenFile).toHaveBeenCalledWith('p1', 'src/a.txt', 'a.txt');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/tree/projectTreeSource.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现适配器**

`projectTreeSource({ projectId, onOpenFile, onDetailFile })` 返回 `TreeSource`：

- `loadChildren(dirKey)`：`useProjects().tree(projectId, dirKey)` → `{ key: dirKey ? dirKey+'/'+name : name, name, kind: type==='dir'?'dir':'item' }`。
- `open(node)`：`onOpenFile(projectId, node.key, node.name)`。
- `createFile(dirKey, name)` / `createFolder(dirKey, name)`：`useProjects().createFile/createDir(projectId, dirKey ? dirKey+'/'+name : name)`。
- `reveal(node)`：`useProjects().reveal(projectId, node.key)`。
- `detail(node)`：`onDetailFile(projectId, node.key, node.name)`。
- `copyName(node)` / `copyPath(node)`：写剪贴板（用 `web/src/clipboard.ts` 的 `copyText`），路径用 `node.key`。
- `copyContent(node)`：`api.text(projectId, node.key)` 后 `copyText(f.content)`（对应旧 FileTree 的「复制内容」）。
- 不提供 `rename`/`remove`/`move`/`run`（项目树不做这些，菜单自然隐藏）。
- 注意：`useProjects()` 每次调用返回新对象是允许的（内部只发 fetch）；适配器内保存 `const api = useProjects();`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/tree/projectTreeSource.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/tree/projectTreeSource.ts web/src/tree/projectTreeSource.test.ts
git commit -m "feat(tree): 项目文件数据源适配器"
```

---

### Task 4: 主页面「目录」页签迁移到 TreeView

**Files:**
- Modify: `web/src/components/HistoryList.vue`（把 `FileTree` 换成 `TreeView` + `projectTreeSource`）
- Delete: `web/src/components/FileTree.vue`、`web/src/components/TreeNode.vue`
- Delete: `web/src/components/FileTree.test.ts`、`web/src/components/TreeNode.test.ts`（行为用例移植到 `TreeView.test.ts` / `projectTreeSource.test.ts`，见 Task 2 Step 5）
- Test: 现有 `HistoryList` 相关测试（若有）需保持通过

- [ ] **Step 1: 改 `HistoryList.vue`**

- 脚本：删 `import FileTree`，加：
  ```ts
  import TreeView from './TreeView.vue';
  import { projectTreeSource } from '../tree/projectTreeSource';
  const treeSource = computed(() => projectTreeSource({
    projectId: props.projectId || '',
    onOpenFile: (pid, p, name) => emit('open-file', pid, p, name),
    onDetailFile: (pid, p, name) => emit('detail-file', pid, p, name),
  }));
  ```
- 模板：`<FileTree ... />` 换成
  ```vue
  <TreeView v-if="tab === 'tree'" class="hltree" :key="projectId || 'none'"
    :source="treeSource" :active-key="activePath || ''" :title="$t('tree.title')" />
  ```
  （`title` 非空 → 渲染头部标题 + `⟳` / `📄＋` / `📁＋`，与旧 `FileTree` 头部一致；不显示「🏠 根」行。）
- `.hltree` 样式保留。

- [ ] **Step 2: 删除旧组件**

```bash
git rm web/src/components/FileTree.vue web/src/components/TreeNode.vue
```

- [ ] **Step 3: 全量测试 + 类型检查**

Run: `npm.cmd --prefix web run test` 与 `npm.cmd run typecheck`
Expected: 通过（如 HistoryList 测试引用了 `.ft` 选择器需同步更新；没有则跳过）

- [ ] **Step 4: 手工验证（dev）**

Run: `npm.cmd run dev`（另开终端），浏览器打开 http://localhost:5173
检查：左侧「目录」页签能展开/折叠、点文件在右侧打开、右键「定位资源管理器/复制名称/复制相对路径/详情」均可用、头部 ⟳ / 📄＋ / 📁＋ 可用。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/HistoryList.vue
git commit -m "refactor(tree): 主页面目录页签改用统一 TreeView"
```

---

**Phase 1 收尾**：跑 `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`，全绿后进入 Phase 2。

---

# Phase 2：工具壳子 + DocViewer 抽取 + notepad/yaml

**Phase 2 完成标准**：`notepad` 与 `yaml` 磁贴/入口点开后，切到 explorer 并在主区开工具页签；左侧面板是该工具固定目录树（统一 `TreeView`），中央是该工具的文档查看器（复用主页面那套预览/代码/可视化 + 工具条）；两者各自独立目录；主区页签可关闭；现有会话/文件页签不受影响。

---

### Task 5: `useCenter` 支持工具页签

**Files:**
- Modify: `web/src/useCenter.ts`
- Test: `web/src/useCenter.test.ts`（若不存在则新建）

- [ ] **Step 1: 写失败测试**

```ts
// web/src/useCenter.test.ts
import { describe, it, expect } from 'vitest';
import { useCenter } from './useCenter';

describe('useCenter tool tabs', () => {
  it('openTool 新增并激活工具页签；重复打开只激活', () => {
    const c = useCenter();
    c.openTool('notepad');
    expect(c.tabs.value).toHaveLength(1);
    expect(c.tabs.value[0]).toMatchObject({ id: 't:notepad', kind: 'tool', tool: 'notepad' });
    expect(c.activeId.value).toBe('t:notepad');
    c.openTool('notepad');
    expect(c.tabs.value).toHaveLength(1);
  });

  it('closeById 关闭工具页签', () => {
    const c = useCenter();
    c.openTool('yaml');
    c.closeById('t:yaml');
    expect(c.tabs.value).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm.cmd --prefix web run test -- src/useCenter.test.ts`
Expected: FAIL（`openTool` 不存在）

- [ ] **Step 3: 实现**

`useCenter.ts`：`CenterTab` 加 `tool?: string`；`kind` 联合加 `'tool'`；`const tid = (x: string) => \`t:${x}\``；新增：

```ts
function openTool(tool: string, label?: string) {
  const id = tid(tool);
  upsert({ id, kind: 'tool', label: label ?? tool, tool });
  setActive(id);
}
```

`closeById`：`if (id.startsWith('t:')) { tabs.value = tabs.value.filter((x) => x.id !== id); if (activeId.value === id) { const s = activeSessionTab.value; setActive(s ? s.id : tabs.value[0]?.id ?? null); } return; }`；返回对象加 `openTool`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd --prefix web run test -- src/useCenter.test.ts` → PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/useCenter.ts web/src/useCenter.test.ts
git commit -m "feat(center): 主区页签支持工具类型"
```

---

### Task 6: `DocViewer` 抽取（`FilePreview` 退化为项目适配层）

> 这是本计划风险最高的一步。策略：**先给 `FilePreview` 现有行为补回归测试，再抽取**，抽完必须让回归测试仍通过。

**Files:**
- Create: `web/src/components/DocViewer.vue`
- Create: `web/src/tools/doc/docSource.ts`（`DocSource` 契约类型）
- Modify: `web/src/components/FilePreview.vue`
- Test: `web/src/components/FilePreview.test.ts`（新建回归测试）

- [ ] **Step 1: 先写 `FilePreview` 项目来源的回归测试**

用 `@vue/test-utils` mount `FilePreview`，stub 全局 `fetch` 返回文件内容与树，验证：加载文本文件后显示内容（`.meta` 含文件名）；点「保存」触发 `POST /api/file`；markdown 文件默认进入 preview 模式。测试至少覆盖「加载 + 自动保存触发」，作为抽取期间的护栏。

- [ ] **Step 2: 运行回归测试确认通过（抽取前基线）**

Run: `npm.cmd --prefix web run test -- src/components/FilePreview.test.ts`
Expected: PASS（基线绿）

- [ ] **Step 3: 定义 `DocSource` 契约**

```ts
// web/src/tools/doc/docSource.ts
import type { TreeItem } from '@devflow/shared';

export interface DocReadResult {
  name: string;
  content: string;
  size: number;
  mtime?: number;
  abs?: string;
  binary?: boolean;
}

export interface DocSource {
  kind: 'project' | 'tool';
  read(path: string): Promise<DocReadResult>;
  write(path: string, content: string): Promise<void>;
  rawUrl?(path: string): string;
  list?(dir: string): Promise<TreeItem[]>;
  meta?(path: string): Promise<{ name: string; path: string; abs: string; size: number; mtime: number; isDir: boolean }>;
  hash?(path: string): Promise<{ md5: string; sha256: string }>;
  reveal?(path: string): Promise<void>;
  run?(path: string): Promise<void>;
  pickExternal?(): Promise<{ name: string; content: string; size: number; binary?: boolean } | { cancelled: true } | { error: string; message?: string | null }>;
  markdownImageBase?: { projectId: string; dir: string };
}
```

- [ ] **Step 4: 抽取实现 `DocViewer.vue`**

- 把 `FilePreview.vue` 的整段 `<script setup>` 与 `<template>`/`<style>` **原样复制**到新文件，然后做机械替换：
  - props 改为 `{ source: DocSource; path: string; name: string; detailToken?: number; detailPath?: string }`。
  - `useProjects()` 的调用改走 `props.source`：`text(...)` → `source.read(path)`；`write(...)` → `source.write(path, content)`；`rawUrl(...)` → `source.rawUrl?.(path)`；`fileMeta/fileHash/reveal/runScript/tree/pickTextFile` → `source.meta?.(path)` / `source.hash?.(path)` / `source.reveal?.(path)` / `source.run?.(path)` / `source.list?.(dir)` / `source.pickExternal?.()`。
  - `format(name, content)`（压缩）保留 `useProjects().format` 直接调用（与来源无关）。
  - `renderMarkdown(raw, { projectId, fileDir })` → 用 `source.markdownImageBase`（存在时传 `{ projectId, fileDir }`，否则传空对象）。
  - 能力缺失时隐藏对应 UI：`canRun` 加 `&& !!source.run`；`canDiff` 的「加载/其他目录」按钮分别按 `source.list`/`source.pickExternal` 显隐；详情按钮/面板按 `source.meta`（无 `meta` 时详情面板只显示 name/type/size）；图片/PDF 分支按 `source.rawUrl` 存在与否。
  - 保留：编辑器挂载、自动保存（`scheduleSave/flush/saveNow`）、Ctrl+S、工具菜单（格式化/压缩/排序/去重/Base64/diff）、状态栏、`detailToken` 自动开详情。
- 组件对外 props 稳定，`<style scoped>` 原样带走。

- [ ] **Step 5: `FilePreview.vue` 变薄**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import DocViewer from './DocViewer.vue';
import { useProjects } from '../useProjects';
import type { DocSource } from '../tools/doc/docSource';

const props = defineProps<{ projectId: string; path: string; name: string; detailToken?: number; detailPath?: string }>();
const api = useProjects();

const source = computed<DocSource>(() => ({
  kind: 'project',
  read: async (p) => { const f = await api.text(props.projectId, p); return { name: f.name || props.name, content: f.content, size: f.size, mtime: f.mtime, abs: f.abs, binary: f.binary }; },
  write: (p, c) => api.write(props.projectId, p, c).then(() => undefined),
  rawUrl: (p) => api.rawUrl(props.projectId, p),
  list: (dir) => api.tree(props.projectId, dir),
  meta: (p) => api.fileMeta(props.projectId, p),
  hash: (p) => api.fileHash(props.projectId, p),
  reveal: (p) => api.reveal(props.projectId, p).then(() => undefined),
  run: (p) => api.runScript(props.projectId, p).then(() => undefined),
  pickExternal: () => api.pickTextFile(),
  markdownImageBase: { projectId: props.projectId, dir: '' },
}));
</script>

<template>
  <DocViewer :source="source" :path="path" :name="name" :detail-token="detailToken" :detail-path="detailPath" />
</template>
```

> `markdownImageBase.dir` 由 `DocViewer` 内部按 `path` 求父目录后再用（把 `fileDirOf(path)` 的结果覆盖 dir）。

- [ ] **Step 6: 回归测试 + 类型检查**

Run: `npm.cmd --prefix web run test -- src/components/FilePreview.test.ts` 与 `npm.cmd run typecheck`
Expected: 回归测试仍 PASS；typecheck 无错误

- [ ] **Step 7: 手工验证（dev）**

打开一个项目文件（md/yaml/js/图片各一个）验证：预览/代码/可视化切换、保存、压缩/排序/去重/Base64/格式化、diff、详情、定位、运行脚本、markdown 图片，均与改动前一致。

- [ ] **Step 8: 提交**

```bash
git add web/src/components/DocViewer.vue web/src/components/FilePreview.vue web/src/tools/doc/docSource.ts web/src/components/FilePreview.test.ts
git commit -m "refactor(preview): 抽出 DocViewer，FilePreview 退化为项目适配层"
```

---

### Task 7: 工具文件数据源（树 + 文档）

**Files:**
- Create: `web/src/tree/toolFileTreeSource.ts`
- Create: `web/src/tools/doc/toolDocSource.ts`
- Test: `web/src/tree/toolFileTreeSource.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/tree/toolFileTreeSource.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { toolFileTreeSource } from './toolFileTreeSource';

afterEach(() => vi.unstubAllGlobals());
function okJson(body: unknown) { return { ok: true, json: async () => body }; }

describe('toolFileTreeSource', () => {
  it('loadChildren 读 /api/files/<tool>/tree 并按目录过滤', async () => {
    const fetchMock = vi.fn(async () => okJson({
      folders: ['sub', 'sub/deep'],
      items: [
        { id: 'a.txt', folder: '', name: 'a.txt' },
        { id: 'sub/b.txt', folder: 'sub', name: 'b.txt' },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const src = toolFileTreeSource({ tool: 'notepad', onOpen: vi.fn(), onChanged: vi.fn() });
    expect(await src.loadChildren('')).toEqual([
      { key: 'sub', name: 'sub', kind: 'dir' },
      { key: 'a.txt', name: 'a.txt', kind: 'item' },
    ]);
    expect(await src.loadChildren('sub')).toEqual([
      { key: 'sub/deep', name: 'deep', kind: 'dir' },
      { key: 'sub/b.txt', name: 'b.txt', kind: 'item' },
    ]);
  });
});
```

- [ ] **Step 2: 运行确认失败** → `npm.cmd --prefix web run test -- src/tree/toolFileTreeSource.test.ts`（FAIL）

- [ ] **Step 3: 实现 `toolFileTreeSource.ts`**

`toolFileTreeSource({ tool, onOpen, onChanged })`：内部持一个 `useToolFiles(tool)` 实例的只读快照——每次 `loadChildren` 先 `await files.load()` 再按 `dirKey` 过滤 `folders`/`items`（直接子级；文件 `kind:'item'`）；`onOpen(node)` 回调通知父级设为活动文件；`createFile/createFolder/rename(node,name)/remove(node)/move(node,dir)` 调 `useToolFiles` 对应方法并在成功后 `onChanged()`（父级据此刷新/保存）。文件夹 key 用其相对路径，文件 key 用 `id`。`copyName/copyPath` 写剪贴板。

- [ ] **Step 4: 实现 `toolDocSource.ts`**

```ts
// web/src/tools/doc/toolDocSource.ts
import type { DocSource } from './docSource';
import type { FileTool } from '../files/useToolFiles';

export function toolDocSource(tool: FileTool): DocSource {
  const base = `/api/files/${tool}`;
  async function jfetch(url: string, opt: RequestInit = {}) {
    const res = await fetch(url, opt);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(j?.error || `HTTP ${res.status}`));
    return j;
  }
  return {
    kind: 'tool',
    async read(id) {
      const j = await jfetch(`${base}/file?id=${encodeURIComponent(id)}`);
      const leaf = id.slice(id.lastIndexOf('/') + 1);
      return { name: leaf, content: typeof j.content === 'string' ? j.content : '', size: Number(j.size) || 0 };
    },
    async write(id, content) {
      await jfetch(`${base}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, content }) });
    },
    // 无 rawUrl / meta / hash / reveal / run / markdownImageBase：DocViewer 自动隐藏相关能力
  };
}
```

- [ ] **Step 5: 运行测试确认通过** → PASS

- [ ] **Step 6: 提交**

```bash
git add web/src/tree/toolFileTreeSource.ts web/src/tree/toolFileTreeSource.test.ts web/src/tools/doc/toolDocSource.ts
git commit -m "feat(tree): 工具文件树/文档数据源适配器"
```

---

### Task 8: 工具工作台共享状态

**Files:**
- Create: `web/src/tools/useToolWorkbench.ts`（模块级按 tool 共享，供左侧树与主区内容共用）
- Test: `web/src/tools/useToolWorkbench.test.ts`

- [ ] **Step 1: 写失败测试**：同一 `tool` 两次调用返回同一实例（`activeId` 共享）；不同 `tool` 相互隔离。

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

模块级 `const cache = new Map<FileTool, Workbench>()`；`useToolWorkbench(tool)` 返回缓存实例。`Workbench` 暴露：`activeId: Ref<string>`、`activeFolder: Ref<string>`、`items`/`folders`（复用 `useToolFiles` 的 refs）、`treeSource: TreeSource`（由 `toolFileTreeSource` 构造，`onOpen` 设 `activeId`）、`docSource: DocSource`（`toolDocSource(tool)`）、`leafName` computed、`title` computed、`reload()`。

- [ ] **Step 4: 运行确认通过** → PASS

- [ ] **Step 5: 提交** `feat(tools): 工具工作台共享状态`

---

### Task 9: `notepad`/`yaml` 主区内容 + 左侧树 + 主区分支

**Files:**
- Create: `web/src/tools/doc/ToolDocPane.vue`（包 `DocViewer`，用共享工作台的 `activeId` + `docSource`）
- Modify: `web/src/components/TerminalView.vue`（活动页签是工具时渲染内容组件）
- Modify: `web/src/App.vue`（左侧 `aside` 按活动页签切换 `TreeView` / `HistoryList`）
- Create: `web/src/components/ToolSidebar.vue`（左侧面板：标题 + `TreeView`，撑满 `aside` 宽度）
- Test: `web/src/components/ToolSidebar.test.ts`

- [ ] **Step 1: `ToolSidebar.vue`**：头部显示 `t(tool 名)`；渲染 `TreeView :source="workbench.treeSource" :active-key="activeId" :active-folder="activeFolder" :storage-key="'devflow-'+tool+'-collapsed'"`；`update:activeFolder` 写回。用 `web/src/tools/catalog.ts` 取 label。

- [ ] **Step 2: `ToolDocPane.vue`**：`const wb = useToolWorkbench(props.tool)`；`<DocViewer v-if="wb.activeId.value" :key="wb.activeId.value" :source="wb.docSource" :path="wb.activeId.value" :name="wb.leafName.value" />`，否则渲染空态 `files.no_file`。

- [ ] **Step 3: `App.vue` 左侧切换**

在 explorer 分支的 `<aside class="side">` 内：
```vue
<ToolSidebar v-if="activeToolTab" :tool="activeToolTab.tool!" />
<HistoryList v-else ... />
```
其中 `const activeToolTab = computed(() => (center.active.value?.kind === 'tool' ? center.active.value : null));`

- [ ] **Step 4: `TerminalView.vue` 主区分支**

`const activeTool = computed(() => (props.center.active.value?.kind === 'tool' ? props.center.active.value : null));`
模板新增（与会话/文件层并列，`v-show` 控制）：
```vue
<div v-show="!!activeTool" class="tool-layer">
  <ToolDocPane v-if="activeTool && (activeTool.tool === 'notepad' || activeTool.tool === 'yaml')" :key="activeTool.tool" :tool="activeTool.tool" />
</div>
```
并让 `isSessionView`/文件层在 `activeTool` 为真时不显示；页签标签：工具页签用 `$t('tools.' + activeTool.tool)`。

- [ ] **Step 5: 测试 + 类型检查**（ToolSidebar 渲染树并联动；typecheck）

- [ ] **Step 6: 提交** `feat(tools): notepad/yaml 主区工具页签与左侧树`

---

### Task 10: 入口分流（磁贴 + 活动栏）

**Files:**
- Modify: `web/src/uiIntents.ts`（新增 `pendingToolTab` 意图）+ `web/src/uiIntents.test.ts`
- Modify: `web/src/App.vue`（监听 `pendingToolTab` → 切 explorer + `center.openTool`）
- Modify: `web/src/components/MiniTools.vue` 的磁贴点击、`web/src/components/WelcomeView.vue` 的 emit 链路
- Modify: `web/src/App.vue` 活动栏（`notepad`/`yaml` 快踏入）

- [ ] **Step 1: 意图单测**：`requestToolTab('yaml')` 置位、`clearPendingToolTab()` 清零。

- [ ] **Step 2: 实现意图**：`export const pendingToolTab = ref<ToolId | null>(null); export function requestToolTab(id: ToolId) { pendingToolTab.value = id; } export function clearPendingToolTab() { pendingToolTab.value = null; }`

- [ ] **Step 3: `MiniTools.vue` 分流**：`notepad`/`yaml` 磁贴点击 → `requestToolTab(id)`；其余工具保持原（本次为弹窗，Phase 3 再改）。

- [ ] **Step 4: `App.vue` 处理**：`watch(pendingToolTab, (id) => { if (!id) return; rail.value = 'explorer'; center.openTool(id); clearPendingToolTab(); }, { immediate: true })`。

- [ ] **Step 5: 活动栏图标**：在 `.activity` 内 `notepad`/`yaml` 各加一个 `a-btn`，点击同上（`rail='explorer'` + `center.openTool(id)`）。

- [ ] **Step 6: 测试 + 手工验证 + 提交** `feat(tools): 小工具入口改为打开主区工具页签`

---

**Phase 2 收尾**：`npm.cmd test` + `typecheck` + `check:i18n` 全绿。

---

# Phase 3：postman / navicat / translate 迁移 + 清理弹窗

**Phase 3 完成标准**：五个工具全部以主区工具页签呈现，左侧统一 `TreeView`，右侧各自内容；`MiniTools.vue` 弹窗与相关链路删除；全量测试/类型/i18n 通过。

---

### Task 11: `translate` 迁移

- 把 `web/src/tools/text/TextToolBody.vue` 改为纯内容组件（去掉 `FileSidebar` 与文件逻辑，输入/输出双栏保留）；左侧由 `ToolSidebar`（tool=`translate`）承接；`ToolDocPane` 不适用，改在 `TerminalView` 工具分支按 `tool` 渲染 `TextToolBody`。
- 测试：`TextToolBody` 现有用例去掉文件树断言后通过；提交 `refactor(translate): 迁移到主区工具页签`。

---

### Task 12: `postman` 迁移

- 新建 `web/src/tools/postman/postmanTreeSource.ts`：实现 `TreeSource`，数据来自 `usePostmanHistory()`；`caps` 含 `run`/`runFolder`/`createFolder`/`createFile`/`rename`/`remove`/`move`/`copyName`/`copyPath`；`status` = 运行结果。`loadChildren` 按文件夹过滤 `history`。
- `PostmanTool.vue` 去掉自带 `<aside class="pmside">` 与 `PostmanTree.vue` 引用，只留右侧请求/响应面板（保留放大浮层）。
- 在 `ToolSidebar` 支持 `postman`：`TreeView :source="postmanTreeSource"`（`showRun` 等价能力由 source 提供）。
- `TerminalView` 工具分支渲染 `PostmanTool`。
- 测试 + 提交 `refactor(postman): 迁移到主区工具页签`。

---

### Task 13: `navicat` 迁移

- 新建 `web/src/tools/navicat/navicatTreeSource.ts`：连接→库→表 懒加载映射为 `TreeSource`（连接=`dir`，库=`dir`，表=`item`）；连接编辑/重命名/删除；点表 `open`。复用现有 `useNavicat` 的 `fetchDatabases/fetchTables`。
- `NavicatTool.vue` 去掉自带左侧树，只留右侧连接/查询面板。
- `ToolSidebar` 支持 `navicat`（用 `navicatTreeSource`）。
- 测试 + 提交 `refactor(navicat): 迁移到主区工具页签`。

---

### Task 14: 清理弹窗链路 + i18n + 文档

- 删除 `web/src/components/MiniTools.vue` 的 `el-dialog` 与工具分支（保留磁贴行，或把磁贴行抽为 `ToolTiles.vue`）；删除 `web/src/tools/dialogActions.ts`、`NotepadTool.vue`（及其测试）、`PostmanTree.vue`、`NavicatTree.vue`、`FileSidebar.vue`（确认无引用后）。
- 更新 `MiniTools.test.ts`（改为磁贴点击 → `requestToolTab`）与其它受影响的工具测试。
- i18n：补齐新增词条（中英对称），跑 `npm.cmd run check:i18n`。
- 更新 `AGENTS.md` 目录速览（新增 `web/src/tree/`、`web/src/tools/doc/`、`ToolView` 说明），若目录速览已写小工具弹窗需同步。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
- 提交 `refactor(tools): 清理小工具弹窗链路并统一主区工具页签`。

---

## Self-Review（写完计划后自查）

- **规格覆盖**：spec 第 4.1（TreeView）→ Task 2/3/7；4.2（壳子/页签）→ Task 5/9；4.3（各工具内容）→ Task 9/11/12/13；4.4（DocViewer）→ Task 6/7；4.5（入口与清理）→ Task 10/14；4.6/4.7 → Task 9/10。
- **占位符**：Task 11-14 为迁移任务，已给出确切文件、操作与提交信息；实现时按既有组件裁剪，不新增「重新开发一套」。
- **类型一致性**：`TreeSource`/`TreeSourceNode`（Task 1）贯穿 Task 2/3/7/8/12/13；`DocSource`（Task 6）贯穿 Task 7/8/9；`CenterTab.kind:'tool'`（Task 5）贯穿 Task 9/10。

## 执行说明（本仓库约定）

- 默认 **inline 执行**（AGENTS.md「计划执行方式」），不用 subagent。
- 每个 Task 走 TDD：先写失败测试 → 跑失败 → 最小实现 → 跑通过 → 提交。
- 每完成一个 Phase 跑一次 `npm.cmd test` + `npm.cmd run typecheck` + `npm.cmd run check:i18n`。
- 提交前执行 `docs/learn/git仓库提交检查和提交事项.md` 清单；只 `git add` 本次文件，不 `git add -A`。
