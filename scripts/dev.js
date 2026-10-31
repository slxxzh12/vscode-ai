"use strict";
// dev 并行启动器：一条命令起后端(33333) + 前端(Vite)，日志统一写 logs/，不落仓库根。
// 用法：npm.cmd run dev   （Ctrl-C 一并结束后端与前端）
// 仍可单独运行 npm.cmd run dev:server / dev:web。

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
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
  // Node 24 禁止直接 spawn .cmd/.bat（CVE-2024-27980，会 EINVAL），Windows 上套一层 cmd.exe
  const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  const spawnBin = viaShell ? (process.env.ComSpec || "cmd.exe") : bin;
  const spawnArgs = viaShell ? ["/d", "/s", "/c", bin, ...args] : args;
  const child = spawn(spawnBin, spawnArgs, {
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

// 默认 agent 从活动配置读取（用户选过就用用户的，没选才回退 opencode）；让子进程（后端采集/终端）
// 能找到它：显式覆盖(DEVFLOW_OPENCODE) → PATH → 仓库 opencode/、env/
async function resolveDefaultAgentCmd() {
  try {
    const cfg = await import(pathToFileURL(path.join(ROOT, "server", "devflow-config.js")).href);
    const boot = cfg.loadDevflowConfig(cfg.resolveActiveConfigFile(ROOT, PORT));
    const a = (boot.agents.list || []).find((x) => x.id === boot.agents.default) || {};
    return String(a.cmd || "").trim() || cfg.DEFAULT_AGENT;
  } catch {
    return "opencode";
  }
}

async function ensureAgent() {
  const cmd = await resolveDefaultAgentCmd();
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, "server", "collaboration", "agent-stats.js")).href);
    const bin = mod.ensureAgentOnPath(cmd, { env: process.env, appRoot: ROOT });
    if (bin) { console.log(`[dev] agent: ${bin}`); return; }
  } catch { /* 探测失败不阻塞 dev */ }
  console.warn(`[dev] 未找到 agent "${cmd}"，机器用量采集会失败；请把它加入 PATH（opencode 可用 DEVFLOW_OPENCODE 覆盖）`);
}

async function main() {
  await ensureAgent();
  console.log(`[dev] DEVFLOW_PORT=${PORT}; 后端 http://127.0.0.1:${PORT}；前端 http://localhost:5173`);
  start("server", process.execPath, ["--watch", "server/index.js"], "dev-server.log");
  start("web", NPM, ["--prefix", "web", "run", "dev"], "dev-web.log");
}

main();
