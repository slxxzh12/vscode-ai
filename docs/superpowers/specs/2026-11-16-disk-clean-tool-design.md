# 系统盘清理工具（CCleaner 型）设计

- 日期：2026-11-16
- 范围：小工具新增「系统清理」，分四期落地；本文详细定义第 1 期
- 平台：仅 Windows（非 Windows 环境接口返回 501，前端显示「仅支持 Windows」）

## 1. 目标与非目标

### 目标

- 类似 CCleaner：先「分析」列出各分类可清理项与占用，用户勾选后「运行清理」，最后给出释放空间与失败明细。
- 分类分为「Windows 系统 / 应用程序 / 浏览器 / 自定义」四组。
- 默认勾选规则：`safe` 勾选，`caution` / `risky` 不勾选，`risky` 清理时逐项确认。
- 默认删除进回收站，可切换永久删除。
- 需要管理员权限的类目通过 UAC 一次性提权助手完成，支持取消。
- 支持排除列表（目录 + 文件名通配）与自定义清理目录。
- 留审计：每次清理写历史记录。

### 非目标（本文 / 第 1 期）

- 不做磁盘空间分析（目录占用、大文件 Top N）——第 2 期。
- 不做重复文件查找——第 2 期。
- 不做启动项管理、卸载程序管理——第 3 期。
- 不做注册表清理——第 4 期。
- 不做定时/开机自动清理。
- 不清理浏览器 Cookie、历史、密码、书签。

## 2. 分期路线

| 期 | 内容 |
|---|---|
| 1 | 垃圾清理核心（系统 / 应用 / 浏览器缓存）、排除列表、自定义目录、回收站与永久删除、UAC 提权助手、历史记录 |
| 2 | 磁盘空间分析（目录占用、大文件 Top N）、重复文件查找（大小 + 哈希分组） |
| 3 | 启动项管理（注册表 Run、启动文件夹、计划任务）、卸载程序管理（注册表 Uninstall 扫描） |
| 4 | 注册表清理（无效项扫描 + 备份 + 删除） |

第 2/3/4 期共用第 1 期的目录遍历、提权助手、任务轮询、历史记录基础设施。

## 3. 模块划分

后端 `server/disk-clean/`：

- `catalog.js`：类别表。每类定义 `id`、`group`（system/app/browser/custom）、`pathResolvers`（返回目标列表，每项为 `{ path, mode, needsAdmin?, patterns? }`）、`risk`（safe/caution/risky）、`minAgeDays`、`defaultChecked`。`mode` 取值：`contents` 清目录内容 / `entry` 删匹配条目 / `file` 删指定文件 / `recycle-bin` 清回收站。目录目标用 `contents`，目录内按通配匹配用 `entry`，单个文件（如 `MEMORY.DMP`）用 `file`；类别级 `needsAdmin = 任一目标 needsAdmin`。
- `fs-walk.js`：目录遍历与大小统计。`lstat` 判断，跳过符号链接、junction、挂载点；单类文件数上限与超时截断；返回 `{ bytes, files, entries, truncated, errors }`。
- `scan.js`：后台扫描任务。内存 Map 保存 `{ scanId, startedAt, categories }`，TTL 10 分钟；每类状态 `pending/scanning/done/truncated/error`。
- `store.js`：`<端口数据目录>/disk-clean/` 下的 `exclusions.json`、`custom.json`、`history.jsonl` 读写。
- `clean.js`：校验勾选类别属于该 `scanId` → 生成 job 目录与 `job.json` → 启动 PS 助手（普通或提权）→ 轮询 `result.json` → 追加历史。
- `helper.ps1`：模板（写文件时必须带 UTF-8 BOM）；参数为 `job.json` 路径，逐条删除、失败继续、结果写 `result.json`。
- `mount.js`：`/api/disk-clean/*` 路由；在 `server/http-api.js` 挂载。

前端 `web/src/tools/disk-clean/`：

- `DiskCleanTool.vue`：页面。
- `useDiskClean.ts`：状态与轮询。

注册点：

- `web/src/tools/catalog.ts`：`ToolId` 增加 `disk-clean`，磁贴图标 `🧹`，词条 `tools.disk-clean` / `tools.desc.disk-clean`。
- `web/src/components/TerminalView.vue`：挂载 `DiskCleanTool`。
- `web/src/components/ToolSidebar.vue`：`disk-clean` 返回 `null`（无左侧树）。

## 4. 类别清单（第 1 期）

路径一律用环境变量 / `os.homedir()` 解析，不写死盘符与用户名。

### 系统（system）

| id | 路径 | 模式 | 风险 | 管理员 | 默认勾选 |
|---|---|---|---|---|---|
| user-temp | `%LOCALAPPDATA%\Temp` | contents | safe | 否 | 是 |
| windows-temp | `%SystemRoot%\Temp` | contents | safe | 是 | 是 |
| recycle-bin | 系统盘回收站（`Clear-RecycleBin`） | recycle-bin | caution | 否 | 否 |
| update-cache | `%SystemRoot%\SoftwareDistribution\Download` | contents | caution | 是 | 否 |
| crash-dumps | `%LOCALAPPDATA%\CrashDumps`、`%SystemRoot%\MEMORY.DMP` | contents | caution | 部分 | 否 |
| wer-reports | `%LOCALAPPDATA%\Microsoft\Windows\WER\ReportQueue`、`ReportArchive` | contents | caution | 否 | 否 |
| thumbnails | `%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db`、`iconcache_*.db` | entry | caution | 否 | 否 |
| system-logs | `%SystemRoot%\Logs\CBS`（仅 ≥7 天） | contents | caution | 是 | 否 |
| windows-old | `%SystemDrive%\Windows.old` | entry | risky | 是 | 否 |

### 应用程序 / 开发（app）

| id | 路径 | 风险 | 默认勾选 |
|---|---|---|---|
| npm | `%LOCALAPPDATA%\npm-cache\_cacache` | safe | 是 |
| yarn | `%LOCALAPPDATA%\Yarn\Cache` | safe | 是 |
| pnpm | `%LOCALAPPDATA%\pnpm\store` | caution | 否 |
| pip | `%LOCALAPPDATA%\pip\Cache` | safe | 是 |
| nuget | `%USERPROFILE%\.nuget\packages` | caution | 否 |
| go-build | `%LOCALAPPDATA%\go-build` | safe | 是 |
| go-mod | `%GOMODCACHE%`（缺省 `%USERPROFILE%\go\pkg\mod\cache`） | caution | 否 |
| cargo | `%USERPROFILE%\.cargo\registry\cache` | caution | 否 |
| maven | `%USERPROFILE%\.m2\repository` | caution | 否 |
| gradle | `%USERPROFILE%\.gradle\caches` | caution | 否 |
| office-cache | `%LOCALAPPDATA%\Microsoft\Office\16.0\OfficeFileCache` | safe | 是 |
| netease-music | `%LOCALAPPDATA%\Netease\CloudMusic\Cache` | safe | 是 |
| electron-apps | `%APPDATA%\Slack\Cache`、`%APPDATA%\Microsoft\Teams\Cache`、VS Code `CachedExtensionVSIXs` 等 | safe | 是 |
| wechat | `%USERPROFILE%\Documents\WeChat Files\*\FileStorage\Cache`，4.x 另试 `xwechat_files` | caution | 否 |
| qq | `%USERPROFILE%\Documents\Tencent Files\*\Image` | risky | 否 |
| dingtalk | 已知候选缓存路径，存在才列出 | caution | 否 |
| wps | 已知候选缓存路径，存在才列出 | caution | 否 |
| steam | `steamapps\downloading`、`shadercache`、`htmlcache` | caution | 否 |
| downloads-partial | `%USERPROFILE%\Downloads` 下 `*.part`、`*.crdownload`、`*.tmp`、`*.download`（≥1 天） | safe | 是 |

所有软件类路径均为「候选多套 + 存在才列出」；不存在则不显示该类。

### 浏览器（browser，仅缓存）

| id | 路径 |
|---|---|
| chrome | `%LOCALAPPDATA%\Google\Chrome\User Data\*` 下 `Cache`、`Code Cache`、`GPUCache`、`Service Worker\ScriptCache` |
| edge | `%LOCALAPPDATA%\Microsoft\Edge\User Data\*` 同上 |
| brave | `%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data\*` 同上 |
| firefox | `%LOCALAPPDATA%\Mozilla\Firefox\Profiles\*\cache2` |

不触碰 Cookie、History、Login Data、Bookmarks。

### 自定义（custom）

- 用户在设置抽屉里添加的目录，写入 `custom.json`。
- 删除模式 `contents`（只删目录内容，不删目录本身）；默认不勾选，风险 `risky`，清理时逐项确认。
- 校验：绝对路径、必须存在、拒绝盘符根、`%SystemRoot%`、用户主目录本身、应用安装目录、`<端口数据目录>`。

## 5. 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/disk-clean/overview` | 系统盘可用/总量（`fs.statfsSync`） |
| GET | `/api/disk-clean/categories` | 类别表（含风险、是否需管理员、默认勾选） |
| GET | `/api/disk-clean/settings` | 排除列表 + 自定义目录 |
| PUT | `/api/disk-clean/settings` | 保存排除列表 / 自定义目录（含校验） |
| POST | `/api/disk-clean/scan` | 立即返回 `{ scanId }`，后台扫描 |
| GET | `/api/disk-clean/scan/{scanId}` | 轮询各分类状态与结果 |
| POST | `/api/disk-clean/clean` | `{ scanId, categoryIds, permanent, confirmed }` → `{ jobId }` |
| GET | `/api/disk-clean/clean/{jobId}` | 轮询 `{ status, removed, bytes, failed[], skipped, mode, elevated }` |
| GET | `/api/disk-clean/history` | 最近 100 条清理记录（界面展示 20 条） |

错误约定：

- 非 Windows：501
- `scanId` 不存在/过期：410
- `categoryIds` 不属于该 `scanId`：400
- `risky` 类别缺少逐项确认标记：400
- UAC 被取消：清理任务状态 `cancelled`（200 返回任务状态，不是 HTTP 错误）

## 6. 安全规则

- 只处理 `catalog.js` 解析出的类别根，以及通过校验的自定义目录；每个候选删除前 `path.resolve` + `lstat`，拒绝符号链接、junction、挂载点。
- `contents` 模式只删目录内的子项，不删目录本身；`entry` 模式按匹配条目删除；`recycle-bin` 只调用 `Clear-RecycleBin`。
- 年龄阈值：临时目录 0 天（被占用自动跳过）、日志 ≥7 天、下载半成品 ≥1 天。
- 排除匹配：目录前缀（规范化、大小写不敏感）+ 文件名通配（`*` `?` 转正则，不引入新依赖）；分析与清理两处都生效。
- 上限与截断：单类 20 万文件、单类扫描 30 秒超时，超限返回 `truncated: true`；失败明细最多保留 1000 条，其余只计数。
- 提权：job 目录 `<端口数据目录>/disk-clean/jobs/<jobId>/`（`job.json` / `result.json`）；helper 删除前再次校验 realpath 落在 `allowedRoots` 内；`Start-Process -Verb RunAs`；UAC 取消 → `cancelled`。
- 回收站：`Microsoft.VisualBasic.FileIO.FileSystem` 的 `RecycleOption.SendToRecycleBin`；永久删除用 `Remove-Item -Recurse -Force`；两者都 try/catch，失败继续。
- 任务生命周期：扫描结果 TTL 10 分钟，过期要求重新分析；服务重启后缺少 `result.json` 的 job 标记 `interrupted`。
- 审计：`history.jsonl` 追加 `{ ts, categories, mode, elevated, removed, bytes, failed }`。
- 清理时按同一规则重新枚举目标；弹窗中的预计值来自分析结果，实际值以清理结果为准。

## 7. 前端交互

入口：`MINI_TOOLS` 磁贴（`🧹`「系统清理」）；无左侧文件树。

页面自上而下：

1. 顶栏：系统盘可用/总量 +「分析」+「清理」（分析完成才启用）+ ⚙ 设置。
2. 分组折叠列表（系统 / 应用 / 浏览器 / 自定义）：每行勾选框、图标、名称、风险徽章、管理员标记、大小、文件数；未分析时大小显示「—」。
3. 分析中：每类状态 + 总进度 +「取消分析」。
4. 底部固定汇总条：已选 N 类、预计释放 X、模式切换（回收站 / 永久删除）。

设置抽屉：排除目录（目录选择器）、排除通配（每行一个）、自定义清理目录（目录选择器 + 风险确认）；保存后提示需重新分析。

清理确认弹窗：所选类别与合计、删除模式说明、含管理员项的 UAC 提示、`risky` 类别逐项勾选确认。

结果面板：释放空间、删除条目数、失败/跳过明细（可折叠，最多 1000 条）、系统盘前后可用空间差值、回收站/永久删除提示、最近清理记录。

`useDiskClean.ts` 状态机：`idle → scanning → ready → cleaning → done | error`（`ready` 指分析已完成、可清理；`error` 任意阶段可进入并展示原因）；扫描/清理轮询 500ms，失败重试 3 次；组件卸载清理定时器；扫描中禁用重复点击。

词条前缀 `diskclean.*`，zh-CN / en 同步补齐。

## 8. 测试与验收

服务端（`node --test "server/test/*.test.js"`）：

- 类别表路径解析落在白名单内（用临时 env 覆盖 `%TEMP%` 等）。
- 扫描：小文件树验证大小/数量、年龄阈值、排除前缀与通配、符号链接跳过、超限 `truncated`。
- 清理：非法/过期 `scanId` 返回 400/410；自定义目录校验拒绝盘符根、系统目录、用户主目录、应用安装目录、数据目录；helper 走 `-DryRun`。
- `helper.ps1` 生成带 UTF-8 BOM（断言首字节）。
- 非 Windows 环境全部接口 501。

前端（vitest）：

- 默认勾选规则（safe 勾、caution/risky 不勾）与勾选汇总。
- `risky` 类别未逐项确认不能提交。
- 状态机：扫描中禁重复点击、轮询停止、`scanId` 过期提示。

手动验收：

1. 分析系统盘 → 每类有大小、进度逐类推进。
2. 仅 safe 项 → 回收站清理 → 明细与可用空间差值一致。
3. 含管理员项 → 弹 UAC → 取消显示 `cancelled`；确认后跑完。
4. 切永久删除 → 文件不进回收站。
5. 加排除目录/通配 → 重新分析后不计入。
6. 加自定义目录 → 危险路径被拒，成功后默认不勾。
7. 重启后端后历史记录仍在。
8. `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、敏感信息扫描全过。

## 9. 风险与取舍

- 删除是不可逆操作：默认回收站、risky 逐项确认、清理前重新枚举并校验白名单；永久删除必须显式切换。
- 提权助手会接收用户可控的路径清单（来自类别表与自定义目录），存在本地攻击面；helper 侧对 `allowedRoots` 二次校验，且 job 目录位于按端口隔离的数据目录内。
- 桌面软件缓存路径随版本变化：统一「候选多套 + 存在才列出」，不存在不显示，避免误删。
- 清理时重新枚举会导致实际结果与预计值不完全一致：结果面板明确展示实际值。
- 大量小文件走回收站会较慢：按顶层条目批量调用，进度和取消由 job 状态体现。
