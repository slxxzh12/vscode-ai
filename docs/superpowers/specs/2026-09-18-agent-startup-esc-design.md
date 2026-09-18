# 设计文档：Agent 启动弹框自动 ESC

日期：2026-09-18
分支：master
状态：已与用户确认方案（待实现）

## 1. 概述

opencode 在启动时可能弹出「有新版本，是否升级」的**升级框**，或配置 / 模型 / provider 相关的**告警框**（model not found、provider 未配置、`default_agent` 回退等）。这些框会挡住 TUI，让 devflow 网页终端里的 agent 会话看起来「卡住」，尤其影响启动时自动恢复的会话。

本设计在 agent 会话启动后的一个短时间窗内**盲发 ESC**（不识别文案），把升级框 / 告警框顶掉，让会话继续。范围覆盖：

1. 启动时自动恢复的 agent 会话（`session-restore` 注入 `opencode --session <id>`）。
2. 用户手动新开 / 打开页签的 agent 会话（前端 `TerminalView.startAgent` 敲入 `opencode`）。

需求原文（用户）：

> 如果 agent 启动有升级框或者告警框，需要 ESC。
> 我是否可以检查到，进入之后直接按 ESC，然后再来恢复 session？

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 覆盖范围 | 范围 1 + 范围 2（恢复会话 + 手动新开 agent 会话），统一在服务端处理 |
| 2 | 检测方式 | 不做内容/特征识别，采用**无条件盲发 ESC**（时间窗）。文案随版本/i18n 变，特征匹配太脆 |
| 3 | ESC 时机 | 相对**会话创建**的 +3000ms 与 +4500ms 各发一次（两次给「框出现时间」留冗余） |
| 4 | 触发面 | 仅 `kind === 'agent'` 的会话；`shell` / `workflow` 不动 |
| 5 | 升级框根治 | 本次不做（可在后续用 `autoupdate:false` 从源头关掉，本设计只负责 ESC 兜底） |
| 6 | 实现位置 | 新增独立模块 `server/agent-startup-guard.js`，在 `server/index.js` 的 `onCreated` 接线 |

## 3. 现状（改动前）

- agent 会话在服务端的统一标识是 `session.kind === 'agent'`（见 `server/session-manager.js:33`、`ws-gateway.js:80`）。
- **恢复**：`server/session-restore.js:29` 在会话创建后 `resumeDelayMs = 1500` 写 `opencode --session <id>\r`。
- **新开**：`web/src/components/TerminalView.vue:453` 的 `startAgent` 创建会话后，`setTimeout(launchAgentCmd, 1200)`；`launchAgentCmd` 先 `input(cmd)`，再 200ms 后 `input('\r')`（即命令于 +1200ms 敲入、+1400ms 提交）。
- 回写键盘字节的既有入口：`sessionManager.write(id, data)`（`server/session-manager.js:67`）。
- 会话生命周期事件：`sessionManager` 有 `exit` / `removed` / `data` 事件（`server/session-manager.js:52,116`），没有 `created` 事件；创建回调是 `SessionManager` 构造参数 `onCreated`（`server/index.js:242`）。
- 当前没有任何针对 agent 启动弹框的处理。

## 4. 设计

### 4.1 新增模块 `server/agent-startup-guard.js`

```js
export function createAgentStartupGuard({
  sessionManager,
  delaysMs = [3000, 4500],
  esc = '\x1b',
  schedule = setTimeout,
  clear = clearTimeout,
  logger = console,
} = {}) => {
  // arm(session)：kind==='agent' 时，按 delaysMs 各排一个一次性定时器
  //   到点先查 sessionManager.get(session.id)，会话不存在/已退出则跳过
  //   否则 sessionManager.write(session.id, esc)
  // disarm(id)：清掉该会话的定时器
  // 返回 { arm, disarm }
};
```

要点：

- 纯逻辑、依赖注入 `schedule` / `clear`，便于单测手推时钟。
- `arm` 幂等：同一 `session.id` 重复 arm 先 `disarm`。
- `arm` 只对 `session.kind === 'agent'` 生效，其它 kind 直接返回。
- 到点回调内做存活判断，不缓存 pty 引用（会话退出后 `session.pty` 为 null，`write` 也会拒）。

### 4.2 接线 `server/index.js`

- `buildWorkspace` 内：先 `let startupGuard = null;`，构造 `SessionManager`（其 `onCreated` 内 `if (s.kind === 'agent') startupGuard?.arm(s);`），构造完成后再 `startupGuard = createAgentStartupGuard({ sessionManager, logger: log });`。`onCreated` 只在会话创建时触发，此时 guard 已赋值。
- `sessionManager.on('exit', ...)` / `on('removed', ...)` 中：`startupGuard.disarm(s.id / id)`。

因为恢复与新开在服务端都表现为 `kind:'agent'` 的会话，这一处接线同时覆盖范围 1 与范围 2；**前端零改动、无新 WS 协议**。

### 4.3 时序

```
t=0        会话创建（kind=agent），guard.arm 排两个定时器
恢复路径    t≈1500ms  写入 opencode --session <id>
新开路径    t≈1200ms  前端敲入 opencode，t≈1400ms 回车
t≈3000ms   第一次盲发 ESC
t≈4500ms   第二次盲发 ESC（冗余）
之后       窗口结束，解绑
```

ESC 落在命令提交后约 1.6–3.1s，覆盖慢机启动。

### 4.4 错误处理与边界

- **无框时的 ESC**：opencode 在空闲主提示符下，ESC 不会造成破坏；启动窗口内不会正在生成回答，故不会中断生成。
- **用户抢先输入**：若用户在 3–4.5s 内已开始输入，ESC 可能清空输入。窗口很短，概率极低，接受。
- **ESC 落进 shell**：若 opencode 尚未启动，ESC 落在 PowerShell 空提示符上，无副作用。
- **会话已退出**：到点存活检查直接跳过。
- **非 opencode agent**：同样适用；ESC 在其它 agent 的空闲启动态一般无副作用。若后续发现某 agent 敏感，可加 agent 白名单（不在本次范围）。
- 无用户可见文案，**不需要新增 i18n 词条**。

## 5. 影响面

| 文件 | 改动 |
| --- | --- |
| `server/agent-startup-guard.js` | 新增：guard 工厂（arm/disarm + 定时写 ESC） |
| `server/index.js` | 创建 guard；`onCreated` 对 agent 会话 arm；`exit`/`removed` disarm |
| `server/test/agent-startup-guard.test.js` | 新增单测 |

## 6. 测试

`server/test/agent-startup-guard.test.js`（注入假 `schedule` / `clear` 与假 `sessionManager`）：

- `kind:'agent'` 会话 arm 后，推进到各 `delaysMs` 时各写一次 `\x1b`。
- `kind:'shell'` / `workflow` 会话 arm 后不写。
- 会话已退出（`get` 返回 null 或 `alive:false`）时到点跳过。
- `disarm` 后到点不再写。
- 同一 id 重复 arm 只保留最新一批定时器。

## 7. 验证（手工）

1. dev 启动（:5173）：开一个 agent 页签，观察启动后 3–4.5s 有 ESC 被写入（终端输出或后端日志），agent 正常进入 TUI。
2. 制造升级/告警框（如临时让 provider 模型名不存在）：启动后框自动消失、会话可用。
3. 恢复一个已关闭的 agent 会话（重启后端 → 打开页签）：框中会话能续回原对话，框被 ESC 顶掉。
4. shell 页签不受影响（无多余 ESC）。
