# 设计文档：英文提示词翻译（终端输入框内联）

日期：2026-09-17
分支：master
状态：已实现（形态经用户多轮修正，见 §0）

## 0. 最终形态（覆盖下文早期描述）

最初做成独立页签「英文提示词」，后按用户要求改为**内联进终端底部输入框**，并补了手机页小工具：

1. **删除独立页签**：导航栏不再有 `EN` 页；`PromptTranslator.vue` 删除；`nav.english_prompt` 词条删除。
2. **终端底部输入框「英文翻译」开关**（`TerminalView.vue` 的 `.cbar` 里，与折叠按钮同排）：
   - 打开后输入区左右分栏：左＝中文（原 `composerText`），右＝英文译文（`translatedText`，可编辑）。
   - `翻译` 按钮（或发送时自动补翻）；发送前若右边为空或中文已变且英文未被手改，则先翻再发。
   - **点「发送」默认把右边英文发给 Agent**；发送后清空译文。
   - 翻译走 `POST /api/translate`（默认模型、`{ text }`）；错误码映射到 `et.*` 词条。
3. **压缩上下文按钮**：`发送` 左侧，`activeIsAgent` 时显示，点击向当前会话发 `/compact`。
4. **文件/图片**：输入框右上角 `📎 选择文件`（`POST /api/file/pick-path`）把路径插入中文框；服务端提交时会识别文本里的图片路径并附图（视觉模型），因此不再需要单独的「图片路径」框；`/api/image/pick` 与 `native-dialog.pickImage` 已移除。
5. **手机页小工具**（`MobileView.vue` + 新增 `MiniTools.vue`）：介绍/板块/公告整体压缩（字号、间距、二维码 168→132）；下方一排小工具图标：翻译（`/api/translate`）、YAML（校验/格式化，`web/src/yaml.ts`）、JS（压缩，`/api/format`）、文本排序（纯前端）。排序/去重逻辑抽出为 `web/src/textTools.ts`，与文件预览共用。

## 1. 概述

在左侧导航栏「历史」旁新增「英文提示词」入口。页面里：

1. 上方输入框输入中文提示词（多行）；
2. 选择模型（下拉，来自本机 `opencode.json` 配置的 provider 模型列表，默认取该文件的 `model`）；
3. 点「翻译」（或 `Ctrl+Enter`）→ 服务端**直连 provider 的 chat completions 接口**翻译成英文；
4. 英文结果整段填入下方**可编辑**的英文框，可再手动润色并复制。

需求原文（用户）：

> 在界面上 历史的旁边，增加一个 英文提示词 的功能，如果点击打开的时候，用户输入完成之后，然后在界面下面输入框下面有一个输入框，调用opencode 能力，将中文翻译成英文，在界面里面展示对应的英文提示框

后续修正：

> 我的意思 是不是用opencode.json 里面配置，直接发送请求，这样还快一点？

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 翻译后端 | **不用 `opencode run` CLI**（实测本机报 `Unexpected server error`），改为读 `opencode.json`/`opencode.jsonc` 的 provider，服务端直连 `<baseURL>/chat/completions` |
| 2 | 配置来源 | 复用现有 `server/llm-config.js`：`loadOpencodeProviders()` / `getProvider()`（支持 `opencode.json` 与 `opencode.jsonc`、`{env:}` 解析、无 baseURL 时用 `DEFAULT_BASE_URLS` 兜底） |
| 3 | 下方英文框 | **可编辑**（用户可手动润色），非只读 |
| 4 | 触发方式 | **手动点「翻译」按钮**（`Ctrl+Enter` 同效），非自动防抖 |
| 5 | 返回方式 | **一次性**返回（翻译中显示「翻译中…」），非流式 |
| 6 | 模型选择 | 页面给**模型下拉**：清单优先取 `opencode models <默认provider>`（与 opencode 选择一致；deepseek 为 4 个 `deepseek/*`），失败回退 opencode.json 的 models；默认选中 opencode 的 `model`（`deepseek/deepseek-v4-flash`） |
| 7 | 工作目录 | 不需要（直连请求，与 cwd 无关） |
| 8 | 翻译页图片 | 独立「图片路径」框：可手输/粘贴，也可点「选择图片」用系统对话框填入；提交时作为 `images` 参数；服务端把显式 `images` 与文本里的图片路径合并去重 → base64 附为 `image_url`，并切换成视觉指令（按用户要求作答、英文回复）。文本可为空（只给图也能翻） |
| 9 | 终端首页图片 | 「选择文件」→ 系统对话框（任意文件）→ 只把路径插入输入框；服务端不解析，交给所用 Agent 自行处理 |
| 10 | 图片约束 | `png/jpg/jpeg/gif/webp/bmp`；单张 ≤10MB；最多 4 张；路径不存在即忽略；远程访问时只允许读项目根内的图片 |

## 3. 现状（改动前）

- `server/llm-config.js` 已能解析 opencode 配置：`loadOpencodeProviders()` 返回 `{ providers, defaultProvider }`；`listProviders()` 返回脱敏 list；`getProvider(id)` 返回 `{ baseURL, apiKey, apiKeys, models }`。
- 本机 `~/.config/opencode/opencode.jsonc`：`model = "deepseek/deepseek-v4-flash"`，`provider.deepseek.options.apiKey` 已解析出真实 key（35 字符），无 `baseURL` → 兜底 `https://api.deepseek.com/v1`；models = `deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`。
- 导航栏 rail 取值 `explorer|history|contacts|stat|scheduler|proxy|mobile`，hash 锚点 `#<rail>`，`RAILS` 白名单校验（`web/src/App.vue`）。
- 路由挂载点：`server/index.js` 里 `if (url.pathname.startsWith('/api/xxx')) { await ws.xxxMount(...) }`。
- 现有 `server/collaboration/remote-runner.js` 的 `createOpenCodeRunner` 封装 `opencode run`，本设计**不复用**（CLI 路线已放弃）。

## 4. 架构与数据流

```
PromptTranslator.vue
  ├─ GET  /api/translate/config   → { provider, models[], model, hasKey }
  └─ POST /api/translate { text, model } → { text }
                       │
                       ▼
        server/translate.js
          catalog() → llm-config.loadOpencodeProviders() + getProvider(defaultProvider)
          translate({ text, model }) → fetch(`${baseURL}/chat/completions`,
              headers: Authorization: Bearer <apiKey>,
              body: { model, messages: [system, user], stream: false })
```

## 5. 后端设计

### 5.1 `server/translate.js`（新模块）

- `TRANSLATE_SYSTEM`（英文常量，避免命中 i18n 中文扫描）：要求只输出英文译文、保持 Markdown/代码/路径/命令/专有名词不变、不要解释。
- `buildMessages(text)` → `[{ role:'system', content: TRANSLATE_SYSTEM }, { role:'user', content: text }]`。
- `createTranslator({ getProvider, providerId, defaultModel, fetchImpl = fetch, timeoutMs = 60000, maxLen = 20000 })`：
  - `translate({ text, model })`：
    - 校验：空 → `empty-input`；超 `maxLen` → `too-long`；
    - 取 provider：无 → `no-provider`；无 key → `no-key`；
    - 校验 model ∈ provider.models（空则用 `defaultModel`），非法 → `bad-model`；
    - `AbortController` + `setTimeout(timeoutMs)` 发请求；超时 → `timeout`；
    - 非 2xx → `upstream`（带 status 与截断后的 message）；
    - 取 `json.choices[0].message.content`，trim；空 → `upstream`/`empty-result`。
  - 返回 `{ text }`；错误对象带 `code`，由 mount 映射为 HTTP 状态码。
- `createTranslateMount({ translator, catalog, logger })`：
  - `GET /api/translate/config` → `await catalog()`（**不含任何密钥**）；
  - `POST /api/translate` → 读 body `{ text, model }` → `{ text }`；
  - 错误映射：`empty-input|too-long|no-provider|no-key|bad-model` → 400；`timeout` → 504；`upstream` → 502；其余 500。

### 5.1.1 模型清单（与 opencode 一致）

- `parseModelList(output, providerId)`：解析 `opencode models <provider>` 的 stdout（每行 `provider/model`），只留指定 provider、去重、剔除无斜杠/空行。
- `createModelLister({ bin='opencode', spawnFn, timeoutMs, ttlMs })`：异步跑 `opencode models <provider>`，短 TTL（默认 60s）按 provider 缓存；失败/非零退出/超时一律返回 `[]`。
- `createCatalogSource({ listModels, resolveProvider, loadProviders })`：组合出 `{ provider, models, model, hasKey, resolved }`；`models` 优先用 CLI 清单，为空时回退 `opencode.json` 的 models（补成 `provider/model`）；`model` 取 opencode 的 `model`（命中清单则用，否则取清单首个）。
- `defaultCatalog()` / `defaultProviderResolver()` 都基于 `createCatalogSource`；`provider.models` 可能是裸名或 `provider/model`，`translate` 内统一按裸名比较并只把裸名发给上游。

### 5.1.2 图片识别（选图 → 视觉请求）

- `extractImagePaths(text)`：先取引号/反引号包裹的路径（含空格安全），再兜底裸绝对路径/相对路径，按图片扩展名过滤并去重。
- `resolveImageList(paths, { allowedRoots, readImage })`：路径数组 → `data:<mime>;base64,...`；不存在的/非图片直接跳过；超过 4 张 → `too-many-images`；单张 >10MB → `image-too-large`；`allowedRoots` 非空时只允许根内路径（远程访问用）。
- `resolveImages(text, opts)`：`resolveImageList(extractImagePaths(text), opts)`，兼容「路径写在提示词里」。
- `translate({ text, images, allowedRoots })`：显式 `images` 与文本路径合并去重；两者都空 → `empty-input`；文本为空但带图时用固定英文占位文本。
- `buildMessages(text, images)`：无图 = 原翻译指令；有图 = `IMAGE_INSTRUCTION`，user 内容为 `[text, image_url...]` 分块。
- `createTranslateMount` 新增注入 `isLocal(req)` 与 `projectRoots()`：本机请求不限路径，远程请求传 `allowedRoots = projectRoots()`。
- 选路径的对话框接口（`server/http-api.js`）：
  - `POST /api/file/pick-path`（任意文件，只返回 `{ path }`）→ 终端首页「选择文件」；
  - `POST /api/image/pick`（图片过滤，只返回 `{ path }`）→ 翻译页「选择图片」。
  - `native-dialog.js` 新增 `pickImage()`（Filter 限定图片扩展名）。

### 5.2 `server/llm-config.js`（小改）

- `loadOpencodeProviders()` 返回值增加 `model`（原始 `json.model`，缺省 `''`），用于取默认模型。
- 更新 `llm-config.test.js` 中 `deepEqual(..., { providers: [], defaultProvider: null })` 断言。

### 5.3 `server/index.js`（装配）

- 构建 `translateMount = createTranslateMount({...})`，`catalog()` 用 `loadOpencodeProviders()` 取 `defaultProvider` + `getProvider(defaultProvider).models` + `model`（剥掉 `provider/` 前缀）+ `hasKey`。
- 路由：`if (url.pathname.startsWith('/api/translate')) { await ws.translateMount(req, res, url); return; }`。
- 加入 `buildWorkspace` 返回值。

## 6. 前端设计

### 6.1 `web/src/components/PromptTranslator.vue`（新组件）

- 顶部工具行：标题、模型 `<select>`（`models`，默认 `model`）、`翻译` 按钮、`Ctrl+Enter` 提示。
- 上半区：中文 `textarea`（`v-model` 源文）。
- 下半区：英文 `textarea`（可编辑）、`复制英文`、`清空` 按钮。
- 状态：`busy`（禁用按钮、显示「翻译中…」）、`error`（错误条）、`copied`（复制反馈，2s 自动消失）。
- 挂载时 `GET /api/translate/config`；`hasKey=false` 或 `no-provider` 时显示提示（去「代理」页配置 provider）。
- 复制用 `navigator.clipboard.writeText`，失败回退 `textarea.select()+execCommand`。
- 「图片路径」框：可手输/粘贴，也可点「选择图片」（`POST /api/image/pick`，图片过滤）填入；「清空」按钮清除。
- 提交时组装 `{ text, model, images }`；文本为空但有图也允许（只识别/翻译图片）。

### 6.1.1 终端首页「选择文件」

- `web/src/components/TerminalView.vue`：底部输入框右上角工具栏 `.ctools` 增加「📎 选择文件」按钮（与「历史」并排）。
- 点击 → `POST /api/file/pick-path` → 把 `"<path>"` 追加到 `composerText`（不读取、不改写）；后续由所用 Agent 自行处理（opencode TUI 支持拖拽/引用文件与图片）。

### 6.2 `web/src/App.vue`

- `rail` 联合类型与 `RAILS` 白名单增加 `'english'`。
- 导航栏「历史」按钮后插入按钮（`EN`/🈶 图标，`title=$t('nav.english_prompt')`）。
- 渲染：`<template v-else-if="rail === 'english'"><section class="center"><PromptTranslator /></section></template>`。
- hash：`currentHash()` 走默认分支 `#english`；`applyHash()` 靠 `RAILS` 白名单放行。

### 6.3 i18n（`shared/i18n/zh-CN.js` + `en.js` 同步）

`nav.english_prompt`、`et.title`、`et.model`、`et.source`、`et.source_ph`、`et.result`、`et.result_ph`、`et.run`、`et.running`、`et.copy`、`et.copied`、`et.clear`、`et.empty`、`et.too_long`、`et.no_provider`、`et.no_key`、`et.timeout`、`et.failed`。

## 7. 测试

- `server/test/translate.test.js`（注入假 `fetchImpl` / 假 `getProvider`）：
  - 成功：请求 URL/头/body 正确，返回翻译文本；
  - 空输入 / 超长 / 非法模型 / 无 provider / 无 key → 对应 code；
  - 上游非 2xx → `upstream`（带 status）；
  - 超时 → `timeout`（`AbortController` 生效）；
  - mount：`GET /api/translate/config` 不泄露 key；`POST` 正常与错误码映射。
- `server/test/llm-config.test.js`：补 `model` 字段断言。
- 图片：`extractImagePaths`（引号/裸路径/非图片）、`buildMessages`（带图分块 + `IMAGE_INSTRUCTION`）、`resolveImages`（缺图跳过 / 超量 / 过大 / `allowedRoots`）、`translate` 带图请求体。

## 8. 非目标

- 英译中 / 双向切换；
- 翻译历史持久化；
- 流式输出；
- 多 provider 选择（只列默认 provider 的模型）；
- 移动端入口；
- 复用/修复 `opencode run` CLI。

## 9. 验证

- `npm.cmd run check:i18n`、`npm.cmd run typecheck`、`npm.cmd test`。
- 手工：点「英文提示词」→ 选模型 → 输入中文 → 翻译 → 英文框出结果 → 可编辑 → 复制。
- 手工：翻译页「选择图片」→ 路径进输入框 → 翻译 → 模型识别图中内容并英文作答。
- 手工：终端首页「选择文件」→ 路径进输入框，交由 Agent 处理。
