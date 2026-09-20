# Navicat 连接选择改下拉框设计

## 背景

现有 Navicat 小工具（`web/src/tools/navicat/`）是「左栏连接列表 + 右主区表单/执行」布局：`NavicatList.vue` 负责扁平列表、搜索、新建、悬停重命名/删除；`NavicatTool.vue` 负责连接表单、SQL 编辑与结果展示。选中列表项后右侧 form 会被填充，但密码字段留空，需点 👁（`doReveal`）才显示。

问题：左栏占宽度，且选中连接后无法直接看到已保存的密码等完整信息。改为顶部下拉框选连接，去掉左栏。

## 目标

- 去掉左侧连接列表，改为顶部一个连接下拉框（可搜索）+ 末尾「＋ 新建连接」项。
- 选中已有连接 = 编辑态：右侧表单完整填充该连接信息，**包含已保存的密码**（自动 `reveal` 填入）。
- 点「＋ 新建连接」= 新建态：表单清空；此时下拉框切换为「选择模板（可选）」，可再选一个已有连接把字段填进新表单（不带 id，保存为新增）。
- 重命名、删除移到顶部工具条（作用于当前选中连接）。
- 后端与 HTTP 接口零改动；全量中英 i18n。

## 非目标（YAGNI）

- 不改动后端 `navicat-mount.js` / `navicat-store.js` / `navicat-exec.js` 及任何 `/api/navicat/*` 接口。
- 不做多选、批量、拖拽、分组。
- 不做连接下拉的历史/最近使用排序。

## 设计

### 一、布局（`NavicatTool.vue`）

- 移除模板里的 `<NavicatList ...>` 与 `import NavicatList`；`.nvbody` 从「左栏 + 主区」两列改为单列主区。
- 新增顶部工具条 `.nvtop`，含：
  - `el-select`（`filterable` 可搜索，`clearable`）：选项 = 所有已保存连接（label 显示 `name` + 类型徽标；value = 连接 id），末尾固定一项「＋ 新建连接」（value 为特殊常量 `NEW_SENTINEL`，如 `__new__`）。
  - 「重命名」「删除」按钮：仅当当前为编辑态（选中了已保存连接）时显示，逻辑复用现有 `onRename` / `onRemove`。
- 主区表单、SQL `<textarea>`、结果区结构不变。

### 二、状态与交互

- 新增 `mode: Ref<'edit' | 'new'>` 与 `selectedId: Ref<string>`。
- **编辑态**：
  - `el-select` 绑定 `selectedId`；选中某连接 → `selectProfile(id)`：填表单并 `await reveal(id)` 把明文密码写入 `form.password`。
  - 密码用 `el-input type="password" show-password` 展示（默认为掩码、可一键切换明文）；移除原 `.nv-reveal` 👁 按钮与 `doReveal` 的单独入口。
- **新建态**：
  - 选「＋ 新建连接」（或 `selectedId` 清空）→ `newProfile()`：`form = blank()`、`selectedId = ''`、`mode = 'new'`。
  - 新建态下 `el-select` 占位改为 `nv.template_ph`，其选项仍是已保存连接；选中一个 → 把其 `type/host/port/user/database/password`（密码来自 `reveal`）填入 `form`，**不复制 id 与 name**（name 保持空白、由用户填写，避免重名），填充后 `selectedId` 立即清回 `''` 以便再次选模板或保持新建态。
  - `mode` 仍为 `'new'`，保存走 POST。
- **保存（`doSave`）**：
  - 依据 `form.id` 是否存在决定 PATCH / POST（沿用现状）。
  - 保存成功后：`form.id = saved.id`、`hasPassword = saved.hasPassword`、清空 `form.password`，`selectedId = saved.id`、`mode = 'edit'`（下拉切回选中新连接）。
- **重命名 / 删除**：复用现有 `onRename(id)` / `onRemove(id)`，作用于 `selectedId`；删除后调用 `newProfile()` 回到新建态。
- **`selectProfile` / `newProfile` / `onTypeChange` / `doExec` / `doTest` / `copyConn` / `doExport` / `exportCsv`** 主体逻辑不变，仅调整密码填充与选中态联动。

### 三、常量与类型

- `const NEW_SENTINEL = '__new__'`（仅前端内部使用，不下发后端）。
- 下拉选项由 `profiles` 计算得到；类型徽标复用现有样式类（原 `.nv-badge`，从 `NavicatList.vue` 迁入 `NavicatTool.vue`）。

### 四、删除文件

- 删除 `web/src/tools/navicat/NavicatList.vue`（唯一引用在 `NavicatTool.vue`，已移除）。
- 删除 `web/src/tools/navicat/NavicatList.test.ts`。
- 其需要的样式（徽标、按钮）迁入 `NavicatTool.vue` 的 `<style scoped>`。

### 五、i18n

新增键（中英同步）：

- `nv.select_ph`：选择连接 / Select connection。
- `nv.template_ph`：选择模板（可选）/ Pick a template (optional)。

复用：`nv.new`、`nv.empty`（下拉无连接时占位）、`nv.rename`、`nv.delete`、`nv.search_ph`（如沿用可搜索提示）。

## 影响文件

- 改 `web/src/tools/navicat/NavicatTool.vue`
- 改 `web/src/tools/navicat/NavicatTool.test.ts`
- 删 `web/src/tools/navicat/NavicatList.vue`、`web/src/tools/navicat/NavicatList.test.ts`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- 后端无改动

## 测试计划

- `NavicatTool.test.ts`：
  - 加载后下拉包含已保存连接选项；选中后表单被填充（name 等）。
  - 选中已保存连接会调用 `/api/navicat/reveal` 并把密码填入 password 输入框。
  - 选「＋ 新建连接」清空表单；进入模板态再选一个已有连接 → 字段被填入且保存走 POST（发出 POST 请求）。
  - 编辑态保存走 PATCH。
  - 现有执行/写确认/结果渲染用例改为通过下拉选中连接后触发，断言保持不变。
  - 重命名/删除按钮仅在编辑态出现。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 后续（本轮不做）

- 下拉最近使用排序、连接收藏。
- 密码默认明文显示可配置。
