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
    const xml = fs.readFileSync(path.join(ROOT, "config", "devflow.xml"), "utf8");
    const m = xml.match(/<server\b[^>]*\bport\s*=\s*"(\d+)"/i);
    return m ? m[1] : "22222";
  } catch { return "22222"; }
})();

function check(cond, msg) {
  if (!cond) {
    console.error("[build] 前置缺失: " + msg);
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

console.log("[build] 1/5 准备 Node 运行时 (env/)");
if (!fs.existsSync(ENV_NODE)) {
  fs.mkdirSync(path.dirname(ENV_NODE), { recursive: true });
  fs.copyFileSync(process.execPath, ENV_NODE);
  console.log("[build]   已复制当前 node.exe 到 env/");
}
const nodeVer = spawnSync(ENV_NODE, ["--version"], {
  encoding: "utf8",
}).stdout.trim();

console.log("[build] 2/5 校验前置产物");
check(
  fs.existsSync(path.join(ROOT, "node_modules", "node-pty")),
  "请先 npm install（需含已编译的 node-pty）",
);
check(
  fs.existsSync(path.join(ROOT, "web", "dist", "index.html")),
  "请先 npm run build:web",
);
check(
  fs.existsSync(path.join(ROOT, "shared", "index.js")),
  "缺少 shared/index.js",
);

console.log("[build] 3/5 组装 " + APP);
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
cpDir(path.join(ROOT, "config"), path.join(APP, "config"));

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

// 启动脚本
const bat = [
  "@echo off",
  "setlocal",
  'cd /d "%~dp0"',
  "echo vscode-ai 启动中：http://127.0.0.1:" + CFG_PORT,
  "echo 关闭弹出的 vscode-ai 窗口即停止服务。",
  'start "vscode-ai" /min cmd /c "runtime\\node.exe server\\index.js"',
  "timeout /t 2 /nobreak >nul",
  'start "" "http://127.0.0.1:' + CFG_PORT + '"',
  "",
].join("\r\n");
fs.writeFileSync(path.join(APP, "start.bat"), bat);

const usage = [
  "vscode-ai（绿色免安装版）",
  "",
  "启动：双击 start.bat（自动打开 http://127.0.0.1:" + CFG_PORT + "）",
  '停止：关闭弹出的 "vscode-ai" 最小化窗口',
  "",
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

console.log("[build] 4/5 校验产物");
const entries = [
  ["node", "runtime/node.exe"],
  ["server", "server/index.js"],
  ["static", "web/dist/index.html"],
  ["pty", "node_modules/node-pty/prebuilds/win32-x64/conpty.node"],
  ["ws", "node_modules/ws/package.json"],
  ["shared", "node_modules/@devflow/shared/index.js"],
  ["config", "config/devflow.xml"],
];
for (const [label, rel] of entries) {
  const p = path.join(APP, rel);
  check(fs.existsSync(p), "缺少 " + rel);
  console.log("[build]   ok " + label + "  (" + rel + ")");
}

if (!noZip) {
  console.log("[build] 5/5 压缩 ZIP");
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
  "完成: " +
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
