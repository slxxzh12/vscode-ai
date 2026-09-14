# AGENTS.md

## 默认模板声明（换基础环境必读）

- 本文件是**默认模板**：同事在任何项目 / 换到新的基础环境检查时，**必须保留本默认表述**，并在「环境」节补齐本机特异项（Node 路径/版本、shell、端口、远端等）。
- 环境特异内容只增改「环境」节，不要删除或另起一份 AGENTS.md；本仓库其余规范（启动、i18n、计划执行、提问方式、提交等）保持不变。
- 未确认的基础环境差异，先检查再补充，不要默认假设。

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
- Windows / macOS **各用各的脚本，互不交叉**：node-pty 原生模块与 Node 运行时都按平台/架构绑定，禁止交叉组装。

### Windows

- 一键打包：`node scripts/build.js`（等价 `npm.cmd run build:portable`），产物 `dist-portable/vscode-ai-windows-<arch>-<version>/`（目录）+ `vscode-ai-windows-<arch>-<version>.zip`（`<arch>` 由 `process.arch` 定，x64/arm64；`<version>` 为打包当天 `vYYYYMMDD`）。产物根写入 `version.txt`，服务端启动日志与 `/api/version` 均读取该冻结版本。
- 绿色包原理：`env/node.exe` 自带运行时 + 拷贝已编译的 node-pty 原生 `.node` → 目标机免装 Node、免编译。**Node 与 node-pty ABI 必须同大版本**；`env/node.exe` 缺失时 build.js 会自动复制当前 node 过去。

### macOS

- **必须在 macOS 上执行**：`npm install` + `npm run build:web` 后跑 `node scripts/build-mac.js`（等价 `npm run build:portable:mac`）。
- **分架构出包**，一次产出两个：`dist-portable/vscode-ai-macos-arm64-<version>/` 与 `vscode-ai-macos-x64-<version>/`（各含同名 `.zip`）；`--no-zip` 只出目录。产物命名对齐 opencode release 风格 `<name>-<os>-<arch>-<version>`，`<version>` 为打包当天 `vYYYYMMDD`，各目录根写入 `version.txt`。
- 本机架构的 Node 取 `process.execPath`（缓存到 `env/node`），另一架构从 nodejs.org 下同版本官方 tarball（同样缓存进 `env/`，需联网一次）；node-pty 的 `prebuilds/darwin-<arch>/` 随 npm 包自带，无需在 Mac 上编译。
- 启动器为 `start.command`（双击；探测端口：已在运行只开浏览器，否则前台起服务，关窗即停）；用 `ditto` 压包以保留 `spawn-helper`、`runtime/node` 等的可执行位。
- 已知 Mac 限制：端口冲突弹窗不可用；`native-dialog`（文件/文件夹选择）在非 Windows 返回 `unsupported`；首次运行可能被 Gatekeeper 拦（右键→打开，或 `xattr -dr com.apple.quarantine <目录>`）。

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

## 提问方式（强制）

- 需要澄清时**允许分多轮聊天提问**：一轮只问一个问题，按需连续追问，直到问清楚。
- **禁止在同一轮里并列多个问题（多个 tab/面板）**：一次只呈现一个问题，让用户一次只做一个决定。
- **禁止使用 TUI 上下选择的交互式提问组件**；问题一律以纯文本列出编号选项（1、2、3、4…），由用户在聊天里手动回复所选编号。
- 能自行判断且风险可控的，不要问；有歧义或影响方向时，问，但一次只问一个。

## 提交/推送

- 一律在 `master` 操作（无远程 PR 需求时）。`git push origin master`。
- 仓库远端残留 `feat/web-terminal` 分支，已合并删除需求时：`git push origin --delete feat/web-terminal`。
