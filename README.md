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
npm run dev:server     # 后端 :22222（首次运行自动生成 projects.json / workflows.json）
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
