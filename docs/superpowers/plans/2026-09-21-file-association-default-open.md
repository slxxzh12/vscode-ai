# 文件关联「默认用 Void 打开」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本仓库约定（AGENTS.md，优先级高于本模板）**：执行方式默认 **inline（本会话内执行）**，不用 subagent；`npm` 一律用 `npm.cmd`；**未经用户明确要求不自动 `git commit`** —— 把各处「Commit」步骤当作「暂存并汇报，等用户确认后再提交」。
>
> **Spec:** `docs/superpowers/specs/2026-09-21-file-association-default-open-design.md`

**Goal:** 绿色包（Windows）启动后，把 `.md .markdown .yaml .yml .js .mjs .cjs .json .http .rest .curl` 的默认打开方式设为 Void；首次在设置面板询问（默认勾选），之后每次启动自查纠正。

**Architecture:** 注册表逻辑只写一份在 `launch.ps1`（新增 `Set-VoidAssoc` 函数 + `-Assoc apply|remove` 子命令）；服务端 `server/file-assoc.js` 管偏好读写/状态/调用，`server/index.js` 出 `/api/file-assoc` 接口并在启动时兜底；前端设置面板加「文件关联」区，首次自动打开且默认勾选。

**Tech Stack:** Node ESM（`node --test`）+ PowerShell 5.1（HKCU 注册表）+ Vue3/TS（vitest）。

---

## 文件结构

- `server/file-assoc.js`（新增）：扩展名常量、偏好读写、可用性判定、PS 调用、状态读取。单一职责。
- `server/test/file-assoc.test.js`（新增）：上述纯逻辑单测（注入 fake spawn / runPs）。
- `scripts/launcher.js`（修改）：生成 `launch.ps1` 时加 `Set-VoidAssoc`、`-Assoc` 子命令、启动自查；删旧 WScript 首启注册块。
- `server/test/launcher.test.js`（修改）：更新断言。
- `server/index.js`（修改）：`/api/file-assoc` GET/POST + 启动兜底。
- `web/src/fileAssoc.ts`（新增）：前端数据层。
- `web/src/fileAssoc.test.ts`（新增）：vitest。
- `web/src/components/TerminalView.vue`（修改）：设置面板「文件关联」区 + 保存钩子。
- `web/src/App.vue`（修改）：首启自动打开设置面板。
- `shared/i18n/zh-CN.js` / `shared/i18n/en.js`（修改）：新增词条。

---

## Task 1: `server/file-assoc.js` 模块

**Files:**
- Create: `server/file-assoc.js`
- Test: `server/test/file-assoc.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/file-assoc.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXTENSIONS, prefFile, loadPref, savePref, available, parseDefaults, getState, runAssoc } from '../file-assoc.js';

function tmpApp({ withBat = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-assoc-'));
  if (withBat) fs.writeFileSync(path.join(dir, 'start.bat'), '@echo off\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'script'), { recursive: true });
  return dir;
}

test('EXTENSIONS 为约定的 11 个扩展名', () => {
  assert.deepEqual(EXTENSIONS, ['.md', '.markdown', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.json', '.http', '.rest', '.curl']);
});

test('loadPref 缺省返回未启用未提示', () => {
  const dir = tmpApp();
  assert.deepEqual(loadPref(dir), { enabled: false, prompted: false });
});

test('savePref / loadPref 往返', () => {
  const dir = tmpApp();
  savePref(dir, { enabled: true, prompted: true });
  assert.deepEqual(loadPref(dir), { enabled: true, prompted: true });
  assert.equal(fs.existsSync(prefFile(dir)), true);
});

test('available：仅 win32 且绿色包（start.bat 存在）可用', () => {
  const plain = tmpApp();
  assert.equal(available({ appDir: plain, platform: 'win32', envPort: '' }).ok, false);
  const win = tmpApp({ withBat: true });
  assert.equal(available({ appDir: win, platform: 'win32', envPort: '' }).ok, true);
  assert.equal(available({ appDir: win, platform: 'darwin', envPort: '' }).ok, false);
  assert.equal(available({ appDir: win, platform: 'win32', envPort: '33333' }).ok, false);
});

test('parseDefaults：只认 true，坏输入回退空对象', () => {
  assert.deepEqual(parseDefaults(JSON.stringify({ '.md': true, '.yaml': false })), { '.md': true, '.yaml': false });
  assert.deepEqual(parseDefaults('not json'), {});
  assert.deepEqual(parseDefaults(''), {});
});

test('getState：不可用时扩展名全 false 且不跑 PS', async () => {
  const dir = tmpApp();
  let called = false;
  const st = await getState({ appDir: dir, platform: 'win32', envPort: '', runPs: async () => { called = true; return '{}'; } });
  assert.equal(st.available, false);
  assert.equal(called, false);
  assert.equal(st.extensions.length, EXTENSIONS.length);
  assert.equal(st.extensions.every((x) => x.isDefault === false), true);
});

test('getState：可用时按 PS 输出标记 isDefault', async () => {
  const dir = tmpApp({ withBat: true });
  const st = await getState({ appDir: dir, platform: 'win32', envPort: '', runPs: async () => JSON.stringify({ '.md': true }) });
  assert.equal(st.available, true);
  assert.equal(st.extensions.find((x) => x.ext === '.md').isDefault, true);
  assert.equal(st.extensions.find((x) => x.ext === '.yaml').isDefault, false);
});

test('runAssoc：调 launch.ps1 -Assoc <action> 且分离进程', () => {
  const calls = [];
  const fakeSpawn = (bin, args, opts) => { calls.push({ bin, args, opts }); return { unref() { calls.push({ unref: true }); } }; };
  runAssoc(path.join('C:', 'app'), 'apply', { spawnFn: fakeSpawn, platform: 'win32' });
  assert.equal(calls[0].bin, 'powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.equal(calls[0].args[4], path.join('C:', 'app', 'script', 'launch.ps1'));
  assert.deepEqual(calls[0].args.slice(-2), ['-Assoc', 'apply']);
  assert.equal(calls[0].opts.detached, true);
  assert.deepEqual(calls[1], { unref: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd run test:server`
Expected: FAIL（`Cannot find module '../file-assoc.js'`）。

- [ ] **Step 3: Write minimal implementation**

Create `server/file-assoc.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_DIR } from './port-file.js';
import { restartGuard } from './port-restart.js';

export const EXTENSIONS = ['.md', '.markdown', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.json', '.http', '.rest', '.curl'];

export function prefFile(appDir = APP_DIR) {
  return path.join(appDir, 'data', 'file-assoc.json');
}

export function loadPref(appDir = APP_DIR) {
  try {
    const p = JSON.parse(fs.readFileSync(prefFile(appDir), 'utf8'));
    return { enabled: !!p.enabled, prompted: !!p.prompted };
  } catch { return { enabled: false, prompted: false }; }
}

export function savePref(appDir, pref) {
  const file = prefFile(appDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { enabled: !!pref.enabled, prompted: !!pref.prompted };
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function available({ appDir = APP_DIR, platform = process.platform, envPort = process.env.DEVFLOW_PORT, exists = fs.existsSync } = {}) {
  if (platform !== 'win32') return { ok: false, launcher: '' };
  const g = restartGuard({ appDir, envPort, platform, exists });
  if (!g.ok) return { ok: false, launcher: '' };
  const launcher = path.join(appDir, 'script', 'launch.ps1');
  return { ok: exists(launcher), launcher };
}

export function parseDefaults(raw) {
  try {
    const o = JSON.parse(String(raw || '').trim() || '{}');
    const out = {};
    for (const [k, v] of Object.entries(o || {})) out[k] = v === true;
    return out;
  } catch { return {}; }
}

function psReadDefaults() {
  const list = EXTENSIONS.map((e) => `'${e}'`).join(',');
  return [
    '$o = @{}',
    `foreach ($e in @(${list})) {`,
    "  $p = (Get-ItemProperty -Path ('HKCU:\\Software\\Classes\\' + $e) -Name '(default)' -ErrorAction SilentlyContinue).'(default)'",
    "  $o[$e] = ($p -eq 'Void')",
    '}',
    '$o | ConvertTo-Json -Compress',
  ].join('; ');
}

function defaultRunPs({ spawnFn = spawn, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    if (platform !== 'win32') return resolve('{}');
    let child;
    try { child = spawnFn('powershell.exe', ['-NoProfile', '-Command', psReadDefaults()], { windowsHide: true }); }
    catch { return resolve('{}'); }
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => resolve('{}'));
    child.on('close', () => resolve(out));
  });
}

export async function getState({ appDir = APP_DIR, platform = process.platform, envPort = process.env.DEVFLOW_PORT, exists = fs.existsSync, runPs = null, spawnFn = spawn } = {}) {
  const avail = available({ appDir, platform, envPort, exists });
  if (!avail.ok) return { available: false, extensions: EXTENSIONS.map((ext) => ({ ext, isDefault: false })) };
  const run = runPs || (() => defaultRunPs({ spawnFn, platform }));
  const defaults = parseDefaults(await run());
  return { available: true, extensions: EXTENSIONS.map((ext) => ({ ext, isDefault: defaults[ext] === true })) };
}

export function runAssoc(appDir, action, { spawnFn = spawn, platform = process.platform } = {}) {
  if (platform !== 'win32') return false;
  const script = path.join(appDir, 'script', 'launch.ps1');
  const child = spawnFn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Assoc', action], { cwd: appDir, detached: true, stdio: 'ignore' });
  if (child && typeof child.unref === 'function') child.unref();
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd run test:server`
Expected: PASS（新增 8 条通过）。

- [ ] **Step 5: Stage & report**（AGENTS.md：等用户确认后再 commit）

```bash
git add server/file-assoc.js server/test/file-assoc.test.js
git status --short
```

---

## Task 2: `launch.ps1` 生成器（`scripts/launcher.js`）

**Files:**
- Modify: `scripts/launcher.js:14-152`
- Test: `server/test/launcher.test.js`

- [ ] **Step 1: Update the failing tests**

把 `server/test/launcher.test.js` 的第三个测试改成：

```js
test('launch.ps1 保留原有能力（快捷方式 / 关联子命令 / 浏览器）', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /Void\.lnk/);
  assert.match(ps, /Set-VoidAssoc/);
  assert.match(ps, /\?open=/);
  assert.match(ps, /22222/, '默认端口写入脚本');
});
```

把第四个测试的 `OpenWithProgids` 断言换成启动自查：

```js
  assert.ok(early < ps.indexOf('file-assoc.json'), '早退应出现在启动自查之前');
```

（删除原 `assert.ok(early < ps.indexOf('OpenWithProgids'), ...)` 这一行。）

新增测试：

```js
test('launch.ps1 含 -Assoc 子命令与启动自查，且不再有 WScript 首启弹窗', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /\[string\]\$Assoc = ''/);
  assert.match(ps, /function Set-VoidAssoc/);
  assert.match(ps, /if \(\$Assoc\) \{ Set-VoidAssoc \$Assoc; exit 0 \}/);
  assert.match(ps, /data\\file-assoc\.json/);
  assert.ok(!ps.includes('assoc-prompted'), '移除了旧的首启 WScript 关联弹窗');
  assert.match(ps, /DeleteSubKeyTree/, '删 UserChoice 才能成为默认程序');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd run test:server`
Expected: FAIL（`Set-VoidAssoc` / `$Assoc` 不存在，`assoc-prompted` 仍在）。

- [ ] **Step 3: 在 `makeLaunchPs1` 的 `param(...)` 加 `$Assoc`**

把 `scripts/launcher.js:14` 改为：

```js
    "param([switch]$NoBrowser, [switch]$NoShortcut, [switch]$Plan, [switch]$NoPrompt, [string]$Open = '', [string]$Assoc = '')",
```

- [ ] **Step 4: 在 `$root` 定义后插入 `Set-VoidAssoc` 函数**

在 `scripts/launcher.js` 的 `"$root = Split-Path -Parent $scriptDir",` 之后插入：

```js
    "function Set-VoidAssoc([string]$action) {",
    "  $cu = [Microsoft.Win32.Registry]::CurrentUser",
    "  $exts = @('.md', '.markdown', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.json', '.http', '.rest', '.curl')",
    "  if ($action -eq 'remove') {",
    "    foreach ($e in $exts) {",
    "      try { $ow = $cu.OpenSubKey(\"Software\\Classes\\$e\\OpenWithProgids\", $true); if ($ow) { $ow.DeleteValue('Void', $false); $ow.Close() } } catch { }",
    "      try { $k = $cu.OpenSubKey(\"Software\\Classes\\$e\", $true); if ($k) { if ([string]$k.GetValue('') -eq 'Void') { $k.DeleteValue('', $false) }; $k.Close() } } catch { }",
    "    }",
    "    return",
    "  }",
    "  $prog = $cu.CreateSubKey('Software\\Classes\\Void')",
    "  $prog.SetValue('', 'Void')",
    "  $cmd = $prog.CreateSubKey('shell\\open\\command')",
    "  $cmd.SetValue('', ('\"' + (Join-Path $root 'start.bat') + '\" \"%1\"'))",
    "  $cmd.Close()",
    "  $icon = $prog.CreateSubKey('DefaultIcon')",
    "  $icon.SetValue('', (Join-Path $scriptDir 'icon.ico'))",
    "  $icon.Close()",
    "  $prog.Close()",
    "  foreach ($e in $exts) {",
    "    try {",
    "      $k = $cu.CreateSubKey(\"Software\\Classes\\$e\")",
    "      $k.SetValue('', 'Void')",
    "      $k.Close()",
    "      $ow = $cu.CreateSubKey(\"Software\\Classes\\$e\\OpenWithProgids\")",
    "      $ow.SetValue('Void', (New-Object byte[] 0), [Microsoft.Win32.RegistryValueKind]::None)",
    "      $ow.Close()",
    "      $cu.DeleteSubKeyTree(\"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$e\\UserChoice\", $false)",
    "    } catch { }",
    "  }",
    "}",
```

- [ ] **Step 5: 在 `-Plan` 分支后插入 `-Assoc` 早退**

在 `scripts/launcher.js` 的 `if ($Plan)` 分支三行之后（`"  exit 0", "}",` 之后、`"$openPort = $desired",` 之前）插入：

```js
    "if ($Assoc) { Set-VoidAssoc $Assoc; exit 0 }",
```

- [ ] **Step 6: 用启动自查替换旧的 WScript 首启注册块**

删除 `scripts/launcher.js:115-149`（从 `"# First run: ask whether to register..."` 到 `"},"` 整段，含 `$marker` / Popup / `OpenWithProgids` 循环），替换为：

```js
    "# 每次启动：设置里启用了就把默认打开方式静默校正为 Void",
    "try {",
    "  $pf = Join-Path $root 'data\\file-assoc.json'",
    "  if (Test-Path $pf) {",
    "    $pref = Get-Content -Raw $pf | ConvertFrom-Json",
    "    if ($pref.enabled) { Set-VoidAssoc 'apply' }",
    "  }",
    "} catch { }",
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm.cmd run test:server`
Expected: PASS（launcher 相关全绿）。

- [ ] **Step 8: Stage & report**

```bash
git add scripts/launcher.js server/test/launcher.test.js
git status --short
```

---

## Task 3: 服务端接口 + 启动兜底（`server/index.js`）

**Files:**
- Modify: `server/index.js`（imports 区、路由区、`onListening`）

- [ ] **Step 1: 加 import**

在 `server/index.js:66` 的 `import { restartGuard, spawnRestart } from './port-restart.js';` 之后插入：

```js
import { available as fileAssocAvailable, getState as getFileAssocState, loadPref as loadFileAssocPref, savePref as saveFileAssocPref, runAssoc as runFileAssoc } from './file-assoc.js';
```

- [ ] **Step 2: 在 `/api/settings/language` 路由块之后加 `/api/file-assoc` 路由**

在 `server/index.js` 的 `/api/settings/language` `return;` 之后的 `}` 之后、`if (url.pathname === '/api/remote/state'` 之前插入：

```js
  if (url.pathname === '/api/file-assoc' && req.method === 'GET') {
    const pref = loadFileAssocPref(APP_DIR);
    const st = await getFileAssocState({ appDir: APP_DIR });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ available: st.available, enabled: !!pref.enabled, prompted: !!pref.prompted, extensions: st.extensions }));
    return;
  }
  if (url.pathname === '/api/file-assoc' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const avail = fileAssocAvailable({ appDir: APP_DIR });
      if (!avail.ok) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not-available' }));
        return;
      }
      const next = saveFileAssocPref(APP_DIR, { enabled: !!body.enabled, prompted: true });
      runFileAssoc(APP_DIR, next.enabled ? 'apply' : 'remove');
      const st = await getFileAssocState({ appDir: APP_DIR });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ available: true, enabled: next.enabled, prompted: true, extensions: st.extensions }));
    });
    return;
  }
```

- [ ] **Step 3: 加启动兜底**

在 `server/index.js:987` 的 `log.info(\`listening on ...\`);` 之后插入：

```js
    try {
      const pref = loadFileAssocPref(APP_DIR);
      if (pref.enabled && fileAssocAvailable({ appDir: APP_DIR }).ok) runFileAssoc(APP_DIR, 'apply');
    } catch { /* ignore */ }
```

- [ ] **Step 4: 冒烟：dev 下接口可用性**

先在 `logs\` 下后台起 dev server（AGENTS.md 规范，勿在根目录丢日志）：

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:server" -WorkingDirectory "D:\root\devflow\devflow" -WindowStyle Minimized -RedirectStandardOutput "logs\dev-server.log" -RedirectStandardError "logs\dev-server.err.log"
```

等约 3 秒后：

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:33333/api/file-assoc).Content
```

Expected: `{"available":false,"enabled":false,"prompted":false,"extensions":[...11 项 isDefault:false]}`（dev 非绿色包 → available:false）。

- [ ] **Step 5: Stage & report**

```bash
git add server/index.js
git status --short
```

---

## Task 4: 前端数据层（`web/src/fileAssoc.ts`）

**Files:**
- Create: `web/src/fileAssoc.ts`
- Test: `web/src/fileAssoc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/fileAssoc.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getFileAssoc, setFileAssoc } from './fileAssoc';

afterEach(() => { vi.unstubAllGlobals(); });

describe('fileAssoc api', () => {
  it('getFileAssoc 返回状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ available: true, enabled: false, prompted: false, extensions: [] }) })));
    const r = await getFileAssoc();
    expect(r?.available).toBe(true);
    expect(r?.prompted).toBe(false);
  });

  it('getFileAssoc 网络异常返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('x'); }));
    expect(await getFileAssoc()).toBeNull();
  });

  it('setFileAssoc 发 POST 并带 enabled', async () => {
    const fn = vi.fn(async () => ({ ok: true, json: async () => ({ available: true, enabled: true, prompted: true, extensions: [] }) }));
    vi.stubGlobal('fetch', fn);
    const r = await setFileAssoc(true);
    expect(fn.mock.calls[0][0]).toBe('/api/file-assoc');
    expect((fn.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect((fn.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ enabled: true }));
    expect(r?.enabled).toBe(true);
  });

  it('setFileAssoc 非 2xx 返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) })));
    expect(await setFileAssoc(false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix web run test`
Expected: FAIL（`Cannot find module './fileAssoc'`）。

- [ ] **Step 3: Write minimal implementation**

Create `web/src/fileAssoc.ts`:

```ts
export interface FileAssocExt { ext: string; isDefault: boolean }
export interface FileAssocState { available: boolean; enabled: boolean; prompted: boolean; extensions: FileAssocExt[] }

export async function getFileAssoc(): Promise<FileAssocState | null> {
  try {
    const r = await fetch('/api/file-assoc');
    if (!r.ok) return null;
    return (await r.json()) as FileAssocState;
  } catch { return null; }
}

export async function setFileAssoc(enabled: boolean): Promise<FileAssocState | null> {
  try {
    const r = await fetch('/api/file-assoc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!r.ok) return null;
    return (await r.json()) as FileAssocState;
  } catch { return null; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd --prefix web run test`
Expected: PASS（fileAssoc 4 条通过）。

- [ ] **Step 5: Stage & report**

```bash
git add web/src/fileAssoc.ts web/src/fileAssoc.test.ts
git status --short
```

---

## Task 5: 设置面板「文件关联」区（`web/src/components/TerminalView.vue`）

**Files:**
- Modify: `web/src/components/TerminalView.vue`（import、state、`onOpenSettings`、`confirmSettings`、模板 general 页签）

- [ ] **Step 1: 加 import**

在 `web/src/components/TerminalView.vue` 现有 script 顶部 import 区（`import { ... } from '../...'` 附近）加：

```ts
import { getFileAssoc, setFileAssoc } from '../fileAssoc';
```

- [ ] **Step 2: 加 state 与加载函数**

在 `const restarting = ref(false);`（约 300 行）之后插入：

```ts
const assocAvailable = ref(false);
const assocEnabled = ref(false);
const assocLoaded = ref(false);
const assocPrompted = ref(true);
const assocExts = ref<{ ext: string; isDefault: boolean }[]>([]);
const assocMsg = ref('');
async function loadFileAssoc() {
  const r = await getFileAssoc();
  if (!r) { assocAvailable.value = false; return; }
  assocAvailable.value = r.available;
  assocPrompted.value = r.prompted;
  assocEnabled.value = r.prompted ? r.enabled : true;   // 首启（未提示过）默认勾选
  assocLoaded.value = r.enabled;
  assocExts.value = r.extensions || [];
}
```

- [ ] **Step 3: `onOpenSettings` 里加载**

把 `onOpenSettings` 改为（在 `loadSettings();` 后加一行）：

```ts
function onOpenSettings(e: Event) {
  const firstRun = !!(e as CustomEvent).detail?.firstRun;
  settingsOpen.value = true;
  loadSettings();
  loadFileAssoc();
  firstRunHint.value = firstRun;
  if (firstRun) nextTick(() => agentSecRef.value?.scrollIntoView({ block: 'start' }));
}
```

- [ ] **Step 4: `confirmSettings` 里保存**

把 `confirmSettings` 开头改为：

```ts
async function confirmSettings() {
  portMsg.value = '';
  assocMsg.value = '';
  if (assocAvailable.value && (!assocPrompted.value || assocEnabled.value !== assocLoaded.value)) {
    const r = await setFileAssoc(assocEnabled.value);
    if (r) {
      assocEnabled.value = r.enabled;
      assocLoaded.value = r.enabled;
      assocPrompted.value = r.prompted;
      assocExts.value = r.extensions || [];
    } else {
      assocMsg.value = t('term.file_assoc_failed');
    }
  }
  const plan = planConfirm({ port: Number(serverPort.value), loadedPort: loadedPort.value, state: portState.value });
  // ...（其余保持不变）
```

- [ ] **Step 5: 加模板区块**

在 general 页签的「服务」`setsec`（约 1171-1178 行）之后插入：

```html
          <div v-if="assocAvailable" class="setsec">
            <div class="settitle">{{ $t('term.file_assoc') }}</div>
            <label class="chkrow">
              <input type="checkbox" v-model="assocEnabled" />
              <span>{{ $t('term.file_assoc_label') }}</span>
            </label>
            <div class="cfghint">{{ $t('term.file_assoc_hint') }}</div>
            <div class="cfghint">{{ assocExts.map((x) => (x.isDefault ? '✓ ' : '· ') + x.ext).join('　') }}</div>
            <div v-if="assocMsg" class="cfghint warn">{{ assocMsg }}</div>
          </div>
```

- [ ] **Step 6: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无错误（词条键此时可能报缺，先做 Task 7 再复跑；若仅有 `term.file_assoc*` 相关报错，继续 Task 7）。

- [ ] **Step 7: Stage & report**

```bash
git add web/src/components/TerminalView.vue
git status --short
```

---

## Task 6: 首启自动打开设置（`web/src/App.vue`）

**Files:**
- Modify: `web/src/App.vue`（`checkFirstRunAgentChoice` 附近、`onMounted`）

- [ ] **Step 1: 加首启探测**

在 `web/src/App.vue` 的 `checkFirstRunAgentChoice` 函数之后插入：

```ts
const pendingFileAssoc = ref(false);
async function checkFirstRunFileAssoc() {
  try {
    const r = await fetch('/api/file-assoc').then((x) => x.json());
    if (r?.available && !r?.prompted) pendingFileAssoc.value = true;
  } catch { /* 探测失败不阻塞 */ }
}
```

- [ ] **Step 2: 合入 `projectsReady` 与 finally 分支**

把 `onMounted` 里的：

```ts
  const projectsReady = (async () => { await checkFirstRunAgentChoice(); await loadProjects(); })();
  void restoreWindowState(projectsReady).finally(() => { if (pendingAgentChoice.value) openAgentSettings(true); });
```

改为：

```ts
  const projectsReady = (async () => { await checkFirstRunAgentChoice(); await checkFirstRunFileAssoc(); await loadProjects(); })();
  void restoreWindowState(projectsReady).finally(() => { if (pendingAgentChoice.value || pendingFileAssoc.value) openAgentSettings(true); });
```

- [ ] **Step 3: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无新增错误。

- [ ] **Step 4: Stage & report**

```bash
git add web/src/App.vue
git status --short
```

---

## Task 7: i18n 词条（中英对称）

**Files:**
- Modify: `shared/i18n/zh-CN.js`（`term.service_hint` 一带）
- Modify: `shared/i18n/en.js`（对应位置）

- [ ] **Step 1: zh-CN 新增（放在 `'term.service_hint'` 行之后）**

```js
  'term.file_assoc': '文件关联',
  'term.file_assoc_label': '把以下文件的默认打开方式设为 Void',
  'term.file_assoc_hint': '勾选后点「确定」立即生效；之后每次启动会自动校正为 Void。取消勾选可移除登记。',
  'term.file_assoc_failed': '文件关联设置失败：{msg}',
```

- [ ] **Step 2: en 新增（放在 `'term.service_hint'` 对应行之后）**

```js
  'term.file_assoc': 'File associations',
  'term.file_assoc_label': 'Set Void as the default app for these files',
  'term.file_assoc_hint': 'Applied when you click Done; re-applied automatically on each start. Uncheck to remove.',
  'term.file_assoc_failed': 'Failed to update file associations: {msg}',
```

- [ ] **Step 3: 校验中英对称 + 无硬编码中文**

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 4: Stage & report**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git status --short
```

---

## Task 8: 全量验证

**Files:** 无（只跑命令）

- [ ] **Step 1: 服务端 + 前端测试**

Run: `npm.cmd test`
Expected: 全绿。

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误。

- [ ] **Step 3: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: `未发现中文命中`。

- [ ] **Step 4: 前端构建**

Run: `npm.cmd run build:web`
Expected: 成功产出 `web/dist`。

- [ ] **Step 5: 清理 dev 进程**

把 Task 3 Step 4 起的 dev server 进程结束（PowerShell：按命令行匹配 `server/index.js` 且端口 33333 的 PID `Stop-Process`）。

- [ ] **Step 6: 人工验收（需要用户在有图形界面的 Windows 上执行，属于打包后验证）**

1. `node scripts/build.js` 打包，进 `dist-portable\vscode-ai-windows-x64-<version>\`，双击 `start.bat`。
2. 设置面板自动打开，「文件关联」默认勾选 → 点「确定」。
3. 检查注册表：`HKCU\Software\Classes\.md\(Default)` = `Void`，`HKCU\...\FileExts\.md\UserChoice` 不存在。
4. 双击 `.md`/`.yaml`/`.json` 等文件均用 Void 打开。
5. 手动把 `.md` 默认改回 VS Code → 重启（关掉再 `start.bat`）→ 默认又变回 Void。
6. 打开设置取消勾选 → 「确定」→ 双击文件不再用 Void 打开。

---

## 自检（写计划时已核对）

- **Spec 覆盖**：注册表写法（Task 2）、偏好文件（Task 1）、可用性判定（Task 1/3）、GET/POST 接口（Task 3）、启动兜底（Task 3）、设置面板 + 默认勾选（Task 5）、首启自动打开（Task 6）、i18n（Task 7）、测试与验收（Task 1/2/4/8）——均有对应任务。
- **命名一致**：`available` / `getState` / `loadPref` / `savePref` / `runAssoc` / `EXTENSIONS` / `prefFile` 在 Task 1 定义，Task 3 与测试沿用同名。
- **无占位符**：每个代码步骤给出完整代码；命令给出预期输出。
- **风险**：`DeleteSubKeyTree` 在个别机器可能因 UserChoice 的 DENY ACE 失败 —— 已 try/catch 包裹，失败则该扩展仍是旧默认（不阻断其它扩展）。
