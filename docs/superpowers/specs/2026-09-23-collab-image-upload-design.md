# 群聊图片消息 + 统计截图多模态识别写库 设计

> 日期：2026-09-23
> 范围：协作群聊、用量统计采集、多模态识别、SQLite 用量表

## 背景与目标

群成员的用量（sessions / messages 等）目前只能靠自动采集（`opencode stats` / `nga stats` 命令）上报给 master。实际使用中：

1. 统计命令偶发采集失败，或需要人工确认命令输出；
2. 用户希望「启动命令时」能手动截图，把统计结果发给 master。

本设计落地三项能力：

- **A. 群聊发图**：协作群聊里可发送图片消息，全群可见（缩略图 + 点击放大）。
- **B. 统计截图多模态识别写库**：统计侧的截图经多模态模型识别出 sessions/messages 等数字，写回本机用量库并上报 master；数据库记录「采集来源」。
- **C. stats 命令在 git 根目录执行**：执行 `nga stats` / `opencode stats` 时，若当前工作目录在 git 仓库内，用 git 根目录作为命令 cwd。

## A. 群聊图片消息

### 数据模型
- `web/src/collaboration/types.ts` 的 `CollabChatKind` 增加 `'image'`。
- 消息形态：`{ id, groupId, kind:'image', fromId, text:<文件名>, toId:null, ts, seq, meta:{ name, mime, size, b64 } }`。
- `meta.b64` 携带 base64 图片；`text` 只放文件名（`_logMessage` 只记 `message: msg.text`，二进制不进消息历史库）。

### 服务端
- `engine.sendImage({ groupId, name, mime, data })`（`server/collaboration/engine.js` `_extendChat` 内）：
  - 校验成员（`_requireMember`）、`Buffer` 非空、大小 ≤ 8MB、mime 白名单（png/jpeg/gif/webp）。
  - 构造 image 消息 → `store.addChatMessage` + `_broadcastChat` + `_emit('chat')`；`_isHub` 时 `_logMessage(text=name)`。
- 复用现有聊天管线：`_inChatSend` / `_inChatPull` / `applyChatPull` 原样透传整条消息（含 `meta`），无需新增对端协议。

### HTTP
- `POST /api/collab/groups/:id/image?name=&mime=`，raw 二进制体。
- `server/collaboration/http-mount.js`：把 `isFileUpload` 判定扩展到 `image`（跳过 JSON 解析），`readRaw` 读体；调 `engine.sendImage`。

### 前端
- `useCollab.sendImage(groupId, name, mime, blob)`：POST raw，错误处理与 `sendGroupFile` 一致。
- `GroupChatView.vue`：输入框旁「发图」按钮 → `<input type=file accept="image/*">` → 发送后刷新聊天流；`kind:'image'` 渲染缩略图，点击放大（lightbox）。

## B. 统计截图多模态识别写库

### 多模态识别
- 新模块 `server/usage-vision.js`：
  - 复用 `translate.js` 的 `loadOpencodeProviders` / `resolveApiKeys` / `buildMessages`，`shared/llm-presets.js` 的 `isVisionModel`。
  - 从 opencode.json 取默认 provider（`model` 字段或首个 provider），优先挑视觉模型，否则回退默认模型。
  - 直连 `<baseURL>/chat/completions`，固定 system prompt 让模型只返回 JSON：`{"sessions":..,"messages":..,"days":..,"totalCost":..,"input":..,"output":..,"cacheRead":..,"cacheWrite":..}`（缺失用 null）。
  - 解析 JSON、数字归一化；错误码沿用 translate 风格（`no-provider`/`no-key`/`bad-model`/`timeout`/`upstream`/`empty-result`/`bad-json`）。
- 端点 `POST /api/usage/image`（raw 图片体，`usage-mount.js` 内新增；图片大小上限 10MB）。

### 写库 + 上报
- `usage-report.js` 重构：抽出 `submit(usageClean)`（本地 `peers.upsert` + POST master `/api/usage/report`）；`reportNow()` = 采集 → `submit`；新增 `reportImage(usage)` = `submit({ ...usage, source:'image' })`。
- 上报体 `usage` 带 `source`，master 端 `peers.upsert` 同样落 `source`。

### 数据库 source 列
- `server/usage-store.js`：`usage` 表加 `source TEXT`（默认 `'auto'`）；`CREATE TABLE IF NOT EXISTS` 新库直接带列；老库用 `ALTER TABLE ... ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'`（检测列不存在时执行）。
- `ALL` / `COL` / `UPDATES` / `put` / `toRow` / `dailyRow` / `normalizeUsage` 均带上 `source`。
- `usage-peers.js`：`upsert` / `upsertDaily` 透传 `source`。
- 取值约定：`'auto'`（命令采集）| `'image'`（图片识别）。

### 前端
- `usagePeers.ts` 的 `CollabUsage` 加 `source?: 'auto' | 'image'`。
- `UsageProbeDialog.vue`：加「截图识别统计」按钮 → 文件选择器 → `POST /api/usage/image` → 展示识别结果（数字）并提示已写入/上报；识别失败展示错误。

## C. stats 命令 git 根目录 cwd

- `server/collaboration/agent-stats.js` 新增 `resolveStatsCwd({ startDir = process.cwd(), home = os.homedir(), exists = fs.existsSync })`：
  - 从 `startDir` 逐级向上找 `.git`（目录或文件，兼容 worktree/submodule），命中返回该目录；否则回退 `home`。
- `collectAgentStats` / `probeAgentStats` 默认 `cwd` 改为 `resolveStatsCwd()`（`cwd` 仍可注入，测试不受影响）。

## 界面图标

- `MemberUsageTable.vue`：`source === 'image'` 的机器行在机器名旁加小图片标识（带 title 提示「图片识别采集」）。

## i18n

中英对称补齐（`shared/i18n/zh-CN.js` + `en.js`）：
- 发图按钮、图片消息 alt /「点击放大」；
- 探针「截图识别统计」、识别中 / 成功 / 失败 / 无视觉模型；
- 图标 title「图片识别采集」。

## 测试

- server：`agent-stats` 的 `resolveStatsCwd` 单测；`usage-vision` 解析/识别单测；`usage-store` 的 `source` 列迁移/写入单测；`usage-report` 的 `reportImage` 单测；`engine.sendImage` 单测 + `http-mount` image 端点测试。
- web：`sendImage` 调用、图片消息渲染、探针「截图识别统计」按钮、`MemberUsageTable` 图标 vitest。

## 取舍说明

- **图片传输**：base64 内嵌聊天消息（data URI 直显），复用整条广播/拉取/落库链路，各节点离线也有图；代价是群聊 store JSON 变大，用 8MB 上限 + 低频操作兜住。
- **统计截图**：只做 OCR 识别 + 写库上报，不把截图作为群聊图片另发（发图走 A 的通用按钮）。
- **source 粒度**：按行（每天每条）存，最后写入者覆盖；成员表图标反映最新快照来源。
