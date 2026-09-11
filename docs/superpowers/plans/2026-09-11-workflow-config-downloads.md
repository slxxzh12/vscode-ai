# 活动配置迁到 `<dataHome>/downloads` 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 启动时把仓库模板 `config/devflow.xml` seed 成 `<dataHome>/downloads/devflow.xml`，并以其为整份配置（server/agents/workflows）的唯一权威源；已存在则不覆盖。

**Architecture:** 新增 `resolveActiveConfigFile(baseDir)`（`server/devflow-config.js`）：目标文件已存在则直接返回；否则 `mkdir -p <dataHome>/downloads` 后从仓库模板复制（模板缺失则写内置默认）。`server/index.js` 的 `configFile` 改用它，其余所有配置读写点（settings/agents/workflows/config-xml/watch）自动跟随，无需改动。

**Tech Stack:** Node ESM、node:test。

**Spec:** `docs/superpowers/specs/2026-09-11-workflow-config-downloads-design.md`

---

## 文件结构

**改：**
- `server/data-home.js` — 新增 `downloadsDir()`
- `server/devflow-config.js` — 新增 `resolveActiveConfigFile(baseDir)`
- `server/index.js` — `configFile` 改用 `resolveActiveConfigFile`
- `AGENTS.md` — 更新配置说明

**新建测试：**
- `server/test/data-home.test.js`
- `server/test/devflow-config.test.js`（追加用例）

---

## Task 1: `data-home.js` 新增 `downloadsDir()`

**Files:**
- Modify: `server/data-home.js`
- Test: `server/test/data-home.test.js`

- [ ] **Step 1: 写失败测试**

新建 `server/test/data-home.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadsDir } from '../data-home.js';

test('downloadsDir 指向 dataHome/downloads', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'df-data-'));
  const prev = process.env.DEVFLOW_DATA_HOME;
  process.env.DEVFLOW_DATA_HOME = data;
  try {
    assert.equal(downloadsDir(), path.join(data, 'downloads'));
  } finally {
    if (prev === undefined) delete process.env.DEVFLOW_DATA_HOME; else process.env.DEVFLOW_DATA_HOME = prev;
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/data-home.test.js"`
Expected: FAIL（`downloadsDir` is not a function / not exported）

- [ ] **Step 3: 实现**

在 `server/data-home.js` 的 `downloadDir()` 之后新增：

```js
// 活动配置目录（<dataHome>/downloads/devflow.xml）；注意与协作收件目录 downloadDir()（单数）区分
export function downloadsDir() {
  return path.join(dataHome(), 'downloads');
}
```

（该函数不 `mkdir`，创建与失败语义由 `resolveActiveConfigFile` 负责。）

- [ ] **Step 4: 运行通过**

Run: `node --test "server/test/data-home.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/data-home.js server/test/data-home.test.js
git commit -m "feat(config): data-home 增 downloadsDir"
```

---

## Task 2: `resolveActiveConfigFile` seed 逻辑

**Files:**
- Modify: `server/devflow-config.js`
- Test: `server/test/devflow-config.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/devflow-config.test.js` 顶部 import 增补 `resolveActiveConfigFile`：

```js
import {
  parseDevflowConfig, serializeDevflowConfig,
  loadDevflowConfig, ensureConfigFile, updateServerAttrs, buildDefaultConfig,
  validateWorkflows, updateWorkflows, resolveActiveConfigFile,
} from '../devflow-config.js';
```

在文件末尾追加（`SAMPLE` 已在文件顶部定义）：

```js
function withDataHome(fn) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-data-'));
  const prev = process.env.DEVFLOW_DATA_HOME;
  process.env.DEVFLOW_DATA_HOME = data;
  try { return fn(data); }
  finally {
    if (prev === undefined) delete process.env.DEVFLOW_DATA_HOME; else process.env.DEVFLOW_DATA_HOME = prev;
  }
}

test('resolveActiveConfigFile 首次从模板复制到 dataHome/downloads', () => {
  withDataHome((data) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-root-'));
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config', 'devflow.xml'), SAMPLE, 'utf8');
    const active = resolveActiveConfigFile(root);
    assert.equal(active, path.join(data, 'downloads', 'devflow.xml'));
    assert.equal(fs.readFileSync(active, 'utf8'), SAMPLE);
  });
});

test('resolveActiveConfigFile 已存在则不覆盖', () => {
  withDataHome(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-root-'));
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config', 'devflow.xml'), SAMPLE, 'utf8');
    const first = resolveActiveConfigFile(root);
    fs.writeFileSync(first, '<devflow><server port="9999" language="en"/></devflow>', 'utf8');
    const second = resolveActiveConfigFile(root);
    assert.equal(second, first);
    assert.match(fs.readFileSync(second, 'utf8'), /port="9999"/);
  });
});

test('resolveActiveConfigFile 模板缺失写入内置默认', () => {
  withDataHome(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-root-'));
    const active = resolveActiveConfigFile(root);
    const c = loadDevflowConfig(active);
    assert.equal(c.agents.list.length, buildDefaultConfig().agents.list.length);
    assert.ok(c.workflows.length >= 1);
  });
});

test('resolveActiveConfigFile downloads 不可创建时抛错', () => {
  withDataHome((data) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-root-'));
    fs.writeFileSync(path.join(data, 'downloads'), 'not-a-dir', 'utf8');   // 占位成文件 → mkdir 失败
    assert.throws(() => resolveActiveConfigFile(root));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/devflow-config.test.js"`
Expected: FAIL（`resolveActiveConfigFile` is not a function）

- [ ] **Step 3: 实现**

在 `server/devflow-config.js` 顶部增补 import：

```js
import { downloadsDir } from './data-home.js';
```

在 `ensureConfigFile` 之后新增：

```js
// 解析运行时活动配置：优先 <dataHome>/downloads/devflow.xml；不存在则从仓库模板 seed（不覆盖已存在的）
export function resolveActiveConfigFile(baseDir) {
  const dir = downloadsDir();
  const active = path.join(dir, 'devflow.xml');
  if (fs.existsSync(active)) return active;
  fs.mkdirSync(dir, { recursive: true });        // 失败向上抛出 → 启动失败
  const template = defaultConfigFile(baseDir);
  if (fs.existsSync(template)) fs.copyFileSync(template, active);
  else fs.writeFileSync(active, serializeDevflowConfig(buildDefaultConfig()), 'utf8');
  return active;
}
```

- [ ] **Step 4: 运行通过**

Run: `node --test "server/test/devflow-config.test.js"`
Expected: PASS（含新增 4 个用例）

- [ ] **Step 5: Commit**

```bash
git add server/devflow-config.js server/test/devflow-config.test.js
git commit -m "feat(config): resolveActiveConfigFile 从 dataHome/downloads seed"
```

---

## Task 3: `server/index.js` 接线

**Files:**
- Modify: `server/index.js:25`, `server/index.js:40-41`

- [ ] **Step 1: 改 import**

将 `server/index.js:25`：

```js
import { defaultConfigFile, loadDevflowConfig, ensureConfigFile, updateServerAttrs, parseDevflowConfig, updateWorkflows, DEFAULT_PORT } from './devflow-config.js';
```

改为：

```js
import { resolveActiveConfigFile, loadDevflowConfig, ensureConfigFile, updateServerAttrs, parseDevflowConfig, updateWorkflows, DEFAULT_PORT } from './devflow-config.js';
```

（`ensureConfigFile` 仍被 `GET /api/config/xml` 使用，保留。）

- [ ] **Step 2: 改 configFile 解析**

将 `server/index.js:40-41`：

```js
const configFile = defaultConfigFile(path.join(__dirname, '..'));
ensureConfigFile(configFile);
```

改为：

```js
const configFile = resolveActiveConfigFile(path.join(__dirname, '..'));
```

- [ ] **Step 3: 验证无残留引用**

Run: `rg -n "defaultConfigFile" server`
Expected: 仅 `server/devflow-config.js` 内部定义/使用（`server/index.js` 不再引用）。

- [ ] **Step 4: 冒烟启动（后台异步，勿前台阻塞）**

```powershell
$log = Join-Path $env:TEMP 'devflow-boot.log'
Start-Process -FilePath node -ArgumentList 'server/index.js' -WorkingDirectory 'D:\root\devflow\devflow' -RedirectStandardOutput $log -RedirectStandardError ($log + '.err') -WindowStyle Hidden
Start-Sleep -Seconds 3
Get-Content $log
```

Expected：日志出现 `listening on http://...`；随后确认 `Test-Path "$env:USERPROFILE\.local\share\devflow\downloads\devflow.xml"` 为 `True`。验证后结束该进程：

```powershell
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*node.exe' } | Stop-Process -Force
```

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(config): 启动改用 dataHome/downloads 活动配置"
```

---

## Task 4: 更新 `AGENTS.md`

**Files:**
- Modify: `AGENTS.md:44-46`

- [ ] **Step 1: 替换配置说明**

将：

```markdown
- 唯一配置文件：`config/devflow.xml`（`<server port language/>` + `<agents default>` + `<workflows>`）。
- 端口/语言可在 UI 设置面板修改，服务端会**就地改写** `<server>` 属性；Agent 列表与工作流提示语直接编辑 XML。
- 改 `config/devflow.xml` 后需**重启后端**（dev:server 的 `--watch` 不监听 xml）。
```

改为：

```markdown
- 活动配置文件：`<dataHome>/downloads/devflow.xml`（Windows：`%USERPROFILE%\.local\share\devflow\downloads\devflow.xml`）；首次启动从仓库模板 `config/devflow.xml` 复制生成，**已存在则不覆盖**，之后为整份配置（`<server>` + `<agents>` + `<workflows>`）的唯一权威源。
- 端口/语言可在 UI 设置面板修改，服务端会**就地改写**活动文件的 `<server>` 属性；Agent 列表与工作流提示语直接编辑活动文件。
- 改活动配置后需**重启后端**（dev:server 的 `--watch` 不监听 xml）；仓库 `config/devflow.xml` 仅作首次 seed 模板，seed 后修改它不生效（删除 `<dataHome>/downloads/devflow.xml` 可重新生成）。
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: 活动配置路径改为 dataHome/downloads"
```

---

## Task 5: 全量验证

- [ ] **Step 1: 自动化**

Run: `npm.cmd test`
Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 全 PASS。

- [ ] **Step 2: 手动端到端**

1. 删除 `<dataHome>/downloads/devflow.xml`，重启后端 → 文件被创建，内容与仓库 `config/devflow.xml` 一致；UI 工作流正常。
2. 在仓库 `config/devflow.xml` 改 `<server port="..." />`，重启后端 → 端口**不**变化（downloads 权威）。
3. 在 `<dataHome>/downloads/devflow.xml` 改端口/工作流并重启后端 → 生效；UI 设置面板改端口后该文件被就地改写。

---

## Self-Review 记录

- **Spec 覆盖**：§3 解析逻辑→Task 2；§4 读写点跟随→Task 3（无需逐个改，说明见架构）；§5 边界（已存在不覆盖/模板缺失/不可写）→Task 2 四个用例；§6 改动文件→Task 1-4；§7 测试验收→Task 2/5；§8 不做项未引入。
- **类型一致**：`downloadsDir()`、`resolveActiveConfigFile(baseDir)`、`configFile` 前后一致；`ensureConfigFile` 保留（`/api/config/xml` 仍用）。
- **占位扫描**：无 TBD/TODO；每个代码步骤给出完整代码。
- **风险**：`data-home.js` 的 `downloadDir()`（单数）与 `downloadsDir()`（复数）命名相近，已在实现注释中标注区分。
