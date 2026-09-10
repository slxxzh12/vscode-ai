# 设计文档：统一 XML 配置（config/devflow.xml）

日期：2026-09-10
分支：master
状态：待评审

## 1. 概述

把当前散落在代码与多个配置文件的配置统一到**单个 XML 文件** `config/devflow.xml`，作为唯一默认配置源，涵盖：

- 服务端：监听 `port`、`language`
- Agent：默认 agent + 列表（id/name/cmd）
- 工作流：阶段与提示语（原 `config/workflow.xml`）

服务端解析该文件并通过 API 下发给前端；设置面板/语言切换**就地改写** `<server>` 属性写回。前端不再写死 Agent 列表，端口不再写死默认值。

### 已与用户确认的约束

- 配置统一为 XML（风格对齐现有 `config/workflow.xml`）。
- **全部合并到一个 XML**：`config/devflow.xml`。
- **唯一 XML，服务端就地改属性**：端口/语言等可写设置直接改写 `<server .../>`，设置面板与语言切换仍可用。
- 不写死到代码：Agent 列表、端口默认值来自配置。

## 2. 配置文件格式

`config/devflow.xml`（入库，随仓库提供默认）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- DevFlow 统一配置：server（端口/语言）+ agents（默认 Agent 列表）+ workflows（工作流/提示语） -->
<devflow>
  <server port="3001" language="zh-CN" />

  <agents default="opencode">
    <agent id="opencode" name="OpenCode" cmd="opencode" />
    <agent id="claudecode" name="ClaudeCode" cmd="claudecode" />
    <agent id="nga" name="nga" cmd="nga.cmd" />
  </agents>

  <workflows>
    <!-- 现有 config/workflow.xml 的 <workflow>/<stage>/<prompt> 内容整体迁入 -->
  </workflows>
</devflow>
```

- `config/workflow.xml`：内容迁入后删除。
- `config/server.json`：废弃（不再读写；运行时文件可从工作区删除，不入库）。
- 环境变量 `DEVFLOW_PORT` 仍优先于 XML 的 `port`；`DEVFLOW_HOST` 不变。

## 3. 服务端

### 3.1 新模块 `server/devflow-config.js`

纯逻辑 + 文件读写，可单测：

- `defaultConfigFile(baseDir)` → `<baseDir>/config/devflow.xml`。
- `parseDevflowConfig(xml)` → `{ server: { port, language }, agents: { default, list: [{id,name,cmd}] }, workflows: [...] }`：
  - `<server>` 属性解析（`port` 转数字，非法/缺失 → 默认；`language` 交给 `normalizeLocale`）。
  - `<agents default>` + `<agent>` 列表；缺失/非法 → 内置默认（`buildDefaultConfig()`）。
  - `<workflows>` 复用 `server/workflow-xml.js` 的 `parseWorkflowXml`。
- `loadDevflowConfig(file)` → 读文件解析；不存在/损坏 → 返回内置默认（并可由调用方决定是否落盘）。
- `ensureConfigFile(file)` → 文件不存在时写入内置默认 XML（`serializeDevflowConfig(default)`）。
- `serializeDevflowConfig(cfg)` → 生成 XML 文本（用于首次落盘/测试）。
- `updateServerAttrs(file, patch)` → 读取文本，用正则替换 `<server ... />` 的 `port`/`language` 属性，**就地保留其余内容与注释**；若文件不存在则先 `ensureConfigFile`；若没有 `<server>` 标签则插入一行。

内置默认（`buildDefaultConfig()`）：`{ port: 3001, language: 'zh-CN' }` + 默认 3 个 agent（opencode/claudecode/nga）+ `fallbackWorkflows()`。这些是「配置缺失时的兜底」，不是业务逻辑里写死的界面来源。

### 3.2 服务端配置入口

`server/devflow-config.js` 是**唯一配置入口**。`server/workflow-xml.js` 退化为解析工具，只保留：

- `parseWorkflowXml(xml)`：从任意 XML 文本中提取 `<workflow>/<stage>/<prompt>`（对 `<workflows>` 或 `<devflow>` 内含的块均可）。
- `fallbackWorkflows()`：内置兜底工作流（配置缺失时用）。

`defaultWorkflowFile` / `loadWorkflowXml` 不再被 `server/index.js` 使用；为兼容现有 `workflow-xml.test.js`，将其改为：`defaultWorkflowFile(baseDir)` → `<baseDir>/config/devflow.xml`，`loadWorkflowXml(file)` → 解析该文件里的 `<workflows>`（缺失时回退 `fallbackWorkflows()`）。测试相应改为指向 `config/devflow.xml`。

### 3.3 `server/index.js`

- 启动：`const cfgFile = defaultConfigFile(root)` → `ensureConfigFile(cfgFile)` → `loadDevflowConfig(cfgFile)` → `setLocale(cfg.server.language)`；端口 `PORT = Number(process.env.DEVFLOW_PORT || cfg.server.port)`（移除 `|| 3001` 写死，兜底在 devflow-config 内）。
- `GET /api/settings` → `{ settings: { port, language }, envPort, currentPort }`（来自 XML）。
- `POST /api/settings`（改 port）→ 校验 1–65535 → `updateServerAttrs(cfgFile, { port })` → 返回 `{ settings, needRestart: true }`。
- `POST /api/settings/language` → 校验属于 `LOCALES` → `updateServerAttrs(cfgFile, { language })` + 内存 `setLocale` → 返回 `{ language }`。
- `GET /api/agents` → `{ default, agents }`（来自 XML）。
- `GET /api/workflows-xml` → `{ workflows }`（来自 XML 的 `<workflows>`）。
- 移除对 `server/settings.js` 的依赖（该模块退役）。

### 3.4 端口其它写死处

- `server/collaboration/http-mount.js` 邀请链接默认 origin：改为使用当前配置端口（`http://127.0.0.1:<port>`）。
- `server/collaboration/identity.js` 的 `port=3001` 仅作为函数缺省参数（运行时由 `setAdvertised` 刷新），保留但不再作为「业务默认端口」来源。

## 4. Web

- 新增 API 客户端（`useSettings` 或直接 `fetch`）：
  - `GET /api/agents` → TerminalView 在 `onMounted` 加载；成功则 `agents.value = list`、`agentId.value = default`（若本地无用户配置）。
  - 失败 → 回退到最简内置兜底（单一 `opencode`），不再在代码里维护完整业务列表。
- 「恢复默认」（`resetCfg`）：重新从 `/api/agents` 拉取列表与默认 id（即 XML 内容）。
- 设置面板「启动端口」：读写仍走 `/api/settings`（后端已改 XML）。
- `vite.config.ts`：dev 代理 `/api`、`/ws` 的 target 从 `config/devflow.xml` 读取 `port`（Vite 配置在 Node 环境运行，可用轻量解析），不再写死 3001。

## 5. 打包

- `scripts/build.js`：新增复制 `config/` 到绿色包（当前**未复制**，导致包内无配置）；产物校验增加 `config/devflow.xml` 存在项。
- `start.bat`：用 `runtime\node.exe` 读取 XML 的端口生成打开地址（避免写死 3001）；`使用说明.txt` 同步说明改 `config/devflow.xml` 的 `port`。

## 6. 迁移与测试

- 迁移：`config/workflow.xml` 内容并入 `config/devflow.xml` 后删除；删除 `config/server.json`（运行时）。
- 单测：
  - `server/test/devflow-config.test.js`：`parseDevflowConfig`（server/agents/workflows）、`serializeDevflowConfig` 往返、`updateServerAttrs` 就地改属性且保留注释、缺失文件生成默认。
  - 更新 `server/test/i18n-settings.test.js` → 走 `updateServerAttrs`/`loadDevflowConfig`（读取 port/language、非法 language 回落）。
  - 更新 `server/test/workflow-xml.test.js` → 指向 `config/devflow.xml`。
  - 新增 `/api/agents` 测试（http-api 或 devflow-config 层）。
- 前端：TerminalView 加载 agents 的逻辑测试（可加 `useAgents` 单元测试，或沿用现有 vitest 风格）。
- `AGENTS.md` 增补：配置统一在 `config/devflow.xml`；改动后需重启后端（`--watch` 不监听 xml）。
- 验收：`npm.cmd test` + `npm.cmd run typecheck` + `npm.cmd run check:i18n` 全绿；`npm.cmd run build:portable` 产物含 `config/devflow.xml`。

## 7. 明确不做

- 不引入 XML 库（沿用现有极简正则解析风格）。
- 不做配置热重载（改配置需重启后端）。
- 不迁移为多文件/多环境配置。
- 用户级 Agent 覆盖仍存浏览器 localStorage（既有行为）；XML 提供默认值。

## 8. 决策记录

- 单 XML：用户明确要求「全部合并到一个 XML」。
- 就地改属性：避免 JSON/XML 双写；只在 `<server>` 标签上做正则替换，保留其余内容与注释。
- XML 入库：作为随仓库的默认配置；缺失时 `ensureConfigFile` 生成内置默认，保证绿色包/首次运行可用。
