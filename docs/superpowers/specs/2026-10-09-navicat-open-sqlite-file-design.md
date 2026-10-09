# 点击 db 文件用内置 Navicat 打开设计

## 背景

Navicat 小工具（`web/src/tools/navicat/`）已支持 SQLite：可新建 `sqlite` 连接（`database` 即文件路径）、执行 SQL、左树列表。上一功能（`2026-10-09-navicat-sqlite-file-picker-design.md`）已支持在连接对话框里用系统对话框选本机 SQLite 文件。

当前项目里点一个 `.db`/`.sqlite` 文件，会走 `App.vue` 的 `openFile(projectId, path)` → `center.openFile` → 打开 `FilePreview`，因是二进制只显示「二进制不支持」（`DocViewer` 的 `fp.binary_unsupported`），无法查看/查询库内容。

用户诉求：点 db 文件时**默认用内置 Navicat 工具打开**该 SQLite 文件（浏览表、跑 SQL），按文件绝对路径自动新建/复用一条 SQLite 连接。

## 目标

- 项目文件（目录树 / 历史 / 文件搜索 / `?open=` 深链）被点击时，若判定为 SQLite 数据库，则打开内置 Navicat 工具页签并选中对应连接，而非二进制文件视图。
- 判定规则：扩展名 `.db/.sqlite/.sqlite3/.db3` **或** 文件内容以 `SQLite format 3\0` 开头。
- 连接按文件**绝对路径**去重复用：已存在（`type==='sqlite'` 且 `database===abs`）则选中；否则新建一条（名字用文件名，重名追加 ` (2)`…）并选中。
- 全量中英 i18n（本功能基本无新增用户文案，按需）。

## 非目标（YAGNI）

- 不改本地拖入文件（`useLocalSources`）、项目外文件、`onDetailFile`（详情弹窗）的打开路径。
- 不改 `FilePreview`/`DocViewer` 对非 db 文件的行为（非 db 二进制仍显示「二进制不支持」）。
- 不改 Navicat 连接对话框、执行、导出、连接串等既有逻辑。
- 不做「手动扩展名关联表」配置。

## 设计

### 一、判定：扩展名 + 内容头

- 纯函数 `web/src/tools/navicat/sqliteFile.ts`：
  - `isDbExt(name: string): boolean` — 名字（可含扩展名）小写后以 `.db/.sqlite/.sqlite3/.db3` 结尾。
  - `uniqueConnName(base: string, existing: string[]): string` — `base` 未占用则原样；否则追加 ` (2)`、` (3)`… 直到不冲突。
- 内容头：服务端在 `meta` 里给出 `sqlite` 布尔（见下）。

### 二、服务端：`meta` 增加 `sqlite` 字段（`server/projects.js`）

新增内部辅助：

```js
function isSqliteFile(abs, size) {
  if (!size || size < 16) return false;
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(abs, 'r');
  try { fs.readSync(fd, buf, 0, 16, 0); } finally { fs.closeSync(fd); }
  return buf.toString('latin1') === 'SQLite format 3\u0000';
}
```

`meta(projectId, rel)` 返回对象追加：`if (!isDir) out.sqlite = isSqliteFile(abs, st.size);`。目录不带该字段。
`/api/file/meta`（`server/http-api.js`）无需改动，透传即可。

### 三、前端：拦截打开（`web/src/App.vue`）

`openFile` 改为 async，先探测再决定：

```js
async function openFile(projectId, path) {
  const q = path.replace(/\\/g, '/');
  const i = q.lastIndexOf('/');
  const name = i >= 0 ? q.slice(i + 1) : q;
  try {
    const meta = await projectsApi.fileMeta(projectId, path);
    if (isDbExt(name) || meta.sqlite) {
      await openSqliteInNavicat(meta.abs || '', name);
      return;
    }
  } catch { /* 探测失败：按普通文件打开 */ }
  pushFileHistory(projectId, q);
  center.openFile(projectId, path, name);
}

async function openSqliteInNavicat(abs: string, name: string) {
  if (!abs) return;
  await useNavicatWorkbench().openSqliteFile(abs, name);
  rail.value = 'explorer';
  center.openTool('navicat');
}
```

要点：
- 复用 `projectsApi.fileMeta` 拿 `abs`；`openFile` 变 async，调用方（`onOpenFileAt`、`processOpenParam` 等）不 await 亦无碍。
- `center.openTool('navicat')` 会激活工具页签，`ToolSidebar` 据 `activeTool` 在左栏渲染 Navicat 连接树（`App.vue:795`），主区渲染 `NavicatTool`（`TerminalView.vue:1429`）。
- db 文件不再进 `center.openFile` 的文件页签，也不写文件历史。

### 四、Navicat 工作台：`openSqliteFile`（`web/src/tools/navicat/useNavicatWorkbench.ts`）

接口新增 `openSqliteFile(abs: string, name: string): Promise<void>`：

```ts
async function openSqliteFile(abs: string, name: string) {
  await nav.load();
  const ex = nav.profiles.value.find((p) => p.type === 'sqlite' && p.database === abs);
  if (ex) { selectConn(ex); return; }
  const names = nav.profiles.value.map((p) => p.name);
  const saved = await nav.save({ name: uniqueConnName(name || t('nv.file_conn'), names), type: 'sqlite', host: '', port: '', user: '', database: abs, password: '' });
  selectConn(saved);
}
```

- 需要把 `selectConn` 已在工作台内部（`useNavicatWorkbench.ts:70`），直接复用。
- `nav.save` 会内部 `load()` 刷新，随后 `selectConn(saved)` 设 `activeId`，`activeFolder` 可选设 `c:<id>` 让左树高亮。
- 若 Navicat 工具尚未挂载，模块级单例仍可创建连接；挂载后 `NavicatTool` 的 `onMounted load()` 会用服务端列表覆盖，`activeId` 保持不变。

### 五、i18n（中英同步）

- 新增兜底名 `nv.file_conn`（当文件名取不到时用）：中文「数据库文件」/ 英文「Database file」。
- 其余无新增文案。

## 影响文件

- 新增 `web/src/tools/navicat/sqliteFile.ts`（纯函数）+ `sqliteFile.test.ts`
- 改 `server/projects.js`（`meta` 增 `sqlite`）
- 改 `server/test/projects.test.js` 或 `server/test/http-api.test.js`（`meta.sqlite`）
- 改 `web/src/App.vue`（`openFile` 拦截 + `openSqliteInNavicat`）
- 改 `web/src/tools/navicat/useNavicatWorkbench.ts`（`openSqliteFile`）
- 改 `web/src/tools/navicat/useNavicatWorkbench.test.ts`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`（`nv.file_conn`）

## 测试计划

- `server`：`projects.meta`（或经 `/api/file/meta`）——16 字节魔数文件 `sqlite:true`；普通文本 `sqlite:false`；目录无 `sqlite` 字段；小于 16 字节文件 `sqlite:false`。
- `web`：`sqliteFile.test.ts` —— `isDbExt` 各扩展名与大小写；`uniqueConnName` 无冲突/多冲突。
- `web`：`useNavicatWorkbench.test.ts` —— `openSqliteFile` 新建（POST 且 body.type=sqlite、database=abs）、复用（同 abs 不新增）、重名追加后缀。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
- 手工：项目里点 `.db` → 左栏出现/选中该连接、主区 Navicat 可列表明表并跑 SQL；点普通文本文件仍打开文件页签。
