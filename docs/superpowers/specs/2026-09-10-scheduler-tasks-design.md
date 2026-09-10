# 设计：定时任务（左栏页签）

日期：2026-09-10

## 背景与目标

需要一个与现有终端/工作流**隔离**的定时任务能力：左侧 rail 增加一个「定时任务」页签，用户可定义任务，按周期或每日时刻自动触发，执行内容支持三类：

- `shell`：手写一行/多行 shell 命令；
- `ai`：AI 命令——从本机 opencode 自定义 command 列表中选，或手写 prompt，实际以 `opencode run "<文本>"` 执行；
- `script`：执行项目内的脚本文件（`.ps1` / `.bat` / `.cmd` / `.sh`）。

任务在**后台独立子进程**中执行，输出采集为日志，浏览器关闭后仍按计划运行；结果在定时页签内查看（运行历史 + 输出全文）。目标是与现有代码尽量隔离，不改动终端会话与工作流核心逻辑。

## 架构（方案 A）

```
SchedulerView.vue（列表 / 编辑器 / 历史）
  → REST  /api/scheduler/*           （增删改查、立即运行、停止、日志、ai-commands）
  → WS    SchedulerS2C 事件           （任务变更 / 运行开始 / 运行结束；经现有 /ws 广播）
server/scheduler/engine.js           调度引擎（1s tick，到期触发）
server/scheduler/runner.js           无头子进程执行 + 日志落盘
server/scheduler/store.js            tasks.json / runs.json 原子持久化
server/scheduler/ai-commands.js      扫描 opencode command 目录
server/scheduler/http-mount.js       REST 路由
```

- 与协作子系统同构：C2S 走 HTTP（`http-mount`），S2C 经 `server/index.js` 注入的事件广播到 `gateway.conns`（不进入 `ws-gateway.js` 的 `handleMessage` 分发）。
- 复用现有 `/api/tree`（脚本选择）、`data-home.js`（数据目录）、`settings.js` 的原子写盘模式（`.tmp` + rename）。
- **不改动** `ws-gateway.js`、`session-manager.js`、`pty-runner.js`、`workflow-runner.js`。

## 隔离边界与涉及文件

新增：

```
shared/scheduler.js               # SchedulerS2C 事件常量（仿 shared/collab.js）
shared/scheduler.d.ts             # 类型定义
server/scheduler/store.js
server/scheduler/schedule.js
server/scheduler/runner.js
server/scheduler/engine.js
server/scheduler/ai-commands.js
server/scheduler/http-mount.js
server/scheduler/index.js         # barrel: createScheduler()
server/test/scheduler-store.test.js
server/test/scheduler-schedule.test.js
server/test/scheduler-runner.test.js
server/test/scheduler-engine.test.js
server/test/scheduler-http.test.js
server/test/scheduler-const.test.js
web/src/scheduler/SchedulerView.vue
web/src/scheduler/useScheduler.ts
web/src/scheduler/types.ts
web/src/scheduler/format.ts
web/src/scheduler/format.test.ts
web/src/scheduler/useScheduler.test.ts
本设计文档
```

修改（仅三处）：

- `server/index.js`：实例化 scheduler、挂载 `/api/scheduler`、把 scheduler 事件广播到 `gateway.conns`。
- `web/src/App.vue`：`rail` 联合类型加 `'scheduler'`；activity rail 加 `⏰` 按钮；`rail === 'scheduler'` 时中心区渲染 `<SchedulerView :terminal="terminal" />`。
- `shared/package.json`：新增 `./scheduler` 导出（`shared/index.d.ts`、`shared/index.js` 不动）。

## 数据模型

任务定义存 `dataHome()/scheduler/tasks.json`（顶层数组）：

```jsonc
{
  "id": "t_ab12cd34",
  "name": "每日构建",
  "enabled": true,
  "projectId": "local",              // 项目优先，可为 null
  "cwd": null,                        // 可选覆盖目录；解析顺序 cwd || project.root || dataHome()
  "type": "shell",                    // shell | ai | script
  "command": "npm run build",         // type=shell
  "ai": {                             // type=ai
    "source": "command",              // command | prompt
    "commandName": "review.md",       // source=command
    "prompt": ""                      // source=prompt
  },
  "script": { "path": "scripts/deploy.ps1" },  // type=script，相对 cwd 或绝对路径
  "schedule": {
    "mode": "interval",               // interval | daily
    "interval": { "every": 30, "unit": "minute" },  // second | minute | hour | day
    "daily": { "at": "09:30", "weekdays": [1, 2, 3, 4, 5] }  // 空数组=每天；1=周一…7=周日
  },
  "createdAt": 0,
  "updatedAt": 0
}
```

运行记录：

- 输出全文：`dataHome()/scheduler/logs/<taskId>/<runId>.log`（追加写）。
- 元数据：`dataHome()/scheduler/runs.json`（顶层数组，上限 500 条，超过淘汰最旧并删除其日志文件）。

```jsonc
{
  "id": "r_...", "taskId": "t_...",
  "status": "running",               // running | success | failed | timeout | killed
  "trigger": "schedule",             // schedule | manual
  "startedAt": 0, "finishedAt": null, "exitCode": null, "durationMs": null,
  "logFile": "t_ab12cd34/r_....log",  // 相对 scheduler/logs
  "error": null
}
```

`nextRunAt` 仅存内存（不持久化），启动时按当前时间重算。

## 调度语义

- 引擎 `setInterval(tick, 1000)` 并用 `.unref()` 避免阻塞进程退出；每 tick 找出 `enabled && nextRunAt <= now` 的任务触发。
- `interval`：任务保存/启用时 `next = now + interval`；每次运行**结束后** `next = now + interval`（避免重叠漂移）。
- `daily`：在选中星期几里取下一个 `HH:MM`；今天该时刻已过则顺延到下一个选中日；`weekdays` 为空表示每天。
- 服务器重启：**不补跑**已错过的触发；启动时按当前时间重算 `nextRunAt`。
- 重叠：任务正在运行时，本次触发**跳过**并重排下一次（不排队、不并发同一任务）。
- 禁用：`enabled=false` 不参与调度、不产生 `nextRunAt`。
- 时间使用服务器本地时区。

## 执行器（无头子进程 + 日志）

`runner.run(task, { cwd, trigger })` 返回 run 记录，并回调 `onStart` / `onEnd`。

- cwd 解析：`task.cwd` || 项目 `root` || `dataHome()`；目录不存在则 run 直接失败（`error`）。
- `shell`：Windows → `powershell.exe -NoProfile -NonInteractive -Command <command>`；其他平台 → `/bin/sh -c <command>`。
- `script`：解析为绝对路径（相对 cwd）；按扩展名——
  - `.ps1` → `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <abs>`
  - `.bat` / `.cmd` → `cmd.exe /c <abs>`
  - `.sh` → `bash <abs>`
  - 其他扩展名 → 拒绝（run 失败，`error: unsupported script type`）。
- `ai`：`<bin> run "<prompt>"`，`bin` 默认 `opencode`；`prompt` = `source=command` 时读取所选 command 文件正文，`source=prompt` 时取手写文本。
  - 命令文件目录：`DEVFLOW_OPENCODE_CONFIG/command`，默认 `~/.config/opencode/command`。
- 输出：stdout + stderr 追加写入日志文件；内存保留 tail（上限如 64KB）供 UI 轮询。
- 超时：shell/script 默认 10 分钟，ai 默认 30 分钟（`DEVFLOW_SCHED_TIMEOUT_MS` 统一覆盖，`0` 表示不限）。超时记为 `timeout` 并 kill 子进程树。
- 手动停止：`POST tasks/:id/stop` kill 子进程树，记为 `killed`。
- 并发：全局运行中上限默认 3（`DEVFLOW_SCHED_MAX_CONCURRENT`）；到上限时本次触发跳过并重排。
- Windows kill：`taskkill /PID <pid> /T /F` best-effort。

## 接口

### HTTP（`/api/scheduler/*`，在通用 `/api/` 兜底之前挂载）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/scheduler/tasks` | 返回 `{ tasks, serverTime }`（tasks 含派生字段 `nextRunAt`、`lastRun`） |
| POST | `/api/scheduler/tasks` | 创建，body 为任务定义，返回 `{ task }` |
| PUT | `/api/scheduler/tasks/:id` | 更新，返回 `{ task }` |
| DELETE | `/api/scheduler/tasks/:id` | 删除，连带删除其运行记录与日志 |
| POST | `/api/scheduler/tasks/:id/run` | 立即运行（trigger=manual），返回 `{ run }` |
| POST | `/api/scheduler/tasks/:id/stop` | 停止该任务当前运行，返回 `{ ok }` |
| GET | `/api/scheduler/runs?taskId=&limit=` | 运行元数据列表 |
| GET | `/api/scheduler/runs/:runId/log` | 输出全文（`text/plain`） |
| GET | `/api/scheduler/ai-commands` | 返回 `[{ name, path, preview }]`（扫描 opencode command 目录） |

- 校验：`name` 非空；`type` 合法；对应类型字段齐备；`schedule` 合法（间隔 > 0、`daily.at` 匹配 `HH:MM`、weekdays ∈ 1..7）。非法 → `400 { error }`。
- 错误码沿用现有风格：`not-found` → 404，其余校验失败 → 400。

### WS S2C（`shared/scheduler.js`）

```js
export const SchedulerS2C = Object.freeze({
  SCHED_TASKS_CHANGED: 'sched-tasks-changed',  // 任务增删改/启用切换
  SCHED_RUN_START: 'sched-run-start',          // payload: { run }
  SCHED_RUN_END: 'sched-run-end',             // payload: { run }
});
```

- `server/index.js` 用与 collab 相同的方式 `broadcastCollab` 式的 `broadcastSched(type, payload)` 遍历 `gateway.conns` 发送。
- 运行中日志正文不走 WS，前端在运行中每 2s 轮询一次 `/runs/:runId/log`（v1 不做逐块流式）。

## 前端

### `web/src/scheduler/useScheduler.ts`

- REST 客户端封装（`fetch`，失败抛出后端 `error`）。
- 响应式 state：`tasks`、`currentRuns[taskId]`、`selectedRunLog`、`loading`、`error`、`aiCommands`。
- 订阅：`terminal.on(SchedulerS2C.SCHED_TASKS_CHANGED)` 时重新拉 tasks；`SCHED_RUN_START/END` 时更新对应任务状态并按需刷新日志。
- 导出操作：`refresh`、`create`、`update`、`remove`、`runNow`、`stop`、`loadRuns`、`loadLog`、`loadAiCommands`。

### `web/src/scheduler/format.ts`

纯函数，vitest 覆盖：`scheduleSummary(schedule)`（如「每 30 分钟」「工作日 09:30」「每天 09:30」）、`formatTime(ts)`、`runStatusLabel(status)`。

### `web/src/scheduler/SchedulerView.vue`

- 顶部：标题、`刷新`、`新建任务`。
- 任务列表：名称、类型徽标（命令/AI/脚本）、调度摘要、上次运行（状态点 + 时间）、下次运行时间、启用开关（即时 `PUT`），行内操作：`立即运行` / `停止`（运行中）/ `编辑` / `删除` / `历史`。
- 编辑器：弹层表单——名称、项目下拉（来自 `/api/projects`）+ 目录覆盖、类型切换（shell / ai / script）、类型专属字段（shell 命令文本；ai 的「列表选择 / 手写」切换 + command 下拉 + prompt 文本；script 路径输入 + 从项目文件树选择复用 `/api/tree`）、调度模式切换（间隔：数字 + 单位下拉；每日：`HH:MM` + 星期多选）。
- 历史：运行列表（时间、触发方式、状态、时长、退出码）+ 选中运行输出 `<pre>`（等宽），运行中每 2s 自动刷新。
- 样式：scoped CSS，复用现有变量（`--bg1/--bd/--ac/--tx*`），与 `GitStat.vue` 风格一致。
- 空态：无任务时提示「暂无定时任务，点右上角新建」。

### 入口 `web/src/App.vue`

- `rail` 联合类型加 `'scheduler'`；activity rail 加 `⏰` 按钮（title「定时任务」）。
- `rail === 'scheduler'` 时主区域渲染 `<SchedulerView :terminal="terminal" />`（全宽，参照 `stat` / `contacts` 分支）。

## 配置（环境变量，不改 `settings.json`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DEVFLOW_SCHEDULER` | 启用 | 设为 `0`/`off` 可禁用调度引擎（仅保留管理接口） |
| `DEVFLOW_OPENCODE_BIN` | `opencode` | AI 命令执行的可执行文件 |
| `DEVFLOW_OPENCODE_CONFIG` | `~/.config/opencode` | command 目录扫描根 |
| `DEVFLOW_SCHED_TIMEOUT_MS` | 未设则 shell/script 600000、ai 1800000 | 设置后统一覆盖所有类型（0=不限） |
| `DEVFLOW_SCHED_MAX_CONCURRENT` | `3` | 全局并发上限 |

## 测试

- 后端（`node --test`）：
  - `scheduler-store`：CRUD、原子写、重载、校验、runs 上限淘汰与日志删除。
  - `scheduler-schedule`：`nextRunAt` 间隔/每日/星期/已过时刻顺延/禁用返回 null/错过跳过。
  - `scheduler-runner`：注入 fake spawn，断言 shell / script / ai 的参数构造、超时、kill、日志落盘、非法扩展名、cwd 解析（临时目录）。
  - `scheduler-engine`：注入 fake clock + fake runner，断言到期触发、禁用跳过、重叠跳过、并发上限、事件回调。
  - `scheduler-http`：各端点成功与 400/404（复用 `server/test/helpers/test-server.js` 或 fake req/res）。
  - `scheduler-const`：`SchedulerS2C` 冻结且键值唯一（参照 `collab-const.test.js`）。
- 前端（vitest）：`format.test.ts`（摘要/时间/状态）、`useScheduler.test.ts`（mock fetch + 事件订阅）。
- 全绿门禁：`npm.cmd test`、`npm.cmd run typecheck`。

## 边界与安全

- 调度引擎仅服务端运行，浏览器关闭不影响；不在前端做计时。
- 子进程一律 `spawn(bin, args[])` 数组传参，不经过 shell 拼接（shell 类型内部用参数数组传给 powershell）。
- `ai.source=command` 读取的文件限定在 opencode command 目录内，`assertSafeRel` 防路径穿越（参照 `collab/engine.js`）。
- script 路径相对 cwd 解析后允许越出项目（用户显式选择的覆盖目录场景），但不做 shell 注入。
- 超时/停止必 kill 子进程树，避免僵尸进程与端口占用。
- 服务器重启不补跑、运行中不重叠，避免雪崩式重放。
- 运行输出可截断（日志文件不设硬上限，但 UI 读取 tail 上限如 256KB，避免大日志卡死浏览器）。
- 任务/runs 持久化在用户数据目录，多实例（`DEVFLOW_NODE`）下按现有 `data-home` 布局自然隔离。

## 范围外（YAGNI）

- 不做完整 cron 表达式（仅「间隔 + 每日时刻」）。
- 不做逐块流式输出（运行中轮询日志即可）。
- 不做浏览器/系统通知与失败告警（仅页签内状态与历史）。
- 不做任务依赖、串并联编排、重试策略。
- 不做任务间共享环境变量、密钥管理。
- 不补跑服务器停机期间错过的触发。
- 不新建可见终端会话（执行与 `session-manager` 完全隔离）。
