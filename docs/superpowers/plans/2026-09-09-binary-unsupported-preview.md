# 二进制文件 →「不支持预览」提示页 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** exe/zip/dll 等二进制文件在 FilePreview 中打开时，由后端探测出二进制性质并返回标识，前端渲染「不支持预览」提示页（含可点击绝对路径 → 系统资源管理器定位高亮文件），替代现有 413/乱码。

**Architecture:** 后端 `Projects.readText` 先读前 64KB 探测 `0x00` → 命中则返回 `binary:true`（不给 content，也不再抛 too-large）；无 NUL 走原逻辑。`/api/file` 路由透传无需改。前端 `FilePreview.vue` 新增 `isBinary` ref；`load()` 命中 binary 不挂编辑器；模板在 status-ok 分支按 `isBinary` 分叉渲染提示面板；`canB64`/`canSort`/格式化等仅文本工具在 binary 时隐藏，ⓘ 详细信息保留。reveal 失败错误写入底部状态栏。

**Tech Stack:** Node ESM + `node:test`（server TDD）、Vue 3 `<script setup>` + CodeMirror 6、无新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-09-binary-unsupported-preview-design.md`

---

### Task 1: 后端 readText 二进制探测（TDD）

**Files:**
- Modify: `server/projects.js:96-101`
- Test: `server/test/http-api.test.js`

- [ ] **Step 1: 写失败的 API 测试（4 个用例）**

在 `http-api.test.js` 的 `/api/file 读取文本` 测试之后追加：

```js
test('/api/file 含 NUL 的二进制文件返回 binary:true 且无 content', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.exe'), Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]));
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file?project=a&path=a.exe');
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.binary, true);
  assert.equal('content' in body, false);
});

test('/api/file 普通 UTF-8 文本返回 binary:false + content', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello world');
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file?project=a&path=a.txt');
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.binary, false);
  assert.equal(body.content, 'hello world');
});

test('/api/file 超 1MB 且首 64KB 含 NUL 返回 binary 而非 413', async (t) => {
  const dir = tmpDir();
  const head = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), Buffer.alloc(1024, 0x61)]);
  const big = Buffer.concat([head, Buffer.alloc(1024 * 1024 + 512, 0x62)]);   // > 1MB
  fs.writeFileSync(path.join(dir, 'big.bin'), big);
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file?project=a&path=big.bin');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).binary, true);
});

test('/api/file 超 1MB 纯文本（前 64KB 无 NUL）仍返回 413', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'big.txt'), Buffer.alloc(1024 * 1024 + 64, 0x61));   // 'a' 无 NUL
  const server = await start(new Projects({ projects: [{ id: 'a', name: 'A', root: dir }] }));
  t.after(() => server.close());
  const r = await request(server, '/api/file?project=a&path=big.txt');
  assert.equal(r.status, 413);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/http-api.test.js`
Expected: 前 3 个新用例 FAIL（binary 未定义 / content 存在断言不满足 / 413 而非 200）；第 4 个可能 PASS（现状 413）。

- [ ] **Step 3: 实现 readText 探测**

将 `server/projects.js` 的 `readText` 替换为：

```js
  readText(projectId, rel, maxBytes = 1024 * 1024) {
    const file = this._filePath(projectId, rel);
    const st = fs.statSync(file);
    const size = st.size;
    const base = { name: path.basename(file), path: rel, size, mtime: st.mtimeMs, abs: file };
    // 二进制探测：读文件前 64KB，含 NUL 即视为二进制（不读全文，大文件不再 413）
    if (size > 0) {
      const probeLen = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(probeLen);
      const fd = fs.openSync(file, 'r');
      try {
        fs.readSync(fd, buf, 0, probeLen, 0);
        if (buf.includes(0)) return { ...base, binary: true };
      } finally {
        fs.closeSync(fd);
      }
    }
    if (size > maxBytes) { const e = new Error('file too large'); e.code = 'too-large'; throw e; }
    return { ...base, binary: false, content: fs.readFileSync(file, 'utf8') };
  }
```

`server/http-api.js` 的 `/api/file` GET 路由透传 `readText` 返回值，**无需改动**。

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/http-api.test.js`
Expected: 全部 PASS（含 4 个新用例 + 既有 `/api/file 读取文本` 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/projects.js server/test/http-api.test.js
git commit -m "feat(server): /api/file 前64KB探测二进制，返回 binary 标识而非 413/乱码"
```

---

### Task 2: 前端新增 isBinary 状态并在 load 分支

**Files:**
- Modify: `web/src/components/FilePreview.vue`

- [ ] **Step 1: 新增 ref 与 reveal 错误处理**

在 script 区「底部常驻状态栏」注释块下方新增：

```ts
// —— 二进制文件：不支持网页预览 ——
const isBinary = ref(false);
async function revealInExplorer() {
  try {
    await reveal(props.projectId, props.path);
    setToolMsg('✓ 已在系统资源管理器中定位该文件');
  } catch (e: any) {
    setToolMsg(`无法在系统资源管理器中打开：${e?.message || e}`, false);
  }
}
```

同时将 destructure 行（现第 35 行附近）改为包含 `reveal`：

```ts
const { text, write, rawUrl, format, runScript, fileMeta, fileHash, reveal } = useProjects();
```

- [ ] **Step 2: load() 命中 binary 分支**

将 `load()` 替换为：

```ts
async function load() {
  toolMsg.value = '';
  isBinary.value = false;
  resetB64Panel();
  closeDetail();
  status.value = 'loading';
  errMsg.value = '';
  try {
    const f = await text(props.projectId, props.path);
    size.value = f.size;
    fileAbs.value = f.abs || '';
    fileMtime.value = f.mtime || 0;
    status.value = 'ok';
    if ((f as any).binary === true) {
      isBinary.value = true;
      return;
    }
    raw.value = f.content;
    if (kind.value === 'text' && showEditor.value) {
      await nextTick();
      mountEditor(f.content);
      requestMeasure();
    }
  } catch (e: any) {
    status.value = 'error';
    errMsg.value = String(e?.message || e);
  }
}
```

`FileText` 类型来自 `useProjects`；若 TS 报 `binary` 不存在，在 `useProjects.ts` 的 `FileText` 接口补字段（见 Step 3）后移除 `as any`。

- [ ] **Step 3: 扩展 FileText 类型**

`web/src/useProjects.ts`：

```ts
export interface FileText { name: string; path: string; size: number; content: string; mtime?: number; abs?: string; binary?: boolean; }
```

- [ ] **Step 4: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无错误退出。

- [ ] **Step 5: Commit**

```bash
git add web/src/useProjects.ts web/src/components/FilePreview.vue
git commit -m "feat(preview): 识别后端 binary 标识，二进制文件不挂编辑器"
```

---

### Task 3: 提示面板模板 + 工具按钮收窄 + 样式

**Files:**
- Modify: `web/src/components/FilePreview.vue`

- [ ] **Step 1: 隐藏仅文本工具按钮（canB64/canSort 排除二进制）**

将 `canB64` 与 `canSort` 的 computed 改为：

```ts
const canSort = computed(() => kind.value === 'text' && status.value === 'ok' && showEditor.value && !isBinary.value);
const canB64 = computed(() => kind.value === 'text' && status.value === 'ok' && showEditor.value && !isBinary.value);
```

（`canFormat`/`canMinify` 依赖扩展名，二进制扩展名天然不命中；`canCurl` 需内容含 curl，二进制无 content 天然 false；运行按钮 `canRun` 依赖 `bat/cmd/ps1/sh`，不受影响，但这些是文本脚本不会被判二进制。）

- [ ] **Step 2: status-ok 分支按 isBinary 分叉渲染提示面板**

将（606 行起）`<template v-else>` 内容整体包一层：在 `.editor` div 之后、`b64panel` 之前插入二进制提示区，并将 preview/editor/b64/curl 区域用 `v-if="!isBinary"` 包裹。即把：

```html
      <template v-else>
        <div v-show="viewMode === 'preview'" class="pane">
```

之前插入：

```html
      <template v-else>
        <div v-if="isBinary" class="binwrap">
          <div class="binic">🚫</div>
          <div class="bintxt">此文件为二进制格式，不支持网页预览</div>
          <div class="binpath mono" :title="fileAbs" @click="revealInExplorer()">{{ fileAbs }}</div>
          <button class="fmt-btn binbtn" @click="revealInExplorer()">📂 在资源管理器中定位</button>
        </div>
        <template v-else>
        <div v-show="viewMode === 'preview'" class="pane">
```

并在该 `</template>`（现 656 行 `<template v-else>` 的闭合 `</template>`，位于 `curlpanel` div 之后）改为闭合两层：先补 `</template>` 关内层，原 `</template>` 关外层。

结构核对：原模板为
`<template v-else>`(606, status ok) → ... preview pane / editor / b64panel / curlpanel → `</template>`(655) → `</template>`(656, 文本 kind 分支) 。
Step 2 操作后为：
`<template v-else>`(606) → `binwrap`(v-if isBinary) → `<template v-else>`(新增内层) → 原内容 → `</template>`(内层闭合) → `</template>`(655 原闭合) → `</template>`(656)。

- [ ] **Step 3: 追加提示面板样式**

`<style scoped>` 末尾追加：

```css
.binwrap { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 20px; }
.binic { font-size: 42px; line-height: 1; opacity: .5; }
.bintxt { color: var(--tx3); font-size: 13px; }
.binpath { color: var(--ac2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; text-decoration: underline dotted; }
.binpath:hover { color: var(--ac); }
.binbtn { padding: 4px 14px; font-size: 12px; }
```

- [ ] **Step 4: typecheck + build**

Run: `npm.cmd run typecheck`
Expected: 无错误退出。
Run: `npm.cmd run build:web`
Expected: `vue-tsc --noEmit && vite build` 成功。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FilePreview.vue
git commit -m "feat(preview): 二进制文件显示不支持预览提示页（路径可点击定位 + 资源管理器按钮）"
```

---

### Task 4: 全量验证 + 手动清单

**Files:** 无改动

- [ ] **Step 1: 全部测试**

Run: `npm.cmd test`
Expected: server + web 全绿。

- [ ] **Step 2: 手动验证（dev:server 需重启后端使 projects.js 生效；浏览器强刷）**

1. 在项目根放一个含二进制内容的文件（或直接打开任意 .exe/.zip/.dll，如系统自带或仓库内 zip）。
2. 左侧双击该文件 → 中央显示「🚫 此文件为二进制格式，不支持网页预览」，非乱码、非 413。
3. 提示页显示绝对路径；点击路径或用「📂 在资源管理器中定位」→ 宿主资源管理器弹出并高亮该文件。
4. ⓘ 详细信息仍可打开（绝对路径/大小），计算 MD5+SHA256 正常。
5. 返回打开普通 .txt → 编辑器正常；顶栏无残留二进制态。
6. 底部状态栏在二进制文件上仍贴底显示。
7. reveal 不可用时（非本机/平台不支持）错误进底部状态栏而非 alert。

- [ ] **Step 3: Commit（如有验证期修正一并提交）**

---

### Task 5: 连同状态栏改造一起同步远端（master）与 devflow

**Files:** 无（git 操作，在 `D:\root\devflow_statistic\statistic_devflow` 执行）

- [ ] **Step 1: 推送本地 HEAD 到远端 master**

Run: `git push "https://wglj:gycgxscdsq0_@gitee.com/wglj/devflow.git" HEAD:master`
Expected: `old..new HEAD -> master`。

- [ ] **Step 2: devflow 拉取**

Run: `git -C "D:\root\devflow\devflow" pull origin master`
Expected: fast-forward（注意：后端 `projects.js`/`http-api.js` 变更需重启 devflow 的 server 进程 :3001 才生效）。

- [ ] **Step 3: 确认一致**

Run: `git -C "D:\root\devflow\devflow" rev-parse HEAD origin/master`
Expected: 输出一致。

- [ ] **Step 4: 告知用户重启 devflow server（PID 9656 对应 :3001）并强刷 :5173 验证两项改动**
