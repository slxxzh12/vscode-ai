# 内置 opencode 的 Windows 打包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一套独立的 Windows 打包脚本，把 `soft/opencode-windows-x64.zip` 里的 `opencode.exe` 打进绿色包，并让包启动后优先使用包内 opencode。

**Architecture:** 新脚本 `scripts/build-opencode.js` 先调用现有 `scripts/build.js --no-zip` 产出标准包，再把 opencode 解压进 `APP/opencode/`、用 `makeLaunchPs1` 重生成带 PATH 注入的 `launch.ps1`、改名成 `*-opencode` 并压缩。`scripts/launcher.js` 的 `makeLaunchPs1` 增加一个可选 `opencodeDir` 参数，不传时输出与现状逐字节一致；`build.js` 与 `build-mac.js` 保持不改。

**Tech Stack:** Node.js（CommonJS 构建脚本）、PowerShell 5.1（`System.IO.Compression.ZipFile` 解压、`Compress-Archive` 压缩）、node:test（单测）。

**Spec:** `docs/superpowers/specs/2026-09-17-bundled-opencode-package-design.md`

**提交前检查（每个 commit 都执行，见 `docs/learn/git仓库提交检查和提交事项.md`）：**

```powershell
git status --short
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat-|-----BEGIN [A-Z ]*PRIVATE KEY-----"
git ls-files env
```

只 `git add` 本任务涉及的文件，禁止 `git add -A`。`env/` 输出必须为空；扫描命中的是检测正则/示例文本时可放行。

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `scripts/launcher.js` | 修改 | `makeLaunchPs1` 支持可选 `opencodeDir`，注入 `PATH` |
| `server/test/launcher.test.js` | 修改 | 锁定「注入」与「不传时零变化」 |
| `scripts/build-opencode.js` | 新增 | 内置 opencode 的 Windows 打包入口 |
| `package.json` | 修改 | 新增 `build:portable:opencode` |
| `AGENTS.md` | 修改 | 打包顺序补一条命令说明 |

---

## Task 1: `makeLaunchPs1` 支持可选 `opencodeDir`

**Files:**
- Modify: `scripts/launcher.js:6-16`
- Test: `server/test/launcher.test.js`（文件末尾追加）

- [ ] **Step 1: 先写失败测试**

在 `server/test/launcher.test.js` 末尾追加：

```js
test('launch.ps1 可选注入包内 opencode 到 PATH（不传则维持现状）', () => {
  const withOc = makeLaunchPs1({ port: 22222, opencodeDir: 'opencode' });
  assert.match(withOc, /\$ocDir = Join-Path \$root 'opencode'/);
  assert.match(withOc, /\$env:PATH = \$ocDir \+ ';' \+ \$env:PATH/);
  assert.ok(
    withOc.indexOf('$env:PATH') < withOc.indexOf('Start-Process'),
    'PATH 注入必须出现在启动服务之前',
  );

  const plain = makeLaunchPs1({ port: 22222 });
  assert.ok(!plain.includes('$env:PATH'), '不传 opencodeDir 时输出不含 PATH 注入');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test "server/test/launcher.test.js"`
Expected: 5 passed / 1 failed，失败信息为 `PATH 注入必须出现...` 或 `assert.match` 不匹配（因为当前 `makeLaunchPs1` 还没有 `opencodeDir`）

- [ ] **Step 3: 实现最小改动**

把 `scripts/launcher.js` 的 `makeLaunchPs1` 改为（第 6-15 行附近）：

```js
function makeLaunchPs1({ port, opencodeDir = "" }) {
  const ocLines = opencodeDir
    ? [
        "$ocDir = Join-Path $root '" + opencodeDir + "'",
        "if (Test-Path (Join-Path $ocDir 'opencode.exe')) { $env:PATH = $ocDir + ';' + $env:PATH }",
      ]
    : [];
  return [
    "param([switch]$NoBrowser, [switch]$NoShortcut, [switch]$Plan, [switch]$NoPrompt, [string]$Open = '')",
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$scriptDir = $PSScriptRoot",
    "if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }",
    "$root = Split-Path -Parent $scriptDir",
    ...ocLines,
    "$fallback = " + port,
```

其余行（`$desired` 起直到末尾）**全部保持不变**。只有 `opencodeDir` 非空时才会多出两行；不传时数组拼接结果与改动前完全一致。

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test "server/test/launcher.test.js"`
Expected: 6 passed / 0 failed

- [ ] **Step 5: 跑一次既有启动器集成测试（确保 -Plan 仍可用）**

Run: `node --test "server/test/launcher-plan.test.js"`
Expected: 4 passed / 0 failed（非 Windows 上为 skip，允许）

- [ ] **Step 6: 提交**

按「提交前检查」执行后：

```powershell
git add scripts/launcher.js server/test/launcher.test.js
git commit -m "feat(build): launch.ps1 可选把包内 opencode 注入 PATH"
```

---

## Task 2: 新增 `scripts/build-opencode.js` 与 npm 脚本

**Files:**
- Create: `scripts/build-opencode.js`
- Modify: `package.json:15`（`build:portable` 之后）

- [ ] **Step 1: 创建 `scripts/build-opencode.js`**

```js
// build-opencode.js — 打包「内置 opencode」的 Windows 绿色包（独立一套，不动 build.js）
//
// 用法：
//   node scripts/build-opencode.js            # 构建到 dist-portable/（含 zip）
//   node scripts/build-opencode.js --no-zip   # 只生成目录不压缩
//
// 说明：
//   * 先调用 build.js --no-zip 产出标准包，再把 soft/opencode-windows-x64.zip 里的
//     opencode.exe 打进 APP/opencode/，重生成带 PATH 注入的 launch.ps1，最后改名
//     vscode-ai-windows-x64-<version>-opencode。
//   * 仅在 Windows x64 下可用（soft/ 只有 windows-x64 产物）。
//   * build.js / build-mac.js 保持不变。

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { todayVersion } = require("../shared/version.cjs");
const { makeLaunchPs1 } = require("./launcher.js");

const ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.join(ROOT, "dist-portable");
const VERSION = todayVersion();
const ARCH = "x64";
const BASE = "vscode-ai-windows-" + ARCH + "-" + VERSION;
const APP = path.join(OUT_ROOT, BASE);
const FINAL = path.join(OUT_ROOT, BASE + "-opencode");
const ZIP = FINAL + ".zip";
const SOFT_ZIP = path.join(ROOT, "soft", "opencode-windows-x64.zip");
const ZIP_ENTRY = "opencode.exe";
const noZip = process.argv.includes("--no-zip");
const CFG_PORT = (() => {
  try {
    const xml = fs.readFileSync(path.join(ROOT, "config", "devflow.xml"), "utf8");
    const m = xml.match(/<server\b[^>]*\bport\s*=\s*"(\d+)"/i);
    return m ? m[1] : "22222";
  } catch {
    return "22222";
  }
})();

function check(cond, msg) {
  if (!cond) {
    console.error("[build-opencode] missing prerequisite: " + msg);
    process.exit(1);
  }
}

function rm(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// 用 .NET ZipFile 解出单个条目（比 Expand-Archive 快）。临时 .ps1 带 BOM：PowerShell 5.1
// 对无 BOM 的 UTF-8 脚本按 ANSI 解码，沿用仓库既有约定。
function extractZipEntry(zipPath, entryName, destFile) {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "$zip = [System.IO.Compression.ZipFile]::OpenRead(" + psQuote(zipPath) + ")",
    "try {",
    "  $e = $zip.GetEntry(" + psQuote(entryName) + ")",
    "  if (-not $e) { throw ('entry not found: ' + " + psQuote(entryName) + ") }",
    "  $dir = Split-Path -Parent " + psQuote(destFile),
    "  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }",
    "  $in = $e.Open()",
    "  try {",
    "    $out = [System.IO.File]::Open(" + psQuote(destFile) + ", [System.IO.FileMode]::Create)",
    "    try { $in.CopyTo($out) } finally { $out.Dispose() }",
    "  } finally { $in.Dispose() }",
    "} finally { $zip.Dispose() }",
  ];
  const script = path.join(os.tmpdir(), "df-extract-opencode-" + process.pid + ".ps1");
  fs.writeFileSync(script, "\uFEFF" + lines.join("\r\n"), "utf8");
  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      console.error(r.stdout || "");
      console.error(r.stderr || "");
      check(false, "failed to extract " + entryName + " from " + path.basename(zipPath));
    }
  } finally {
    rm(script);
  }
}

function opencodeVersion(exe) {
  const r = spawnSync(exe, ["--version"], { timeout: 30000, windowsHide: true, encoding: "utf8" });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  check(r.status === 0 && out, "bundled opencode.exe --version failed (" + exe + ")");
  return out.split(/\r?\n/)[0].trim();
}

console.log("[build-opencode] version " + VERSION);
check(process.platform === "win32", "this script only runs on Windows");
check(process.arch === "x64", "this script only supports x64 (soft/ has windows-x64 only)");
check(fs.existsSync(SOFT_ZIP), "put the opencode release at soft/opencode-windows-x64.zip");

console.log("[build-opencode] 1/5 build standard package (build.js --no-zip)");
const build = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts", "build.js"), "--no-zip"],
  { stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status || 1);

console.log("[build-opencode] 2/5 embed opencode");
const ocExe = path.join(APP, "opencode", ZIP_ENTRY);
extractZipEntry(SOFT_ZIP, ZIP_ENTRY, ocExe);
const ocVer = opencodeVersion(ocExe);
console.log("[build-opencode]   bundled opencode " + ocVer);

console.log("[build-opencode] 3/5 rewrite launch.ps1 (PATH prepend)");
fs.writeFileSync(
  path.join(APP, "script", "launch.ps1"),
  "\uFEFF" + makeLaunchPs1({ port: CFG_PORT, opencodeDir: "opencode" }),
  "utf8",
);

console.log("[build-opencode] 4/5 annotate usage + rename");
fs.appendFileSync(
  path.join(APP, "使用说明.txt"),
  [
    "",
    "本包内置 opencode " + ocVer + "，启动后优先使用包内版本（opencode\\opencode.exe）。",
    "注意：直接运行 runtime\\node.exe server\\index.js 时不会注入包内 opencode 的 PATH，仍使用系统已安装的 opencode。",
    "",
  ].join("\r\n"),
  "utf8",
);
rm(FINAL);
rm(ZIP);
fs.renameSync(APP, FINAL);

console.log("[build-opencode] 5/5 verify output");
const finalExe = path.join(FINAL, "opencode", ZIP_ENTRY);
check(fs.existsSync(finalExe), "missing opencode/" + ZIP_ENTRY);
const ps1 = fs.readFileSync(path.join(FINAL, "script", "launch.ps1"), "utf8");
check(ps1.includes("$env:PATH") && ps1.includes("opencode"), "launch.ps1 missing PATH injection");
opencodeVersion(finalExe);

if (!noZip) {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Compress-Archive -Path '" + FINAL + "' -DestinationPath '" + ZIP + "' -CompressionLevel Optimal",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
}

function dirMB(p) {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) total += dirMB(f);
    else total += fs.statSync(f).size;
  }
  return total;
}

console.log("");
console.log(
  "Done: " + FINAL + "  (" + (dirMB(FINAL) / 1024 / 1024).toFixed(1) + " MB, opencode " + ocVer + ")",
);
if (!noZip)
  console.log("ZIP:  " + ZIP + "  (" + (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1) + " MB)");
```

- [ ] **Step 2: `package.json` 增加 npm 脚本**

在 `package.json` 的 `"build:portable": "node scripts/build.js",` 之后插入一行：

```json
    "build:portable:opencode": "node scripts/build-opencode.js",
```

- [ ] **Step 3: 语法检查**

Run: `node --check scripts/build-opencode.js`
Expected: 无输出、退出码 0

- [ ] **Step 4: 确认 npm 脚本被识别**

Run: `node -e "console.log(require('./package.json').scripts['build:portable:opencode'])"`
Expected: `node scripts/build-opencode.js`

- [ ] **Step 5: 提交**

按「提交前检查」执行后：

```powershell
git add scripts/build-opencode.js package.json
git commit -m "feat(build): 新增内置 opencode 的 Windows 打包脚本"
```

---

## Task 3: 端到端打包验证（目录 + zip）

**Files:**
- 无新增/修改（验证 Task 2 的脚本；若发现缺陷则修复并补一次提交）

前置：确认 `web/dist` 已是当前构建（Task 1/2 未改前端，正常情况下直接可用；若 `build.js` 报 `web/dist is stale`，先跑 `npm.cmd run build:web`）。

- [ ] **Step 1: 只出目录地跑一次**

Run: `npm.cmd run build:portable:opencode -- --no-zip`
Expected: 依次出现 `[build-opencode] 1/5 ... 5/5`，最后 `Done: ... dist-portable\vscode-ai-windows-x64-<version>-opencode  (... MB, opencode <x.y.z>)`，退出码 0

- [ ] **Step 2: 校验包内产物**

Run:
```powershell
$p = Get-ChildItem "dist-portable" -Directory -Filter "*-opencode" | Select-Object -First 1
$p.Name
Get-ChildItem (Join-Path $p.FullName "opencode") | Select-Object Name, Length
```
Expected: 目录名形如 `vscode-ai-windows-x64-v<当天 yyyyMMdd>-opencode`，其中有 `opencode.exe`（约 180 MB）

- [ ] **Step 3: 校验 launch.ps1 的 PATH 注入行（带 BOM）**

Run:
```powershell
$p = Get-ChildItem "dist-portable" -Directory -Filter "*-opencode" | Select-Object -First 1
Select-String -LiteralPath (Join-Path $p.FullName "script\launch.ps1") -Pattern 'ocDir','env:PATH'
```
Expected: 命中两行，分别为 `$ocDir = Join-Path $root 'opencode'` 与 `$env:PATH = $ocDir + ';' + $env:PATH`

- [ ] **Step 4: 实跑 `-Plan`，确认脚本语法无误**

Run:
```powershell
$p = Get-ChildItem "dist-portable" -Directory -Filter "*-opencode" | Select-Object -First 1
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $p.FullName "script\launch.ps1") -Plan -NoBrowser -NoShortcut
```
Expected: 打印一行 `PLAN desired=... running=... alive=... action=...`，退出码 0（无语法错误）

- [ ] **Step 5: 验证「包内 opencode 优先」**

Run:
```powershell
$p = Get-ChildItem "dist-portable" -Directory -Filter "*-opencode" | Select-Object -First 1
$env:PATH = (Join-Path $p.FullName "opencode") + ";" + $env:PATH
(Get-Command opencode).Source
opencode --version
```
Expected: `Source` 指向 `...\<包目录>\opencode\opencode.exe`；`--version` 打印与打包日志一致的版本号

- [ ] **Step 6: 跑完整版（含 zip）**

Run: `npm.cmd run build:portable:opencode`
Expected: 末尾除 `Done: ...` 外还有 `ZIP:  ...\vscode-ai-windows-x64-<version>-opencode.zip  (... MB)`，退出码 0

- [ ] **Step 7: 若前面步骤全部通过则无改动；否则修复后提交**

如有修复：
```powershell
git add <改动文件>
git commit -m "fix(build): <修复说明>"
```

---

## Task 4: 文档补充 + 全量回归

**Files:**
- Modify: `AGENTS.md`（「打包顺序」→「### Windows」小节）

- [ ] **Step 1: 在 AGENTS.md 的 Windows 打包条目下补一行**

在 `AGENTS.md` 中「### Windows」小节里，紧跟这一行之后：

```
- 一键打包：`node scripts/build.js`（等价 `npm.cmd run build:portable`），产物 ...
```

插入新条目：

```
- 内置 opencode 的包（独立一套，仅 Windows x64）：`node scripts/build-opencode.js`（等价 `npm.cmd run build:portable:opencode`）。它先跑 `build.js --no-zip`，再把 `soft/opencode-windows-x64.zip` 的 `opencode.exe` 打进 `opencode/`，重写 `launch.ps1` 把包内目录插到 `PATH` 最前，产物 `vscode-ai-windows-x64-<version>-opencode/` + 同名 `.zip`。缺该 zip 会直接报错退出。
```

- [ ] **Step 2: 全量回归**

Run: `npm.cmd test`
Expected: 全部通过（server `node --test` + web vitest）

Run: `npm.cmd run check:i18n`
Expected: 通过（无中文命中用户可见范围；本次未新增文案）

Run: `npm.cmd run typecheck`
Expected: 通过（本次未改前端 TS）

- [ ] **Step 3: 提交**

按「提交前检查」执行后：

```powershell
git add AGENTS.md
git commit -m "docs(build): AGENTS 补充内置 opencode 的打包命令"
```

---

## 自查结论（对照 spec）

- spec §3 新增 `scripts/build-opencode.js` → Task 2 全量代码；§3 各步（校验、build.js、路径、解压、冒烟、重写 ps1、说明、改名、自检、压缩、摘要）在脚本中一一对应。
- spec §4 `launcher.js` 可选参数 + 兼容 → Task 1（含「不传时零变化」断言）。
- spec §5 npm 脚本 → Task 2 Step 2。
- spec §6 产物命名 → Task 2 常量 `FINAL`/`ZIP` 与 Task 3 校验。
- spec §7 边界 → 脚本内 `check`（平台/架构/zip 缺失/条目缺失/版本失败/`--no-zip`/幂等删改）。
- spec §8 测试与验证 → Task 1 单测、Task 3 端到端、Task 4 回归。
- spec §9 影响面 → Task 1-4 的 Files 与不改清单一致（`build.js`/`build-mac.js` 不动）。
- spec §10 明确不做 → 计划未含 macOS、服务端注入、`devflow.xml` 改动、`soft/` 跟踪调整。
