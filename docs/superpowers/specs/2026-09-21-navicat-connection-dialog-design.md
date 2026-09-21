# Navicat 风格「新建连接」窗口设计

## 背景

Navicat 小工具（`web/src/tools/navicat/`）当前是「左栏树导航 + 右侧 SQL/结果」布局（见 `2026-09-20-navicat-tree-navigation-design.md`）。连接的新建/编辑走一个紧凑的 `el-dialog`：字段横向 flex-wrap 平铺，其中包含「数据库 / 文件路径」输入框。

用户诉求：添加连接时不要输入数据库名，数据库通过查询得到；同时把添加连接的弹窗改成真实 Navicat「新建连接」窗口的样子，界面与 Navicat 保持一致。

## 目标

- 连接对话框重做成 Navicat 风格窗口：竖向 label 表单 + 顶部「常规 / 高级」分页 + 底部「测试连接 / 取消 / 确定」。
- mysql / postgres / redis 的连接表单**移除数据库字段**；库与表完全由左栏树通过 `/api/navicat/schema/*` 查询得到。
- SQLite 保留数据库字段，标签改为「数据库文件」（其 `database` 就是文件路径，是连接必需项）。
- 高级页放 SSL 开关，沿用 `profile.options.ssl`。
- 全量中英 i18n。

## 非目标（YAGNI）

- 不加「保存密码」勾选（密码仍始终本机加密落盘，行为不变）。
- 不做 Navicat 左侧竖向图标分类（Databases / SSH / HTTP 等），只做「常规 / 高级」两个页签。
- 不改后端 `navicat-store.js` / `navicat-exec.js` / `navicat-mount.js`（`database` 字段保留在档案结构中，仅前端不再为 mysql/postgres/redis 提供输入）。
- 不改左栏树、SQL 执行、结果展示、导出、复制连接串等既有逻辑。

## 设计

### 一、对话框布局（`NavicatTool.vue`）

- `el-dialog` 宽度约 560px，标题沿用「新建连接 / 编辑连接」（`nv.new_title` / `nv.edit_title`）。
- 内容区顶部 `el-tabs`：
  - 「常规」页（`nv.tab_general`）。
  - 「高级」页（`nv.tab_advanced`）；当类型为 `sqlite` 时隐藏该页签。
- 竖向表单：每行 label 在左、控件在右（label 定宽，如 96px），行距与 Navicat 接近。
- 底部 footer：左「测试连接」（`.nv-test`，复用 `nv.test`/`nv.testing`），右「取消」（`.nv-cancel`，`nv.cancel`）与「确定」（`.nv-save`，文案 `nv.ok`），主按钮为「确定」。

### 二、字段

- mysql / postgres：连接名（`nv.name`）、类型（`nv.type`）、主机（`nv.host`）、端口（`nv.port`）、用户名（`nv.user`）、密码（`nv.password`，`show-password`）。
- redis：连接名、类型、主机、端口、密码（无用户名）。
- sqlite：连接名、类型、数据库文件（`nv.database_file`）；数据库文件输入用 `.nv-db-file`，仍是 `form.database`。
- 高级页：SSL 开关（`nv.ssl`），绑定 `form.options.ssl`；`sqlite` 无此项。

### 三、保存语义

- `blank()` 仍返回含 `database: ''` 的表单，保持类型完整。
- `doSave()`：当 `form.type !== 'sqlite'` 时，提交前把 `database` 置空字符串，再 `save(...)`。这样：
  - 旧档案里残留的 mysql/pg/redis 默认库名会在下次保存时被清掉，避免执行时命中一个过期/不存在的库。
  - sqlite 的 `database`（文件路径）照常保存。
- 编辑已有连接：`form.value = { ...blank(), ...p, password: '' }` 不变（`p.database` 对 sqlite 有效；对其它类型被上一条清空）。密码仍先 `reveal(id)` 填入。
- 类型切换仍走现有 `onTypeChange()` 补默认端口（mysql 3306 / postgres 5432 / redis 6379 / sqlite 空）。

### 四、i18n（中英同步）

新增键：

- `nv.tab_general`：常规 / General
- `nv.tab_advanced`：高级 / Advanced
- `nv.database_file`：数据库文件 / Database file
- `nv.ok`：确定 / OK
- `nv.ssl`：SSL / SSL

复用：`nv.new_title`、`nv.edit_title`、`nv.name`、`nv.type`、`nv.host`、`nv.port`、`nv.user`、`nv.password`、`nv.test`、`nv.testing`、`nv.cancel`、`nv.required_name`、`nv.test_ok`、`nv.saved`。

`nv.database`、`nv.db_index` 在对话框移除后将不再被引用（保留词条，不做清理）。

## 影响文件

- 改 `web/src/tools/navicat/NavicatTool.vue`（对话框模板 + `doSave` 清空逻辑 + 样式）
- 改 `web/src/tools/navicat/NavicatTool.test.ts`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

## 测试计划

改 `NavicatTool.test.ts`：

- 新建对话框：点 `.nvnewbtn` 后常规页有连接名输入（`.nv-name-input`），且**不存在**数据库输入（`.nv-db`）。
- 类型切到 sqlite：出现「数据库文件」输入 `.nv-db-file`。
- 高级页签存在且含 SSL 开关（`.nv-ssl`）；sqlite 下高级页表隐藏。
- 保存走 POST（新建）/ PATCH（编辑）的既有断言保留（选择器随模板调整）。
- 保存 mysql 连接时请求体 `database` 为空串。

全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
