# 首次添加目录后自动切「目录」页签并启动 Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首次进入（进入时无任何项目）添加第一个目录成功后，左侧自动切到「目录」页签并自动启动默认 Agent。

**Architecture:** 仅改前端编排。`App.vue` 的 `confirmAddFolder()` 记录「添加前项目数是否为 0」，添加成功后切 `historyTab='tree'`，`await nextTick()` 等 `projectId` 传到 `TerminalView`，复用既有 `requestStartAgent()` 意图（`uiIntents.ts`）触发 `TerminalView.onWelcomeNewAgent()` → `startAgent()`。不改服务端、不新增 i18n 词条。

**Tech Stack:** Vue3 + TypeScript + Vite（`vue-tsc` 类型检查、`vitest` 单测）。

**Spec:** `docs/superpowers/specs/2026-09-21-first-run-add-project-kickoff-design.md`

---

## 文件结构

| 文件 | 职责 | 改动 |
| --- | --- | --- |
| `web/src/App.vue` | 应用装配与左侧页签/项目编排 | `confirmAddFolder()` 首次判定 + 切页签 + 起 Agent；新增 import |

无新增文件、无测试文件（改动为 `App.vue` 编排逻辑，已确认不新增自动化测试）。

---

### Task 1: `App.vue` 首次添加目录后触发引导

**Files:**
- Modify: `web/src/App.vue:28`（imports）
- Modify: `web/src/App.vue:539-548`（`confirmAddFolder`）

- [ ] **Step 1: 新增 import**

在 `web/src/App.vue` 现有 import 区（第 28 行 `import { allowedRestoreIds, loadRecentTabs, loadRestoreTabs, pushRecentTab, saveRecentTabs } from './restorePrefs';` 之后）加一行：

```ts
import { requestStartAgent } from './uiIntents';
```

（`nextTick` 已在第 2 行从 `vue` 导入，无需重复。）

- [ ] **Step 2: 改写 `confirmAddFolder()`**

把 `web/src/App.vue` 第 539-548 行的函数替换为：

```ts
async function confirmAddFolder() {
  const p = addPath.value.trim();
  if (!p) return;
  const wasFirst = projects.value.length === 0;   // 添加前是否无项目：仅首次添加目录触发引导
  try {
    const proj = await projectsApi.add(p);
    await loadProjects();
    if (proj?.id) selectProject(proj.id);
    addOpen.value = false;
    if (wasFirst && proj?.id) {
      historyTab.value = 'tree';                  // 左侧切到「目录」页签（FileTree）
      await nextTick();                           // 等 currentProject 传导到 TerminalView 的 projectId
      requestStartAgent();                        // 复用「新建 Agent」意图，自动启动默认 Agent
    }
  } catch (e) { alert(t('top.add_failed', { msg: (e as Error).message || String(e) })); }
}
```

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过，`vue-tsc` 无错误。

- [ ] **Step 4: 全量回归**

Run: `npm.cmd test`
Expected: server + web 全绿。

- [ ] **Step 5: 手工验收**

前置：停掉 dev 后端；清空当前端口数据档案的 `projects.json`（Windows 默认 `%USERPROFILE%\.local\share\void\ports\33333\projects.json`）后 `npm.cmd run dev`。

1. 首次进入 → 弹「添加目录」（多 Agent 未选默认时先弹设置，关闭后再弹）。
2. 选择/输入一个目录并确认。
Expected：
- 左侧内页签自动停在「目录」（文件树 `FileTree`，而非「消息」）；
- 中心区自动新建并激活默认 Agent 会话，无需再点「＋ 新建 Agent」。
3. 再点顶栏「＋」添加第二个目录并确认。
Expected：不自动切页签、不自动起 Agent（`wasFirst` 为假）。

- [ ] **Step 6: 提交（仅在用户明确要求时执行）**

```powershell
git add web/src/App.vue docs/superpowers/specs/2026-09-21-first-run-add-project-kickoff-design.md docs/superpowers/plans/2026-09-21-first-run-add-project-kickoff.md
git commit -m "feat(web): 首次添加目录后自动切目录页签并启动 Agent"
```

> 按仓库/会话约定，未经用户明确要求不自动 commit；提交前执行 `docs/learn/git仓库提交检查和提交事项.md` 的检查清单（尤其敏感信息扫描）。

---

## Self-Review

- **Spec coverage**：
  - 触发范围（仅进入时无项目添加第一个目录）→ Task 1 Step 2 的 `wasFirst`。
  - 左侧切「目录」→ `historyTab.value = 'tree'`。
  - 自动启动 Agent → `requestStartAgent()` + 既有 `onWelcomeNewAgent`。
  - nextTick 时序保证 → Task 1 Step 2。
  - 不改后端/无新词条 → 文件结构仅 `App.vue`。
- **Placeholder scan**：无 TBD/TODO，代码步骤均给出完整代码与确切命令。
- **Type consistency**：`wasFirst: boolean`、`historyTab`（`ref<'files'|'messages'|'tree'>`）、`requestStartAgent(): void`、`proj?.id: string | undefined` 均与现有定义一致。
