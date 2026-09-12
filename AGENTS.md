# AGENTS.md

## 环境

- Windows + PowerShell 5.1；**无 bash**；`npm.ps1` 受执行策略拦截 → 一律用 `npm.cmd`。
- Node v24.18.0（`D:\soft\node-v24.18.0-win-x64\node.exe`）；bun 1.3.14 仅作参考（勿用于本项目运行）。
- 本仓库运行时**必须用 Node，不能用 bun**：node-pty 原生插件（已实测 bun 编译成 exe 时 `conpty.node` 无法加载；bun 运行时下 pty 交互流不可用）。
- Git 远端：Gitee `origin`（`https://gitee.com/wglj/devflow.git`）。默认分支 `master`。

## 服务启动规范（严格遵守，违规即返工）

- **所有常驻进程必须异步（非阻塞）启动**，严禁前台阻塞式命令。
- 统一做法：PowerShell `Start-Process` 后台运行 + `-RedirectStandardOutput`/`-RedirectStandardError` 指向日志文件；启动命令立即返回。
- 开发：两个终端分别 `npm.cmd run dev:server`（= `set DEVFLOW_PORT=33333&& node --watch server/index.js`，dev 固定端口 **33333**，与 release 的 22222 区分；改后端自动重启）与 `npm.cmd run dev:web`（Vite :5173，代理 `/api`、`/ws` 到 33333）。访问 http://localhost:5173。
- 生产/绿色包：`node server/index.js`（静态托管 `web/dist`，访问 http://127.0.0.1:22222）。
- 改 `projects.json` / `workflows.json` 后需重启后端才生效（dev:server 的 `--watch` 不监听 json）。

## 已验证教训（勿再犯）

- **PowerShell 5.1 不解析 `"\u001b"`**（是 6 字符字面量）；构造 ESC 必须 `[char]27`（如 `buildMarkerCmd` 的 win 分支）。
- **Node 24 `node --test` 不接受目录参数**：用 glob `node --test "server/test/*.test.js"`（见根 `package.json` test:server）。
- **npm 新版 `allow-scripts` 默认拦截原生安装脚本**：新克隆后必须先 `npm.cmd approve-scripts node-pty esbuild`，否则 node-pty/esbuild 无产物（node-pty 冒烟见下）。
- **node-pty 原生可用性验证**：`node -e` spawn powershell 后 `echo df-pty-ok` 能收到即 OK。ConPTY 对 OSC 完成标记**透传已实测通过**（`[char]27` 构造 `ESC]777;dfdone;...BEL` 会原样回流）→ workflow auto 步在 Windows 可用。
- **`import.meta.url` 在单文件打包/内嵌环境是虚拟路径**（如 bun exe 内 `B:/~BUN/root/...`）→ 依赖 `__dirname` 的配置/静态路径会坏；不要把服务做成无磁盘资源的单文件 exe。
- **会话列表排序**：`createdAt` 同毫秒会并列，必须带单调 `seq` 二级排序。
- **xterm v5**：`term.onData(cb)` 返回 IDisposable（`offData` 已不存在）；卸载用 `dispose()`。
- **`ws.data` 只在服务端**：客户端拿不到；验证用服务端 Conn（`gateway.conns`）。
- WS 消息 type 一律引用 `shared` 的 `C2S`/`S2C` 常量，禁止在 server/web 里写死字符串。

## 打包顺序（先构建前端，再打绿色包）

- 打绿色包前必须先 `npm.cmd run build:web`（产物 `web/dist`）。
- 一键打包：`node scripts/build.js`（等价 `npm.cmd run build:portable`），产物 `dist-portable/vscode-ai/`（目录）+ `vscode-ai-portable.zip`。
- 绿色包原理：`env/node.exe` 自带运行时 + 拷贝已编译的 node-pty 原生 `.node` → 目标机免装 Node、免编译。**Node 与 node-pty ABI 必须同大版本**；`env/node.exe` 缺失时 build.js 会自动复制当前 node 过去。
- `env/`、`dist-portable/`、`node_modules/`、`dist/` 均不入库（.gitignore）。

## 目录速览

- `shared/` — WS 协议常量/类型（唯一事实源）；`server/` — Node ESM 后端（ws + node-pty，测试在 `server/test/`，`node --test`）；`web/` — Vue3+Vite+TS+xterm（vitest + vue-tsc）。
- 测试：`npm.cmd test`（server + web）；类型：`npm.cmd run typecheck`；代码行统计：`npm.cmd run count:code`（去注释/空行/纯括号/无英文行，输出每文件实际代码行）。

## 配置（统一 XML）

- 活动配置文件：`<dataHome>/downloads/devflow.xml`（Windows：`%USERPROFILE%\.local\share\devflow\downloads\devflow.xml`）；首次启动从仓库模板 `config/devflow.xml` 复制生成，**已存在则不覆盖**，之后为整份配置（`<server>` + `<agents>` + `<workflows>`）的唯一权威源。
- 端口/语言可在 UI 设置面板修改，服务端会**就地改写**活动文件的 `<server>` 属性；Agent 列表与工作流提示语直接编辑活动文件。
- 改活动配置后需**重启后端**（dev:server 的 `--watch` 不监听 xml）；仓库 `config/devflow.xml` 仅作首次 seed 模板，seed 后修改它不生效（删除 `<dataHome>/downloads/devflow.xml` 可重新生成）。
- 环境变量 `DEVFLOW_PORT` 优先于 XML 的 `port`。
- `config/server.json`、`config/workflow.xml` 已废弃。

## 国际化（i18n，强制）

- **后续所有提示/文案用语必须支持国际化，至少中文（zh-CN）与英文（en）**；禁止在代码里写死单语言（含中文）的用户可见文案。
- 单一词条源：`shared/i18n/zh-CN.js` + `shared/i18n/en.js`；运行时 `@devflow/shared/i18n` 的 `translate(locale, key, params)`（`{name}` 插值；缺失回退 当前语言→en→key）。
- 前端：`web/src/i18n.ts` 的 `t()`／模板 `$t()`；`<script setup>` 用 `import { t } from '<相对路径>/i18n'`。顶栏「中/EN」开关即时生效并同步服务端。
- 服务端：`server/i18n.js` 的 `t()`（全局语言存 `config/server.json` 的 `language`，默认 `zh-CN`）；系统消息、API `message` 等用户可见文案走 `t()`。
- 新增词条**中英必须同时补齐**（两文件键集合保持对称）。
- 提交前跑 `npm.cmd run check:i18n`；`web/src` 与 `server` 用户可见范围内必须零中文命中。排除项：代码注释、`console`/logger 日志、`*.test.*`、配置内容（如 `config/workflow.xml`、用户数据）。

## 临时/生成文件（禁止入库）

- 提交前先看 `git status`，**未跟踪的临时/生成文件不要 `git add -A` 一把梭**；只 `git add` 本次改动涉及的文件。
- 明确禁止入库（同时写入 `.gitignore`）：
  - IDE/编辑器：`.idea/`、`.vscode/`、`*.iml`、`*.swp`、`*.swo`；
  - OS：`Thumbs.db`、`desktop.ini`、`.DS_Store`；
  - 构建产物/依赖：`node_modules/`、`dist/`、`dist-portable/`、`env/`、`*.log`；
  - 运行时数据/密钥：`server/collaboration/*.json`（含 Ed25519 私钥）、`server/collaboration/inbox/`、`.env`、`.env.*`；
  - superpowers 本地状态：`.superpowers/`。
- 若不慎已入库：`git rm -r --cached <路径>` 移出版本库（保留本地文件），补进 `.gitignore` 后再提交。

## 计划执行方式（强制）

- 执行实现计划（writing-plans / executing-plans）时**默认使用 inline（本会话内执行）**，**不要用 subagent 驱动**。
- 后续演进**不必再就「用哪种执行方式」提问**，直接按 inline 执行。

## 提交/推送

- 一律在 `master` 操作（无远程 PR 需求时）。`git push origin master`。
- 仓库远端残留 `feat/web-terminal` 分支，已合并删除需求时：`git push origin --delete feat/web-terminal`。
