# 文档型工具主区双击新建文件 — 设计

## 1. 背景与目标

小工具（notepad / yaml / markdown）的主内容区在未打开文件时只显示一行「未选择文件」。
当前新建文件必须点工具栏 `📄＋` 或右键文件夹 → 新建文件，并弹输入框填名字，步骤偏多。

目标：**在空状态下双击主内容区，直接在该工具当前目录旁新建并打开一个文件**，无需弹窗。

## 2. 范围

- 适用工具：`notepad`、`yaml`、`markdown`（三者共用 `web/src/tools/doc/ToolDocPane.vue` 空状态面板）。
- 不在范围：postman / navicat / translate / base64 的交互；左侧文件树自身的双击行为。

## 3. 行为

1. 主区处于「未选择文件」空状态时（`ToolWorkbench.activeId` 为空），**双击空状态区域**触发新建。
2. 新文件创建位置 = 该工具**当前选中目录** `activeFolder`（左侧树高亮的目录）；未选中时 = 根目录。
3. 命名 = `YYYYMMDD-HHMMSS` + 工具默认扩展名（复用现有 `toolFileTreeSource.defaultName()` 规则），**不弹输入框**。
4. 创建成功后立即将该文件设为当前活动文件并打开（进入编辑器）。
5. 主区已打开文件时，双击编辑器内文本仍是正常选词，**不触发新建**。

## 4. 命名与扩展名

- 扩展名集中在 `web/src/tools/useToolWorkbench.ts` 的 `DEFAULT_EXT` 定义：
  - `notepad → .txt`
  - `yaml → .yaml`
  - `markdown → .md`（已有）
- 名称复用 `toolFileTreeSource.ts` 的 `defaultName()`（`YYYYMMDD-HHMMSS` + 扩展名）。
- 附带影响（属改进）：`📄＋` 弹窗的默认文件名在 notepad / yaml 下由「空」变为上述自动名。

## 5. 改动

### 5.1 `web/src/tools/useToolWorkbench.ts`
- `DEFAULT_EXT` 增补 `notepad: '.txt'`、`yaml: '.yaml'`。
- `ToolWorkbench` 接口新增 `newFile(): Promise<void>`。
- 实现 `newFile()`：
  1. 取默认名（`treeSource.defaultName?.()`，带扩展名，恒非空）；
  2. `const id = await files.createFile(activeFolder.value, name)`；
  3. `activeId.value = id`；
  4. `window.dispatchEvent(new CustomEvent('df-refresh-tree'))` 刷新左侧树；
  5. 失败时 `alert(t('tree.create_failed', { msg }))`，不崩溃。

### 5.2 `web/src/tools/doc/ToolDocPane.vue`
- 空状态 `div.tdp-empty` 挂 `@dblclick="wb.newFile()"`，并加一行提示文案
  （`files.no_file` + 新增 `files.dblclick_new`）。

### 5.3 i18n（`shared/i18n/zh-CN.js` + `shared/i18n/en.js`）
- 新增键 `files.dblclick_new`，中/英对称：
  - zh-CN：`双击此处新建文件`
  - en：`Double-click to create a file`

### 5.4 测试
- `web/src/tools/useToolWorkbench.test.ts`：补 `newFile()` 用例 —— 断言发出
  `POST /api/files/<tool>/file`、body 的 `folder` 为当前 `activeFolder`、`name` 符合
  `YYYYMMDD-HHMMSS<ext>`、`activeId` 更新为返回 id。
- 新增 `web/src/tools/doc/ToolDocPane.test.ts`：空状态双击调用一次 `newFile`；有文件时不触发。

## 6. 边界与错误处理

- **同名已存在**：同一秒内重复创建会命中 `notepad-store.js` 的 `exists` 错误
  （`server/notepad-store.js:97`）。首次创建成功后空状态即消失，正常不会连点；
  异常时捕获并 `alert(t('tree.create_failed'))`。
- 创建成功但文件为空：`DocViewer` 读取空内容正常，进入可编辑状态。
- 左侧树刷新沿用现有 `df-refresh-tree` 事件（与 `App.vue` 添加目录后刷新同款）。

## 7. 验收

- 手动：notepad 选中某文件夹 → 双击主区空白 → 左侧树出现 `YYYYMMDD-HHMMSS.txt`
  且主区已打开该文件。
- 有文件打开时双击编辑器 = 选词，不新建。
- yaml / markdown 行为一致，扩展名分别为 `.yaml` / `.md`。
- `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 通过。
