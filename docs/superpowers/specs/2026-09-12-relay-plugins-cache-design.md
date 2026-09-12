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
  - 展示插件目录路径与提示「把 *.mjs 放到该目录后点重载」；
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
