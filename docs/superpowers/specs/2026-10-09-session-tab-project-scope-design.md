# 会话页签按目录显隐设计

## 背景

主区终端页签由 `web/src/components/TerminalView.vue` 把 `terminal.state.sessions` 同步进 `web/src/useCenter.ts` 的 `center.tabs`；页签条渲染 `center.tabs`。每个会话在服务端记录了 `projectId`（创建时的项目/目录，见 `server/session-manager.js` 的 `summary()`）。

现状：顶部「目录」下拉切换项目时，`TerminalView` 只重建「固定 Agent 会话」（`watch(() => props.projectId)`，`TerminalView.vue:646`），**不隐藏/关闭其它目录创建的会话页签**。于是切到 B 目录时，A 目录的 opencode/nga/shell 会话仍留在页签条里，容易误操作到错误目录。

用户诉求：新建会话时记录其初始化目录；切换目录时，初始目录不一致的会话页签**隐藏**（不终止进程），只保留与当前目录一致的；切回原目录时页签重现。

## 目标

- 会话页签绑定其创建目录（`session.projectId`）。
- 当前目录（`props.projectId`）变化时，`projectId` 不匹配的会话页签隐藏；文件/工具页签不受影响。
- 隐藏仅作用于显示层，**不 kill 会话进程**；切回原目录页签自动重现。
- 当前活动页签若被隐藏，自动切到当前目录可见页签；无可见会话则回落到欢迎页。

## 非目标（YAGNI）

- 不按目录过滤文件页签 / 工具页签 / 本地文件页签。
- 不改服务端（进程照常存续，`sessions` 列表不变）。
- 不改「全部会话」历史树（`msgHistory`）与恢复逻辑。
- 不新增用户可见文案（无 i18n 新增）。

## 设计

### 一、`useCenter.ts`：项目作用域 + 可见页签

- `CenterTab` 已有可选 `projectId?: string | null`；会话页签建立时写入。
- `ensureSession(sessionId, label, state, projectId?)`、`activateSession(sessionId, projectId?)` 增加可选 `projectId` 形参，写入页签。
- 新增：
  - `const scopeProjectId = ref<string | null>(null);`
  - `const sameScope = (a: string | null | undefined, b: string | null | undefined) => (a ?? '') === (b ?? '');`
  - `const visibleTabs = computed(() => tabs.value.filter((t) => t.kind !== 'session' || sameScope(t.projectId, scopeProjectId.value)));`
- `activeSessionTab` 改为从 `visibleTabs` 取首个会话页签。
- `removeSession` / `closeFile` / `closeById` 的活动回退：优先 `activeSessionTab`（可见），其次 `visibleTabs` 首个，最后 `null`。
- 导出 `scopeProjectId`、`visibleTabs`。

> 说明：文件/工具/本地页签不带 session 语义，一律放行，保持原行为。

### 二、`TerminalView.vue`：写入目录 + 同步作用域 + 活动兜底

- 新增辅助 `sessionProjectId(id: string): string | null`（从 `terminal.state.sessions` 查 `projectId ?? null`）。
- 所有 `center.ensureSession(id, label, state)` 调用补第 4 参 `sessionProjectId(id)`；`activateSession(id)` 同理补 `sessionProjectId(id)`。
  - 落点：`knownSessions` watcher（`~1103`）、`tabNames` watcher（`~1116`）、`activeSessionId` watcher（`~1125`）、`createNew`（`~502`）、`startAgent`（`~611`）、`onTabClick`（`~1170`）、`showHistoryTab` 等既有 `ensureSession/activateSession` 处。
- 页签条模板 `v-for="t in center.tabs.value"` → `v-for="t in center.visibleTabs.value"`。
- `watch(() => props.projectId)`（已有，`~646`）：在既有「不自动重启 Agent」逻辑之外，增加：
  - `center.scopeProjectId.value = props.projectId;`
  - 若 `center.activeId` 不属于 `visibleTabs` → 激活首选可见项：优先当前目录的固定 Agent 会话（`agentSid` 且其 `projectId===props.projectId`），否则 `visibleTabs` 中首个，否则 `center.setActive(null)` 并 `terminal.setOutput(null)` 显示欢迎页。
- `showWelcome` 由 `center.tabs.value.length === 0` 改为 `center.visibleTabs.value.length === 0`。
- 挂载时同步一次 `center.scopeProjectId.value = props.projectId`（避免首帧全部会话都可见再跳变）。

### 三、进程保留

- 全程不调用 `terminal.killSession`。隐藏只是渲染过滤，服务端 `sessions` 与 pty 不变；切回目录 `visibleTabs` 重新纳入该会话页签。

## 影响文件

- 改 `web/src/useCenter.ts`
- 改 `web/src/useCenter.test.ts`
- 改 `web/src/components/TerminalView.vue`

## 测试计划

- `useCenter.test.ts`：
  - `visibleTabs`：session 页签按 `scopeProjectId` 过滤；文件/工具页签始终可见；`null` 与 `''` 视为同一作用域。
  - 切换 `scopeProjectId` 后 `visibleTabs` 随之变化。
  - 活动回退：删除/关闭当前活动页签时，兜底只落在 `visibleTabs` 内（不落到隐藏会话页签）。
- `TerminalView` 现有测试保持通过（页签渲染改可见集合后不回归）。
- 全量：`npm.cmd test`、`npm.cmd run typecheck`。
- 手工：项目 A 开两个会话 → 切到 B → A 的会话页签消失、B 无页签显示欢迎页 → 切回 A → A 的会话页签（含进程输出）原样重现。
