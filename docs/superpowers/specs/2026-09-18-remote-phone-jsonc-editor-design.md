# 设计文档：手机页 JSONC 输入面板（格式说明 + 存放位置 + 追加提交）

日期：2026-09-18
分支：master
状态：待评审
前置：`docs/superpowers/specs/2026-09-18-remote-phone-live-terminal-design.md`（手机页实时终端）、`docs/superpowers/specs/2026-09-17-remote-coder-delivery-design.md`（deliver 条目）

## 1. 概述

在手机遥控页（`/?phone=1`）上增加一个 **JSONC 输入面板**：把 `remote_coder/messages.jsonc` 的**格式定义**与**真实存放位置**展示出来，并允许直接在面板里粘贴/编辑 JSONC 条目并提交追加。

沿用现有手机遥控的约束：手机与桌面端通过 `remote_coder/messages.jsonc` 通信，桌面端每 2s 拉 `/api/remote-coder/inbox` 取件并消费（与手机页现有的「截图」「发消息」「打包」完全同一条通道）。

已与用户确认的决策（逐条见第 9 节）：

- 形态：**可输入的 JSONC 编辑区**（不只是只读说明）。
- 提交语义：**追加条目**到 `messages.jsonc` 末尾（不整体覆盖）。
- 输入形状：**对象或数组都接受**（数组 = 一次多条）。
- kind 白名单：`message` | `screenshot` | `deliver`；只取 `kind`+`text`，其余字段忽略，`id`/`ts`/`handled` 由服务端补。
- 存放位置：展示**真实绝对路径**。
- 呈现方式：顶栏 `{}` 按钮打开**覆盖层面板**。
- 格式说明程度：**可复制示例 + 字段表**。

## 2. 界面与交互

手机页 `PhoneView.vue` 顶栏（现有标题 + 「截图」按钮旁）新增 `{}` 按钮；点击打开覆盖层面板，关闭回到终端。面板自上而下：

1. **格式说明**
   - 三段可复制示例：`message` / `screenshot` / `deliver`（每段带「复制」按钮）。
   - 字段表：`id`、`ts`、`kind`、`text`、`handled` 的说明与约束。
2. **存放位置**
   - 展示服务端返回的真实绝对路径（`.../remote_coder/messages.jsonc`），带「复制」按钮。
3. **编辑区**
   - 多行文本框，占位提示「粘贴对象或数组，如 `{ "kind": "message", "text": "继续" }`」。
   - 「追加」按钮 + 状态行（成功 / 失败原因）。
   - 提交成功后清空文本框并提示「已追加 N 条」。

面板所有用户可见文案走 i18n（zh-CN + en，键集合对称）。

## 3. 提交语义与校验

- 编辑框内容按 **JSONC** 解析（允许整行 `//` 注释，复用 `parseJsonc`）。
- 解析结果：
  - 是**对象** → 视为一条；
  - 是**数组** → 逐个视为条目（一次多条）；
  - 其它（数字/字符串/布尔/null）→ `bad-entry`。
- 每个条目必须是普通对象，否则 `bad-entry`。
- `kind`：缺失按 `message`；显式出现且不在 `{message, screenshot, deliver}` → `bad-kind`。
- `text`：仅 `message` 要求非空（trim 后），否则 `bad-message`；UTF-8 字节数 > 32KB → `too-large`。
- **只取 `kind`+`text`**：输入里的 `id`/`ts`/`handled` 及其它任何字段一律忽略，服务端用 `makeEntry` 补 `id`/`ts`/`handled:false`。
- 逐条 `appendMessage` 追加到 `remote_coder/messages.jsonc`；返回 `{ ok, added, ids }`。
- 追加后与手机页现有按钮产生的条目**完全同构**，桌面端 `/inbox` 下一轮即消费（`screenshot` → 截图、`deliver` → 打包、`message` → 送当前活动会话）。

## 4. 服务端

### 4.1 `server/remote-coder-store.js`

- 新增 `normalizeEntries(raw, now, rand)`：接受对象或数组，按第 3 节规则校验并返回条目数组（内部调用 `makeEntry`）。抛出错误码：`bad-entry` / `bad-kind` / `bad-message` / `too-large`。
- 复用现有 `parseJsonc`、`appendMessage`、`MESSAGES_FILE`、`dirOf`，不新增文件。

### 4.2 `server/remote-coder-mount.js`（新增两个端点）

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| GET | `/api/remote-coder/info` | — | `{ dir, messagesFile }`（绝对路径） |
| POST | `/api/remote-coder/messages` | `{ text }`（原始 JSONC 文本） | `{ ok, added, ids }` |

- `/info`：`dir = store.dirOf(repoRoot)`、`messagesFile = path.join(dir, store.MESSAGES_FILE)`。
- `/messages`：`parseJsonc(text)` → `normalizeEntries` → 逐条 `appendMessage` → `{ ok, added, ids }`。
- 错误映射：`bad-jsonc` / `bad-entry` / `bad-kind` / `bad-message` → 400（带 `message`）；`too-large` → 413；其余 500。
- 两个端点都在 `/api/remote-coder/*` 前缀下，沿用现有远端访问门禁，不新增豁免。

## 5. 前端

### 5.1 `web/src/remote-coder/useRemoteCoder.ts`

- `fetchRemoteInfo(deps)` → `GET /info`，返回 `{ dir, messagesFile }`（失败回退空串，与 `fetchScreenRev` 同风格）。
- `appendMessages(text, deps)` → `POST /messages { text }`，成功返回 `{ added, ids }`，失败抛出 `message`/`error`（复用现有 `postJson` 的错误口径）。

### 5.2 `web/src/remote-coder/PhoneView.vue`

- 顶栏新增 `{}` 按钮（`aria-label` + 标题走 i18n）。
- 覆盖层面板组件化：`web/src/remote-coder/JsoncPanel.vue`（面板内聚：示例、字段表、路径、编辑框、状态），`PhoneView` 只负责开关与传入 `fetch` 依赖。
- 复制用 `navigator.clipboard.writeText`，失败静默降级（不阻塞）。

### 5.3 i18n 词条（中英同时补齐，键集合对称）

面板标题/开关、格式说明标题、示例标签、字段表标题、路径标签、复制/已复制、编辑框占位、追加按钮、成功（含 `{n}`）、失败（含 `{msg}`）、关闭。示例代码块内的 JSON 字段名（`id`/`ts`/`kind`/`text`/`handled`）为技术标识，不翻译。

## 6. 测试与验收

- `server/test/remote-coder-store.test.js`：`normalizeEntries` 支持对象/数组；非法 kind 抛 `bad-kind`；`message` 空 `text` 抛 `bad-message`；输入里的 `id`/`ts`/`handled`/多余字段被忽略；数组含非对象元素抛 `bad-entry`。
- `server/test/remote-coder-mount.test.js`：`GET /info` 返回绝对路径；`POST /messages` 成功追加（`added`/`ids` 正确、文件里能读到）；坏 JSONC / 非法 kind → 400；`too-large` → 413。
- `web/src/remote-coder/useRemoteCoder.test.ts`：`appendMessages` 的 POST 形状与错误抛出；`fetchRemoteInfo` 正常/失败回退。
- `web/src/remote-coder/PhoneView.test.ts`：点 `{}` 打开面板；提交成功清空并提示「已追加 N 条」；失败提示原因。
- 人工验收（dev，端口 33333）：手机页打开面板 → 看到格式说明与真实路径 → 粘贴 `[{ "kind": "message", "text": "继续" }]` 提交 → `remote_coder/messages.jsonc` 末尾出现该条目且 `handled` 被桌面端回填 → 桌面当前会话收到「继续」。
- 全绿：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web`。

## 7. 边界与取舍

- **JSONC 注释会被重写丢失**：服务端写回时按纯 JSON 序列化（沿用现状）。
- **`deliver`/`screenshot` 可被面板触发**：与按钮等价，是用户明确选择；面板不额外做二次确认。
- **绝对路径暴露**：面板展示服务端真实路径，属用户明确选择；仅在已通过访问门禁的页面可见。
- **不做历史编辑/删除**：只追加，不覆盖、不删除已存在条目（选 1 的直接结果）。
- **不做逐条 diff / 结果回写**：提交只回 `added`/`ids`，不展示条目在桌面端的处理结果（仍靠「截图」看终端）。

## 8. 明确不做

- 不整体覆盖 `messages.jsonc`，不做删除/编辑已有条目。
- 不做客户端本地 schema 校验预览（以服务端校验为准）。
- 不做自动补全 / 语法高亮编辑器（纯 textarea）。
- 不新增 WS 通道、不做服务端文件 watcher。
- 不改变现有「截图」「发消息」「打包」按钮行为。

## 9. 决策记录

- 形态 = 可输入的 JSONC 编辑区：用户选择（选项 2）。
- 提交 = 追加条目：用户选择（选项 1）。
- 输入形状 = 对象或数组都接受：用户选择（选项 3）。
- kind = 三种白名单、只取 kind+text：用户选择（选项 2）。
- 存放位置 = 真实绝对路径：用户选择（选项 1）。
- 呈现 = 覆盖层面板：用户选择（选项 1）。
- 格式说明 = 示例 + 字段表：用户选择（选项 1）。
