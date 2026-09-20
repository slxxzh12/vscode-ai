# Navicat 小工具设计

## 背景

「小工具」（`web/src/components/MiniTools.vue`）目前有翻译、YAML、JS、排序、Postman。Postman 已经有一套成熟的**左侧列表 + 右侧主区**布局：数据落 `<端口数据目录>/tools/postman/`（`server/postman-history.js`），后端路由在 `server/http-api.js` 里内联，另有独立挂载的 `server/usage-mount.js` 可作 `/api/*` 挂载风格参考。

后端无任何数据库驱动依赖；Node 24 自带 `node:sqlite`。已有 `server/llm-vault.js`（AES-256-GCM + scrypt，主密码模式）可作为加解密写法参考，但本工具不使用主密码。

现在新增「Navicat」小工具：管理数据库连接档案，并直接在页面里执行 SQL / Redis 命令、查看结果，同时能把连接导出成 Navicat 可导入的 `.ncx` 文件。

## 目标

- 支持四类连接：MySQL/MariaDB、PostgreSQL、SQLite（`node:sqlite`）、Redis。
- 连接档案扁平列表管理：新建、编辑、重命名、删除、搜索；权限敏感的密码字段加密落盘。
- 在线执行：SQL 数据库执行 SQL，Redis 执行命令；结果以表格/文本展示，最多显示 200 行并可导出 CSV。
- 测试连接、一键复制标准连接串、导出 `.ncx`。
- 双层加密：本机落盘一层（机器密钥 AEAD）+ 导出 `.ncx` 时按 Navicat 自身算法加密密码。
- 全量中英 i18n。

## 非目标（YAGNI）

- 不做表结构树、数据可视化编辑、ER 图。
- 不做多级文件夹分组、拖拽（左栏就是扁平列表）。
- 不设主密码/解锁流程。
- 不做 SSH 隧道、连接池配置面板、事务编排、多语句批量执行。
- 不直接写 Windows 注册表、不改 Navicat 任何本地数据。
- 不做结果分页懒加载（只做 200 行截断提示）。

## 设计

### 一、双层加密

**第 1 层（本机落盘）** `server/navicat-crypto.js`：

- `createNavicatCrypto({ keyFile })` → `{ seal(plaintext) -> box, open(box) -> string }`。
- 机器密钥：随机 32 字节，首次用时生成并存 `keyFile`（`<端口数据目录>/tools/navicat/.key`），尽力设 `0600`。
- 算法 AES-256-GCM：`box = { v: 1, iv: <b64 12B>, tag: <b64>, ct: <b64> }`；`open` 认证失败抛 `bad-secret`。
- 密钥文件缺失/损坏时：`seal` 重新生成；`open` 抛错（对应档案密码显示为不可用，列表仍可打开）。

**第 2 层（导出）** `server/navicat-ncx.js` 的 `navicatEncrypt(plain)`：

- Navicat 固定算法：AES-128-CBC，key = Latin1 `libcckeylibcckey`，IV = `libcciv libcciv `，输出大写 hex。
- 附 `navicatDecrypt(hex)` 供单测往返校验。

### 二、后端模块

**`server/navicat-store.js`** — 连接档案持久化

- `createNavicatStore({ file, crypto })`；`file` 默认 `<端口数据目录>/tools/navicat/profiles.json`。
- 档案结构：
  ```
  { id, name, type: 'mysql'|'postgres'|'sqlite'|'redis',
    host, port, user, database, options: { ssl?: boolean },
    secret: <box|null>,           // 密码密文，第 1 层
    createdAt, updatedAt }
  ```
- API：
  - `list()` → 数组，**剔除 `secret`**，附 `hasPassword: boolean`。
  - `get(id)` → 原始档案（含 `secret`），不存在抛 `not-found`。
  - `create(input)` / `update(id, patch)` / `remove(id)` / `rename(id, name)`。
  - `password(id)` → 明文密码（`secret` 为 null 时返回 `''`）。
- 落盘原子写：写 `.tmp` 后 `rename`；读失败按空档案处理。`type` 非四类之一抛 `bad-type`。

**`server/navicat-exec.js`** — 连接与执行

- `createNavicatExec({ connectTimeoutMs = 10000, statementTimeoutMs = 30000, maxRows = 200 })` → `{ test(profile), exec(profile, sql) }`。
- 统一结果：`{ columns: string[], rows: any[][], affected: number|null, truncated: boolean, durationMs: number, raw?: string }`。
- `test(profile)`：建立连接后立即关闭，返回 `{ ok: true }` 或抛出错误（错误信息透出 `message`）。
- 驱动：
  - `mysql`：`mysql2/promise`，`connectTimeout` + `max_execution_time`；结果取 `rows`/`fields`。
  - `postgres`：`pg` `Client`，`connectionTimeoutMillis` + `SET statement_timeout`；用 `fields` 取列名。
  - `sqlite`：`node:sqlite` `DatabaseSync`，`database` 即文件路径；`prepare(sql)` 后优先 `.all()`，非查询语句（抛 "does not return data"）回退 `.run()` 取 `changes`。
  - `redis`：`redis`(node-redis) `createClient`，`database` 为数字库索引；输入按引号切词成 argv 后 `sendCommand`；结果序列化为 `raw` 文本（JSON 对对象/数组做美化），`columns` 为空。
- **写操作识别**（用于二次确认）：
  - `isWriteSql(sql)`：剥离开头注释/空白后取首关键字；`SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/PRAGMA/VALUES` 视为读，其余（含 `WITH`）默认视为写，但 `WITH` 后若不含 `INSERT/UPDATE/DELETE/REPLACE/MERGE` 则视为读；含多个语句（`;` 分隔，切分是尽力而为，误判偏向"更保守=多一次确认"）时逐条判断，任一为写即整体为写。
  - `isWriteRedis(argv)`：读命令白名单（`GET/MGET/STRLEN/EXISTS/TYPE/TTL/PTTL/KEYS/SCAN/HGET/HMGET/HGETALL/HKEYS/HVALS/HLEN/HEXISTS/LRANGE/LLEN/LINDEX/SMEMBERS/SCARD/SISMEMBER/ZRANGE/ZRANGEBYSCORE/ZCARD/ZSCORE/PING/ECHO/TIME/DBSIZE/INFO/COMMAND`）；`CONFIG GET`/`CLIENT GETNAME` 等只读子命令按前缀放行，其余（尤其 `FLUSHALL/FLUSHDB`）为写。
- 截断：行数超过 `maxRows` 时取前 `maxRows` 行并置 `truncated: true`。
- 超时：驱动层超时参数 + `Promise.race` 兜底，超时错误 `code = 'timeout'`。

**`server/navicat-ncx.js`** — `.ncx` 导出

- `buildNcx(entries)` → XML 字符串：
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <Connections>
    <Connection ConnectionName="…" ConnType="…" Host="…" Port="…" Database="…" UserName="…" Password="<大写hex密文>"/>
  </Connections>
  ```
- 属性做 XML 转义；`Password` 用第 2 层算法加密。
- `CONN_TYPE` 常量表（单处定义，便于校准）：MySQL/MariaDB、PostgreSQL、SQLite、Redis 各一值。
  **已知风险**：Navicat 各版本 `ConnType` 取值未公开，导出后需人工用 Navicat 导入实测；若类型不对只改该常量。测试仅校验 XML 结构与 `navicatEncrypt` 已知向量，不校验 Navicat 语义。
- 连接串拼装（也在此模块，供 `/connstr` 用）：
  - `mysql://<user>:<pass>@<host>:<port>/<db>`
  - `postgresql://<user>:<pass>@<host>:<port>/<db>`
  - `redis://[:<pass>@]<host>:<port>/<db>`
  - SQLite：`<database>` 绝对路径

**`server/navicat-mount.js`** — HTTP 路由（`createNavicatMount({ store, exec, ncx })`，由 `index.js` 装配，风格对齐 `usage-mount.js`）

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/navicat/profiles` | — | `{ items }`（已掩码） |
| POST | `/api/navicat/profiles` | profile | `{ ok, item }` |
| PATCH | `/api/navicat/profiles` | `{ id, ...patch }` | `{ ok, item }` |
| DELETE | `/api/navicat/profiles?id=` | — | `{ ok }` |
| POST | `/api/navicat/test` | `{ id }` 或 `{ profile }`（未保存时用表单值） | `{ ok }` |
| POST | `/api/navicat/exec` | `{ id, sql, confirm? }` | `{ ok, result }` 或 `{ needConfirm: true, kind: 'write' }` |
| POST | `/api/navicat/reveal` | `{ id }` | `{ password }` |
| POST | `/api/navicat/connstr` | `{ id, withPassword? }` | `{ text }` |
| POST | `/api/navicat/ncx` | `{ ids }` | `{ xml }` |

- `exec`：识别为写且 `confirm !== true` 时**不执行**，返回 `{ needConfirm: true, kind: 'write' }`（HTTP 200），前端确认后带 `confirm: true` 重发。
- 档案解密：`exec`/`test`/`connstr`/`reveal` 由 mount 先 `store.get(id)` 再用 `crypto.open(secret)` 得到明文密码，然后交给 `exec` 或拼串；明文只在服务端内存中短暂存在，不落盘、不随列表下发。
- 错误码映射：`not-found`→404、`bad-type`/`bad-secret`/`bad-request`→400、`timeout`→504、驱动错误→502，响应体 `{ error }`，错误文案用 i18n（`translate(currentLocale, key)`）。

### 三、路径与装配

- `server/port-paths.js`：新增 `navicatDir: path.join(dir, 'tools', 'navicat')` 并加入 `ensurePortDirs` 创建列表。
- `server/index.js`：`createNavicatCrypto({ keyFile: path.join(paths.navicatDir, '.key') })`、`createNavicatStore(...)`、`createNavicatExec(...)`、`createNavicatMount(...)`，在 `/api/` 分发链里转交 `url.pathname.startsWith('/api/navicat')`（与 `/api/usage/` 同处）。
- `server/package.json`：新增依赖 `mysql2`、`pg`、`redis`（均为纯 JS）。绿色包依赖自检会覆盖。

### 四、前端 `web/src/tools/navicat/`

- `useNavicat.ts`（数据层）：调用上述端点，暴露 `profiles`、`load/create/update/remove`、`test`、`exec`、`reveal`、`connstr`、`exportNcx`，以及 `busy`/`msg`。
- `NavicatList.vue`：左栏扁平列表 + 搜索框 + 新建按钮；每项显示 `name` 与类型徽标，悬停出现重命名/删除。
- `NavicatTool.vue`：布局对齐 `PostmanTool.vue`（左栏 + 右主区，`height: calc(100vh - 150px)`）：
  - 右侧上：连接表单（类型下拉；`host/port/user/password/database`，SQLite 只留 `database` 文件路径，Redis `database` 为库索引；`password` 输入框带显示/隐藏，点击显示时走 `reveal`）＋ 保存/另存/测试连接。
  - 右侧中：SQL / 命令编辑器（`<textarea>`，等宽字体）。
  - 右侧下：结果区 —— 有 `columns` 时渲染表格（前端固定表头、横向滚动），否则渲染 `raw` 文本；显示耗时与 `truncated` 截断提示；`affected` 显示影响行数。
  - 顶栏按钮：执行、清空；复制连接串（带/不带密码）、导出 `.ncx`（多选或当前档案）。
  - 写操作二次确认：`exec` 返回 `needConfirm` 时用 `ElMessageBox.confirm` 弹窗，确认后 `confirm: true` 重发。
  - 结果导出 CSV：前端用 `columns`/`rows` 拼 CSV（含 BOM，便于 Excel 打开）。
- `MiniTools.vue`：`ToolId` 增加 `'navicat'`；`TOOLS` 增加 `{ id: 'navicat', icon: '🗄️', label: 'tools.navicat' }`；弹窗内 `v-if="open === 'navicat'"` 渲染 `<NavicatTool />`（与 Postman 同级，不走 `mtbody` 双框）。

### 五、i18n

新增键（中英同步）：

- `tools.navicat`（工具名）。
- `nav.*`：`new`、`name`、`type`、`host`、`port`、`user`、`password`、`database`、`file_path`、`db_index`、`save`、`saved`、`test`、`testing`、`test_ok`、`exec`、`running`、`clear`、`result`、`no_result`、`rows`、`affected`、`truncated`、`duration`、`confirm_write`、`confirm_write_title`、`copy_connstr`、`copy_with_pw`、`export_ncx`、`exported`、`reveal`、`hide`、`empty`、`search_ph`、`rename`、`delete`、`delete_confirm`、`required`、错误用的 `err_not_found`/`err_bad_type`/`err_timeout`/`err_conn` 等。

## 影响文件

- 新增 `server/navicat-crypto.js`、`server/navicat-store.js`、`server/navicat-exec.js`、`server/navicat-ncx.js`、`server/navicat-mount.js`
- 新增 `server/test/navicat-crypto.test.js`、`navicat-store.test.js`、`navicat-exec.test.js`、`navicat-ncx.test.js`、`navicat-http.test.js`
- 新增 `web/src/tools/navicat/useNavicat.ts`、`NavicatList.vue`、`NavicatTool.vue` + 对应 `*.test.ts`
- 改 `web/src/components/MiniTools.vue`、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- 改 `server/port-paths.js`、`server/index.js`、`server/package.json`

## 测试计划

- `navicat-crypto.test.js`：seal/open 往返；错误密钥/篡改 `tag` 抛 `bad-secret`；密钥文件自动生成且二次读取稳定。
- `navicat-store.test.js`：CRUD；`list()` 不含 `secret` 且有 `hasPassword`；`password()` 解密；`bad-type`；落盘后重新加载仍在。
- `navicat-ncx.test.js`：`navicatEncrypt` 已知向量 + 往返；`buildNcx` XML 结构、转义、密码为密文；连接串四类格式。
- `navicat-exec.test.js`：`isWriteSql`/`isWriteRedis` 分支；SQLite 用临时 `.db` 真跑建表 + INSERT + SELECT（写识别→select 结果、`maxRows` 截断）；驱动缺失/连不上时错误码。
- `navicat-http.test.js`：各端点成功路径；`needConfirm` 分支；404/400/504 映射。
- web：`useNavicat.test.ts`（请求路径与错误处理）、`NavicatTool.test.ts`（表单切换、写确认弹窗、结果渲染、CSV）。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 后续（本轮不做）

- 结果分页/懒加载、SQL 历史、表结构树。
- `.ncx` 导入（逆向解析）与 `ConnType` 自动校准。
- 连接密码轮换/主密码模式。
