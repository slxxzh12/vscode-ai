# 设计文档：本机 opencode provider 极简配置

日期：2026-09-18
分支：master
状态：待评审
取代：`docs/superpowers/specs/2026-09-18-relay-opencode-config-editor-design.md`（复杂行式编辑器）

## 1. 概述

把「LLM 中转站」面板中编辑本机 `~/.config/opencode/opencode.json` 的复杂卡片（`OpencodeConfigCard.vue`：多 key 数组、baseURL 手填、advanced JSON、raw 编辑）替换为一张**极简配置卡**：

- 内置 4 个 provider 预设：`deepseek` / `glm` / `qwen` / `minimax`，baseURL 与常用模型清单写死，用户**不用手填 baseURL/模型 id**。
- 每个 provider **一个 apiKey** + **模型勾选**，另可手填补充模型。
- **多模态模型默认支持图像**：写入时对 vision 模型加 `"attachment": true`。
- 保存直接写回本机 `opencode.json`，保留文件里其余内容（非预设 provider、`plugin`/`skills`/`agent`/`mcp`/`command` 等顶层字段）。

范围的另一面：token 展开区「生成/下载给远程机器的 opencode.json」（apiKey 为 DevFlow JWT）**保持不动**，不属于本次改动。

## 2. 目标与非目标

**目标**

- 本机 provider 配置从「手填一堆字段」变成「填 key + 勾模型」。
- deepseek/glm/qwen/minimax 四个 provider 一视同仁、同一套交互。
- 多模态模型开箱即支持图像，无需用户理解 `attachment` 字段。

**非目标（YAGNI）**

- 不改远程 token 生成/下载（`opencode-config`、`opencode-bundle`、Install.bat）。
- 不做运行时拉取上游 `/models`（清单内置 + 手填补充即可）。
- 不做预设 provider 的新增/删除自定义（非预设 provider 仅原样保留，不在新卡里编辑）。
- 不引入密钥库/加密存储：apiKey 仍明文写在 `opencode.json`（opencode 原生做法，不变）。
- 不改多 key 轮询（`apiKeys`）能力，只是新卡默认只填一个 key。

## 3. 现状与扩展点

- 复杂卡组件：`web/src/components/OpencodeConfigCard.vue`（由 `ProxyView.vue:306` 引入）。
- 行式模型 ↔ 配置互转：`web/src/opencodeConfig.ts`。
- 读/写本机配置：`server/llm-opencode-config.js` 的 `readActiveConfig` / `mergeAndWrite`（备份 + 原子写）。
- HTTP 路由：`server/llm-mount.js:153-164` 的 `GET/POST /api/llm-admin/opencode`。
- 前端调用：`web/src/useLlm.ts` 的 `opencodeConfig()` / `saveOpencodeConfig()`。
- 共享包：`shared/`（`@devflow/shared`，workspace junction，支持子路径导出）。
- 本机现状：`opencode.jsonc` 里仅 `deepseek`（`deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`），另有 `plugin/skills/agent/mcp/command` 顶层键需保留。

## 4. 预设数据 `shared/llm-presets.js`（新增）

单一事实源，前后端共用（服务端写 `attachment` 与前端展示都读它）。

```js
export const LLM_PROVIDER_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-v4-pro', vision: false },
      { id: 'deepseek-v4-flash', vision: false },
      { id: 'deepseek-v4-flash-vision-exp', vision: true },
    ] },
  { id: 'glm', name: 'GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4.6', vision: false },
      { id: 'glm-4.5-air', vision: false },
      { id: 'glm-4v-plus', vision: true },
    ] },
  { id: 'qwen', name: 'Qwen', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen3-max', vision: false },
      { id: 'qwen3-coder-plus', vision: false },
      { id: 'qwen-vl-max', vision: true },
    ] },
  { id: 'minimax', name: 'MiniMax', baseURL: 'https://api.minimax.chat/v1',
    models: [
      { id: 'MiniMax-M2', vision: false },
      { id: 'MiniMax-Text-01', vision: false },
      { id: 'MiniMax-VL-01', vision: true },
    ] },
];

export function presetById(id) { /* 命中返回预设，否则 null */ }
export function isVisionModel(providerId, modelId) {
  // 预设 vision=true → true；否则按模型 id 兜底识别（手填的也生效）
  // 匹配：/vision/i、/(^|[-_/])vl([-_/.]|$)/i、/4v/i、/omni/i
}
```

- `shared/llm-presets.d.ts`：给出 `LlmPresetModel`、`LlmProviderPreset` 与函数声明。
- `shared/package.json` 的 `exports` 增加 `"./llm-presets"`。

预设有两处集中可改：`id`/`baseURL`/模型清单。改清单只改这一个文件。

## 5. 前端交互 `web/src/components/ModelSetupCard.vue`（新增，取代旧卡）

**加载**：沿用 `GET /api/llm-admin/opencode`（返回 `{ path, exists, format, raw, config }`）。由新增纯辅助 `web/src/llmPresets.ts` 把配置转成卡片状态：

```ts
export interface ProviderState {
  id: string;
  hasKey: boolean;          // 现有 options.apiKey/apiKeys 非空
  apiKey: string;           // 用户新输入的 key（留空=不改）
  selected: string[];       // 勾选的模型 id（预设 + 手填）
  manual: string[];         // 手填补充的模型 id
}
export function stateFromConfig(config, presets): ProviderState[]   // 每预设一段
export function buildSelections(states): { id, apiKey, models }[]    // 只提交有 key 或勾了模型的
export function modelOptions(states): string[]                       // "provider/model" 供默认模型下拉
```

**渲染**（`ProxyView.vue` 中 `<OpencodeConfigCard>` → `<ModelSetupCard>`）：

- 顶部：文件路径提示（`llm.setup.file`）+「默认模型」下拉/手填（`provider/model`）。
- 每个预设一段（`llm.setup.provider`）：
  - provider 名 + `id`（muted）。
  - **apiKey**：`<input type="password">`；`hasKey` 时 placeholder 显示「已配置」（`llm.setup.key_set`），留空即保留原 key。
  - **模型复选框**：预设清单，vision 模型带「图像」小标签（`llm.setup.vision`）。
  - **补充模型**：一个输入框，逗号分隔（`llm.setup.manual`）；填的 id 也作为勾选项。
- 底部：保存（`llm.setup.save`）/ 已保存（`llm.setup.saved`）；错误行。

**保存**：`buildSelections` → `POST /api/llm-admin/opencode`，成功后重新 `GET` 刷新状态。

## 6. 服务端合并与写入

### 6.1 `server/llm-provider-presets.js`（新增，纯函数）

```js
export function validateSelections(value) // 非法 → 抛 e.code='bad-config'
// 值形如 [{ id, apiKey?, models: string[] }]；id 必须命中预设，models 为字符串数组

export function mergePresetProviders({ current = {}, selections = [], presets = LLM_PROVIDER_PRESETS } = {})
// 返回新的 provider 映射，规则：
// - 从 current 深拷贝起步 → 非预设 provider 原样保留
// - 每个 selection：
//     preset = presetById(id)；无 → 跳过
//     keys = 传入 apiKey 非空 ? [apiKey] : 现有 options.apiKey/apiKeys；keys 为空 → 跳过（不写、计入 skipped）
//     models = {}；对 selection.models 去重逐个：
//         base = 现有 current[id].models?.[mid] ?? {}
//         entry = { ...base }；isVisionModel(id, mid) → entry.attachment = true
//         models[mid] = entry
//     opts = { ...existing.options, baseURL: preset.baseURL }
//     delete opts.apiKey; delete opts.apiKeys
//     keys.length === 1 ? opts.apiKey = keys[0] : opts.apiKeys = keys
//     provider = { ...existing, name: preset.name, options: opts, models }
//     out[id] = provider
// - 返回 { provider: out, skipped: [id...] }
```

- `skipped`：既无 key 又被勾选/存在的预设 provider，供 UI 提示（`llm.setup.need_key`）。
- key 归一复用现有 `normalizeProviderKeys` 语义（1 个 → `apiKey`，多个 → `apiKeys`）。新卡只会传 1 个。

### 6.2 `server/llm-mount.js`（改 POST 语义）

`POST /api/llm-admin/opencode` body 从 `{ provider, model }` 改为：

```json
{ "providers": [ { "id": "deepseek", "apiKey": "", "models": ["deepseek-v4-flash"] } ], "model": "deepseek/deepseek-v4-flash" }
```

处理：`validateSelections` → `current = readActiveConfig({ dir }).config?.provider ?? {}` → `mergePresetProviders` → `mergeAndWrite({ dir, provider, model })`（沿用备份 + 原子写 + 顶层字段保留）。返回 `{ ok, path, backups, config, skipped }`。

`GET /api/llm-admin/opencode` 不变。

### 6.3 `server/llm-opencode-config.js`

- `readActiveConfig` / `mergeAndWrite` / `normalizeProviderKeys` / `validateManaged` **保持不动**（`mergePresetProviders` 的输出仍走 `mergeAndWrite`）。无需新写入逻辑。

## 7. 多模态（图像）规则

- 判定：`isVisionModel(providerId, modelId)`（预设 `vision:true` 或模型名兜底匹配）。
- 写入：命中 → 该模型条目加 `"attachment": true`；未命中不写 `attachment`（保留已有条目里的其它字段）。
- 这样 opencode 收到 `provider.<id>.models.<mid>.attachment=true`，即可在该模型上接收图片附件。

## 8. i18n

- 新增 `llm.setup.*`（中英同时补）：`title`、`file`、`provider`、`key`、`key_set`、`vision`、`manual`、`save`、`saved`、`need_key`、`default_model`、`model_none`、`model_manual`。
- 删除旧 `llm.oc.*`（仅旧卡使用）。
- `npm.cmd run check:i18n` 零命中。

## 9. 测试

- `server/test/llm-provider-presets.test.js`（新）：`validateSelections` 非法结构报错；单 key 归一为 `apiKey`；`apiKey:''` 且已有 key → 保留；无 key → skipped；vision 模型写 `attachment:true`、普通模型不写；非预设 provider 与已有 model 附加字段保留。
- `server/test/llm-mount.test.js`（改）：`POST /api/llm-admin/opencode` 用 `providers` 选择 → 落盘 provider 含预设 baseURL、勾选模型、vision 的 `attachment`；`skipped` 正确；非预设 provider 保留；顶层 `agent` 等保留。
- `server/test/llm-opencode-config.test.js`：不改（`mergeAndWrite` 行为不变）。
- `web/src/llmPresets.test.ts`（新）：`stateFromConfig`（有/无 key、勾选与手填合并）、`buildSelections`（过滤无 key 无模型）、`modelOptions`。
- `web/src/useLlm.test.ts`（改）：`saveOpencodeConfig` 新 payload。
- `web/src/opencodeConfig.ts`：仅保留类型与 `apiKeysOf`，删除旧卡专用的行式辅助（`rowsFromProvider`/`providerFromRows`/`composeModel`/`optionsExtra`/`modelExtra`/`parseJsonObject`/`collectModelOptions` 及相关测试），避免死代码。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web` 全绿。
- 人工验收：面板「极简配置」给 deepseek 填 key、勾 2 个模型（含 vision-exp）→ 保存 → `opencode.json` 中 `deepseek.options.apiKey` 正确、模型子集正确、vision-exp 带 `attachment:true`，且 `plugin/skills/agent/mcp/command` 与 `glm` 之外的既有 provider 未被破坏。

## 10. 文档更新

- 新增本设计文档；配套 `docs/superpowers/plans/2026-09-18-relay-opencode-simple-config.md`。
- `docs/superpowers/specs/2026-09-18-relay-opencode-config-editor-design.md` 与 `plans/2026-09-18-relay-opencode-config-editor.md` 顶部加「已被本设计取代」说明（保留历史）。
- `README.md`「本机 LLM 中转站（relay）」节补一段：本机 provider 用面板「极简配置」写入（每 provider 一个 key + 勾选模型；多模态自动带图像能力）。
- `AGENTS.md` 仅在新增独立模块时补「目录速览」（本次新增 `shared/llm-presets.js`、`server/llm-provider-presets.js`、`web/src/components/ModelSetupCard.vue`，视是否值得列入）。
- 无 CHANGELOG（仓库不存在该文件）。

## 11. 明确不做（YAGNI）

- 不做运行时 `/models` 拉取、模型搜索、能力探测。
- 不做预设 provider 的增删与自定义 baseURL（非预设 provider 只保留不编辑）。
- 不做远程 token 生成的改动。
- 不做 apiKey 加密/掩码接口（沿用现有本地 GET 返回配置的方式）。
- 不做 `temperature`/`limit`/`tool_call` 等模型高级字段的 UI（可视需要手改 JSON）。

## 12. 决策记录

- 交互形态：**新极简卡取代旧 `OpencodeConfigCard`**；token 展开区远程生成**保持不动**（用户明确）。
- apiKey 语义：**各 provider 的上游真实 key**，写入本机 `opencode.json`（用户明确）。
- 模型清单：**内置预设为主、可手填补充**（用户明确）。
- 预设清单：先用本文 §4 初稿（deepseek 沿用本机；glm/qwen/minimax 为初稿），UI 可手填补充（用户确认「ok」）。
- 多模态：**vision 模型写入时加 `attachment: true`**。
