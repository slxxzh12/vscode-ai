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

// Windows 杀软/资源管理器会短暂锁住刚生成的 zip/目录，删除同样需要退避重试
function rm(target) {
  if (!fs.existsSync(target)) return;
  for (let i = 1; i <= 10; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === 10 || (e.code !== "EPERM" && e.code !== "EBUSY" && e.code !== "ENOTEMPTY")) throw e;
      sleepSync(300 * i);
    }
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Windows 上刚跑过 opencode.exe（或杀软扫描新解压的 exe）会短暂锁住目录，
// rename 会偶发 EPERM，这里退避重试。
function renameWithRetry(from, to, attempts = 10) {
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (i === attempts) throw e;
      sleepSync(300 * i);
    }
  }
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
renameWithRetry(APP, FINAL);

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
