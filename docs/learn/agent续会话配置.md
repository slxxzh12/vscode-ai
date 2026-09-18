# Agent 续会话配置

## 背景

DevFlow 在**后端重启**或用户点击历史面板会话树的「打开」时，会按会话账本重建终端：
回滚照常恢复；对 `kind='agent'` 的会话，服务端还会注入一条**续会话命令**，让 agent 继续上一次的对话上下文。

- 账本：`<数据目录>/ports/<端口>/sessions.json`（上限 30 条）；回滚：`session-logs/<id>.log`。
- 活动配置：`<数据目录>/ports/<端口>/downloads/devflow.xml`。
  仓库里的 `config/devflow.xml` 只是**首次启动的 seed 模板**，改它不影响既有实例。

## 机制

恢复时对 agent 会话依次取命令：

1. `buildResumeCommand({ agent, agentSessionId })`：
   - 配了 `resumeCmd`：含 `{id}` → 用发现的 id 替换；不含 → 原样执行；缺 id 且含 `{id}` → 不注入。
   - 未配且是 opencode → `opencode --session <id>`（需要 `agentSessionId`）。
   - 否则 → `null`。
2. 取不到续会话命令 → 退化为该 agent 的原始 `cmd`（**只重开外壳，不续上下文**）。

`agentSessionId` 的来源：

- `resumeDiscover` 配置的命令，stdout 去空白即 id；
- 未配且是 opencode → 内建发现：`opencode session list --format json -n 30`，
  按 `directory === cwd` 且 `created` 落在会话创建时间 ±60s 的项取最接近的 id；
  **会排除已被其它活跃会话认领的 id，且发现串行化**（避免同目录多会话错配）。

## 配置方法

在活动配置 `downloads/devflow.xml` 的 `<agents>` 里给对应 agent 加属性：

```xml
<agent id="claudecode" name="ClaudeCode" cmd="claudecode"
       resumeCmd="claudecode --resume {id}"
       resumeDiscover="<列出最近会话 id 的命令>" />
<agent id="nga" name="nga" cmd="nga" resumeCmd="nga --continue" />
```

- opencode 无需配置（内建）。
- `nga`/`claudecode` 的 `resumeCmd`/`resumeDiscover` 真值取决于各自 CLI，请按本机实际填写。
- 改完**重启后端**生效。

## 验证

1. 起一个 agent 会话，聊两句，看 `sessions.json` 该条是否回填了 `agentSessionId`。
2. 重启后端；恢复后确认 agent 里能接着上文。
3. 日志出现「session restored with command」= 续上了；只出现「session restored」= 未续（退化重开）。

## 风险与注意

- **多会话同目录**：`resumeCmd` 不含 `{id}`（如 `--continue`）时，多个会话会都接到「最近一次」→ 串台。
  优先用 `resumeDiscover` + `resumeCmd` 的 `{id}` 精确续接。
- **发现未完成前重启**：`agentSessionId` 仍为空 → 退化重开（点「打开」时会提示「未找到可续对话」）。
- **抢占同一对话**：若目标 `agentSessionId` 已被别的活跃会话占用，恢复**不重建**，改为切到占用者，避免两个终端抢同一对话。
- `resumeDiscover` 执行的是本机 XML 里配置的命令，与 `cmd` 同信任级别；**不要**在 XML 里写任何密钥/令牌。
