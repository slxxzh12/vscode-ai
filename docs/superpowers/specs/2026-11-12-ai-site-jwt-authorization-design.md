# AI 小工具 JWT 授权设计

## 背景

原「AI 命令执行」站点（`server/ai-site/`）使用管理员创建的随机 token + HMAC 签名 cookie 登录，用户档案无有效期、无吊销。本次改造为与「LLM 中转站」一致的 JWT 授权：管理员按用户名 + 有效日期授权，服务端签发 JWT；用户首次访问输入 JWT，验证通过后下发 cookie，后续凭 cookie 访问；支持黑名单吊销，被吊销/过期的用户名不能登录。同时把「AI 命令执行」更名为「AI 小工具」，登录页更名「用户授权」，默认插件目录改为当前目录下的 `demo_plugins/`。

## 目标

- 标签更名：`AI 命令执行` → `AI 小工具`；`登录 AI 命令执行` → `用户授权`。
- 每个授权用户：`username` + 有效日期（exp）。服务端用 HS256 签发 JWT（`sub=username`、`jti`、`exp`、`iat`），与 LLM 中转站同一套 `llm-jwt`。
- 首次登录：用户在登录页输入 JWT；服务端校验签名/有效期/用户名/吊销状态，通过后下发 HMAC 签名 cookie。
- 后续访问：按 cookie 找到用户；每次请求校验启用、未过期、未吊销。
- 黑名单：以用户名（小写）存于 `users.json` 的 `blacklist`；登录与每次请求都校验；支持吊销/解除。
- 运行记录：按 cookie 找到的用户名（= JWT `sub`）记入运行/作业执行人。
- 默认插件目录：`<应用目录>/demo_plugins`（随包携带示例插件）。
- 全量中英 i18n。

## 设计

### 一、用户与 JWT（`server/ai-site/users.js`）

- 用户字段：`{ id, username, jwt, jti, iat, exp, enabled, createdAt, updatedAt, lastLoginAt, lastRunAt, uses }`。
- `createAiSiteUsers({ file, getSecret })`；`getSecret` 取配置里的 `sessionSecret`。
- `issue(username, expiresAt)`：`exp = floor(expiresAt/1000)`；`jti=uuid`；`jwt=signJwt({sub,jti,exp})`。
- `normalizeExpiry(value)`：接受毫秒时间戳/日期字符串；为空或非法则默认 30 天；允许过去时间（用于立即过期）。
- `findByJwt(jwt)`：`verifyJwt` 校验签名与 `exp`，按 `jti` 找用户，要求 `sub===username`、启用、未过期、未吊销。
- `update(id, patch)`：改用户名或有效日期时重签 JWT（新 `jti`，旧 JWT 失效）；仅改启用状态不重签。
- 黑名单：`revoke(username, revoked=true)`、`blacklist()`、`isRevoked(username)`；持久化到 `users.json` 的 `blacklist`。
- 旧档案（随机 token、无 JWT）在加载时迁移为 30 天有效 JWT。

### 二、登录与 cookie（`server/ai-site/pages.js` / `serve.js`）

- 登录页只保留一个 `token` 输入框（JWT）。
- `POST /__login`：`users.findByJwt(token)`；失败返回 401 登录页，成功下发 `df_ai_auth=<userId>.<HMAC>` cookie。
- `?access=<jwt>`：`findByJwt` 成功后直接下发 cookie（便于分享带授权的访问链接）。
- `authUser(req)`：cookie 签名校验 + `users.get(id)`；再校验 `enabled`、`isExpired`、`isRevoked`。
- 执行插件时 `runner.createRun({ user: user.username || ... })`，作业执行人显示用户名。

### 三、管理界面（`web/src/tools/ai-site/`）

- 新增用户：用户名 + 有效日期（默认 30 天后）；创建后复制 JWT。
- 用户列表：显示用户名、使用次数、有效期（可改，改后重签 JWT）、复制 JWT、启用开关、吊销/解除吊销、删除。
- 已过期/已吊销显示标记。

### 四、默认插件目录与示例

- `createAiSite({ defaultPluginRoot })` → `createAiSiteConfigStore({ defaultPluginRoot })`；配置项 `pluginRoot` 为空时用它。
- `server/index.js` 传 `path.join(APP_DIR, 'demo_plugins')`。
- 新增 `demo_plugins/`（README + `hello-world` 示例插件），打包脚本 Windows/macOS 一并携带。

## 影响文件

- `server/ai-site/users.js`、`pages.js`、`serve.js`、`mount.js`、`config-store.js`、`index.js`
- `server/index.js`（默认插件目录）
- `scripts/build.js`、`scripts/build-mac.js`（携带 demo_plugins）
- `web/src/tools/ai-site/useAiSite.ts`、`AiSiteView.vue`
- `shared/i18n/zh-CN.js`、`en.js`
- 新增 `demo_plugins/`
- 对应测试：`server/test/ai-site-*.test.js`、`web/src/tools/ai-site/*.test.ts`

## 测试计划

- users：签发/校验 JWT；过期、吊销、停用、改期重签；黑名单持久化。
- serve：JWT 登录下发 cookie 并执行；错误/吊销 JWT 不登录；运行记录用户名为 JWT `sub`。
- pages：登录页只有 token 字段。
- mount：用户增删改、吊销/解除、列表带 revoked。
- config-store：未配置 pluginRoot 时使用默认 demo_plugins。
- 前端：新增用户带 expiresAt、吊销接口、页面渲染。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
