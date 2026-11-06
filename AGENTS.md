# AGENTS.md

## 默认模板声明（换基础环境必读）

- 本文件是**默认模板**：同事在任何项目 / 换到新的基础环境检查时，**必须保留本默认表述**，并在「环境」节补齐本机特异项（Node 路径/版本、shell、端口、远端等）。
- 环境特异内容只增改「环境」节，不要删除或另起一份 AGENTS.md；本仓库其余规范（启动、i18n、计划执行、提问方式、提交等）保持不变。
- 未确认的基础环境差异，先检查再补充，不要默认假设。

## 环境

- Windows + PowerShell 5.1；**无 bash**；`npm.ps1` 受执行策略拦截 → 一律用 `npm.cmd`。
- Node v24.18.0（`D:\soft\node-v24.18.0-win-x64\node.exe`）；bun 1.3.14 仅作参考（勿用于本项目运行）。
- 本仓库运行时**必须用 Node，不能用 bun**：node-pty 原生插件（已实测 bun 编译成 exe 时 `conpty.node` 无法加载；bun 运行时下 pty 交互流不可用）。
- **opencode 可执行文件**：本机为绿色包 `D:\soft\vscode-ai-windows-x64-<日期>-opencode\opencode\opencode.exe`（`soft/` 出包时打进包内 `opencode/`）。它**不在用户/系统 PATH**，只有 opencode 会话进程的 PATH 才有。dev 下若启动 `npm run dev` 的终端没有它，用量采集会 `spawn opencode ENOENT`、机器用量显示为空。解析顺序（`server/collaboration/agent-stats.js` 的 `resolveAgentBin`）：`DEVFLOW_OPENCODE` 环境变量 → PATH → 应用根下 `opencode/`、`env/`；命中后 `ensureAgentOnPath` 把其目录插到 PATH 最前（终端与采集共用）。所以要 dev 下能看到本机用量：用带 opencode 的终端起 dev，或设 `DEVFLOW_OPENCODE=<opencode 可执行文件路径>`（`scripts/dev.js` 启动时会探测并提示）。
- Git 远端：Gitee `origin`（`https://gitee.com/wglj/devflow.git`）。默认分支 `master`。
- **所有敏感信息（令牌、口令/密码、密钥、私钥、任何带凭据的 URL 等）一律只放 `env/` 目录**（如 `env/gitee-release.ini`、`env/github.ini`、`env/git-credentials`）；`env/` 已在 `.gitignore`，**禁止 `git add`/提交**。
- **代码、脚本、配置模板、README、以及 `docs/` 下的设计/计划文档中，一律禁止出现任何明文敏感信息**；需要引用时只用占位符（如 `https://<user>:<token>@gitee.com/...`），真实值从 `env/` 读取。提交前用 `git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat_|-----BEGIN [A-Z ]*PRIVATE KEY-----"` 自查。
- **代码中一律禁止写死绝对路径**（如 `D:\...`、`C:/...`、`/Users/...`）或本机用户名/主机名；路径只能来自运行时推导（`__dirname`、`process.cwd()`、数据目录、配置项/环境变量）或写成占位符（如 `<数据目录>/void.db`）。本「环境」节记录本机特异路径属例外。
- **代码仓位置记录在 `env/code.ini` 的 `code_dir`**（本机特异项，`env/` 不入库）。首次环境检查或换基础环境时**必须先询问用户「代码仓是不是当前目录」**：回答是 → 在 `env/code.ini` 写入 `code_dir=<当前目录>`；回答否 → 按用户给出的实际路径写入。该绝对路径只允许出现在 `env/` 配置里，代码/文档中一律用占位符。

### 敏感信息（强制）

- **敏感信息只能放在 `env/`**：令牌、口令/密码、密钥、私钥、带凭据的 URL、连接串中的密码等，**任何其他位置都不得出现真实值**，包括代码、脚本、配置模板、文档、测试、日志、提交信息、Release 说明；需要引用时只用占位符（如 `https://<user>:<token>@gitee.com/...`），真实值从 `env/` 读取。
- **每次代码写完后、提交前必须做敏感信息扫描**（未通过不得提交/推送）：
  ```powershell
  git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat_|-----BEGIN [A-Z ]*PRIVATE KEY-----"
  git grep -n -I -i -E "passwd|password|passphrase|secret|api[_-]?key|token"
  git ls-files env
  ```
  第二条命中需人工确认非真实值；`git ls-files env` 必须为空。
- 若清理结果为空但历史里曾出现过真实凭据：**必须轮换该凭据**，并按需重写 git 历史；强推（`--force`）前必须获得确认。
- 提交/推送前仍要执行 `docs/learn/git仓库提交检查和提交事项.md` 的完整清单。

## 服务启动规范（严格遵守，违规即返工）

- **所有常驻进程必须异步（非阻塞）启动**，严禁前台阻塞式命令。
- 统一做法：PowerShell `Start-Process` 后台运行 + `-RedirectStandardOutput`/`-RedirectStandardError` 指向日志文件；启动命令立即返回。
- 开发：两个终端分别 `npm.cmd run dev:server`（= `set DEVFLOW_PORT=33333&& node --watch server/index.js`，dev 固定端口 **33333**，与 release 的 22222 区分；改后端自动重启）与 `npm.cmd run dev:web`（Vite :5173，代理 `/api`、`/ws` 到 33333）。访问 http://localhost:5173。dev 与绿色包各用各的数据目录（`ports/33333` 与 `ports/22222`），互不干扰。也可一条命令 `npm.cmd run dev`（= `node scripts/dev.js`）同时起两者，Ctrl-C 一并结束。
- **dev 日志一律写 `logs\`**（`npm run dev` 固定写 `logs\dev-server.log` / `logs\dev-web.log`；手工重定向也必须指到 `logs\`）；**严禁把日志丢在仓库根目录**（`logs/` 已在 `.gitignore`）。
- 生产/绿色包：`node server/index.js`（静态托管 `web/dist`，端口取 `data/port.txt`，默认 22222，访问 http://127.0.0.1:22222）。
- 绿色包默认隐藏服务后台；设置面板「启动 → 启动后隐藏服务后台」可取消隐藏，下次启动/重启由 `launch.ps1` 以可见控制台直接运行 `runtime\node.exe`。偏好存 `<数据目录>/ports/<端口>/startup-prefs.json`（默认 `hide=true`）。
- 改 `projects.json` 后需重启后端才生效（dev:server 的 `--watch` 不监听 json）。

## 已验证教训（勿再犯）

- **PowerShell 5.1 不解析 `"\u001b"`**（是 6 字符字面量）；构造 ESC 必须 `[char]27`（如 `buildMarkerCmd` 的 win 分支）。
- **PowerShell 5.1 读无 BOM 的 UTF-8 `.ps1` 会按 ANSI 解码** → 含中文即语法错误；生成 `.ps1`（如 `scripts/launcher.js` 的 `launch.ps1`）**必须写 BOM**（`"\uFEFF" + text`），单测写临时 `.ps1` 同理。
- **Node 24 `node --test` 不接受目录参数**：用 glob `node --test "server/test/*.test.js"`（见根 `package.json` test:server）。
- **npm 新版 `allow-scripts` 默认拦截原生安装脚本**：新克隆后必须先 `npm.cmd approve-scripts node-pty esbuild`，否则 node-pty/esbuild 无产物（node-pty 冒烟见下）。
- **node-pty 原生可用性验证**：`node -e` spawn powershell 后 `echo df-pty-ok` 能收到即 OK。ConPTY 对 OSC 完成标记**透传已实测通过**（`[char]27` 构造 `ESC]777;dfdone;...BEL` 会原样回流）→ workflow auto 步在 Windows 可用。
- **`import.meta.url` 在单文件打包/内嵌环境是虚拟路径**（如 bun exe 内 `B:/~BUN/root/...`）→ 依赖 `__dirname` 的配置/静态路径会坏；不要把服务做成无磁盘资源的单文件 exe。
- **会话列表排序**：`createdAt` 同毫秒会并列，必须带单调 `seq` 二级排序。
- **数据库只有一个文件**：`<数据目录>/void.db`，十张表 `usage`/`seed`/`member`/`member_command`/`message`/`task`/`task_cursor` + 调度队列 `t_sched_job`/`t_work_status`/`t_sched_config`/`t_sched_prompt`；`usage` 一表两粒度——`agent='*'` 是该机器当天合计（原独立的 `peer_daily` 表已合并进来，30 天只是趋势图的**读取窗口**，不再删数据），其余为 agent 明细。`task` 是成员侧「分发任务」的本机任务表（群主发布后按 `kind='skills'|'workflow'` 各一条，唯一键 `(group_id,kind,hash)`），`task_cursor` 记录各群已扫到的消息位置。调度队列也可用 MySQL（配置在 `scheduler/queue.json`，密码加密落盘）；未配置时回落到同一 `void.db` 的 SQLite 表。`GET /api/usage` 不带 agent 时自动排除合计行。改名/改结构（`usage.db`→`void.db`、老 camelCase `usage`→snake_case、`peer_daily`→合计行）都在 `createUsageStore` 里一次性幂等迁移，勿再新增 `.db` 文件。
- **xterm v5**：`term.onData(cb)` 返回 IDisposable（`offData` 已不存在）；卸载用 `dispose()`。
- **绿色包「重启后端」的助手必须跑在独立控制台**：`spawnRestart` 的助手若带 `windowsHide:true`（=CREATE_NO_WINDOW），它仍挂在服务的控制台上，服务一退/控制台一关助手即被杀 → 旧实例退了、新实例起不来（实测复现过）。必须走 `cmd /c start "" /min powershell -WindowStyle Hidden ...` 让助手拥有自己的新控制台。
- **用量上报不走加群**：slave 在协作页「机器用量」粘 master 的访问链接（`http://<host>:<port>/?access=<token>`）即可；自动采集只在每天 13:00-14:00 与 22:00 之后各执行一次（其他时间不主动调用 `stats`，手动「立即上报」与图片识别除外），把 `stats`（默认 60 天）结果 `POST /api/usage/report`（请求头 `X-DF-Token`）；master 令牌落盘在 `<数据目录>/collab/invite.json`，`days=0` 表示长期不过期、重启不丢。旧的「群内 Ed25519 签名信封上报」已删除（`/api/collab/stats`、`CollabPeer.STATS`、`store.heartbeats` 都不复存在）。
- **`ws.data` 只在服务端**：客户端拿不到；验证用服务端 Conn（`gateway.conns`）。
- WS 消息 type 一律引用 `shared` 的 `C2S`/`S2C` 常量，禁止在 server/web 里写死字符串。
- **绿色包必须带齐 `server/package.json` 的全部运行时依赖**：`server/http-api.js` 顶层 `import { transformSync } from 'esbuild'`，而打包脚本曾只拷 `node-pty`/`ws`/`@devflow/shared` → 包一启动就 `ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'` 退出（22222 根本起不来，v20260914 起就带着这个缺陷，开发环境因为有根 `node_modules` 才没暴露）。现在两个打包脚本都按 `createRequire('server/package.json')` 的**真实解析结果**拷依赖（npm workspaces 会把它提升到根或嵌套在 `server/node_modules`，位置不固定），且 platform 二进制包 `@esbuild/<platform>-<arch>` 必须与 esbuild 同版本一起带；打包末尾还会做「以包内 `server/` 视角 import 全部 dependencies + 真跑一次 `transformSync`」自检，之后新增运行时依赖只要写进 `server/package.json`，自检会覆盖。

## 打包顺序（先构建前端，再打绿色包）

- **默认「几个版本一起打」**：`node scripts/build-all.js`（等价 `npm.cmd run build:portable:all`，支持 `--no-zip`）。它先跑 `build:web`，再按平台出全套——Windows 出「内置 opencode 包 + 标准包」，macOS 一次出 arm64 + x64；只有明确只要某个变体时才用下面的分项脚本。
- Windows 下 build-all 先打 opencode 变体再打标准包：`build-opencode.js` 会重建基础目录并改名为 `-opencode`，顺序反过来会吞掉标准包目录。缺 `soft/opencode-windows-x64.zip` 时只告警跳过 opencode 变体，标准包照出。
- 单独打绿色包前必须先 `npm.cmd run build:web`（产物 `web/dist`）。
- Windows / macOS **各用各的脚本，互不交叉**：node-pty 原生模块与 Node 运行时都按平台/架构绑定，禁止交叉组装。

### Windows

- 一键打包：`node scripts/build.js`（等价 `npm.cmd run build:portable`），产物 `dist-portable/vscode-ai-windows-<arch>-<version>/`（目录）+ `vscode-ai-windows-<arch>-<version>.zip`（`<arch>` 由 `process.arch` 定，x64/arm64；`<version>` 为打包当天 `vYYYYMMDDHHmmss`，精确到秒）。产物根写入 `version.txt`，服务端启动日志与 `/api/version` 均读取该冻结版本。
- 内置 opencode 的包（独立一套，仅 Windows x64）：`node scripts/build-opencode.js`（等价 `npm.cmd run build:portable:opencode`）。它先跑 `build.js --no-zip`，再把 `soft/opencode-windows-x64.zip` 的 `opencode.exe` 打进 `opencode/`，重写 `launch.ps1` 把包内目录插到 `PATH` 最前（web 终端/调度器/用量统计/远程执行都命中包内版本），产物 `vscode-ai-windows-x64-<version>-opencode/` + 同名 `.zip`。缺该 zip 会直接报错退出；直启 `runtime\node.exe server\index.js` 不注入 PATH。
- 绿色包原理：`env/node.exe` 自带运行时 + 拷贝已编译的 node-pty 原生 `.node` → 目标机免装 Node、免编译。**Node 与 node-pty ABI 必须同大版本**；`env/node.exe` 缺失时 build.js 会自动复制当前 node 过去。

### macOS

- **必须在 macOS 上执行**：`npm install` + `npm run build:web` 后跑 `node scripts/build-mac.js`（等价 `npm run build:portable:mac`）。
- **分架构出包**，一次产出两个：`dist-portable/vscode-ai-macos-arm64-<version>/` 与 `vscode-ai-macos-x64-<version>/`（各含同名 `.zip`）；`--no-zip` 只出目录。产物命名对齐 opencode release 风格 `<name>-<os>-<arch>-<version>`，`<version>` 为打包当天 `vYYYYMMDDHHmmss`，精确到秒，各目录根写入 `version.txt`。
- 本机架构的 Node 取 `process.execPath`（缓存到 `env/node`），另一架构从 nodejs.org 下同版本官方 tarball（同样缓存进 `env/`，需联网一次）；node-pty 的 `prebuilds/darwin-<arch>/` 随 npm 包自带，无需在 Mac 上编译。
- 启动器为 `start.command`（双击；探测端口：已在运行只开浏览器，否则前台起服务，关窗即停）；用 `ditto` 压包以保留 `spawn-helper`、`runtime/node` 等的可执行位。
- 已知 Mac 限制：端口冲突弹窗不可用；`native-dialog`（文件/文件夹选择）在非 Windows 返回 `unsupported`；首次运行可能被 Gatekeeper 拦（右键→打开，或 `xattr -dr com.apple.quarantine <目录>`）。

- `env/`、`dist-portable/`、`node_modules/`、`dist/` 均不入库（.gitignore）。

## 目录速览

- `shared/` — WS 协议常量/类型（唯一事实源）；`server/` — Node ESM 后端（ws + node-pty，测试在 `server/test/`，`node --test`）；`web/` — Vue3+Vite+TS+xterm（vitest + vue-tsc）。
- Postman 小工具：`server/postman-history.js`（curl 记录/目录树，存 `<端口数据目录>/tools/postman/`）；前端 `web/src/tools/postman/`（`usePostmanHistory.ts` 数据层 + `usePostmanWorkbench.ts` 模块级共享状态 + `postmanTreeSource.ts` 树适配器 + `PostmanSidebarBar.vue` 批量执行条 + `PostmanTool.vue` 右侧面板）。已迁到统一壳子（见下条）。
- 小工具统一壳子（进行中）：小工具不再弹窗，而是作为主页面（explorer）的「工具页签」（`web/src/useCenter.ts` 的 `kind:'tool'`、id `t:<tool>`）——左侧 `aside` 显示该工具固定目录树、中央显示内容；入口为市场页/欢迎页磁贴 + 活动栏图标（`web/src/uiIntents.ts` 的 `pendingToolTab` → `App.vue` 切 rail + `center.openTool`）。
  - 统一树：`web/src/components/TreeView.vue`（唯一树组件，取代原 `FileTree`/`TreeNode`/`ItemTree`），数据源契约 `web/src/tree/treeSource.ts`，可见行纯函数 `treeRows.ts`，文件图标 `fileIcon.ts`；适配器 `projectTreeSource.ts`（项目文件）、`toolFileTreeSource.ts`（工具文件）。主页面「目录」页签已迁移（`HistoryList.vue` → `TreeView` + `projectTreeSource`）。
  - 文档查看器：`web/src/components/DocViewer.vue`（从原 `FilePreview` 抽出，注入 `DocSource`：读/写/树/详情/哈希/定位/运行等能力可选，缺省即隐藏对应 UI）；`FilePreview.vue` 退化为项目适配层；`web/src/tools/doc/`（`docSource.ts` 契约 + `toolDocSource.ts` 工具来源 + `ToolDocPane.vue` 主区内容）。
  - 工具工作台共享状态：`web/src/tools/useToolWorkbench.ts`（按 tool 共享 `files/activeId/treeSource/docSource`，供 `ToolSidebar.vue` 与主区内容共用）。
  - 已迁移：notepad / yaml / translate / markdown / postman / navicat / base64。postman/navicat 各配一份模块级共享状态（`usePostmanWorkbench.ts` / `useNavicatWorkbench.ts`）与树适配器（`postmanTreeSource.ts` / `navicatTreeSource.ts`）；markdown 为文档型工具（与 notepad 一致，新建文件默认 `.md`，经 `DEFAULT_EXT` 注入）；base64 为独立工具（无文件树，`ToolSidebar` 空侧栏 + `tools/base64/Base64Tool.vue` 上下两栏编解码）；左侧树上方小工具栏：postman「▶ 批量执行」（跑当前目录含子目录的全部用例，未选目录=全部）、navicat「＋新建连接」；搜索复用首页 `FileSearchPanel`（`TreeSource.search`/`openHit`，名字+内容，客户端实现）。`MiniTools.vue` 现仅剩磁贴（点击统一 `requestToolTab`）。Postman 批量执行经 `usePostmanWorkbench.runFolder`/`batchRun` 逐条跑并更新左树状态点。
  - 文件层：`server/notepad-store.js`（通用纯文本文件树 + 防路径穿越）；yaml/translate 各用独立目录，**notepad / markdown / js 共用 `<端口数据目录>/tools/notepad/`**（旧 `tools/markdown/`、`tools/js/` 不再读取），统一路由 `/api/files/<tool>/*`（`/api/notepad/*` 为 notepad 兼容别名），接线在 `server/http-api.js`/`server/index.js`。数据层 `web/src/tools/files/useToolFiles.ts`。新建文件未命名时用「当前日期+时间」自动命名（如 `20260920-153012.txt`）；notepad/markdown/js 工具首次打开会自动新建 `.txt`/`.md`/`.js` 并直接打开；编辑器自动保存 + Ctrl+S；`DocViewer` 提供排序/去重/「压缩」（`/api/format`，js/mjs/cjs/jsx/json）/「格式化」（Prettier）/Base64。
- 记事本的两块可复用能力已抽成共享模块，`DocViewer.vue`（原 `FilePreview`/`NotepadTool`）等共用：`web/src/base64.ts`（`encodeB64`/`decodeB64` 纯函数）+ `web/src/components/Base64Panel.vue`（编码/解码两栏面板，props `getText`，暴露 `refresh`/`reset`）；`web/src/formatText.ts`（`PARSER_BY_EXT`/`canFormatExt`/`formatText`，懒加载 Prettier 插件）。剪贴板统一走 `web/src/clipboard.ts` 的 `copyText`。
- Markdown 增强：`web/src/markdown-enhance/`（`enhanceMarkdown` 在 v-html 后把简单表格换成 `el-table`、把 Mermaid `xychart-beta`/`pie` 换成 ECharts，其余 Mermaid 仍走 `renderMermaid`；`useMarkdownEnhance` 供各 Markdown 展示位置接入）。
- 协作模块只保留群成员、群聊与用量上报：技能/工作流分发、同步种子、资产导入导出、分发任务均已移除；机器用量统计并入「代码统计」页的「用量统计」页签。
- Nginx 反代（内置反向代理）：`server/proxy-store.js`（规则 `<端口数据目录>/proxy/rules.json`）+ `server/proxy-capture.js`（抓包 `<端口数据目录>/proxy/captures/<ruleId>/`）+ `server/proxy-engine.js`（HTTP/WS/SSE 转发引擎，路径规则接入主 server 分发与 `upgrade`）+ `server/proxy-mount.js`（`/api/nginx/*`）；前端 `web/src/tools/nginx/`（`NginxTool.vue` 自包含左规则列表 + 右表单/访问日志/抓包，空侧栏）。代理页有三个页签：静态网站（`StaticSitesView.vue` + `StaticSiteCard.vue`，管理 `staticDir` 规则：选目录即设为访问根路径，可选网站前缀（如 `index/`、`compute/`，访问根路径自动跳转）、SPA 回退与左侧文件树（图标复用 `shared/file-icon`）；`.md` 用 `shared/markdown` 渲染成与文件预览一致的 HTML（Mermaid 分组/渲染与 xychart/pie 的 ECharts 增强统一走 `shared/markdown-client` + `shared/markdown-charts`，Web 与静态页同一套；静态页自动加载 `__devflow_mermaid__.js` + `__devflow_echarts__.js` + `__devflow_markdown__.js`，由 `server/mermaid-asset.js` 直出，打包时从 `mermaid/dist/mermaid.min.js`、`echarts/dist/echarts.min.js` 拷到 `server/vendor/`），`.csv` 用 `shared/csv` 渲染成表格页）、反向代理（`NginxTool.vue`，只列非静态规则）、LLM 中转站。两种接入：独立监听端口 / 挂 devflow 路径；上游 https 默认不校验证书；抓包默认关、手动开、落盘、不设条数上限。规则可设置 `staticDir` 直接托管本地目录（目录优先 index.html，否则文件列表；支持 Range/HEAD），设置后不再请求上游。
- 手机遥控（remote_coder）：`server/remote-coder-store.js`（`remote_coder/` 文件层：`messages.jsonc` 收发、`screen.png` 覆盖写、commit+push）+ `server/remote-coder-mount.js`（`/api/remote-coder/*` 端点）；前端在 `web/src/remote-coder/`（`PhoneView.vue` 手机页、`useRemoteCoder.ts` 手机侧、`useDesktopRemoteCoder.ts` 桌面侧取件）。顶栏 `📱` 新标签打开 `/?phone=1`；桌面端每 2s 拉 `/inbox`（拿到即 ack）→ 截图或把消息送进当前活动会话。
- 提示词收藏（prompts）：`web/src/prompts/`（`promptCollect.ts` 纯函数追加/去重、`usePromptCollect.ts` 模块级共享状态、`PromptCollectAddon.vue` 可复用「+」控件）；左侧历史「消息」行与终端阶段提示 chips 的「＋」都走它，点选即追加进目标工作流的阶段并保存（`GET /api/workflows-xml?sessionId=…` 读合并列表 → 去重 → `POST /api/workflows-prompt-add` / `workflows-prompt-update` 只提交单条；服务端按「项目本地 `.void/workflows` 优先、同名回落到默认工作流目录」定位，直接落成阶段目录下的 `.md` 提示词文件，不再全量重写所有工作流）。无工作流时点「＋」自动建「我的工作流 / 常用提示词」并写入（`collectToMyWorkflow`）；工作流编辑器（`WorkflowEditor.vue`）现为「左侧导航列出所有工作流名 + 右侧编辑选中工作流」布局，`WorkflowFormTab.vue` 支持 `active-id` 单选渲染。
- 工作流存储：`<数据目录>/workflows/<100_工作流>/<200_小组>/<300_阶段>/<400_技能.md>`；文件夹名（含前缀）就是 id，同一层按数字前缀升序，每个技能一个 Markdown 文件。默认工作流种子在 `config/workflows/`（随绿色包发布），启动时按工作流名补齐到数据目录：同名工作流只解压一次（不覆盖、不重复），没有的新工作流才复制；**不再用 XML/JSON 描述工作流**。
- 数据按端口隔离在 `%USERPROFILE%\.local\share\void\ports\<端口>\`；宿主端口文件在仓库根/绿色包根的 `data/port.txt`。
- 测试：`npm.cmd test`（server + web）；类型：`npm.cmd run typecheck`；代码行统计：`npm.cmd run count:code`（去注释/空行/纯括号/无英文行，输出每文件实际代码行）。

## 文档仓

`docs/` 存放团队与项目文档，现有结构：

- `docs/learn/`：流程与操作规范（提交/发布/环境等），相关规范的唯一事实源。
- `docs/knowledge/`：模块知识，按模块平铺，文件名「模块名.md」。
- `docs/memory/`：经验教训，平铺，文件名「YYYY-MM-DD-主题.md」。
- `docs/version/`：版本文档，按需求平铺文件夹，命名「US编号-名称/」（US 开头，一个需求一个文件夹）。
- `docs/superpowers/`：计划与设计草稿（specs/plans）。

每个知识/经验/版本目录保留 `README.md`（用途与命名规范）与 `.gitkeep` 占位；新增或调整目录时同步更新本节。

## 目录组织（强制）

- **一个独立功能放一个独立文件夹，不要把不相关的代码平铺到同一个目录下**：新功能优先新建自己的模块文件/子目录（必要时含各自的测试文件），按职责聚合，而不是往现有大文件或根目录里堆。
- 参照现有做法：`server/` 顶层只放与应用装配/HTTP 面相关的少量文件，功能模块各自成文件（如 `usage-store.js`、`usage-peers.js`、`usage-report.js`、`usage-mount.js`、`task-store.js`、`seed-store.js`、`collab-db.js`）；协作子系统的多个文件集中在 `server/collaboration/`；前端同理由 `web/src/collaboration/`、`web/src/components/` 分域存放。
- 定时任务类型只有 `shell`（普通命令）和 `ai`（AI 命令）；**两者最终都执行 AI 命令**：`shell` 先运行命令，把 stdout 作为 prompt 再调用 AI；脚本/工作流类型已彻底删除（启动时自动清理旧任务及其队列作业）。报告：`server/scheduler/report.js`（运行上下文 `run.json`、兜底报告）+ `web/src/scheduler/SchedulerReportView.vue`；每次运行落在 `scheduler/tasks/<taskId>/<runId>/`，通过 `DEVFLOW_RUN_CONTEXT` 注入上下文。报告唯一 ID 取任务的 `uniqueKey`：未设置时报告只留在临时运行目录；设置后复制到 `scheduler/reports/<uniqueKey>/report.md`（同目录 `meta.json`），供后续 RAG 使用。
- 调度作业队列：后端 `server/scheduler/queue/`（`partition`/`config`/`schema`/`driver-sqlite`/`driver-mysql`/`repository`/`service`/`workers`/`consumer`/`index`）+ `server/scheduler/jobs-mount.js`；前端 `web/src/jobs/`（`useJobs.ts`/`format.ts`/`JobsView.vue`），作为「定时任务」页内的「任务队列」页签，不再单独占活动栏 rail。定时器只入队，worker 按 partition 领取执行；状态码 `0排队 1成功 2失败 3调度中 4待审`；不再读写 `runs.json`，作业与报告正文都在队列表。AI 进程通过环境变量 `DEVFLOW_JOB_ID`/`DEVFLOW_JOB_TOKEN`/`DEVFLOW_JOB_CALLBACK` 调用 `POST /api/scheduler/jobs/<jobId>/callback` 自动回写状态与结果（请求头 `X-DF-Job-Token` 或 body.token），回调成功后 consumer 不再覆盖最终状态。AI 提示词版本存 `t_sched_prompt`（`id`/`taskId`/`prompt`/`hash`/`createIP`/`employeeId`/`createdAt`），创建或内容变化时追加一条，`GET /api/scheduler/tasks/<id>/prompts?hash=<sha256>` 取历史并按 hash 选中。编辑 AI 任务时可按提示词 ID/Hash 加载历史原文；深链 `?editTask=<id>&prompt=<base64原文>&promptId=<id>&promptHash=<sha256>` 可直接打开编辑，三个提示词参数只取一个，优先级 原文 > 提示词 ID > Hash。新建 AI 任务 URL 支持 `?aiPrompt=<base64>&run=1&hideInput=1`：`run=1` 立即执行，`hideInput=1` 隐藏聊天页左侧输入区。
- 同一功能的后端/前端/词条/测试改动尽量落在一起，便于一个 commit 说清一件事；新增目录时同步在「目录速览」补一行说明。
- 拆分判据：一个文件只承担一件清晰的事、能被单独理解与测试；文件明显变大且混了多种职责时，先拆再改（但不要为拆分而重构无关代码）。

## 配置（端口 + XML）

- **监听端口**存 `<应用目录>/data/port.txt`（单行纯数字；应用目录 = 仓库根 / 绿色包根，即 `server/` 的上一级，与启动 cwd 无关）。优先级：`DEVFLOW_PORT` 环境变量 > `data/port.txt` > 默认 `22222`。设置面板保存端口只写该文件，**需重启后端**才生效；`devflow.xml` 不再有 `port` 属性。
- **改端口后如何生效**：绿色包在设置面板保存端口后点「重启后端」即可；或关闭服务窗口后重新双击 `start.bat`（启动器比对 `data/port.txt`（期望端口）与 `data/runtime-port.txt`（上次运行端口），不一致时结束旧实例并按新端口启动）。dev 环境端口由 `DEVFLOW_PORT=33333` 固定，界面改端口无效、重启按钮禁用。
- **数据目录按端口隔离**：`<dataHome>/ports/<端口>/`（Windows：`%USERPROFILE%\.local\share\void\ports\<端口>\`），内含 `projects.json`、`workflows/`、`scheduler/`、`collab/`、`upload/`、`download/`、`downloads/devflow.xml` + `relay-plugins/`、`message-history.jsonc`、`skills-opencode/`、`tools/postman/`（小工具 Postman 的 curl 记录，按 curl 去重）、`void.db`（单一 SQLite 表：`usage`/`seed`/`member`/`member_command`/`message`/`task`/`task_cursor` + `t_sched_job`/`t_work_status`/`t_sched_config`/`t_sched_prompt`；其中 `usage` 一表两粒度——`agent='*'` 是该机器当天合计，其余为 agent 明细）、`input-stats.json`（按用户/日/月记录输入框消息条数的精确计数，不去重不截断；Master 月度统计以它为准）、`llm.vault.json`。**一个端口一份档案，端口之间零共享；换端口 = 换一份数据。**
- 活动配置文件：`<dataHome>/ports/<端口>/downloads/devflow.xml`（只含 `<server language host>` + `<agents>`）；首次启动从仓库模板 `config/devflow.xml` 复制生成，**已存在则不覆盖**。
- 语言可在 UI 设置面板修改，服务端就改写该文件的 `<server language>`；**Agent 列表直接编辑该文件，改完刷新页面即生效**（`/api/agents`、`/api/settings` 每次请求都重新 `loadDevflowConfig`，服务端不缓存 xml）。**例外——语言**：服务端语言是启动时读进内存的（`server/i18n.js` 的 `currentLocale`），手改 xml 的 `<server language>` 需**重启后端**才生效；走 UI 设置面板改则即时生效（`POST /api/settings/language` 会同时 `setLocale`）。仓库 `config/devflow.xml` 仅作首次 seed 模板，**改它不影响既有实例，需同步改活动配置**。
- 运行时端口记录写 `<应用目录>/data/runtime-port.txt`（供启动器打开浏览器用）。
- **不做自动迁移**：旧 `%USERPROFILE%\.local\share\devflow` 的数据不会被读取；需要时手动把 `...\devflow\ports\22222\` 内容复制到 `...\void\ports\<新端口>\`。
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
  - 宿主端口文件与运行时记录：`data/`（含 `data/port.txt`、`data/runtime-port.txt`）；
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
- **方案/选项默认用「1、2、3、4、5」阿拉伯数字编号，禁止用「A、B、C、D」字母编号**；用户输入的方案选择也默认按数字理解（用户回 A/B/C/D 时才按字母处理）。
- 能自行判断且风险可控的，不要问；有歧义或影响方向时，问，但一次只问一个。

## 提交/推送

- **每次提交/推送前，自动触发并执行 `docs/learn/git仓库提交检查和提交事项.md` 的检查清单（尤其敏感信息扫描）；未通过一律不得 commit / push。** 该文件是提交规范的唯一事实源，更新流程只改它。
- 团队/流程类知识统一沉淀到 `docs/learn/`；提交、发布、环境等操作规范都放这里，由本节挂钩。
- 一律在 `master` 操作（无远程 PR 需求时）。`git push origin master`。
- **发布 Gitee Release 只挂标准包**（`vscode-ai-windows-x64-<version>.zip`）：内置 opencode 离线包（`vscode-ai-windows-x64-<version>-opencode.zip`，约 113 MB）超出 Gitee 附件单文件 100 MB 限制，**不上传**（仅本地保留/另行分发）。发版先推 tag 再建 Release，附件只能走远端 API。
- 仓库远端残留 `feat/web-terminal` 分支，已合并删除需求时：`git push origin --delete feat/web-terminal`。
