# 设计文档：首次添加目录后自动切「目录」页签并启动 Agent

日期：2026-09-21
分支：master
状态：已与用户确认方案（待实现）

## 1. 概述

首次进入（进入时当前没有任何项目）时，用户添加第一个目录成功后，希望：

1. 左侧内页签自动切到「目录」（文件树 `FileTree`）；
2. 同时自动启动默认 Agent（等价于点欢迎页的「＋ 新建 Agent」），无需用户再手动点击。

需求原文（用户）：

> 第一次进入进来之后，用户添加目录之后，左边的页签切换的目录页签，同时 Agent 开始点击展示

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 触发范围 | 仅「进入时当前没有任何项目」时添加的第一个目录；之后再加目录、或刷新/已有项目时添加，均不触发 |
| 2 | 左侧页签 | 切到「目录」= `historyTab = 'tree'`（`HistoryList` 的 `tree` 页签渲染 `FileTree`） |
| 3 | Agent | 自动启动默认 Agent，用户无需点击 |
| 4 | 实现方式 | 复用现有 `requestStartAgent()` 意图 + `TerminalView` 的 `onWelcomeNewAgent()`；不改后端、不新增词条 |

## 3. 现状（改动前）

- `web/src/App.vue` 的 `historyTab` 默认值：非新窗口为 `'tree'`，**新窗口为 `'messages'`**（第 149 行）；`confirmAddFolder()`（第 539 行）添加成功后只做 `loadProjects()` + `selectProject()`，不会切换左侧页签。
- 添加目录后中心区无会话页签 → `TerminalView` 显示 `WelcomeView`（`showWelcome = tabs.length === 0`，第 534 行），需用户手动点「＋ 新建 Agent」才执行 `startAgent()`（`onWelcomeNewAgent`，第 535-539 行）。
- 已有可复用链路：`web/src/uiIntents.ts` 的 `requestStartAgent()` 置位 `pendingStartAgent` → `TerminalView` 的 `watch(pendingStartAgent, { immediate: true })`（第 544-548 行）→ `onWelcomeNewAgent()`：有项目则 `startAgent()`，无项目则派发 `df-add-folder`。
- 首启引导顺序（见 `2026-09-18-first-run-default-agent-design.md`）：多 Agent 且未选过 → 先弹设置选默认 Agent，关闭后再弹「添加目录」。

## 4. 设计

### 4.1 触发与编排（`web/src/App.vue`）

`confirmAddFolder()`：

- 进入时先记录 `const wasFirst = projects.value.length === 0;`（此刻尚未重新拉取项目列表，故反映「添加前是否无项目」）。
- 添加并 `selectProject(proj.id)` 之后，仅当 `wasFirst`：
  1. `historyTab.value = 'tree';`（左侧切到「目录」）；
  2. `await nextTick();`（等 `currentProject` 传导到 `TerminalView` 的 `projectId` prop，`startAgent` 需要它作为会话 cwd）；
  3. `requestStartAgent();`（触发自动启动 Agent）。

新增 import：`import { requestStartAgent } from './uiIntents';`（`nextTick` 已在第 2 行导入）。

### 4.2 复用链（不改 TerminalView）

```
App.confirmAddFolder
  wasFirst → historyTab='tree' → await nextTick()
           → requestStartAgent()  // pendingStartAgent = true
                 ↓ (TerminalView watch)
  onWelcomeNewAgent()
    projectId 已就绪 → startAgent()
      createSession({ projectId, kind:'agent', agentId, agentCmd })
      → center.ensureSession() + terminal.switchTo()
```

### 4.3 数据流

```
添加首个目录 → POST /api/projects → loadProjects()
             → selectProject(id) → currentProject=id
             → historyTab='tree' → nextTick（prop 落地）
             → pendingStartAgent=true
             → onWelcomeNewAgent → startAgent()
             → 新建 agent 会话页签并激活
```

### 4.4 错误处理与边界

- 时序：`await nextTick()` 保证 `TerminalView` 收到的 `projectId` 已是新项目；若未落地，`onWelcomeNewAgent` 会走「无项目 → 派发 `df-add-folder`」分支而非误起 Agent。
- 仅 `wasFirst` 为真才触发；已有项目再添加目录、刷新后添加目录均不触发。
- 手机页（`/?phone=1`）不使用 App 桌面布局，不受影响。
- Agent 启动失败沿用 `startAgent` 既有行为：会话未建则停留在欢迎页，用户仍可手动点击。
- 若当前是新窗口，切到 `tree` 会随窗口状态一起持久化（既有 `saveWindowState` 逻辑），刷新后恢复「目录」页签，符合预期。

## 5. 影响面

| 文件 | 改动 |
| --- | --- |
| `web/src/App.vue` | `confirmAddFolder()` 加首次判定 + 切页签 + `requestStartAgent()`；新增 import |

不改服务端、不改 `shared/i18n`（无新增用户可见文案）。

## 6. 测试

- 本改动为 `App.vue` 的编排逻辑，仓库当前无 App 组件级测试；经与用户确认，不新增自动化测试（抽纯函数只为一个布尔判断，收益低）。
- 回归：`npm.cmd run typecheck`、`npm.cmd test`。

## 7. 验证（手工）

1. 清空当前端口数据档案的 `projects.json`（或换端口），启动 dev。
2. 首次进入 → 弹「添加目录」（或先弹默认 Agent 设置，关闭后再弹）。
3. 选择/输入目录并确认添加。
4. 期望：左侧内页签自动停在「目录」（文件树）；中心区自动新建并激活默认 Agent 会话，不再需要点「＋ 新建 Agent」。
5. 再次点顶栏「＋」添加第二个目录：期望**不**自动切页签、**不**自动起 Agent。
