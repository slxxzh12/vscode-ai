# AI 命令执行网站设计

## 背景

代理工具（`web/src/components/ProxyHubView.vue`）现有三个页签：静态网站、Nginx 反向代理、LLM 中转站。静态网站（`server/proxy-static.js`）已经能按端口或路径前缀对外提供静态页面。

现在需要在「静态网站」左侧新增一个「AI 命令执行」页签：把一个**插件目录**作为站点内容对外提供。插件目录下每个子目录是一个插件（含 `manifest.json`、logo、`workflow/` 提示词与资源）。浏览器打开站点看到插件列表（logo + 名称 + 描述），点插件进入表单（字段由 manifest 声明），填完点执行后，服务端把用户输入写入临时目录、把插件 workflow 内容复制进临时目录，再调用默认 agent 跑 workflow，产物收集到临时目录的 `output/` 下并展示。

## 目标

- 代理工具新增「AI 命令执行」页签，位于「静态网站」左侧。
- 站点配置：插件根目录、接入模式（独立端口 / devflow 路径前缀）、启用开关、鉴权开关。
- 扫描插件根目录下含 `manifest.json` 的一级子目录，读取名称、描述、logo、workflow 与字段定义。
- 站点页面（服务端渲染 HTML，不依赖前端构建）：
  - 插件列表页：卡片展示 logo + 名称 + 描述。
  - 插件表单页：按 manifest `fields` 渲染 HTML 原生表单控件。
  - 执行页：流式显示 agent 输出/进度；结束后展示 `output/` 文件列表，可预览/下载/打包 zip。
- 执行流程：建 run 临时目录 → 写 `input.json` → 复制插件 workflow 目录内容 → 调默认 agent（`opencode run "<workflow 提示词内容>"`）→ 流式回传 → 产物进 `output/`。
- 鉴权：默认开启，账号为「用户名 + Token」列表（参考 `server/remote-users.js`）；支持关闭鉴权。
- 用户使用次数埋点：每次成功执行累加对应用户 `uses`，记录 `lastRunAt`，为后续统计页预留数据。
- run 目录保留最近 50 个，创建新 run 时清理最旧。
- 全量中英 i18n。

## 非目标（YAGNI）

- 不做插件热加载 websocket 推送（页面刷新/请求时实时扫描即可）。
- 不做字段类型 `file` 上传（v1 遇到 `file` 字段忽略并在页面提示）。
- 不做多站点（全局只一个 AI 站点）。
- 不做执行历史列表页（本次只做单次运行查看；run 目录保留供下载）。
- 不做插件市场/在线安装。
- 不做 AI 输出的 Markdown 富文本渲染（输出区按纯文本 `<pre>` 流式展示；`output/` 文件另做预览）。

## 设计

### 一、配置数据模型

`<数据目录>/ai-site/config.json`

```json
{
  "pluginRoot": "",
  "mode": "port",
  "listenHost": "0.0.0.0",
  "listenPort": 22300,
  "pathPrefix": "/ai",
  "enabled": false,
  "requireAuth": true,
  "sessionSecret": "<自动生成>"
}
```

- `mode='port'`：独立监听 `listenHost:listenPort`。
- `mode='path'`：挂在 devflow 主服务端口，前缀 `pathPrefix`（需校验 `/` 开头、不以 `/` 结尾、不与 `/api`、`/ws` 等保留前缀冲突，且不与代理规则前缀冲突）。
- `pluginRoot` 必须存在且是目录；保存时解析为绝对路径。
- `sessionSecret` 用于登录 Cookie 签名，首次保存时生成。
- `enabled=false` 时不监听、路径模式下不拦截。

### 二、插件目录与 manifest

```
<pluginRoot>/
  pluginA/
    manifest.json
    logo.png
    workflow/
      prompt.md
      ...其他模板/资源
  pluginB/
    ...
```

```json
{
  "name": "翻译助手",
  "description": "把文本翻译成指定语言",
  "logo": "logo.png",
  "workflow": "workflow/prompt.md",
  "fields": [
    { "key": "text", "label": "要翻译的文本", "type": "textarea", "required": true },
    { "key": "lang", "label": "目标语言", "type": "select", "options": ["中文", "英文"], "required": true },
    { "key": "tone", "label": "语气", "type": "text", "placeholder": "正式/口语" }
  ]
}
```

- `fields[].type` 使用 HTML 原生表单类型：`text` / `textarea` / `select` / `number` / `checkbox` / `date` / `color` / `password` / `email` / `url` / `tel` / `range`。
  - `select` 必须有 `options: string[]`；`number`/`range` 可选 `min`/`max`/`step`；`text` 等可选 `placeholder`、`default`。
  - `file` 类型 v1 忽略并在表单页给出提示。
- `workflow` 为相对插件目录的文件路径；执行时复制其**所在目录**（如 `workflow/`）的全部内容到 run 根。
- `logo` 为相对插件目录的图片路径；缺失或非法时用占位图标。
- 插件名缺失时回退目录名。
- 所有相对路径解析后必须仍在插件目录内（防穿越）。

### 三、目录与运行数据

- 配置：`<数据目录>/ai-site/config.json`
- 用户：`<数据目录>/ai-site/users.json`
- 运行：`<数据目录>/ai-site/runs/<runId>/`
  - `input.json`：用户输入 `{ key: value }`
  - 复制进来的 workflow 目录内容
  - `output/`：agent 产物目录（执行前创建）
  - `run.json`：`{ id, plugin, user, startedAt, finishedAt, exitCode, status, error }`
  - `run.log`：stdout + stderr 原文
- 保留最近 50 个 run，创建新 run 前按 `startedAt` 清理最旧。

### 四、站点路由（服务端渲染 HTML + JSON/SSE）

站点根由接入模式决定（独立端口根路径，或 devflow 的 `pathPrefix`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 已登录显示插件列表；未登录（`requireAuth=true`）显示登录页 |
| GET | `/p/<plugin>` | 插件表单页 |
| POST | `/__login` | 表单登录（`username` + `token`），成功写 Cookie 后 302 回 `/` |
| GET | `/__logout` | 清除 Cookie 回 `/` |
| GET | `/__assets/logo/<plugin>` | 返回 logo 图片 |
| POST | `/__api/run` | body `{ plugin, values }`，创建 run 并启动 agent，返回 `{ runId }` |
| GET | `/__api/stream/<runId>` | SSE：`chunk`/`status`/`done` 事件流 |
| GET | `/__api/runs/<runId>/files` | `output/` 文件列表（相对路径 + 大小 + mtime） |
| GET | `/__api/runs/<runId>/file?path=` | 预览/下载 output 单个文件（防穿越） |
| GET | `/__api/runs/<runId>/zip` | 打包 `output/` 下载 |

鉴权：

- `requireAuth=true` 时，除 `/__login`、静态样式与 logo 外的请求都要有效登录 Cookie。
- 登录成功写 HttpOnly Cookie：`df_ai_auth=<userId>.<hmac>`，`sessionSecret` 做 HMAC；每次请求验签并查用户启用状态。
- 支持 `?access=<token>`：按 token 找到启用用户则直接写 Cookie 并跳回（方便分享链接）。
- `requireAuth=false` 时跳过登录，使用记录归属 `anonymous`。

### 五、执行流程

1. 校验插件存在、必填字段齐全；校验所有字段 key 来自 manifest（忽略多余字段）。
2. 创建 `<runs>/<runId>/`，写 `input.json`（字段 key→value）。
3. 读取 `manifest.workflow` 内容作为提示词；复制其所在目录全部内容到 run 根（保持相对结构，防穿越）。
4. 创建 `output/`。
5. 解析默认 agent：`resolveAgentBin('opencode')`（Windows 走 `wrapCmdBin`），`spawn` 参数 `['run', '<workflow 提示词内容>']`，cwd=run 根，env=`withAgentEnv()`。
6. stdout/stderr 追加到 `run.log` 并广播给 SSE 订阅者；进程退出写 `run.json` 最终状态。
7. 本次用户 `uses + 1`、`lastRunAt = now`；任务并发上限（每站点同时只允许 1 个 run，避免端口/资源争用，后续可放宽）。
8. 超时：默认 10 分钟（可环境变量覆盖），超时杀进程并标记 `status='timeout'`。

### 六、后端模块（`server/ai-site/`）

- `config-store.js`：读写校验 `config.json`（原子写），生成/保留 `sessionSecret`。
- `users.js`：基于 `server/remote-users.js` 的账号模型（用户名 + token + enabled + lastLoginAt），额外维护 `uses`、`lastRunAt`；文件 `<数据目录>/ai-site/users.json`。
- `plugins.js`：`listPlugins()`（扫描/解析 manifest、过滤非法）、`readPlugin(name)`、`readLogo(name)`、路径安全校验。
- `runner.js`：`createRun({ plugin, values, user })`、`subscribe(runId, cb)`、`getRun(runId)`、`listFiles(runId, 'output')`、`readFile`、`zipOutput`、保留清理。
- `pages.js`：登录页、插件列表页、表单页 HTML + 内联 CSS/JS；表单按 `fields` 渲染，执行页用 `EventSource` 消费 SSE。
- `serve.js`：站点路由分发（鉴权、HTML、JSON、SSE、文件）。
- `mount.js`：devflow 管理 API `/api/ai-site/*`（配置 GET/POST、启停、用户 CRUD、插件列表预览）。
- `index.js`：装配；端口模式自建 `http.createServer`，路径模式导出 `matchPath(pathname)` / `handleHttp(req,res,url)` 给主服务。

集成：

- `server/index.js` 创建 `aiSite` 并在 `proxyEngine.matchPath` 之前拦截路径模式的请求；`startEnabled()` 随服务启动。
- 管理 API 挂在 `/api/ai-site/*`（参考 `proxy-mount.js` 写法）。

### 七、前端（devflow 界面）

- `ProxyHubView.vue`：页签条最左侧新增 `ai`，默认仍保持 `static`；`ProxyTab` 增加 `'ai'`。
- `web/src/tools/ai-site/AiSiteView.vue`：
  - 站点配置卡片：插件根目录（输入 + 选择目录）、模式（端口/路径）、监听地址/端口或路径前缀、启用开关、鉴权开关、保存/启停。
  - 访问 URL 展示、打开、复制。
  - 用户区（配置卡片下方）：用户列表（用户名、启用开关、使用次数、最后登录）、新增用户（自动生成 token 并展示/复制）、删除。
  - 插件预览：列出扫描到的插件（logo + 名称 + 描述），便于确认插件目录正确。
- `web/src/tools/ai-site/useAiSite.ts`：`/api/ai-site/*` 数据层。
- 新增中英词条 `ai_site.*`、`proxy.tabs.ai`（两文件键集合对称）。

### 八、安全

- 所有文件访问（logo、workflow 复制、output 读取）使用统一 `inside(root, target)` 防穿越；拒绝 `..`、绝对路径、符号链接逃逸。
- manifest 严格校验：字段类型白名单、`key` 非空且唯一、`options` 数组、路径相对且不越界。
- 登录 Cookie 用 `sessionSecret` HMAC 签名，HttpOnly；`?access=` 校验后写 Cookie。
- `uses`/`lastRunAt` 只由服务端在成功创建 run 时更新。
- 不在日志输出 token、用户输入内容（`input.json` 仍落盘供 agent 读取）。
- 并发限制 1 个 run；超时杀进程。
- 路径前缀保存时校验保留前缀（`/api`、`/ws`）与代理规则前缀冲突。

### 九、测试

- 后端单测（`server/test/`）：
  - `plugins`：manifest 解析、缺失字段回退、穿越路径拒绝、`file` 类型忽略。
  - `config-store`：默认值、非法模式/端口/前缀校验、sessionSecret 稳定。
  - `users`：用户名唯一、token 生成、登录校验、uses 累加。
  - `runner`：注入假 spawn，验证 run 目录结构、`input.json`、workflow 复制、`output/` 创建、保留清理、状态落盘。
  - `serve`：登录重定向/鉴权拒绝、插件列表/表单 HTML 关键片段、SSE 转发、output 文件读取防穿越。
- 前端单测：`useAiSite` 请求路径、`AiSiteView` 渲染与保存调用。

### 十、目录速览补充

- 新增 `server/ai-site/`（配置/用户/插件/执行/页面/路由/管理 API）。
- 新增 `web/src/tools/ai-site/`（页签视图 + 数据层）。

## ���䣺������м��ɣ��û����������б���

- AI վ��ÿ��ִ��ͬ��д����ȶ��б� `t_sched_job`��
  - `jobId = ai_<runId>`��Ψһ����`topic` �������ҵ��ͬ��`groupName = 'ai-site'`��
    `taskId = runId`��`classname = 'ai-site'`��`methodName = 'run'`��
  - ����� `status = 3`�������У���worker ֻ��ȡ `status=0`����˲��ᱻ���� worker ִ�С�
  - `paramStr = { task: { name: ������� }, plugin, user, runId, runDir }`�������б���ʾ��������
  - `result = { runId, logPath, outputDir, error? }`������������������ log �ӿڡ�
  - ����ʱ��״̬����Ϊ `1`���ɹ���/`2`��ʧ��/��ʱ����д�� `runtime`��
- ���з������� `enqueueExternalJob` / `updateExternalJob`��`listJobs` ֧�ְ� `groupName` ���ˡ�
- ��������С�ҳ���������û����������б����飺��ͬһ����ҵ������ɸ `groupName='ai-site'`��
  չʾ��������û���״̬��ʱ�䡢��ʱ�������������������룬��־�� `result.logPath`��
- ʹ�ô������� AI վ���Լ��� `users.json` ͳ�ƣ����м�¼ֻ����չʾ���������ڡ�

## ���䣺ִ���� / �Ự / ���� IP �롸�����Ự��

- ������ҵ��¼��`t_sched_job`�����Ᵽ�棺
  - `executor`��AI վ�㴥�� = ��¼�û�������ʱ/ϵͳ���� = `system`��
  - `sessionId`���� agent ����������� opencode `sessionID`����������ʱ���գ�ͬʱ��¼ `runId`��AI վ�� run ��ʶ�����ס�
  - `createIP`��AI վ��ȡ������Դ IP������ `X-Forwarded-For`������ socket ��ַ������ʱ��������ԭ�� createIP��
  - �����ֶ�д�� `paramStr` �� `result`��JSON���������б����û����������б�����������չʾ��
- �������Ự��������������Դ� `sessionId` ����ҵ�ṩ��ڡ�
  - ���Ự�˱��Ѵ��ڸ� `agentSessionId`��ֱ�� `restoreSessionById` �ָ�ԭ devflow �Ự��
  - ������ҵ�� cwd��AI վ�� = runDir����ʱ���� = ���� cwd/��Ŀ�����½� agent �Ự��
    �� `buildResumeCommand` ע�� `<agent> --session <id>`���� `--resume`�������� `agentSessionId`
    ��д�Ự�˱���ǰ�˴򿪸ûỰ���е�����ҳ�����·�ָ�
