# 群聊图片消息 + 统计截图多模态识别写库 Implementation Plan

> **For agentic workers:** 按 superpowers:executing-plans 逐 Task 执行（inline，本会话内）。Steps 用 checkbox（`- [ ]`）跟踪。

**Goal:** 协作群聊支持发图；统计截图经多模态识别写回用量库（带 source 标记）并上报；stats 命令在 git 根目录执行。

**Architecture:** 复用现有聊天管线（base64 内嵌 `meta.b64`）+ 复用 translate 的多模态链路 + `usage` 表加 `source` 列。

**Tech Stack:** Node ESM、`node:test`、`node:sqlite`、Vue3+TS、i18n 中英对称。

**Spec:** `docs/superpowers/specs/2026-09-23-collab-image-upload-design.md`

**约定:** 仓库根执行；`npm.cmd`；每 Task 一提交；测试先失败后实现。

---

### Task C: stats 命令 git 根目录 cwd（先做，独立无依赖）

**Files:**
- Modify: `server/collaboration/agent-stats.js`
- Test: `server/test/agent-stats.test.js`

- [ ] Step 1: 追加失败测试 `resolveStatsCwd`（临时目录造 `.git`，验证向上找根；无 git 回退 home）
- [ ] Step 2: 运行 `node --test "server/test/agent-stats.test.js"` 确认失败
- [ ] Step 3: 实现 `resolveStatsCwd` + `collectAgentStats`/`probeAgentStats` 默认 `cwd` 改用之
- [ ] Step 4: 运行测试通过

---

### Task A: 群聊图片消息

**Files:**
- Modify: `web/src/collaboration/types.ts`
- Modify: `server/collaboration/engine.js`（`_extendChat` 加 `sendImage`）
- Modify: `server/collaboration/http-mount.js`
- Modify: `web/src/collaboration/useCollab.ts`
- Modify: `web/src/collaboration/GroupChatView.vue`
- Test: `server/test/collab-chat-image.test.js`（或并入现有 engine 测试）
- Test: `web/src/collaboration/GroupChatView.test.ts`（如存在）

- [ ] Step 1: 追加失败测试（server：`sendImage` 构造/广播/落库；endpoint 接受 raw 体）
- [ ] Step 2: 运行确认失败
- [ ] Step 3: 实现 server：`types.ts` 加 kind；`engine.sendImage`；`http-mount` 端点
- [ ] Step 4: 实现 web：`useCollab.sendImage`；`GroupChatView` 发图按钮 + 渲染缩略图/点击放大
- [ ] Step 5: 运行 server/web 测试通过

---

### Task B: 统计截图多模态识别写库（source 标记）

**Files:**
- New: `server/usage-vision.js`
- Modify: `server/usage-store.js`
- Modify: `server/usage-peers.js`
- Modify: `server/usage-report.js`
- Modify: `server/usage-mount.js`
- Modify: `web/src/collaboration/usagePeers.ts`
- Modify: `web/src/collaboration/UsageProbeDialog.vue`
- Modify: `web/src/collaboration/MemberUsageTable.vue`
- Test: `server/test/usage-vision.test.js`
- Test: `server/test/usage-store.test.js`（source 迁移）
- Test: `server/test/usage-report.test.js`（reportImage）

- [ ] Step 1: 追加失败测试（store source 列迁移/写入；`reportImage` 上报带 source；`usage-vision` 解析 JSON）
- [ ] Step 2: 运行确认失败
- [ ] Step 3: 实现 `usage-store` source 列 + 迁移
- [ ] Step 4: 实现 `usage-peers` / `usage-report`（`submit` 重构 + `reportImage`）
- [ ] Step 5: 实现 `usage-vision`（provider/vision 模型解析 + chat/completions + JSON 解析）
- [ ] Step 6: 实现 `usage-mount` 的 `POST /api/usage/image`
- [ ] Step 7: 实现 web：`usagePeers.ts` 加 source；`UsageProbeDialog` 截图识别按钮；`MemberUsageTable` 图片小标识
- [ ] Step 8: 运行测试通过

---

### Task i18n + 收尾

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] Step 1: 补齐中英词条（发图、图片消息、截图识别、图标 title、错误提示）
- [ ] Step 2: `npm.cmd run check:i18n`
- [ ] Step 3: `npm.cmd run typecheck`
- [ ] Step 4: `npm.cmd test` 全量通过
