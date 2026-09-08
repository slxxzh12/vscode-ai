# 内联适配版 autoplan Review —— 网页版 opencode 实现计划

- 日期：2026-09-08
- 范围：`docs/superpowers/specs/2026-09-08-web-opencode-terminal-design.md` + `docs/superpowers/plans/2026-09-08-web-opencode-terminal.md`
- 方式：完整 gstack-autoplan 依赖 bash + codex CLI + plan-mode（本机均不具备），经用户确认改用内联适配版，按 autoplan 四阶段（CEO/Eng/Design/DX）自行审查，问题直接修进计划。

## 审查结论摘要

计划整体技术路线成立：Node `http.createServer` + `ws` + `node-pty`、常驻会话 + 环形缓冲重放、单份 onData 扇出 + alive 哨兵 + uncaughtException 三层防崩溃、Vue3 + Vite + xterm 零 CDN，均为成熟可行组合。审查发现 **7 处需修复的问题，全部已修进计划**（见各阶段 + 计划文件「Review 附录」）。

剩余风险集中在「Windows 本地开发的 node-pty/conpty 行为差异」，已用 Task 2 探针提前暴露，并设计人工兜底，不影响 Linux 部署主路径。

---

## 阶段 1：CEO / 范围审查

**检查：产品边界、目标、非目标、用户诉求是否跑偏。**

- 定位收敛正确：用户从「网页版 opencode」迭代到「通用终端 + 多会话管理 + 项目目录树 + Workflow 注入当前会话」，4 段设计逐段确认，非目标清晰（无账号体系、无认证、无磁盘级会话恢复）。 ✅
- 决策 4「认证暂缓」在安全上主动降级——记录在案：本服务 ≈ 网页版 shell，公网裸奔 = RCE 风险。计划已默认 `DEVFLOW_HOST=127.0.0.1`、保留 `requireAuthHttp/requireAuthWs` 钩子，把决定权留给部署。 风险等级：接受（用户明确决定），但 README 加粗提示。
- 无明显“本应裁剪却做进去”的功能；FileTree 已刻意做「点击展开、深度驱动」而非整树递归，符合 YAGNI。

**范围层面发现并处理：**
- 无范围问题阻塞。会话「忙/空闲检测」只能近似（无法可靠探测 shell 是否在提示符），spec §10 已写明近似语义，计划用「同会话并发拒绝 + auto/manual + 强制下一步」覆盖。列为文档化取舍，不需要用户重裁。

---

## 阶段 2：工程 / 架构审查（重点）

**检查：可行性、数据流、并发、竞态、崩溃路径、依赖可行性。**

### 2.1 依赖可行性（实测）
- `node-pty` 最新 `1.1.0`（2026-08 更新），install 脚本 `prebuild.js || node-gyp rebuild` —— 有预编译尝试、失败回退源码编译（Windows 需 VS Build Tools）。已锁 `^1.1.0`。Task 2 冒烟是硬关卡：原生 spawn 不过就不继续。 ✅
- 前端全本地依赖（Vue/Vite/xterm），vite proxy 代理 `/api`、`/ws` 到 3001，无 CDN 字面量。 Task 18 以 DevTools Network 验证收口。

### 2.2 关键数据流正确性
- 会话层「单份 pty.onData → ring.push → emit('data')」→ gateway 按 `session.clients.has(conn)` 扇出：切会话、关 socket 后不会再有写入路径；manager `write/resize` 全部 alive+try/catch。三层防崩溃链条闭合。 ✅
- 断线重连语义：ws 只是显示器，会话进程与 ring 在服务端常驻；重连后 `start` → 重放 → 实时，屏幕自愈。✅

### 2.3 发现并修复的问题（工程向）
1. **`ws.data.sessionId` 不同步**（违 spec §15.3）：原 Conn 只维护 `conn.sessionId`。→ 改 getter/setter 直通 `ws.data.sessionId`（Task 8）。
2. **create 的 cwd 没跟项目 root**（违 spec §9）：projectId 只进了 name。→ `SessionManager` 注入 `projectResolver(projectId)`，create 时 `cwd || projRoot || process.cwd()`（Task 7/12）。
3. **kill 会话不中断进行中的 Workflow**：kill 走 manager `removed`（非 `exit`），runner 只听了 `exit` → auto 步永久卡 running。→ 补 `removed` 监听 + 用例（Task 10）。
4. **Windows OSC 标记不可行（高置信 bug）**：PowerShell 5.1 实测 `"\u001b"` 是 6 字符字面量（不是 ESC）；`[char]27` 才是真 ESC。原 win 分支必失败。→ 改 `[char]27` 拼接（Task 5）。
5. **conpty 可能吞未知 OSC**：Windows conhost 对未知 OSC 可能不落盘到 conpty 输出流 → auto 步等不到标记。→ Task 2 Step 3b 加真实探针，失败即列为已知限制并用 UI「下一步」强推兜底。Linux 部署主路径不受影响。

### 2.4 并发/竞态复查（未发现新问题）
- 同 ws 切会话用 `setActive`（先 detach 旧 session 再 attach 新）→ 不会双绑。
- manager 事件监听为「每连接一对 add/remove」，close 保证移除 → 无泄漏。
- workflow 同会话并发由 `_sessionRun` 单跑保证；终态 `_maybeCleanup` 在 `_emit` 后清理，status 广播先于清理，无丢失。
- SessionManager `create` 为 async（动态 import node-pty），gateway 以 `.then` 接续 → 无未捕获拒绝（有 catch 回 error）。
- **已复核 front 竞态**：刷新页面会重复生成会话（本地 active 丢失而服务端会话常驻）→ 改为「服务端 list 为空才自动建第一个」，SESSION_LIST/CREATED 事件化。→ Task 14/15。

### 2.5 越界防护
- 目录树：`resolve + realpath` 双重前缀校验，junction 逃逸测试覆盖；HTTP 层把 Projects code 映射 403/404。✅

---

## 阶段 3：设计 / UX 审查

**检查：布局、交互、视觉一致、可用性。**

- 布局对齐 layout-v2 确认稿：顶栏 + 活动栏 + 侧栏（目录树/会话视图）+ 中央终端 + 右上角 Workflow。 ✅
- 会话存在**双入口**（中央 tab 条 + 侧栏会话列表）符合 VS Code 心智，但与「会话绑项目」的 cwd 规则需一致：新建会话统一带 `projectId`，服务端 resolve root（修复 2 后成立）。
- WorkflowPanel：模板 → 运行 → 每步状态（▶/✓/⏸）+ 下一步 + 中止，含 force-advance 兜底（自动步卡死时可人工推）。manual 步带 hint。 ✅
- 交互小坑已修：TerminalView 原先「mount 即建会话」改「list 为空才建」，杜绝刷新生成僵尸会话；连接未就绪时 createSession 会静默丢包 → composable outbox 排队，open 后 flush。 ✅
- 视觉：深色 VS Code 风格、系统字体，xterm CSS 本地引入。无强视觉创新诉求，不做额外 mockup。

**未发现需返工的设计问题。**

---

## 阶段 4：DX / 开发者体验审查

- monorepo 一键脚本齐：`dev:server`（node --watch）、`dev:web`、`build:web`、`test`、`typecheck`。README 有快速开始/配置/测试/安全说明。 ✅
- 配置即文件：`projects.json` / `workflows.json` 首次运行自动生成样例，env 可覆盖路径 —— 新用户 0 配置起步。 ✅
- 测试分层：node:test 单测/集成（真实 ws client + fake pty）+ vitest composable，计划每任务含失败/通过命令与期望输出，可直接 TDD 执行。 ✅
- Windows 执行细节：所有 shell 命令统一 `npm.cmd`（PowerShell 的 npm.ps1 受执行策略限制，实测 `npm --version` 即 SecurityError）。已在计划内修正。
- **遗留 DX 摩擦（已记录，非阻塞）**：node-pty 若本机无编译工具需装 VS Build Tools；conpty OSC 透传在 Windows 本地为降级路径。这两点在 README「注意事项」声明。

---

## 汇总：修复清单（全部已应用进计划）

| # | 严重度 | 问题 | 修复落点 |
|---|---|---|---|
| 1 | 高 | PowerShell `"\u001b"` 非 ESC，Windows 标记命令必坏 | Task 5 buildMarkerCmd → `[char]27` |
| 2 | 中 | conpty 可能吞 OSC → Windows auto 步卡住 | Task 2 Step 3b 探针 + 已知限制/兜底 |
| 3 | 中 | 会话 cwd 未跟随项目 root（违 spec §9） | Task 7 projectResolver + Task 12 接线 |
| 4 | 中 | kill 会话不中断 workflow（removed≠exit） | Task 10 监听 removed + 用例 |
| 5 | 中 | 刷新页面重复创建会话 | Task 14/15 list 为空才自动建 |
| 6 | 低 | ws.data.sessionId 未同步（违 spec §15.3） | Task 8 Conn accessor |
| 7 | 低 | node-pty 版本/构建不确定性 | Task 2 锁 ^1.1.0 + 冒烟硬关卡 |

## 残留风险（执行时关注）

- **Windows 本地**：node-pty 编译环境、conpty OSC 透传（探针结果决定 auto 步在本地是否可用）。
- **Linux 部署**：bash shell 的 OSC 透传无需担心；注意目标机需与项目同样用户权限、`node-pty` 需编译器或预编译匹配（部署前 `npm ci` 验证）。
- 会话空闲检测为近似实现，交互程序占用终端时 workflow 注入可能有干扰——靠 manual/force-advance 缓解，不修。

## 结论

STATUS: **DONE_WITH_CONCERNS**
REASON: 7 处问题全部修复并入计划；残留风险集中在 Windows 本地 node-pty/conpty 行为，已用 Task 2 探针在早期暴露并有 UI 兜底，Linux 主路径无阻塞。
RECOMMENDATION: 按修订后计划进入实现；执行顺序照旧（Task 2 的 node-pty 冒烟 + 探针为第一道关卡）。
