// build-mdv.js — 构建 @devflow/markdown-viewer，带增量判断与 .d.ts 开关。
//
// 用法：
//   node scripts/build-mdv.js            # 只构建运行用的 JS/CSS，产物未过期则跳过
//   node scripts/build-mdv.js --dts      # 同时生成 .d.ts（typecheck / 发布用）
//   node scripts/build-mdv.js --force    # 忽略 mtime，强制重建
//
// 环境变量：
//   DEVFLOW_FORCE_BUILD_MDV=1  等价于 --force
//   DEVFLOW_MDV_DTS=1          透传给 vite 配置，1 表示生成 .d.ts
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PKG = path.join(ROOT, "markdown-viewer");
const DIST = path.join(PKG, "dist");
const MAIN_OUT = path.join(DIST, "index.js");
const DTS_OUT = path.join(DIST, "index.d.ts");
const STANDALONE_OUT = path.join(DIST, "standalone", "index.js");

const wantDts = process.argv.includes("--dts");
const force =
  process.argv.includes("--force") || process.env.DEVFLOW_FORCE_BUILD_MDV === "1";

function newestMtime(target) {
  const st = fs.statSync(target);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const m = newestMtime(path.join(target, entry.name));
    if (m > newest) newest = m;
  }
  return newest;
}

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

const srcDir = path.join(PKG, "src");
const pkgJson = path.join(PKG, "package.json");
const mainNewest = Math.max(
  ...[
    srcDir,
    pkgJson,
    path.join(PKG, "tsconfig.json"),
    path.join(PKG, "vite.config.ts"),
  ].map(newestMtime),
);
const standaloneNewest = Math.max(
  ...[srcDir, pkgJson, path.join(PKG, "vite.standalone.config.ts")].map(
    newestMtime,
  ),
);

const mainFresh =
  !force &&
  mtimeOf(MAIN_OUT) >= mainNewest &&
  (!wantDts || mtimeOf(DTS_OUT) >= mainNewest);
const standaloneFresh = !force && mtimeOf(STANDALONE_OUT) >= standaloneNewest;

if (mainFresh && standaloneFresh) {
  console.log("[build-mdv] up to date, skip");
  process.exit(0);
}

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(script, env) {
  const args = ["--prefix", "markdown-viewer", "run", script];
  const viaShell = process.platform === "win32";
  const bin = viaShell ? process.env.ComSpec || "cmd.exe" : NPM;
  const finalArgs = viaShell ? ["/d", "/s", "/c", NPM, ...args] : args;
  console.log(
    "[build-mdv] " + script + (env.DEVFLOW_MDV_DTS === "1" ? " (+dts)" : ""),
  );
  const r = spawnSync(bin, finalArgs, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    console.error("[build-mdv] " + script + " failed");
    process.exit(r.status || 1);
  }
}

if (!mainFresh) run("build:main", { DEVFLOW_MDV_DTS: wantDts ? "1" : "0" });
if (!standaloneFresh) run("build:standalone", { DEVFLOW_MDV_DTS: "0" });
