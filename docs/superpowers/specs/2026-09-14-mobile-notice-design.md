# 设计文档：移动端「最新消息」来自远端 notice.md

日期：2026-09-14
分支：master
状态：待评审（已与用户确认：显示在移动端页）

## 1. 概述

移动端页（`web/src/components/MobileView.vue`）新增「最新消息」区块，内容来自 Gitee 上一个可随时编辑的 Markdown 文件，无需发版即可更新公告（版本发布、教程等内容都可写进去）。

- 内容源（raw，按语言分文件）：`https://gitee.com/slxxzh12/vscode-ai-mobile/raw/master/notice/<lang>/main.md`（`<lang>` 为 `zh-CN` / `en`）
- 用户界面里的地址（blob）：`https://gitee.com/slxxzh12/vscode-ai-mobile/notice/<lang>/main.md`（该仓库当前为空，本次一并建初稿）

## 2. 为什么走服务端

浏览器直接 fetch Gitee raw 可能被 CORS 拦截，且不便缓存。改由本地服务端抓取 + 缓存，前端只调本地 API。

## 3. 服务端

新增 `server/notice.js`：

- `noticeUrl(lang)`：按语言拼 `<base>/<lang>/main.md`，非法语言回落 `DEFAULT_LOCALE`（zh-CN）。
- `createNotice({ url, timeoutMs = 5000, cacheMs = 10*60*1000, fetchImpl = fetch })` 返回 `{ get(), clear() }`。
- `get()` 语义：
  - 命中缓存（未过期）→ `{ ok: true, content, fetchedAt, cached: true }`。
  - 抓取成功（HTTP 200）→ 写缓存并返回 `{ ok: true, content, fetchedAt, cached: false }`。
  - 抓取失败但存在旧缓存 → 返回旧内容并标 `stale: true`（离线仍可看）。
  - 抓取失败且无缓存 → `{ ok: false, error }`。
- 抓取用 `AbortSignal.timeout(timeoutMs)`；`fetchImpl` 可注入以便单测。

`server/index.js` 在「配置级接口」区新增路由：

- `GET /api/notice?lang=<locale>` → 200 + JSON（即 `notice.get(lang)` 的结果）。

## 4. 前端

`web/src/markdown.ts` 新增 `renderRemoteMarkdown(mdText)`：用现有 `md` 渲染（不注入 `opt`，即不把相对路径改写到 `/api/raw`），并把外链 `<a href="http...">` 后处理为 `target="_blank" rel="noopener"`。

`web/src/components/MobileView.vue`：

- `onMounted` 与 `watch(locale)` 时拉 `/api/notice?lang=<当前界面语言>`：
  - `ok && content.trim()` → `noticeHtml = renderRemoteMarkdown(content)`。
  - 否则 → 显示 `$t('mobile.notice_empty')`。
- 在二维码下方渲染「最新消息」区块（标题 `$t('mobile.notice')` + `v-html`）。
- 内容为空/失败时不报错，区块降级为「暂无消息」。

## 5. i18n

`shared/i18n/zh-CN.js` / `en.js` 对称新增：

| key | zh-CN | en |
| --- | --- | --- |
| `mobile.notice` | 最新消息 | Latest news |
| `mobile.notice_empty` | 暂无消息 | No news yet |

## 6. 远端文件

在 `slxxzh12/vscode-ai-mobile` 的 `master` 新建中英两份 `notice/zh-CN/main.md`、`notice/en/main.md`（内容：桌面端下载地址），走 Gitee API（令牌在 `env/gitee-release.ini`，不入库）。

## 7. 测试与验收

- `server/test/notice.test.js`（注入 `fetchImpl`）：
  - 成功抓取并缓存（第二次不再触发 fetch）；
  - 非 200 → 无缓存时 `ok:false`；
  - 失败但有旧缓存 → 返回旧内容 `stale:true`；
  - 超时/异常 → `ok:false`。
- `npm.cmd run typecheck`、`npm.cmd run check:i18n` 通过；全量 `npm.cmd test` 通过。
- 前端按当前界面语言请求 `/api/notice?lang=<locale>`，切换语言时重新拉取；服务端按语言分别缓存。
- 人工：移动端页显示远端 `notice/<lang>/main.md` 渲染内容；改远端文件、等缓存过期（10 分钟）后刷新更新。

## 8. 明确不做

- 不做管理端在线编辑（直接改 Gitee 上的 `notice.md`）。
- 不做「更新角标/未读提醒」。
- 不把 URL 放进 `config/devflow.xml`（先常量；后续需要再挪）。
- 不在服务端做 HTML 清洗（`markdown-it` 默认转义原始 HTML，`v-html` 内容由本地渲染器产出）。
