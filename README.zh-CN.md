[English](README.md) | [简体中文](README.zh-CN.md)

# DevFlow / 网页版 opencode（devflow-web-terminal）

在浏览器里管理本机终端与 opencode 会话：多会话、多项目、提示词工作流、Markdown 预览、静态网站 / 反向代理 / LLM 中转站、手机遥控与绿色包分发，一套 Web 界面全部搞定。

> **关键词（便于搜索）**：opencode Web 版、浏览器终端、Web Terminal、在线终端、多会话终端、多项目目录树、工作流编排、提示词工作流、Markdown 预览、复杂表格、Mermaid 折线图、饼图、ECharts、PPT 演示、静态网站托管、反向代理、Nginx 规则、LLM 中转站、OpenAI 兼容 API、API 中转、Postman、Navicat、YAML、Base64、远程访问、手机遥控、免安装绿色包、Windows、macOS、Vue3、Vite、TypeScript、Node.js、node-pty、WebSocket。

## 这个项目解决什么问题

- **opencode 只有命令行，切换项目和会话很麻烦**：这里提供浏览器里的多标签终端，会话在服务端常驻，关网页 / 断网不丢。
- **提示词散落在各处，复用困难**：把常用提示词组织成「工作流 / 分组 / 阶段」，一键填入输入框或按组自动执行。
- **文档、图表、演示分散在多个工具里**：Markdown 预览内置复杂表格、折线图 / 柱状图 / 饼图与 PPT 演示模式。
- **本地静态站点、接口转发、LLM Key 管理配置繁琐**：内置静态网站托管、反向代理与 LLM 中转站，可视化配置。
- **团队机器上的 opencode 用量难以汇总**：协作模块支持群成员、群聊与机器用量上报。
- **目标机器不想装 Node / 编译原生模块**：提供自带 Node 运行时与 node-pty 的绿色包，解压即用。
- **中英文用户都要用**：界面与提示文案全程支持中文 / English，可即时切换。

## 功能总览

- **终端与会话**：多会话页签、断线重连重放、会话备注 / 描述、历史消息与提示词收藏。
- **项目与文件**：多项目目录树、文件预览 / 编辑、代码搜索、Git 统计、代码行数统计。
- **工作流**：工作流 → 小组 → 阶段 → 技能（Markdown 文件）目录化存储；阶段常用提示词 chip；支持直接从文件刷新与就地编辑。
- **Markdown 增强**：复杂表格、Mermaid `xychart-beta` 折线 / 柱状图、`pie` 饼图（转换为 ECharts）、`mermaid row` 并排图表、`mermaid-data` 数据脚本、PPT 演示。
- **小工具集**：TXT / Markdown、YAML、翻译、Postman（curl 记录）、Navicat（MySQL / PostgreSQL / SQLite / Redis）、Nginx、Base64。
- **静态网站 / 反向代理 / LLM 中转站**：静态目录托管、SPA 回退、站点前缀、请求抓包；按路径或独立端口接入；签发 JWT 供外部机器调用上游模型。
- **协作与统计**：群成员、群聊、机器用量上报、Token 统计。
- **定时任务与队列**：shell / AI 任务，作业队列支持 SQLite（默认）或 MySQL。
- **远程与手机遥控**：临时远程访问（密码 / 有效期 / 失败锁定）；手机打开 `/?phone=1` 遥控桌面会话。
- **国际化**：中文（zh-CN）与英文（en）词条同源，界面即时切换。

## 技术栈

### 前端（`web/`）

- **框架**：Vue 3（`<script setup>` + Composition API）、TypeScript、Vite
- **终端**：`@xterm/xterm` + `@xterm/addon-fit`（xterm v5）
- **编辑器**：CodeMirror 6（多语言语法：JS/TS、Python、Java、C/C++、Rust、PHP、SQL、YAML、JSON、Markdown、HTML/CSS/Sass/XML 等）
- **UI**：Element Plus（表格、弹窗、消息提示）
- **Markdown / 图表**：`markdown-it`、`highlight.js`、`mermaid`、`echarts`
- **其他**：`yaml`、`prettier`、`html-to-image`
- **测试**：Vitest + `@vue/test-utils` + happy-dom；类型检查 `vue-tsc`

### 后端（`server/`）

- **运行时**：Node.js（ESM），`http.createServer` 提供 HTTP / 静态资源 / SSE
- **实时通信**：`ws`（WebSocket，协议常量统一放在 `shared/`）
- **终端**：`node-pty`（Windows ConPTY / macOS PTY）
- **数据库**：Node 内置 `node:sqlite`（`DatabaseSync`），单文件 `void.db`
- **可选存储**：`mysql2`（作业队列）、`pg`、`redis`
- **Markdown / 代码处理**：`markdown-it`、`highlight.js`、`esbuild`（在线压缩 / 转译）
- **测试**：`node:test`

### 共享层（`shared/`）

- WebSocket 协议常量与类型（前后端唯一事实源）
- 中英词条与 `translate()`（`shared/i18n/`）
- Markdown 渲染、客户端图表增强、PPT 控制器、CSV、文件图标、工作流分组等前后端复用逻辑

### 构建、测试与打包

- npm workspaces（`shared` / `server` / `web`）
- Vite 构建前端，`scripts/build*.js` 组装绿色包（内置 Node 运行时 + node-pty 原生模块）
- 测试：`node --test`（后端）+ Vitest（前端）；`npm run typecheck`；`npm run check:i18n`

## 快速开始

环境要求：Node.js ≥ 20（推荐与绿色包一致的大版本，保证 node-pty ABI 匹配），npm。

```bash
npm install
npm run dev            # 同时启动后端与前端（Ctrl-C 一并结束）
```

也可分别启动：

```bash
npm run dev:server     # 后端 http://127.0.0.1:33333（dev 固定端口）
npm run dev:web        # 前端 Vite http://127.0.0.1:5173（代理 /api 与 /ws）
```

打开 <http://localhost:5173>。

生产模式（静态托管 `web/dist`）：

```bash
npm run build:web
node server/index.js   # 默认 http://127.0.0.1:22222（端口取 data/port.txt）
```

> Windows PowerShell 下若 `npm.ps1` 被执行策略拦截，请改用 `npm.cmd`。
> 新克隆后如 node-pty / esbuild 原生脚本被 npm 拦截，执行 `npm.cmd approve-scripts node-pty esbuild`。

## 打包绿色包

```bash
node scripts/build-all.js            # 先构建前端，再按平台出全套包
node scripts/build.js                # Windows 标准包
node scripts/build-opencode.js       # Windows 内置 opencode 包
node scripts/build-mac.js            # macOS（必须在 macOS 上执行，一次出 arm64 + x64）
```

产物在 `dist-portable/`，目录名形如 `vscode-ai-windows-x64-vYYYYMMDD`，并附带同名 `.zip`。绿色包自带 `runtime/node.exe` 与已编译的 node-pty，目标机无需安装 Node。

## 目录结构

```text
shared/   WS 协议常量/类型、i18n 词条、Markdown / 图表 / PPT / CSV / 工作流等共享逻辑
server/   Node ESM 后端：HTTP API、WebSocket、PTY 会话、协作、调度队列、代理引擎、数据存储
web/      Vue3 + Vite + TypeScript + xterm + CodeMirror + Element Plus 前端
config/   首次启动种子配置（devflow.xml、默认工作流）
scripts/  开发启动、打包、i18n 检查、代码统计等脚本
test/     Markdown / 图表等测试样例数据
```

## 配置与数据目录

- **监听端口**：`<应用目录>/data/port.txt`（单行数字），优先级 `DEVFLOW_PORT` > 该文件 > `22222`；修改后需重启后端。
- **端口数据档案**：`%USERPROFILE%\.local\share\void\ports\<端口>\`（Windows）或用户数据目录下对应路径。不同端口的数据完全隔离。
- 档案内主要文件：
  - `projects.json`：项目列表 `{ id, name, root }`
  - `downloads/devflow.xml`：语言、监听地址、Agent 列表
  - `workflows/`：工作流目录（工作流 / 小组 / 阶段 / 技能 Markdown）
  - `scheduler/`：定时任务、运行记录与报告
  - `collab/`、`message-history.jsonc`、`void.db`、`input-stats.json` 等
- **Agent 列表**：直接编辑 `downloads/devflow.xml` 的 `<agents>`，刷新页面即可生效；语言也可在设置面板切换（服务端即时生效）。

敏感信息（令牌、密码、密钥、带凭据的 URL）只放本地 `env/` 目录，禁止写入代码、文档或提交到仓库。

## Markdown 展示增强

Markdown 预览（应用内文件预览、记事本 / Markdown 工具、静态网站页面）共用同一套渲染增强：

- **复杂表格**：GFM 表格渲染为 Element Plus 表格，支持列对齐、超宽表横向滚动与重复行去重。
- **折线图 / 柱状图**：Mermaid `xychart-beta` 中的 `line` / `bar` 自动转换为 ECharts；写成 `line "名称" [...]` 可显示图例。
- **饼图**：Mermaid `pie` 自动转换为 ECharts 饼图。
- **并排图表**：代码块语言标记写成 `mermaid row`，多个图表（如折线图 + 饼图）会在同一行并排展示。
- **PPT 展示**：Markdown 预览点击「PPT 模式」进入演示（静态网站页面同样支持），按一级 / 二级标题自动分页，支持上一页 / 下一页、键盘方向键与全屏；每页中的表格、折线图、饼图都会正常渲染。
- **数据脚本图表**：`mermaid-data` 代码块可读取同目录 CSV / JSON，处理后返回 Mermaid 源码生成图表。

示例见 `test/markdown_data/`（`charts.md`、`mermaid-line-pie.md` 等）。

## 测试

```bash
npm test               # 后端 node:test + 前端 Vitest
npm run typecheck      # 前端 vue-tsc
npm run check:i18n     # 中英词条与硬编码文案检查
npm run count:code     # 去注释 / 空行的实际代码行统计
```

## 常见问题（FAQ）

- **打不开 / 端口被占用**：确认 `data/port.txt` 与 `DEVFLOW_PORT` 是否一致；改端口后需重启后端。
- **终端无法创建（node-pty 报错）**：Node 大版本需与 node-pty ABI 匹配；新环境执行 `npm.cmd approve-scripts node-pty esbuild`，绿色包请使用包内 `runtime/node`。
- **终端里找不到 opencode**：opencode 需在 PATH 中，或使用内置 opencode 的绿色包 / 设置 `DEVFLOW_OPENCODE` 指向可执行文件。
- **修改 `projects.json` 不生效**：该文件不参与 `--watch`，修改后重启后端。
- **界面切换英文后仍有中文**：用户自己填写的名称（项目名、站点名、提示词）属于用户数据不会自动翻译；默认名会随语言切换。
- **静态网站 / 反向代理规则**：在「代理」页配置；静态站点设置根目录后即可访问，支持 SPA 回退、站点前缀与左侧文件树。

## 安全与注意事项

- 服务可在浏览器执行任意 shell 命令，默认只建议监听 `127.0.0.1` 或内网地址。
- 需要公网 / 远程访问时，请使用内置临时邀请链接与密码，或在外层反向代理加鉴权；用完及时失效。
- 不要把 `env/`、运行时数据库、协作私钥、日志等提交到仓库。
