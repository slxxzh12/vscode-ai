# 中转站转换插件

把 `*.mjs` 文件放进本目录，然后在 devflow 面板「中转站 → 转换插件」点「重载插件」即生效，无需重启服务。
本目录首次生成时附带 `example-*.mjs.example`，把文件名末尾的 `.example` 去掉（改成 `*.mjs`）即启用。

## 插件长什么样

```js
export default {
  name: 'my-plugin',   // 必填，唯一
  priority: 100,       // 可选，默认 100；升序执行，小的先跑
  failOpen: false,     // 可选，默认 false（钩子抛错→请求 502）；true 则跳过本插件继续
  match: ({ providerId, method, path }) => true,   // 可选，不命中则本次不参与
  onRequest: (ctx) => { /* 改 url/header/body */ },
  onCacheKey: (ctx) => ({ key, ttlMs }) || null,   // 可选；null = 本次绕过缓存
  onResponse: (ctx) => { /* 仅非流式；改响应 */ },
};
```

## 钩子与执行时机

- `onRequest`：请求转发上游前。可改 `ctx.providerId`（跨上游路由）、`ctx.path`、`ctx.query`、`ctx.headers`、`ctx.body`。
- `onCacheKey`：非流式请求算缓存 key 时。返回 `null` 绕过缓存；返回 `{ key, ttlMs }` 可只覆盖其中一项。
- `onResponse`：**仅非流式**响应；`stream:true` 或 `Accept: text/event-stream` 的响应直接透传，不会调用。

钩子可 `async`。返回 `undefined` 表示就地修改 `ctx`；返回对象则对 `providerId`/`path`/`query`/`headers`/`body`/`status` 做局部覆盖。

## ctx 字段

- `providerId`：当前上游 id。
- `method` / `path` / `query`：请求方法、路径（`/api/llm/<pid>` 之后的部分）、查询串。
- `headers`：请求头对象（可直接改）。
- `body`：请求体 `Buffer`。
- `json`：请求体 JSON 解析结果（非 JSON 为 `undefined`）。
- `provider`：`{ id, name, baseURL, hasKey }`（不含上游 apiKey 明文）。
- `onResponse` 额外有 `status`、`headers`、`body`（响应）。

## 注意

- 改了 `json` 后要用 `ctx.body = Buffer.from(JSON.stringify(ctx.json))` 同步；`content-length` 由中转站按最终 `ctx.body` 重算。
- 插件运行在服务主进程，能力等同服务端（可读密钥库）。**只放你自己信任的插件。**
- 加载失败或语法错误会在面板插件列表显示错误，不影响服务运行。
