# 设计文档：协作页清理（移除免确认白名单 + master 文件列表折叠）

日期：2026-09-12
分支：master
状态：已确认（用户明确：整条白名单功能删除；master 文件列表移到底部并默认折叠）

## 1. 概述

对协作页 `web/src/collaboration/GroupView.vue` 及其后端做两处调整：

1. **删除「本机免确认命令（白名单）」整条功能**：服务端不再有命令前缀白名单与自动执行；所有远程命令一律进入待确认（pending），由本机 approve 后才执行。
2. **「共享目录（master）」文件列表移到底部并默认折叠**：列表含 `usage.json` 等，改为左栏最后一个区块，用 `<details>` 默认收起。

## 2. 改动点

### 2.1 后端

- `server/collaboration/store.js`
  - `defaultData()` 删除 `commandAllowlist: []`。
  - 删除 `listAllowlist()` / `addAllowEntry()` / `removeAllowEntry()` / `isAllowed()`。
  - 旧数据文件里的 `commandAllowlist` 字段保留无害（加载时不被读取）。
- `server/collaboration/engine.js`
  - `_inCmdReq`：删除 `if (this.store.isAllowed(text)) { auto-run }` 分支，一律 `addPendingCmd` + `_emit('cmd-pending')`。
  - 删除 `engine.listAllowlist` / `engine.allowCmd` / `engine.disallowCmd`。
- `server/collaboration/http-mount.js`
  - 删除 `GET/POST /api/collab/allowlist`、`DELETE /api/collab/allowlist/:prefix` 三条路由。

### 2.2 前端

- `web/src/collaboration/useCollab.ts`
  - 删除 `allowlistState`、`loadAllowlist`、`addAllow`、`removeAllow` 及返回对象中的对应项。
- `web/src/collaboration/GroupView.vue`
  - 删除白名单 `<div class="sec allow">` 区块、`newPrefix`/`myAllow`/`addAllowPrefix`/`delAllowPrefix`，以及 `onMounted` 中的 `loadAllowlist()` 调用。
  - 把「共享目录（master）」`<div class="sec">` 移到左栏最后，改为 `<details class="sec fold">`（默认不展开）；`<summary>` 放标题，内容保持原样（同步按钮、`dlMsg`/`installMsg`、文件行）。
  - 新增折叠样式：隐藏 summary 默认 marker、可点击。
  - `onMounted` 仍预取 `loadDownloads()`，展开时数据已就绪。

### 2.3 i18n

- 删除 `collab.allow.title` / `collab.allow.placeholder` / `collab.allow.empty`（`shared/i18n/{zh-CN,en}.js`，中英对称）。

## 3. 测试

- `server/test/collab-store.test.js`：`pendingCmds 与 allowlist` 改为 `pendingCmds`（保留 pending 增删查，删除白名单断言）。
- `server/test/collab-chat.test.js`：删除「白名单命中自动执行并回结果」用例；「未命中白名单 → B 产生 pending，approve 后执行」改名为「远程命令 → B 产生 pending，approve 后执行」并保留 pending→approve 流程。
- `server/test/collab-http.test.js`：删除 allowlist 的 POST/GET 断言；远程执行段改为「发送命令 → 等待 → 有 pending → approve → 产生 cmd-result → pending 清空」。
- 全量：`npm.cmd test:server`、`test:web`、`typecheck`、`check:i18n`、`build:web` 全绿。

## 4. 行为与边界

- 删除白名单后，**所有远程命令都需要本机确认**（安全默认）。
- 已存在的数据文件含 `commandAllowlist` 字段不影响加载（无迁移、无清理）。
- `/api/collab/cmds`（pending 列表）与 `/cmds/:id/approve` 保持不变。
- 折叠列表默认收起，不影响数据预取与同步逻辑。

## 5. 决策记录

- 白名单删除范围：**整条功能删除**（含服务端自动执行、接口、前端区块、i18n、测试）（用户明确）。
- master 文件列表：**移到底部 + 默认折叠**（用户明确）。

## 6. 终端输入框空白发送

- `web/src/components/TerminalView.vue` 的 `submitComposer()`：输入框空白时不再 `return`，改为用 `ok` 作为内容发送（`const text = composerText.value.trim() || 'ok'`），并照常清空输入框、落历史、发送。发送按钮本就未禁用。
- 协作群聊 `GroupChatView.vue` 的 `submit()` 已实现「空白 → `ok`」，无需改动。

