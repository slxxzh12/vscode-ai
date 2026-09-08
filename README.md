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
npm run dev:server     # 后端 :3001（首次运行自动生成 projects.json / workflows.json）
npm run dev:web        # 前端 Vite :5173（代理 /api 与 /ws）
# 打开 http://localhost:5173
```

生产模式：

```bash
npm run build:web
node server/index.js   # 访问 http://127.0.0.1:3001
```

## 配置

- 项目根：编辑 `server/projects.json`（或设 `DEVFLOW_PROJECTS`）新增 `{ id, name, root }`。
- Workflow 模板：编辑 `server/workflows.json`（或设 `DEVFLOW_WORKFLOWS`）。step 的 `advance`:
  - `"auto"`：命令后自动注入不可见 OSC 完成标记，跑完自动下一步（跨平台已实测可用，含 Windows ConPTY）
  - `"manual"`：注入命令后面板暂停，需点「下一步」

## 会话语义

- 会话在服务端常驻；网页关闭/断网不影响运行。
- 断线重连后自动 `start` 重放缓冲，屏幕内容恢复。
- `stop` 解绑（进程保留），`kill` 结束进程并销毁。
- 刷新页面不会重复创建会话（仅当服务端列表为空时才自动建第一个）。

## 测试

```bash
npm test               # server(node:test) + web(vitest)
npm run typecheck
```

## 注意事项

- 本仓库默认 `server/projects.json` 的示例项目 root 为 `.`（相对服务进程 cwd）。从仓库根目录启动即为本仓库。
- 服务可在浏览器执行任意 shell 命令。v1 暂未做认证，仅建议绑定 `127.0.0.1`/内网；公网访问务必加反代鉴权（代码已预留 `requireAuthHttp` / `requireAuthWs` 钩子，见 `server/http-api.js` 与 `server/ws-gateway.js`）。
