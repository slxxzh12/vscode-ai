# 设计文档：刷新后只恢复最近点击的 N 个页签

日期：2026-09-18
分支：master
状态：已实现

## 1. 需求

用户原文：

> 打开页签的时候，默认不要恢复所有界面，恢复最后点击的 5 个窗口即可
> 默认恢复数字可以配置，默认是 5 个
> 恢复的是 agent 的时候，要把对应的 session 选中
> 根据 sessionid 来恢复一下历史

澄清（上一会话）：范围 = **会话页签 + 文件页签合计**最多 N 个。

## 2. 方案

纯前端，状态存本机 localStorage（与 `devflow-auto-compact`、文件历史一致）：

- `web/src/restorePrefs.ts`（新增）
  - `restoreTabs`：恢复条数，默认 5，范围 1..50，`localStorage['devflow-restore-tabs']`。
  - 最近页签有序表 `localStorage['devflow-recent-tabs']`：`s:<sessionId>` / `f:<projectId>|<path>`，去重置顶、上限 50。
  - 纯函数：`clampRestoreTabs` / `pushRecentTab` / `allowedRestoreIds`（无历史返回 `null` = 不限制，保持旧行为）。
- `web/src/App.vue`
  - setup 时**同步**读最近页签 + 条数 → `bootAllowed`（`Set` 或 `null`）；据此算出 `visibleSessionIds`（会话）并过滤文件页签。同步读取保证 TerminalView 首次 `SESSION_LIST` 前集合已定，避免竞态。
  - `watch(center.activeId)`：恢复完成（`windowRestored`）后把激活页签写入最近表。
  - 修激活竞态：恢复文件页签后不再一律 `setActive(null)`，而是回到当前会话页签（无则置空交给会话 watcher），使 **agent 会话被选中** → 消息面板按 sessionId 过滤显示其历史。
- `web/src/components/TerminalView.vue`
  - 新增 prop `visibleSessionIds`：非 null 时只给这些会话自动建页签；其余会话仍可在历史面板按需打开。
  - `activeSessionId` watcher 改为 `ensureSession + activateSession`：被过滤的会话在打开/切到前台时也能拿到正确标题的页签。
  - 设置面板新增「窗口恢复 → 恢复页签数」数字输入（即时存 localStorage，下次刷新生效）。
- i18n：`term.restore_tabs` / `term.restore_tabs_label` / `term.restore_tabs_hint`（中英）。

## 3. 行为

- 无历史（首次/升级）：`bootAllowed = null` → 恢复全部，行为不变。
- 有历史：只自动恢复最近点击的 N 个（会话+文件合计）；其余会话不显示页签但仍运行，历史面板可打开。
- agent 会话：始终被选中（`SESSION_LIST` 认领 + 显式 `activateSession`），消息面板按 sessionId 显示其历史。

## 4. 测试

- `web/src/restorePrefs.test.ts`：`clampRestoreTabs` / `pushRecentTab` / `allowedRestoreIds` + localStorage 读写。
- `npm.cmd test`（server 639 + web 397）、`typecheck`、`check:i18n` 全过。
