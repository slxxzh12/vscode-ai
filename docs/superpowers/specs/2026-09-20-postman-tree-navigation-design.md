# Postman 左侧目录树导航设计

## 背景

小工具 Postman（后端起于 `server/postman-history.js`，界面在 `web/src/components/MiniTools.vue`）当前左侧是一棵**始终全展开的平铺树**：`MiniTools.vue` 的 `treeRows` 计算属性把文件夹与记录混排进同一个 `<ul>`，仅靠 `paddingLeft: depth * 12px` 体现层级；「新建」只有顶部一个输入框，且固定建在当前选中目录下。

实际使用中暴露四个问题：

1. 没有展开/折叠，文件夹一多全部铺开，看不出层级。
2. 新建入口不对：只能顶部输入框、固定建在当前目录，无法针对某个文件夹就地新建。
3. 同一文件夹的记录被排到其子目录之后，目录结构不清晰。
4. 没有重命名、没有右键菜单，只能建和删。

## 目标

把左侧改造成真正的文件管理器式目录树导航：

- 文件夹可展开/折叠，默认全展开，展开状态持久化。
- 支持就地新建子文件夹（针对任意文件夹及根）。
- 每个文件夹内先排子文件夹（递归），再排本文件夹记录。
- 文件夹与记录都支持重命名；操作入口为「右键菜单 + 悬停图标」并存。
- 单击选中、双击文件夹标题切换展开/折叠。

## 非目标

- 不做文件夹拖拽移动（记录拖拽移动保留现状）。
- 不做通用可复用 FileTree 组件（当前仅 Postman 使用，YAGNI）。
- 不改 curl 执行、去重（按 curl 原文 sha256）与响应展示逻辑。
- 不改记录落盘根目录（仍为 `<端口数据目录>/tools/postman/`）。

## 设计

### 一、后端 `server/postman-history.js`

沿用现有 `normalizeRel` / `SEG` / `isRecordName` 校验。新增：

- `renameFolder(rel, name)`：校验 `rel` 非空且存在、`name` 通过 `SEG`；新路径 = `parent/newName`（`parent` 为原路径父级）；`newRel === rel` 直接返回 `rel`；目标已存在抛 `code='exists'`；`fs.renameSync` 后返回新路径。
- `setRecordTitle(id, title)`：解析记录路径；读 JSON；`title` 去空白后非空则写入 `title` 字段，否则删除该字段；写回；返回布尔。

`record()` 增加**保留标题**：同 curl 覆盖写前，若旧文件已有 `title`，沿用旧标题，避免重跑丢标题。`list()` 继续用 `...rec` 展开，天然带出 `title`。

### 二、HTTP 端点 `server/http-api.js`

复用现有资源路径，新增 PATCH：

- `PATCH /api/postman/folder` body `{ path, name }` → 200 `{ ok, path }`；失败 400 `{ error }`（`exists` / `bad-path` / `not-found`）。
- `PATCH /api/postman/history` body `{ id, title }` → 200 `{ ok }`；失败 404 `{ error }`。

现有 `POST/DELETE /api/postman/folder`、`DELETE /api/postman/history`、`POST /api/postman/move` 保持不变。

### 三、前端结构：拆出 `web/src/tools/postman/`

按 AGENTS.md「独立功能独立目录、变大先拆」，把 Postman 从 `MiniTools.vue` 拆出，三个职责单一的文件：

- `usePostmanHistory.ts` — 数据/请求层：`history`、`folders` 状态，`load()`、`createFolder()`、`renameFolder()`、`renameRecord()`、`removeFolder()`、`removeRecord()`、`moveRecord()`、`runCurl()`。
- `PostmanTree.vue` — 递归树渲染与交互（展开折叠、选中、就地新建/重命名、悬停图标、右键菜单、拖拽落点），事件上抛父组件。
- `PostmanTool.vue` — 布局：左 `PostmanTree` + 右 curl 编辑器/响应区；持有 `usePostmanHistory`。

`MiniTools.vue` 只保留工具切换：`open === 'postman'` 时渲染 `<PostmanTool />`，删除其内联的 postman 模板/样式/逻辑。

### 四、树交互

- 文件夹行含 ▸/▾ 箭头切换展开/折叠；**单击=选中**（作为 curl 保存目标，对应现有 `activeFolder`），**双击标题=切换展开/折叠**；箭头点击同样切换。
- 记录单击选中（对应现有 `activeId`）。
- 展开状态存 localStorage 键 `devflow-postman-collapsed`，保存**折叠**集合（`string[]`）；缺省/为空 = 全展开 → 满足「默认全展开 + 刷新保持」。刷新时过滤已不存在的路径。
- 排序：每个文件夹内先子文件夹（字母序，递归展开子树），再本文件夹记录（`updatedAt` 倒序）；记录仅在所属文件夹展开时渲染。
- 记录显示名 `title || command`。
- 新建文件夹：触发后在该目标文件夹（或根）下插入一行临时输入框，Enter 提交、Esc 取消。
- 重命名：该行标题变为输入框，Enter 提交、Esc 取消；冲突（后端 400 `exists`）时提示并保持编辑态。
- 右键菜单 + 悬停图标并存：
  - 文件夹行：`＋ 新建子文件夹` / `✎ 重命名` / `× 删除`
  - 记录行：`✎ 重命名` / `× 删除`
  - 点击空白或 Esc 关闭菜单。
- 保留拖拽：把记录拖进文件夹/根即移动（调现有 `/api/postman/move`）。

### 五、i18n

`shared/i18n/zh-CN.js` 与 `en.js` 同步补齐（键集合对称）：

| key | zh-CN | en |
| --- | --- | --- |
| `tools.pm_new_folder` | 新建文件夹 | New Folder |
| `tools.pm_new_subfolder` | 新建子文件夹 | New Subfolder |
| `tools.pm_rename` | 重命名 | Rename |
| `tools.pm_rename_ph` | 名称 | Name |
| `tools.pm_cancel` | 取消 | Cancel |
| `tools.pm_exists` | 同名文件夹已存在 | A folder with that name already exists |
| `tools.pm_rename_failed` | 重命名失败 | Rename failed |

### 六、边界处理

- 重命名撞名 → 显示 `tools.pm_exists`，输入框保留。
- 删除当前选中文件夹 → 选中回退到根（清空 `activeFolder`）。
- 空标题提交 → 清除 `title`，回退显示 `command`。
- `load()` 失败不阻断执行（沿用现状）。
- 非法名（含 `/ \ .. .` 等）由 `SEG` 拦截，前端提示 `rename_failed`。

## 涉及文件

- `server/postman-history.js`：`renameFolder`、`setRecordTitle`、`record` 保留标题。
- `server/http-api.js`：两个 PATCH 端点。
- `web/src/tools/postman/usePostmanHistory.ts`、`PostmanTree.vue`、`PostmanTool.vue`：新增。
- `web/src/components/MiniTools.vue`：改为挂载 `PostmanTool`，移除内联 postman 部分。
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js`：新增词条。
- `AGENTS.md`「目录速览」：补一行 `web/src/tools/postman/` 说明。

## 测试

- `server/test/postman-history.test.js`：`renameFolder`（成功 / 重名 / 非法名 / 不存在）、`setRecordTitle`（设置 / 清空 / 重跑保留）。
- `server/test/http-api.test.js`：两个 PATCH 端点（成功与错误码）。
- `web/src/components/MiniTools.test.ts`：调整现有 postman 用例为断言渲染 `PostmanTool`。
- `web/src/tools/postman/PostmanTree.test.ts`：展开折叠、默认全展开、就地新建/重命名触发的事件。
- `web/src/tools/postman/usePostmanHistory.test.ts`：请求路径/方法/请求体正确。
- 全量校验：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
