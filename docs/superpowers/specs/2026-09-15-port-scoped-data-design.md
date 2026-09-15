# 设计文档：数据按端口隔离 + 端口外置到 `<应用目录>/data`

日期：2026-09-15
分支：master
状态：待评审

## 1. 概述

当前「数据档案（profile）」机制把**监听端口**和**数据目录名**解耦：`<dataHome>/ports-state.json` 的 `byListenPort` 把端口映射到档案 id，档案 id 默认取首次创建时的端口。结果是同一台机器上 `22222`、`33333`、`44444` 三个端口全部映射到同一个档案 `22222`，**完全共享**项目、工作流、调度任务、协作身份、上传/下载等全部数据；同时端口本身写在 `<dataHome>/downloads/devflow.xml` 的 `<server port>` 属性里，而该配置又是全局共享的。

本设计把两者的关系改成一元化：

1. **端口**只存本地、只存一处：`<应用目录>/data/port.txt`；
2. **数据**全部落在数据目录下、按端口隔离：`<dataHome>/ports/<端口>/`；
3. **一个端口一个档案**，不再有多档案、选择界面与端口→档案映射；
4. 不做自动迁移（用户手动搬）。

## 2. 已与用户确认的约束

| # | 约束 | 来源 |
| --- | --- | --- |
| 1 | 数据目录为 `%USERPROFILE%\.local\share\void`（注意是 `void`，现为 `devflow`） | 用户回答 1 |
| 2 | 所有数据都在 `...\void\ports\<端口>\` 下 | 用户回答 2 |
| 3 | 只有「端口」保存在当前目录的 `data\` 下 | 用户回答 3 |
| 4 | 端口从 `devflow.xml` 里搬出来 | 用户回答 |
| 5 | 一个端口一个档案，不考虑一端口多档案 | 用户回答 |
| 6 | 不做自动迁移，用户手动搬迁 | 用户选 3 |

自行判断（风险低，已在设计中固化）：

- 「当前目录」取**服务端代码所在目录的上一级**（`server/index.js` 的 `__dirname/..`），即绿色包根 / 仓库根，与启动时的工作目录无关。
- 保留 `DEVFLOW_PORT` 环境变量作为**最高优先级**覆盖，使 `dev:server`（33333）与绿色包各自使用独立数据、不会争抢同一份 `data/port.txt`。
- 保留 `DEVFLOW_HOST`、`DEVFLOW_DATA_HOME`、`DEVFLOW_NODE`。

## 3. 目录与路径

### 3.1 常量

| 名称 | 值 |
| --- | --- |
| `APP_DIR` | `path.join(__dirname, '..')`（`server/` 的上一级） |
| `PORT_FILE` | `<APP_DIR>/data/port.txt` |
| `RUNTIME_PORT_FILE` | `<APP_DIR>/data/runtime-port.txt` |
| `dataHome()` | `%USERPROFILE%\.local\share\void`（`DEVFLOW_DATA_HOME` 可覆盖） |
| `dataRoot` | `<dataHome>/ports/<port>` |

端口非法或缺失时：`PORT = 22222`（`DEFAULT_PORT`）。

### 3.2 端口数据目录

`dataRoot` 内含（沿用现有字段形状，减少改动面）：

| 项 | 路径 |
| --- | --- |
| 项目列表 | `projects.json` |
| 工作流 | `workflows.json` |
| 定时任务 | `scheduler/`（`tasks.json`、`runs.json`、`logs/`、`opencode-data/`） |
| 协作 | `collab/`（`identity.json`、`collab.json`、`inbox/`） |
| 发出的文件/技能 | `upload/` |
| 收到的文件 | `download/` |
| 活动配置 + 中转插件 | `downloads/devflow.xml`、`downloads/relay-plugins/`、`downloads/relay-tests/` |
| 输入历史 | `message-history.jsonc` |
| 协作技能 | `skills-opencode/` |
| 用量库 | `usage.db` |
| LLM 密钥库 | `llm.vault.json` |

> 与旧 `profilePaths()` 的字段一一对应，仅把「档案 id」换成「端口号」。目录名 `downloads/`（放配置）沿用不改，避免无谓的迁移与冲突。

### 3.3 不再存在的路径

- `<dataHome>/ports-state.json`（端口→档案映射）
- `<dataHome>/downloads/`（全局活动配置与插件目录）
- `<dataHome>/collab/`、`<dataHome>/upload/`、`<dataHome>/download/`（`data-home.js` 里仅有定义、**零调用**的 `collabDir()`/`uploadDir()`/`downloadDir()`）
- `<dataHome>/projects.json`、`<dataHome>/workflows.json`（仅由死代码 `resolveFiles()` 产出，见 5.3）
- `<APP_DIR>/config/runtime-port.txt`（迁到 `<APP_DIR>/data/runtime-port.txt`）

## 4. 端口来源与写入

### 4.1 读取优先级

```
PORT = validPort(process.env.DEVFLOW_PORT)
    ?? readPortFile()          // <APP_DIR>/data/port.txt
    ?? DEFAULT_PORT            // 22222
```

- `readPortFile()`：读取 `<PORT_FILE>`，`trim()` 后要求匹配 `^\d+$` 且值在 1–65535，否则视为无效。
- 文件不存在 / 无效：不抛错，回退默认端口，并 `log.warn` 明确提示（含文件路径）。

### 4.2 写入时机

| 场景 | 行为 |
| --- | --- |
| 设置面板修改端口 | 原子写 `<PORT_FILE>`（`port.txt.tmp` → rename），返回结果附「需重启后端生效」 |
| 端口冲突弹窗选「更换端口」 | 同上，写 `<PORT_FILE>`，不再改 `devflow.xml` |
| 服务实际监听成功 | 写 `<RUNTIME_PORT_FILE>`（供 `launch.ps1` 打开浏览器用） |

写入失败（应用目录只读，如装在 `Program Files`）时：明确报错，不静默；读取侧仍按 4.1 回退。

## 5. 服务端改造

### 5.1 新增 `server/port-paths.js`

```
portPaths(port, { root = dataHome() }) -> { id, port, dir, projectsFile, workflowsFile,
  schedulerDir, collabDir, identityFile, storeFile, uploadDir, downloadDir,
  downloadsDir, relayPluginsDir, historyFile, skillsRoot }
```

- 只做纯路径推导，无 IO、无状态，便于单测。
- 取代 `server/workspace.js` 中 `profilePaths()` 的角色。

### 5.2 删除

| 位置 | 内容 |
| --- | --- |
| `server/workspace.js` | 档案机制全套：`PROFILE_ID_RE`、`profilesRoot`、`stateFile`、`readState`、`writeState`、`readProfile`、`listProfiles`、`createProfile`、`bindProfile`、`touchProfile`、`migrateLegacy`、`resolveProfile`、`createWorkspaceService`、`profilePaths` |
| `server/workspace-http.js` | 整文件删除（`/api/workspace/state|select|create`） |
| `server/index.js` | `workspaceHttp` 变量、`url.pathname.startsWith('/api/workspace')` 分支、「等待选择」分支（`resolveProfile` 非 `ready` 时挂 `createWorkspaceHttp`）、`createProfile`/`bindProfile`/`touchProfile`/`migrateLegacy` 调用 |
| `web/src/components/WorkspacePicker.vue` | 整文件删除 |
| `web/src/useWorkspace.ts` | 整文件删除 |
| `shared/i18n/{zh-CN,en}.js` | `ws.pick.*`（9 条）与 `ws.default_profile_name`、`ws.migrated_profile_name`，共 11 条；已确认仅 `WorkspacePicker.vue` 与 `workspace.js` 引用 |

> 本设计取代 `docs/superpowers/plans/2026-09-11-port-profiles.md` 所描述的档案方案。

### 5.3 改造

**`server/data-home.js`**
- `dataHome()`：目录名 `devflow` → `void`。
- `downloadsDir()`、`relayPluginsDir()`：由「全局目录」改为「按端口」，签名改为 `downloadsDir(port)` / `relayPluginsDir(port)`，内部走 `portPaths(port)`。
- 删除**零调用**的 `collabDir()`、`uploadDir()`、`downloadDir()`。
- 删除 `ensureDataHome()`、`seedFromLegacy()`（唯一调用方是下面要删的 `resolveFiles()`）。
- 保留 `dataHome()`、`downloadsDir(port)`、`relayPluginsDir(port)`、`instanceName()`、`instanceSeedDir()`、`instanceFpRoot()`。

**`server/config.js`**
- 删除 `resolveFiles()`（全仓库零引用的死代码：它把 `projects.json`/`workflows.json` 写到 `dataHome()` 根，并调用 `ensureDataHome()`/`seedFromLegacy()`）。
- `ensureDefaults(file, file)`、`loadProjects(file)`、`loadWorkflows(file)` 保持不变（已按文件路径工作，天然与端口无关）。

**`server/devflow-config.js` 的活动配置定位**
- `resolveActiveConfigFile(baseDir)` → `resolveActiveConfigFile(baseDir, port)`，内部用 `downloadsDir(port)`，即活动配置落在 `<dataHome>/ports/<port>/downloads/devflow.xml`。

**`server/index.js` 启动顺序**
- 现在 `resolveActiveConfigFile()`（第 52 行）早于 `PORT` 计算（第 55 行）；改为：先定 `PORT`（4.1），再 `resolveActiveConfigFile(path.join(__dirname, '..'), PORT)` 得到配置文件，最后 `loadDevflowConfig()`。

**`server/index.js` 启动收尾**
- 删除 `migrateLegacy(dataHome())` 与 `resolveProfile()` 分支，直接：
  ```
  const paths = portPaths(PORT);
  fs.mkdirSync(paths.dir, { recursive: true });
  initWorkspace(paths, actual);
  ```
- `initWorkspace` 内不再有「等待选择」分支；`workspaceHttp`、`createWorkspaceHttp` 引用一并移除。
- `buildWorkspace` 内 `seedPlugins(relayPluginsDir(), ...)`、`createLlmMount({ pluginsDir: relayPluginsDir() })` 改用 `paths` 上的端口路径（`paths.downloadsDir` / `paths.relayPluginsDir`），不再调用全局函数。
- `NODE` 模式分支保留，但把仍指向 `dataHome()` 根的 `projectsFile` / `workflowsFile` / `schedulerDir` 一并收进 `instanceFpRoot()` 下（消除残留共享）。

**`server/llm-mount.js`**
- 第 11、248 行的 `downloadsDir()` → 改为由参数传入（`createLlmMount({ ..., relayTestsDir })`），不再依赖全局函数。

**仓库遗留文件（可选清理，删前先 `git grep` 确认零引用）**
- `server/projects.json`、`server/workflows.json`：仅为死代码 `resolveFiles()` 的 seed 源，随 `resolveFiles()` 一起删除。

**`server/devflow-config.js`**
- `parseDevflowConfig()`：忽略 `<server>` 的 `port` 属性，返回的 `server` 只含 `{ language, host }`。
- `updateServerAttrs(file, { language?, host? })`：不再处理 `port`；写回的 `<server>` 标签只含 `language`、`host`。
- `serializeDevflowConfig()`：`<server>` 标签同理。
- 端口不再来自 XML；`DEFAULT_PORT` 常量保留（作为端口文件缺失时的默认值）。

## 6. 前端改造

- `web/src/App.vue`：删除 `WorkspacePicker` 导入、`useWorkspace` 导入与 `wsState`、模板第 554 行的 `<WorkspacePicker>`（服务端不再有「需要选择档案」状态）。
- 设置面板端口保存：**前端无需改动**。`web/src/components/TerminalView.vue:147-156` 已经调用 `POST /api/settings`，失败走 `term.save_failed`，成功文案 `term.port_saved` 本就是「已保存，重启后生效」。
- 其余数据无需变更：项目/工作流/调度接口的 URL 不变，只是服务端换了数据根。

**改造现有接口（`server/index.js`，不新增端点）**

| 接口 | 改造 |
| --- | --- |
| `GET /api/settings` | 返回 `{ settings: { language, host, port }, envPort, currentPort, host }`，其中 `port` 取自运行时 `PORT`（不再取自 XML）；前端 `r.settings.port` 因此照常可用 |
| `POST /api/settings { port }` | 校验 1–65535（非法 → 400 `{ error: 'invalid port' }`）；原子写 `<APP_DIR>/data/port.txt`；成功 → `{ port, needRestart: true }`；写入失败 → 500 `{ error: 'port-save-failed', message }`（`message` 走 `t()`） |
| 端口冲突弹窗（`server/index.js:617`） | 选「更换端口」时改调同一个写端口函数，不再 `updateServerAttrs(configFile, { port })` |

## 7. i18n

- 只做删除：`ws.pick.*`（9 条）与 `ws.default_profile_name`、`ws.migrated_profile_name`，共 11 条（见 5.2）。
- **无新增词条**：设置面板的成功/失败提示复用现有 `term.port_saved`（'已保存，重启后生效' / 'Saved. Takes effect after restart'）与 `term.save_failed`、`term.port_invalid`。
- 中英必须同时删，跑 `npm.cmd run check:i18n`。

## 8. 打包脚本

`scripts/build.js`：
- `launch.ps1` 里读的端口文件路径 `config\runtime-port.txt` → `data\runtime-port.txt`（两处：`$portFile` 拼接与文件排除过滤）。
- 产物内不再有 `config/runtime-port.txt`；`data/` 目录按需由服务端创建，**不预置** `data/port.txt`（缺失即默认 22222）。
- `使用说明.txt` 补充：端口文件位置、换端口=换一份数据的说明。

`scripts/build-mac.js`：同步 `runtime-port.txt` 的位置。

## 9. 文档同步

- `AGENTS.md`：「配置（统一 XML）」一节改为「端口在 `<应用目录>/data/port.txt`，XML 只放 language/host/agents/workflows」；「目录速览」补充端口数据目录；说明数据目录名为 `void`。
- `AGENTS.md` 中 `%USERPROFILE%\.local\share\devflow` 的路径示例改为 `void`。
- 新增 `README`/使用说明条目：手动搬迁步骤（把 `%USERPROFILE%\.local\share\devflow\ports\22222\` 内容复制到 `%USERPROFILE%\.local\share\void\ports\<新端口>\`）。

## 10. 测试与验收

**单测**

| 文件 | 动作 |
| --- | --- |
| `server/test/workspace-http.test.js` | 删除 |
| `server/test/workspace.test.js` | 改为 `port-paths.test.js`：目录推导、`ports/<port>` 各字段、非法端口兜底 |
| `server/test/port-file.test.js` | 新增：`port.txt` 缺失/非数字/越界 → 回退默认；合法值读取；原子写（含只读目标的失败路径） |
| `server/test/data-home.test.js` | 更新：`dataHome()` 以 `void` 结尾；`downloadsDir(port)`/`relayPluginsDir(port)` 落在 `ports/<port>/downloads` |
| `server/test/devflow-config.test.js` | 更新：解析/序列化不再含 `port` 属性 |
| `server/test/i18n-settings.test.js` | 更新：`updateServerAttrs` 只处理 `language`/`host` |
| `server/test/server-port.test.js` | 新增：`POST /api/settings {port}` 成功写文件、非法值 400、只读目标 500（含可读 `message`）；`GET /api/settings` 的 `settings.port` 等于运行时 PORT |

**人工验收**

1. `npm.cmd run dev:server`（`DEVFLOW_PORT=33333`）+ `dev:web` → 数据落在 `...\void\ports\33333\`；
2. 不带该环境变量启动 → 读 `data/port.txt`；文件不存在时用 22222 并 warn；
3. 设置面板改端口 → `data/port.txt` 内容更新，重启后监听新端口、数据目录变为 `ports\<新端口>`（空目录）；
4. 同时跑 33333 与 22222 → 两套数据互不可见；
5. `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 全绿；
6. `npm.cmd run build:web` + `node scripts/build.js` → 包内无 `config/runtime-port.txt`，双击 `start.bat` 能读到 `data\runtime-port.txt` 打开浏览器。

## 11. 明确不做

- 不做自动迁移（旧 `devflow` 目录不读、不搬、不删）。
- 不改 `downloads/`、`upload/`、`download/` 等子目录名。
- 不做一端口多档案，不保留任何选择界面。
- 不改协作协议、不改调度/项目/工作流的接口形状（只换数据根）。
- 不改 `DEVFLOW_NODE` 的用途（仅收敛其残留共享路径）。
- 不做端口占用时的自动换端口（沿用现有弹窗行为，只改写入目标）。

## 12. 决策记录

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 端口文件位置基准 | `server/__dirname/..`（应用目录） | 与启动 cwd 无关，绿色包/仓库都稳定 |
| 端口文件格式 | `data/port.txt`，单行纯数字 | 用户要求「只存端口」；易读易手改 |
| `DEVFLOW_PORT` 优先级 | 保留为最高 | dev 33333 与绿色包互不干扰 |
| XML 的 `port` 属性 | 删除（读与写都不再涉及） | 否则「找配置文件要先知道端口」形成循环 |
| 数据根内部布局 | 沿用现有字段与目录名 | 减少改动面与并行冲突 |
| 旧数据 | 不自动迁移 | 用户选 3；风险最低、行为可预期 |
| `ws.*` 词条 | 全删 | 已确认仅档案机制引用 |
