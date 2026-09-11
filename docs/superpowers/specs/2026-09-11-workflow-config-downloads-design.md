# 设计文档：活动配置迁到 `<dataHome>/downloads/devflow.xml`

日期：2026-09-11
分支：master
状态：待评审

## 1. 概述

当前唯一配置文件是仓库内的 `config/devflow.xml`（`server/index.js:40` 的 `configFile`）。本设计把**运行时活动配置**迁到用户数据目录：

- 首次启动：把仓库模板 `config/devflow.xml` 生成一份副本到 `<dataHome>/downloads/devflow.xml`。
- 之后：`<dataHome>/downloads/devflow.xml` 成为**整份配置的唯一权威源**（工作流 + agents + 端口/语言/host）。
- 若该副本已存在（无论内容），**不再覆盖**（不重复“解压”）。
- 仓库 `config/devflow.xml` 退化为**首次 seed 模板**，入库、只作种子。

这样运行时配置不再落仓库工作区，用户编辑可持久保留。

## 2. 已确认约束

- 目标目录：`<dataHome>/downloads/`（`data-home.js` 的 `dataHome()`）。
- 副本形式：完整 `devflow.xml`（整份配置，含 `<server>`/`<agents>`/`<workflows>`）。
- 来源：`config/devflow.xml`。
- 权威性：`downloads/devflow.xml` 为权威；所有配置读写（含编辑器、设置面板、语言切换）都指向它。
- 幂等：`downloads/devflow.xml` 已存在则跳过 seed。
- 失败策略：`<dataHome>/downloads` 无法创建/不可写 → 抛错，进程启动失败（不做 CWD / 仓库 config 兜底）。

## 3. 启动配置解析

新增纯函数 `resolveActiveConfigFile(baseDir)`（放 `server/devflow-config.js`），`baseDir` 为仓库根（`server/` 的上一级）：

```
downloadsDir = path.join(dataHome(), 'downloads')
activeConfig = path.join(downloadsDir, 'devflow.xml')
if (!fs.existsSync(activeConfig)):
    fs.mkdirSync(downloadsDir, { recursive: true })     # 失败 → 抛出，启动失败
    template = path.join(baseDir, 'config', 'devflow.xml')
    if (fs.existsSync(template)):
        fs.copyFileSync(template, activeConfig)
    else:
        fs.writeFileSync(activeConfig, serializeDevflowConfig(buildDefaultConfig()), 'utf8')
return activeConfig
```

`server/index.js` 改动：

- `const configFile = resolveActiveConfigFile(path.join(__dirname, '..'));`（替换原 `defaultConfigFile` + `ensureConfigFile`，`ensureConfigFile` 由该函数内部承担）。
- 其后 `loadDevflowConfig(configFile)` / `setLocale` / `HOST` / `PORT` / `fs.watch(configFile)` 全部沿用，自动跟随新路径。
- `defaultConfigFile(baseDir)` 保留（`resolveActiveConfigFile` 用它做模板路径），语义不变。

`downloadsDir` 路径可由 `data-home.js` 新增 `downloadsDir()` 辅助（与现有 `downloadDir()` 并列；注意既有 `downloadDir()` 单数指协作收件目录，二者不冲突）。

## 4. 权威源与读写点

`configFile` 是唯一入口，所有既有读写点**不改逻辑**，自动跟随：

- `GET /api/config/xml`、`POST /api/config/xml`（整份 XML 编辑器）。
- `GET /api/settings`、`POST /api/settings`（端口）、`POST /api/settings/language`（语言）。
- `GET /api/agents`。
- `GET /api/workflows-xml`、`POST /api/workflows`（工作流编辑器）。
- `fs.watch(configFile)` 配置热重载（改 downloads/devflow.xml 即时重载语言并广播 `CONFIG_CHANGED`）。

即：编辑器与设置面板的读写目标从仓库 config 变为 `<dataHome>/downloads/devflow.xml`。

## 5. 边界与错误处理

- `downloads/devflow.xml` 已存在：跳过 seed，直接 `loadDevflowConfig`；用户编辑持久保留。
- 首次运行且仓库模板存在：原样复制（保留注释与格式），已有用户的仓库 config 改动会带过去。
- 仓库模板缺失：写入内置默认（`serializeDevflowConfig(buildDefaultConfig())`），保证首次可用。
- `<dataHome>/downloads` 创建失败：`mkdirSync` 抛错向上传播，进程启动失败（日志由 `uncaughtException` 兜底打印）。
- 环境变量 `DEVFLOW_PORT` 仍优先于 XML 的 `port`；`DEVFLOW_HOST` 不变。

## 6. 改动文件

- `server/data-home.js`：新增 `downloadsDir()`。
- `server/devflow-config.js`：新增 `resolveActiveConfigFile(baseDir)`；`defaultConfigFile` 保留。
- `server/index.js`：`configFile` 改用 `resolveActiveConfigFile`；移除多余的顶层 `ensureConfigFile(configFile)` 调用（若解析函数已保证）。
- `server/test/devflow-config.test.js`：新增用例。
- `AGENTS.md`：更新「改 `config/devflow.xml` 后需重启」为「活动配置在 `<dataHome>/downloads/devflow.xml`；改它后需重启后端」。

## 7. 测试与验收

新增 `server/test/devflow-config.test.js` 用例（用临时 `DEVFLOW_DATA_HOME` 隔离）：

1. 首次解析：模板存在 → 复制到 `downloads/devflow.xml`，内容与模板一致，返回值等于该路径。
2. 幂等：`downloads/devflow.xml` 已存在（改过内容）→ 再次解析不覆盖，内容不变。
3. 模板缺失：写内置默认 XML，能 `loadDevflowConfig` 解析出默认 workflows/agents/server。
4. 不可写：`downloadsDir` 为文件（制造 `mkdir` 失败）→ 抛错。

验收命令：

- `node --test "server/test/devflow-config.test.js"`
- `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 全绿。

## 8. 明确不做（YAGNI）

- 不做 CWD / 仓库 config 回退；不双写同步。
- 不动遗留 `workflows.json` / `WorkflowRunner`（WS `WF_LIST`/`WF_RUN` 路径）。
- 不迁 `config/runtime-port.txt`（启动端口提示仍写仓库 `config/`）。
- 不引入 XML 库；不做多环境/多文件配置。
- 不删除仓库 `config/devflow.xml`（保留为 seed 模板）。
