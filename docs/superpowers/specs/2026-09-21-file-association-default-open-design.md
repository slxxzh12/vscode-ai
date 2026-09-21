# 设计文档：把 .md/.yaml 等文件的「默认打开方式」设为 Void

日期：2026-09-21
分支：master
状态：已评审（已与用户确认：混合方案、全量扩展名、首次在设置面板询问且默认勾选、每次启动自查纠正）
前序：[2026-09-12 文件关联「用 Void 打开」](2026-09-12-file-association-open-in-app-design.md)

## 1. 概述

绿色包（Windows）启动后，把以下扩展名的**默认打开方式**设为 Void：

```
.md .markdown .yaml .yml .js .mjs .cjs .json .http .rest .curl
```

首次运行在**设置面板**里询问（复选框默认勾选）；用户确认后写入注册表；之后**每次启动自查**，若不是 Void 就改回。

与 2026-09-12 那版的区别：旧版只登记「打开方式」（`OpenWithProgids`），不抢默认；本版要真正成为**默认程序**（占 `UserChoice` 的位）。同时把首启询问从 `launch.ps1` 的 WScript 弹窗迁到网页设置面板。

## 2. 约束（已确认）

- **仅 Windows + 绿色包**：`process.platform === 'win32'` 且 `<appDir>\start.bat` 存在且未设 `DEVFLOW_PORT`（复用 `restartGuard` 的判定）。dev 环境不出现该设置项。
- **仅 HKCU，免管理员**。
- **扩展名全量**（含 `.js/.json`，会抢走代码文件的默认，用户明确）。
- **首次弹窗**：在网页设置面板里，复选框默认勾选；之后不再弹。
- **每次启动自查纠正**：用户后来把默认改回别的程序，下次启动会被改回 Void。
- **不恢复被覆盖的旧默认程序**（无法可靠获知）。

## 3. 现状与扩展点

- 关联登记现在只在 `scripts/launcher.js` 生成的 `launch.ps1` 里（首启 WScript 弹窗 + 写 `OpenWithProgids`），只登记不抢默认。
- 绿色包判定：`server/port-restart.js` 的 `restartGuard({ appDir })`（无 `DEVFLOW_PORT` 且存在 `start.bat`）。
- 设置面板在 `web/src/components/TerminalView.vue`（`#setmodal`），首启由 `App.vue` 的 `openAgentSettings(firstRun)` → 自定义事件 `df-open-agent-settings` 触发（agent 首启已有同样机制）。
- 服务端已有多处用 PowerShell 子进程干系统活（`server/native-dialog.js`、`server/reveal.js`、`server/port-restart.js`）。
- 服务端全局配置接口在 `server/index.js`（`/api/settings`、`/api/agents` 等）。
- 应用目录 `APP_DIR`、数据目录 `data/`（`data/port.txt`、`data/runtime-port.txt`）。

## 4. 总体方案（混合）

- **注册表逻辑只写一份**，放在 `launch.ps1`：新增子命令 `-Assoc apply|remove`，执行完立即 `exit 0`。
- **服务端**负责：可用性判定、偏好读写、状态查询、把首启询问喂给前端、在勾选/取消时调用 `launch.ps1 -Assoc` 即时生效、启动时兜底纠正。
- **`launch.ps1` 正常启动**时读偏好文件，`enabled` 则静默 `apply`（覆盖「服务端直接起 node、没走 launch.ps1」的兜底之外的主路径）。
- **偏好文件** `<appDir>\data\file-assoc.json`：`{ "enabled": bool, "prompted": bool }`。

```
启动 start.bat
  └─ launch.ps1（正常启动）
       ├─ ...（端口/服务/快捷方式，逻辑不变）
       └─ 读 data\file-assoc.json：enabled → 静默写注册表（默认 = Void）

网页设置面板「文件关联」勾选/取消
  └─ POST /api/file-assoc { enabled }
       ├─ 写 data\file-assoc.json（首次写入同时 prompted=true）
       └─ 调 launch.ps1 -Assoc apply|remove（即时生效）

首启（data\file-assoc.json 不存在）
  └─ GET /api/file-assoc → { prompted:false }
       └─ App.vue 自动打开设置面板，「文件关联」复选框默认勾选
```

## 5. 注册表细节（HKCU，用户级）

ProgID：

```
HKCU\Software\Classes\Void
  (Default)                = "Void"
  DefaultIcon\(Default)    = "<appDir>\script\icon.ico"
  shell\open\command\(Default) = "\"<appDir>\start.bat\" \"%1\""
```

每个扩展名 E：

```
HKCU\Software\Classes\.E\(Default)             = "Void"        # 默认程序
HKCU\Software\Classes\.E\OpenWithProgids\Void  = REG_NONE 空值  # 出现在「打开方式」
删除 HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.E\UserChoice
```

说明：

- `UserChoice` 存在时会盖过 `.E\(Default)`，所以必须删；本机实测该键所有者拥有 FullControl、无 DENY ACE，可删。
- 只删 `UserChoice`、不动 `FileExts\.E\OpenWithList`。

`-Assoc remove`（取消勾选时）：

- 删除各 `OpenWithProgids\Void`；
- 若 `.E\(Default) == "Void"` 则清空该值（保持类型）；
- 不尝试恢复旧默认。

## 6. 组件与职责

### 6.1 `scripts/launcher.js`（生成 `launch.ps1`）

- `param(...)` 增加 `[string]$Assoc = ''`。
- 在 `-Plan` 分支之后、端口逻辑之前插入早期分支：
  `if ($Assoc) { <按 apply/remove 写/删注册表>; exit 0 }`。
- 正常启动流程末尾：读 `Join-Path $root 'data\file-assoc.json'`，`ConvertFrom-Json` 后 `enabled` 为真则静默 apply（try/catch 包裹，失败不影响启动）。
- **删除**原有 WScript 首启弹窗 + `OpenWithProgids` 注册块（迁到 `-Assoc`）。

### 6.2 `server/file-assoc.js`（新增，单一功能模块）

- `EXTENSIONS`：上述 11 个扩展名常量。
- `available({ appDir, platform, envPort, exists })`：复用 `restartGuard` 语义，返回 `{ ok, launcherPath }`。
- `loadPref(appDir)` / `savePref(appDir, pref)`：读写 `data\file-assoc.json`（不存在返回 `{ enabled:false, prompted:false }`）。
- `runAssoc(appDir, action, { spawnFn })`：调用 `powershell -NoProfile -ExecutionPolicy Bypass -File <appDir>\script\launch.ps1 -Assoc <action>`，注入 `spawnFn` 便于测试。
- `getState({ reg })`：读注册表，返回每个扩展 `{ ext, isDefault }`（`reg` 注入便于测试）。

### 6.3 `server/index.js`

- `GET /api/file-assoc` → `{ available, enabled, prompted, extensions: [{ ext, isDefault }] }`。
- `POST /api/file-assoc` body `{ enabled }`：
  - 不可用 → 409；
  - 写偏好（首次写 `prompted=true`）；
  - `runAssoc(appDir, enabled ? 'apply' : 'remove')`；
  - 返回最新 `{ enabled, prompted, extensions }`。
- 服务端启动时：若 `available` 且偏好 `enabled` → 后台 `runAssoc('apply')` 兜底一次（失败只记日志）。

### 6.4 前端

- `web/src/components/TerminalView.vue`：`onOpenSettings` 时拉 `/api/file-assoc`；`general` 页签新增「文件关联」区（仅 `available` 显示）：
  - 复选框绑定 `assocEnabled`（偏好文件不存在即首启时默认 `true`；否则反映已存的 `enabled`）；
  - 每个扩展显示当前是否已是 Void（`isDefault`）；
  - 跟随右下角「确定」一起保存（`confirmSettings` 里若勾选态变化则 `POST /api/file-assoc`）。
- `web/src/App.vue`：`onMounted` 拉一次 `/api/file-assoc`；若 `available && !prompted` → 复用 `openAgentSettings(true)` 打开设置面板（与 agent 首启合并，只打开一次；agent 首启高亮与文件关联可同框）。
- `web/src/` 数据层：新增 `useFileAssoc.ts`（`get()` / `set(enabled)`），供组件调用。

### 6.5 i18n

`shared/i18n/zh-CN.js` + `en.js` 同步新增（键集合对称）：文件关联区块标题、复选框说明、状态提示、保存失败等。

## 7. 测试与验收

- 单测：
  - `server/test/file-assoc.test.js`：`loadPref` 缺省、`savePref` 往返、`available` 绿色包判定、`runAssoc` 命令拼装（fake spawn）、`getState` 解析（fake reg）。
  - `server/test/launcher.test.js`：更新为断言含 `-Assoc` 分支与读取 `file-assoc.json`，且**不再**生成 WScript 首启注册块。
- 全量：`npm test`、`typecheck`、`check:i18n`、`build:web` 全绿。
- 人工验收（打包后）：
  1. 首启 → 设置面板自动打开，「文件关联」默认勾选 → 确定。
  2. 各扩展名文件双击均用 Void 打开（先确认 `.md` 的 `UserChoice` 已从 VS Code 变为无/ Void）。
  3. 手动把 `.md` 默认改回 VS Code → 重启 → 自动改回 Void。
  4. 取消勾选 → 再双击文件不再用 Void（撤回 `OpenWithProgids` 与 `(Default)=Void`）。

## 8. 明确不做（YAGNI）

- 不做 macOS / Linux 关联。
- 不恢复「被覆盖的旧默认程序」。
- 不做「每次启动都弹窗」（只首启弹一次）。
- 不做绿色包移动后的自动重注册（沿用现状：登记的是当时绝对路径）。
- 不做 shell 扩展 / 右键菜单 / 缩略图。

## 9. 安全与风险

- `launch.ps1` 以 `-ExecutionPolicy Bypass` 被服务端调用，参数只有 `apply|remove`，不接受外部路径。
- 删 `UserChoice` 后，Windows 可能在某些情况下重建该键或再次弹「选择应用」；属系统行为，接受。
- 强制 `.js/.json` 默认可能影响依赖 shell 打开的程序（用户已确认全量）。
- 偏好文件放应用目录：同机多份绿色包各管一份，后启动者生效；不做多实例协调。

## 10. 决策记录

- 「默认」= 删 `UserChoice` + `.E\(Default)=Void`：用户明确要真正默认，而非仅「打开方式」。
- 扩展名全量：用户明确。
- 首启在设置面板询问、默认勾选：用户明确。
- 每次启动自查纠正：用户明确。
- 混合实现（注册表逻辑只在 `launch.ps1`，服务端出接口/状态/UI）：用户明确。
- 仅绿色包、仅 Windows：用户明确。
