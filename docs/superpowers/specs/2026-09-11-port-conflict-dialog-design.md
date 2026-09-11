# 设计文档：端口占用改为弹窗询问（不自动换端口）

日期：2026-09-11
分支：master
状态：待评审

## 1. 概述

当前服务启动时若配置端口被占用，会**自动回退** `22222 → 33333 → 44444`（`server/index.js` 的 `CANDIDATE_PORTS`）。

用户要求改为：

1. **不再自动更换端口**。
2. 端口被占用时**弹系统对话框**，让用户选择：
   - 结束占用端口的进程并**在同端口重启**；
   - **更换端口**：使用我们预设的候选端口，也允许用户自行输入；
   - 取消 → 退出服务。
3. 更换端口会导致按端口划分的数据档案（`ports/<id>`，由 `ports-state.json` 的 `byListenPort` 映射）在新端口下可能无法自动匹配，需**明确警告用户**历史数据可能找不到。

弹窗复用仓库已有的 Windows 原生对话框基建 `server/native-dialog.js`（PowerShell + WinForms）。

### 已与用户确认的约束

- 端口被占用时弹出提示，让用户选择「结束占用进程并重启」或「更换端口」。
- **不自动更换端口**（去掉现有 33333/44444 自动回退）。
- 更换端口：提供预设候选端口（沿用 33333 / 44444），并允许手动输入 `1-65535`。
- 更换端口时**提示用户**：之前该端口的历史数据可能无法自动找到。
- 仅 Windows 有原生弹窗（与现有 `native-dialog` 一致）；非 Windows 无法弹窗时打印错误后退出。

## 2. 现状与影响面

- `server/index.js:475-546`：`CANDIDATE_PORTS` + `startListening()` 自动回退逻辑。
- `server/native-dialog.js`：已有 `runDialog()`（PowerShell + WinForms，`-STA`，TopMost 隐藏 owner），导出 `pickFile/pickAnyFile/pickFolder`。
- `server/workspace.js`：数据档案 `ports/<id>`，`ports-state.json` 以监听端口 (`byListenPort`) 映射档案；换端口后映射可能缺失 → 新端口下可能进入「选择数据档案」流程或新建档案。
- `server/devflow-config.js:135`：`updateServerAttrs(file, { port })` 就地把端口写回活动配置 XML。
- `scripts/build.js:151`：使用说明写有「端口：默认 22222，被占用时自动切换 33333 / 44444」，需同步措辞。
- i18n：`shared/i18n/zh-CN.js` + `en.js`（弹窗文案必须中英对称）。

## 3. 弹窗设计

在 `server/native-dialog.js` 新增导出 `askPortConflict(opts)`，仅在 `process.platform === 'win32'` 可用；返回：

| 返回 | 含义 |
| --- | --- |
| `{ action: 'kill' }` | 结束占用进程并同端口重启 |
| `{ action: 'switch', port: n }` | 更换到端口 `n` |
| `{ action: 'cancel' }` | 取消 / 超时 |
| `{ error: '...' }` | 非 Windows / spawn 失败 / 对话框失败 |

界面（`System.Windows.Forms`）：

- 标题：`端口被占用`；正文：`端口 {port} 已被占用。`
- 单选 A（默认选中）：`结束占用进程并重启（端口 {port}）`
- 单选 B：`更换端口` + **可编辑下拉框**（`DropDown`），选项为**当前空闲的候选端口**（预检 `33333`/`44444`，只列空闲项），默认填入第一个空闲候选；用户可手动输入任意 `1-65535`。
- 单选 B 下方**警告文本**：`更换端口后，之前该端口的历史数据可能无法自动找到（需在页面中选择数据档案）。`
- 按钮：`确定`（OK）/ `取消`（Cancel = 取消并退出）。设 `AcceptButton` / `CancelButton`。
- 窗口 `TopMost = $true`、`StartPosition = CenterScreen`；无隐藏 owner 需求（不同于文件选择框）。

实现要点：

- **文案传参用环境变量**（`DF_PC_TITLE` / `DF_PC_MESSAGE` / `DF_PC_KILL` / `DF_PC_SWITCH` / `DF_PC_WARN` / `DF_PC_OK` / `DF_PC_CANCEL` / `DF_PC_CANDIDATES`），`spawn('powershell.exe', ['-NoProfile','-STA','-Command', ps], { env: { ...process.env, ... } })`；PowerShell 读 `$env:DF_PC_*`。避免中英文引号 / 换行 / 特殊字符在 `-Command` 中的转义问题。
- 结果经 `[Console]::Out.Write(...)` 回传：`kill` / `switch:<port>` / 空（取消）。
- 超时（默认 120s）→ 视为取消：`child.kill()` + `{ action: 'cancel' }`。
- `switch:<text>` 的端口数值校验由服务端做；非整数或超范围 → 记错误并退出。

## 4. 服务端处理流程

移除 `CANDIDATE_PORTS` 自动回退，改为单端口启动：

```
startListening(port):
  onError(EADDRINUSE)  -> handlePortConflict(port)
  onError(其他)        -> log.error + exit(1)
  onListening          -> 记 actualPort / writeRuntimePort / 进入原档案初始化流程

handlePortConflict(port):
  次数超过上限（如 5）-> log.error + exit(1)
  win32 且弹窗成功:
    kill        -> killPids(findPidsOnPort(port)) -> 等待释放 -> startListening(port)
    switch:n    -> updateServerAttrs(configFile, { port:n })
                   -> 用 n 重跑 startListening(n)（同端口再冲突会再次弹窗，受上限约束）
    cancel      -> log.error + exit(1)
  非 win32 / 弹窗失败 -> log.error(端口被占用) + exit(1)
```

- `PORT` 既定来源不变：`DEVFLOW_PORT` > 活动 XML `<server port>` > `DEFAULT_PORT`。
- 同端口重启的「重启」含义 = 在同一进程内 `taskkill` 后重新 `server.listen(原端口)`；不改进程生命周期。
- `writeRuntimePort` / `actualPort` / 档案初始化逻辑不变（`start.bat` 仍读 `config/runtime-port.txt`）。

## 5. 新增模块 `server/port-conflict.js`

纯函数 + 可注入 exec，便于单测：

- `parseListeningPids(netstatOutput, port)`：从 `netstat -ano -p tcp` 文本解析该端口 `LISTENING` 的 PID 集合。
  - 匹配形如 `TCP  127.0.0.1:22222  0.0.0.0:0  LISTENING  12345` 与 IPv6 `[::]:22222`。
- `findPidsOnPort(port, { exec = execFile } = {})`：跑 `netstat -ano -p tcp` → `parseListeningPids`。
- `killPids(pids, { exec = execFile } = {})`：对每个 PID 执行 `taskkill /F /T /PID <pid>`；忽略单个失败。
- `isPortFree(host, port)`：用 `node:net` 尝试 `listen`，`EADDRINUSE` → false，成功后关闭并返回 true。

## 6. i18n 词条

`shared/i18n/zh-CN.js` 与 `en.js` 对称新增（复用现有 `common.ok` / `common.cancel`）：

| key | zh-CN | en |
| --- | --- | --- |
| `port.in_use.title` | 端口被占用 | Port in use |
| `port.in_use.message` | 端口 {port} 已被占用。 | Port {port} is already in use. |
| `port.in_use.kill` | 结束占用进程并重启（端口 {port}） | Kill the occupying process and restart (port {port}) |
| `port.in_use.switch` | 更换端口 | Use another port |
| `port.in_use.warn` | 更换端口后，之前该端口的历史数据可能无法自动找到（需在页面中选择数据档案）。 | After changing the port, previous data for that port may not be found automatically (you may need to select a data profile in the UI). |
| `port.in_use.killed` | 已结束占用端口 {port} 的进程 {pids}，正在重启。 | Killed process(es) {pids} on port {port}, restarting. |
| `port.in_use.kill_failed` | 结束占用进程失败：{err} | Failed to kill the occupying process: {err} |
| `port.in_use.switched` | 端口已改为 {port}（已写入配置）。 | Port changed to {port} (written to config). |
| `port.in_use.exit` | 端口 {port} 被占用且未处理，服务退出。 | Port {port} is in use and was not resolved; exiting. |
| `port.in_use.unsupported` | 当前系统不支持弹窗，端口 {port} 被占用，服务退出。 | Native dialogs are unsupported on this OS; port {port} is in use; exiting. |

- 弹窗文案属用户可见 → 必须中英双语。
- 日志同样走 `t()`（日志虽在 `check:i18n` 排除项内，但保持可翻译更一致）。

## 7. 使用说明同步

`scripts/build.js` 的 `usage`（`使用说明.txt`）：把

```
端口：默认 22222，被占用时自动切换 33333 / 44444
```

改为

```
端口：默认 22222；被占用时弹窗询问：结束占用进程并重启 / 更换端口
```

（候选 33333 / 44444 仍作为「更换端口」的预设候选保留。）

## 8. 测试与验收

- 单测 `server/test/port-conflict.test.js`：
  - `parseListeningPids`：命中 IPv4 / IPv6 / 多 PID / 非 LISTENING / 其他端口不误伤。
  - `isPortFree`：占用端口返回 false，空闲端口返回 true。
  - `killPids`：注入的 exec 被以 `taskkill /F /T /PID <pid>` 调用。
- i18n：`server/test/i18n.test.js` 增加 `port.in_use.*` 中英均存在的断言；`npm.cmd run check:i18n` 通过。
- 类型检查：`npm.cmd run typecheck` 通过；全量 `npm.cmd test` 通过。
- 人工验收（Windows）：
  1. 占用 22222 后启动 → 弹出对话框；
  2. 选「结束占用进程并重启」→ 进程被杀、服务在原端口起来了；
  3. 选「更换端口」并选/填端口 → 配置被改写、服务在新端口起来；再次启动沿用新端口；
  4. 选「取消」→ 进程退出，端口不变。

## 9. 明确不做

- 不做自动换端口（删除现有回退）。
- 不做控制台 readline 提示（统一用原生弹窗）。
- 不做「记住本次选择，以后自动处理」的持久策略。
- 不改动档案/项目数据的存储结构；换端口后的档案选择沿用现有 `resolveProfile` 流程。

## 10. 决策记录

- 弹窗而非控制台提示：非 Windows 不弹窗。
- 三类去向（杀进程同端口重启 / 换端口 / 取消）：用户明确。
- 换端口保留候选 33333/44444 且可自定义：用户明确「用我们选好的其他端口替代，用户也可以自己输入」。
- 换端口需警告数据影响：用户明确「之前历史数据可能会无法找到，要提示用户」。
- 换端口写回活动配置：与 UI 设置面板改端口的行为一致；候选端口仅列空闲项以降低再次冲突概率。
