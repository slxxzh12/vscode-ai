# 文件详细信息（路径/大小/MD5/SHA256）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 devflow 增加文件「详细信息」能力：FilePreview（文本顶栏 / 图片PDF 顶部细条）与 FileTree 左树右键入口，展示绝对路径（可复制）、大小、修改时间，并支持后端流式计算 MD5+SHA256（>50MB 先确认）。

**Architecture:** 后端新增两条只读 GET（`/api/file/meta`、`/api/file/hash`），复用 `Projects` 现有越界/符号链接防护，hash 用 `createReadStream` 单趟双哈希。前端 `useProjects` 加两个封装；`FilePreview.vue` 加详情开关 + 底部面板（image/pdf 补顶部细条 + `.media` 容器）；`FileTree` 右键菜单加「详细信息」并 `emit('detail-file')`，`App` 通过 `detailToken/detailPath` 两 prop 经 `TerminalView` 传到 `FilePreview`，使打开文件后自动展开详情。

**Tech Stack:** Node ESM（`node:fs`/`node:crypto`/`node:http`）、Vue3 `<script setup lang="ts">`。Windows + `npm.cmd`（`npm run test` / `npm run typecheck` 对应 `npm.cmd run test` / `npm.cmd run typecheck`）。

**Spec:** `docs/superpowers/specs/2026-09-09-file-detail-hash-design.md`

**计划偏差说明：** 除 spec 外，本计划确定 `Projects.hash()`/`Projects.meta()` 都复用 `revealTarget()`（它已做存在性/越界/符号链接校验并返回 realpath）；hash 目录以 `not-file`（HTTP 400）拒绝；App→FilePreview 的「打开并展开详情」用 `detailToken`（自增数字）+ `detailPath`（目标相对路径）双 prop 传递，FilePreview 仅在 `detailPath === props.path` 且 token 变化时自动展开。

---

### Task 1: server —— `/api/file/meta`（TDD）

**Files:**
- Modify: `server/projects.js`
- Modify: `server/http-api.js`
- Test: `server/test/http-api.test.js`

- [ ] **Step 1: 先写测试**

在 `server/test/http-api.test.js` 末尾（`/api/format 非法 JSON…` 之后）追加：

```js
test('/api/file/meta 返回文件字段（含绝对路径）', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'm.txt'), 'hello');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file/meta?project=a&path=m.txt');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.name, 'm.txt');
  assert.equal(j.path, 'm.txt');
  assert.equal(j.size, 5);
  assert.equal(typeof j.mtime, 'number');
  assert.equal(j.isDir, false);
  assert.equal(path.resolve(j.abs), path.join(dir, 'm.txt'));
});

test('/api/file/meta 目录也返回（size 为目录 stat）', async (t) => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'sub'));
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file/meta?project=a&path=sub');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.name, 'sub');
  assert.equal(j.isDir, true);
  assert.equal(typeof j.size, 'number');
});

test('/api/file/meta 越界 403、不存在 404', async (t) => {
  const dir = tmpDir();
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const esc = await request(server, '/api/file/meta?project=a&path=..%2F..%2F..');
  assert.equal(esc.status, 403);
  const miss = await request(server, '/api/file/meta?project=a&path=nope.txt');
  assert.equal(miss.status, 404);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/http-api.test.js`
Expected: FAIL —— `/api/file/meta` 全部返回 404（路由尚未注册，走文件末尾的兜底 404）。

- [ ] **Step 3: 在 `Projects` 增加 `meta()`**

在 `server/projects.js` 的 `revealTarget(...)` 方法之后追加：

```js
  // 供详细信息用：解析到项目内已存在路径（文件或目录均可），返回 stat 概要，不读内容
  meta(projectId, rel) {
    const { abs, name, isDir } = this.revealTarget(projectId, rel);
    const st = fs.statSync(abs);
    return { name, path: rel, abs, size: st.size, mtime: st.mtimeMs, isDir };
  }
```

- [ ] **Step 4: 注册路由**

在 `server/http-api.js` 中，`/api/file POST` 分支（`create`/`content` 处理）之后、`/api/format` 之前插入：

```js
      if (url.pathname === '/api/file/meta' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        sendJson(res, 200, projects.meta(project, rel));
        return;
      }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test server/test/http-api.test.js`
Expected: PASS（3 个新 meta 用例 + 既有全部通过）。

- [ ] **Step 6: Commit**

```bash
git add server/projects.js server/http-api.js server/test/http-api.test.js
git commit -m "feat(server): /api/file/meta 返回文件/目录 stat 概要（绝对路径/大小/时间）"
```

---

### Task 2: server —— `/api/file/hash`（TDD）

**Files:**
- Modify: `server/projects.js`
- Modify: `server/http-api.js`
- Test: `server/test/http-api.test.js`

- [ ] **Step 1: 先写测试**

`server/test/http-api.test.js` 顶部 `import path from 'node:path';` 之后加 `import crypto from 'node:crypto';`。末尾追加：

```js
test('/api/file/hash 返回 md5+sha256（大文件跨块一致）', async (t) => {
  const dir = tmpDir();
  const buf = Buffer.alloc(300 * 1024);        // 跨 64KB 块边界
  for (let i = 0; i < buf.length; i++) buf[i] = i % 251;
  fs.writeFileSync(path.join(dir, 'big.bin'), buf);
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file/hash?project=a&path=big.bin');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.md5, crypto.createHash('md5').update(buf).digest('hex'));
  assert.equal(j.sha256, crypto.createHash('sha256').update(buf).digest('hex'));
});

test('/api/file/hash 目录返回 400；不存在 404；越界 403', async (t) => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'sub'));
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const d = await request(server, '/api/file/hash?project=a&path=sub');
  assert.equal(d.status, 400);
  const miss = await request(server, '/api/file/hash?project=a&path=nope.bin');
  assert.equal(miss.status, 404);
  const esc = await request(server, '/api/file/hash?project=a&path=..%2F..%2F..');
  assert.equal(esc.status, 403);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/http-api.test.js`
Expected: FAIL —— hash 路由未注册，返回 404。

- [ ] **Step 3: `Projects` 增加 `hash()` 并 import crypto**

`server/projects.js` 顶部 `import path from 'node:path';` 之后加 `import crypto from 'node:crypto';`。`meta()` 之后追加：

```js
  // 单趟流式计算 MD5+SHA256（仅文件；目录抛 not-file）
  hash(projectId, rel) {
    const { abs, isDir } = this.revealTarget(projectId, rel);
    if (isDir) { const e = new Error('is a directory'); e.code = 'not-file'; throw e; }
    const md5 = crypto.createHash('md5');
    const sha = crypto.createHash('sha256');
    return new Promise((resolve, reject) => {
      const s = fs.createReadStream(abs, { highWaterMark: 64 * 1024 });
      s.on('data', (c) => { md5.update(c); sha.update(c); });
      s.on('error', (err) => { const e = new Error(`read failed: ${err.message}`); e.code = 'internal'; reject(e); });
      s.on('end', () => resolve({ md5: md5.digest('hex'), sha256: sha.digest('hex') }));
    });
  }
```

- [ ] **Step 4: 注册路由**

`server/http-api.js` 中 `/api/file/meta` 分支之后插入：

```js
      if (url.pathname === '/api/file/hash' && req.method === 'GET') {
        const project = url.searchParams.get('project');
        const rel = url.searchParams.get('path') || '';
        sendJson(res, 200, await projects.hash(project, rel));
        return;
      }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test server/test/http-api.test.js`
Expected: PASS（2 个新 hash 用例 + 全部通过）。

- [ ] **Step 6: Commit**

```bash
git add server/projects.js server/http-api.js server/test/http-api.test.js
git commit -m "feat(server): /api/file/hash 单趟流式计算 MD5+SHA256"
```

---

### Task 3: web —— `useProjects` 封装

**Files:**
- Modify: `web/src/useProjects.ts`

- [ ] **Step 1: 新增类型与方法**

`web/src/useProjects.ts` 中 `export interface FileText` 之后新增：

```ts
export interface FileMeta { name: string; path: string; abs: string; size: number; mtime: number; isDir: boolean; }
export interface FileHashes { md5: string; sha256: string; }
```

在 `rawUrl(...)` 之前加入两个方法：

```ts
    async fileMeta(project: string, rel: string): Promise<FileMeta> {
      return get<FileMeta>(`/api/file/meta?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`);
    },
    async fileHash(project: string, rel: string): Promise<FileHashes> {
      return get<FileHashes>(`/api/file/hash?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`);
    },
```

- [ ] **Step 2: typecheck**

Run: `npm.cmd run typecheck`
Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add web/src/useProjects.ts
git commit -m "feat(web): useProjects 封装 fileMeta/fileHash"
```

---

### Task 4: web —— FilePreview 详情面板（文本顶栏按钮 + 面板 + hash 逻辑）

**Files:**
- Modify: `web/src/components/FilePreview.vue`

- [ ] **Step 1: script —— props 与解构**

`const props = defineProps<{ projectId: string; path: string; name: string }>();` 替换为：

```ts
const props = defineProps<{ projectId: string; path: string; name: string; detailToken?: number; detailPath?: string }>();
const { text, write, rawUrl, format, runScript, fileMeta, fileHash } = useProjects();
```

（解构自 `useProjects()` 的原行相应删除 `fileMeta/fileHash` 之外不变；若原行未解构 fileMeta/fileHash，加入即可。）

- [ ] **Step 2: script —— 详情状态与逻辑**

在 Base64 区块（`resetB64Panel` 函数）之后追加：

```ts
// —— 文件详细信息 ——
const HASH_WARN = 50 * 1024 * 1024;
const detailOpen = ref(false);
const detail = ref<FileMeta | null>(null);
const detailErr = ref('');
const hashing = ref(false);
const hashMd5 = ref('');
const hashSha256 = ref('');
const hashErr = ref('');
const kindLabel = computed(() => ({ image: '图片', pdf: 'PDF', text: '文本' })[kind.value] || '文件');
let seenDetail = -1;
async function openDetail() {
  detailErr.value = '';
  detail.value = null;
  hashMd5.value = '';
  hashSha256.value = '';
  hashErr.value = '';
  try {
    detail.value = await fileMeta(props.projectId, props.path);
  } catch (e: any) {
    detailErr.value = String(e?.message || e);
  }
}
function toggleDetail(force?: boolean) {
  detailOpen.value = force ?? !detailOpen.value;
  if (detailOpen.value && status.value === 'ok') openDetail();
}
async function computeHash() {
  if (!detail.value || hashing.value) return;
  if (detail.value.size > HASH_WARN) {
    const ok = window.confirm(`文件较大（${fmtBytes(detail.value.size)}），计算 MD5/SHA256 可能需要一段时间，是否继续？`);
    if (!ok) return;
  }
  hashing.value = true;
  hashErr.value = '';
  try {
    const h = await fileHash(props.projectId, props.path);
    hashMd5.value = h.md5;
    hashSha256.value = h.sha256;
  } catch (e: any) {
    hashErr.value = `计算失败：${e?.message || e}`;
  } finally {
    hashing.value = false;
  }
}
watch(() => props.detailToken, (tk) => {
  if (tk && tk !== seenDetail && props.detailPath === props.path) {
    seenDetail = tk;
    if (!detailOpen.value) toggleDetail(true);
  }
}, { immediate: true });
```

`FileMeta` 需 import：把 `import { useProjects } from '../useProjects';` 改为 `import { useProjects, type FileMeta } from '../useProjects';`。

- [ ] **Step 3: script —— `load()` 重置详情**

`load()` 函数体开头 `resetB64Panel();` 之后追加 `closeDetail();`。并定义：

```ts
function closeDetail() {
  detailOpen.value = false;
  detail.value = null;
  detailErr.value = '';
  hashMd5.value = '';
  hashSha256.value = '';
  hashErr.value = '';
}
```

- [ ] **Step 4: template —— 文本文件顶栏加按钮**

Base64 开关按钮（`⇆ Base64`）之后追加：

```html
          <button v-if="status === 'ok'" class="fmt-btn" :class="{ on: detailOpen }" title="文件详细信息" @click="toggleDetail()">ⓘ 详细信息</button>
```

- [ ] **Step 5: template —— 详情面板（文本分支编辑器之后）**

编辑器 `ref="editorHost" class="editor"` 之后、Base64 面板之前插入：

```html
        <div v-if="detailOpen" class="detailpanel">
          <div class="dph">
            <span class="dpt">文件详细信息</span>
            <button class="cpx" @click="toggleDetail()">×</button>
          </div>
          <div v-if="detailErr" class="note err">{{ detailErr }}</div>
          <div v-else-if="detail" class="dbody">
            <div class="drow"><span class="dk">名称</span><span class="dv" :title="detail.name">{{ detail.name }}</span></div>
            <div class="drow"><span class="dk">类型</span><span class="dv">{{ kindLabel }}</span></div>
            <div class="drow">
              <span class="dk">绝对路径</span>
              <span class="dv mono" :title="detail.abs">{{ detail.abs }}</span>
              <button class="b64b" :disabled="!detail.abs" @click="b64Copy(detail.abs)">复制</button>
            </div>
            <div class="drow"><span class="dk">大小</span><span class="dv mono">{{ fmtBytes(detail.size) }}</span></div>
            <div class="drow"><span class="dk">修改时间</span><span class="dv mono">{{ fmtMtime(detail.mtime) }}</span></div>
            <div class="drow">
              <span class="dk">MD5</span>
              <span class="dv mono" :class="{ warn: hashErr }">{{ hashMd5 || hashErr || '—' }}</span>
              <button class="b64b" :disabled="!hashMd5" @click="b64Copy(hashMd5)">复制</button>
            </div>
            <div class="drow">
              <span class="dk">SHA256</span>
              <span class="dv mono" :class="{ warn: hashErr }">{{ hashSha256 || hashErr || '—' }}</span>
              <button class="b64b" :disabled="!hashSha256" @click="b64Copy(hashSha256)">复制</button>
            </div>
            <div class="drow">
              <span class="dk" />
              <button class="b64b hashgo" :disabled="hashing || !!(hashMd5 && hashSha256)" @click="computeHash">
                {{ hashing ? '计算中…' : hashMd5 ? '已计算' : '计算 MD5+SHA256' }}
              </button>
            </div>
          </div>
        </div>
```

- [ ] **Step 6: styles —— 详情面板样式**

`<style scoped>` 末尾追加：

```css
.detailpanel { flex: none; border-top: 1px solid var(--bd); background: var(--bg2); display: flex; flex-direction: column; max-height: 260px; }
.dph { display: flex; align-items: center; justify-content: space-between; padding: 4px 12px; background: var(--bg4); flex: none; }
.dpt { font-size: 11px; font-weight: 600; color: var(--tx1); }
.dbody { overflow: auto; padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 6px; }
.drow { display: flex; align-items: center; gap: 8px; font-size: 12px; min-height: 20px; }
.dk { color: var(--tx3); flex: none; width: 66px; text-align: right; }
.dv { color: var(--tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.dv.mono { font-family: ui-monospace, Consolas, monospace; }
.dv.warn { color: var(--err); }
.hashgo { flex: none; }
```

- [ ] **Step 7: 验证**

Run: `npm.cmd run typecheck`
Expected: 退出码 0。若报 `FileMeta` 未导出/未找到，确认 Step 2 的 import 已加。

- [ ] **Step 8: Commit**

```bash
git add web/src/components/FilePreview.vue web/src/useProjects.ts
git commit -m "feat(preview): 文件详细信息面板（绝对路径/大小/时间/MD5/SHA256 实时计算）"
```

---

### Task 5: web —— image/PDF 顶部细条 + `.media` 布局

**Files:**
- Modify: `web/src/components/FilePreview.vue`

- [ ] **Step 1: template —— image/pdf 分支重构**

把模板开头的：

```html
    <img v-if="kind === 'image'" :src="rawUrl(projectId, path)" class="img" alt="" />
    <iframe v-else-if="kind === 'pdf'" :src="rawUrl(projectId, path)" class="pdf" />
```

替换为：

```html
    <div v-if="kind === 'image' || kind === 'pdf'" class="head mediahead">
      <span class="meta">{{ name }}<template v-if="status === 'ok'"> · {{ (size / 1024).toFixed(1) }} KB</template></span>
      <div class="right">
        <button class="fmt-btn" :class="{ on: detailOpen }" title="文件详细信息" @click="toggleDetail()">ⓘ 详细信息</button>
      </div>
    </div>
    <div v-if="kind === 'image' || kind === 'pdf'" class="media">
      <img v-if="kind === 'image'" :src="rawUrl(projectId, path)" class="img" alt="" />
      <iframe v-else-if="kind === 'pdf'" :src="rawUrl(projectId, path)" class="pdf" />
    </div>
```

- [ ] **Step 2: template —— 文本分支外再渲染详情面板（供 image/pdf 使用）**

把 Task 4 Step 5 插入的那块 `.detailpanel` 从「文本分支内部」移出，放到 `</template>`（文本 else 分支）之后、`</div>`（`.preview`）之前，即成为 `.preview` 直接子元素——这样 image/pdf 与文本共用同一个面板。若 Task 4 已插入在编辑器/Base64 面板附近，将其整体上移至 else 分支闭合后。

- [ ] **Step 3: styles —— media 容器与细条**

`<style scoped>` 中 `.pdf`/`.img` 规则调整，并追加：

```css
.media { flex: 1; min-height: 0; overflow: hidden; display: flex; }
.media .img { max-width: 100%; max-height: 100%; object-fit: contain; margin: auto; }
.media .pdf { width: 100%; height: 100%; border: none; background: #fff; display: block; }
```

原 `.img { max-width:100%; max-height:100%; object-fit:contain; margin:auto; }` 与 `.pdf { width:100%; height:100%; … }` 顶层规则可删除（被 `.media .img` / `.media .pdf` 取代）。`.mediahead` 复用 `.head` 样式（`flex:none`），无需新增规则。

- [ ] **Step 4: 验证**

Run: `npm.cmd run typecheck` && `npm.cmd run build:web`
Expected: 两者退出码 0。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "feat(preview): 图片/PDF 顶部细条 + 详情面板通用化"
```

---

### Task 6: web —— FileTree 右键 + App/TerminalView 联动

**Files:**
- Modify: `web/src/components/FileTree.vue`
- Modify: `web/src/App.vue`
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: FileTree 右键菜单加「详细信息」**

`web/src/components/FileTree.vue`：
- `defineEmits` 增加 `(e: 'detail-file', projectId: string, path: string, name: string): void`。
- script 增加函数（放 `copyContent` 之后）：

```ts
function detailFile() {
  const m = menu.value;
  if (!m || !props.projectId || m.type !== 'file') return;
  const name = m.name;
  closeMenu();
  emit('detail-file', props.projectId, m.path, name);
}
```

- 右键菜单模板在 `复制文件内容` 按钮之后追加：

```html
      <button @click="detailFile">ⓘ 详细信息</button>
```

（父组件 `TreeNode.vue` 已把 ctx 逐层冒泡，无需改动。）

- [ ] **Step 2: App.vue —— detailToken/detailPath + 处理器**

script 中 `const showWf = ref(false);` 后加：

```ts
const detailToken = ref(0);
const detailPath = ref('');
function onDetailFile(projectId: string, path: string) {
  const q = path.replace(/\\/g, '/');
  const i = q.lastIndexOf('/');
  const name = i >= 0 ? q.slice(i + 1) : q;
  center.openFile(projectId, path, name);
  detailPath.value = q;
  detailToken.value++;
}
```

`FileTree` 模板改为传两个 handler：

```html
          <FileTree v-else :project-id="currentProject" :active-path="activeFilePath" @open-file="openFile" @detail-file="onDetailFile" />
```

`TerminalView` 传参追加：

```html
          <TerminalView :terminal="terminal" :center="center" :project-id="currentProject" :detail-token="detailToken" :detail-path="detailPath" />
```

- [ ] **Step 3: TerminalView.vue 透传**

`props` 定义替换为：

```ts
const props = defineProps<{
  terminal: ReturnType<typeof useTerminal>;
  center: ReturnType<typeof useCenter>;
  projectId: string | null;
  detailToken?: number;
  detailPath?: string;
}>();
```

`FilePreview` 标签追加两个 prop：

```html
      <FilePreview v-if="activeFile && activeFile.projectId && activeFile.path"
        :key="activeFile.id" :project-id="activeFile.projectId" :path="activeFile.path" :name="activeFile.label"
        :detail-token="detailToken" :detail-path="detailPath" />
```

- [ ] **Step 4: 验证**

Run: `npm.cmd run typecheck` && `npm.cmd test`
Expected: typecheck 退出码 0；`npm.cmd test`（server + web）全部通过。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FileTree.vue web/src/App.vue web/src/components/TerminalView.vue
git commit -m "feat(tree): 右键详细信息 → 打开文件并展开详情面板"
```

---

### Task 7: 生产构建 + 手动验证要点

**Files:** 无（运行验证）

- [ ] **Step 1: 构建**

Run: `npm.cmd run build:web`
Expected: 退出码 0。

- [ ] **Step 2: 手动验证用例（dev 模式，两终端分别跑 `npm.cmd run dev:server` 与 `npm.cmd run dev:web`）**

1. 打开文本文件 → 顶栏 `ⓘ 详细信息` → 下方面板显示名称/类型/绝对路径/大小/修改时间；「复制」可复制绝对路径。
2. 点「计算 MD5+SHA256」→ 出现两行哈希（32/64 hex）；与控制台 `certutil -hashfile <abs> MD5` / `SHA256` 一致。
3. 打开一个 >50MB 的文件（或用小文件把 `HASH_WARN` 临时调低自测）→ 触发 confirm 提示。
4. 打开图片与 PDF → 顶部出现细条 + `ⓘ 详细信息`，预览图不受挤压。
5. 左树对文件右键 → 「ⓘ 详细信息」→ 文件在右侧打开并自动展开详情面板；对目录右键 → 无此项。
6. 切换文件 → 详情自动关闭（`load()` 重置）；MD5/SHA256 面板内可复制。
7. 超大文本（>1MB 打开失败）→ 详情仍可通过左树入口查看 meta 与 hash。

---

## Self-Review

**Spec 覆盖：**
- meta / hash 两接口及越界/不存在/目录错误 → Task 1、Task 2 ✔
- meta 目录放行、hash 目录拒绝 → Task 1 Step 1 / Task 2 Step 1 用例 ✔
- useProjects 封装 → Task 3 ✔
- FilePreview 详情面板 + hash 计算 + >50MB confirm → Task 4 ✔
- image/pdf 入口与布局 → Task 5 ✔
- 左树右键联动、目录不显示项 → Task 6 ✔
- 手动验证 / 构建 → Task 7 ✔

**Placeholder 扫描：** 每步含完整代码与命令；无 TBD/待补。

**类型一致性：** `detailOpen/detail/value/detailErr/hashing/hashMd5/hashSha256/hashErr/kindLabel/seenDetail`、`openDetail/toggleDetail/computeHash/closeDetail` 命名在 Task 4 定义并被 Task 4/5/6 模板一致引用；`FileMeta`/`FileHashes` 在 Task 3 定义、Task 4 import；props `detailToken/detailPath` 由 App（Task 6 Step 2）→ TerminalView（Step 3）→ FilePreview（Task 4 Step 1 声明）贯通，命名一致。`fmtBytes/fmtMtime/b64Copy` 均为 FilePreview 既有函数。

**已知取舍：** `.detailpanel` 是 `.preview` 直接子元素（文本/图片/PDF 共用），与 Base64 面板并存时纵向叠放，总高度受编辑器区 flex 自然压缩，已记录于 spec 交互细节。
