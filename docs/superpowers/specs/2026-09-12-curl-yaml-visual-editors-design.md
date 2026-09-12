# 设计文档：cURL Postman 式编辑器 + YAML 可视化节点编辑

日期：2026-09-12
分支：master
状态：待评审（已与用户确认总体方案 B、浏览器 fetch、保留注释）

## 1. 概述

在左侧文件树中打开文件后，为两类结构化文本提供专用编辑视图：

1. **cURL**：把文件里的 `curl` 命令集合渲染成 Postman 式的「请求列表 + 请求表单」界面，
   可在浏览器里编辑并发送；表单与文件文本**双向同步**（表单改动写回为 `curl` 命令并自动保存）。
2. **YAML**：为 `.yml/.yaml` 文件提供「可视化 | 代码」双模式，可视化模式用**节点树**编辑
   （对标 `WorkflowEditor` 的卡片式结构化编辑），改动序列化写回文件，**保留注释与键顺序**。

两类文件均在文件树/编辑器中拥有类型识别与图标；所有新增用户可见文案走 i18n（zh-CN + en）。

## 2. 现状与扩展点

- 文件树：`web/src/components/FileTree.vue` → `web/src/components/TreeNode.vue` 点击发
  `open-file(path, name)`；`web/src/App.vue` 用 `web/src/components/FilePreview.vue` 承载打开的文件。
- `FilePreview.vue`（1166 行）：已有 `kind`(image/pdf/text)、`viewMode`(`preview`/`code`) 双模式
  （md/html 使用），CodeMirror 编辑器 + 10s 防抖自动保存（`write()`，`FilePreview.vue:167-202`）。
- 现有 curl：`web/src/curl.ts` 的 `parseCurl()` 只解析**第一条** curl；`FilePreview.vue:698-748`
  有一个弹出面板（方法/URL/headers/body/发送），单向、不写回、不支持多请求。
- 现有结构化编辑范式：`web/src/components/WorkflowEditor.vue`（对象数组 ↔ 卡片表单 ↔ 保存），
  本设计沿用其“结构化表单写回配置”的交互与视觉风格。
- YAML 目前仅有 CodeMirror 语法高亮（`FilePreview.vue:82`），无解析/可视化；`yaml` 包目前只是传递依赖。

## 3. 总体方案

**方案 B（已选）**：`FilePreview.vue` 仅作宿主与视图切换；新功能拆成独立组件 + 纯逻辑模块，
沿用仓库既有「纯逻辑 `.ts` + 同名 `.test.ts`」模式（参考 `curl.ts`/`diff.ts`/`markdown.ts`）。

```
FileTree → App → FilePreview（宿主：加载文本、自动保存、模式切换）
                     ├─ viewMode='code'  → CodeMirror（保留）
                     ├─ viewMode='curl'  → CurlView.vue   （props.text / emit update:text）
                     └─ viewMode='visual'→ YamlView.vue   （props.text / emit update:text）
纯逻辑：web/src/curl.ts（扩展）、web/src/yaml.ts（新增）
```

数据流（单一事实源 = 文件文本，由 `FilePreview` 持有）：

```
FilePreview.load → text
  ├─ code 模式：CodeMirror doc 变更 → scheduleSave()
  ├─ curl 模式：CurlView 表单变更 → buildCurl → 替换文本区间 → emit update:text
  │              FilePreview 将新文本写回 CodeMirror doc → scheduleSave()
  └─ visual 模式：YamlView 节点变更 → Document API 改文档 → String(doc) → emit update:text
                 FilePreview 同上写回并保存
```

## 4. cURL 模块 `web/src/curl.ts`（扩展）

保留 `CurlRequest`、`parseCurl`。新增：

- `interface CurlEntry { request: CurlRequest; start: number; end: number; }`
  `start/end` 为该 curl 命令在源文本中的字符区间（供替换/定位）。
- `parseCurlCommands(text: string): CurlEntry[]`
  扫描所有 `curl`（词边界）命令；每条命令以「非续行换行」或下一条 `curl` 为结束；
  复用现有 `tokenize`/`stripQuotes`/`parseCurl` 逻辑，返回按出现顺序的条目。
- `buildCurl(request: CurlRequest): string`
  序列化为多行命令，续行用 `\`：
  ```
  curl -X POST 'https://host/path?q=1' \
    -H 'Content-Type: application/json' \
    -d '{"a":1}'
  ```
  单引号值内 `'` 用 `'\''` 转义；`-X` 始终输出（保证方法往返一致）。
- `replaceCurlCommand(text: string, entry: CurlEntry, request: CurlRequest): string`
  用 `buildCurl` 结果替换 `[start, end)` 区间，返回新文本。
- URL/Query 辅助：`splitUrl(url): { base: string; params: Array<{name,value}> }`、
  `joinUrl(base, params): string`（Postman 式查询参数表，可增删/启停）。
- 往返测试：`parseCurlCommands(text) → buildCurl → 再 parse` 得到等价请求；
  区间替换后其它命令与文本保持不变。

## 5. `CurlView.vue`

props：`{ projectId: string; path: string; text: string }`；emit：`(e:'update:text', text: string)`。
受控组件，不直接读写文件、不直接保存（保存仍由 `FilePreview` 负责）。

- **左列（请求集合）**：`parseCurlCommands(text)` 列表，标签 = `METHOD host/path`；点击选中；
  「＋ 新增请求」向文本末尾追加一条模板 `curl -X GET 'https://…'`；可删除当前请求（移除其区间）。
- **右列（请求表单）**：方法、URL、Query 参数表（name/value/启用/删除）、Headers 表、
  Body 文本域、发送按钮、响应区（状态码 + 响应头 + 正文，JSON 自动美化、超长截断）。
- **双向**：任何表单变更 → `replaceCurlCommand` 生成新文本 → `emit('update:text')`。
  组件内部以“最后一次自身发出的文本”为基准，避免父组件回流导致的光标/重解析抖动；
  父组件文本若与之不同（外部代码编辑）则重新解析。
- **发送**：浏览器 `fetch`（沿用现有逻辑）；CORS 失败时在响应区给出明确错误提示。
- **触发**：扩展名 `.http/.rest/.curl` 默认进入 curl 视图；其它含 ≥1 条 curl 的文本文件，
  🧰 菜单提供「cURL 编辑器」项切到 curl 视图（替换现有弹窗）。

## 6. YAML 纯逻辑 `web/src/yaml.ts`（新增）

依赖：在 `web/package.json` 显式加入 `"yaml": "^2.4.2"`（当前为传递依赖）。

- `parseYamlDoc(text): { doc: YAML.Document | null; error: string }`
  `YAML.parseDocument(text)`；解析失败返回 `doc=null` + 错误信息。
- `serializeYamlDoc(doc): string` = `String(doc)`（保留注释/键顺序/已支持的锚点引用）。
- **视图模型** `YamlNode`：`{ path: (string|number)[]; key: string; kind: 'map'|'seq'|'scalar';
  valueType: 'string'|'number'|'boolean'|'null'|'object'|'array'; children: YamlNode[] }`；
  `yamlTree(doc): YamlNode[]`（根为 map 或 seq 均支持；标量叶子可内联编辑）。
- **编辑操作**（全部基于 `Document` API，保证注释保留）：
  - `setScalar(doc, path, raw: string)`：按原类型写回（数字/布尔/null/字符串）。
  - `setKey(doc, parentPath, key)` / `renameKey`（删除旧键 + 新键赋值，保持顺序）。
  - `addKey(doc, mapPath, key, value)`、`deleteAt(doc, path)`、
    `addSeqItem(doc, seqPath)`、`moveAt(doc, parentPath, index, dir)`。
  - 路径统一为 `(string|number)[]`，用 `doc.setIn/deleteIn/addIn` 实现。
- 测试：解析、读树、增删改、数组增删/移动、序列化后**注释仍在**、键顺序不变、往返稳定。

## 7. `YamlView.vue`

props：`{ text: string }`；emit：`(e:'update:text', text: string)`。

- 树形节点 UI，视觉沿用 app 变量（`--bg*`/`--bd`/`--ac*`），卡片/缩进风格对标 `WorkflowEditor`：
  - map 节点：`key: value`，对象/数组可展开折叠；每行有「＋子项」「改名」「删除」。
  - seq 节点：带序号，支持「＋项」「上移/下移」「删除」。
  - scalar 叶子：内联输入，按 `valueType` 校验（数字/布尔用下拉或解析失败回退字符串）。
- 任意编辑 → 改 `Document` → `serializeYamlDoc` → `emit('update:text')`。
- 解析失败：显示错误条 + 提示切换到代码模式修复；不阻塞代码模式。
- 多文档（`---`）或含无法安全编辑的特性时，降级只读并提示切到代码模式（见第 10 节）。

## 8. `FilePreview.vue` 集成

- `viewMode` 扩展为 `'preview' | 'code' | 'visual' | 'curl'`。
- 类型判定：
  - `isYaml = ['yml','yaml'].includes(ext)` → 顶栏 seg：`可视化 | 代码`（默认 `code`，保持现状）。
  - `isCurlFile = ['http','rest','curl'].includes(ext)` → 顶栏 seg：`cURL | 代码`（默认 `curl`）。
  - 其它含 curl 的文本文件：🧰 菜单出现「cURL 编辑器」，点击切到 `curl`。
- 切换模式前 `flush()` 落盘，避免丢改动（沿用现有 `applyPreview` 思路）。
- 移除旧的 `curlpanel` 弹窗与其模板/状态，职责迁入 `CurlView.vue`（发送逻辑随之迁移）。
- 文件树图标：`TreeNode.vue` 增加 `yml/yaml`、`http/rest/curl` 的图标与类型识别。

## 9. i18n（中英对称，`shared/i18n/{zh-CN,en}.js`）

新增/复用键（示例，最终以实现为准，中英必须同时补齐）：

| key | zh-CN | en |
| --- | --- | --- |
| `fp.view.visual` | 可视化 | Visual |
| `fp.view.code` | 代码 | Code |
| `fp.curl.editor` | cURL 编辑器 | cURL editor |
| `fp.curl.add` | 新增请求 | Add request |
| `fp.curl.delete` | 删除请求 | Delete request |
| `fp.curl.query` | 查询参数 | Query |
| `fp.curl.response` | 响应 | Response |
| `fp.curl.no_command` | 未找到 curl 命令 | No curl command found |
| `fp.yaml.parse_error` | YAML 解析失败：{msg} | YAML parse error: {msg} |
| `fp.yaml.readonly` | 该 YAML 暂不支持可视化编辑，请用代码模式 | This YAML can't be edited visually, use code mode |

现有 `fp.curl.*`（method/headers/body/send/sending/close/url_required 等）尽量复用。
提交前跑 `npm run check:i18n`，`web/src` 用户可见范围内零中文命中（注释/日志/测试除外）。

## 10. 边界与取舍

- **cURL 发送受 CORS 限制**：浏览器 `fetch` 无法访问多数第三方接口；v1 不做服务端代理
  （服务端无鉴权，代理会引入 SSRF 风险）。若后续确需，再单开 spec 设计受控代理。
- **YAML 保注释**：依赖 `yaml` 的 `Document`/CST API；未改动的节点注释与键顺序保留。
  可视化树 v1 **不展示**注释（仅保留），后续可增强。
- **多文档 / 锚点别名**：`---` 多文档、复杂锚点/合并键等不做可视化编辑，降级只读并提示切代码模式；
  序列化仍由 `yaml` 保留，不做破坏性重写。
- **大文件**：仅文本、非二进制；超大文件（如 >1MB）可提示改用代码模式。
- **单一事实源**：文件文本始终由 `FilePreview` 持有；两个视图只通过 `text`/`update:text` 通信，
  避免双写不一致。
- **保存**：沿用现有 10s 防抖 + `Ctrl+S`，不新增保存通道。

## 11. 明确不做（YAGNI）

- 不做 curl 历史记录、环境变量、Cookie 管理、鉴权助手、导入/导出集合（Postman 集合格式）。
- 不做 YAML Schema 校验、拖拽排序、字段智能补全、锚点/多文档可视化编辑。
- 不做服务端请求代理。
- 不做 XML 节点编辑器本身（仅沿用 `WorkflowEditor` 的视觉风格与会话式结构化编辑范式）。

## 12. 测试与验收

- 单测：
  - `web/src/curl.test.ts`：多命令解析与区间、`buildCurl` 往返、`replaceCurlCommand`、URL/Query 拆分合并。
  - `web/src/yaml.test.ts`：解析、`yamlTree`、增删改/数组操作、序列化**注释保留**与键顺序、往返稳定。
- 全量校验：`npm test`、`npm run typecheck`、`npm run check:i18n`、`npm run build:web` 全绿。
- 人工验收：
  1. 打开 `.http`/`.rest`/含 curl 的文本 → 看到请求集合；改表单后代码模式同步；发送能看到响应。
  2. 打开 `.yaml`（含注释）→ 可视化增删改 → 代码模式文本同步且注释仍在 → 落盘正确。
  3. 解析失败/多文档 YAML → 报错可读、可切代码模式，不崩溃。

## 13. 决策记录

- 两个功能合并为一个 spec：用户明确。
- 总体方案 B（宿主 + 独立组件 + 纯逻辑模块）：用户确认。
- cURL 发送先用浏览器 `fetch`，不做服务端代理：用户确认。
- YAML 采用 `yaml` 包 `Document` API 保留注释，而非 `JSON.parse/stringify` 丢注释往返：用户确认。
- 表单改动写回文件（文件为唯一事实源）：依据“编辑 curl 命令 / 可视化编辑 YAML”的诉求。
