# 端口改完能真正生效（启动器幂等 + 界面一键重启）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本项目按 AGENTS.md 规定使用 inline 执行**（本会话内执行，不用 subagent 驱动）。

**Goal:** 让「界面改端口 → 重启」在绿色包上一键闭环，并让双击 `start.bat` / `start.command` 幂等地应用新端口。

**Architecture:** 启动器引入 `desired`（`data/port.txt`，期望端口）与 `running`（`data/runtime-port.txt`，上次实际运行端口）双概念：`desired != running` 且旧实例存活即视为「重启」。启动器源码抽到 `scripts/launcher.js` 以便单测，并加 `-Plan`/`--plan` 只算不做的钩子。服务端新增 `POST /api/server/restart`：以 detached 助手等待自身退出后重新拉起 `start.bat`/`start.command`；dev（`DEVFLOW_PORT` 已设）与非绿色包直接 409 拒绝并给出可读原因。

**Tech Stack:** Node 24 ESM（`node --test`）、PowerShell 5.1 / bash（启动器）、Vue 3 + Vite + TS（`vitest` + `vue-tsc`）。

**Spec:** `docs/superpowers/specs/2026-09-15-port-restart-design.md`

**通用约定**

- 命令在仓库根 `D:\root\devflow\devflow` 执行；npm 一律 `npm.cmd`。
- 单测：`node --test "server/test/<file>.test.js"`。
- 每个 Task：跑相关测试 → `git add <具体文件>`（禁止 `git add -A`）→ commit；提交前按 `docs/learn/git仓库提交检查和提交事项.md` 扫描敏感信息。

---

### Task 1: 抽出启动器生成器 `scripts/launcher.js`（含新端口语义 + `-Plan` 钩子）

**Files:**
- Create: `scripts/launcher.js`
- Test: `server/test/launcher.test.js`

- [ ] **Step 1: 写失败测试 `server/test/launcher.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeLaunchPs1, makeLaunchSh, makeStartCommand } = require('../../scripts/launcher.js');

test('launch.ps1 含 desired/running 双端口与 -Plan 钩子', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /param\(\[switch\]\$NoBrowser, \[switch\]\$NoShortcut, \[switch\]\$Plan/);
  assert.match(ps, /'data\\port\.txt'/);
  assert.match(ps, /'data\\runtime-port\.txt'/);
  assert.match(ps, /\$desired/);
  assert.match(ps, /\$running/);
  assert.match(ps, /PLAN desired=\{0\} running=\{1\} alive=\{2\} action=\{3\}/);
  assert.match(ps, /-f \$desired, \$running, \[int\]\$alive, \$action/);
});

test('launch.ps1 结束旧实例前有安全校验（只杀本应用）', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /runtime\\node\.exe/);
  assert.match(ps, /server\\\\index\\\.js/, '命令行匹配 server\\\\index\\.js（PS 正则转义）');
  assert.match(ps, /Stop-Process/);
  assert.match(ps, /WARN/, '非本应用进程要打印告警而不是杀掉');
});

test('launch.ps1 保留原有能力（快捷方式 / Open-with / 浏览器）', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /Void\.lnk/);
  assert.match(ps, /OpenWithProgids/);
  assert.match(ps, /\?open=/);
  assert.match(ps, /22222/, '默认端口写入脚本');
});

test('launch.sh 含 desired 优先、nc 存活探测与 --plan 钩子', () => {
  const sh = makeLaunchSh({ port: 22222 });
  assert.match(sh, /data\/port\.txt/);
  assert.match(sh, /data\/runtime-port\.txt/);
  assert.match(sh, /--plan/);
  assert.match(sh, /PLAN desired=/);
  assert.match(sh, /nc -z 127\.0\.0\.1 "\$RUNNING"/);
  assert.match(sh, /exec "\$DIR\/runtime\/node" "server\/index\.js"/);
});

test('start.command 只转发到 launch.sh', () => {
  const sc = makeStartCommand();
  assert.match(sc, /exec "\$DIR\/script\/launch\.sh" "\$@"/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/launcher.test.js"`
Expected: FAIL — `Cannot find module '../../scripts/launcher.js'`

- [ ] **Step 3: 实现 `scripts/launcher.js`**

```js
"use strict";
// 绿色包启动器生成器：Windows(launch.ps1) / macOS(launch.sh, start.command)
// 端口语义：desired = data/port.txt（期望端口）；running = data/runtime-port.txt（上次实际运行端口）
// desired != running 且 running 仍在监听 → 结束旧实例并按 desired 重启。

function makeLaunchPs1({ port }) {
  return [
    "param([switch]$NoBrowser, [switch]$NoShortcut, [switch]$Plan, [string]$Open = '')",
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$scriptDir = $PSScriptRoot",
    "if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }",
    "$root = Split-Path -Parent $scriptDir",
    "$fallback = " + port,
    "$desired = $fallback",
    "$df = Join-Path $root 'data\\port.txt'",
    "if (Test-Path $df) { $t = (Get-Content -Raw $df).Trim(); if ($t -match '^\\d+$') { $desired = [int]$t } }",
    "$running = $desired",
    "$rf = Join-Path $root 'data\\runtime-port.txt'",
    "if (Test-Path $rf) { $t = (Get-Content -Raw $rf).Trim(); if ($t -match '^\\d+$') { $running = [int]$t } }",
    "function Test-Port([int]$p) {",
    "  try {",
    "    $c = New-Object System.Net.Sockets.TcpClient",
    "    $iar = $c.BeginConnect('127.0.0.1', $p, $null, $null)",
    "    if (-not $iar.AsyncWaitHandle.WaitOne(300)) { $c.Close(); return $false }",
    "    $c.EndConnect($iar); $c.Close(); return $true",
    "  } catch { return $false }",
    "}",
    "$alive = Test-Port $running",
    "if ($alive -and ($desired -ne $running)) { $action = 'restart' }",
    "elseif ($alive) { $action = 'open' }",
    "else { $action = 'start' }",
    "if ($Plan) {",
    "  Write-Output ('PLAN desired={0} running={1} alive={2} action={3}' -f $desired, $running, [int]$alive, $action)",
    "  exit 0",
    "}",
    "$openPort = $desired",
    "if ($action -eq 'restart') {",
    "  $killed = $false",
    "  try {",
    "    $conns = Get-NetTCPConnection -State Listen -LocalPort $running -ErrorAction SilentlyContinue",
    "    foreach ($c in @($conns)) {",
    "      $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess) -ErrorAction SilentlyContinue",
    "      if (-not $p) { continue }",
    "      $exe = [string]$p.ExecutablePath",
    "      $cmd = [string]$p.CommandLine",
    "      $isOurs = ($exe -ieq (Join-Path $root 'runtime\\node.exe')) -or ($cmd -match 'server\\\\index\\.js')",
    "      if ($isOurs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $killed = $true }",
    "      else { Write-Output ('WARN 端口 {0} 被非本应用进程占用（PID {1}），未结束' -f $running, $p.ProcessId) }",
    "    }",
    "  } catch { }",
    "  if ($killed) { Start-Sleep -Milliseconds 500 }",
    "}",
    "if ($action -eq 'open') { $openPort = $running }",
    "if ($action -ne 'open') {",
    "  Start-Process -FilePath (Join-Path $root 'runtime\\node.exe') -ArgumentList 'server\\index.js' -WorkingDirectory $root -WindowStyle Minimized",
    "  $deadline = (Get-Date).AddSeconds(15)",
    "  while ((Get-Date) -lt $deadline -and -not (Test-Port $openPort)) { Start-Sleep -Milliseconds 400 }",
    "}",
    "if (-not $NoShortcut) {",
    "  try {",
    "    $desktop = [Environment]::GetFolderPath('Desktop')",
    "    if ($desktop -and (Test-Path $desktop)) {",
    "      $ws = New-Object -ComObject WScript.Shell",
    "      $lnk = $ws.CreateShortcut((Join-Path $desktop 'Void.lnk'))",
    "      $lnk.TargetPath = Join-Path $root 'start.bat'",
    "      $lnk.WorkingDirectory = $root",
    "      $lnk.IconLocation = (Join-Path $scriptDir 'icon.ico')",
    "      $lnk.Description = 'Void'",
    "      $lnk.Save()",
    "    }",
    "  } catch { }",
    "}",
    "if (-not $NoBrowser) {",
    "  if ($Open) { Start-Process ('http://127.0.0.1:{0}/?open={1}' -f $openPort, [uri]::EscapeDataString($Open)) }",
    "  else { Start-Process ('http://127.0.0.1:{0}' -f $openPort) }",
    "}",
    "# First run: ask whether to register in the Open with menu (ask once; does not change defaults)",
    "$marker = Join-Path $env:APPDATA 'devflow\\assoc-prompted.txt'",
    "if (-not (Test-Path $marker)) {",
    "  $msg = 'Register Void in the \"Open with\" menu for Markdown, YAML, JavaScript, JSON and cURL files? (The default app is not changed.)'",
    "  $yes = $false",
    "  try {",
    "    $wsh = New-Object -ComObject WScript.Shell",
    "    $r = $wsh.Popup($msg, 0, 'Void', 4 + 32 + 4096)",
    "    if ($r -eq 6) { $yes = $true }",
    "  } catch { }",
    "  if ($yes) {",
    "    try {",
    "      $cu = [Microsoft.Win32.Registry]::CurrentUser",
    "      $prog = $cu.CreateSubKey('Software\\Classes\\Void')",
    "      $prog.SetValue('', 'Void')",
    "      $cmd = $prog.CreateSubKey('shell\\open\\command')",
    "      $cmd.SetValue('', ('\"' + (Join-Path $root 'start.bat') + '\" \"%1\"'))",
    "      $cmd.Close()",
    "      $icon = $prog.CreateSubKey('DefaultIcon')",
    "      $icon.SetValue('', (Join-Path $scriptDir 'icon.ico'))",
    "      $icon.Close()",
    "      $prog.Close()",
    "      $exts = @('.md', '.markdown', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.json', '.http', '.rest', '.curl')",
    "      foreach ($e in $exts) {",
    "        $k = $cu.CreateSubKey(\"Software\\\\Classes\\\\$($e)\\\\OpenWithProgids\")",
    "        $k.SetValue('Void', (New-Object byte[] 0), [Microsoft.Win32.RegistryValueKind]::None)",
    "        $k.Close()",
    "      }",
    "    } catch { }",
    "  }",
    "  try {",
    "    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $marker) | Out-Null",
    "    Set-Content -Path $marker -Value '1'",
    "  } catch { }",
    "}",
    "",
  ].join("\r\n");
}

function makeLaunchSh({ port }) {
  return [
    "#!/bin/bash",
    "# Void launcher (macOS). Run start.command, or: bash script/launch.sh",
    "set -u",
    'DIR="$(cd "$(dirname "$0")/.." && pwd)"',
    'cd "$DIR" || exit 1',
    "",
    "# desired = data/port.txt（期望端口）；running = data/runtime-port.txt（上次实际运行端口）",
    "FALLBACK=" + port,
    'DESIRED="$FALLBACK"',
    'if [ -f "data/port.txt" ]; then',
    '  T="$(tr -cd \'0-9\' < "data/port.txt")"; if [ -n "$T" ]; then DESIRED="$T"; fi',
    "fi",
    'RUNNING="$DESIRED"',
    'if [ -f "data/runtime-port.txt" ]; then',
    '  T="$(tr -cd \'0-9\' < "data/runtime-port.txt")"; if [ -n "$T" ]; then RUNNING="$T"; fi',
    "fi",
    'PORT="$DESIRED"',
    'URL="http://127.0.0.1:${PORT}"',
    "",
    "# 存活探测",
    'if /usr/bin/nc -z 127.0.0.1 "$RUNNING" >/dev/null 2>&1; then ALIVE=1; else ALIVE=0; fi',
    'if [ "$ALIVE" = "1" ] && [ "$RUNNING" != "$DESIRED" ]; then ACTION="restart";',
    'elif [ "$ALIVE" = "1" ]; then ACTION="open"; PORT="$RUNNING"; URL="http://127.0.0.1:${RUNNING}";',
    'else ACTION="start"; fi',
    'if [ "${1:-}" = "--plan" ]; then',
    '  echo "PLAN desired=${DESIRED} running=${RUNNING} alive=${ALIVE} action=${ACTION}"',
    "  exit 0",
    "fi",
    "",
    "# 已在期望端口运行：只打开浏览器",
    'if [ "$ACTION" = "open" ]; then',
    '  open "$URL"',
    "  exit 0",
    "fi",
    "",
    "# 期望端口与运行端口不一致：mac 为前台运行，提示用户关窗后重开",
    'if [ "$ACTION" = "restart" ]; then',
    '  echo "已在 :${RUNNING} 运行；关闭该终端窗口后重新打开 start.command 即会切到 :${DESIRED}"',
    '  open "http://127.0.0.1:${RUNNING}"',
    "  exit 0",
    "fi",
    "",
    "# 未运行：稍后自动开浏览器，然后前台启动服务（关闭本终端窗口或 Ctrl-C 即停止）",
    '( sleep 1.5; open "$URL" ) >/dev/null 2>&1 &',
    'exec "$DIR/runtime/node" "server/index.js"',
    "",
  ].join("\n");
}

function makeStartCommand() {
  return [
    "#!/bin/bash",
    'DIR="$(cd "$(dirname "$0")" && pwd)"',
    'exec "$DIR/script/launch.sh" "$@"',
    "",
  ].join("\n");
}

module.exports = { makeLaunchPs1, makeLaunchSh, makeStartCommand };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/launcher.test.js"`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add scripts/launcher.js server/test/launcher.test.js
git commit -m "feat(build): 抽出启动器生成器 launcher.js（desired/running 双端口语义 + -Plan 钩子）"
```

---

### Task 2: `build.js` / `build-mac.js` 改用 `scripts/launcher.js`

**Files:**
- Modify: `scripts/build.js:143-233`
- Modify: `scripts/build-mac.js:131-171`

- [ ] **Step 1: `scripts/build.js` 换用生成器**

- 在文件顶部 require 区加入：
  ```js
  const { makeLaunchPs1 } = require("./launcher.js");
  ```
- 删除第 143-219 行的 `const launchPs1 = [ ... ].join("\r\n");`，替换为：
  ```js
  const launchPs1 = makeLaunchPs1({ port: CFG_PORT });
  ```
- 第 222-233 行（写 `script/launch.ps1` 与 `start.bat`）**保持不变**。

- [ ] **Step 2: `scripts/build-mac.js` 换用生成器**

- 顶部 require 区加入：
  ```js
  const { makeLaunchSh, makeStartCommand } = require("./launcher.js");
  ```
- 删除 `makeLaunchSh()`（约 131-162 行）与 `makeStartCommand()`（约 164-171 行）两个本地函数。
- 所有调用点改为传入端口：`makeLaunchSh({ port: CFG_PORT })`、`makeStartCommand()`（无参不变）。
  Run: `Select-String -Path scripts/build-mac.js -Pattern "makeLaunchSh|makeStartCommand"` 确认调用点都已改。

- [ ] **Step 3: 语法与产物校验**

Run: `node --check scripts/build.js; node --check scripts/build-mac.js; node --check scripts/launcher.js`
Expected: 无输出

Run: `node scripts/build.js --no-zip`
Expected: 成功；随后
`Select-String -Path dist-portable/vscode-ai-windows-x64-*/script/launch.ps1 -Pattern "PLAN desired=|runtime\\node\.exe"` 有命中

- [ ] **Step 4: 提交**

```bash
git add scripts/build.js scripts/build-mac.js
git commit -m "build: 两个打包脚本改用 launcher.js 生成启动器"
```

---

### Task 3: 启动器决策的真实行为测试（PowerShell `-Plan`）

**Files:**
- Test: `server/test/launcher-plan.test.js`

- [ ] **Step 1: 写测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeLaunchPs1 } = require('../../scripts/launcher.js');

const isWin = process.platform === 'win32';

// 起一个一次性 TCP 监听，用来制造「端口存活」
function listen(port) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

function writeLauncher({ desired, running }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-plan-'));
  fs.mkdirSync(path.join(root, 'script'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'script', 'launch.ps1'), makeLaunchPs1({ port: 22222 }), 'utf8');
  if (desired != null) fs.writeFileSync(path.join(root, 'data', 'port.txt'), String(desired), 'utf8');
  if (running != null) fs.writeFileSync(path.join(root, 'data', 'runtime-port.txt'), String(running), 'utf8');
  return path.join(root, 'script', 'launch.ps1');
}

function runPlan(script) {
  return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Plan', '-NoBrowser', '-NoShortcut'], { encoding: 'utf8' });
}

test('desired == running 且存活 → action=open', { skip: !isWin }, async () => {
  const p = await freePort();
  const srv = await listen(p);
  try {
    const out = runPlan(writeLauncher({ desired: p, running: p }));
    assert.match(out, new RegExp(`PLAN desired=${p} running=${p} alive=1 action=open`));
  } finally { srv.close(); }
});

test('desired != running 且 running 存活 → action=restart', { skip: !isWin }, async () => {
  const running = await freePort();
  const desired = await freePort();
  const srv = await listen(running);
  try {
    const out = runPlan(writeLauncher({ desired, running }));
    assert.match(out, new RegExp(`PLAN desired=${desired} running=${running} alive=1 action=restart`));
  } finally { srv.close(); }
});

test('running 不存活 → action=start', { skip: !isWin }, async () => {
  const running = await freePort();   // 拿到就关掉了，没人监听
  const desired = await freePort();
  const out = runPlan(writeLauncher({ desired, running }));
  assert.match(out, new RegExp(`PLAN desired=${desired} running=${running} alive=0 action=start`));
});

test('缺 port.txt → desired 回落到构建默认端口', { skip: !isWin }, async () => {
  const running = await freePort();
  const out = runPlan(writeLauncher({ running }));
  assert.match(out, /PLAN desired=22222 /);
});
```

- [ ] **Step 2: 跑测试**

Run: `node --test "server/test/launcher-plan.test.js"`
Expected: PASS（Windows 上 4 tests；其它平台 4 skipped）

- [ ] **Step 3: 手工确认 `-Plan` 不启动任何东西**

Run: `node scripts/build.js --no-zip` 后取一个产物目录执行
`powershell -NoProfile -ExecutionPolicy Bypass -File <产物>/script/launch.ps1 -Plan -NoBrowser -NoShortcut`
Expected: 只打印一行 `PLAN ...`，进程列表里没有新增 node

- [ ] **Step 4: 提交**

```bash
git add server/test/launcher-plan.test.js
git commit -m "test(build): 用 PowerShell -Plan 真跑启动器三场景决策"
```

---

### Task 4: 服务端重启守卫与助手 `server/port-restart.js`

**Files:**
- Create: `server/port-restart.js`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`（新增 5 条）
- Test: `server/test/port-restart.test.js`

- [ ] **Step 1: 先加 i18n 词条（中英对称）**

`shared/i18n/zh-CN.js`（放在 `term.port_saved` 附近）：

```js
  'term.port_restart': '重启后端',
  'term.port_restarting': '重启中…',
  'term.port_restart_failed': '重启失败：{msg}',
  'term.port_restart_pinned': 'dev 模式端口由 DEVFLOW_PORT 固定，请在环境变量里改',
  'term.port_restart_notpackaged': '仅绿色包支持一键重启',
```

`shared/i18n/en.js`：

```js
  'term.port_restart': 'Restart backend',
  'term.port_restarting': 'Restarting…',
  'term.port_restart_failed': 'Restart failed: {msg}',
  'term.port_restart_pinned': 'In dev the port is pinned by DEVFLOW_PORT; change it via the env var',
  'term.port_restart_notpackaged': 'One-click restart is only available in the portable build',
```

- [ ] **Step 2: 写失败测试 `server/test/port-restart.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { restartGuard, spawnRestart } from '../port-restart.js';

function tmpApp({ withBat = false, withCommand = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-restart-'));
  if (withBat) fs.writeFileSync(path.join(dir, 'start.bat'), '@echo off\n', 'utf8');
  if (withCommand) fs.writeFileSync(path.join(dir, 'start.command'), '#!/bin/bash\n', 'utf8');
  return dir;
}

test('DEVFLOW_PORT 已设 → env-port-pinned', () => {
  const appDir = tmpApp({ withBat: true });
  const g = restartGuard({ appDir, envPort: '33333', platform: 'win32' });
  assert.equal(g.ok, false);
  assert.equal(g.code, 'env-port-pinned');
  assert.match(g.message, /DEVFLOW_PORT/);
});

test('非绿色包（无 start.bat / start.command）→ not-packaged', () => {
  const appDir = tmpApp();
  assert.equal(restartGuard({ appDir, envPort: '', platform: 'win32' }).code, 'not-packaged');
  assert.equal(restartGuard({ appDir, envPort: '', platform: 'darwin' }).code, 'not-packaged');
});

test('绿色包（有 start.bat）且未设 env → 放行', () => {
  const appDir = tmpApp({ withBat: true });
  const g = restartGuard({ appDir, envPort: '', platform: 'win32' });
  assert.equal(g.ok, true);
  assert.equal(g.launcher, 'start.bat');
});

test('env 为空串/未定义视为未设', () => {
  const appDir = tmpApp({ withBat: true });
  assert.equal(restartGuard({ appDir, envPort: undefined, platform: 'win32' }).ok, true);
  assert.equal(restartGuard({ appDir, envPort: '   ', platform: 'win32' }).ok, true);
});

test('spawnRestart：Windows 用等待本进程退出的助手并 detached', () => {
  const calls = [];
  const fakeSpawn = (bin, args, opts) => { calls.push({ bin, args, opts }); return { unref() { calls.push({ unref: true }); } }; };
  spawnRestart({ appDir: 'C:\\app', pid: 4321, platform: 'win32', spawnFn: fakeSpawn });
  assert.equal(calls[0].bin, 'powershell.exe');
  assert.ok(calls[0].args.join(' ').includes('Wait-Process -Id 4321'));
  assert.ok(calls[0].args.join(' ').includes('start.bat'));
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.windowsHide, true);
  assert.deepEqual(calls[1], { unref: true });
});

test('spawnRestart：macOS 轮询进程退出后 open start.command', () => {
  const calls = [];
  const fakeSpawn = (bin, args, opts) => { calls.push({ bin, args, opts }); return { unref() {} }; };
  spawnRestart({ appDir: '/app', pid: 99, platform: 'darwin', spawnFn: fakeSpawn });
  assert.equal(calls[0].bin, 'sh');
  assert.ok(calls[0].args.join(' ').includes('kill -0 99'));
  assert.ok(calls[0].args.join(' ').includes('start.command'));
  assert.equal(calls[0].opts.detached, true);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test "server/test/port-restart.test.js"`
Expected: FAIL — `Cannot find module .../port-restart.js`

- [ ] **Step 4: 实现 `server/port-restart.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { t } from './i18n.js';

export const RESTART_CODES = { ENV_PINNED: 'env-port-pinned', NOT_PACKAGED: 'not-packaged' };

// 绿色包才能一键重启：非绿色包没有启动器；dev 的端口被 DEVFLOW_PORT 钉住，重启也换不了端口
export function restartGuard({ appDir, envPort = process.env.DEVFLOW_PORT, platform = process.platform, exists = fs.existsSync } = {}) {
  if (envPort != null && String(envPort).trim() !== '') {
    return { ok: false, code: RESTART_CODES.ENV_PINNED, message: t('term.port_restart_pinned') };
  }
  const launcher = platform === 'win32' ? 'start.bat' : 'start.command';
  if (!exists(path.join(appDir, launcher))) {
    return { ok: false, code: RESTART_CODES.NOT_PACKAGED, message: t('term.port_restart_notpackaged') };
  }
  return { ok: true, launcher };
}

// 异步（detached + unref）拉起「等我退出后重启我」的助手；调用方随后应立即 process.exit(0)
export function spawnRestart({ appDir, pid = process.pid, platform = process.platform, spawnFn = spawn } = {}) {
  const child = platform === 'win32'
    ? spawnFn('powershell.exe', [
        '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
        `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; Start-Process -FilePath '${path.join(appDir, 'start.bat')}'`,
      ], { cwd: appDir, detached: true, stdio: 'ignore', windowsHide: true })
    : spawnFn('sh', [
        '-c',
        `while kill -0 ${pid} 2>/dev/null; do sleep 0.3; done; open "${path.join(appDir, 'start.command')}"`,
      ], { cwd: appDir, detached: true, stdio: 'ignore' });
  if (child && typeof child.unref === 'function') child.unref();
  return true;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test "server/test/port-restart.test.js"`
Expected: PASS（6 tests）

- [ ] **Step 6: 提交**

```bash
git add server/port-restart.js server/test/port-restart.test.js shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(server): 重启守卫与 detached 重启助手（port-restart）"
```

---

### Task 5: `POST /api/server/restart` + `/api/settings` 增加 `restartable`/`portSource`

**Files:**
- Modify: `server/index.js:33,331-336`（import、settings GET，新增 restart 路由）
- Test: `server/test/server-port.test.js`（追加）或新建 `server/test/server-restart.test.js`

- [ ] **Step 1: 写测试 `server/test/server-restart.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { restartGuard, RESTART_CODES } from '../port-restart.js';

// 与 index.js 的接线一致：guard 的判定就是接口的 409 条件
test('接口 409 条件：env 钉住', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-srvrestart-'));
  fs.writeFileSync(path.join(dir, 'start.bat'), '', 'utf8');
  const g = restartGuard({ appDir: dir, envPort: '33333', platform: 'win32' });
  assert.equal(g.code, RESTART_CODES.ENV_PINNED);
});

test('接口 409 条件：非绿色包', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-srvrestart-'));
  const g = restartGuard({ appDir: dir, envPort: '', platform: 'win32' });
  assert.equal(g.code, RESTART_CODES.NOT_PACKAGED);
});

test('接口放行条件：有 start.bat 且未设 env → restartable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-srvrestart-'));
  fs.writeFileSync(path.join(dir, 'start.bat'), '@echo off\n', 'utf8');
  assert.equal(restartGuard({ appDir: dir, envPort: '', platform: 'win32' }).ok, true);
});
```

> 注：`portSource`（`'env' | 'file' | 'default'`）由 `server/port-file.js` 的 `readPortFile()` 与 `validPort(process.env.DEVFLOW_PORT)` 组合得到（Task 1 的 `port-file.test.js` 已覆盖这两个输入），在 Task 5 Step 3 的 `index.js` 里接线；这里不再重复造测试。

- [ ] **Step 2: 跑测试**

Run: `node --test "server/test/server-restart.test.js"`
Expected: PASS（3 tests）

- [ ] **Step 3: 改 `server/index.js`**

- 第 33 行的 port-file import 追加 `readPortFile`：
  ```js
  import { APP_DIR, resolvePort, validPort, writePortFile, writeRuntimePort, readPortFile } from './port-file.js';
  ```
- 新增 import（放在第 40 行后）：
  ```js
  import { restartGuard, spawnRestart } from './port-restart.js';
  ```
- 在第 52 行（`const PORT = resolvePort();`）之后加：
  ```js
  const PORT_SOURCE = validPort(process.env.DEVFLOW_PORT) ? 'env' : (readPortFile() ? 'file' : 'default');
  ```
- `/api/settings` GET 的 `res.end(...)` 改为：
  ```js
  const canRestart = restartGuard({ appDir: APP_DIR }).ok;
  res.end(JSON.stringify({ settings: { ...s, port: PORT }, envPort: process.env.DEVFLOW_PORT || null, currentPort: PORT, host: HOST, portSource: PORT_SOURCE, restartable: canRestart }));
  ```
- 在 `/api/settings` POST 之后新增路由：
  ```js
  if (url.pathname === '/api/server/restart' && req.method === 'POST') {
    const g = restartGuard({ appDir: APP_DIR });
    if (!g.ok) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: g.code, message: g.message }));
      return;
    }
    spawnRestart({ appDir: APP_DIR });
    log.info('restart requested; exiting so the launcher can bring it back');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, restarting: true }));
    setTimeout(() => process.exit(0), 300);
    return;
  }
  ```

- [ ] **Step 4: 语法检查 + 全量服务端测试**

Run: `node --check server/index.js`
Run: `npm.cmd run test:server`
Expected: 全绿

- [ ] **Step 5: 手工验证 409 分支（不真重启）**

dev 实例（`DEVFLOW_PORT=33333`）上：
`Invoke-WebRequest -Method POST "http://127.0.0.1:33333/api/server/restart"`
Expected: `409` + `{"error":"env-port-pinned","message":"dev 模式端口由 DEVFLOW_PORT 固定，请在环境变量里改"}`
并确认 `GET /api/settings` 里 `portSource:"env"`、`restartable:false`

- [ ] **Step 6: 提交**

```bash
git add server/index.js server/test/server-restart.test.js
git commit -m "feat(server): POST /api/server/restart 与 settings 的 portSource/restartable"
```

---

### Task 6: 前端「重启后端」按钮

**Files:**
- Modify: `web/src/components/TerminalView.vue:139-157,662`
- Test: `web/src/components/portRestart.test.ts`（新增，纯逻辑）

- [ ] **Step 1: 写失败测试 `web/src/components/portRestart.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { restartHintKey, canRestart } from './portRestart';

describe('portRestart', () => {
  it('env 钉住时给出 pinned 提示且不可重启', () => {
    expect(canRestart({ restartable: false, portSource: 'env' })).toBe(false);
    expect(restartHintKey({ restartable: false, portSource: 'env' })).toBe('term.port_restart_pinned');
  });
  it('非绿色包时给出 notpackaged 提示', () => {
    expect(restartHintKey({ restartable: false, portSource: 'default' })).toBe('term.port_restart_notpackaged');
  });
  it('绿色包可重启', () => {
    expect(canRestart({ restartable: true, portSource: 'file' })).toBe(true);
    expect(restartHintKey({ restartable: true, portSource: 'file' })).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web test -- src/components/portRestart.test.ts`
Expected: FAIL — 找不到 `./portRestart`

- [ ] **Step 3: 实现 `web/src/components/portRestart.ts`**

```ts
export interface PortRuntimeState {
  restartable?: boolean;
  portSource?: 'env' | 'file' | 'default' | string;
}

export function canRestart(s: PortRuntimeState): boolean {
  return s.restartable === true;
}

// 不可重启时给出原因词条；可重启返回空串
export function restartHintKey(s: PortRuntimeState): string {
  if (canRestart(s)) return '';
  return s.portSource === 'env' ? 'term.port_restart_pinned' : 'term.port_restart_notpackaged';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web test -- src/components/portRestart.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 接入 `TerminalView.vue`**

- import（与既有 `import { t } from '../i18n';` 同区）：
  ```ts
  import { canRestart, restartHintKey, type PortRuntimeState } from './portRestart';
  ```
- 在 `const portMsg = ref('');`（第 140 行）后加：
  ```ts
  const portState = ref<PortRuntimeState>({});
  const restartMsg = ref('');
  const restarting = ref(false);
  ```
- `loadSettings()`（141-146 行）改为：
  ```ts
  async function loadSettings() {
    try {
      const r = await fetch('/api/settings').then((x) => x.json());
      serverPort.value = r?.settings?.port ?? r?.currentPort ?? null;
      portState.value = { restartable: r?.restartable, portSource: r?.portSource };
    } catch { /* ignore */ }
  }
  ```
- 在 `savePort()` 之后加：
  ```ts
  async function restartBackend() {
    restartMsg.value = '';
    restarting.value = true;
    try {
      const res = await fetch('/api/server/restart', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      restartMsg.value = t('term.port_restarting');
      const deadline = Date.now() + 30000;
      for (;;) {
        if (Date.now() > deadline) throw new Error(t('term.port_restarting'));
        await new Promise((r) => setTimeout(r, 500));
        try {
          const v = await fetch('/api/version', { cache: 'no-store' });
          if (v.ok) { location.reload(); return; }
        } catch { /* 服务重启中，继续等 */ }
      }
    } catch (e: any) {
      restartMsg.value = t('term.port_restart_failed', { msg: e?.message || e });
    } finally { restarting.value = false; }
  }
  ```
- 模板第 662 行端口行改为：
  ```html
  <div class="cfgrow"><span>{{ $t('term.port') }}</span><input v-model.number="serverPort" type="number" min="1" max="65535" placeholder="22222" /><button class="ghostcfg" @click="savePort">{{ $t('common.save') }}</button><button class="ghostcfg" :disabled="!canRestart(portState) || restarting" @click="restartBackend">{{ $t('term.port_restart') }}</button></div>
  <div v-if="!canRestart(portState)" class="cfghint">{{ $t(restartHintKey(portState)) }}</div>
  <div v-if="restartMsg" class="cfghint">{{ restartMsg }}</div>
  ```
  （在 `<script setup>` 内把 `canRestart` / `restartHintKey` 暴露给模板是自动的：`<script setup>` 的顶层绑定可直接在模板使用。）

- [ ] **Step 6: 类型检查 + 前端测试 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd --prefix web test`
Run: `npm.cmd run check:i18n`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add web/src/components/portRestart.ts web/src/components/portRestart.test.ts web/src/components/TerminalView.vue
git commit -m "feat(web): 设置面板新增「重启后端」按钮（dev/非绿色包禁用并说明原因）"
```

---

### Task 7: 文档同步

**Files:**
- Modify: `AGENTS.md`（配置节）
- Modify: `scripts/build.js`（使用说明文案）

- [ ] **Step 1: AGENTS.md 配置节补充重启方式**

在「配置（端口 + XML）」节第一条之后插入：

```markdown
- **改端口后如何生效**：绿色包在设置面板保存端口后点「重启后端」即可；或直接关闭服务窗口后重新双击 `start.bat`（启动器会比对 `data/port.txt`（期望端口）与 `data/runtime-port.txt`（上次运行端口），不一致时结束旧实例并按新端口启动）。dev 环境下端口由 `DEVFLOW_PORT=33333` 固定，界面改端口无效、重启按钮禁用。
```

- [ ] **Step 2: `scripts/build.js` 使用说明补充**

在 `使用说明.txt` 的端口两行之后插入：

```js
  "改端口：设置面板保存后点「重启后端」；或关闭服务窗口后重新双击 start.bat",
```

- [ ] **Step 3: 重新构建校验文案**

Run: `npm.cmd run build:web` 然后 `node scripts/build.js`
Expected: 成功；`Get-Content dist-portable/vscode-ai-windows-x64-*/使用说明.txt` 含上述两行

- [ ] **Step 4: 提交**

```bash
git add AGENTS.md scripts/build.js
git commit -m "docs: 说明改端口后如何重启（界面按钮 / 重开 start.bat）"
```

---

### Task 8: 全量验收

- [ ] **Step 1: 全量测试与检查**

Run: `npm.cmd test` → 全绿
Run: `npm.cmd run typecheck` → 无报错
Run: `npm.cmd run check:i18n` → 无中文命中

- [ ] **Step 2: 绿色包一键重启（真实闭环）**

1. 用新产物起服务：`Start-Process <产物>\runtime\node.exe -ArgumentList 'server\index.js' -WorkingDirectory <产物> -WindowStyle Hidden`（异步）
2. 确认在 22222；`POST http://127.0.0.1:22222/api/settings {"port":44444}` → `200`
3. `POST http://127.0.0.1:22222/api/server/restart` → `{"ok":true,...}`；约 3-5s 后
4. 确认新实例在 **44444** 且 `data/runtime-port.txt` = `44444`、`dataDir` = `...\void\ports\44444`

- [ ] **Step 3: 双击 `start.bat` 幂等应用端口**

1. 保持 44444 实例在跑；把 `data/port.txt` 改成 `22222`（模拟"改端口后不点按钮，直接重开"）
2. 运行 `start.bat -NoBrowser -NoShortcut`（等价双击）
3. 确认：44444 实例被结束（仅本应用进程）、新实例在 **22222**、`runtime-port.txt` = `22222`

- [ ] **Step 4: dev 分支**

`http://127.0.0.1:33333/api/server/restart` → `409 env-port-pinned`；设置面板按钮禁用并显示 `term.port_restart_pinned`

- [ ] **Step 5: 收尾提交（若有验收期微调）**

```bash
git add <仅本次改动涉及的文件>
git commit -m "chore: 验收期微调"
```

---

## 附：明确不做（与 spec §11 一致）

- 不做端口占用自动换端口（沿用弹窗）
- 不自动迁移数据（换端口 = 换一份数据）
- 不改 dev 的 `DEVFLOW_PORT=33333` 约定
- 不在 macOS 自动杀旧实例（mac 是前台运行，关窗即停）
- 启动器不引入对 node 的额外调用（保持脚本自包含）
