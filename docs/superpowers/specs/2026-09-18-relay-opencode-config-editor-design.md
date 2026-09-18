# 设计文档：LLM 中转站内展示并编辑 opencode 配置（provider / model）

日期：2026-09-18
分支：master
状态：待实现

## 1. 需求

用户原文：

> 在 llm中转站 展示opencode里面配置信息，同时在这个网页上能对opencode里面东西做配置

澄清结论（逐条确认）：

- 范围只做 **provider / model 管理**：在现有「LLM 中转站」面板展示并可编辑各 provider 的 `baseURL`、`apiKey`、模型列表，以及顶层默认 `model`。
- 保存**直接写本机活动配置** `~/.config/opencode/opencode.json(c)`（即中转站当前读取的那份），保存后中转站立即生效。
- 文件格式：**转成 `opencode.json`** 写标准 JSON，原 `.jsonc` 先备份。
- `apiKey`：**明文可看可改**（仅授权页面可见，见 §8）。
- provider 与模型都**可增删改**（完整 CRUD）。
- 模型字段**完整可编辑**（`name`/`attachment`/`modalities`/`limit`/`reasoning` 等）。
- 顶层 `model` 也**可编辑**（下拉所有 `provider/model`，也可手填）。
- 保存**先校验再写**，并做**时间戳备份**。

## 2. 受管区块

| 区块 | 顶层键 | 可编辑内容 |
|------|--------|-----------|
| 默认模型 | `model` | 字符串；下拉列出全部 `providerId/modelId`，也允许手填 |
| Provider | `provider` | 完整 CRUD |

Provider 项：

- `id`（对象键，可改名）
- `name`
- `options.baseURL`
- `options.apiKey`（单个）或 `options.apiKeys`（多个）——明文编辑，`{env:VAR}` 原样展示
- `models`（模型对象，完整 CRUD）
- 其余字段（其他 `options.*`、provider 级附加键）**原样保留**，另提供「高级 JSON」编辑入口

模型项：

- `id`（对象键，可改名）
- `name`（友好输入框）
- 其余字段（`attachment`/`modalities`/`limit`/`reasoning`/`options` 等）通过模型级「高级 JSON」文本域编辑

顶层非受管键（`$schema`/`agent`/`mcp`/`command`/`plugin`/`skills` 等）永不由前端提交，保存时从磁盘原样保留。

## 3. 后端

### 3.1 新模块 `server/llm-opencode-config.js`（纯函数，可单测）

- `readActiveConfig({ dir })`
  - 复用与 `server/llm-config.js` 相同的读取顺序：`opencode.json` → `opencode.jsonc`。
  - 返回 `{ path, format, exists, raw, config }`；`format` 为 `'json' | 'jsonc' | null`；`config` 为解析结果（`.jsonc` 先去注释），解析失败时 `config: null` 且 `raw` 仍返回。
- `validateManaged({ provider, model })`
  - `provider` 必须是普通对象；每项为对象；`options` 若存在须为对象；`baseURL` 若存在须为字符串；`apiKey` 为字符串；`apiKeys` 为字符串数组；`models` 若存在须为对象，模型值为对象。
  - `model` 须为字符串（可为空）。
  - 不合法抛 `code = 'bad-config'`。
  - 前端「高级 JSON」在提交前于浏览器解析校验（须为对象），服务端仍以本函数兜底。
- `serializeProviderKeyShape(provider)`（辅助）
  - key 数量 0 → 删除 `apiKey`/`apiKeys`；1 → 写 `apiKey`；≥2 → 写 `apiKeys`（数组，去重保序）。
- `mergeAndWrite({ dir, provider, model, now })`
  1. `readActiveConfig`；若 `config` 为 `null`（文件损坏）抛 `code = 'bad-existing'`。
  2. 以磁盘 `config` 为基底，仅覆盖 `config.provider = provider`、`config.model = model`（`model` 为空字符串则删除该键）。
  3. 目标文件固定 `dir/opencode.json`；`$schema` 缺失时补默认 `https://opencode.ai/config.json`。
  4. 备份：若存在 `opencode.jsonc` → 改名为 `opencode.jsonc.<yyyyMMdd-HHmmss>.bak`（仅在首次转换发生）；若 `opencode.json` 已存在 → 复制/改名为 `opencode.<yyyyMMdd-HHmmss>.bak`。
  5. **原子写**：写 `opencode.json.tmp` → `fs.renameSync` 覆盖目标（POSIX/Windows libuv 均为替换语义；失败则回退为删除目标后再 rename）。
  6. 返回 `{ path, backups, config }`。

### 3.2 HTTP 路由（挂在既有 `server/llm-mount.js`）

- `GET /api/llm-admin/opencode` → `{ path, exists, format, raw, config }`
- `POST /api/llm-admin/opencode`，body `{ provider, model }` → `{ ok, path, backups, config }`
- 错误：`bad-config` / `bad-existing` → 400 且 body `{ error }`。
- **不要求密钥库解锁**：这是本机 opencode 配置管理，与中转密钥库独立；非回环访问已由现有邀请令牌门禁保护（§8）。
- 与既有 `GET /api/llm-admin/opencode-config`（生成给外部 token 用的配置）路径不冲突。

### 3.3 生效方式

`listProviders()`/`getProvider()` 每次请求都重读文件，保存后中转站即时使用新 provider；opencode 自身是否热重载由 opencode 决定，不在本设计范围。

## 4. 前端

### 4.1 `web/src/useLlm.ts`

新增：

- `opencodeConfig()` → `GET /api/llm-admin/opencode`
- `saveOpencodeConfig({ provider, model })` → `POST /api/llm-admin/opencode`

并在 `LlmStatus` 之外新增类型 `OpencodeConfigFile`。

### 4.2 新组件 `web/src/components/OpencodeConfigCard.vue`

- 在 `ProxyView.vue` 的 provider 卡片之后渲染，**始终显示**（不依赖密钥库解锁）。
- provider 列表（可展开行）：
  - `id` 文本（改名 = 迁移键）、`name`、`baseURL`；
  - apiKey 多行输入（明文，可增删行）；
  - 模型子列表：`id`、`name`、模型级「高级 JSON」折叠文本域、删除模型、新增模型；
  - provider 级「高级 JSON」折叠文本域（编辑 `options` 其余字段等）、删除 provider、新增 provider（带确认）。
- 默认模型：`<select>` 列出全部 `providerId/modelId` + 手填输入。
- 「原始 JSON」折叠区：只读展示 `raw`（`.jsonc` 时提示保存将转为 `.json`）。
- 保存按钮 → POST；成功提示并重新拉取 `status`（同步 provider 卡片）；失败行内展示错误。
- 所有可见文案走 `$t`。

## 5. i18n

新增词条前缀 `llm.oc.*`，`shared/i18n/zh-CN.js` 与 `shared/i18n/en.js` 同时补齐，键集合对称；提交前跑 `npm.cmd run check:i18n`。

## 6. 测试

新增 `server/test/llm-opencode-config.test.js`：

- 读 `opencode.json` 与 `opencode.jsonc`（含去注释）。
- `mergeAndWrite` 只替换 `provider`/`model`，`agent`/`mcp` 等非受管键原样保留。
- `validateManaged` 对非法结构抛 `bad-config`。
- 每次保存生成时间戳备份；`.jsonc` 存在时改名备份后写 `opencode.json`。
- 损坏的现有文件 → `bad-existing`。
- key 形状：0 删、1 为 `apiKey`、N 为 `apiKeys`。

必要时为前端纯辅助逻辑补 vitest。

## 7. 边界

| 场景 | 行为 |
|------|------|
| 无配置文件 | `exists:false`、`config:{}`；保存即新建 `opencode.json` |
| 文件损坏 | GET 返回 `config:null`；POST 拒绝 `bad-existing` |
| GET/POST 间外部改动 | 保存时重读磁盘；受管区块按提交覆盖，其余键保留 |
| 空 provider/models | 允许（合法空对象） |
| `{env:VAR}` key | 作为普通字符串展示/编辑，不解析 |
| 时间戳重复（同秒） | 直接覆盖同名 `.bak`（同一秒只保留一份备份） |

## 8. 安全

- 明文 apiKey 只在授权页面可见：非回环客户端已由现有 `?access=<token>` 邀请 Cookie 门禁（`server/index.js`）拦截，回环即本机。
- 不在代码/文档/提交中出现真实 key；测试用假值。
- 编辑的是用户本机数据文件，不进入仓库（`~/.config` 在仓库外）。

## 9. 目录组织

- 新增后端单元：`server/llm-opencode-config.js` + `server/test/llm-opencode-config.test.js`。
- 新增前端组件：`web/src/components/OpencodeConfigCard.vue`。
- HTTP 路由复用 `server/llm-mount.js`，前端 API 复用 `web/src/useLlm.ts`。
