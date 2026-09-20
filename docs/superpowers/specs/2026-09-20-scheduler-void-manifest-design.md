# 设计：定时任务清单 `void_manifest.json`（导出/导入）

日期：2026-09-20

## 背景与目标

定时任务目前只存在于本机 `<端口数据目录>/scheduler/tasks.json`，无法跟随任务目录一起拷贝/共享到另一台机器。需要：

1. **导出**：每条任务在它自己的目录下生成一份固定名 `void_manifest.json`，记录该任务的定时、启动参数等定义；尽量用**相对路径**，不写绝对路径。
2. **导入**：定时任务页签顶部加「导入」按钮，指定一个目录后**递归扫描**所有 `void_manifest.json`，据此重建定时任务。

目标是把「任务目录」变成可携带的自描述单元：目录拷到别的机器，导入即可还原定时任务。

## 术语与约束

- 固定文件名 `void_manifest.json`（一个目录一份）。
- **一个目录只允许一个任务**；同一目录再建任务报错。
- 任务无 `cwd` 时，回退目录为 `<端口数据目录>/scheduler/manifests/<任务id>/`（该目录由调度器自建）。
- 任务显式设置的 `cwd` 若不存在：保存/导入该条报错，不自动创建。

## 数据模型：`void_manifest.json`

```jsonc
{
  "format": "void_manifest",
  "version": 1,
  "name": "每日构建",
  "type": "shell",                  // shell | ai | script
  "enabled": true,
  "schedule": {                     // 与任务的 schedule 对象同构，按 mode 取舍分支
    "mode": "interval",             // interval | daily
    "interval": { "every": 30, "unit": "minute" },   // interval 模式；second | minute | hour | day
    "daily": { "at": "09:30", "weekdays": [] }        // daily 模式；空数组=每天；1=周一…7=周日
  },
  "command": "npm run build",       // type=shell
  "ai": {                           // type=ai（按 source 取舍字段）
    "source": "command",            // command | prompt | file
    "commandName": "review",
    "prompt": ""
  },
  "script": { "path": "scripts/build.ps1" },   // type=script，相对路径
  "filePath": "commands/build.md",             // ai.source=file，相对路径
  "runtime": {                      // 运行态快照，导入时忽略
    "nextRunAt": 1726800000000,
    "lastRun": { "startedAt": 1726796700000, "status": "success", "exitCode": 0, "durationMs": 1234 }
  }
}
```

规则：

- **路径一律相对 manifest 所在目录**：写入时把任务里的绝对路径转相对，导入时再拼回绝对路径；manifest 内不出现绝对路径。
- **不记录 `cwd`**：manifest 所在目录即任务目录；导入时任务的 `cwd` = manifest 所在目录。
- **不记录 `id` / `projectId` / `createdAt` / `updatedAt`**（本机内部信息，不跨机可移植）。
- `runtime` 为只读展示信息（`nextRunAt` 由引擎重算、`lastRun` 本机无历史），**导入时忽略**。
- 解析时校验 `format === "void_manifest"`；`version` 不识别则报错并跳过该条。

## 服务端行为

### 自动同步

- `SchedulerStore.createTask` / `updateTask`：校验通过并写入 `tasks.json` 后，同步写/更新其目录下的 `void_manifest.json`。
- `deleteTask`：删任务、runs、日志的同时，删除该目录的 `void_manifest.json`。
- 启用/暂停（仅改 `enabled`）→ 同步更新 manifest。
- 修改 `cwd` → 删旧目录的 manifest、写新目录的；新目录不存在则**报错拒绝保存**（`cwd-missing`）。
- 同一目录已有其他任务 → **报错拒绝**（`dir-taken`），保证「一目录一任务」。
- 无 `cwd` 的回退目录由服务端自动创建（属调度器数据区，不视为「用户目录不存在」）。

> 说明：手动新建/编辑时同目录冲突一律拒绝（`dir-taken`）；「导入」是唯一的覆盖入口（见下），二者不矛盾。

### `runtime` 刷新

- 任务增删改/启停时写 manifest。
- **每次运行结束后**（引擎 `run-end`）再刷新一次 `runtime`，保证 `lastRun` / `nextRunAt` 实时。
- store 通过 `runtimeProvider` 回调取运行态：`{ nextRunAt: engine.nextRunAtOf(id), lastRun: 最近一次 run }`。

### 导入（扫描 + 覆盖）

- 入参 `{ dir }`（绝对路径）。
- 递归扫描该目录下的 `void_manifest.json`，跳过 `node_modules`、`.git`、`dist`、`dist-portable`、`.venv`、`venv`。
- 每条 manifest → 一个任务：`cwd` = manifest 所在目录，相对路径拼回绝对。
- **冲突覆盖**：若该目录已有任务，则用清单内容**覆盖**该任务（沿用其 `id`），不新增重复。
- 单条失败（格式非法、目录不存在、校验失败等）不影响其余；汇总返回。
- 导入完成后 `engine.refreshAll()` 并广播 `SCHED_TASKS_CHANGED`。

### 模块

新增纯模块 `server/scheduler/manifest.js`：

- `MANIFEST_NAME`
- `manifestDirOf(task, manifestRoot)`
- `toManifest(task, runtime)` / `fromManifest(obj, dir)`（校验 `format`/`version`，非法抛错）
- `writeManifest(dir, task, runtime)` / `removeManifest(dir)`
- `scanManifests(root, skipDirs)`
- 相对/绝对路径互转工具

`SchedulerStore` 与 `http-mount.js` 共用该模块。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/scheduler/pick-folder` | 弹系统文件夹选择框，返回 `{ path }` / `{ cancelled:true }` / `{ error }`（非 Windows 返回 `unsupported`） |
| POST | `/api/scheduler/import` | body `{ dir }`，扫描并导入，返回 `{ imported, overwritten, failed:[{ path, error }] }` |

- `pick-folder` 复用 `server/native-dialog.js` 的 `pickFolder()`。
- 错误码沿用现有风格：校验失败 → 400，未找到 → 404。

## 前端

`web/src/scheduler/SchedulerView.vue`：

- 顶栏「新建」旁加「导入」按钮：点击 → 弹文件夹选择框 → 拿到目录 → 调 `/api/scheduler/import` → `sched.refresh()`。
- 顶部展示导入汇总（`imported` / `overwritten` / `failed` 数量）；失败时列出前几条路径与原因。
- 非 Windows（原生框返回 `unsupported`）降级为手动输入目录的输入框。

`web/src/scheduler/useScheduler.ts`：新增 `pickFolder()`、`importManifests(dir)`。

新增文案全部走 i18n（`shared/i18n/zh-CN.js` + `en.js` 同步补齐）。

## 涉及文件

新增：

```
server/scheduler/manifest.js
server/test/scheduler-manifest.test.js
本设计文档
```

修改：

- `server/scheduler/store.js`：构造加 `manifestRoot`；`setRuntimeProvider(fn)`；create/update/delete/启停同步 manifest；`cwd-missing`、`dir-taken` 校验。
- `server/scheduler/index.js`：注入 `manifestRoot = <scheduler dir>/manifests`，接引擎 `run-end` / `tasks-changed` → store 刷新，组装 `runtimeProvider`。
- `server/scheduler/http-mount.js`：`pick-folder`、`import` 端点。
- `web/src/scheduler/SchedulerView.vue`、`web/src/scheduler/useScheduler.ts`。
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js`。

## 测试

- `server/test/scheduler-manifest.test.js`（纯函数）：路径互转、`toManifest` / `fromManifest` 往返、非法 `format`/`version` 抛错、扫描跳过目录。
- `scheduler-store.test.js`：create/update/delete 后文件存在/被删/内容正确；改 `cwd` 时旧文件删除、新文件写入；`cwd-missing`、`dir-taken`；run-end 后 `runtime.lastRun` 更新。
- `scheduler-http.test.js`：`import` 覆盖已存在任务、汇总计数、单条失败不中断。
- `web/src/scheduler/useScheduler.test.ts`：`importManifests` / `pickFolder`。
- 全绿门禁：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 边界与安全

- manifest 内一律相对路径，禁止绝对路径与敏感信息。
- 导入只读取选中目录树下的 `void_manifest.json`；跳过常见大目录，避免无谓遍历。
- 覆盖冲突时沿用原任务 `id`，仅替换定义内容，不残留旧任务。
- 单条失败可定位（返回 `path` + `error`），不静默吞错。
- 与现有定时任务运行/日志逻辑隔离，不改变 `tasks.json` 之外的运行语义。

## 范围外（YAGNI）

- 不做导出按钮（写入自动完成）。
- 不做 cron 表达式。
- 不做 manifest 的版本迁移链（仅校验 `version`）。
- 不做远端/网络导入导出（仅本机目录）。
- 不在 manifest 内记录运行历史全文（仅 `lastRun` 摘要）。
- 不做非 Windows 之外的跨平台保证（原生目录框仅 Windows）。
