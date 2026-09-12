# 设计文档：中转站插件管线与响应缓存

日期：2026-09-12
分支：master
状态：待评审
前置：`docs/superpowers/specs/2026-09-12-llm-proxy-jwt-vault-design.md`（本机 LLM 中转站，JWT + 密钥库）

## 1. 概述

在既有中转站（`server/llm-proxy.js` 纯透传）之上增加两条能力：

1. **转换管线**：用户目录下的 JS 插件，对 URL / header / body 做任意改写，覆盖四类场景：
   - 协议兼容（model 名重映射、补 `anthropic-version`、头字段改名）
   - 请求增强/削减（注入默认参数/system prompt、max_tokens 上限、删多余字段）
   - 安全与脱敏（转发前脱敏、加签名/追踪头、过滤未知字段）
   - 按内容路由（按 body 内 `model` 等字段决定转发到哪个上游 provider）
2. **响应缓存**：非流式请求，按「规范化 body + provider」命中即直接返回缓存；硬编码默认值，插件可覆盖 key/TTL 或绕过。

范围约束（沿用并明确）：
- 插件运行在**服务主进程**，等价于服务端权限（可读 vault）。仅本人可控的本地插件，非沙箱。
- 缓存**仅内存 LRU**，重启即空，不持久化。
- 流式响应（`stream:true` / `Accept: text/event-stream`）**不缓冲、不转换响应、不缓存**，仍纯管道透传。
- 不做 TLS、限流/配额/统计、声明式规则 UI、缓存持久化、worker 隔离。

## 2. 现状与扩展点

- 代理入口：`server/llm-mount.js:25-31`。`/api/llm/<pid>/<rest>` → `createProxyHandler`；`/api/llm-admin/*` 管理接口。
- 代理核心：`server/llm-proxy.js:37-64`。`resolveTarget(baseURL, rest, query)` 拼目标；`injectUpstreamAuth` 覆盖上游 key；`req.pipe(preq)` 纯管道透传。
- 上游 provider：`server/llm-config.js` 的 `getProvider(id)`（含 `baseURL`、解析后 `apiKey`）。
- 数据目录：`server/data-home.js`，`downloadsDir()` = `<dataHome>/downloads`（活动配置 `devflow.xml`、`llm.vault.json` 所在处）。
- 前端：`web/src/components/ProxyView.vue`（`rail==='proxy'`）、`web/src/useLlm.ts`。
- 现有测试：`server/test/llm-proxy.test.js`（`resolveTarget`/`extractToken`/`injectUpstreamAuth`/`createProxyHandler`）。

## 3. 总体方案

```
远程 opencode → /api/llm/<pid>/*
  → 鉴权（JWT 验签 + exp + jti 未吊销，沿用）
  → 缓冲请求体（上限 32MB，超限 413）
  → 插件管线：match + onRequest（可改 providerId/path/query/headers/body）
  → 由改写后的 providerId + path 解析 target
  → 流式？
      ├─ 是：直接管道透传（不跑 onResponse、不缓存）
      └─ 否：算 cache key
             ├─ 命中：回放缓存（附 x-devflow-cache: HIT）并结束
             └─ 未命中：转发 → 缓冲完整响应 → 跑 onResponse → 存缓存 → 返回
```

插件目录：`<dataHome>/downloads/relay-plugins/*.mjs`，服务启动加载；面板「重载插件」手动热重载。

## 4. 插件契约 `server/relay-plugins.js`（新增）

模块默认导出单个对象或对象数组：

```js
export default {
  name: 'model-remap',        // 必填，用于诊断/去重
  priority: 100,              // 可选，默认 100；升序执行，小的先跑
  failOpen: false,            // 可选；默认 false（钩子抛错→502），true 则跳过该插件继续
  match: ({ providerId, method, path }) => true,          // 可选，不命中则本次不参与
  onRequest: async (ctx) => { /* 就地改 ctx 或返回 { providerId, path, query, headers, body } */ },
  onCacheKey: (ctx) => ({ key, ttlMs }) | null,           // 可选；null = 本次绕过缓存
  onResponse: async (ctx) => { /* 仅非流式；返回 { status, headers, body } */ },
};
```

`ctx` 字段：

- `providerId`：当前上游 provider id（`onRequest` 可改写，实现跨 provider 路由）。
- `method`、`path`、`query`：请求方法与路径/查询串（`path` 为 `/api/llm/<pid>/...` 之后的 `rest` 部分）。
- `headers`：请求头对象（浅拷贝，插件可改）。
- `body`：请求体 `Buffer`；`json`：JSON 解析结果（非 JSON 则 `undefined`）。
- `provider`：当前 provider 的只读信息 `{ id, name, baseURL, hasKey }`（**不含 apiKey 明文**）。
- `onResponse` 的 ctx 额外含 `status`、`headers`、`body`（响应）。

约定：

- 钩子返回 `void` 表示就地修改 `ctx`；返回对象则对给定字段做局部覆盖（其余保持）。
- 同名字段以最后一个生效的插件为准；`priority` 相同按加载顺序（文件名排序）稳定执行。
- 钩子可为 `async`，管线 `await` 串行执行，保证顺序确定。
- 单个插件 `import()` 失败或钩子抛错：
  - `failOpen=false`（默认）：请求返回 `502`，错误经 logger 记录。
  - `failOpen=true`：跳过该插件、继续管线，错误记录。
  - 加载期失败：记录到该插件条目的 `error`，该插件不参与管线，**不拖垮服务**。

`loadPlugins(dir)` → `{ plugins, entries }`：

- `entries`：`[{ file, name, priority, error }]`，供管理接口/前端展示。
- `plugins`：成功加载且可用的插件实例（按 `priority` 排序）。
- 目录不存在时返回空集，不报错。

### 示例与文档（首次种子）

普通用户不知道插件怎么写，因此插件目录首次生成时**种入示例与说明**（后续启动只补缺失文件，**从不覆盖**用户已有文件）：

- 仓库模板：`config/relay-plugins/`（随绿色包 `config/` 一起分发）。
- 种子目录：`relayPluginsDir()` = `<dataHome>/downloads/relay-plugins/`。
- 模板内容：
  - `README.md`：契约、钩子生命周期、`ctx` 字段、`failOpen`、重载方式、安全提示与「改名为 `.mjs` 即启用」说明。
  - `example-header.mjs.example`：改 header / 补 `anthropic-version`（协议兼容）。
  - `example-defaults.mjs.example`：注入默认参数、给 `max_tokens` 封顶（请求增强）。
  - `example-sanitize.mjs.example`：删除敏感/未知字段（安全脱敏）。
  - `example-route.mjs.example`：按 `json.model` 改写 `providerId`（按内容路由）。
  - `example-cache.mjs.example`：按 `temperature` 决定缓存 key/TTL 或 `null` 绕过。
- 示例文件以 `.mjs.example` 结尾，**不会被加载**（loader 只认 `*.mjs`）；用户改名为 `*.mjs` 后「重载插件」即生效。
- `seedPlugins(destDir, templateDir)`：目录不存在则创建；逐个复制缺失文件，已存在跳过；模板目录缺失则静默跳过。

## 5. 代理改造 `server/llm-proxy.js`

`createProxyHandler({ vault, getProvider, isEnabled, plugins, cache, logger })`：

1. `isEnabled()` 为假 → 404（沿用）。
2. 鉴权（沿用）。
3. 读全请求体（`readBody(req, limit)`，默认上限 32MB；超限 → 413）。JSON 体尝试 `JSON.parse` 得 `json`。
4. 构造 `ctx`，跑 `match` + `onRequest` 管线；用结果更新 `providerId/path/query/headers/body`。
5. `getProvider(providerId)`；不存在/无 `baseURL` → 404。
6. 解析流式：`json?.stream === true` 或 `headers.accept` 含 `text/event-stream`。
7. 流式：`injectUpstreamAuth` 后管道透传 `req→upstream`、`upstream→res`，**不**跑 `onResponse`、**不**缓存。
8. 非流式：
   - 算 `key = cache.keyFor(providerId, method, body)`；插件 `onCacheKey` 可覆盖 `{ key, ttlMs }` 或返回 `null` 绕过。
   - 命中：回放 `{ status, headers, body }`，附 `x-devflow-cache: HIT`。
   - 未命中：转发并缓冲完整响应体 → 跑 `onResponse` 管线 → 若最终 `status === 200` 则写入缓存（`ttlMs` 默认值）→ 返回。

保留既有导出（`resolveTarget`/`extractToken`/`injectUpstreamAuth`）供测试与复用；`injectUpstreamAuth` 现有逻辑（删 `host`/`content-length`、覆盖上下游 key）不变，插件改写后的 headers 仍需经它做最终净化再转发。

边界：

- 上游连接失败 → 502（沿用）。
- 响应体缓冲上限沿用 64MB 级保护：超过上限则不缓存但仍完整转发（避免 OOM）。
- 缓存命中时**不重复执行 `onResponse`**：缓存存的是 `onResponse` 之后的结果，命中直接回放。

## 6. 响应缓存 `server/llm-cache.js`（新增）

内存 LRU + TTL：

- `createCache({ ttlMs = 10*60*1000, maxEntries = 256, maxBytes = 64*1024*1024 } = {})`
- `keyFor(providerId, method, body)`：`sha256(providerId + '\n' + method + '\n' + normalize(body))`
  - `normalize(body)`：JSON 可解析 → 递归按 key 排序后 `JSON.stringify`（字段顺序/空白无关）；否则退回原始字节。
- `get(key)`：过期则删除并返回 `undefined`；命中刷新 LRU 时间。
- `set(key, value, ttlMs)`：`value = { status, headers, body }`；超 `maxBytes` 不写入；按 LRU 淘汰至满足 `maxEntries`/`maxBytes`。
- `clear()` / `stats()` → `{ entries, bytes, hits, misses }`（供面板/诊断，可选）。

默认值硬编码；插件 `onCacheKey` 可返回 `{ key, ttlMs }` 覆盖本次，或 `null` 绕过。缓存**默认开启**。

## 7. 管理接口与接线

新增 `GET /api/llm-admin/plugins`（放行于 `locked()` 之前，只读）→
`{ entries: [{ file, name, priority, error }], dir }`。

新增 `POST /api/llm-admin/plugins/reload`（需解锁）→ 重新 `loadPlugins` 并替换代理持有的 `plugins` 引用，返回最新 `entries`。

`createLlmMount` 内构造插件与缓存实例，注入 `createProxyHandler`；`reload` 通过可变引用（如 `proxy.setPlugins(next)`）生效，无需重启。

## 8. 前端

- `web/src/useLlm.ts`：新增 `plugins()`、`reloadPlugins()`。
- `web/src/components/ProxyView.vue`：新增「插件」区块：
  - 展示插件目录路径与提示「把 *.mjs 放到该目录后点重载」（首次启动已种入 `README.md` 与 `example-*.mjs.example`，改名即启用）；
  - 列表：文件名 / name / priority / loadError；
  - 「重载插件」按钮（需解锁态可用）。
- i18n 词条前缀 `llm.plugins.*`（如 `llm.plugins.title`、`llm.plugins.dir`、`llm.plugins.reload`、`llm.plugins.empty`、`llm.plugins.error`、`llm.plugins.hint`），中英同时补齐。

## 9. i18n

所有用户可见文案进 `shared/i18n/{zh-CN,en}.js`（中英对称），`npm.cmd run check:i18n` 通过。插件自身的运行错误信息走 logger，不计入用户可见文案。

## 10. 安全与边界

- 插件为主进程可信代码，可读 vault；文档/界面明确「仅放可信插件」。
- 插件 `onResponse` 仅对非流式响应执行，避免破坏 SSE。
- 请求体上限 32MB、响应缓冲上限 64MB，超限降级为「不缓存但转发」，防 OOM。
- 缓存内容为上游响应（可能含敏感 prompt/补全），仅内存、重启即清，不落盘。
- 跨 provider 路由由 `onRequest` 改 `providerId` 实现，仍受 provider 白名单（`getProvider`）约束，未知 id → 404。

## 11. 测试与验收

- 新增 `server/test/llm-cache.test.js`：命中/miss、TTL 过期、LRU 淘汰、`maxBytes` 不写入、非 JSON body 归一化、`keyFor` 对不同字段顺序同 key。
- 新增 `server/test/relay-plugins.test.js`：加载/排序/`match` 过滤、`onRequest` 改写 providerId/path/header/body、`onResponse` 改写、钩子抛错默认 502、`failOpen` 跳过、加载失败进 `entries.error`、目录缺失降级空集。
- 扩 `server/test/llm-proxy.test.js`：非流式同 body 二次请求命中缓存（`x-devflow-cache: HIT`）、`stream:true` 不被缓冲/不缓存、`onResponse` 只对非流式执行、`onCacheKey` 返回 `null` 绕过。
- 前端：`web/src` 相关纯函数（如插件条目格式化）单测；`vue-tsc` 通过。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web` 全绿。
- 人工验收：放一个改 header/body 的插件 → 重载 → 远端请求生效；非流式重复请求第二次 `HIT`；停止重载报错插件不崩服务。

## 12. 明确不做（YAGNI）

- 不做声明式转换规则 / UI 编辑器；插件即代码。
- 不做插件沙箱 / worker 隔离。
- 不做缓存持久化、缓存管理 UI、响应压缩/去重合并、语义相似缓存。
- 不做按 token 用量计费/配额/日志持久化。

## 13. 决策记录

- 转换能力形态：**纯 JS 插件**（用户明确）。
- 流式策略：**非流式缓冲、流式不缓冲**（用户明确）。
- 插件位置/重载：**用户目录 + 手动重载**（用户明确）。
- 缓存 key：**规范化 JSON body + provider**（用户明确）。
- 缓存存储：**仅内存 LRU**（用户明确）。
- 插件隔离：**主进程直接加载**（用户明确）。
- 缓存配置：**硬编码默认 + 插件覆盖**（用户明确）。
- 缓存默认开启、插件抛错默认 fail-closed(502)、`ctx` 透传原始请求以支持跨 provider 路由：设计评审确认。
- 插件示例与 README 首次种子到插件目录（只补缺失、不覆盖），示例用 `.mjs.example` 后缀避免误加载：评审补充确认。
- 多 key 来源 `provider.options.apiKeys`、默认 Round-robin、失败冷却（不重试）：用户明确。
- 插件编写引导：面板内置示例 + 一键生成示例插件 + 打开插件目录：用户明确。

## 14. 多 key 轮询与冷却

同一个上游（provider）配置多个 apiKey，请求按 **Round-robin** 轮流使用；遇上游限流/错误时**冷却该 key**（不重试当前请求）。

### 14.1 配置 `server/llm-config.js`

- `provider.options.apiKeys`：字符串数组；元素支持 `{env:NAME}`（复用 `resolveApiKey`）。缺省回退单个 `options.apiKey`。
- `loadOpencodeProviders` 每个 provider 增加 `apiKeysRaw: string[]`（`Array.isArray(o.apiKeys) ? o.apiKeys : (o.apiKey ? [o.apiKey] : [])`）。
- 新增 `resolveApiKeys(rawList, env)`：逐个 `resolveApiKey`，过滤空串，按出现顺序去重。
- `listProviders`：`hasKey = resolveApiKeys(p.apiKeysRaw).length > 0`。
- `getProvider(id)`：新增 `apiKeys`（解析后数组）；`apiKey = apiKeys[0] || ''`（兼容旧字段与生成配置）。

### 14.2 轮询 `server/llm-keypool.js`（新增）

`createKeyPool({ cooldownMs = 30000, now = Date.now } = {})`：

- `next(providerId, keys)`：按 providerId 维护索引循环；跳过处于冷却的 key；全部冷却时返回最早到期者；空池返回 `''`。
- `cool(providerId, key, ms = cooldownMs)`：标记该 key 冷却至 `now()+ms`。
- `isCooling(providerId, key)`、`clear()`（测试/管理用）。
- 纯内存、按 providerId 隔离、重启即清。

### 14.3 代理接入 `server/llm-proxy.js`

- `createProxyHandler` 增加 `keyPool = createKeyPool()`。
- 解析出 provider 后：`keyList = provider.apiKeys?.length ? provider.apiKeys : (provider.apiKey ? [provider.apiKey] : [])`；`upstreamKey = keyPool.next(ctx.providerId, keyList)`；经 `injectUpstreamAuth(headers, upstreamKey)` 覆盖。
- 上游响应状态命中 `401 / 403 / 429 / >=500` → `keyPool.cool(ctx.providerId, upstreamKey)`（流式在 `response` 事件、非流式在拿到缓冲结果时判定）。
- **缓存命中不取 key、不冷却**；缓存 key 仍只用 `providerId + body`（不含具体 key，多 key 视为同一逻辑上游，缓存共享）。

## 15. 插件编写引导（面板示例 / 一键生成 / 打开目录）

普通用户不看文件不知道怎么写插件，故在面板内提供引导。

### 15.1 复用 OS reveal `server/reveal.js`（新增）

把 `server/http-api.js:13-39` 的 `revealInOs(abs, isDir)` 原样抽到 `server/reveal.js` 导出；`http-api.js` 改为 `import { revealInOs } from './reveal.js'`（行为不变）。

### 15.2 起手模板 `server/relay-plugins.js`（新增导出）

- `EXAMPLE_PLUGIN`：一份可运行的最小插件源码（英文注释；`onRequest` 加一个 header，注释里给出 `onCacheKey`/`onResponse` 用法）。
- `writeExamplePlugin(dir, content = EXAMPLE_PLUGIN)`：`mkdir -p` 后写 `my-plugin.mjs`，已存在则顺延 `my-plugin-2.mjs`…，**绝不覆盖**；返回写入的文件名。

### 15.3 接口 `server/llm-mount.js`

- `GET /api/llm-admin/plugins` 返回体增加 `template: EXAMPLE_PLUGIN`（示例源码单一事实源）。
- `POST /api/llm-admin/plugins/example`（需解锁）：无 `pluginsDir` → 400；否则写入示例 + 重载，返回 `{ entries, file }`。
- `POST /api/llm-admin/plugins/reveal`（免解锁，与 GET plugins 同层）：无 `pluginsDir` → 400；`mkdir -p` 后调 `reveal(pluginsDir, true)`，返回 `{ ok: true }`；平台不支持 → 501。`reveal` 可注入（默认 `revealInOs`），便于单测不真的弹窗。

### 15.4 前端 `web/src/components/ProxyView.vue` / `useLlm.ts`

- 插件区标题栏按钮：`重载插件` / `生成示例插件` / `打开目录`。
- 可折叠「插件示例」区：展示 `template` 原文 + 复制按钮。
- 词条 `llm.plugins.new`、`llm.plugins.open`、`llm.plugins.new_done`、`llm.plugins.example.title`、`llm.plugins.example.copy`、`llm.plugins.example.copied`（中英对称）。

### 15.5 默认行为不变

无插件 / 插件未命中 → 仍按 `opencode.json` 的 provider/baseURL/model 透传；模型仍按 `opencode.json` 的 `provider.models`。

## 16. 测试（本次增补）

- `server/test/llm-config.test.js`：`apiKeys` 数组、混合 `{env:}`、去空去重、无数组回退 `apiKey`、全空 `hasKey=false`、`getProvider.apiKey = apiKeys[0]`。
- 新 `server/test/llm-keypool.test.js`：按 providerId 独立轮询、循环取、跳过冷却、全冷却取最早到期、过期恢复、空池。
- `server/test/relay-plugins.test.js`：`writeExamplePlugin` 写入默认名、重名顺延、不覆盖已有内容。
- `server/test/llm-mount.test.js`：`GET plugins` 含 `template`；`POST plugins/example` 生成文件后列表出现且二次调用名不同；`POST plugins/reveal` 用注入 spy 断言 `(dir, true)`；无 `pluginsDir` 时 example/reveal 400。
- `server/test/llm-proxy.test.js`：`apiKeys=[k1,k2]` 连续三次请求上游 `authorization` 依次 `Bearer k1/k2/k1`；上游 429 后下一次跳过该 key；缓存命中不消耗 key。
- 全量 `npm.cmd test`、`typecheck`、`check:i18n`、`build:web` 全绿。

## 17. token 列表展开式模型筛选生成配置

需求：token 列表做成「一列」，点某行展开后选 provider + 勾选模型，再生成 `opencode.json`；筛选**仅影响生成的配置**，服务端不强制校验（用户明确）。

### 17.1 服务端 `server/llm-mount.js`

`GET /api/llm-admin/opencode-config` 增加可选 `models` 参数：支持重复参数（`?models=a&models=b`）或逗号分隔单值。过滤规则：

- 未提供 `models`：沿用现有行为（`p.models` 全量）。
- 提供且非空：仅取「既在 `p.models` 中、又在请求列表中」的模型（避免注入不存在模型）；若过滤后为空，则按请求列表原样（允许 provider 未声明模型时手填）。
- 其余不变（token 不存在 404、provider 不存在 404）。
- `buildOpencodeConfig({ ..., models })` 已接受数组，直接传过滤结果。

### 17.2 前端 `web/src/components/ProxyView.vue` / `useLlm.ts`

- token 区：签发表单在上；下方 token **一列列表**，每行可点展开。
- 展开行：provider 下拉（默认 `defaultProvider`）+ 该 provider 模型勾选框（默认**全选**）+「生成」→ 预览 + 复制。
- provider 无模型时：提供手填输入（逗号分隔）用于生成。
- 移除原底部独立「生成 opencode.json」区块（并入行内展开）。
- `useLlm.config(provider, token, models?)`：`models` 以重复 query 参数发送。
- 新词条：`llm.config.models`、`llm.config.all`、`llm.config.none`、`llm.config.manual`（中英对称）。

### 17.3 测试

- `server/test/llm-mount.test.js`：`opencode-config` 带 `models` 过滤出子集；无 `models` 时全量；provider 未声明模型时按请求列表原样。
- `web/src`：类型检查通过；i18n 零命中。

