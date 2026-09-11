# 设计文档：页签改名同步 opencode `/rename`

日期：2026-09-11
分支：master
状态：待评审

## 1. 概述

历史消息页签支持双击重命名（`TerminalView.vue` 的 `startRename` / `commitRename`）。本改动在重命名成功后，若满足条件，向被改名的会话发送 opencode 的 `/rename <新名>` 命令，使 opencode 会话名与页签名保持一致。

## 2. 已与用户确认的约束

- 触发范围：**任意会话**页签（不限于固定 Agent 页签）。
- 判断依据：**当前选中的 Agent** 是 `opencode`。
- 发送方式：目标若是当前活动会话则直接发；若是后台页签则**先 `switchTo` 过去发送，再切回原会话**（用户接受短暂切视图/重放）。
- 清空名字（恢复默认显示名）时**不发送** `/rename`。

## 3. 行为

在 `commitRename(tabId)` 改名落地（写 `tabNames` + `ensureSession` + `msgHistory.renameTab`）后：

1. 计算新名 `name = renameValue.value.trim()`。
2. 触发条件（全部满足才发送）：
   - `name` 非空；
   - 当前 Agent 为 `opencode`（`currentAgent.value.id === 'opencode'`，即 `agentId` 为 `opencode`）；
   - 目标会话未退出（`sessionState(sid) !== 'exited'`）。
3. 发送序列（`input` 只能作用于活动会话，见 `server/ws-gateway.js:97`）：
   - 记 `prev = props.terminal.state.activeSessionId`；
   - 若 `sid !== prev`，先 `props.terminal.switchTo(sid)`；
   - `props.terminal.input(renameCommand(name))`；
   - 150ms 后 `props.terminal.input('\r')`；
   - 若 `sid !== prev` 且 `prev` 非空，300ms 后 `props.terminal.switchTo(prev)` 切回。
   - WS 消息有序，服务端按 `START(sid) → INPUT → START(prev)` 顺序处理，写入不会错会话。
4. 不满足条件则不发送，仅完成页签改名（原有行为）。

## 4. 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `web/src/agentRename.ts` | 纯判定与命令拼接：`shouldRenameAgentSession` / `renameCommand` | Create |
| `web/src/agentRename.test.ts` | vitest 单测 | Create |
| `web/src/components/TerminalView.vue` | `commitRename` 调用 helper 并执行切换/发送 | Modify |

### 接口

```ts
// web/src/agentRename.ts
export const RENAME_AGENT_ID = 'opencode';

/** 是否应向该会话发送 /rename：名字非空 + 当前 Agent 为 opencode + 会话未退出 */
export function shouldRenameAgentSession(opts: {
  name: string;
  agentId: string;
  sessionState: string;
}): boolean;

/** 拼接 opencode 改名命令（名字已 trim 后的形式） */
export function renameCommand(name: string): string;
```

- `shouldRenameAgentSession`：`return opts.name.trim() !== '' && opts.agentId === RENAME_AGENT_ID && opts.sessionState !== 'exited';`
- `renameCommand`：`return \`/rename ${name.trim()}\`;`

## 5. 边界与已知取舍

- 因触发范围是「任意会话」，若对非 opencode 的会话（如 cmd shell）改名、而当前 Agent 恰为 opencode，会把 `/rename <名>` 当普通命令发进该 shell。用户已确认接受此取舍；如需避免可后续收窄为「仅固定 Agent 会话」。
- 不校验 opencode CLI 是否已就绪（用户已确认不做严格就绪判断）。
- 后台页签发送会短暂切换视图（`switchTo` 触发重放），用户已确认接受。
- 无新增用户可见文案，**无需 i18n**。

## 6. 测试与验收

- 单测（`web/src/agentRename.test.ts`，vitest）：
  - `shouldRenameAgentSession`：名字为空/仅空白 → false；`agentId !== 'opencode'` → false；`sessionState === 'exited'` → false；全部满足 → true。
  - `renameCommand`：`renameCommand('  我的会话  ')` → `'/rename 我的会话'`。
- 类型检查：`npm.cmd run typecheck` 通过。
- i18n：`npm.cmd run check:i18n` 通过（无新增中文文案；本次改动不含用户可见中文）。
- 全量：`npm.cmd test` 通过。
- 人工验收：打开 http://localhost:5173 → 双击固定 Agent 页签改名 → opencode 会话名同步；双击后台会话页签改名 → 视图短暂切换后回到原会话，会话名同步。

## 7. 明确不做

- 不改 WS 协议（不新增 `INPUT_TO`）。
- 不仅限固定 Agent 会话（用户选择任意会话）。
- 不做 CLI 就绪校验。
- 不清空名字时发 `/rename`。

## 8. 决策记录

- 「任意会话 + 当前 Agent 判断」：用户明确选择。
- 「切过去再切回」：用户在三种发送方式中选定（改动最小、无协议变更）。
- 抽纯函数模块：项目现有测试均为 `web/src/*.test.ts` 纯函数风格，便于 TDD 且不引入组件挂载测试依赖。
