# 设计文档：内置 opencode 的 Windows 打包（独立一套）

日期：2026-09-17
分支：master
状态：已评审通过，待编写实施计划

## 1. 概述

仓库现有两套打包脚本，分别产出「不含 opencode」的绿色包：

- `scripts/build.js` → Windows（`vscode-ai-windows-<arch>-<version>`）
- `scripts/build-mac.js` → macOS（arm64 + x64）

本设计**新增第三套、独立的一套 Windows 打包**：把 `soft/opencode-windows-x64.zip` 里唯一的 `opencode.exe` 打进包内，并保证包启动后**优先使用包内 opencode**（web 终端里输入的 `opencode`、调度器 `opencode run`、用量统计 `opencode stats`、远程执行全部命中包内版本）。

现有 `build.js` 与 `build-mac.js` **保持现状、不改**。

核心约束（已与用户逐条确认）：

| # | 决定 | 取值 |
|---|------|------|
| 1 | 组织方式 | 现有两套脚本不动；另新增一套脚本（不是改 `build.js`，也不是加 `--with-opencode` 开关） |
| 2 | opencode 来源 | 仓库内 `soft/opencode-windows-x64.zip`（解压后单个 `opencode.exe`，约 180 MB） |
| 3 | 运行期如何命中包内版本 | 打包器把「包内 opencode 目录」插到 `launch.ps1` 的 `PATH` 最前；服务端零改动 |
| 4 | 复用现有打包逻辑 | 新脚本先调 `build.js --no-zip` 产出标准包，再做后处理；`build.js` 一行不动 |
| 5 | 覆盖范围 | 只覆盖 Windows x64；`soft/` 下只有 windows-x64 产物，macOS 无对应包、必须留在 Mac 打包，故天然不动 |
| 6 | 绕过启动器的情况 | 直启 `runtime\node.exe server\index.js` 不注入 `PATH`（仍用系统 opencode）；在「使用说明」里注明，不在本次覆盖 |

## 2. 现状与落点

- `scripts/build.js`：把 Node 运行时、`server/`、`web/dist`、`config/`、运行时依赖（`node-pty`/`ws`/`@devflow/shared`/`esbuild`+平台二进制）拷进 `dist-portable/vscode-ai-windows-<arch>-<version>/`，生成 `script/launch.ps1`、`start.bat`、`使用说明.txt`，做产物自检 + 运行时依赖真实 import 自检，最后 `Compress-Archive` 出 zip。`--no-zip` 只出目录。
- `scripts/launcher.js`：`makeLaunchPs1({ port })` 生成 Windows 启动脚本；`makeLaunchSh` / `makeStartCommand` 供 macOS 用。已测（`server/test/launcher.test.js`、`server/test/launcher-plan.test.js`）。
- `server/index.js:225`：用量上报的 `cmd` 取 `devflow.xml` 默认 agent 的 `cmd`（默认 `opencode`）。
- `server/scheduler/index.js:7`、`server/collaboration/agent-stats.js:35`、`server/collaboration/remote-runner.js:5`、`server/translate.js`：都按裸命令名 `opencode` spawn / exec，走 `PATH` 解析。
- web 终端由 node-pty 起 shell，`opencode` 由用户在 shell 里输入，同样走 `PATH`。
- 结论：**把包内目录放到 `PATH` 最前，即可让上述所有路径命中包内 opencode**，无需改配置、协议或服务端代码。

## 3. 新增 `scripts/build-opencode.js`

CommonJS（`"use strict"`），仅在 `win32` + `x64` 下允许执行（否则报错退出）。

流程：

1. **前置校验**：`process.platform === 'win32'`、`process.arch === 'x64'`；`soft/opencode-windows-x64.zip` 存在。`web/dist` 与依赖完整性交给下一步的 `build.js` 校验。
2. **产出标准包**：`spawnSync(process.execPath, [scripts/build.js, '--no-zip'], { stdio: 'inherit' })`，状态非 0 直接退出（错误原样透传给用户）。
3. **算路径**：`VERSION = todayVersion()`（`shared/version.cjs`），`BASE = 'vscode-ai-windows-x64-' + VERSION`，`APP = dist-portable/BASE`，`FINAL = dist-portable/BASE + '-opencode'`，`ZIP = FINAL + '.zip'`。
4. **解压 opencode**：用 PowerShell 的 `[System.IO.Compression.ZipFile]::ExtractToDirectory` 把 zip 解到 `dist-portable/.opencode-tmp/`，把其中的 `opencode.exe` 拷到 `APP/opencode/opencode.exe`，删临时目录。zip 内应恰好只有 `opencode.exe`，缺文件则报错退出。
5. **冒烟 + 取版本**：运行 `APP/opencode/opencode.exe --version`（超时 30s，隐藏窗口）。失败或超时即报错退出，避免打出坏的包；成功则记下版本号。
6. **重写 `launch.ps1`**：`"\uFEFF" + makeLaunchPs1({ port: CFG_PORT, opencodeDir: 'opencode' })` 覆盖 `APP/script/launch.ps1`（BOM 必须保留）。`CFG_PORT` 读取逻辑与 `build.js` 一致（`config/devflow.xml` 的 `<server port>`，缺失回落 `22222`）。
7. **补说明**：向 `APP/使用说明.txt` 追加：本包内置 opencode（版本号）、启动后优先用包内版本、以及「直启 `runtime\node.exe server\index.js` 时不会注入包内 opencode 的 PATH」。
8. **更名**：先删已存在的 `FINAL` 目录与 `ZIP`，再把 `APP` 重命名为 `FINAL`（保证幂等）。
9. **自检**：`FINAL/opencode/opencode.exe` 存在且能 `--version`；`FINAL/script/launch.ps1` 含 `PATH` 注入行；缺失即失败退出。
10. **压缩**（非 `--no-zip`）：`Compress-Archive -Path '<FINAL>' -DestinationPath '<ZIP>' -CompressionLevel Optimal`，与 `build.js` 同法（zip 内根即 `FINAL` 目录名）。
11. **摘要**：打印 `FINAL` 路径、目录大小（MB）、内置 opencode 版本、`ZIP` 大小。

## 4. `scripts/launcher.js` 改动（向后兼容）

`makeLaunchPs1({ port, opencodeDir = '' })` 增加**可选**参数。当 `opencodeDir` 非空时，在算出 `$root` 之后插入两行：

```powershell
$ocDir = Join-Path $root '<opencodeDir>'
if (Test-Path (Join-Path $ocDir 'opencode.exe')) { $env:PATH = $ocDir + ';' + $env:PATH }
```

- 插入点在 `$root` 计算之后、任何 spawn 与 `Start-Process` 之前，`Start-Process` 启动的 node 会继承该 `PATH`；「重启后端」由当前 node 再 spawn，新进程继续继承，故持久有效。
- **不传 `opencodeDir` 时输出与现状逐字节一致**：`build.js`、`build-mac.js` 的调用参数不变，产物不受影响；`makeLaunchSh` / `makeStartCommand` 不动。

## 5. `package.json`

新增脚本：`"build:portable:opencode": "node scripts/build-opencode.js"`（与 `build:portable`、`build:portable:mac` 并列）。

## 6. 产物与命名

- 目录：`dist-portable/vscode-ai-windows-x64-<version>-opencode/`（末尾 `-opencode` 与标准包区分）。
- 包内新增：`opencode/opencode.exe`。
- 压缩包：`dist-portable/vscode-ai-windows-x64-<version>-opencode.zip`。
- 运行期数据目录、端口、桌面快捷方式名（`Void.lnk`）与标准包相同——这是现有设计，不在本次改动，同机同时安装两个包会争同一端口/数据，属用户使用选择。

## 7. 边界情况

- 非 Windows 或非 x64 执行：报错退出（`soft/` 只有 windows-x64 产物）。
- `soft/opencode-windows-x64.zip` 缺失：报错并提示应放路径。
- zip 内无 `opencode.exe`：报错退出。
- 解压出的 `opencode.exe --version` 失败或超时：报错退出，不产出坏包。
- `build.js` 因 `web/dist` 陈旧 / 缺依赖 / 前端新鲜度检查失败：原样透传其输出并以非 0 退出。
- `--no-zip`：只出目录、不压缩。
- 重复执行：先删 `FINAL` 与 `ZIP` 再重建，幂等。
- `config/devflow.xml` 无 `port` 属性：`CFG_PORT` 回落 `22222`（与 `build.js` 相同）。

## 8. 测试与验证

- `server/test/launcher.test.js`（扩展）：
  - `makeLaunchPs1({ port: 22222, opencodeDir: 'opencode' })` 含 `$env:PATH` 与 `opencode`，且该行在 `Start-Process` 之前；
  - `makeLaunchPs1({ port: 22222 })`（不传）**不含** `$env:PATH`，锁定「现有产物零变化」。
- 打包脚本本身含大量 I/O 与 180 MB 二进制，不进单测；用命令验证：
  - `npm.cmd run build:portable:opencode -- --no-zip` → 检查 `dist-portable/vscode-ai-windows-x64-<version>-opencode/opencode/opencode.exe` 与 `script/launch.ps1` 的 PATH 注入行；
  - 实跑 `powershell -NoProfile -ExecutionPolicy Bypass -File "<FINAL>\script\launch.ps1" -Plan -NoBrowser -NoShortcut`，确认带 BOM 的脚本无语法错误、能打印 `PLAN ...`；
  - 起包后（或在包内 shell）执行 `opencode --version`，确认命中包内版本。
- 全量回归：`npm.cmd test`、`npm.cmd run check:i18n`、`npm.cmd run typecheck`。
- 提交前跑 `docs/learn/git仓库提交检查和提交事项.md` 的检查清单。

## 9. 影响面

- 新增：`scripts/build-opencode.js`、本设计文档。
- 修改：`scripts/launcher.js`（`makeLaunchPs1` 加可选参数）、`package.json`（一条 script）、`server/test/launcher.test.js`（新增断言）。
- 不改：`scripts/build.js`、`scripts/build-mac.js` 及其产物；`soft/`、`server/`、`web/`、`shared/` 业务代码与协议；无 i18n 词条新增。

## 10. 明确不做（YAGNI）

- 不做 macOS 内置 opencode（无对应产物；须在 Mac 打包，另立需求）。
- 不做服务端启动时自探测包内 opencode 并注入 `PATH`（决策 6：本次只走启动器）。
- 不改 `devflow.xml` 的 `cmd`（避免写死路径）。
- 不调整 `soft/` 的 git 跟踪状态（`opencode-windows-x64.zip` 已入库，60 MB；是否改为忽略/外置由用户另行决定，不属本次范围）。
