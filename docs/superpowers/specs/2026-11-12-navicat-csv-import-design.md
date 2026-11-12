# Navicat 批量导入连接串设计

## 背景

Navicat 小工具（`web/src/tools/navicat/`）左侧工具条只有「＋ 新建连接」，一次只能建一个档案；连接档案存 `<数据目录>/.../navicat/profiles.json`（`server/navicat-store.js`），测试走 `POST /api/navicat/test`。用户需要一次性把一批连接串（CSV 文件）导入，导入后在左侧树上建立多个连接，并自动测试全部新连接。

## 目标

- 左侧工具条新增「批量导入」按钮，选择 `.csv` 文件。
- CSV 每行一个连接串，支持两种行：
  - `名称,mysql://user:pass@host:3306/db`（首列不是 URI 时当作名称）；
  - `mysql://user:pass@host:3306/db`（单列，名称自动生成）。
- 支持协议：`mysql://`、`postgres://` / `postgresql://`、`redis://`、`sqlite://<path>`，以及裸 SQLite 文件路径（`.db` / `.sqlite` / `.sqlite3` / `.db3`）。
- 缺名称时用 `host:port/db` 自动生成（SQLite 用文件名）。
- 导入时跳过无法解析的行，跳过重复连接（`type|host|port|user|database` 相同，含批内去重），只新建新的。
- 新建完成后逐个测试新连接；测试失败的连接**保留**，左侧树用红点标记。
- 汇总提示：导入成功 / 跳过重复 / 解析失败、测试成功 / 失败数量与失败明细。
- 全量中英 i18n。

## 非目标（YAGNI）

- 不改后端：复用 `POST /api/navicat/profiles` 与 `POST /api/navicat/test`，CSV 由浏览器 `<input type="file">` 读取（跨平台，不依赖 Windows 原生对话框）。
- 不做逐行进度条；仅用 `msg` 文本显示「测试中 i/n」。
- 不做并发测试（顺序执行，避免瞬时打满连接）。
- 不持久化失败标记（仅当前会话内有效）。
- 不改 CSV 导出、SQL 执行、结果展示等其他逻辑。

## 设计

### 一、CSV 解析（新增 `web/src/tools/navicat/csvImport.ts`，纯函数）

- `parseCsv(text: string): string[][]`
  - 去掉 UTF-8 BOM；支持 `\r\n` / `\n`；支持双引号包裹字段、字段内 `""` 转义、引号内逗号与换行；忽略完全空白行。
- `parseConnRow(row: string[]): { profile: NavicatProfile } | { error: string }`
  - 找到「像 URI」的列：匹配 `^(mysql|postgres|postgresql|redis|sqlite)://` 或以数据库扩展名结尾的裸路径。
  - 若该列是首列 → 无名称；否则取该列前一列（或首个非空列）作为名称。
  - URI 解析：
    - `mysql://[user[:pass]@]host[:port][/db]` → type `mysql`，默认端口 `3306`；
    - `postgres://` / `postgresql://` 同上 → type `postgres`，默认端口 `5432`；
    - `redis://[[user]:pass@]host[:port][/dbIndex]` → type `redis`，默认端口 `6379`，`/dbIndex` 作为 database；
    - `sqlite://<path>` 或裸路径 → type `sqlite`，`database` 为路径。
  - URL 解码用户名/密码/库名。
  - 缺名称：网络库用 `host:port/db`（无库用 `host:port`），SQLite 用文件名（无文件名用完整路径）。
- `dedupeKey(p: NavicatProfile): string` → `${type}|${host}|${port}|${user}|${database}`。
- `parseCsvProfiles(text): { profiles: NavicatProfile[]; errors: { line: number; reason: string }[] }`
  - 逐行 `parseConnRow`，成功的收集，失败的记录 `line`（1 基）与原因；空行跳过。

### 二、工作台（`useNavicatWorkbench.ts`）

新增接口成员与状态：

- `importing: Ref<boolean>`；
- `failedIds: Ref<Set<string>>`；
- `importCsv(file: File): Promise<void>`。

`importCsv` 流程：

1. `importing = true`，`msg = ''`。
2. `file.text()` → `parseCsvProfiles`。
3. `await nav.load()`，用现有 profiles 的 `dedupeKey` 集合 + 批内集合过滤，统计 `skipped`。
4. 逐个 `nav.save(profile)` 新建；记录新建成功数与失败（保存报错）数/id。
5. 逐个 `nav.test({ id })`：失败把 id 加入 `failedIds`，收集 `名称: 错误`；`msg` 显示 `测试中 i/n`。
6. 汇总写入 `msg`（i18n 插值）：导入 X / 跳过重复 Z / 解析失败 Z2；测试成功 Y / 失败 Y2；有失败时追加明细行。
7. `window.dispatchEvent(new CustomEvent('df-refresh-tree'))`。
8. `finally { importing = false }`。

`failedIds` 在连接被删除时清理（`onRemove`）。

### 三、左侧工具条（`NavicatSidebarBar.vue`）

- 新增「批量导入」按钮 + 隐藏 `<input type="file" accept=".csv,text/csv">`（`ref`）。
- 点击按钮 → 触发 `input.click()`；`change` 时取 `files[0]` 调 `importCsv`，随后清空 `input.value` 以便重复选同一文件。
- `importing` 时按钮禁用/显示导入中文案。

### 四、树失败标记（`navicatTreeSource.ts`）

- `NavicatTreeDeps` 增加 `failedIds: () => Set<string>`（可选，缺省视为空集）。
- 根节点映射：`status: deps.failedIds?.().has(String(p.id)) ? 'fail' : undefined`。
- 复用 `TreeView` 已有红点（`status:'fail'`），无需改 `TreeView`。

### 五、i18n（中英同步）

新增键：

- `nv.import_csv`：批量导入 / Import CSV
- `nv.importing`：导入中… / Importing…
- `nv.import_empty`：CSV 无有效连接 / No valid connections in CSV
- `nv.import_done`：导入 {ok}，跳过重复 {dup}，解析失败 {bad}；测试成功 {pass}，失败 {fail} / Imported {ok}, skipped {dup}, parse failed {bad}; test passed {pass}, failed {fail}
- `nv.import_testing`：导入完成，测试中 {i}/{n} / Imported, testing {i}/{n}
- `nv.import_fail_line`：{name}: {msg}（失败明细行）

`shared/i18n/zh-CN.js` 与 `en.js` 同步补齐。

## 影响文件

- 新增 `web/src/tools/navicat/csvImport.ts`
- 新增 `web/src/tools/navicat/csvImport.test.ts`
- 改 `web/src/tools/navicat/useNavicatWorkbench.ts`（`importCsv`/`failedIds`/`importing`）
- 改 `web/src/tools/navicat/navicatTreeSource.ts`（失败标记）
- 改 `web/src/tools/navicat/NavicatSidebarBar.vue`（导入按钮 + 文件输入）
- 改 `web/src/tools/navicat/useNavicatWorkbench.test.ts`、`navicatTreeSource.test.ts`、`NavicatSidebarBar.test.ts`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

## 测试计划

- `csvImport.test.ts`：CSV 引号/逗号/CRLF/BOM；各协议 URI（含默认端口、URL 解码、redis 库索引）；`名称,URI` 与单列；SQLite 裸路径；缺名称生成；dedupe；错误行带行号。
- `useNavicatWorkbench.test.ts`：mock `File`（`text()`）与 `fetch`，断言新建、去重跳过、测试失败进入 `failedIds`、汇总文案、`df-refresh-tree` 触发。
- `navicatTreeSource.test.ts`：`failedIds` 命中时根节点 `status:'fail'`。
- `NavicatSidebarBar.test.ts`：点击导入按钮触发隐藏 input 的 `click`。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
