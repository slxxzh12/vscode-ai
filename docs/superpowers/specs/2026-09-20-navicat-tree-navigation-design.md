# Navicat 左栏树导航设计

## 背景

现有 Navicat 小工具（`web/src/tools/navicat/`）在上一轮改成了「顶部下拉框选连接 + 单列主区（表单 + SQL + 结果）」（见 `2026-09-20-navicat-connection-dropdown-design.md`）。本轮要改回「左侧导航」形态，但比最初的扁平列表更进一步：左栏是一棵可展开的数据树，右侧上方是 SQL 编辑区、下方是执行结果。

用户诉求原文：左栏类似 Postman 的导航，导航里可「新建连接」，右侧上方放 SQL 执行语句、下方放执行结果。

## 目标

- 左侧 `aside` 导航：顶部「＋ 新建连接」按钮 + 搜索框；下方树。
- 树按库类型呈现层级：
  - MySQL / PostgreSQL：连接 → 库 → 表
  - SQLite：连接 → 表（档案 `database` 就是文件，无多库层）
  - Redis：连接 → 数字库（0–15），不列 key
- 点击左栏「＋ 新建连接」弹出连接配置对话框；选中已有连接 = 激活；连接节点悬浮出现「编辑 / 重命名 / 删除」。
- 新建 / 编辑连接都在 `el-dialog` 对话框里完成（含「测试连接」）。
- 展开节点懒加载：点连接箭头才查库，点库箭头才查表；结果缓存。
- 点库节点 = 设为「当前库」（高亮）；点表 = 按方言加引号生成 `SELECT * FROM <表>` 追加进 SQL 并切到该表所在库。
- 右侧上方 SQL 编辑区、下方结果区；执行时带上「当前库」覆盖档案里的 `database`。
- 全量中英 i18n。

## 非目标（YAGNI）

- 不列 Redis key、不做 key 预览。
- 不列列/索引/视图等更细粒度元数据（只到「表」；SQLite 顺带把 view 当表列出）。
- 不做连接分组/文件夹、多选、批量、拖拽排序。
- 不做 schema 的持久缓存（仅组件内存缓存，连接切换或刷新即失效）。
- 不改动 `navicat-store.js`（档案结构不变）、`navicat-crypto.js`、`navicat-ncx.js`。

## 实现路线（3 选 1）

1. **后端新增 schema 查询接口 + 前端专用树组件（采用）**：`/api/navicat/schema/*` 按库类型返回库/表；前端新建 `NavicatTree.vue` 懒加载。职责清晰、可单独测试、不把 SQL 方言泄漏到前端。
2. 前端直接发 `SHOW DATABASES` 等元数据 SQL 走现有 exec：后端零改动，但把各库方言和写确认逻辑混进前端，结果形状还要特判，否。
3. 选中连接一次性预载全部库+表：前端简单，但大库慢、浪费连接，否。

## 设计

### 一、后端（`server/navicat-exec.js`）

在现有返回对象上新增两个方法，复用相同的建连参数：

- `listDatabases(profile, password) -> string[]`
  - `mysql`：`SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`
  - `postgres`：`SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`
  - `redis`：`['0', '1', ..., '15']`（默认 16 个数字库，不额外查 `CONFIG GET databases`）
  - `sqlite`：`[]`（无多库层）
- `listTables(profile, password, database) -> string[]`
  - `mysql`：`SELECT table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`
  - `postgres`：`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  - `sqlite`：`SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`
  - `redis`：`[]`

两者都走现有 `withTimeout`（用 `connectTimeoutMs + statementTimeoutMs`），失败时 `e.code` 缺省置 `connect`/`exec`，交给 mount 的 `STATUS` 映射。

### 二、后端（`server/navicat-mount.js`）

- 新增 `GET /api/navicat/schema/databases?id=<id>` → `{ items: string[] }`
- 新增 `GET /api/navicat/schema/tables?id=<id>&database=<db>` → `{ items: string[] }`
  - `database` 取 `url.searchParams.get('database') || ''`
- `POST /api/navicat/exec`：请求体新增可选 `database`；执行前构造 `runProfile = body.database != null && body.database !== '' ? { ...p, database: String(body.database) } : p`，用 `runProfile` 执行（mysql/pg/redis 用它切当前库/索引；sqlite 前端不会传，传了也无效）。写确认判定 `exec.isWrite(runProfile, sql)` 沿用。
- `POST /api/navicat/test` 不变。

### 三、前端布局（`NavicatTool.vue` 重写）

```
┌─ 左栏 aside（宽 ~260）─┐┌─ 右栏 main ──────────────────────┐
│ [＋新建连接] [搜索]     ││ 工具栏: 连接名 · 编辑 · 复制串 · 导出  │
│ ▸ mysql  A            ││ ──────────────────────────────── │
│   ▾ A                 ││  [ SQL 编辑区 ]                   │
│     ▾ mydb            ││ ──────────────────────────────── │
│        users          ││  执行 · 清空 · 耗时/行数 · CSV      │
│        orders         ││ ──────────────────────────────── │
│ ▸ redis  B            ││  [ 结果表格 / raw / 空态 ]         │
│   0  1  2 …           ││                                   │
└───────────────────────┘└───────────────────────────────────┘
```

- `.nvbody`：`display:flex; flex-direction:row`，左 `aside.nvside`、右 `section.nvmain`，`height: calc(100vh - 150px)`。
- 左栏顶部：`＋ 新建连接` 按钮 + 搜索 `<input>`（按连接名过滤，复用 `nv.search_ph`）。
- 右栏工具栏：当前连接名 + 「编辑」（打开对话框）+ 「复制连接串 / 含密码复制 / 导出 .ncx」；无选中连接时禁用。
- 右栏主体：SQL `<textarea class="nv-sql">`（保留现有类名与样式）→ 结果操作条 → 结果区（表格/`raw`/空态），基本沿用现有模板与样式。

### 四、连接对话框（`NavicatTool.vue` 内）

- `el-dialog`，标题「新建连接 / 编辑连接」；表单字段：名称、类型、主机、端口、用户、密码（`show-password`）、数据库/文件路径（Redis 为库索引）、SSL。
- 按钮：`测试连接`（复用 `test`）、`保存`（POST/PATCH 依 `form.id`）、`取消`。
- 编辑已有连接时先 `reveal(id)` 填充密码；新建时表单清空。
- 保存成功后关闭对话框、刷新左栏、自动选中该连接。
- 类型切换时按现有 `onTypeChange` 逻辑补默认端口。

### 五、树组件（新增 `web/src/tools/navicat/NavicatTree.vue`）

不复用 `ItemTree.vue`：这里是三层数据树，叶子语义是「生成 SQL」而非文件记录，且节点类型/懒加载/高亮语义都不同。

- Props：`profiles`（已过滤）、`activeId`、`activeDatabase`、`actions`（rename/remove/edit/select 回调），以及取 schema 的函数（`fetchDatabases`/`fetchTables`）。
- Emits：`select-conn(profile)`、`pick-table(database, table)`、`edit(profile)`、`rename(profile)`、`remove(profile)`。
- 内部状态：
  - `expanded: Set<string>`（key 形如 `c:<id>` / `d:<id>:<db>`）
  - `dbCache: Map<id, string[]>`、`tableCache: Map<`${id}:${db}`, string[]>`
  - `loading: Set<string>`、`errors: Map<string,string>`
- 渲染：
  - 每个连接一行：chevron（点=展开/收起并懒加载）、类型徽标、名称；悬浮显示「编辑/重命名/删除」。
  - 连接展开：sqlite → 直接列 `listTables(id, profile.database)`；redis → 列 `listDatabases` 的数字库（叶子，点选为当前库）；mysql/pg → 列 `listDatabases` 的库节点。
  - 库节点展开 mysql/pg → 列 `listTables(id, db)` 表叶子；点库名 = 选中当前库。
  - 表叶子：点 = `emit('pick-table', db, table)`。
  - 加载中显示占位行；失败显示 `nv.schema_load_failed` 并允许重试（再次点击展开）。
- 错误/空态：库为空/表为空显示灰字。

### 六、数据层（`useNavicat.ts`）

- 新增：
  - `listDatabases(id: string): Promise<string[]>`
  - `listTables(id: string, database: string): Promise<string[]>`
- `exec(id, sql, database, confirm)` 增加 `database` 参数并写入请求体（`confirm` 之前保持向后兼容：调用方显式传）。
- 其余（`load/save/remove/rename/test/reveal/connstr/exportNcx`）不变。

### 七、交互细节

- 选中连接：`selectProfile(id)` 设 `activeId`、`activeDatabase = profile.database || ''`；不自动展开。
- 点库节点：`activeDatabase = db`（redis 为数字串）。
- 点表：先 `activeDatabase = db`（sqlite 的 db 为空串则不带），再把 `SELECT * FROM <quoted>` 追加到 SQL 末尾（空行分隔/光标处插入均可，取「追加到末尾，前面无内容则不加空行」）。
  - 引号规则：`mysql` 用反引号 `` ` ``；`postgres`/`sqlite` 用双引号 `"`。
- 执行：`exec(activeId, sql, activeDatabase)`；写确认逻辑不变。
- 当前库高亮：库节点 `on` 样式（含 redis 数字库）。
- 切换连接或手动刷新左栏时清空 schema 缓存。

### 八、i18n（中英同步）

新增键：

- `nv.edit`：编辑 / Edit
- `nv.new_title`：新建连接 / New connection
- `nv.edit_title`：编辑连接 / Edit connection
- `nv.databases`：数据库 / Databases
- `nv.tables`：表 / Tables
- `nv.schema_load_failed`：加载失败，点击重试 / Load failed, click to retry
- `nv.refresh`：刷新 / Refresh
- `nv.loading`：加载中… / Loading…
- `nv.cancel`：取消 / Cancel

复用：`nv.new`、`nv.empty`、`nv.search_ph`、`nv.rename`、`nv.delete`、`nv.sql_ph`、`nv.exec`、`nv.clear`、`nv.result`、`nv.no_result`、`nv.copy_connstr`、`nv.copy_with_pw`、`nv.export_ncx`、`nv.test`、各表单字段与错误键。

## 影响文件

- 改 `server/navicat-exec.js`（新增 `listDatabases` / `listTables`）
- 改 `server/navicat-mount.js`（两个 schema 端点 + exec `database` 覆盖）
- 改 `web/src/tools/navicat/useNavicat.ts`（新增两个方法 + exec 参数）
- 改 `web/src/tools/navicat/NavicatTool.vue`（重写为两栏 + 对话框）
- 新增 `web/src/tools/navicat/NavicatTree.vue`
- 新增 `web/src/tools/navicat/NavicatTree.test.ts`
- 改 `web/src/tools/navicat/NavicatTool.test.ts`
- 改 `server/test/navicat-exec.test.js`、`server/test/navicat-http.test.js`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

## 测试计划

- 后端 `navicat-exec.test.js`：用假 profile 断言 `listDatabases`/`listTables` 对 redis/sqlite 的特征返回（无需真库）；mysql/pg 走驱动，测试可只断言 sqlite/redis 分支与参数拼装（或留集成）。
- 后端 `navicat-http.test.js`：新增 `GET /api/navicat/schema/databases`、`/schema/tables` 断言；`exec` 带 `database` 时断言执行层收到覆盖后的 profile。
- 前端 `NavicatTree.test.ts`：展开连接触发 `listDatabases`；展开库触发 `listTables`；点表 emit `pick-table`；点库 emit 选中；错误显示重试。
- 前端 `NavicatTool.test.ts`（重写）：
  - 新建连接打开对话框，保存走 POST；编辑走 PATCH。
  - 选中连接后右栏工具栏显示连接名。
  - 点表生成 `SELECT * FROM ...` 进 SQL 编辑区。
  - 执行请求体带 `database`；写语句先确认再执行；结果表格渲染。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 后续（本轮不做）

- 列/索引/视图层级、表数据预览、Redis key 浏览。
- schema 持久缓存、最近使用排序、连接分组。
