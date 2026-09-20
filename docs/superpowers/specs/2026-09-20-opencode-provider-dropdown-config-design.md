# 设计文档：本机 opencode provider 下拉式配置（已配置回显 + 自定义）

日期：2026-09-20
分支：master
状态：待评审
演进：在 `docs/superpowers/specs/2026-09-18-relay-opencode-simple-config-design.md`（极简配置卡）基础上迭代

## 1. 概述

「LLM 中转站」面板的「极简配置（本机）」卡当前把 `deepseek`/`glm`/`qwen`/`minimax` 四家**平铺**，每家一个 key 输入 + 模型勾选 + 补充模型手填；卡里看不到「本机到底已经配了哪些 provider/模型」，也**无法新增/编辑自定义 provider**（后端校验只认四家预设）。

本次改造：

- 顶部新增 **「添加 Provider」下拉**：列出尚未配置的内置预设（DeepSeek / GLM / Qwen / MiniMax）+「其他·自定义」。
- 选中内置预设 → 自动带出已知 `baseURL` 与模型清单，用户只填 key、勾模型。
- 选「其他·自定义」→ 用户手填 `Provider ID` / `Base URL` / `名称(可选)` / `模型名`（不清楚模型名时可自己输入）。
- **回显已配置**：卡片默认列出本机 `opencode.json` 中**全部** provider（含非预设的自定义 provider），直接渲染成可编辑卡片。
- 每个 provider 卡片可 **「移除」**，保存时从 `opencode.json` 删除。

## 2. 目标与非目标

**目标**

- provider 由「固定四家平铺」变成「按需下拉添加」；已配置的 provider/模型在卡里可见可改。
- 内置预设零手填 baseURL/模型；自定义 provider 支持手填 id/baseURL/模型。
- 支持移除 provider。
- 保留既有极简卡能力：一个 key、模型勾选、补充模型手填、vision 模型自动 `attachment:true`、默认模型选择、`mergeAndWrite` 备份/原子写、顶层字段保留。

**非目标（YAGNI）**

- 不改远程 token 生成/下载（`opencode-config` / `opencode-bundle` / Install.bat）。
- 不做运行时 `/models` 拉取、模型搜索、能力探测。
- 不做 apiKey 加密/掩码接口、多 key 轮询 UI。
- 不做 provider 排序、分组、重命名独立字段等额外管理能力。
- 不新增数据库/持久化结构：唯一事实源仍是本机 `opencode.json`。

## 3. 现状与扩展点

- 卡片组件：`web/src/components/ModelSetupCard.vue`（由 `ProxyView.vue` 引入）。
- 前端纯辅助：`web/src/llmPresets.ts`（`ProviderState` / `stateFromConfig` / `buildSelections` / `modelOptions`）。
- 配置类型与 key 读取：`web/src/opencodeConfig.ts`（`OpencodeConfigJson` / `apiKeysOf`）。
- 前端调用：`web/src/useLlm.ts` 的 `opencodeConfig()` / `saveOpencodeConfig()`。
- 服务端合并：`server/llm-provider-presets.js`（`validateSelections` / `mergePresetProviders`）。
- HTTP 路由：`server/llm-mount.js` 的 `GET/POST /api/llm-admin/opencode`。
- 读写落盘：`server/llm-opencode-config.js`（`readActiveConfig` / `mergeAndWrite`，**本次不动**）。
- 预设单一事实源：`shared/llm-presets.js`（`LLM_PROVIDER_PRESETS` / `presetById` / `isVisionModel`）。
- 既有测试：`web/src/llmPresets.test.ts`、`server/test/llm-provider-presets.test.js`、`server/test/llm-mount.test.js`。

## 4. 前端数据模型 `web/src/llmPresets.ts`

把 `ProviderState` 替换为统一模型：

```ts
export interface ConfiguredProvider {
  id: string;
  name: string;
  baseURL: string;
  custom: boolean;      // true = 非预设，id/baseURL/name 可编辑
  hasKey: boolean;      // 现有 options 里已有 key
  apiKey: string;       // 用户新输入（留空=不改）
  models: string[];     // 该 provider 已启用/勾选的模型 id
  extraModels: string;  // 预设卡的「补充模型」，逗号分隔
}
```

- `providersFromConfig(config)`（由 `stateFromConfig` 改造，读**全部** provider）：
  - 遍历 `config.provider` 的每个 `id`：
    - 命中预设：`custom=false`，`name`/`baseURL` 优先取文件里的值，缺则回退预设。
    - 未命中：`custom=true`，`name=provider.name||id`，`baseURL=options.baseURL||''`。
    - `hasKey = apiKeysOf(options).length > 0`；`apiKey=''`。
    - `models = Object.keys(provider.models || {})`。
  - 预设卡：`models` 中命中预设清单的用于预勾选，其余进 `extraModels`。
- `addablePresets(config)`：返回尚未出现在配置里的预设（供下拉）。
- `buildProviders(list)`：把非移除卡片压成 payload `{ id, name, baseURL, custom, apiKey, models }`，`models = [...models, ...split(extraModels)]` 去重去空。
- `modelOptions(list)`：汇总各 provider 的 `id/model`，供默认模型下拉（排除被移除项）。
- 保留 `presetById` / `isVisionModel` 用法不变。

## 5. 前端交互 `web/src/components/ModelSetupCard.vue`

**加载**：沿用 `GET /api/llm-admin/opencode`，用 `providersFromConfig` 转状态；保留「文件路径 / 缺文件 / JSONC / 非法 JSON」提示与 `reload`。

**结构（自上而下）**

1. 标题 + 「重新读取」+「保存 / 已保存」。
2. 「默认模型」行：保持现有 `select`（`modelOptions`）+ 手填 `input`。若所选默认模型所属 provider 被移除，保存前清空。
3. 「添加 Provider」下拉（`llm.setup.add`）：选项 = `addablePresets` 各项 + 「其他·自定义」（`llm.setup.custom`）。选中即追加一张卡并重置下拉。
4. 已配置卡片列表：无任何 provider 时显示占位（`llm.setup.none`）。每张卡：
   - 头部：`name`（自定义为可编辑输入；预设只读）+ `id · baseURL`（预设只读展示；自定义为输入框）+「移除」按钮（`llm.setup.remove`）。
   - 自定义卡额外字段：`Provider ID`（`llm.setup.provider_id`）、`Base URL`（`llm.setup.baseurl`）、`名称(可选)`（`llm.setup.name`）。
   - API key：`<input type="password">`，`hasKey` 时 placeholder 用 `llm.setup.key_set`，留空即保留原 key。
   - 模型：
     - 预设卡：预设清单勾选框（预勾文件里已有的，vision 带 `llm.setup.vision` 标签）+「补充模型」手填（`llm.setup.manual`）。
     - 自定义卡：单个「模型名（逗号分隔）」手填（`llm.setup.custom_models`）。
   - 「移除」：从列表去掉；若该 `id` 原本存在于文件里，记入 `remove[]`。

**保存**：`POST /api/llm-admin/opencode`，body：

```json
{
  "providers": [ { "id": "deepseek", "name": "DeepSeek", "baseURL": "https://api.deepseek.com/v1", "custom": false, "apiKey": "", "models": ["deepseek-v4-flash"] } ],
  "remove": ["corp"],
  "model": "deepseek/deepseek-v4-flash"
}
```

成功后重新 `GET` 刷新状态，`skipped` 逐条提示（`llm.setup.need_key`）。

## 6. 服务端

### 6.1 `server/llm-provider-presets.js`

- `validateSelections(value)`：
  - 预设 id：沿用现有校验（`apiKey` 字符串、`models` 字符串数组）。
  - 未知 id：允许，但要求 `id` 匹配 `^[A-Za-z0-9._-]+$` 且 `baseURL` 是非空合法 `http(s)` URL。
- `mergePresetProviders` → `mergeConfiguredProviders({ current = {}, selections = [], remove = [], presets = LLM_PROVIDER_PRESETS })`：
  - `out = { ...current }`；先 `for (id of remove) delete out[id]`。
  - 每个 selection：
    - `preset = presetMap.get(id)`；有则 `baseURL = preset.baseURL`、`name = preset.name`；无则用 `sel.baseURL`、`sel.name || id`。
    - `keys = 传入 apiKey 非空 ? [apiKey] : existingKeys(existing.options)`；为空 → `skipped.push(id)`（不写）。
    - `models`：对 `sel.models` 去重逐个，`base = existing.models?.[mid] ?? {}`，`isVisionModel(id, mid)` → `entry.attachment = true`。
    - `opts = { ...existing.options, baseURL }`；`delete opts.apiKey/apiKeys`；按 key 数写 `apiKey` 或 `apiKeys`。
    - `out[id] = { ...existing, name, options: opts, models }`（保留 provider 内未知字段）。
  - 返回 `{ provider: out, skipped }`。

### 6.2 `server/llm-mount.js`

`POST /api/llm-admin/opencode`：读 `remove = Array.isArray(b.remove) ? b.remove : []`；`validateSelections(selections)` → `mergeConfiguredProviders({ current, selections, remove })` → `mergeAndWrite({ dir, provider, model })`；返回 `{ ok, path, backups, config, skipped }`。

`GET /api/llm-admin/opencode` 不变；`server/llm-opencode-config.js` 不动。

## 7. i18n

`shared/i18n/zh-CN.js` + `shared/i18n/en.js` 同步新增（键集合对称）：

- `llm.setup.add`：添加 Provider / Add provider
- `llm.setup.custom`：其他（自定义）/ Custom
- `llm.setup.none`：暂无已配置的 provider / No providers configured
- `llm.setup.remove`：移除 / Remove
- `llm.setup.name`：名称（可选）/ Name (optional)
- `llm.setup.provider_id`：Provider ID / Provider ID
- `llm.setup.baseurl`：Base URL / Base URL
- `llm.setup.custom_models`：模型名（逗号分隔）/ Model IDs (comma separated)

其余复用现有 `llm.setup.*`（`title`/`file`/`key`/`key_set`/`vision`/`manual`/`save`/`saved`/`need_key`/`default_model`/`model_none`/`model_manual`）。提交前 `npm.cmd run check:i18n` 零命中。

## 8. 测试

- `web/src/llmPresets.test.ts`（改）：`providersFromConfig` 读入预设与**自定义** provider、`hasKey`/`models`/`extraModels` 正确；`addablePresets` 排除已配置；`buildProviders` 合并勾选与手填、去重去空、过滤无 key 无模型；`modelOptions`。
- `server/test/llm-provider-presets.test.js`（改）：未知 id 带合法 baseURL 通过校验、缺 baseURL 报错；`mergeConfiguredProviders` 写自定义 provider、保留 provider 内未知字段与 model 附加字段、按 `remove` 删除、无 key 记 `skipped`。
- `server/test/llm-mount.test.js`（改）：`POST` 带 `remove` 与自定义 provider → 落盘符合预期；非法自定义（缺 baseURL）→ 400。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web` 全绿。
- 人工验收：卡片回显本机已配置 provider；下拉新增 deepseek（预填 baseURL/模型）、新增一个自定义 provider（手填 id/baseURL/模型）、移除一个 → 保存后 `opencode.json` 的 `provider` 与预期一致，顶层 `plugin/skills/agent/mcp/command` 及未管理的 provider 未被破坏。

## 9. 文档更新

- 新增本设计文档；配套实现计划 `docs/superpowers/plans/2026-09-20-opencode-provider-dropdown-config.md`。
- `README.md`「本机 provider 配置」一段补：下拉选 provider（预设自动带 baseURL/模型）、支持自定义 provider、可移除、回显已配置。
- AGENTS.md 无新增独立模块，不需改「目录速览」。

## 10. 明确不做（YAGNI）

- 不做运行时模型清单拉取/搜索。
- 不做 provider 排序、分组、批量启用/停用。
- 不做默认模型联动校验之外的高级能力（如按 provider 探测连通性）。
- 不改远程 token 生成/下载链路。

## 11. 决策记录

- 交互形态：**顶部下拉「添加 Provider」 + 已配置 provider 直接渲染成可编辑卡片**（用户确认选项 1）。
- 自定义 provider：**支持手填 id/baseURL/模型并写入 `opencode.json`**（用户明确「支持用户自己输入」）。
- 移除能力：**卡片带「移除」，保存时从配置删除**（用户确认）。
- 实现路线：**方案 A —— 统一数据模型 + 服务端通用合并 `mergeConfiguredProviders`**（用户确认）。
