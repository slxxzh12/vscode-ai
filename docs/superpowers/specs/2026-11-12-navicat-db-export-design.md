# Navicat 批量导出数据库内容设计

## 背景

Navicat 小工具已有连接管理、SQL 执行、连接串复制、`.ncx` 导出与 CSV 批量导入连接串。用户需要把连接对应的数据库内容批量导出：先导出库结构（DDL），再按 ID 取全表排序后的「最小 N 条 + 最大 N 条」抽样数据，N 可配置；输出 SQL（用于还原）与 CSV（用于查看）两种格式。

## 目标

- 左侧工具条新增「导出」按钮，打开导出弹窗。
- 弹窗中可多选/全选连接、设置抽样条数 N（默认 30、1–1000）、勾选 SQL / CSV（默认都勾选）。
- 服务端逐连接、逐库、逐表导出，返回 zip 下载。
- 每个库输出：
  - SQL：`<连接>/<库>/schema.sql`（建表 DDL）+ `data.sql`（抽样 `INSERT`）。
  - CSV：`<连接>/<库>/csv/<表>.schema.csv`（列级结构）+ `<表>.data.csv`（抽样数据）。
- 抽样：按 ID 升序取前 N 条 + 降序取后 N 条，去重后输出。
- ID 列判定：单列主键 → 名为 `id` 的列 → 第一列。
- 表格/库名做文件路径安全化；单表/单库失败不中断，写入 `errors.txt`。
- 全量中英 i18n。

## 非目标（YAGNI）

- 不导出全量数据，只导出首尾抽样。
- 不支持 Redis（无表/ID）：跳过并记入 `errors.txt`。
- 不改现有 SQL 执行、CSV 结果导出、`.ncx` 导出逻辑。
- 不持久化导出设置；每次弹窗重置为默认值。

## 设计

### 一、执行层（`server/navicat-exec.js`）

`exec(profile, password, sql, opts)` 增加可选 `opts.maxRows` 覆盖默认行数上限，供结构/抽样查询取到完整结果；不传时沿用 `maxRows`（默认 200）。

### 二、ZIP 写入（新增 `server/zip-writer.js`）

`createZip(entries, { date })`：store（不压缩）方式生成 zip。条目路径统一 `/`，中文名按 UTF-8 编码并置通用标志位 `0x0800`，含 CRC32、中央目录与 EOCD。测试用 `yauzl` 读回校验。

### 三、导出逻辑（新增 `server/navicat-export.js`）

`createNavicatExport({ exec }).build({ items, n, formats })` → `{ files, errors }`。

- 结构：
  - MySQL：`information_schema.columns` + `SHOW CREATE TABLE`。
  - Postgres：`pg_attribute`/`pg_attrdef`（`format_type` 取类型）+ `pg_index` 取主键，重建 `CREATE TABLE`。
  - SQLite：`PRAGMA table_info` + `sqlite_master.sql`。
- 抽样：`SELECT * FROM <表> ORDER BY <id> ASC LIMIT N` 与 `... DESC LIMIT N`，后者反转为升序；按 ID 去重（无 ID 列时按整行去重）。
- 值格式化：SQL 按类型转义（单引号 `''`，MySQL 额外转义反斜杠/控制符；`NULL`/数字/布尔/日期/二进制）；CSV 按 RFC 4180（含逗号/引号/换行时加引号、内部 `"` 双写），文件加 UTF-8 BOM。
- 库范围：MySQL 有 `database` 导该库，否则导全部并排除系统库；Postgres 导连接库的 `public`；SQLite 导该文件。
- 文件名安全化：`safeName` 替换 `\/:*?"<>|` 与控制字符。

### 四、HTTP 端点（`server/navicat-mount.js`）

`POST /api/navicat/export`，body `{ ids, n, formats }`：

- 校验 ids 非空、formats 至少一种，返回 400 `bad-request`。
- 读取各连接密码，调用 exporter；有错误时追加 `errors.txt`；`createZip` 后以 `application/zip` + `Content-Disposition` 返回。

### 五、前端

- `useNavicat.ts`：`exportData(ids, n, formats): Promise<Blob>`（非 2xx 抛错）。
- `useNavicatWorkbench.ts`：新增 `exportDlg/exportIds/exportN/exportSql/exportCsv/exporting/exportMsg` 与 `openExport/toggleAllExport/doExportData`；下载 zip 后置 `msg`。
- 新增 `NavicatExportDialog.vue`：连接勾选 + 全选/清空 + N + 格式 + 开始导出；挂到 `NavicatTool.vue`。
- `NavicatSidebarBar.vue`：新增「导出」按钮。

### 六、i18n（中英同步）

新增 `nv.export_*`、`nv.exported` 等词条，`shared/i18n/zh-CN.js` 与 `en.js` 对称补齐。

## 影响文件

- 新增 `server/zip-writer.js`、`server/navicat-export.js` 及测试。
- 改 `server/navicat-exec.js`、`server/navicat-mount.js`、`server/test/navicat-http.test.js`。
- 改 `web/src/tools/navicat/useNavicat.ts`、`useNavicatWorkbench.ts`、`NavicatSidebarBar.vue`、`NavicatTool.vue`。
- 新增 `web/src/tools/navicat/NavicatExportDialog.vue`。
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`。

## 测试计划

- `zip-writer.test.js`：CRC32 已知值；`yauzl` 读回中文路径/空文件；反斜杠归一。
- `navicat-export.test.js`：值/CSV 转义、ID 列判定、`safeName`；MySQL 结构+首尾抽样生成 SQL/CSV；只选 CSV 不生成 SQL；Redis 跳过记错。
- `navicat-http.test.js`：export 返回 zip 且含文件与 `errors.txt`；无 ids → 400。
- `useNavicatWorkbench.test.ts`：`openExport` 默认全选/30/双格式；`doExportData` 调用端点并下载。
- `NavicatSidebarBar.test.ts`：点击导出打开弹窗。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
