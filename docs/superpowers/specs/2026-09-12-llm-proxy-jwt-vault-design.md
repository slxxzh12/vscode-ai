# 设计文档：本机 LLM 代理（JWT 鉴权 + 信封加密密钥库）

日期：2026-09-12
分支：master
状态：待评审（已确认：方案 A、全部 provider 透传、JWT 认证、面板配置签名密钥、按天数有效期、token 可查看/吊销、信封加密 + 面板口令）

## 1. 概述

在左侧新增「代理」入口，把本机可达的大模型接口**反向代理**出去，供其他机器通过 devflow 访问：

1. 上游来自本机 opencode 配置（`opencode.json` 的 `provider`），**全部 provider** 在 `/api/llm/<pid>/*` 下透明透传；
2. 用 **JWT** 鉴权：输入**工号** + **有效天数**签发 JWT，代理只验签 + 校验过期 + `jti` 未吊销；
3. 敏感信息（JWT 签名密钥、已签发 token 记录、工号）用**信封加密**落盘，密钥由**面板口令**派生；
4. 面板生成对方可直接使用的 `opencode.json` 配置（`apiKey` 即 JWT）。

## 2. 现状与扩展点

- HTTP 路由：`server/index.js:423-454`（`/api/*` 未就绪 409 → history → collab → scheduler → `ws.httpApi` → 静态）。
- 工作区状态根：`stateRoot`（`server/workspace.js`，协作数据也在此），可用于放加密库文件（本机用户数据、不入库）。
- opencode 路径约定：`DEVFLOW_OPENCODE_CONFIG`（默认 `~/.config/opencode`）；仓库已有 `server/scheduler/ai-commands.js` 扫描其 `command` 目录，但**无**解析 `opencode.json` 的代码。
- 左侧 rail：`web/src/App.vue:449-483`（explorer/history/scheduler/contacts/stat + 设置）；新视图为 `rail==='proxy'` 的中心区组件。
- 网络：服务已监听 `0.0.0.0`（`config/devflow.xml` 的 `host`），LAN 可达。

## 3. 总体方案（方案 A）

```
左栏「代理」→ ProxyView
  ├─ 密钥库：初始化/解锁/锁定/改口令（信封加密）
  ├─ 上游：读本机 opencode.json 的 provider 列表（不泄露 key）
  ├─ 代理开关：off 时 /api/llm/<pid>/* 一律拒绝
  ├─ token：输入工号+天数 → 签发 JWT；列表查看/复制/吊销（jti 黑名单）
  └─ 生成 opencode.json（选 provider + token）

远程客户端 opencode → http://<host>:<port>/api/llm/<pid>/...
  └─ 取 Bearer/x-api-key 的 JWT → 验签+exp+jti → 覆盖上游 key → 透明透传（流式）
```

## 4. 密钥库 `server/llm-vault.js`（信封加密）

文件：`<stateRoot>/llm.vault.json`，即当前档案目录 `<dataHome>/ports/<id>/llm.vault.json`（本机用户数据、明文密钥不落盘）。

结构：

```json
{
  "v": 1,
  "salt": "<base64 16B>",
  "kdf": { "name": "scrypt", "N": 32768, "r": 8, "p": 1 },
  "wrappedDek": { "iv": "...", "tag": "...", "ct": "..." },
  "data": { "iv": "...", "tag": "...", "ct": "..." }
}
```

- `KEK = scrypt(passphrase, salt, 32B, {N,r,p})`；
- `DEK = randomBytes(32)`；`wrappedDek = AES-256-GCM(KEK, DEK)`；
- `data = AES-256-GCM(DEK, JSON)`，JSON 内含敏感字段；
- 每次加密用随机 12B IV，16B auth tag；口令不落盘。

API（默认文件路径可注入，便于单测）：

- `createVault({ file })`
- `status()` → `{ initialized, unlocked }`
- `init(passphrase)`：建盐/DEK/空 data，解锁态
- `unlock(passphrase)`：解 KEK → 解 DEK → 解 data（错误口令/篡改 → 抛错）
- `lock()`：清空内存 DEK/data
- `getData()` / `update(fn)`：仅解锁态可读写，写入即重新加密落盘
- `changePassphrase(old, new)`：校验旧口令后换盐重包 DEK（data 不变）

## 5. JWT `server/llm-jwt.js`

用 Node `crypto` 自实现 HS256（无第三方依赖）：

- `sign(payload, secret, { expiresInSec })` → `header.payload.signature`（base64url）
- `verify(token, secret)` → payload；签名不符/格式错误/`exp` 过期 → 抛错

claims：`{ sub: 工号, iat, exp, jti }`。签名密钥存于 vault，可由面板配置或一键随机生成。

## 6. 上游读取 `server/llm-config.js`

- 配置目录：`DEVFLOW_OPENCODE_CONFIG`（默认 `~/.config/opencode`）；文件 `opencode.json`，回退 `opencode.jsonc`（容错去注释）。
- 解析 `provider`：`{ name?, npm?, options?: { baseURL?, apiKey? }, models? }`；默认 `model`（`provider/modelId`）。
- `apiKey` 支持 `{env:NAME}` 占位 → 读进程环境。
- `listProviders()` → `[{ id, name, baseURL, hasKey, models: string[] }]`（**不返回 key 明文**）。
- `getProvider(id)` → 内部用，含 `baseURL` 与解析后的 `apiKey`。

## 7. 代理 `server/llm-proxy.js`

- 入参：`(req, res, url, { vault, getProvider, enabled })`。
- 路径：`/api/llm/<pid>/<rest>`；`enabled=false` → 404；`pid` 不存在/无 baseURL → 404。
- 未解锁 / 无效 JWT → 401；管理接口在未解锁时对需要密钥库的操作（签发/列表/生成配置/改口令）返回 423（Locked），`status` 始终可读。
- 目标 URL：
  - 解析 `baseURL` 为 `origin + basePath`；
  - `rest` 以 `basePath` 开头则 `targetPath = rest`，否则 `targetPath = basePath + rest`；
  - `target = origin + targetPath + query`。
- 鉴权：从 `Authorization: Bearer <jwt>` 或 `x-api-key` 取 JWT → `verify` + `exp` + `jti` 未吊销；通过后用上游 `apiKey` **覆盖**请求头 `authorization` 与 `x-api-key`（`anthropic-version` 等原样透传）。
- 转发：按上游协议选 `http`/`https`；`req → upstream`、`upstream → res` 管道直传（支持 SSE/流式/大响应），复制状态码与响应头（去掉 hop-by-hop）。
- 透传方法：GET/POST/PUT/DELETE/PATCH/OPTIONS 均支持。

## 8. 路由与接线

- `server/llm-mount.js`（新增）处理管理接口，`server/index.js` 在 `/api/` 通用处理前插入：
  `if (url.pathname.startsWith('/api/llm') || url.pathname.startsWith('/api/llm-admin')) { await ws.llmMount(req, res, url); return; }`
- 管理接口（前缀 `/api/llm-admin`，与代理路径隔离避免与 provider id 冲突）：
  - `GET  /api/llm-admin/status` → `{ vault:{initialized,unlocked}, enabled, providers, defaultProvider, host, port }`
  - `POST /api/llm-admin/vault/init { passphrase }`
  - `POST /api/llm-admin/vault/unlock { passphrase }`
  - `POST /api/llm-admin/vault/lock`
  - `POST /api/llm-admin/vault/passphrase { old, new }`
  - `POST /api/llm-admin/enabled { enabled }`
  - `GET  /api/llm-admin/tokens`
  - `POST /api/llm-admin/tokens { employeeId, days }` → `{ token }`（JWT）
  - `DELETE /api/llm-admin/tokens/:id`
  - `GET  /api/llm-admin/opencode-config?provider=<pid>&token=<id>` → `{ config: <string> }`
- 代理：`/api/llm/<pid>/*`。
- vault 数据（加密）保存：`{ enabled: bool, jwtSecret: string, tokens: [{ id, employeeId, jwt, iat, exp, jti, revoked }] }`。

## 9. 前端

- `web/src/App.vue`：rail 新增按钮（🔌，`title` 走 i18n），`rail==='proxy'` 渲染 `<ProxyView />`。
- `web/src/components/ProxyView.vue`：
  - 密钥库区：未初始化 → 设口令初始化；已初始化未解锁 → 输口令解锁；已解锁 → 锁定 / 改口令；显示锁定态。
  - 上游区：provider 列表（id/name/baseURL/是否有 key）。
  - 开关：启用/停用代理；显示监听地址 `host:port` 与风险提示。
  - token 区：工号 + 天数 → 签发；列表显示工号/签发/过期/JWT（可复制）/吊销。
  - 生成区：选 provider + 选 token → 预览 `opencode.json` 文本 + 复制。
- `web/src/useLlm.ts`：封装上述管理接口。
- `web/src/llm.ts`（纯函数，可单测）：`buildOpencodeConfig({ host, port, providerId, basePath, token, models })` → 配置对象/文本。

## 10. 生成的 `opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "devflow-<pid>": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DevFlow <pid>",
      "options": {
        "baseURL": "http://<host>:<port>/api/llm/<pid><basePath>",
        "apiKey": "<JWT>"
      },
      "models": { "<modelId>": {} }
    }
  }
}
```

- `basePath` = 上游 `baseURL` 的路径部分（如 `/v1`），保证请求路径不丢。
- `models` 优先取上游 `provider.models` 键；为空则尽力 `GET <origin>/models`；再空则 `{}` 并提示手填。

## 11. i18n

所有用户可见文案进 `shared/i18n/{zh-CN,en}.js`（中英对称），`npm run check:i18n` 通过。词条前缀 `llm.*`（如 `llm.title`、`llm.vault.init`、`llm.vault.unlock`、`llm.token.issue`、`llm.proxy.enabled`、`llm.config.copy` 等）。

## 12. 安全与边界

- 落盘仅密文（盐 + 包裹 DEK + 密文 data），明文密钥/口令不落盘；错口令/篡改 `AES-GCM` 校验失败。
- 服务重启后为**锁定态**，需面板解锁，代理才可用（安全默认）。
- 代理走现有 `0.0.0.0` 监听，LAN 可达；**无 TLS**，明文传输，需在可信内网使用，界面明确提示。
- 上游 key 只在本机读取、仅在转发时注入，**不返回给前端**。
- 不做限流/配额/用量统计；不做协议转换；不做多用户账号。

## 13. 测试与验收

- 单测（`node --test`）：
  - `server/test/llm-vault.test.js`：加解密往返；错口令失败；篡改 `ct` 失败；改口令后旧口令失效、新口令可解锁；未解锁读写报错。
  - `server/test/llm-jwt.test.js`：签验往返；错密钥失败；`exp` 过期失败；篡改签名失败。
  - `server/test/llm-config.test.js`：解析 provider / `{env:}` / 默认 model / jsonc 去注释 / 缺文件降级。
  - `server/test/llm-proxy.test.js`：`resolveTarget(baseURL, rest)` 映射（含 basePath 重复/缺失）、`extractToken(headers)`、`injectUpstreamAuth(headers, key)`。
- 前端：`web/src/llm.test.ts` 生成 `opencode.json` 结构。
- 全量：`npm test`、`npm run typecheck`、`npm run check:i18n`、`npm run build:web` 全绿。
- 人工验收：面板初始化解锁 → 启用 → 签发 JWT → 生成 opencode.json → 另一台机器 `opencode` 走代理可对话；停用/吊销/过期后 401。

## 14. 明确不做（YAGNI）

- 不做协议转换（OpenAI↔Anthropic）；不做 TLS/证书；不做限流/配额/统计；不做多租户账号体系；不做 token 哈希存储（需回显生成配置）；不做代理日志持久化（仅内存/console）。

## 15. 决策记录

- 复用现有 HTTP 服务（方案 A）：用户确认。
- 上游读本机 opencode 配置、**全部 provider** 透传：用户明确。
- 认证用 **JWT**、HS256、签名密钥面板配置：用户明确。
- 有效期按**天数**：用户明确。
- token 可随时查看 + 吊销（jti 黑名单）：用户明确。
- 敏感信息**信封加密**（DEK 加密数据、KEK 由面板口令 scrypt 派生包裹 DEK）：用户明确。
- 管理接口用 `/api/llm-admin` 前缀与代理 `/api/llm/<pid>` 隔离：避免与 provider id 冲突。
