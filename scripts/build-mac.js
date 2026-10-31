// build-mac.js — 打包 macOS 绿色免安装版（Node 运行时 + node-pty 预编译）
//
// 用法（必须在 macOS 上执行）：
//   node scripts/build-mac.js            # 生成 arm64 + x64 两个包
//   node scripts/build-mac.js --no-zip   # 只生成目录不压缩
//
// 说明：
//   * 分架构出包：vscode-ai-macos-arm64 / vscode-ai-macos-x64（输出到 dist-portable/）。
//   * 本机构架的 Node 取 process.execPath；另一架构从 nodejs.org 下载对应官方 tarball
//     （版本与本机 node 一致），缓存到 env/，只需联网一次。
//   * node-pty 的 darwin-arm64 / darwin-x64 预编译随 npm 包自带，无需在 Mac 上编译。
//   * 打包前需已执行 `npm install` 与 `npm run build:web`。
//   * 用 ditto 打包以保留可执行位（spawn-helper / start.command / node 必须可执行）。

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { createRequire } = require("module");
const { copyRuntimeDeps } = require("./runtime-deps");

if (process.platform !== "darwin") {
  console.error("[build-mac] this script must run on macOS (darwin).");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.join(ROOT, "dist-portable");
const { todayVersion } = require("../shared/version.cjs");
const { makeLaunchSh, makeStartCommand } = require("./launcher.js");
const VERSION = todayVersion();
const ENV = path.join(ROOT, "env");
const noZip = process.argv.includes("--no-zip");
const HOST_ARCH = process.arch; // arm64 | x64
const NODE_VERSION = process.version; // 例如 v24.18.0
const TARGETS = ["arm64", "x64"];
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
    console.error("[build-mac] missing prerequisite: " + msg);
    process.exit(1);
  }
}

function rm(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

// 递归拷贝，filter(relPath, entry) 可按相对路径裁剪（relPath 用 / 分隔）。
function cpDir(from, to, filter, rel = "") {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const r = rel ? rel + "/" + entry.name : entry.name;
    if (filter && !filter(r, entry)) continue;
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) cpDir(s, d, filter, r);
    else fs.copyFileSync(s, d);
  }
}

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
    if (/\.(js|json)$/.test(entry.name)) fs.copyFileSync(s, path.join(to, entry.name));
  }
}

function chmodX(p) {
  try {
    fs.chmodSync(p, 0o755);
  } catch {
    /* ignore */
  }
}

// 校验下载来的二进制确实是目标架构（file 命令在 macOS 自带）。
function verifyNodeArch(binPath, arch) {
  const want = arch === "arm64" ? "arm64" : "x86_64";
  const r = run("file", [binPath]);
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  check(
    r.status === 0 && out.indexOf(want) !== -1,
    "node arch mismatch for darwin-" + arch + " (want " + want + "): " + out,
  );
}

// 取指定架构的 node 二进制路径：本机构架直接用当前 node，另一架构成 nodejs.org 下载。
function ensureNodeForArch(arch) {
  if (arch === HOST_ARCH) return fs.realpathSync(process.execPath);

  fs.mkdirSync(ENV, { recursive: true });
  const dirName = "node-" + NODE_VERSION + "-darwin-" + arch;
  const binPath = path.join(ENV, dirName, "bin", "node");
  if (!fs.existsSync(binPath)) {
    const url = "https://nodejs.org/dist/" + NODE_VERSION + "/" + dirName + ".tar.gz";
    const tgz = path.join(ENV, dirName + ".tar.gz");
    if (!fs.existsSync(tgz)) {
      console.log("[build-mac] downloading " + url);
      const r = run("curl", ["-fL", "--retry", "3", "-o", tgz, url], { stdio: "inherit" });
      check(r.status === 0, "download failed: " + url);
    }
    console.log("[build-mac] extracting " + path.basename(tgz));
    rm(path.join(ENV, dirName));
    const r = run("tar", ["-xzf", tgz, "-C", ENV], { stdio: "inherit" });
    check(r.status === 0, "extract failed: " + path.basename(tgz));
  }
  check(fs.existsSync(binPath), "node binary not found: " + binPath);
  verifyNodeArch(binPath, arch);
  return binPath;
}

// server 解析到的 esbuild（server/http-api.js 顶层 import，运行时依赖，必须随包发布）
function resolveEsbuild() {
  const req = createRequire(path.join(ROOT, "server", "package.json"));
  let dir = "";
  try {
    dir = path.dirname(req.resolve("esbuild/package.json"));
  } catch (e) {
    check(false, "esbuild not installed (run npm install): " + e.code);
  }
  return { dir, version: require(path.join(dir, "package.json")).version };
}

// 目标架构的 esbuild 平台二进制包：已装则直接用，另一架构从 npm registry 下载 tarball（缓存 env/）。
function ensureEsbuildPlatform(arch, version) {
  const name = "darwin-" + arch;
  for (const p of [
    path.join(ROOT, "server", "node_modules", "@esbuild", name),
    path.join(ROOT, "node_modules", "@esbuild", name),
  ]) {
    if (fs.existsSync(path.join(p, "bin", "esbuild"))) return p;
  }
  fs.mkdirSync(ENV, { recursive: true });
  const dirName = "@esbuild-" + name + "-" + version;
  const pkgDir = path.join(ENV, dirName, "package");
  if (!fs.existsSync(path.join(pkgDir, "bin", "esbuild"))) {
    const url =
      "https://registry.npmjs.org/@esbuild/" + name + "/-/" + name + "-" + version + ".tgz";
    const tgz = path.join(ENV, dirName + ".tgz");
    if (!fs.existsSync(tgz)) {
      console.log("[build-mac] downloading " + url);
      const r = run("curl", ["-fL", "--retry", "3", "-o", tgz, url], { stdio: "inherit" });
      check(r.status === 0, "download failed: " + url);
    }
    console.log("[build-mac] extracting " + path.basename(tgz));
    rm(path.join(ENV, dirName));
    fs.mkdirSync(path.join(ENV, dirName), { recursive: true });
    const r = run("tar", ["-xzf", tgz, "-C", path.join(ENV, dirName)], { stdio: "inherit" });
    check(r.status === 0, "extract failed: " + path.basename(tgz));
  }
  check(
    fs.existsSync(path.join(pkgDir, "bin", "esbuild")),
    "esbuild binary not found for " + name,
  );
  return pkgDir;
}

function makeUsage(arch) {
  return [
    "Void — macOS 绿色免安装版 / portable build",
    "",
    "版本 / Version: " + VERSION,
    "架构 / architecture: macos-" + arch,
    "",
    "启动 / Start",
    "  双击 start.command（若被系统拦截：右键 → 打开）",
    "  Double-click start.command (if blocked: right-click -> Open)",
    "  已在运行则只打开浏览器 / If already running, it just opens the browser",
    "",
    "停止 / Stop",
    "  关闭该终端窗口，或按 Ctrl-C",
    "  Close the terminal window, or press Ctrl-C",
    "",
    "访问 / URL:   http://127.0.0.1:" + CFG_PORT,
    "配置 / Config: config/devflow.xml（改后需重启服务）",
    "",
    "首次运行被 Gatekeeper 拦截时 / If Gatekeeper blocks the first run:",
    "  终端执行 / in Terminal:  xattr -dr com.apple.quarantine <解压目录>",
    "",
    "Node 运行时 / runtime: " + NODE_VERSION + " (macos-" + arch + ")",
    "",
  ].join("\n");
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

function buildArch(arch, nodeBin) {
  const APP = path.join(OUT_ROOT, "vscode-ai-macos-" + arch + "-" + VERSION);
  const ZIP = path.join(OUT_ROOT, "vscode-ai-macos-" + arch + "-" + VERSION + ".zip");
  const prebuildKeep = "prebuilds/darwin-" + arch;

  console.log("[build-mac] assembling " + APP);
  rm(APP);
  fs.mkdirSync(path.join(APP, "runtime"), { recursive: true });
  fs.mkdirSync(path.join(APP, "server"), { recursive: true });
  fs.mkdirSync(path.join(APP, "web"), { recursive: true });
  fs.copyFileSync(nodeBin, path.join(APP, "runtime", "node"));
  fs.writeFileSync(path.join(APP, "version.txt"), VERSION + "\n", "utf8");

  copyServerTree(path.join(ROOT, "server"), path.join(APP, "server"));
  // Mermaid：静态站点 Markdown 页直出的独立脚本（UMD 自包含）
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

  // 运行时依赖（真实拷贝）：node-pty 只保留目标架构的预编译，ws 与 shared 全量
  fs.mkdirSync(path.join(APP, "node_modules", "@devflow"), { recursive: true });
  cpDir(
    path.join(ROOT, "node_modules", "node-pty"),
    path.join(APP, "node_modules", "node-pty"),
    (r) => {
      if (r.startsWith("prebuilds/") && r.split("/").length === 2) return r === prebuildKeep;
      return true;
    },
  );
  cpDir(path.join(ROOT, "node_modules", "ws"), path.join(APP, "node_modules", "ws"));
  cpDir(
    path.join(ROOT, "shared"),
    path.join(APP, "node_modules", "@devflow", "shared"),
  );
  copyRuntimeDeps({
    root: ROOT,
    appDir: APP,
    deps: ["markdown-it", "highlight.js"],
    skip: ["node-pty", "ws", "esbuild", "@devflow/shared"],
  });

  // esbuild + 目标架构的平台二进制（缺一不可，否则运行时 ERR_MODULE_NOT_FOUND / 找不到二进制）
  const esbuild = resolveEsbuild();
  cpDir(esbuild.dir, path.join(APP, "node_modules", "esbuild"));
  const esbuildPlatform = path.join(APP, "node_modules", "@esbuild", "darwin-" + arch);
  cpDir(ensureEsbuildPlatform(arch, esbuild.version), esbuildPlatform);
  chmodX(path.join(esbuildPlatform, "bin", "esbuild"));

  // 启动脚本
  fs.mkdirSync(path.join(APP, "script"), { recursive: true });
  fs.writeFileSync(path.join(APP, "script", "launch.sh"), makeLaunchSh({ port: CFG_PORT }), "utf8");
  fs.writeFileSync(path.join(APP, "start.command"), makeStartCommand(), "utf8");
  fs.writeFileSync(path.join(APP, "使用说明.txt"), makeUsage(arch), "utf8");

  // 可执行位：node / 启动脚本 / node-pty spawn-helper（缺失则 pty 起不来）
  chmodX(path.join(APP, "runtime", "node"));
  chmodX(path.join(APP, "script", "launch.sh"));
  chmodX(path.join(APP, "start.command"));
  chmodX(path.join(APP, "node_modules", "node-pty", prebuildKeep, "spawn-helper"));

  // 产物自检
  console.log("[build-mac] verifying " + arch);
  const entries = [
    ["node", "runtime/node"],
    ["server", "server/index.js"],
    ["static", "web/dist/index.html"],
    ["version", "version.txt"],
    ["pty", "node_modules/node-pty/" + prebuildKeep + "/pty.node"],
    ["pty-helper", "node_modules/node-pty/" + prebuildKeep + "/spawn-helper"],
    ["ws", "node_modules/ws/package.json"],
    ["shared", "node_modules/@devflow/shared/index.js"],
    ["esbuild", "node_modules/esbuild/package.json"],
    ["esbuild-bin", "node_modules/@esbuild/darwin-" + arch + "/bin/esbuild"],
    ["config", "config/devflow.xml"],
    ["launcher", "script/launch.sh"],
    ["start", "start.command"],
  ];
  for (const [label, rel] of entries) {
    const p = path.join(APP, rel);
    check(fs.existsSync(p), "missing " + rel);
    console.log("[build-mac]   ok " + label + "  (" + rel + ")");
  }

  // 运行时依赖自检：以包内 server/ 的视角逐个 import，并真正调用一次 esbuild 原生二进制。
  // 跨架构包不能在本机执行（arm64 二进制在 x64 上跑不了），只在宿主架构做。
  if (arch === HOST_ARCH) {
    const serverDeps = Object.keys(
      require(path.join(ROOT, "server", "package.json")).dependencies || {},
    );
    const smokeCode = [
      "const deps = " + JSON.stringify(serverDeps) + ";",
      "for (const d of deps) await import(d);",
      "if (deps.includes('esbuild')) {",
      "  const { transformSync } = await import('esbuild');",
      "  if (!transformSync('const a = 1', { minify: true }).code) throw new Error('esbuild minify returned empty');",
      "}",
      "console.log('ok');",
    ].join("\n");
    const smoke = run(path.join(APP, "runtime", "node"), [
      "--input-type=module",
      "-e",
      smokeCode,
    ], { cwd: path.join(APP, "server") });
    if (smoke.status !== 0) {
      console.error(smoke.stdout || "");
      console.error(smoke.stderr || "");
      check(false, "runtime dependency self-check failed");
    }
    console.log("[build-mac]   ok runtime deps (" + serverDeps.join(", ") + ")");
  } else {
    console.log("[build-mac]   skip runtime self-check (cross-arch " + arch + ")");
  }

  if (!noZip) {
    console.log("[build-mac] zip " + path.basename(ZIP));
    rm(ZIP);
    const r = run("ditto", ["-c", "-k", "--keepParent", APP, ZIP], { stdio: "inherit" });
    check(r.status === 0, "ditto failed for " + ZIP);
  }

  const size = (dirMB(APP) / 1024 / 1024).toFixed(1);
  console.log("[build-mac] done " + arch + "  (" + size + " MB)");
  if (!noZip)
    console.log(
      "[build-mac] zip  " + path.basename(ZIP) + "  (" +
        (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1) + " MB)",
    );
}

console.log("[build-mac] 1/3 verify prerequisites");
check(
  fs.existsSync(path.join(ROOT, "node_modules", "node-pty")),
  "run npm install first (with node-pty prebuilds)",
);
check(
  fs.existsSync(path.join(ROOT, "web", "dist", "index.html")),
  "run npm run build:web first",
);
check(fs.existsSync(path.join(ROOT, "shared", "index.js")), "missing shared/index.js");
console.log(
  "[build-mac]   host arch=" + HOST_ARCH + "  node=" + NODE_VERSION +
    "  version=" + VERSION + "  targets=" + TARGETS.join(", "),
);

console.log("[build-mac] 2/3 prepare node binaries");
const nodeBins = {};
for (const arch of TARGETS) nodeBins[arch] = ensureNodeForArch(arch);

console.log("[build-mac] 3/3 build packages");
fs.mkdirSync(OUT_ROOT, { recursive: true });
for (const arch of TARGETS) buildArch(arch, nodeBins[arch]);

console.log("");
console.log("[build-mac] all done -> " + OUT_ROOT);
