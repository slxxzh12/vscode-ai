// build.js — 打包绿色免安装版（Node 运行时 + 已编译 node-pty）
//
// 用法：
//   node scripts/build.js            # 构建到 dist-portable/
//   node scripts/build.js --no-zip   # 只生成目录不压缩
//
// 说明：
//   * Node 运行时取自 env/node.exe；若不存在则自动把运行本脚本的 node.exe 复制进去
//     （node-pty 需与运行时同 ABI，务必用同一大版本的 node 执行本脚本）。
//   * 打包前需已执行 `npm install` 与 `npm run build:web`。
//   * 产物可直接拷贝到任意 Windows 机器双击 start.bat 运行，无需安装 Node。

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ENV_NODE = path.join(ROOT, "env", "node.exe");
const OUT_ROOT = path.join(ROOT, "dist-portable");
const APP = path.join(OUT_ROOT, "vscode-ai");
const ZIP = path.join(OUT_ROOT, "vscode-ai-portable.zip");
const noZip = process.argv.includes("--no-zip");
const CFG_PORT = (() => {
  try {
    const xml = fs.readFileSync(
      path.join(ROOT, "config", "devflow.xml"),
      "utf8",
    );
    const m = xml.match(/<server\b[^>]*\bport\s*=\s*"(\d+)"/i);
    return m ? m[1] : "22222";
  } catch {
    return "22222";
  }
})();

function check(cond, msg) {
  if (!cond) {
    console.error("[build] missing prerequisite: " + msg);
    process.exit(1);
  }
}

function rm(target) {
  if (fs.existsSync(target))
    fs.rmSync(target, { recursive: true, force: true });
}

function cpDir(from, to, filter) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (filter && !filter(entry)) continue;
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) cpDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

console.log("[build] 1/5 prepare Node runtime (env/)");
if (!fs.existsSync(ENV_NODE)) {
  fs.mkdirSync(path.dirname(ENV_NODE), { recursive: true });
  fs.copyFileSync(process.execPath, ENV_NODE);
  console.log("[build]   copied current node.exe to env/");
}
const nodeVer = spawnSync(ENV_NODE, ["--version"], {
  encoding: "utf8",
}).stdout.trim();

console.log("[build] 2/5 verify prerequisites");
check(
  fs.existsSync(path.join(ROOT, "node_modules", "node-pty")),
  "run npm install first (with compiled node-pty)",
);
check(
  fs.existsSync(path.join(ROOT, "web", "dist", "index.html")),
  "run npm run build:web first",
);
check(
  fs.existsSync(path.join(ROOT, "shared", "index.js")),
  "missing shared/index.js",
);

console.log("[build] 3/5 assembling " + APP);
rm(APP);
fs.mkdirSync(path.join(APP, "runtime"), { recursive: true });
fs.mkdirSync(path.join(APP, "server"), { recursive: true });
fs.mkdirSync(path.join(APP, "web"), { recursive: true });
fs.copyFileSync(ENV_NODE, path.join(APP, "runtime", "node.exe"));

// server 整树 .js/.json（跳过 test/）
function copyServerTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === "test") continue;
    const s = path.join(from, entry.name);
    if (entry.isDirectory()) {
      copyServerTree(s, path.join(to, entry.name));
      continue;
    }
    if (/\.(js|json)$/.test(entry.name))
      fs.copyFileSync(s, path.join(to, entry.name));
  }
}
copyServerTree(path.join(ROOT, "server"), path.join(APP, "server"));
cpDir(path.join(ROOT, "web", "dist"), path.join(APP, "web", "dist"));
cpDir(
  path.join(ROOT, "config"),
  path.join(APP, "config"),
  (e) => e.name !== "runtime-port.txt",
);

// 运行时依赖（真实拷贝，含 node-pty 原生 .node）
fs.mkdirSync(path.join(APP, "node_modules", "@devflow"), { recursive: true });
cpDir(
  path.join(ROOT, "node_modules", "node-pty"),
  path.join(APP, "node_modules", "node-pty"),
);
cpDir(
  path.join(ROOT, "node_modules", "ws"),
  path.join(APP, "node_modules", "ws"),
);
cpDir(
  path.join(ROOT, "shared"),
  path.join(APP, "node_modules", "@devflow", "shared"),
);

// 启动脚本：智能启动器（已在跑只开浏览器；否则启动服务） + 首次运行创建桌面快捷方式
fs.mkdirSync(path.join(APP, "script"), { recursive: true });
fs.copyFileSync(
  path.join(APP, "web", "dist", "favicon.ico"),
  path.join(APP, "script", "icon.ico"),
);

const launchPs1 = [
  "param([switch]$NoBrowser, [switch]$NoShortcut, [string]$Open = '')",
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$scriptDir = $PSScriptRoot",
  "if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }",
  "$root = Split-Path -Parent $scriptDir",
  "$port = " + CFG_PORT,
  "$portFile = Join-Path $root 'config\\runtime-port.txt'",
  "if (Test-Path $portFile) { $t = (Get-Content -Raw $portFile).Trim(); if ($t -match '^\\d+$') { $port = [int]$t } }",
  "function Test-Port([int]$p) {",
  "  try {",
  "    $c = New-Object System.Net.Sockets.TcpClient",
  "    $iar = $c.BeginConnect('127.0.0.1', $p, $null, $null)",
  "    if (-not $iar.AsyncWaitHandle.WaitOne(300)) { $c.Close(); return $false }",
  "    $c.EndConnect($iar); $c.Close(); return $true",
  "  } catch { return $false }",
  "}",
  "if (-not (Test-Port $port)) {",
  "  Start-Process -FilePath (Join-Path $root 'runtime\\node.exe') -ArgumentList 'server\\index.js' -WorkingDirectory $root -WindowStyle Minimized",
  "  $deadline = (Get-Date).AddSeconds(15)",
  "  while ((Get-Date) -lt $deadline -and -not (Test-Port $port)) { Start-Sleep -Milliseconds 400 }",
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
  "  if ($Open) { Start-Process ('http://127.0.0.1:{0}/?open={1}' -f $port, [uri]::EscapeDataString($Open)) }",
  "  else { Start-Process ('http://127.0.0.1:{0}' -f $port) }",
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
  "        $k = $cu.CreateSubKey(\"Software\\Classes\\$($e)\\OpenWithProgids\")",
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
// 启动脚本：start.bat 留在根目录，其余脚本收纳到 script/ 子目录
fs.mkdirSync(path.join(APP, "script"), { recursive: true });
fs.writeFileSync(
  path.join(APP, "script", "launch.ps1"),
  "\uFEFF" + launchPs1,
  "utf8",
);

const bat = [
  "@echo off",
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0script\\launch.ps1" %*',
  "",
].join("\r\n");
fs.writeFileSync(path.join(APP, "start.bat"), bat);

const usage = [
  "vscode-ai（绿色免安装版）",
  "",
  "启动：双击 start.bat（已在运行则只打开浏览器；否则自动启动服务）",
  "桌面图标：首次运行会在桌面创建「Void」快捷方式，之后双击桌面图标即可拉起服务",
  '停止：关闭弹出的最小化服务窗口',
  "",
  "端口：默认 " + CFG_PORT + "；被占用时弹窗询问：结束占用进程并重启 / 更换端口",
  "端口/Agent/工作流配置：编辑 config/devflow.xml 后重启",
  "",
  "Node 运行时版本：" + nodeVer,
  "",
  "自定义端口/主机：",
  "  set DEVFLOW_PORT=8080",
  "  set DEVFLOW_HOST=0.0.0.0   (小心：服务无认证，公网请勿裸奔)",
  "  runtime\\node.exe server\\index.js",
  "",
].join("\r\n");
fs.writeFileSync(path.join(APP, "使用说明.txt"), usage);

console.log("[build] 4/5 verify output");
const entries = [
  ["node", "runtime/node.exe"],
  ["server", "server/index.js"],
  ["static", "web/dist/index.html"],
  ["pty", "node_modules/node-pty/prebuilds/win32-x64/conpty.node"],
  ["ws", "node_modules/ws/package.json"],
  ["shared", "node_modules/@devflow/shared/index.js"],
  ["config", "config/devflow.xml"],
  ["icon", "script/icon.ico"],
  ["launcher", "script/launch.ps1"],
];
for (const [label, rel] of entries) {
  const p = path.join(APP, rel);
  check(fs.existsSync(p), "missing " + rel);
  console.log("[build]   ok " + label + "  (" + rel + ")");
}

if (!noZip) {
  console.log("[build] 5/5 zip");
  rm(ZIP);
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Compress-Archive -Path '${APP}' -DestinationPath '${ZIP}' -CompressionLevel Optimal`,
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
  "Done: " +
    APP +
    "  (" +
    (dirMB(APP) / 1024 / 1024).toFixed(1) +
    " MB, node " +
    nodeVer +
    ")",
);
if (!noZip)
  console.log(
    "ZIP:  " +
      ZIP +
      "  (" +
      (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1) +
      " MB)",
  );
