# Nginx 反代（内置反向代理）设计

## 背景

devflow 目前有「小工具」体系（notepad/postman/navicat/…），工具作为主页面的页签，左栏列表 + 右主区（见 `web/src/tools/`）。服务端已有 `/api/*` 挂载风格（`server/usage-mount.js`、`server/navicat-mount.js`）与自制代理先例（`server/llm-proxy.js` 用 `node:http`/`node:https` 原样透传，可作转发写法参考）。

现在新增「Nginx 反代」小工具：devflow 内置一个**纯 Node 反向代理**（不依赖真机 nginx），在界面里配置转发规则，把本机/上游服务通过 devflow 自己的监听端口或 devflow 路径代理出去，并对经过的流量做**访问日志 + 请求/响应抓包**。

## 目标

- 规则两种接入模式：
  - **独立端口**：每条规则占一个自己的监听端口（`http://<listenHost>:<listenPort>`）。
  - **devflow 路径**：挂到 devflow 主监听端口的路径前缀（`http://<devflowHost>:<port>/<prefix>`）。
- 支持 **HTTP + WebSocket 升级 + SSE/chunked 流式** 端到端透传（SSE 不缓冲、chunk 到达即 flush、不压缩、长连接不断）。
- 上游可为 `http` 或 `https`；**默认不校验上游证书**，每条规则可单独打开「严格校验」。
- 转发头：自动加 `X-Forwarded-For/Proto/Host`，`Host` 改上游；支持每条规则自定义请求头（覆盖/追加）。
- **访问日志**：每条请求一行（时间 / 方法 / 路径 / 状态 / 耗时）。
- **抓包**：每条规则一个开关，**默认关**，需要时**手动开启**；开启后**落盘**、可长期回看、**不设条数上限**（手动清空）。SSE/chunked **边收边记**，WS 抓握手 + 每一帧。
- 规则持久化到端口数据目录；devflow 启动自动拉起 enabled 规则；界面增删改**即时生效**（不用重启后端）。
- 全量中英 i18n。

## 非目标（YAGNI）

- 不做 TLS 终止（反代自身不做 https 监听）。
- 不做上游负载均衡（每条规则单一上游）。
- 不做鉴权（Q5：谁连上监听端口谁就能用；仅靠监听地址控制暴露面）。
- 不做真机 nginx 的管理/配置生成/reload。
- 不做请求改写脚本、响应改写、URL 重写规则、缓存、限流。
- 不做抓包的长期索引/检索/导出（只做列表 + 详情 + 清空）。

## 设计

### 一、规则数据模型

```
{
  id: string,
  name: string,
  enabled: boolean,
  mode: 'port' | 'path',

  listenHost: '127.0.0.1' | '0.0.0.0',     // 默认 '127.0.0.1'
  listenPort: number,                       // mode='port'
  pathPrefix: string,                       // mode='path'，如 '/app1'
  stripPrefix: boolean,                     // 默认 true；mode='path' 时是否去掉前缀

  target: { protocol: 'http' | 'https', host: string, port: number },
  tlsInsecure: boolean,                     // 默认 true（默认不校验上游证书）
  headers: [{ name: string, value: string }],  // 转发时追加/覆盖

  capture: boolean,                         // 默认 false，抓包开关

  createdAt, updatedAt
}
```

- `mode='path'` 时 `pathPrefix` 校验：以 `/` 开头、不以 `/` 结尾、不与保留前缀冲突（`/api`、`/ws`、`/`静态与其他工具路径）；规则间前缀不允许互相包含冲突。
- `mode='port'` 时 `listenPort` 校验：1..65535，且不与 devflow 自身端口及本进程已占用的规则端口冲突。

### 二、后端模块

**`server/proxy-store.js`** — 规则持久化

- `createProxyStore({ file })`；`file` 默认 `<端口数据目录>/proxy/rules.json`。
- API：`list()`、`get(id)`、`create(input)`、`update(id, patch)`、`remove(id)`。
- 落盘原子写（写 `.tmp` 后 `rename`）；读失败按空档案处理；校验非法 `mode`/`pathPrefix`/`listenPort` 抛错。

**`server/proxy-capture.js`** — 抓包读写

- `createProxyCapture({ dir })`；`dir = <端口数据目录>/proxy/captures/<ruleId>/`。
- 存储布局：
  - `index.ndjson`：每行一条摘要记录（`id, ts, method, url, status, durationMs, kind, state, reqSize, resSize, truncated`）。
  - `<id>.req` / `<id>.res`：请求/响应正文 blob（小体内联进索引，大体的正文写独立文件，索引里记 `reqRef`/`resRef`）。
  - `<id>.frames.ndjson`：WS 帧（`{ dir:'c2s'|'s2c', ts, opcode, data }`，文本原样、二进制 base64）。
- API：`begin(meta) -> handle`、`handle.reqBody(chunk)`、`handle.resHeaders(h)`、`handle.resBody(chunk)`、`handle.frame(dir, opcode, data)`、`handle.finish({ status, durationMs, truncated })`、`list(ruleId, { limit, since })`、`read(ruleId, id)`、`clear(ruleId)`。
- **流式**：`resBody` 每次追加即落盘；流未结束 `state='active'`，`finish` 后 `state='done'`；单条体超过 **5MB** 停止追加并标 `truncated: true`（记录条数不限）。
- 规则删除时连同其 `captures/<ruleId>/` 目录一并清理。

**`server/proxy-engine.js`** — 转发引擎（核心）

- `createProxyEngine({ store, capture, logger, onEvent })` → `{ apply(rule), remove(id), start(id), stop(id), status() }`。
- **独立端口规则**：每条规则一个 `http.createServer`，`listen(listenHost, listenPort)`；同时监听其 `upgrade` 事件做 WS 中继。端口被占 → 规则 `status='error'`（附原因），不崩服务（端口占用判定复用 `server/port-conflict.js` 的 `isPortFree`）。
- **devflow 路径规则**：向主 HTTP 分发注册前缀处理器（`registerPathHandler(prefix, handler)`）与主 server 的 `upgrade` 路由（前缀命中则交给反代，否则交回 `/ws` 网关）。
- **HTTP 转发**：`http.request`/`https.request`（`rejectUnauthorized: !tlsInsecure`）；`pipe` 双向；响应头透传（剔除 `transfer-encoding` 由 Node 自行处理）。`stripPrefix` 时改写上游路径去前缀。
- **头处理**：加 `X-Forwarded-For`（追加客户端 IP）/`X-Forwarded-Proto`/`X-Forwarded-Host`；`Host` 设为上游 host:port；再应用规则自定义头（覆盖/追加）。
- **SSE/chunked**：不缓冲、不注入压缩，`res.write` 到即 `res.flushHeaders`/写出；连接超时默认 30s，读侧不设超时。
- **WS 中继**：客户端 `upgrade` → 向上游发同带子协议/头的升级请求 → 双向原始 socket `pipe`；透传 `sec-websocket-protocol`。
- `apply(rule)`：先 `stop` 旧实例再按新配置起（热生效）；`enable/disable` 通过 `start`/`stop` 表现。

**`server/proxy-mount.js`** — HTTP 路由（`createProxyMount({ store, engine, capture })`，风格对齐 `navicat-mount.js`）

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/nginx/rules` | — | `{ items, status }` |
| POST | `/api/nginx/rules` | rule | `{ ok, item }` |
| PATCH | `/api/nginx/rules` | `{ id, ...patch }` | `{ ok, item }` |
| DELETE | `/api/nginx/rules?id=` | — | `{ ok }` |
| POST | `/api/nginx/rules/start?id=` | — | `{ ok, status }` |
| POST | `/api/nginx/rules/stop?id=` | — | `{ ok, status }` |
| GET | `/api/nginx/captures?rule=&limit=&since=` | — | `{ items }`（摘要） |
| GET | `/api/nginx/captures/:rule/:id` | — | `{ item }`（完整，含正文/帧） |
| DELETE | `/api/nginx/captures?rule=` | — | `{ ok }`（清空该规则） |

- 错误码映射：`not-found`→404、`bad-request`（非法规则/前缀/端口）→400、端口占用→409（体含 `error:'port-in-use'`）。
- 每次写操作后调 `engine.apply/remove` 使改动即时生效，并经 `onEvent` 广播。

### 三、实时事件（WS）

- `shared/index.js`：`S2C` 增加 `NGINX: 'nginx'`；`C2S` 增加 `NGINX_SUB: 'nginx-sub'`（订阅）。
- 复用 `server/ws-gateway.js`：客户端订阅后，服务端广播 `{ type:'nginx', kind:'status'|'log'|'capture', rule, payload }`。
  - `status`：规则启停/错误变更。
  - `log`：一条访问日志行。
  - `capture`：新抓包摘要（详情按需再拉 `GET /api/nginx/captures/:rule/:id`）。

### 四、路径与装配

- `server/port-paths.js`：新增 `proxyDir: path.join(dir, 'proxy')`、`proxyCapturesDir: path.join(dir, 'proxy', 'captures')`，加入 `ensurePortDirs`。
- `server/index.js`：`createProxyStore`、`createProxyCapture`、`createProxyEngine`、`createProxyMount` 装配；路径规则的前缀处理器与 `upgrade` 路由接到主 server；启动时对 enabled 规则调 `engine.apply`；`/api/` 分发链转交 `url.pathname.startsWith('/api/nginx')`。

### 五、前端 `web/src/tools/nginx/`

- `useNginx.ts`（数据层）：`rules`、`status`、`load/create/update/remove/start/stop`、`captures(rule)`、`capture(rule,id)`、`clearCaptures(rule)`，订阅 WS `nginx` 事件更新日志与状态，暴露 `busy`/`msg`。
- `NginxTool.vue`（布局对齐 `navicat/NavicatTool.vue`：左列表 + 右主区）：
  - **左栏**：规则列表（名称 + 模式徽标 + 运行状态点），选中/启停/新建/重命名/删除。
  - **右主区上**：规则编辑表单 —— 名称、模式（独立端口 / devflow 路径）、监听地址下拉（`127.0.0.1`/`0.0.0.0`）、端口或路径前缀、是否去前缀、上游协议/host/port、严格校验证书开关（默认关）、抓包开关（默认关）、自定义请求头键值表；底部显示**访问地址**（`http://host:port/prefix`，可复制）。
  - **右主区下**：两个子页签「访问日志」「抓包」：
    - 访问日志：实时滚动列表（时间/方法/路径/状态/耗时）。
    - 抓包：摘要列表（时间/方法/URL/状态/类型 http|sse|ws/进行中|完成/截断），点开查看请求头、响应头、正文（SSE/chunked 显示已收内容 + 「进行中」标记）、WS 帧列表（文本/二进制 base64）。
    - 工具条：清空该规则抓包。
- `catalog.ts`：`ToolId` 增加 `'nginx'`；`MINI_TOOLS` 增加 `{ id:'nginx', icon:'🔀', labelKey:'tools.nginx', descKey:'tools.desc.nginx' }`；主页面工具页签渲染 `<NginxTool />`（走统一壳子 `kind:'tool'`，id `t:nginx`）。

### 六、i18n

新增键（中英同步）：

- `tools.nginx`、`tools.desc.nginx`。
- `nginx.*`：`new`、`name`、`mode`、`mode_port`、`mode_path`、`listen_host`、`listen_port`、`path_prefix`、`strip_prefix`、`target`、`protocol`、`host`、`port`、`tls_insecure`、`capture`、`headers`、`header_name`、`header_value`、`add_header`、`access_url`、`copy`、`start`、`stop`、`running`、`stopped`、`error`、`enable`、`disable`、`delete`、`delete_confirm`、`clear_captures`、`tab_log`、`tab_capture`、`time`、`method`、`path`、`status`、`duration`、`kind`、`state_active`、`state_done`、`truncated`、`req_headers`、`res_headers`、`req_body`、`res_body`、`frames`、`dir_c2s`、`dir_s2c`、`binary`、`streaming`、`empty`、`required`、`err_port_in_use`、`err_bad_prefix`、`err_not_found` 等。

## 影响文件

- 新增 `server/proxy-store.js`、`server/proxy-capture.js`、`server/proxy-engine.js`、`server/proxy-mount.js`
- 新增 `server/test/proxy-store.test.js`、`proxy-capture.test.js`、`proxy-engine.test.js`、`proxy-http.test.js`
- 新增 `web/src/tools/nginx/useNginx.ts`、`NginxTool.vue` + `*.test.ts`
- 改 `shared/index.js`（协议常量）、`web/src/components/MiniTools.vue`、`web/src/tools/catalog.ts`、`web/src/useCenter.ts`（如工具页签需要接线）、`shared/i18n/zh-CN.js`、`shared/i18n/en.js`
- 改 `server/port-paths.js`、`server/index.js`、`server/ws-gateway.js`（事件广播/订阅）、`server/http-api.js` 或主分发链（路径规则前缀路由）

## 测试计划

- `proxy-store.test.js`：CRUD；原子落盘后重载仍在；非法 mode/prefix/port 报错。
- `proxy-capture.test.js`：begin/req/res/finish 往返；正文 blob 与索引分离；超大正文标 `truncated`；`list` 摘要不含正文；`clear` 清目录；规则删除清目录。
- `proxy-engine.test.js`（端到端，起本地临时上游）：
  - 普通 HTTP 转发（状态/头/体一致）。
  - `stripPrefix` 去前缀与保留两种路径。
  - 头改写（`X-Forwarded-*`、`Host`、自定义头覆盖/追加）。
  - WebSocket 升级中继（双向回显 + 子协议）。
  - SSE 流式：分块到达即被客户端按序收到（不整包缓冲）。
  - 端口占用 → 规则 `error` 不崩服务。
  - https 上游默认宽松（自签证书可用），`tlsInsecure:false` 时失败。
- `proxy-http.test.js`：`/api/nginx/*` 各端点成功路径与 404/400/409 映射。
- web：`useNginx.test.ts`（请求路径/错误处理/WS 事件）；`NginxTool.test.ts`（模式切换、访问地址展示、抓包列表与详情渲染、清空）。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 后续（本轮不做）

- TLS 终止、上游负载均衡、鉴权/限流。
- 抓包检索/导出、请求响应改写规则、URL 重写。
- 真机 nginx conf 生成与 reload。
