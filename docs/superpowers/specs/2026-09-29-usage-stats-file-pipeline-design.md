# 用量采集文件化 + 趋势图 K/M 单位 — 设计

## 1. 背景与目标

现状问题：

1. 协作 → 用量趋势图的纵轴是原始整数，数值大不易读。
2. 用量采集（`nga stats` / `opencode stats`）由 `execFile` 执行且 `timeoutMs=20000`，**超时会被杀掉**；被杀时只拿到部分 stdout，还会把部分内容覆盖写进 `stats.txt`，导致数据丢失/错误。
3. 该命令有时执行很久；且它的输出**前面可能混有大量冗余/报错信息**，真正的统计在末尾。

目标：

- 趋势图纵轴与 tooltip 用 K/M 格式化。
- 采集改为「生产-消费」两段式：命令**后台跑、不超时、不杀**，输出原子落盘；下一次采集**读文件**上报。
- 解析只看文件**末尾**的有效指标块，忽略前面噪音。
- 服务启动后主动触发一次采集。
- 上报周期保持 4 小时。

## 2. 范围

改动文件：

- `web/src/collaboration/UsageTrendChart.vue` — K/M 格式化。
- `server/collaboration/agent-stats.js` — 末尾解析 + 文件快照读取 + 后台刷新。
- `server/usage-report.js` — `reportNow` 改为「读文件 → 上报 → 触发后台刷新」。
- 测试：`server/test/agent-stats.test.js`、`server/test/usage-report.test.js`（及受影响的 `usage-report-http.test.js`）。
- 趋势图格式化如有组件测试则补。

不改：`probeAgentStats`（手动「采集信息」弹窗）保持同步、带超时的诊断行为。

## 3. 行为设计

### A. 趋势图单位（前端）

- `UsageTrendChart.vue` 的 `yAxis.axisLabel.formatter` 与 `tooltip.formatter` 用 K/M 格式化，复用 `usagePeers.ts` 的 `fmtNum`（≥1e6 → `1.2M`，≥1e3 → `12.3K`，否则原值）。
- 指标下拉（消息/输出/输入/会话）保持不变；`usage.trend_top` 提示不变。

### B. 采集：生产-消费两段式（后端）

数据文件：`statsFile` = `<数据目录>/cache/collaboration/stats.txt`（现有 `paths.statsFile`）。

1. **读（消费）**：`reportNow()` 先同步读 `statsFile`，用末尾解析得到本次上报数据。
2. **跑（生产）**：随后触发一次**后台刷新**：
   - 执行 stats 命令（`parseStatsCmd` 模板，缺省回退 `<cmd> stats --days N`）。
   - stdout+stderr 写入临时文件 `stats.txt.tmp`（`stdio: ['ignore', fd, fd]`）。
   - 子进程 `close` 后：若 tmp 非空则原子重命名覆盖 `stats.txt`；若为空则删除 tmp、保留旧文件。
   - **不设超时、不杀进程**；`spawn`（非 detached）+ `windowsHide`，`.cmd/.bat` 仍经 `wrapCmdBin` 走 cmd.exe。
   - **并发保护**：同一 `statsFile` 已有刷新在跑时，跳过本次触发。
3. **启动主动执行一次**：服务启动调用 `reportNow()`（读文件 + 触发刷新），满足「启动后主动执行一次」。
4. **周期**：保持 4 小时（`INTERVAL_MS`，读+触发都在这个点）；粘贴/保存 master 链接时也触发一次（沿用现状）。
5. **首次无文件**：本次无可上报数据 → 跳过 `submit`，但仍触发刷新；等后台跑完下次再报。

### C. 解析「只要后面的信息」

- `parseStats(text)` 改为对每个指标取**最后一次出现**的值（从后往前），忽略前面的冗余/报错。
- 现状是一次匹配（`String.match`）取首个；改为全局匹配后取最后一个。

### D. 手动「采集信息」（probe）不变

- `probeAgentStats` 保持同步、单次、带超时的诊断行为；它仍会写同一个 `stats.txt`（与后台刷新存在低概率竞争，接受）。

### E. Claude 系（claudecode/codeagent）

- 这类不走 CLI，直接本机日志解析（`collectClaudeStats`）：`reportNow` 对其仍走**同步**采集，不套用文件管道（本地扫描快且无「长命令」问题）。

## 4. 模块边界与数据流

```
usage-reporter.reportNow()
  ├─ 若 claude 系 → collectAgentStats() 同步得到 usage
  └─ 否则
       ├─ readStatsFile(statsFile) → { exists, raw, mtimeMs, parsed }
       ├─ snapshot → usage
       ├─ refreshStatsOutput({...statsFile, lock})   // 后台，不 await
       └─ exists ? submit(usage) : skip
```

`agent-stats.js` 新增导出：

- `readStatsFile(statsFile)` → `{ exists, raw, mtimeMs, parsed }`（文件不存在 → `exists:false`）。
- `refreshStatsOutput({ cmd, statsCmd, days, env, cwd, resolveCwd, startDir, home, statsFile, spawnFn = spawn, lock })` → `{ started, reason }`；`statsFile` 为空时 `{ started:false, reason:'no-file' }`。
- `parseStats` 更新为末尾解析（签名不变）。

保留：`collectAgentStats`、`probeAgentStats`、`collectClaudeStats`、`parseStatsCmd`、`resolveAgentBin` 等签名与现有测试兼容。

## 5. 边界与错误处理

- **命令失败/输出为空**：tmp 为空则**不覆盖** `stats.txt`，删 tmp，保留上次好数据；本次上报仍用旧文件内容。
- **并发**：`lock`（Set<statsFile>）在刷新期间持有，`close`/`error` 后释放；重复触发直接跳过。
- **后端重启**：未完成的那次刷新作废（下次 reportNow 重新触发）。
- **无 statsFile**（测试/未配置）：`refreshStatsOutput` 直接 no-op，不 spawn。
- **原子性**：读方永远看到完整的 `stats.txt`（tmp→rename）。

## 6. 测试

- `agent-stats.test.js`：
  - `parseStats`：末尾块解析（前面混入报错/旧值，取最后一次；SAMPLE 原用例仍通过）。
  - `readStatsFile`：存在/不存在、mtime、parsed。
  - `refreshStatsOutput`：注入 fake `spawnFn`，断言 stdout/stderr 指到 `.tmp`、`close` 后 tmp→stats 原子改名、空输出不覆盖、并发第二次返回 `started:false`、无 statsFile 时 no-op。
  - 保留现有 `collectAgentStats` / `probeAgentStats` 用例。
- `usage-report.test.js`：`reportNow` 读 `statsFile` → 上报该数据；无文件时跳过 submit；触发一次 refresh（注入 spy）；claude 系仍同步采集。
- 趋势图：K/M 格式化（如可组件测试；否则随实现说明）。

## 7. 验收

- notepad 无关；在协作页用量趋势：纵轴与 tooltip 显示 `12.3K` / `1.2M`。
- 删除 `stats.txt` 后重启后端：启动触发一次后台命令，命令结束后 `stats.txt` 出现完整输出；下一次（或手动触发）上报使用该文件。
- 命令输出前部带报错/冗余时，解析仍取末尾正确指标。
- 命令很久不结束也不会被杀。
- `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 通过。
