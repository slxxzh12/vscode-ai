# 设计文档：新建会话时输入任务名

日期：2026-09-18
分支：master
状态：待评审
前置：`web/src/components/TerminalView.vue`（新建会话弹窗、页签双击改名）

## 1. 概述

新建会话时，让用户可在弹窗里直接输入「本次任务的名字」，省去先创建、再双击页签改名的两步。

- 弹窗**去掉 3 秒倒计时**，始终手动点选命令创建。
- 名字**可选**：留空则用默认名，并在创建后提示「可双击页签修改名字」。
- 名字非空时：设置页签显示名，并对 Agent 会话同步其内部对话名（复用现有双击改名的 `/rename` 流程）。

## 2. 弹窗交互（`TerminalView.vue`）

- 移除自动创建：删除 `newTimer` / `newCountdown` / `stopNewTimer` 相关逻辑与 `term.auto_start_in` 提示。
- 弹窗列表上方新增「任务名」输入框（可选，占位文案走 i18n）；输入框回车等同点选当前选中命令。
- 输入框下方**常驻小字提示**：「留空用默认名，创建后双击页签可改名」。

## 3. 创建与命名语义

点选命令 `c` 创建会话 `s`，读取 `name = 输入.trim()`：

- 现有流程不变：`createSession` → `markAgent`（Agent）→ `center.ensureSession(s.id, 默认名, state)` → `switchTo(s.id)` → Agent 会话在 1.2s 后注入启动命令。
- `name` 非空：
  - `tabNames[s.id] = name` 并 `persistTabNames()`；
  - `center.ensureSession(s.id, name, state)`；
  - `msgHistory.renameTab(s.id, name)`；
  - Agent 会话（`c.cmd` 非空）额外触发 **Agent 对话名同步**（第 4 节）。
- `name` 为空：创建后弹一条**短暂提示**（约 4s 自动消失）：「可双击页签修改名字」。

## 4. Agent 对话名同步（`/rename`）

- 触发条件：Agent 会话且 `name` 非空。
- 判定「就绪」用**最短时长 + 静默**：注入 Agent 启动命令后开始观察该会话输出，先等最短 **3s**，之后连续 **1.2s** 无新输出即视为就绪。
- 就绪后调用现有 `syncAgentRename(sid, name)`（内部会切到该会话、输入 `/rename`、清旧标题、输入新名、回车，再切回）。
- 放弃条件：超时 **30s**，或期间活动会话已切走（不切回、不改名）。放弃不影响页签名。
- 输出观察复用 `terminal.on(S2C.OUTPUT, …)`（现有实现只对活动会话派发 `S2C.OUTPUT`），不新增 WS 协议。

## 5. 可测试的纯逻辑

新增 `web/src/components/sessionNaming.ts`：

```ts
export type GateState = 'waiting' | 'ready' | 'timeout';
export function createReadyGate(opts: {
  now: () => number; minMs?: number; quietMs?: number; timeoutMs?: number;
}): { output(): void; poll(): GateState }
```

- `output()`：记录最近一次输出时刻。
- `poll()`：`now-start >= timeoutMs` → `'timeout'`；`now-start >= minMs && now-last >= quietMs` → `'ready'`；否则 `'waiting'`。
- 组件用 `setInterval(poll, 200)` 驱动，`S2C.OUTPUT` 监听调用 `output()`。

## 6. i18n 词条（中英同时补齐）

| key | zh-CN | en |
| --- | --- | --- |
| `term.new_task_name` | 任务名（可选） | Task name (optional) |
| `term.new_task_name_hint` | 留空用默认名，创建后双击页签可改名 | Leave empty for the default; double-click the tab to rename |
| `term.rename_hint` | 可双击页签修改名字 | Double-click the tab to rename |

删除 `term.auto_start_in`（不再有倒计时）。

## 7. 测试与验收

- `web/src/components/sessionNaming.test.ts`：`createReadyGate` 的最短时长、静默、超时、输出重置静默计时。
- 人工验收（dev，端口 33333）：新建会话弹窗输入名字 → 页签显示该名字；Agent 会话启动完成后其内部对话名同步；留空创建 → 页签默认名 + 短暂提示出现；弹窗不再倒计时自动创建。
- 全绿：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web`。

## 8. 边界与取舍

- **Agent 就绪判定是启发式**：静默不等于一定就绪；若 `syncAgentRename` 在未就绪时执行会打乱终端输入。用「最短 3s + 静默 1.2s + 30s 超时」降低概率，且失败只影响 Agent 对话名（页签名已设）。
- **名字只存本地**：页签名仍存 localStorage（按项目指纹隔离），与双击改名同源；不新增服务端字段。
- **不弹二次确认**：创建即生效。

## 9. 明确不做

- 不做创建时的重名检测/去重。
- 不做多语言之外的输入校验（长度/字符）。
- 不改动双击改名的既有行为。
- 不给 shell 会话发 `/rename`（仅 Agent 会话）。
