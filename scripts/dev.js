"use strict";
// dev 并行启动器：一条命令起后端(33333) + 前端(Vite)，日志统一写 logs/，不落仓库根。
// 用法：npm.cmd run dev   （Ctrl-C 一并结束后端与前端）
// 仍可单独运行 npm.cmd run dev:server / dev:web。

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, "logs");
const PORT = process.env.DEVFLOW_PORT || "33333";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

fs.mkdirSync(LOG_DIR, { recursive: true });

const procs = [];
let exiting = false;

function start(name, bin, args, logName) {
  const out = fs.createWriteStream(path.join(LOG_DIR, logName), { flags: "a" });
  const child = spawn(bin, args, {
    cwd: ROOT,
    env: { ...process.env, DEVFLOW_PORT: PORT },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  child.on("exit", (code) => {
    out.end();
    console.log(`[dev] ${name} exited (code ${code})`);
    if (!exiting) shutdown(code == null ? 1 : code);
  });
  child.on("error", (e) => console.error(`[dev] ${name} failed to start:`, e.message));
  procs.push({ name, child });
  console.log(`[dev] ${name} started → logs/${logName}`);
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
  }
}

function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const p of procs) killTree(p.child);
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`[dev] DEVFLOW_PORT=${PORT}; 后端 http://127.0.0.1:${PORT}；前端 http://localhost:5173`);
start("server", process.execPath, ["--watch", "server/index.js"], "dev-server.log");
start("web", NPM, ["--prefix", "web", "run", "dev"], "dev-web.log");
