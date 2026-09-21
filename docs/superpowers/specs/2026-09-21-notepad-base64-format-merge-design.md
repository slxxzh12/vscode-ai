# 记事本补齐 Base64 / 压缩 / 格式化，并合并 JS 小工具设计

## 背景

`FilePreview.vue` 顶栏有「🧰 小工具」收纳菜单，其中包含 Base64 编解码面板（`b64Open`，`FilePreview.vue:489`），以及「压成一行」（`minifyOneLine`，`FilePreview.vue:273`）、「格式化」（`formatDoc`，`FilePreview.vue:634`）。

记事本（`web/src/tools/notepad/NotepadTool.vue`）目前顶栏只有保存、排序、去重三类按钮，缺少 Base64、压缩、格式化。

另有一个独立的「JS」小工具磁贴（`web/src/tools/catalog.ts:18` → `TextToolBody.vue` 的 `tool === 'js'` 分支），其唯一职能是「JS 代码压缩」（`POST /api/format`，`server/http-api.js:248`）。它与记事本高度重合，属于同类文本处理入口，应合并进记事本，避免磁贴冗余。

## 目标

- 记事本新增 Base64 编解码面板，能力与 `FilePreview` 完全一致。
- 记事本新增「压缩」「格式化」按钮，按当前打开文件的后缀自动启用/禁用：
  - 压缩：`js` / `mjs` / `cjs` / `jsx` / `json` → `POST /api/format`（带当前文件名）。
  - 格式化：Prettier 支持的后缀 → `PARSER_BY_EXT`（js/ts/json/css/html/md/yaml 等）。
- 移除「JS」小工具磁贴；其能力并入记事本。
- Base64 与格式化的实现抽成共享模块/组件，`FilePreview` 与记事本共用，避免逻辑与样式分叉。

## 非目标

- 不改服务端 `/api/format`、`/api/files/js/*` 路由；`js` 数据目录保留，已有文件不迁移。
- 不改 `FilePreview` 的「🧰 小工具」菜单形态（仍为下拉收纳菜单）。
- 不给记事本加「文本对比 / 运行脚本 / curl」等 `FilePreview` 专属能力。
- 压缩/格式化作用于整篇内容，不针对选区。

## 设计

### 一、共享 Base64 逻辑（`web/src/base64.ts`，新增）

从 `FilePreview.vue:495-538` 抽出纯函数：

- `encodeB64(src: string): string` = `btoa(unescape(encodeURIComponent(src)))`。
- `decodeB64(src: string): string` = `decodeURIComponent(escape(atob(src.trim())))`，非法输入抛错。

复制复用既有 `web/src/clipboard.ts` 的 `copyText`（已含 `navigator.clipboard` → `execCommand` 降级），不再新增复制函数。

### 二、共享 Base64 面板（`web/src/components/Base64Panel.vue`，新增）

把 `FilePreview.vue:765-788` 的面板与 `.b64*` 样式（`FilePreview.vue:971-981`）原样迁入组件：

- Props：`getText: () => string`（返回需要编码的文本；父组件负责「有选区取选区、否则整篇」）。
- 内部状态：`encodeOut` / `decodeInput` / `decodeOut` / `decodeErr`。
- 暴露方法：`refresh()`（重算编码输出，父组件在编辑器内容/选区变化时调用）、`reset()`（清空并关闭态）。
- 模板：左栏「Base64 编码（实时）」+ 复制；右栏「Base64 解码」+ `编码结果→解码` / 复制 / 清空，输入用 `CodeEditor`，下方展示解码结果或 `fp.b64_invalid` 错误。
- 复用现有词条：`fp.b64.encode` / `fp.b64.decode` / `fp.b64.encode_to_decode` / `fp.b64.clear` / `fp.b64.placeholder` / `fp.b64_invalid` / `common.copy`。

`FilePreview.vue` 改为：`b64Open` 为真时渲染 `<Base64Panel ref="b64Panel" :get-text="currentText" />`；`docChanged()` 与选区变化处由 `refreshB64Encode()` 改为 `b64Panel?.refresh()`；`resetB64Panel()` 改为 `b64Panel?.reset()` + `b64Open = false`；删除本地 `encodeB64`/`decodeB64`/`fallbackCopy`/`b64Copy`/`refreshB64Encode`/`refreshB64Decode`/`feedDecodeFromEncode`/`toggleB64` 与相关模板、CSS。

### 三、共享格式化（`web/src/formatText.ts`，新增）

从 `FilePreview.vue:627-664` 抽出：

- `PARSER_BY_EXT: Record<string, string>`（后缀 → Prettier parser）。
- `canFormatExt(ext: string): boolean`。
- `formatText(text: string, ext: string): Promise<string>`：按需 `import('prettier/standalone')` 与各 plugin，返回格式化结果。

`FilePreview.formatDoc()` 改为调用 `formatText`，仅保留「取编辑器文本 → 调用 → 必要时 dispatch 回编辑器 → 反馈」的外壳。记事本复用同一函数。

### 四、记事本（`web/src/tools/notepad/NotepadTool.vue`）

- 记录 `CodeEditor` 的 editor view：`@ready="view = $event"`；`currentText()` = 有选区取选区、否则 `content.value`。
- 顶栏新增按钮（沿用 `.npbtn` 样式、`:disabled="!activeId"`）：
  - `⇆ Base64`：切换 `b64Open`；面板渲染在编辑器下方，`:get-text="currentText"`。编辑器内容/选区变化时调用面板的 `refresh()`。
  - `⇣ 压缩`：`canMinify`（后缀命中 js/mjs/cjs/jsx/json 且 `activeId` 存在）时可用；`busy` 中显示 `np.minifying`。
  - `格式化`：`canFormatExt(ext)` 且 `activeId` 存在时可用。
- 压缩：`minify(name, content)`（`useProjects`）→ 写回 `content.value`（触发 1 秒防抖自动保存），失败走 `msg`。
- 格式化：`formatText(content.value, ext)` → 写回 `content.value`，失败走 `msg`。
- `ext` 由活动文件名（`activeId` 末段）推导，小写。

### 五、移除 JS 磁贴

- `web/src/tools/catalog.ts`：`ToolId` 去掉 `'js'`；`MINI_TOOLS` 删掉 `{ id: 'js', ... }`。
- `web/src/components/MiniTools.vue`：`textTool` 联合类型与 v-if 去掉 `'js'`。
- `web/src/tools/text/TextToolBody.vue`：`TextTool` 去掉 `'js'`；删 `EXT`/`LABEL`/`LANG` 的 `js` 项、`runJs()`、`tool === 'js'` 模板块；未使用的 `fetch('/api/format')` 分支一并移除。
- `web/src/tools/files/useToolFiles.ts` 的 `FileTool` **保留** `'js'`（后端目录与既有数据保留，测试引用不变）。

### 六、i18n

- 新增（中英对称）：`np.b64`、`np.minify`、`np.minifying`、`np.format`。
  - zh：`⇆ Base64 编解码`、`⇣ 压缩`、`压缩中…`、`格式化`。
  - en：`⇆ Base64`、`⇣ Minify`、`Minifying…`、`Format`。
- 新增反馈词条：`np.minified`、`np.minify_failed`、`np.formatted`、`np.format_failed`、`np.format_optimal`。
- 删除（中英同步）：`tools.js`、`tools.js_min`、`tools.desc.js`。
- 更新 `tools.desc.notepad` 文案以覆盖新能力（中英同步）。

## 影响文件

- 新增 `web/src/base64.ts`、`web/src/base64.test.ts`
- 新增 `web/src/formatText.ts`、`web/src/formatText.test.ts`
- 新增 `web/src/components/Base64Panel.vue`、`web/src/components/Base64Panel.test.ts`
- 改 `web/src/components/FilePreview.vue`
- 改 `web/src/tools/notepad/NotepadTool.vue`、`NotepadTool.test.ts`
- 改 `web/src/tools/catalog.ts`、`web/src/components/MiniTools.vue`、`web/src/tools/text/TextToolBody.vue`
- 改 `shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- 改 `AGENTS.md`（目录速览）

## 测试计划

- `base64.test.ts`：ASCII/中文/emoji 往返；非法输入 `decodeB64` 抛错；`encodeB64('') === ''`。
- `Base64Panel.test.ts`：`getText` 供值即出编码结果；解码框输入合法/非法分别出结果/错误；`refresh()` 随 `getText` 变化更新。
- `formatText.test.ts`：`canFormatExt` 命中/未命中；`formatText` 对一段 JSON 输出更规范（或至少可解析）。
- `NotepadTool.test.ts`：保留排序用例；新增——打开 `.json` 后「压缩」按钮可用且点击后内容变为单行；打开 `.txt` 时压缩/格式化按钮禁用；Base64 按钮切换面板。
- `FilePreview` 无既有测试，改动后靠 `npm.cmd run typecheck` + `npm.cmd test`（web 全量）兜底。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 后续（本轮不做）

- 记事本内联的「文本对比 / 运行脚本 / curl」等 `FilePreview` 能力。
- 压缩/格式化按选区作用。
- 压缩/格式化结果与原始内容的一键回退（撤销依赖编辑器自身 undo）。
