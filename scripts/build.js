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
const { createRequire } = require("module");
const { copyRuntimeDeps } = require("./runtime-deps");

const ROOT = path.resolve(__dirname, "..");
const ENV_NODE = path.join(ROOT, "env", "node.exe");
const OUT_ROOT = path.join(ROOT, "dist-portable");
// 产物命名对齐 opencode release 风格：<name>-<os>-<arch>
const WIN_ARCH = process.arch; // x64 | arm64
const { todayVersion } = require("../shared/version.cjs");
const { makeLaunchPs1 } = require("./launcher.js");
const VERSION = todayVersion();
const APP_NAME = "vscode-ai-windows-" + WIN_ARCH + "-" + VERSION;
const APP = path.join(OUT_ROOT, APP_NAME);
const ZIP = path.join(OUT_ROOT, APP_NAME + ".zip");
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

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Windows 杀软/资源管理器会短暂锁住刚生成的目录，删除要退避重试
function rm(target) {
  if (!fs.existsSync(target)) return;
  for (let i = 1; i <= 15; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === 15 || (e.code !== "EPERM" && e.code !== "EBUSY" && e.code !== "ENOTEMPTY")) throw e;
      sleepSync(400 * i);
    }
  }
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

console.log("[build] version " + VERSION);
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
// 前端产物必须比 web/src 与 shared（含 i18n）都新：否则会把旧 bundle 配新词条，
// 界面出现 gitstat.title 这类「找不到词条、直接显示 key」的问题（已踩过）。
function newestMtime(dir) {
  let newest = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const m = e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs;
    if (m > newest) newest = m;
  }
  return newest;
}
const distMtime = fs.statSync(path.join(ROOT, "web", "dist", "index.html")).mtimeMs;
const srcMtime = Math.max(newestMtime(path.join(ROOT, "web", "src")), newestMtime(path.join(ROOT, "shared")));
check(
  distMtime >= srcMtime,
  "web/dist is stale (web/src or shared changed after the last build) — run `npm run build:web` again",
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
fs.mkdirSync(path.join(APP, "bin"), { recursive: true });
fs.copyFileSync(ENV_NODE, path.join(APP, "runtime", "node.exe"));
fs.writeFileSync(path.join(APP, "version.txt"), VERSION + "\n", "utf8");
fs.writeFileSync(
  path.join(APP, "bin", "void.cmd"),
  [
    "@echo off",
    'if exist "%~dp0..\\runtime\\node.exe" (',
    '  "%~dp0..\\runtime\\node.exe" "%~dp0..\\server\\cli\\void.js" %*',
    ") else (",
    '  node "%~dp0..\\server\\cli\\void.js" %*',
    ")",
    "",
  ].join("\r\n"),
  "utf8",
);

// server 整树 .js/.json（跳过 test/、node_modules/ 与协作运行时 JSON）
function copyServerTree(from, to, rel = "") {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory() && (entry.name === "test" || entry.name === "node_modules")) continue;
    if (entry.isDirectory() && entry.name === "inbox" && rel === "collaboration") continue;
    const s = path.join(from, entry.name);
    if (entry.isDirectory()) {
      copyServerTree(s, path.join(to, entry.name), path.join(rel, entry.name));
      continue;
    }
    // server/collaboration/*.json 是本机运行时身份/群数据（含 Ed25519 私钥），禁止入包。
    if (rel === "collaboration" && /\.json$/i.test(entry.name)) continue;
    if (/\.(js|json)$/.test(entry.name))
      fs.copyFileSync(s, path.join(to, entry.name));
  }
}
copyServerTree(path.join(ROOT, "server"), path.join(APP, "server"));
// Mermaid：静态站点 Markdown 页直出的独立脚本（UMD 自包含），运行时不依赖 web 依赖树
fs.mkdirSync(path.join(APP, "server", "vendor"), { recursive: true });
fs.copyFileSync(
  require.resolve("mermaid/dist/mermaid.min.js"),
  path.join(APP, "server", "vendor", "mermaid.min.js"),
);
// ECharts 供静态站点 Markdown 的 xychart/pie 渲染，和 Web 端保持同一套图表实现
fs.copyFileSync(
  require.resolve("echarts/dist/echarts.min.js"),
  path.join(APP, "server", "vendor", "echarts.min.js"),
);
cpDir(path.join(ROOT, "web", "dist"), path.join(APP, "web", "dist"));
cpDir(
  path.join(ROOT, "config"),
  path.join(APP, "config"),
  (e) => e.name !== "runtime-port.txt",
);
// 项目级技能与工作流（.void）随包发布；排除本机检测状态
if (fs.existsSync(path.join(ROOT, ".void"))) {
  cpDir(
    path.join(ROOT, ".void"),
    path.join(APP, ".void"),
    (e) => e.name !== "skills-checked.json",
  );
}

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
// 运行时依赖：按 server/package.json 的真实解析结果整包拷贝（含传递依赖）
copyRuntimeDeps({
  root: ROOT,
  appDir: APP,
  deps: Object.keys(require(path.join(ROOT, "server", "package.json")).dependencies || {}),
  skip: ["node-pty", "ws", "esbuild", "@devflow/shared"],
});

// esbuild：server 的运行时依赖（server/http-api.js 顶层 import，用于「压缩一行」）；
// npm workspaces 下可能提升到根也可能留在 server/ 内，按 server 的真实解析结果拷贝，
// 且必须连平台二进制包（@esbuild/<platform>-<arch>）一起带，否则运行时起不来。
const ESBUILD_PLATFORM = "@esbuild/" + process.platform + "-" + process.arch;
const ESBUILD_BIN = process.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
const serverRequire = createRequire(path.join(ROOT, "server", "package.json"));
let esbuildDir = "";
let esbuildPlatformDir = "";
try {
  esbuildDir = path.dirname(serverRequire.resolve("esbuild/package.json"));
  esbuildPlatformDir = path.dirname(
    serverRequire.resolve(ESBUILD_PLATFORM + "/package.json"),
  );
} catch (e) {
  check(
    false,
    "esbuild missing for " +
      process.platform +
      "-" +
      process.arch +
      " (" +
      e.code +
      "); run npm install first",
  );
}
cpDir(esbuildDir, path.join(APP, "node_modules", "esbuild"));
cpDir(
  esbuildPlatformDir,
  path.join(APP, "node_modules", ...ESBUILD_PLATFORM.split("/")),
);

// 启动脚本：智能启动器（已在跑只开浏览器；否则启动服务） + 首次运行创建桌面快捷方式
fs.mkdirSync(path.join(APP, "script"), { recursive: true });
fs.copyFileSync(
  path.join(APP, "web", "dist", "favicon.ico"),
  path.join(APP, "script", "icon.ico"),
);

const launchPs1 = makeLaunchPs1({ port: CFG_PORT });
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
  "vscode-ai（绿色免安装版 / windows-" + WIN_ARCH + "）",
  "版本 / Version：" + VERSION,
  "",
  "启动：双击 start.bat（已在运行则只打开浏览器；否则自动启动服务）",
  "桌面图标：首次运行会在桌面创建「Void」快捷方式，之后双击桌面图标即可拉起服务",
  '停止：关闭弹出的最小化服务窗口',
  "",
  "端口：默认 " + CFG_PORT + "；被占用时弹窗询问：结束占用进程并重启 / 更换端口",
  "端口文件：data\\port.txt（单行端口号；改端口写这里，重启生效）",
  "改端口：设置面板保存后点「重启后端」；或关闭服务窗口后重新双击 start.bat",
  "数据目录：%USERPROFILE%\\.local\\share\\void\\ports\\<端口>\\（换端口 = 换一份数据）",
  "Agent/工作流配置：编辑 <数据目录>\\ports\\<端口>\\downloads\\devflow.xml 后重启",
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
// 运行时敏感文件不得进入安装包：协作身份/群数据（含 Ed25519 私钥）与环境/数据目录。
const collabDir = path.join(APP, "server", "collaboration");
const leaked = fs.existsSync(collabDir)
  ? fs.readdirSync(collabDir).filter((n) => /\.json$/i.test(n) || n === "inbox")
  : [];
check(leaked.length === 0, "runtime secrets leaked into package: server/collaboration/" + leaked.join(", "));
for (const dir of ["env", "data", "logs"]) {
  check(!fs.existsSync(path.join(APP, dir)), "runtime directory leaked into package: " + dir + "/");
}
const entries = [
  ["node", "runtime/node.exe"],
  ["server", "server/index.js"],
  ["static", "web/dist/index.html"],
  ["version", "version.txt"],
  ["pty", "node_modules/node-pty/prebuilds/win32-" + WIN_ARCH + "/conpty.node"],
  ["ws", "node_modules/ws/package.json"],
  ["shared", "node_modules/@devflow/shared/index.js"],
  ["esbuild", "node_modules/esbuild/package.json"],
  ["esbuild-bin", "node_modules/" + ESBUILD_PLATFORM + "/" + ESBUILD_BIN],
  ["config", "config/devflow.xml"],
  ["icon", "script/icon.ico"],
  ["launcher", "script/launch.ps1"],
  ["void", "bin/void.cmd"],
];
for (const [label, rel] of entries) {
  const p = path.join(APP, rel);
  check(fs.existsSync(p), "missing " + rel);
  console.log("[build]   ok " + label + "  (" + rel + ")");
}
// 项目级技能：源仓有 .void/skills 时必须打进包，否则首次启动检测不到
if (fs.existsSync(path.join(ROOT, ".void", "skills"))) {
  check(fs.existsSync(path.join(APP, ".void", "skills")), "missing .void/skills");
  console.log("[build]   ok skills  (.void/skills)");
}

// 运行时依赖自检：收集 server 代码真正 import 的每一个运行时依赖
// （server/package.json 声明的包 + @devflow/shared 的各个子路径），以包内 server/
// 为解析起点逐个真实 import，并真正调用一次 esbuild 原生二进制；缺失的依赖会在
// 这里暴露，而不是等用户双击 start.bat 才崩。
function collectSharedSpecs(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === "test") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSharedSpecs(p, acc);
      continue;
    }
    if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue;
    const src = fs.readFileSync(p, "utf8");
    const re = /["'](@devflow\/[^"'\s]+)["']/g;
    let m;
    while ((m = re.exec(src))) acc.add(m[1]);
  }
}
const sharedSpecs = new Set();
collectSharedSpecs(path.join(ROOT, "server"), sharedSpecs);
const serverDeps = [
  ...new Set([
    ...Object.keys(
      require(path.join(ROOT, "server", "package.json")).dependencies || {},
    ),
    ...sharedSpecs,
  ]),
].sort();
const smokeCode = [
  "const deps = " + JSON.stringify(serverDeps) + ";",
  "for (const d of deps) await import(d);",
  "if (deps.includes('esbuild')) {",
  "  const { transformSync } = await import('esbuild');",
  "  if (!transformSync('const a = 1', { minify: true }).code) throw new Error('esbuild minify returned empty');",
  "}",
  "console.log('ok');",
].join("\n");
const smoke = spawnSync(
  path.join(APP, "runtime", process.platform === "win32" ? "node.exe" : "node"),
  ["--input-type=module", "-e", smokeCode],
  { cwd: path.join(APP, "server"), encoding: "utf8" },
);
if (smoke.status !== 0) {
  console.error(smoke.stdout || "");
  console.error(smoke.stderr || "");
  check(false, "runtime dependency self-check failed");
}
console.log("[build]   ok runtime deps (" + serverDeps.join(", ") + ")");

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
