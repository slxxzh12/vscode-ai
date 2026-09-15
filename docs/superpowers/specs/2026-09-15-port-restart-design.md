# 设计文档：端口改完能真正生效（启动器幂等应用端口 + 界面一键重启）

日期：2026-09-15
分支：master
状态：待评审

## 1. 问题与目标

上一轮把端口外置到 `<应用目录>/data/port.txt` 后，用户反馈：**界面改端口保存不了、重启后还是老端口**。

排查结论（已用证据锁定，非猜测）：

- 保存**是成功的**：绿色包 `data\port.txt` 已被写成 `44444`（20:26:01），`POST /api/settings` 也返回 `{"port":44444,"needRestart":true}`。
- 端口解析**也是对的**：在包目录实测 `resolvePort()` → `PORT_FILE=<包根>\data\port.txt`、`file=44444`、`resolve=44444`。
- **真正的原因是"重启"没有重启**：旧实例（PID 3124，20:24:12 启动）一直占着 22222，而 `launch.ps1` 用 `data\runtime-port.txt`（=22222，记录的是**上次运行**端口）来判断"是否已在运行"，`Test-Port 22222 = True` → **直接跳过启动**，只打开浏览器。于是新端口永不生效。

目标：让「改端口」在绿色包上一键闭环（保存 + 重启 → 新端口生效），并让直接双击 `start.bat` / `start.command` 时也能幂等地应用端口。

## 2. 已确认的决策

| # | 决策 | 来源 |
| --- | --- | --- |
| 1 | 同时做两件事：(a) 启动器幂等应用端口 (b) 界面「重启后端」按钮 | 用户选 3 |
| 2 | 不做端口占用自动换端口（沿用现有弹窗） | 沿用 |
| 3 | 不自动搬数据；换端口 = 换一份数据（隔离语义不变） | 沿用 |
| 4 | 不动 dev 的 `DEVFLOW_PORT=33333` 约定，只把「dev 下界面改端口无效」明确提示出来 | 沿用 |
| 5 | Windows/macOS 各改各的启动器，互不交叉 | 沿用 AGENTS.md |

## 3. 核心语义：desired / running 状态机

两个概念必须分开：

| 名称 | 来源 | 含义 |
| --- | --- | --- |
| `desired`（期望端口） | `<应用目录>/data/port.txt`，缺省 `CFG_PORT`（构建时写入，默认 22222） | 用户希望服务跑在哪 |
| `running`（运行端口） | `<应用目录>/data/runtime-port.txt`，缺省 `CFG_PORT` | 服务最近一次实际监听的端口（成功监听后才写） |

启动器决策：

```
alive(p) := 能连上 127.0.0.1:p

若 alive(running):
    若 desired == running → 只打开浏览器（现状行为）
    否则                 → 这是「改完端口后重启」：结束旧实例，再按 desired 启动
否则:
    按 desired 启动
最后：按「实际在跑的端口」打开浏览器
```

## 4. Windows 启动器（`scripts/build.js` 生成 `script/launch.ps1`）

1. 读 `desired`（`data\port.txt` → 缺省 `CFG_PORT`）与 `running`（`data\runtime-port.txt`）。
2. `Test-Port $running`：
   - 若 `$desired -ne $running`：结束旧实例（**安全校验**：用 `Get-CimInstance Win32_Process` 取该端口占用进程，仅当「进程可执行文件 = `<root>\runtime\node.exe`」或「命令行含 `server\index.js`」时才 `Stop-Process -Force`；校验不通过则**不杀**，打印明确提示并继续）。
   - 若 `$desired -eq $running`：只开浏览器并退出（保持现状）。
   - 边界：`running` 不可连但 `desired` 已被**别的程序**占用 → 仍按现状启动服务，由服务端既有的端口冲突弹窗处理（启动器不抢这个职责）。
3. 启动：`Start-Process runtime\node.exe server\index.js -WorkingDirectory $root -WindowStyle Minimized`（异步、非阻塞），等 `Test-Port $desired` 成立或超时。
4. 打开浏览器用 `$desired`（不再用 `$running`）。
5. 新增 `-Plan` 开关（仅供测试/排障）：只计算并打印决策（`desired=`/`running=`/`alive=`/`action=`）后退出，不启动任何进程、不改文件。

## 5. macOS 启动器（`scripts/build-mac.js` 生成 `script/launch.sh`）

mac 是**前台**运行（关闭终端窗口即停止），不做自动杀进程：

- `desired`/`running` 同上；`alive(running)` 用 `nc -z`。
- 若 `alive(running)`：
  - `desired == running` → 打开浏览器后退出（现状）
  - `desired != running` → 打印「已在 :%running% 运行；关闭该终端窗口后重新打开 start.command 即会切到 :%desired%」，然后打开浏览器（按 `running`）后退出
- 否则按 `desired` 启动（`exec runtime/node server/index.js`），后台延迟打开 `desired` 的浏览器
- 新增 `--plan` 参数：只打印决策后退出（测试钩子）

## 6. 服务端新接口 `POST /api/server/restart`

前置校验（任一不过 → JSON 4xx，不改动任何状态）：

| 条件 | 返回 |
| --- | --- |
| `process.env.DEVFLOW_PORT` 已设（dev / 端口被环境变量钉住） | `409 { error: 'env-port-pinned', message }` |
| `<应用目录>/start.bat`（Windows）与 `start.command`（mac）都不存在 | `409 { error: 'not-packaged', message }` |

通过后：

1. 以 **detached + unref + windowsHide** 方式拉起一个「等待本进程退出再重启」的助手：
   - Windows：`powershell -NoProfile -Command "Wait-Process -Id <pid> -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; Start-Process -FilePath '<root>\start.bat'"`，工作目录 `<root>`
   - macOS：`sh -c 'while kill -0 <pid> 2>/dev/null; do sleep 0.3; done; open "<root>/start.command"'`
2. 助手**异步**启动（立即返回，不阻塞）
3. `process.exit(0)`（由助手把服务按新端口拉起来）

`GET /api/settings` 增加两个字段（前端据此启用/禁用按钮）：

- `portSource`: `'env' | 'file' | 'default'`
- `restartable`: `boolean`（= 非 env 且存在 `start.bat`/`start.command`）

## 7. 前端（`web/src/components/TerminalView.vue` 设置面板）

- 端口输入行尾增加「重启后端」按钮：
  - `restartable === false`：按钮禁用，`title`/提示文案区分两种原因（env 固定 / 非绿色包）
  - 可点：`POST /api/server/restart` → 显示「重启中…」→ 轮询 `GET /api/version`（每 500ms，最多 30s）→ 成功则 `location.reload()`；超时显示「重启失败：{msg}」
- 现有「保存」按钮与 `term.port_saved`（已保存，重启后生效）保持不变；保存成功后按钮提示更醒目

## 8. i18n（中英对称新增）

| key | zh-CN | en |
| --- | --- | --- |
| `term.port_restart` | 重启后端 | Restart backend |
| `term.port_restarting` | 重启中… | Restarting… |
| `term.port_restart_failed` | 重启失败：{msg} | Restart failed: {msg} |
| `term.port_restart_pinned` | dev 模式端口由 DEVFLOW_PORT 固定，请在环境变量里改 | In dev the port is pinned by DEVFLOW_PORT; change it via the env var |
| `term.port_restart_notpackaged` | 仅绿色包支持一键重启 | One-click restart is only available in the portable build |

## 9. 为了可测，抽出发射器生成器

`build.js` / `build-mac.js` 目前把启动器源码内联在函数里，无法单测。改造：

- 新增 `scripts/launcher.js`（CJS，供两个构建脚本 `require`）：
  - `makeLaunchPs1({ port })` → 生成 `launch.ps1` 文本
  - `makeLaunchSh({ port })` → 生成 `launch.sh` 文本
  - `makeStartCommand()` → 生成 `start.command` 文本
- `build.js` / `build-mac.js` 改为调用它们（生成的产物内容除新增逻辑外**保持不变**，包括桌面快捷方式、Open-with 注册、使用说明）
- 单测直接断言生成文本，配合 §4.5 / §5 的 `-Plan` / `--plan` 钩子做**真实行为测试**

## 10. 测试与验收

**单测**

| 文件 | 内容 |
| --- | --- |
| `server/test/launcher.test.js` | `scripts/launcher.js`：PS 文本含 desired/running/`Stop-Process` 安全校验/`-Plan`；sh 文本含 `data/port.txt` 优先、`nc -z`、`--plan` |
| `server/test/launcher-plan.test.js` | 用真实 `powershell -File <临时目录>/launch.ps1 -Plan` 跑三种场景：相等且存活（open）、不等且存活（restart）、不存活（start）。**用假端口文件与假端口号**，不启动任何服务；非 Windows 平台 `t.skip`；`--plan` 的 mac 分支仅做文本断言 |
| `server/test/server-restart.test.js` | `POST /api/server/restart`：设 `DEVFLOW_PORT` → 409 `env-port-pinned`；包目录无 `start.bat` → 409 `not-packaged`（都在临时目录、不真重启） |

**人工验收**

1. 绿色包：设置面板把端口从 22222 改成 44444 → 保存 → 点「重启后端」→ 约 3-5s 后页面自动刷新，服务在 44444，数据目录变为 `...\void\ports\44444`
2. 直接双击 `start.bat`（旧实例仍在 22222、`port.txt` 已改 44444）→ 旧实例被结束，新实例起在 44444，浏览器打开 44444
3. dev（`npm run dev:server`）→ 按钮禁用，提示 `term.port_restart_pinned`
4. `npm.cmd test` / `npm.cmd run typecheck` / `npm.cmd run check:i18n` 全绿；`node scripts/build.js` 重新出包

## 11. 明确不做

- 不做端口占用自动换端口（沿用弹窗）
- 不自动迁移数据（换端口 = 换一份数据）
- 不改 dev 的 `DEVFLOW_PORT=33333` 约定
- 不在 macOS 上做自动杀旧实例（mac 是前台运行，关窗即停）
- 不在启动器里引入对 node 的额外调用（保持脚本自包含，避免 node 不可用时启动器失效）

## 12. 决策记录

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 修复范围 | 启动器幂等 + 界面一键重启（选项 3） | 用户选择；两条路径都覆盖，避免"双击 start.bat 无效"类困惑 |
| 「重启」实现 | 服务端 spawn detached 等待助手后自退 | 无需守护进程；与 AGENTS.md「常驻进程异步启动」一致 |
| dev 行为 | 拒绝重启并明确提示 | `DEVFLOW_PORT` 优先级最高，界面改端口本就不可能生效，提示比静默失败好 |
| 启动器逻辑测试 | 抽出 `scripts/launcher.js` + `-Plan` / `--plan` 钩子 | 启动器逻辑此前完全无法测试；用真实 PowerShell 跑 plan 分支即可低成本验证 |
| 杀旧实例的安全边界 | 只杀「本应用 runtime\node.exe + server\index.js」 | 避免误杀用户其它占用端口的程序 |
