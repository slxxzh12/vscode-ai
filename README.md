# 网页版 opencode（devflow-web-terminal）

Web 通用终端 + 多会话管理 + 多项目目录树 + Workflow（命令编排模板注入当前会话）。
基于 Node `http.createServer` + `ws` + `node-pty` 与 Vue3/xterm。

## 结构

- `shared/` — WS 协议常量与类型（前后端唯一事实源）
- `server/` — Node 后端（ESM）：会话常驻、环形缓冲重放、项目/目录树、Workflow 执行器
- `web/`   — Vue3 + Vite + TypeScript + @xterm/xterm（零 CDN）

## 快速开始

```bash
npm install            # 根目录 workspaces
npm run dev:server     # 后端 :33333（dev 固定端口，release 用 22222；首次运行自动生成 projects.json / workflows.json）
npm run dev:web        # 前端 Vite :5173（代理 /api 与 /ws）
# 打开 http://localhost:5173
```

生产模式：

```bash
npm run build:web
node server/index.js   # 访问 http://127.0.0.1:22222
```

## 配置

- 项目根：编辑 `server/projects.json`（或设 `DEVFLOW_PROJECTS`）新增 `{ id, name, root }`。
- Workflow 模板：编辑 `server/workflows.json`（或设 `DEVFLOW_WORKFLOWS`）。step 的 `advance`:
  - `"auto"`：命令后自动注入不可见 OSC 完成标记，跑完自动下一步（跨平台已实测可用，含 Windows ConPTY）
  - `"manual"`：注入命令后面板暂停，需点「下一步」

### 端口数据档案（Port Profiles）

服务按监听端口隔离数据，每个档案是一套完全独立的目录：

- 数据档案根：`%USERPROFILE%\.local\share\devflow\ports\<profileId>\`
  （含 `projects.json`、`workflows.json`、`scheduler/`、`collab/identity.json`、`message-history.jsonc` 等）
- 选择记忆：`%USERPROFILE%\.local\share\devflow\ports-state.json` 的 `byListenPort`。
- 首次启动会自动把旧数据迁移为档案 `22222`（复制，不删除）。
- 启动时若发现多份档案，界面会弹窗选择；单份自动使用；零份自动新建。
- `DEVFLOW_NODE` 环境变量仍可用作多实例模拟，此时不进入端口档案系统。

### 远程访问（默认关闭）

服务默认仅本机（回环地址）可访问；非本机请求一律被拦截。需要远程时，在**本机**「设置 → 远程访问」临时生成：

1. **高风险管理**：开启后，任何拿到「地址 + 密码」的人都能远程操作这台电脑（执行命令、读写文件），存在被劫持风险。仅请在完全可信的环境下临时开启，用完立即「立即失效」。
2. **生成**：有效期下拉（4 小时 / 1 天 / 2 天 / 5 天 / 7 天，默认 1 天）→ 点「生成邀请链接与密码」。
   - 服务端生成**一次性随机访问密码**（22 位，`crypto` 随机，≥16 位）。开启 master 模式后，密码/链接在本机 UI **默认直接展示**（走 `GET /api/remote/reveal`，仅回环请求可用）；**远程客户端**（即使已持 Cookie）拿不到，`/api/remote/state` 也始终不返回密码。
   - 若当前监听仍是 `127.0.0.1`，会自动把 `config/devflow.xml` 的 `host` 改为 `0.0.0.0`，**需重启服务**后远程才能连上。
3. **远程访问**：把「访问地址」和「密码」给对方，用浏览器打开地址 → 出现密码输入页 → 输入正确密码后进入（服务端下发 `HttpOnly; SameSite=Lax` Cookie，有效期同邀请）。
4. **失败锁定**：连续输错 **5 次锁定 5 分钟**；锁定期间禁用输入。管理员「立即失效」或重新生成会清除失败计数与锁定。
5. **有效期与失效**：邀请/密码仅为**内存态，服务重启即失效**，需重新生成；到期自动失效。

相关接口（仅本机可操作）：`GET /api/remote/state`、`GET /api/remote/reveal`（仅回环，返回密码/链接）、`POST /api/remote/invite {hours}`、`POST /api/remote/revoke`。配置项 `config/devflow.xml` 的 `<server host="...">` 控制监听地址（`127.0.0.1` 本机 / `0.0.0.0` 允许远程）。

### 用量统计上报（每小时）

各实例每小时采集本机 opencode stats（`sessions / messages / input / output / days / totalCost / cacheRead / cacheWrite`），以**签名信封** `POST /api/collab/stats` 上报给所属 master（hub）；master 校验发送方为群成员后写入 heartbeat 并刷新 `downloads/usage.json`，供群内汇总查看。非成员或坏签名一律拒绝。该路径在远程门禁中按「机器↔机器」接口放行（不依赖 Cookie），安全性由信封签名 + 成员校验保证。

### 本机 LLM 中转站（relay）

在「LLM 中转站」面板初始化并解锁密钥库后，可给外部机器签发 JWT，并用中转地址代理到上游 provider。

- **请求地址**：`POST http://<host>:<port>/api/llm/<providerId>/<上游路径>`
  - `<providerId>`：opencode 配置里 `provider` 的键（面板「Provider」列表可见）。
  - `<上游路径>`：与上游 baseURL 的路径一致，例如 `v1/chat/completions`。
- **鉴权**：请求头 `Authorization: Bearer <签发的 JWT>`（或 `x-api-key`）。
- **请求体**：与上游 OpenAI 兼容接口一致；**模型放在 JSON body 的 `model` 字段，不要放进 URL**。
- **上游 baseURL**：取 `provider.<id>.options.baseURL`；未配置时对已知 provider 用内置兜底（如 `deepseek` → `https://api.deepseek.com/v1`）。**路径版本段（如 `/v1`）由 baseURL 提供**，中转只做原样透传。

```bash
# 非流式
curl "http://127.0.0.1:22222/api/llm/deepseek/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"Hello!"}]}'

# 流式（SSE）
curl -N "http://127.0.0.1:22222/api/llm/deepseek/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"Hello!"}],"stream":true}'
```

## 会话语义

- 会话在服务端常驻；网页关闭/断网不影响运行。
- 断线重连后自动 `start` 重放缓冲，屏幕内容恢复。
- `stop` 解绑（进程保留），`kill` 结束进程并销毁。
- 刷新页面不会重复创建会话（仅当服务端列表为空时才自动建第一个）。

## 待解决问题

1. **深色 / 浅色模式**：增加主题切换，xterm 终端与页面整体同步跟随。
2. **本地目录下拉选择最近项目**：本地目录入口支持下拉选择最近使用的项目。
3. **左侧 History 展开历史**：History 可展开历史文件与历史聊天记录。
4. **opencode 开发工作流**：opencode 开发时展示工作电子流（Workflow 编排过程可视化）。
5. **公共 skills 安装问题**：解决公共 skills 的安装与加载问题。
6. **Agent 使用时间问题**：解决 Agent 使用时间的统计 / 限制问题。

## 测试

```bash
npm test               # server(node:test) + web(vitest)
npm run typecheck
```

## 注意事项
- 本仓库默认 `server/projects.json` 的示例项目 root 为 `.`（相对服务进程 cwd）。从仓库根目录启动即为本仓库。
- 服务可在浏览器执行任意 shell 命令。v1 暂未做认证，仅建议绑定 `127.0.0.1`/内网；公网访问务必加反代鉴权（代码已预留 `requireAuthHttp` / `requireAuthWs` 钩子，见 `server/http-api.js` 与 `server/ws-gateway.js`）。
