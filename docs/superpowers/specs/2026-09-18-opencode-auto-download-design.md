# 设计文档：选择 opencode 为默认 agent 时自动下载 opencode.exe

日期：2026-09-18
分支：master
状态：待实现

## 1. 需求

用户原文：

> 在用用户选择默认的 agent 的时候，如果是 opencode 时候，则默认从刚才上传地址下载对应 opencode 到对应目录

澄清后：用户选择的默认 agent 为 opencode 时，自动从 Gitee Release 下载 opencode 压缩包，解出 `opencode.exe` 放到**与绿色包打包位置相同的目录**。

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 落盘目录 | `<应用目录>/opencode/opencode.exe`（`APP_DIR/opencode`，与 `build-opencode.js` 打包位置、`resolveAgentBin` 查找位置一致） |
| 2 | 触发条件 | 每次把默认 agent 选为 opencode 都检查；目标文件**不存在才下载**，已存在则跳过 |
| 3 | 下载地址 | 按平台配置；Windows x64 → `https://gitee.com/wglj/devflow/releases/download/v20260918/opencode-windows-x64.zip` |
| 4 | 地址配置位置 | `devflow.xml` 新增 `<opencode>` 配置节，服务端每次实时读取 |
| 5 | 非 Windows x64 平台 | 该平台无配置地址 → 不下载，前端提示「该平台暂无 opencode 下载包」，默认 agent 照常设置 |
| 6 | 下载执行 | 服务端异步下载，前端轮询状态接口显示 下载中/完成/失败+重试 |
| 7 | 解压 | 新增 Node zip 依赖 `yauzl`，纯 JS 流式解压（不依赖 PowerShell） |
| 8 | 落盘校验 | 不做 `opencode.exe --version` 冒烟；但仍走临时文件 + rename，避免半截文件让「已存在」判断误跳过 |
| 9 | 设置与下载关系 | 先立即写默认 agent（选择即时生效），下载在后台进行；失败可重试 |

## 3. 现状（改动前）

- 默认 agent 选择：前端 `setDefaultAgent()`（`web/src/components/TerminalView.vue:960`）→ `POST /api/agents/default`（`server/index.js:522`）→ `setDefaultAgent()`（`server/devflow-config.js:172`）改写 `<agents default=… chosen="1">`。
- agent 可执行文件解析（`server/collaboration/agent-stats.js:33` `resolveAgentBin`）：`DEVFLOW_OPENCODE` → PATH → `<appRoot>/opencode/` → `<appRoot>/env/`；`APP_ROOT = server/..`。
- PATH 注入：`ensureAgentOnPath()`（`agent-stats.js:48`）在启动时调用一次（`server/index.js:342`），把命中目录插到 `process.env.PATH` 最前。
- 打包：`scripts/build-opencode.js:135` 把 `opencode.exe` 放到 `<包根>/opencode/opencode.exe`，并改写 `launch.ps1` 预置 PATH（`:143,165`）。
- 配置读写：`server/devflow-config.js` 的 `parseDevflowConfig` / `serializeDevflowConfig` / `ensureConfigFile`；活动文件 `<数据目录>/ports/<端口>/downloads/devflow.xml`，模板 `config/devflow.xml`。
- 首次运行引导：`chosen=false` 时前端弹出设置面板让用户选默认 agent（`App.vue:502`）。

## 4. 配置（`devflow.xml`）

新增 `<opencode>` 节，属性名 `url-<platform>-<arch>`：

```xml
<opencode url-win32-x64="https://gitee.com/wglj/devflow/releases/download/v20260918/opencode-windows-x64.zip" />
```

- 平台键 = `process.platform + '-' + process.arch`，Windows 64 位即 `win32-x64`。
- `parseDevflowConfig` 解析为 `opencode: { urls: { 'win32-x64': '…' } }`；**标签缺失或该平台无属性时回退内置默认**（默认即上面的地址），因此既有实例不改文件也生效。
- `serializeDevflowConfig` 输出 `<opencode … />`（仅当有 url 时）。
- `config/devflow.xml` 模板同步加这一行（仅作新实例 seed，不改既有实例）。

## 5. 服务端模块

### 5.1 `server/opencode-download.js`（新）

```js
export const DEFAULT_OPENCODE_URLS = {
  'win32-x64': 'https://gitee.com/wglj/devflow/releases/download/v20260918/opencode-windows-x64.zip',
};

export function createOpencodeDownloader({
  appDir,                 // APP_DIR
  platform = `${process.platform}-${process.arch}`,
  urls,                   // () => Record<platform, url>
  fetchFn = fetch,
  fsImpl = fs,
  unzipEntry,             // (zipPath, entryName, outPath) => Promise<void>，默认 yauzl 实现
  onDone,                 // 成功落盘后的回调（用于 ensureAgentOnPath）
  logger = console,
})
// 返回 { start(), status() }
```

行为：

- `status()` → `{ state, platform, url, downloaded, total, message }`，`state ∈ 'idle' | 'downloading' | 'done' | 'error' | 'unavailable'`。
- `start()`：
  1. 目标 `<appDir>/opencode/opencode.exe` 已存在 → 置 `done`，直接返回（跳过下载）。
  2. `urls()[platform]` 为空 → 置 `unavailable`，返回。
  3. 否则置 `downloading`，异步：
     - `fetchFn(url)`，校验 `res.ok`；`total` 取 `content-length`（可能为 0）。
     - 流式写 zip 到临时文件（`<appDir>/opencode/.opencode-download-<pid>.zip`），累计 `downloaded`。
     - `unzipEntry(zipPath, 'opencode.exe', '<appDir>/opencode/opencode.exe.tmp')`。
     - `rename` 临时 exe → 最终 `opencode.exe`；删除临时 zip。
     - 置 `done`，调用 `onDone()`；失败置 `error` 并记录 `message`，清理临时文件。
  4. 已有任务在跑时，`start()` 不重复启动，返回当前状态。
  5. 失败后再次 `start()` 允许重试。

依赖：`server/package.json` 增加 `yauzl`；绿色包打包按 `createRequire('server/package.json')` 真实解析自动带上（含其依赖 `buffer-crc32`），无需改打包脚本。

### 5.2 `server/opencode-mount.js`（新）

- `GET /api/opencode/status` → `downloader.status()`。
- `POST /api/opencode/download` → `downloader.start()`，返回状态。
- 沿用现有 HTTP 面鉴权（与 `/api/agents/default` 同级，不额外收紧）。

### 5.3 触发接入（`server/index.js`）

- `POST /api/agents/default` 成功写盘后：若 `body.id === 'opencode'` → `downloader.start()`，响应体追加 `download: { state }`；否则照旧。
- 启动时构造 `downloader`，`onDone` 里调用 `ensureAgentOnPath(defaultAgent().cmd)` 让本进程 PATH 立即命中（下载本就在 `APP_DIR/opencode`，不影响采集侧动态解析）。

## 6. 前端

- `web/src/components/TerminalView.vue` 设置面板 Agent 列表：
  - `setDefaultAgent(id)` POST 后，若响应 `download.state === 'downloading'` → 轮询 `GET /api/opencode/status`（约 1s），直到 `done`/`error`；显示 `opencode 下载中…（NN%）`（`total>0` 时）/ `opencode 已就绪` / `下载失败 [重试]`。
  - 打开设置面板时拉取一次状态：已 `done` 显示「已就绪」，`error` 显示失败+重试。
  - 「重试」调用 `POST /api/opencode/download` 后继续轮询。
  - `unavailable` 显示「该平台暂无 opencode 下载包」。
  - 组件卸载/面板关闭时清除轮询。
- 轮询与状态类型抽到 `web/src/opencodeDownload.ts`（`fetchOpencodeStatus()` / `startOpencodeDownload()` / 类型定义）。
- i18n 词条（`shared/i18n/zh-CN.js` + `en.js` 同时补）：
  - `term.opencode.downloading`、`term.opencode.done`、`term.opencode.failed`、`term.opencode.retry`、`term.opencode.unavailable`。

## 7. 错误与边界

- 网络失败 / 非 2xx / 解压失败：置 `error`，保留 `message`，清理临时文件；目标文件不被写入。
- 临时文件与目标文件同名冲突：用 `.tmp` 后缀，rename 覆盖。
- 并发点击：单任务去重；`start()` 幂等。
- 其他平台无 URL：`unavailable`，不阻塞默认 agent 设置。
- 下载产物 `<应用目录>/opencode/` 加入 `.gitignore`（不入库）。

## 8. 测试

- `server/test/opencode-download.test.js`（注入 fake `fetchFn`/`fsImpl`/`unzipEntry`/临时 `appDir`）：
  - 目标已存在 → `done` 且不发起 fetch（跳过）。
  - 无平台 URL → `unavailable`。
  - 成功路径 → 写出目标文件、`state='done'`、`onDone` 被调用、临时文件清理。
  - fetch 失败 / 解压失败 → `error`、目标文件不存在、临时文件清理。
  - 并发 `start()` → 只发起一次 fetch。
- `server/test/devflow-config.test.js` 补：解析 `<opencode>` 多平台属性、缺省回退默认、serialize 往返。
- 前端：`web/src/components/HistoryList.test.ts` 无关；如抽 `opencodeDownload.ts` 则加单测（状态映射/百分比计算）。

## 9. 非目标

- 不做 opencode 版本升级/自动更新（已存在即跳过）。
- 不做断点续传、镜像加速、完整性校验/签名。
- 不调整 `build-opencode.js` 的打包流程（仅复用其目录约定）。
- 不新增平台地址（用户后续在 `devflow.xml` 自行加）。
