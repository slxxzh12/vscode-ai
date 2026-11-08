# Markdown Viewer 核心包迁移 Implementation Plan（Plan 1/3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `shared/markdown-*` 迁入 `packages/markdown-viewer` 的框架无关 core，并保持现有 Web / 服务端静态页行为不变。

**Architecture:** 新增 npm workspace 包 `@devflow/markdown-viewer`，源码直接以 ESM JS + d.ts 形式提供（Vite / esbuild 均可消费）；`shared/markdown-*` 改为薄 shim 重新导出包内实现，因此本仓库现有 import 无需改动即可验证迁移正确。Vue 适配、构建产物、静态页切换、TS 化放在 Plan 2/3。

**Tech Stack:** Node ESM、npm workspaces、现有 `esbuild`、Vitest、Vite。

**计划拆分：**

- Plan 1（本文件）：包骨架 + core 源码迁移 + 兼容 shim + 打包/自检路径。
- Plan 2：Vue 组件、ElTable 渲染器、i18n、样式、Vite 库构建、standalone 入口。
- Plan 3：Web/静态页迁移、`/_mdv/*` 路由、打包脚本与文档收尾。

---

## 文件结构

```
packages/markdown-viewer/
  package.json                 # 包名、exports、依赖
  src/
    index.js                   # 安全根出口（不含 X6，Node 可直接 import）
    index.d.ts
    core/
      markdown.js / .d.ts
      markdown-client.js / .d.ts
      markdown-charts.js / .d.ts
      markdown-css.js / .d.ts
      markdown-flowchart.js
      markdown-flowchart-editor.js / .d.ts
      markdown-flowchart-graph.js / .d.ts
      markdown-flowchart-model.js / .d.ts
      markdown-flowchart-x6.js / .d.ts
      markdown-ppt.js / .d.ts
      markdown-ppt-export.js / .d.ts
      markdown-slides.js / .d.ts
      markdown-table-sort.js / .d.ts
shared/
  markdown*.js / .d.ts         # 全部改成 `export * from '@devflow/markdown-viewer/core/...'`
  markdown.css / markdown-ppt.css  # 本计划暂不迁移
```

职责边界：

- `packages/markdown-viewer/src/core/*`：唯一实现，后续 Plan 2 在此之上加 Vue 适配。
- `shared/markdown*`：兼容层，只做 re-export，保证本仓库现有调用点零改动。
- `shared/markdown.css`、`shared/markdown-ppt.css`：Plan 3 再迁，避免本计划同时动样式。

### Task 1: 新建 workspace 包骨架

**Files:**
- Create: `packages/markdown-viewer/package.json`
- Create: `packages/markdown-viewer/src/index.js`
- Create: `packages/markdown-viewer/src/index.d.ts`
- Modify: `package.json`

- [ ] **Step 1: 写包 `package.json`**

创建 `packages/markdown-viewer/package.json`：

```json
{
  "name": "@devflow/markdown-viewer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.js",
  "types": "./src/index.d.ts",
  "exports": {
    ".": { "types": "./src/index.d.ts", "default": "./src/index.js" },
    "./core/markdown": { "types": "./src/core/markdown.d.ts", "default": "./src/core/markdown.js" },
    "./core/markdown-client": { "types": "./src/core/markdown-client.d.ts", "default": "./src/core/markdown-client.js" },
    "./core/markdown-charts": { "types": "./src/core/markdown-charts.d.ts", "default": "./src/core/markdown-charts.js" },
    "./core/markdown-css": { "types": "./src/core/markdown-css.d.ts", "default": "./src/core/markdown-css.js" },
    "./core/markdown-flowchart": { "default": "./src/core/markdown-flowchart.js" },
    "./core/markdown-flowchart-editor": { "types": "./src/core/markdown-flowchart-editor.d.ts", "default": "./src/core/markdown-flowchart-editor.js" },
    "./core/markdown-flowchart-graph": { "types": "./src/core/markdown-flowchart-graph.d.ts", "default": "./src/core/markdown-flowchart-graph.js" },
    "./core/markdown-flowchart-model": { "types": "./src/core/markdown-flowchart-model.d.ts", "default": "./src/core/markdown-flowchart-model.js" },
    "./core/markdown-flowchart-x6": { "types": "./src/core/markdown-flowchart-x6.d.ts", "default": "./src/core/markdown-flowchart-x6.js" },
    "./core/markdown-ppt": { "types": "./src/core/markdown-ppt.d.ts", "default": "./src/core/markdown-ppt.js" },
    "./core/markdown-ppt-export": { "types": "./src/core/markdown-ppt-export.d.ts", "default": "./src/core/markdown-ppt-export.js" },
    "./core/markdown-slides": { "types": "./src/core/markdown-slides.d.ts", "default": "./src/core/markdown-slides.js" },
    "./core/markdown-table-sort": { "types": "./src/core/markdown-table-sort.d.ts", "default": "./src/core/markdown-table-sort.js" },
    "./package.json": "./package.json"
  },
  "sideEffects": false,
  "dependencies": {
    "@antv/x6": "^3.1.8",
    "@dagrejs/dagre": "^3.1.3",
    "highlight.js": "^11.10.0",
    "markdown-it": "^14.1.0"
  }
}
```

- [ ] **Step 2: 写根出口 `src/index.js`（刻意不含 X6 模块）**

创建 `packages/markdown-viewer/src/index.js`：

```js
export * from './core/markdown.js';
export * from './core/markdown-client.js';
export * from './core/markdown-charts.js';
export * from './core/markdown-css.js';
export * from './core/markdown-flowchart.js';
export * from './core/markdown-flowchart-graph.js';
export * from './core/markdown-flowchart-model.js';
export * from './core/markdown-ppt.js';
export * from './core/markdown-ppt-export.js';
export * from './core/markdown-slides.js';
export * from './core/markdown-table-sort.js';
```

创建 `packages/markdown-viewer/src/index.d.ts`：

```ts
export * from './core/markdown.js';
export * from './core/markdown-client.js';
export * from './core/markdown-charts.js';
export * from './core/markdown-css.js';
export * from './core/markdown-flowchart-graph.js';
export * from './core/markdown-flowchart-model.js';
export * from './core/markdown-ppt.js';
export * from './core/markdown-ppt-export.js';
export * from './core/markdown-slides.js';
export * from './core/markdown-table-sort.js';
```

- [ ] **Step 3: 把包加入根 workspaces**

修改 `package.json` 的 `workspaces`：

```json
  "workspaces": [
    "shared",
    "server",
    "web",
    "packages/markdown-viewer"
  ],
```

- [ ] **Step 4: 安装并确认 workspace 链接**

Run: `npm.cmd install`
Run: `Test-Path "node_modules\@devflow\markdown-viewer"`
Expected: `npm.cmd install` 退出码 0；`Test-Path` 输出 `True`。

### Task 2: 迁移 core 源码与类型

**Files:**
- Move: `shared/markdown*.js` / `shared/markdown*.d.ts` → `packages/markdown-viewer/src/core/`

- [ ] **Step 1: 创建目录**

Run:
```powershell
New-Item -ItemType Directory -Force "packages\markdown-viewer\src\core" | Out-Null
```

- [ ] **Step 2: 用 `git mv` 迁移 13 个 JS 文件**

Run:
```powershell
git mv shared/markdown.js packages/markdown-viewer/src/core/markdown.js
git mv shared/markdown-client.js packages/markdown-viewer/src/core/markdown-client.js
git mv shared/markdown-charts.js packages/markdown-viewer/src/core/markdown-charts.js
git mv shared/markdown-css.js packages/markdown-viewer/src/core/markdown-css.js
git mv shared/markdown-flowchart.js packages/markdown-viewer/src/core/markdown-flowchart.js
git mv shared/markdown-flowchart-editor.js packages/markdown-viewer/src/core/markdown-flowchart-editor.js
git mv shared/markdown-flowchart-graph.js packages/markdown-viewer/src/core/markdown-flowchart-graph.js
git mv shared/markdown-flowchart-model.js packages/markdown-viewer/src/core/markdown-flowchart-model.js
git mv shared/markdown-flowchart-x6.js packages/markdown-viewer/src/core/markdown-flowchart-x6.js
git mv shared/markdown-ppt.js packages/markdown-viewer/src/core/markdown-ppt.js
git mv shared/markdown-ppt-export.js packages/markdown-viewer/src/core/markdown-ppt-export.js
git mv shared/markdown-slides.js packages/markdown-viewer/src/core/markdown-slides.js
git mv shared/markdown-table-sort.js packages/markdown-viewer/src/core/markdown-table-sort.js
```

- [ ] **Step 3: 迁移 12 个 d.ts（`markdown-flowchart` 没有 d.ts）**

Run:
```powershell
git mv shared/markdown.d.ts packages/markdown-viewer/src/core/markdown.d.ts
git mv shared/markdown-client.d.ts packages/markdown-viewer/src/core/markdown-client.d.ts
git mv shared/markdown-charts.d.ts packages/markdown-viewer/src/core/markdown-charts.d.ts
git mv shared/markdown-css.d.ts packages/markdown-viewer/src/core/markdown-css.d.ts
git mv shared/markdown-flowchart-editor.d.ts packages/markdown-viewer/src/core/markdown-flowchart-editor.d.ts
git mv shared/markdown-flowchart-graph.d.ts packages/markdown-viewer/src/core/markdown-flowchart-graph.d.ts
git mv shared/markdown-flowchart-model.d.ts packages/markdown-viewer/src/core/markdown-flowchart-model.d.ts
git mv shared/markdown-flowchart-x6.d.ts packages/markdown-viewer/src/core/markdown-flowchart-x6.d.ts
git mv shared/markdown-ppt.d.ts packages/markdown-viewer/src/core/markdown-ppt.d.ts
git mv shared/markdown-ppt-export.d.ts packages/markdown-viewer/src/core/markdown-ppt-export.d.ts
git mv shared/markdown-slides.d.ts packages/markdown-viewer/src/core/markdown-slides.d.ts
git mv shared/markdown-table-sort.d.ts packages/markdown-viewer/src/core/markdown-table-sort.d.ts
```

- [ ] **Step 4: 确认目录内容**

Run: `Get-ChildItem "packages\markdown-viewer\src\core" | Select-Object Name`
Expected: 上述 25 个文件（13 JS + 12 d.ts）。

- [ ] **Step 5: 确认 core 内部相对 import 仍成立**

Run: `Select-String -Path "packages\markdown-viewer\src\core\*.js" -Pattern "from '\./`
Expected: 所有引用仍是 `./markdown-charts.js`、`./markdown-flowchart.js`、`./markdown-ppt.js` 等同目录路径，无需修改。

### Task 3: 在 `shared/` 建兼容 shim

**Files:**
- Create: `shared/markdown.js`、`shared/markdown.d.ts`
- Create: `shared/markdown-client.js`、`shared/markdown-client.d.ts`
- Create: `shared/markdown-charts.js`、`shared/markdown-charts.d.ts`
- Create: `shared/markdown-css.js`、`shared/markdown-css.d.ts`
- Create: `shared/markdown-flowchart.js`（无 d.ts）
- Create: `shared/markdown-flowchart-editor.js`、`shared/markdown-flowchart-editor.d.ts`
- Create: `shared/markdown-flowchart-graph.js`、`shared/markdown-flowchart-graph.d.ts`
- Create: `shared/markdown-flowchart-model.js`、`shared/markdown-flowchart-model.d.ts`
- Create: `shared/markdown-flowchart-x6.js`、`shared/markdown-flowchart-x6.d.ts`
- Create: `shared/markdown-ppt.js`、`shared/markdown-ppt.d.ts`
- Create: `shared/markdown-ppt-export.js`、`shared/markdown-ppt-export.d.ts`
- Create: `shared/markdown-slides.js`、`shared/markdown-slides.d.ts`
- Create: `shared/markdown-table-sort.js`、`shared/markdown-table-sort.d.ts`

- [ ] **Step 1: 批量写 shim**

Run:
```powershell
$mods = @(
  'markdown','markdown-client','markdown-charts','markdown-css',
  'markdown-flowchart','markdown-flowchart-editor','markdown-flowchart-graph',
  'markdown-flowchart-model','markdown-flowchart-x6','markdown-ppt',
  'markdown-ppt-export','markdown-slides','markdown-table-sort'
)
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($m in $mods) {
  [System.IO.File]::WriteAllText((Join-Path 'shared' "$m.js"), "export * from '@devflow/markdown-viewer/core/$m';`r`n", $utf8)
}
$typed = $mods | Where-Object { $_ -ne 'markdown-flowchart' }
foreach ($m in $typed) {
  [System.IO.File]::WriteAllText((Join-Path 'shared' "$m.d.ts"), "export * from '@devflow/markdown-viewer/core/$m';`r`n", $utf8)
}
```

- [ ] **Step 2: 抽查两个 shim 内容**

Run: `Get-Content shared/markdown-client.js; Get-Content shared/markdown.d.ts`
Expected:
```
export * from '@devflow/markdown-viewer/core/markdown-client';
export * from '@devflow/markdown-viewer/core/markdown';
```

- [ ] **Step 3: 确认 CSS 未被移动**

Run: `Test-Path shared/markdown.css; Test-Path shared/markdown-ppt.css`
Expected: 两行都是 `True`。

### Task 4: 更新 workspace 依赖声明

**Files:**
- Modify: `shared/package.json`
- Modify: `server/package.json`

- [ ] **Step 1: `shared/package.json` 增加包依赖**

在 `dependencies` 中加一项（保持其它字段不变）：

```json
  "dependencies": {
    "@dagrejs/dagre": "^3.1.3",
    "@devflow/markdown-viewer": "*"
  }
```

- [ ] **Step 2: `server/package.json` 增加包依赖**

在 `dependencies` 中加一项（保持其它字段不变）：

```json
    "@devflow/markdown-viewer": "*",
```

原因：静态页运行时 `@devflow/shared/markdown-client` shim 会 import 该包，绿色包必须能解析到它。

- [ ] **Step 3: 重新安装并确认链接**

Run: `npm.cmd install`
Run: `node --input-type=module -e "import('@devflow/markdown-viewer').then(m=>console.log(typeof m.createMarkdown))"`
Expected: 输出 `function`。

### Task 5: 更新静态页资产解析路径

**Files:**
- Modify: `server/mermaid-asset.js:52-125`

- [ ] **Step 1: 用包源码目录替换 shared 目录**

把 `readMarkdownClientScript`、`readFlowX6Script`、`readFlowEditScript` 中的 `sharedDir` 改为包内 `src/core`。替换后的三个函数如下：

```js
function markdownViewerCoreDir() {
  const require = createRequire(import.meta.url);
  const pkgDir = path.dirname(require.resolve('@devflow/markdown-viewer/package.json'));
  return path.join(pkgDir, 'src', 'core');
}

// 把 markdown-client.js 及其依赖（markdown-charts.js）打成一个浏览器 ESM，
// 这样静态页面只需加载单文件，也不用手工维护多份资源路由。
export function readMarkdownClientScript() {
  const coreDir = markdownViewerCoreDir();
  const file = path.join(coreDir, 'markdown-client.js');
  const charts = path.join(coreDir, 'markdown-charts.js');
  const flow = path.join(coreDir, 'markdown-flowchart.js');
  const ppt = path.join(coreDir, 'markdown-ppt.js');
  const pptExport = path.join(coreDir, 'markdown-ppt-export.js');
  const mtime = Math.max(
    fs.statSync(file).mtimeMs,
    fs.statSync(charts).mtimeMs,
    fs.existsSync(flow) ? fs.statSync(flow).mtimeMs : 0,
    fs.statSync(ppt).mtimeMs,
    fs.statSync(pptExport).mtimeMs,
  );
  if (!clientCached || mtime !== clientMtime) {
    const result = buildSync({
      entryPoints: [file],
      absWorkingDir: coreDir,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      write: false,
      logLevel: 'silent',
    });
    clientMtime = mtime;
    clientCached = Buffer.from(result.outputFiles[0].text, 'utf8');
  }
  return clientCached;
}

// 按需加载的 X6 流程图栈；首次请求时才编译，之后缓存
let flowX6Cached = null;
export function readFlowX6Script() {
  if (flowX6Cached) return flowX6Cached;
  const coreDir = markdownViewerCoreDir();
  const entry = path.join(coreDir, 'markdown-flowchart-x6.js');
  const result = buildSync({
    entryPoints: [entry],
    absWorkingDir: coreDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });
  flowX6Cached = Buffer.from(result.outputFiles[0].text, 'utf8');
  return flowX6Cached;
}

let flowEditCached = null;
export function readFlowEditScript() {
  if (flowEditCached) return flowEditCached;
  const coreDir = markdownViewerCoreDir();
  const entry = path.join(coreDir, 'markdown-flowchart-editor.js');
  const result = buildSync({
    entryPoints: [entry],
    absWorkingDir: coreDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });
  flowEditCached = Buffer.from(result.outputFiles[0].text, 'utf8');
  return flowEditCached;
}
```

- [ ] **Step 2: 跑服务端静态页相关测试**

Run: `node --test "server/test/markdown-page.test.js" "server/test/proxy-engine.test.js"`
Expected: 全部 PASS（会实际 esbuild 打包 `markdown-client.js` 并请求 `__devflow_markdown__.js`）。

### Task 6: 更新绿色包自检路径

**Files:**
- Modify: `scripts/build.js:359`

- [ ] **Step 1: 改 flowX6 自检入口路径**

把：

```js
const flowX6Entry = path.join(APP, "node_modules", "@devflow", "shared", "markdown-flowchart-x6.js");
```

改为：

```js
const flowX6Entry = path.join(APP, "node_modules", "@devflow", "markdown-viewer", "src", "core", "markdown-flowchart-x6.js");
```

- [ ] **Step 2: 确认 `shared` 仍被整体拷贝**

Run: `Select-String -Path scripts/build.js -Pattern '@devflow.*shared|copyRuntimeDeps|skip:'`
Expected: 仍能看到 `cpDir(ROOT/shared → APP/node_modules/@devflow/shared)`，且 `copyRuntimeDeps` 的 `skip` 包含 `@devflow/shared`；无需再手工拷贝 markdown-viewer（它已在 `server/package.json` 依赖中，由 `copyRuntimeDeps` 递归拷贝）。

### Task 7: 全量验证

**Files:** 无改动

- [ ] **Step 1: 服务端测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS。

- [ ] **Step 2: Web 测试**

Run: `npm.cmd run test:web`
Expected: 全部 PASS（现有 markdown-enhance 测试会经由 shim 命中包内实现）。

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 退出码 0。

- [ ] **Step 4: Web 构建**

Run: `npm.cmd run build:web`
Expected: 退出码 0，`web/dist` 生成。

- [ ] **Step 5: 绿色包构建**

Run: `node scripts/build.js --no-zip`
Expected: 退出码 0；日志包含 `[build]   ok runtime deps`，且列表中出现 `@devflow/markdown-viewer`。

- [ ] **Step 6: 绿色包启动冒烟**

Run:
```powershell
$app = Get-ChildItem "dist-portable" -Directory |
  Where-Object { $_.Name -like 'vscode-ai-windows-x64-*' -and $_.Name -notlike '*-opencode' } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$out = Join-Path $env:TEMP "mdv-smoke.out.log"
$err = Join-Path $env:TEMP "mdv-smoke.err.log"
$env:DEVFLOW_PORT = "22223"
Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory $app.FullName `
  -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden
Start-Sleep -Seconds 6
Get-Content $err -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 22223 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
```
Expected: stderr 无 `ERR_MODULE_NOT_FOUND`；最后一行能看到 `22223` 监听。随后执行 `Get-NetTCPConnection -LocalPort 22223 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` 关闭冒烟进程。

### Task 8: 提交

**Files:** 本计划涉及的全部改动

- [ ] **Step 1: 敏感信息扫描**

Run:
```powershell
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat-|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git grep -n -I -i -E "passwd|password|passphrase|secret|api[_-]?key|token"
git ls-files env
```
Expected: 第一条无命中；第二条命中需人工确认为检测规则/示例文本；第三条为空。

- [ ] **Step 2: 只暂存本计划文件**

Run:
```powershell
git add package.json packages/markdown-viewer shared server/package.json scripts/mermaid-asset.js scripts/build.js
git status --short
```
Expected：只包含本计划涉及的新增/修改/删除；不包含 `env/`、`logs/`、`dist-portable/`、`void_manifest.json`。

- [ ] **Step 3: 提交**

Run:
```powershell
git commit -m "refactor(markdown): 抽出 @devflow/markdown-viewer core 包并保留 shared 兼容层"
```

---

## 自审记录

- Spec 覆盖：本计划覆盖 spec 的「包位置 / core 迁移 / shared 兼容 / 静态页资产解析 / 打包自检」；Vue 组件、i18n、样式、standalone、Web/静态页正式切换、TS 化明确留给 Plan 2/3。
- 无占位符：所有新文件均给出完整内容；所有命令可直接执行。
- 类型一致性：shim 子路径与 `packages/markdown-viewer/package.json` 的 `exports` 一一对应；`markdown-flowchart` 无 d.ts，未声明 `types`。
