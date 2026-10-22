# 定时任务运行报告设计

日期：2026-10-22
状态：待复核

## 背景

定时任务（`server/scheduler/`）目前已经把每次运行写入 `runs.json`，把原始输出写入 `logs/<taskId>/<runId>.log`，前端通过「历史」弹窗查看运行列表和日志。存在的问题：

- 报告就是原始日志，包含终端控制字符、命令执行过程，不是可读的 Markdown 报告。
- 运行记录只按任务弹窗查看，没有「汇总页」和全局成功/失败总数。
- 失败运行可能没有输出（例如启动失败、超时），无法形成可查看的报告。
- 运行记录有 500 条全局上限，历史会被裁剪。

目标：

- 每次运行都生成一份 Markdown 报告并持久化，成功或失败都必须有报告。
- 在定时任务页顶部展示全局「总成功 / 总失败 / 运行中」数量。
- 点任务进入详情页，查看该任务全部历史报告，支持 Markdown 渲染与原始文本切换。

## 非目标

- 不改变调度算法、任务类型和执行器类型。
- 不做跨机器/协作报告同步。
- 不做报告导出、分享、定时清理策略的可视化配置。

## 术语

- **运行报告**：任务按约定路径写入的 Markdown 文件，是用户最终看到的结果。
- **运行上下文**：每次运行由系统生成的一份 JSON，包含本次运行的报告路径、日志路径等信息，通过环境变量传给任务。

## 文件布局

```
<数据目录>/scheduler/
  runs.json
  logs/<taskId>/<runId>.log
  reports/<taskId>/<runId>/
    run.json          # 运行上下文（系统生成）
    report.md         # 运行报告（任务写入；缺失时系统兜底）
    ...               # 任务自己写入的附件
```

`<数据目录>` 指 `server/data-home.js` 解析出的端口数据目录，不在代码或文档中写死绝对路径。

### run.json

系统在启动任务前写入，任务通过 `DEVFLOW_RUN_CONTEXT` 环境变量拿到它的绝对路径：

```json
{
  "runId": "r_xxxxxxxx",
  "taskId": "t_xxxxxxxx",
  "taskName": "自动扫描",
  "trigger": "schedule",
  "startedAt": 1792400000000,
  "reportPath": "<绝对路径>/reports/<taskId>/<runId>/report.md",
  "logPath": "<绝对路径>/logs/<taskId>/<runId>.log",
  "outputDir": "<绝对路径>/reports/<taskId>/<runId>"
}
```

约定：

- 任务必须读取 `DEVFLOW_RUN_CONTEXT` 指向的 JSON，并把 Markdown 报告写到 `reportPath`。
- 附件可写到 `outputDir`。
- `reportPath`、`logPath`、`outputDir` 都由系统生成，任务不能指定到其他位置。
- 任务不写或写空时，系统自动生成兜底报告。

## 运行记录

`runs.json` 的每条记录在现有字段基础上增加：

- `reportFile`：报告相对路径，形如 `<taskId>/<runId>/report.md`。

其余字段（`id/taskId/status/trigger/startedAt/finishedAt/durationMs/exitCode/error/sessionId/logFile`）保持不变。

默认不再按 500 条裁剪，保留全部历史；仍可用环境变量 `DEVFLOW_SCHED_RUN_LIMIT` 设置全局上限，裁剪时同时删除对应的日志与报告目录。

## 运行流程

1. `engine.startRun` / `startWorkflowRun` 生成 `runId`，创建运行记录。
2. 系统创建 `reports/<taskId>/<runId>/`，写入 `run.json`，并把绝对路径作为 `DEVFLOW_RUN_CONTEXT` 注入任务环境。若 `run.json` 写入失败，该次运行直接标记为失败并生成兜底报告（不启动任务）。
3. 任务执行并写 `report.md`。
4. 运行结束（成功、失败、超时、被停止）时，系统检查 `reportPath`：
   - 存在且非空：保留。
   - 不存在、为空或只有空白：写入兜底报告。
   - 更新运行记录 `status/finishedAt/durationMs/exitCode/error/reportFile`。
5. 前端按运行记录拉取报告。

### 环境变量注入范围

- `shell`、`script`、`ai`：在 `server/scheduler/runner.js` 的 spawn 环境里注入。
- `workflow`：执行器创建 agent 会话时，把环境变量传给 PTY；需要 `SessionManager.create` 支持可选的 `env`，并透传到 `createPty`。

### AI / 工作流任务

AI 与工作流任务不会自动知道要写报告。任务提示词需要引用：

- PowerShell：`$env:DEVFLOW_RUN_CONTEXT`
- cmd/bash：`%DEVFLOW_RUN_CONTEXT%` / `$DEVFLOW_RUN_CONTEXT`

示例提示词片段：

```text
读取环境变量 DEVFLOW_RUN_CONTEXT 指向的 JSON，把最终 Markdown 报告写入其中的 reportPath。
```

未按要求写入时，系统生成兜底报告，不会让该次运行没有报告。

## 兜底报告

格式（Markdown）：

````md
# <taskName> · <成功/失败/超时/已停止>

- 运行：<runId>
- 触发：定时 / 手动
- 开始：<本地时间>
- 耗时：<durationMs> ms
- 退出码：<exitCode 或 —>
- 错误：<error 或 —>

## 日志末尾

```text
<去掉 ANSI 控制字符后的日志末尾，最多 100 行>
```
````

兜底报告写入 `reportPath`，保持「每次运行都有一个 report.md」。

## HTTP API

- `GET /api/scheduler/summary`
  - 返回全局统计：
    ```json
    { "total": 334, "success": 44, "failed": 289, "running": 1 }
    ```
  - `failed` = `failed + timeout + killed`；`running` 不计入成功/失败。
- `GET /api/scheduler/runs?taskId=<id>`
  - 保持现有行为；不传 `limit` 时返回该任务全部运行记录。
- `GET /api/scheduler/runs/<runId>/report`
  - 返回 `text/markdown; charset=utf-8`。
  - 报告不存在时按旧运行记录即时生成兜底报告返回（不落盘），保证历史记录可看。
  - 单次返回上限 2 MB，超出截断并在末尾追加截断提示。
- `GET /api/scheduler/runs/<runId>/log`
  - 保持现有原始日志接口，供详情页「原始日志」使用。

## 前端

### 定时任务汇总页（默认页）

- 顶部新增统计条：`总成功`、`总失败`、`运行中`。
- 下方保持现有任务列表；点击任务行进入详情页。
- 行内操作按钮阻止冒泡，避免误进详情。

### 任务详情页

- 顶部：返回按钮、任务名、类型、调度摘要、启用状态。
- 左侧：该任务全部历史运行列表，按时间倒序，每行显示时间、状态、触发方式、耗时；失败/超时/停止用红色状态点。
- 右侧：选中运行的 Markdown 报告，使用 `web/src/markdown.ts` 的 `renderMarkdown` 渲染；提供「报告 / 原始日志」切换。
- 有运行中的记录时每 2 秒刷新运行列表与报告。
- 报告为空时显示空状态文案。

### 兼容

- 旧的「历史」弹窗移除，由详情页替代。
- 旧运行记录没有 `reportFile` 时，报告接口即时兜底，前端无需迁移。

## 国际化

新增词条（中英同时补齐）：

- `sched.summary.success` / `sched.summary.failed` / `sched.summary.running`
- `sched.detail.back` / `sched.detail.report` / `sched.detail.raw_log`
- `sched.report.empty` / `sched.report.missing` / `sched.report.truncated`
- `sched.trigger.schedule` / `sched.trigger.manual`

## 安全

- 报告、运行上下文、日志都位于端口数据目录，不入库、不打包。
- 报告接口只按运行 ID 查记录再读系统生成的路径，不接受客户端传路径，避免路径穿越。
- 兜底报告中的日志需去掉 ANSI 控制字符。

## 测试

Server：

- `SchedulerStore`：`reportFileFor` / `reportPath`；删除任务同时删除报告目录；上限裁剪同时删除报告。
- `engine`：启动前生成 `run.json`；spawn/会话环境含 `DEVFLOW_RUN_CONTEXT`；成功报告保留；失败/超时/被停止时生成兜底报告；`reportFile` 写入运行记录。
- `runner`：shell/script 也注入环境变量；ai 保留原有 `AGENT_ENV` 合并。
- `SessionManager` / `pty-runner`：可选 `env` 透传。
- `http-mount`：`/summary` 统计正确；`/runs/:id/report` 返回 Markdown、旧记录兜底、404。

Web：

- `useScheduler`：`loadSummary`、`loadReport`。
- `SchedulerView`：汇总数字、点击任务进入详情、报告列表状态、Markdown/原始切换、空报告状态。
- i18n 键集合对称（现有 `check:i18n` / `i18n.test` 覆盖）。

## 兼容与发布

- 无需数据库迁移；`runs.json` 增量字段可选。
- 旧运行记录仍可查看报告（即时兜底）。
- 不改动绿色包打包内容；新增文件都在运行时数据目录。
