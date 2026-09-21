# 记事本补齐 Base64 / 压缩 / 格式化，并合并 JS 小工具实现计划

关联设计：`docs/superpowers/specs/2026-09-21-notepad-base64-format-merge-design.md`

执行方式：inline（本会话内执行）。

## 步骤

1. **`web/src/base64.ts`（新增）**
   - `encodeB64` / `decodeB64` / `copyText`。
   - 配 `web/src/base64.test.ts`（往返 + 非法输入 + 空串）。

2. **`web/src/components/Base64Panel.vue`（新增）**
   - 从 `FilePreview.vue` 迁入面板模板、状态、`.b64*` 样式；props `getText`，暴露 `refresh` / `reset`。
   - 配 `web/src/components/Base64Panel.test.ts`。

3. **`web/src/formatText.ts`（新增）**
   - `PARSER_BY_EXT` / `canFormatExt` / `formatText`（Prettier 懒加载）。
   - 配 `web/src/formatText.test.ts`。

4. **改 `web/src/components/FilePreview.vue`**
   - 用 `Base64Panel` 替换本地 b64；`refreshB64Encode`/`resetB64Panel` 调用点改为面板方法。
   - `formatDoc` 改用 `formatText`；`minifyOneLine` 保持不变（复用 `format` provider）。

5. **改 `web/src/tools/notepad/NotepadTool.vue`**
   - `@ready` 记录 editor view；`currentText()`。
   - 顶栏加「⇆ Base64」「⇣ 压缩」「格式化」；`canMinify` / `canFormat` / `busy`。
   - 压缩走 `minify` provider，格式化走 `formatText`，结果写回 `content`（自动保存）。
   - 扩展 `NotepadTool.test.ts`。

6. **移除 JS 磁贴**
   - `catalog.ts`（`ToolId`、`MINI_TOOLS`）、`MiniTools.vue`、`TextToolBody.vue`。
   - `useToolFiles.FileTool` 保留 `'js'`。

7. **i18n（`shared/i18n/zh-CN.js` / `en.js`）**
   - 增：`np.b64`、`np.minify`、`np.minifying`、`np.format`、`np.minified`、`np.minify_failed`、`np.formatted`、`np.format_optimal`、`np.format_failed`。
   - 删：`tools.js`、`tools.js_min`、`tools.desc.js`。
   - 改：`tools.desc.notepad`。

8. **文档**
   - 更新 `AGENTS.md` 目录速览（Base64Panel / base64.ts / formatText.ts）。

9. **验证**
   - `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 验收

- 记事本能对打开文件做 Base64 编解码（有选区用选区）。
- 记事本能对 js/json 压缩、对受支持后缀格式化，结果自动保存。
- 小工具列表不再有「JS」磁贴；`yaml` / `translate` / `postman` / `navicat` 不受影响。
- `FilePreview` 的 Base64 与格式化行为不变。
