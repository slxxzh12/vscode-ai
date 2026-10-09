# Navicat SQLite 本地文件选择设计

## 背景

Navicat 小工具（`web/src/tools/navicat/`）已支持 SQLite：类型选 `sqlite` 时「新建/编辑连接」对话框有「数据库文件」输入框（`nv.database_file`），档案的 `database` 即文件路径；服务端 `navicat-exec.js` 的 `sqliteRun` 用 `node:sqlite` 打开该文件执行 SQL；左栏树经 `/api/navicat/schema/*` 列出表并支持点表生成 `SELECT`，右侧可直接跑 SQL。

缺口：SQLite 文件路径**只能手动输入**。项目已内置跨端原生文件选择能力 `server/native-dialog.js`（`runDialog`，仅 Windows 可用，非 Windows 返回 `{error:'unsupported'}`；`pickFile` / `pickAnyFile` / `pickFolder` 均基于它，调度器经 `/api/scheduler/pick-file` 使用）。

用户诉求：新建 SQLite 连接时能用系统对话框**选择本机已存在的库文件**（不要求新建不存在的文件），然后照常在网页里对 SQLite 执行操作。

## 目标

- SQLite 连接的「数据库文件」输入框右侧新增「浏览…」按钮，点击弹系统文件对话框，选中后把绝对路径写回 `form.database`。
- 对话框仅显示 SQLite 相关文件过滤（同时保留「All files」，便于 `*.db` 之外的命名）。
- 仅 Windows 支持弹窗；非 Windows 或弹窗失败时给出提示，仍可手动输入路径，不阻塞保存/执行。
- 全量中英 i18n。

## 非目标（YAGNI）

- 不支持「新建一个不存在的库文件」（仅选已存在文件；`OpenFileDialog` 语义如此）。用户仍可手动输入新路径——但那不在本次交互范围内。
- 不改 `navicat-store.js`（`database` 字段与落盘逻辑不变）。
- 不改 `navicat-exec.js`、`navicat-ncx.js`、左栏树、SQL 执行、结果展示、导出、复制连接串等既有逻辑。
- 不提供基于浏览器的 `<input type="file">` 方案（浏览器出于安全不暴露真实绝对路径，与服务端 `node:sqlite` 需要本机绝对路径的需求不符）。

## 设计

### 一、后端：文件对话框（`server/native-dialog.js`）

新增导出：

```js
export function pickSqliteFile(opts) {
  return runDialog([
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    "$d.Filter = 'SQLite|*.db;*.sqlite;*.sqlite3;*.db3|All files|*.*'",
  ], '$d.FileName', opts);
}
```

与 `pickAnyFile` 同构，仅多一层 SQLite 过滤器；沿用 `runDialog` 的 Windows 判定、UTF-8 输出、超时、取消语义。

### 二、后端：路由（`server/navicat-mount.js`）

- `createNavicatMount` 增加依赖注入 `pickFile = pickSqliteFile`（从 `native-dialog.js` import 默认值，便于测试注入 fake）。
- 新增 `POST /api/navicat/pick-file`：

```
const r = await pickFile();
if (r.error) return sendJson(res, 200, { error: r.error, message: r.message || null });
if (r.cancelled || !r.path) return sendJson(res, 200, { cancelled: true });
return sendJson(res, 200, { path: r.path });
```

- 只回传路径，不读写任何档案；`path` 由前端写进表单，随「确定」走既有 `POST/PATCH /api/navicat/profiles` 保存。

### 三、后端：装配（`server/index.js`）

`createNavicatMount({ store, exec, ncx, pickFile: pickSqliteFile })`，`pickSqliteFile` 从 `./native-dialog.js` import。

### 四、前端数据层（`useNavicat.ts`）

新增：

```ts
async function pickFile(): Promise<{ path?: string; cancelled?: boolean; error?: string; message?: string }> {
  return jfetch('/api/navicat/pick-file', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
}
```

加入返回对象并计入类型定义。

### 五、前端工作台（`useNavicatWorkbench.ts`）

- 新增 `browseFile(): Promise<void>`：
  - 调 `nav.pickFile()`；`path` 存在则 `form.value = { ...form.value, database: path }`；
  - `cancelled`：静默返回；
  - `error`（含非 Windows 的 `unsupported`）：`dlgMsg.value = t('nv.pick_failed')`，不改 `database`。
- 暴露到 `NavicatWorkbench` 接口与 `cache` 返回对象。

### 六、前端 UI（`NavicatTool.vue`）

- SQLite 的「数据库文件」行改为：`el-input`（`.nv-db-file`）+ 右侧「浏览…」按钮（`.nv-browse`，文案 `nv.browse`），点击调 `browseFile`。
- 按钮在弹窗内常显（非 SQLite 类型不显示该行，故无需额外条件）；非 Windows 点击后由 `dlgMsg` 提示，不影响手输。

### 七、i18n（中英同步）

新增键：

- `nv.browse`：浏览… / Browse…
- `nv.pick_failed`：当前平台不支持文件选择，请手动输入路径 / File picker is not supported on this platform; enter the path manually.

`shared/i18n/zh-CN.js` 与 `shared/i18n/en.js` 同步补齐。

## 影响文件

- 改 `server/native-dialog.js`（新增 `pickSqliteFile`）
- 改 `server/navicat-mount.js`（注入 `pickFile` + 新路由）
- 改 `server/index.js`（装配注入）
- 改 `server/test/native-dialog.test.js`（`pickSqliteFile` 用例）
- 改 `server/test/navicat-http.test.js`（pick-file 路由用例）
- 改 `web/src/tools/navicat/useNavicat.ts`（`pickFile`）
- 改 `web/src/tools/navicat/useNavicatWorkbench.ts`（`browseFile`）
- 改 `web/src/tools/navicat/NavicatTool.vue`（浏览按钮）
- 改 `web/src/tools/navicat/useNavicat.test.ts`、`useNavicatWorkbench.test.ts`（对应路由/行为）
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

## 测试计划

- `native-dialog.test.js`：`pickSqliteFile` 非 win 返回 `unsupported` 且不 spawn；win 下 spawn 脚本含 `OpenFileDialog` 与 SQLite 过滤；无输出视为取消（复用现有 fake spawn 模式）。
- `navicat-http.test.js`：注入 `pickFile` fake，断言 `POST /api/navicat/pick-file` 的三种返回（`path` / `cancelled` / `error`）。
- `useNavicat.test.ts`：`pickFile` 走 `POST /api/navicat/pick-file`。
- `useNavicatWorkbench.test.ts`：选中后写回 `form.database`；`cancelled` 静默；`error` 置 `dlgMsg`。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
