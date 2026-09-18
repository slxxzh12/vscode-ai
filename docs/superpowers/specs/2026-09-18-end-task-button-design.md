# 结束当前任务按钮（发送 /clear）设计

## 背景

`web/src/components/TerminalView.vue` 的 composer 中，`.cagentacts` 竖排按钮组（`TerminalView.vue:1193`）目前有两个按钮：

- `压缩上下文`（`compactContext`，发送 `/compact`，`.cact.compact`）
- `取消执行`（`undoContext`，发送 `/undo`，`.cact.cancel`）

opencode 的 `/clear` 是 `/new` 的别名，用于结束当前会话、开始新会话。用户需要一个显式按钮来完成这件事。

## 目标

在 `取消执行` 下方新增 `结束当前任务` 按钮，点击后直接向当前会话发送 `/clear`；同时把 `压缩上下文` 按钮缩小。

## 设计

### 按钮与行为

- 位置：`.cagentacts` 内、`取消执行` 之后（DOM 顺序即竖排的下方）。
- 动作：`sendToActive('/clear')`，与 `compactContext`/`undoContext` 完全相同的发送机制（写入当前活动会话并回车）。
- 点击后**直接发送**，不弹确认框（与现有两个按钮一致）。
- 发送前调用 `resetAutoCompact()`：新会话开始，重置自动压缩的发送计数与空闲计时器。

### 文案（i18n）

`shared/i18n/zh-CN.js` 与 `shared/i18n/en.js` 同步新增：

| key | zh-CN | en |
| --- | --- | --- |
| `term.end_task` | 结束当前任务 | End Task |
| `term.end_task_hint` | 向 Agent 发送 /clear 结束当前会话并开始新会话 | Send /clear to the agent to end the current session and start a new one |

### 样式

`.cagentacts` 为 `flex-direction: column`，按钮高度由 `flex` 比例分配。当前 `compact:cancel = 65:35`。

新增第三个按钮后改为 `compact:cancel:endtask = 30:35:35`：

- `压缩上下文` 明显缩小（满足“缩小一点”）。
- `取消执行` 占比基本不变。
- `结束当前任务` 与 `取消执行` 等分剩余空间。

`.cact` 的通用样式（边框、圆角、字号、padding）保持不变。新按钮使用中性配色（`.cact.endtask` 不加彩色边框，即默认 `--bd` 边框、`--tx2` 文字）。

## 涉及文件

- `web/src/components/TerminalView.vue`：新增 `endTask()` 函数、模板按钮、`.cact.endtask` 样式与 flex 调整。
- `shared/i18n/zh-CN.js`、`shared/i18n/en.js`：新增两条词条。

## 测试

- 现有前端测试无 `TerminalView` 按钮级用例；本次为纯 UI 增量，验证方式为：
  - `npm.cmd run check:i18n` 通过（中英键集合对称、无硬编码中文）。
  - `npm.cmd run typecheck` 通过。
  - 手动：dev 环境点按钮，确认会话收到 `/clear` 并开始新会话。

## 非目标

- 不改动 `压缩上下文` / `取消执行` 的行为。
- 不加确认弹窗。
- 不处理非 opencode agent（claudecode/cmd）对 `/clear` 的兼容性，与现有 `/compact`、`/undo` 一致。
