# 设计文档：手机遥控「软件交付」（打包 + 下载）

日期：2026-09-17
分支：master
状态：待评审
前置：`docs/superpowers/specs/2026-09-17-remote-coder-phone-design.md`（手机遥控基础能力）

## 1. 概述

在手机遥控页（`/?phone=1`）上增加「软件交付」能力：手机点一下「打包」，本机把 release 绿色包打出来，手机看到结果并能把产物下载走。

沿用现有手机遥控的三条既有约束：手机只看终端截图、命令通道走 `remote_coder/messages.jsonc`、执行发生在桌面端打开的页面里。

已与用户确认的约束：

- 手机页布局对齐主界面：**只要**中间终端展示区 + 底部输入框，不要左侧活动栏与文件树。
- 终端画面仍是**截图**（沿用现有 PNG 机制），不做 WS 实时终端。
- 「打包」是一个**独立按钮**（不是复用消息通道、也不是输入框前缀识别）。
- 执行侧走**桌面端浏览器**：复用现有 `df-remote-send` → `sendToActive` 那条链路，零新增执行机制。
- 打进终端的内容 = workflow XML 里 `package`（打包release）阶段的提示语。
- 结果与产物通过**手机直接查产物目录**（做法 A）回传：服务端加两个只读端点，`messages.jsonc` 保持单向（手机 → 桌面），不写结果条目。

## 2. 架构与数据流

### A. 交付（手机发起）

1. 手机点「打包」→ `POST /api/remote-coder/message` `{ kind: 'deliver' }`
2. 服务端追加一条 `messages.jsonc` 条目，返回 `{ ok, id }`
3. 桌面端下一轮 `GET /api/remote-coder/inbox` 拿到该条目 → 立即 `POST /api/remote-coder/ack`
4. 桌面端派发窗口事件 `df-remote-deliver`
5. `TerminalView` 取当前 workflow 中 `id === 'package'` 阶段的提示语，`sendToActive(text)` 打进当前活动会话（等同在输入框回车）
6. 手机侧记下点击时刻 `deliverAt`，每 3s 轮询 `GET /api/remote-coder/artifacts`
7. 出现 `mtime > deliverAt` 的产物 → 显示「已完成：<名字>」+「下载」链接（`GET /api/remote-coder/artifact?name=<名字>`）
8. 超时（默认 10 分钟）→ 显示「未检测到新产物（请点『截图』查看终端）」

### B. 截图 / 发消息

完全不变，见前置设计文档。

### C. 文件兜底

不变：外部直接往 `messages.jsonc` 追加 `kind: 'deliver'` 条目同样生效（`/inbox` 每次实时读文件）。

## 3. 协议与文件

`remote_coder/messages.jsonc` 新增一种条目：

```jsonc
[
  // 手机点「打包」
  { "id": "d-1758000000000-a1b2", "ts": 1758000000000, "kind": "deliver", "handled": false }
]
```

规则：

- `kind` 白名单：`screenshot` | `message` | `deliver`；`deliver` 无 `text`。
- `id` 前缀：`screenshot → c`、`deliver → d`、其余（`message`）→ `m`。
- 其余（`ts`、`handled`、原子写、坏文件不覆盖）沿用现有规则。

产物目录：`<应用目录>/dist-portable/`（即 `scripts/build.js` 的 `OUT_ROOT`，固定路径，不做可配置）。

## 4. 服务端

### 4.1 `server/remote-coder-store.js`（纯逻辑，新增三个函数 + 两处小改）

- `newId(kind, now, rand)`：前缀由二元三目改为映射（`screenshot → c`、`deliver → d`、其余 `m`）。
- `makeEntry(input, now, rand)`：`kind` 白名单扩为三种；`message` 仍要求非空 `text`，`screenshot` / `deliver` 不要求。
- `artifactsDir(root)`：返回 `path.join(root, 'dist-portable')`。
- `listArtifacts(dir)`：目录不存在返回 `[]`；否则只取**普通文件**，返回 `[{ name, size, mtime }]`，按 `mtime` 倒序。
- `resolveArtifact(dir, name)`：`name` 必须等于 `path.basename(name)`（拒绝任何路径分隔与 `..`），且 `path.resolve(dir, name)` 必须仍在 `dir` 内，否则抛 `bad-name`；文件不存在抛 `not-found`；返回绝对路径。

### 4.2 `server/remote-coder-mount.js`（新增两个只读端点）

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| GET | `/api/remote-coder/artifacts` | — | `{ items: [{ name, size, mtime }] }` |
| GET | `/api/remote-coder/artifact` | `?name=<文件名>` | 文件流；zip → `application/zip`，其余 `application/octet-stream`；`Content-Length` 取文件大小，`Cache-Control: no-store` |

- 错误映射：`bad-name` → 400；`not-found` → 404；其余沿用现有 `internal` 500。
- 不新增文件：端点加在现有 mount 里，文件层逻辑加在现有 store 里。
- 两个端点都在 `/api/remote-coder/*` 前缀下，沿用现有远端访问门禁，不新增豁免。

## 5. 前端

### 5.1 桌面端

- `web/src/remote-coder/useDesktopRemoteCoder.ts`：`RemoteEntry.kind` 扩为 `'screenshot' | 'message' | 'deliver'`；派发分支新增 `else if (e.kind === 'deliver') deps.dispatch('df-remote-deliver')`（ack 逻辑不变）。
- `web/src/components/TerminalView.vue`：新增 `onRemoteDeliver()` —— 在当前 workflow 里找 `id === 'package'` 的阶段，取其 `prompts[0]`（找不到则回退 `t('termwf.package.prompt')`），调现有 `sendToActive(text)`；监听注册/注销与 `df-remote-send`、`df-remote-screen` 并排。

### 5.2 手机页 `web/src/remote-coder/PhoneView.vue`

- 顶栏（复用主界面 `.top` 的视觉语言：`--bg1` 背景 + 下边框）：标题 + 「截图」+ 「打包」+ 状态文字。
- 中间：终端截图区占满剩余高度（沿用 `<img :src="screenUrl(rev)">`；无图显示占位文案），背景用终端底色。
- 底部：沿用现有输入框 + 发送键（回车发送）。
- 「打包」：点击后置 `delivering`（独立于截图用的 `pending`）→ 记 `deliverAt = Date.now()` → `requestDeliver()` → 提示「已下发打包，等待产物…」→ 轮询 `/artifacts`；命中 → 「已完成：<名字>」+「下载」链接；超时 → 「未检测到新产物（请点『截图』查看终端）」；失败 → 「下发失败：{msg}」。
- 手机端不显示历史产物列表（只显示本次打包结果 + 下载链接）。

### 5.3 组合式函数 `web/src/remote-coder/useRemoteCoder.ts`

- `requestDeliver(deps)`：`POST /message { kind: 'deliver' }`（复用现有 `postJson`）。
- `fetchArtifacts(deps)`：`GET /artifacts` → `{ items }`（失败返回空数组，与 `fetchScreenRev` 同风格）。
- `waitForNewArtifact(sinceTs, opts)`：默认 3s 间隔轮询，命中 `mtime > sinceTs` 即返回该条目；`opts.timeoutMs` 默认 10 分钟；超时返回 `null`。

### 5.4 i18n 词条（中英同时补齐）

| key | zh-CN | en |
| --- | --- | --- |
| `remote.deliver` | 打包 | Build |
| `remote.deliver_sent` | 已下发打包，等待产物… | Build requested, waiting for artifact… |
| `remote.deliver_done` | 已完成：{name} | Done: {name} |
| `remote.deliver_timeout` | 未检测到新产物（请点「截图」查看终端） | No new artifact detected (tap "Capture" to check the terminal) |
| `remote.deliver_failed` | 下发失败：{msg} | Request failed: {msg} |
| `remote.download` | 下载 | Download |

## 6. 测试与验收

- `server/test/remote-coder-store.test.js`：`deliver` 条目前缀 `d-` 且无 `text`；`listArtifacts` 按 `mtime` 倒序、忽略子目录、目录不存在返回 `[]`；`resolveArtifact` 拒绝 `../` 与含分隔符的名字，文件不存在抛 `not-found`。
- `server/test/remote-coder-mount.test.js`：`GET /artifacts` 正常与空目录；`GET /artifact?name=` 正常流式返回、404、穿越名 400。
- `web/src/remote-coder/useDesktopRemoteCoder.test.ts`：`deliver` 条目派发 `df-remote-deliver` 且被 ack。
- `web/src/remote-coder/useRemoteCoder.test.ts`：`requestDeliver` 的 POST 形状；`waitForNewArtifact` 命中与超时返回 `null`。
- `web/src/remote-coder/PhoneView.test.ts`：点「打包」→ 进入等待并提示；命中后出现「已完成」与下载链接；超时提示。
- 人工验收（dev，端口 33333）：手机页点「打包」→ 桌面当前会话收到 `package` 阶段提示语 → 终端跑打包 → `dist-portable/` 出新 zip → 手机显示「已完成」并可下载。
- 全绿：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web`。

## 7. 边界与取舍

- **桌面页面必须打开且可见**：执行发生在桌面页里（沿用现有约束，用户已确认）。
- **完成判定靠产物**：不解析 agent 输出；打包失败只会表现为「超时 + 无新产物」，需点「截图」看终端定位。
- **产物目录固定**：`<应用目录>/dist-portable/`，不做可配置；只服务该目录下的普通文件，禁止路径穿越。
- **产物可能很大**（含 Node 运行时，zip 可达上百 MB）：不做分片/断点续传/进度条。
- **多次打包**：以点击时刻 `mtime` 为准，只认「比点击更新的」产物；并发点击不排队、不互斥。
- **同名产物覆盖**：`dist-portable/` 里同名 zip 被覆盖时 `mtime` 会更新，仍能被识别。

## 8. 明确不做

- 不做服务端后台执行 / `messages.jsonc` 文件 watcher（已选桌面端执行）。
- 不把打包结果回写 `messages.jsonc`（已选做法 A，保持文件单向）。
- 不做实时终端流（WS）到手机，不做打包进度条/日志流。
- 不做手机端阶段 chips、翻译按钮、产物列表。
- 不做产物删除/清理、不做下载鉴权之外的新权限机制。

## 9. 决策记录

- 手机页只保留「中间终端区 + 底部输入框」，去掉左侧活动栏/文件树：用户选择（选项 2）。
- 终端画面保持截图（PNG），不做实时终端：用户选择（选项 3）。
- 执行侧走桌面端浏览器、复用 `sendToActive`：用户选择（选项 1）。
- 触发方式是手机页独立「打包」按钮，写 `kind: 'deliver'` 条目：用户选择（选项 1）。
- 打进终端的内容复用 `package` 阶段提示语：用户选择（选项 1）。
- 结果回传用「手机直接查产物目录」+ 下载入口：用户选择（做法 A / 选项 3）。
- 代码复用优先，不重复实现：用户明确要求。
