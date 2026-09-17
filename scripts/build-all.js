// build-all.js — 一键打包全部平台/变体（「要打就几个版本一起打」）
//
// 用法：
//   node scripts/build-all.js            # 出全套（含 zip）
//   node scripts/build-all.js --no-zip   # 只出目录不压缩
//
// 说明：
//   * 先跑 build:web，避免 web/dist 过期触发 build.js 的 stale 校验。
//   * Windows：内置 opencode 包（build-opencode.js）+ 标准包（build.js）。
//     顺序不能反——build-opencode.js 会重建基础目录并改名为 -opencode，
//     先出 opencode 再出标准包，两个目录与两个 zip 才都在。
//   * macOS：build-mac.js 一次出 arm64 + x64 两个包。
//   * 缺 soft/opencode-windows-x64.zip 时跳过 opencode 变体并告警，不整体失败。

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const noZip = process.argv.includes("--no-zip");
const zipFlag = noZip ? ["--no-zip"] : [];
const SOFT_ZIP = path.join(ROOT, "soft", "opencode-windows-x64.zip");

function run(label, cmd, args) {
  console.log("");
  console.log("[build-all] === " + label + " ===");
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("[build-all] FAILED: " + label);
    process.exit(r.status || 1);
  }
}

function runNode(label, script, extra = []) {
  run(label, process.execPath, [path.join(ROOT, "scripts", script), ...extra]);
}

console.log(
  "[build-all] platform=" +
    process.platform +
    " arch=" +
    process.arch +
    (noZip ? " (no-zip)" : ""),
);

console.log("");
console.log("[build-all] === web (web/dist) ===");
const web =
  process.platform === "win32"
    ? spawnSync("cmd", ["/c", "npm.cmd", "run", "build:web"], { stdio: "inherit" })
    : spawnSync("npm", ["run", "build:web"], { stdio: "inherit" });
if (web.status !== 0) {
  console.error("[build-all] FAILED: web (web/dist)");
  process.exit(web.status || 1);
}

if (process.platform === "win32") {
  if (fs.existsSync(SOFT_ZIP)) {
    runNode("windows bundled-opencode", "build-opencode.js", zipFlag);
  } else {
    console.warn(
      "[build-all] skip bundled-opencode package: missing " +
        path.relative(ROOT, SOFT_ZIP),
    );
  }
  runNode("windows standard", "build.js", zipFlag);
} else if (process.platform === "darwin") {
  runNode("macos arm64 + x64", "build-mac.js", zipFlag);
} else {
  console.error("[build-all] unsupported platform: " + process.platform);
  process.exit(1);
}

console.log("");
console.log("[build-all] all done -> " + path.join(ROOT, "dist-portable"));
