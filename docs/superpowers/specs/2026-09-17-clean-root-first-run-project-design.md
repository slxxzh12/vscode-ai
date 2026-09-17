# 设计文档：首次无项目引导 + dev 日志归位 + 仓库根清理

日期：2026-09-17
分支：master
状态：已与用户确认方案（待实现）

## 1. 概述

三件互相关联的小改动，目标是「首次启动好引导 + 根目录干净」：

1. **首次无项目 → 自动弹窗让用户选目录**：绿色包 `sampleProjects()` 已不再默认塞 `process.cwd()` 项目（提交 `1401d4c`），但空列表时前端只是显示「未选择项目」，用户不知道下一步该干什么。改为自动打开现有「添加目录」弹窗。
2. **dev 日志统一进 `logs/`**：仓库根曾散落 `dev-server.log` / `dev-server.err.log` / `dev-web.log` / `dev-web.err.log`，同时 `logs/` 里又有一套，重复且污染根目录。
3. **仓库根清理**：根目录只保留源码/配置/文档；日志、临时产物一律进子目录。

已确认边界：**release 包根的 `start.bat` 保留**（双击入口），本次不动启动器位置。

需求原文（用户）：

> 为什么编译后的release 项目，一开始启动时候，直接把当前的启动路径变成默认的项目了呢，我觉得如果默认没有的话，弹出一个窗口，让用户输入项目目录路径
>
> 调测的日志等我觉得都要放到logs目录里面，后续启动页不要放到根目录下

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 无项目时如何引导 | 自动打开现有「添加目录」弹窗（含「选择」原生目录选择器 + 手输路径） |
| 2 | 弹几次 | 每个页面会话最多自动弹 1 次（`prompted` 标志），用户取消后不再骚扰 |
| 3 | 服务端是否改 | 不改：`sampleProjects()` 已是 `{ projects: [] }`；仅前端引导 |
| 4 | dev 日志怎么归位 | 新增 `scripts/dev.js` + `npm run dev`，并行起 server/web，日志写 `logs\dev-server.log`、`logs\dev-web.log`；保留 `dev:server` / `dev:web` |
| 5 | 根目录遗留日志 | 删除（本身未入库） |
| 6 | `remote_coder/` | **保留不动**：截图功能的既定输出目录（`server/snapshot-store.js` `SNAPSHOT_DIR='remote_coder'`，设计见 `2026-09-12-snapshot-webpage-design.md`，明确要留、要入库）；根目录容忍该目录 |
| 7 | `start.bat` | 保留在 release 包根 |

## 3. 现状（改动前）

- `server/config.js` `sampleProjects()` 返回 `{ projects: [] }`；`ensureDefaults()` 只在文件不存在时写入，**已存在的 `projects.json` 不会被覆盖** → 老版本跑过留下的 `local`（本机目录）项目会一直保留，这是用户仍看到「启动路径变成默认项目」的根因。
- `web/src/App.vue` `loadProjects()`：仅当有项目时选中一个；列表为空时什么都不做，界面停在 `app.no_project` / `tree.no_project`。
- 现有「添加目录」弹窗：`openAddFolder()` → `addOpen` → 输入框 + `chooseFolder()`（`/api/projects/pick` 原生选择器）+ `confirmAddFolder()`（`POST /api/projects`）。
- dev 启动靠手工 `Start-Process ... -RedirectStandardOutput <根>\dev-*.log`（见 `AGENTS.md` 与 `docs/superpowers/plans/` 里的示例命令），没有任何脚本约束日志位置。
- `remote_coder/devflow-20260916-163955.png` 已入库（commit `a005c29`）。**更正**：它并非临时产物，而是「网页截图」功能的既定输出目录（`SNAPSHOT_DIR='remote_coder'`，设计文档明确「目标为仓库内 `remote_coder/`」且「不清理/轮转历史截图」），**保留不动**。

## 4. 设计

### 4.1 首次无项目引导（前端）

- `App.vue` 新增 `noProjectPrompted` 状态；`loadProjects()` 在「无项目 且 未提示过」时调用 `openAddFolder()` 打开弹窗。
- 弹窗内新增一行提示（仅在无项目时显示）：`top.first_project_hint`。
- 用户点「选择」→ 原生目录选择器；不支持（mac）→ `top.pick_unsupported` 提示，退回手输路径。
- 添加成功后走既有 `confirmAddFolder()`：`loadProjects()` + `selectProject()`，列表非空，不再触发引导。

### 4.2 dev 日志归位

- 新增 `scripts/dev.js`（Node，跨平台）：
  - 创建 `logs/`；
  - `spawn` 起 `dev:server`（`node --watch server/index.js`，`DEVFLOW_PORT=33333`）与 `dev:web`（`npm --prefix web run dev`），stdout/err 追加写 `logs/dev-server.log`、`logs/dev-web.log`；
  - 父进程收到 SIGINT/SIGTERM（Windows 下 Ctrl-C）时结束两个子进程。
- `package.json` 新增 `"dev": "node scripts/dev.js"`，保留 `dev:server` / `dev:web`。
- `AGENTS.md`「服务启动规范」补一条：dev 日志一律写 `logs\`，禁止落仓库根。
- `.gitignore` 增加 `logs/`。

### 4.3 仓库根清理

- 删除根目录 4 个 `dev-*.log`。
- `remote_coder/`：**保留不动**（截图功能既定输出目录，见 §2 决策 6）。
- 根目录只剩：`.gitignore`、`AGENTS.md`、`README.md`、`package.json`、`package-lock.json` + 源码目录 `config/ docs/ scripts/ server/ shared/ skills/ web/`，以及功能输出目录 `remote_coder/`。

## 5. 影响面

| 文件 | 改动 |
| --- | --- |
| `web/src/App.vue` | 无项目引导 + 弹窗提示行 |
| `shared/i18n/zh-CN.js` / `en.js` | 新增 `top.first_project_hint`（中英同步） |
| `scripts/dev.js` | 新增 dev 并行启动器（日志进 `logs/`） |
| `package.json` | 新增 `dev` 脚本 |
| `AGENTS.md` | dev 日志位置规范 |
| `.gitignore` | 新增 `logs/` |
| `remote_coder/` | 保留不动（截图功能输出目录，非临时产物） |

## 6. 验证

- `npm.cmd run check:i18n`（词条中英对称、无硬编码中文）。
- `npm.cmd run typecheck`（App.vue 类型）。
- `npm.cmd test`（server + web 回归）。
- 手工：清空 `%USERPROFILE%\.local\share\void\ports\33333\projects.json` 后打开 dev 页面 → 自动弹「添加目录」；加完项目后选择器出现。
- 手工：`npm.cmd run dev` → 确认 `logs\dev-server.log`、`logs\dev-web.log` 生成，根目录无 `dev-*.log`。
