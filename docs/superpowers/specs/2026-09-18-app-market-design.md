# 设计文档：应用市场（左侧活动栏「移动」页签重做）

日期：2026-09-18
分支：master
状态：待实现

## 1. 需求

用户原文：

> 左边的 手机编程图标，改成一个 市场 图标

澄清后：

> 市场改成 应用市场

范围确认为「图标、提示、页面内容整体按『应用市场』重做」，内容按「客户端下载 + 扩展安装 + 小工具」分类展示。

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 入口图标 | 左侧活动栏 `📱` → `🏪` |
| 2 | 入口提示 | `nav.mobile`：zh「移动」→「应用市场」，en「Mobile」→「App Market」 |
| 3 | 内部路由 id | 保持 `mobile` 不变（避免改动 `windowState.Rail` 存档格式与 hash 白名单 `RAILS`） |
| 4 | 页面结构 | 三个区块：客户端下载 / 扩展安装 / 小工具 |
| 5 | 客户端数据源 | 静态 gitee releases 链接（沿用现有常量）+ 桌面版本取 `/api/version` |
| 6 | 扩展数据源 | 复用 `useCollab().listDownloads()` 与 `installDownload(name)`，**不改后端** |
| 7 | 小工具 | 直接嵌入现有 `MiniTools.vue`（翻译 / YAML / JS / 排序） |
| 8 | 公告 | 保留，置于页面顶部 |
| 9 | 反馈 / 教程 | 降为页面底部小链接 |
| 10 | 移除内容 | 手机编程 hero、卖点列表、git 仓库说明整段删除 |

## 3. 现状（改动前）

- 入口：`web/src/App.vue:565`
  `<button class="a-btn" ... :title="$t('nav.mobile')" @click="rail = 'mobile'">📱</button>`；
  `App.vue:588-592` 渲染 `<MobileView />`。
- `web/src/components/MobileView.vue`：公告（`/api/notice`）、反馈、手机编程 hero + 卖点、git 说明、桌面/移动下载卡片（含二维码 `mobile/qr-mobile.svg`）、B 站教程链接，右栏 `MiniTools`。
- 静态链接（`MobileView.vue` 顶部常量）：
  - `DESKTOP_URL = https://gitee.com/slxxzh12/vscode-ai/releases`
  - `MOBILE_URL = https://gitee.com/slxxzh12/vscode-ai-mobile/releases`
  - `TUTORIAL_URL = https://space.bilibili.com/1933375113`
  - `ISSUES_URL = https://gitee.com/slxxzh12/vscode-ai/issues`
- 扩展接口（`web/src/collaboration/useCollab.ts`）：
  - `listDownloads()` → `{ manifest: { files: [{ name, kind, size, updatedAt }] }, usage, group }`
  - `installDownload(name)` → `{ code }`（`code === 'ok'` 表示安装成功）
  - `kind` 取值见 `TasksView.vue`：`skill` / `group` / `usage` / `file`，仅 `skill` 可安装。
- 版本：`web/src/useVersion.ts` 的 `useVersion()` → `GET /api/version`。
- i18n：`shared/i18n/zh-CN.js` 与 `en.js` 的 `nav.mobile`、`mobile.*`（约 807–823 行）。
- rail 取值 `explorer|history|contacts|stat|scheduler|proxy|mobile`，hash 锚点 `#<rail>`，`RAILS` 白名单校验（`App.vue:140`）；`windowState.Rail` 同集合。
- `useCollab()` 是工厂函数，`CollaborationView.vue` 内部自建一份；市场页可自建独立实例。

## 4. 设计

### 4.1 入口改造（`web/src/App.vue`）

- `App.vue:565`：`📱` → `🏪`，`@click="rail = 'mobile'"` 与 `:class` 判断不变。
- 保留 `rail === 'mobile'` 分支，仅把 `<MobileView />` 换成 `<AppMarketView />`。
- `nav.mobile` 词条值改为「应用市场 / App Market」。

### 4.2 新页面 `web/src/components/AppMarketView.vue`

替换 `MobileView.vue`（删除旧文件），布局从上到下：

1. **公告**：沿用 `GET /api/notice?lang=<locale>` + `renderRemoteMarkdown`，无内容时显示空态；`watch(locale)` 重新拉取。
2. **客户端**：卡片网格。
   - Windows 绿色包、macOS（arm64 / x64）、手机端（Android / iOS）。
   - 桌面版本号取 `useVersion()` 的 `version`（拉取失败显示 `—`）。
   - 下载按钮为 `<a :href target="_blank" rel="noopener">`，指向静态 releases 链接。
   - 手机端卡片附二维码 `mobile/qr-mobile.svg`。
3. **扩展**：`onMounted` 调 `collab.listDownloads()` 读取 `manifest.files`。
   - 每行：名称、类型标签（`market.kind.skill|workflow|group|usage|file`）、大小、更新时间；`kind === 'skill'` 显示「安装」按钮。
   - 安装：`collab.installDownload(name)`，成功/失败用状态文案提示。
   - 无文件或接口失败（未入群/离线）显示空态提示。
4. **小工具**：`<MiniTools />`。
5. **底部小链接**：反馈（`ISSUES_URL`）、B 站教程（`TUTORIAL_URL`）。

### 4.3 纯逻辑抽取 `web/src/marketApps.ts`

便于单测、避免组件内堆逻辑：

- `PLATFORMS`：客户端卡片静态清单（id、名称 key、图标、href、是否含二维码）。
- `groupDownloadFiles(files)`：按 `kind` 分组并稳定排序（`skill` 优先，其次按 `updatedAt` 倒序）。
- `fmtSize(bytes)`：字节 → 人类可读（`B/KB/MB/GB`）。
- `installableOf(file)`：`kind === 'skill'`。

### 4.4 i18n

- 新页面只使用 `market.*` 词条：`market.title`、`market.clients`、`market.extensions`、`market.tools`、`market.download`、`market.install`、`market.installed`、`market.install_failed`、`market.empty`、`market.version`、`market.kind.*`、`market.client.win/mac_arm/mac_x64/android/ios`、`market.notice`、`market.notice_empty`、`market.feedback.*`、`market.tutorial` 等；`nav.mobile` 改值。
- 删除仅被 `MobileView.vue` 使用的全部 `mobile.*` 词条（`mobile.title`/`desc`/`pair_hint`/`feat.*`/`git.*`/`desktop`/`mobile`/`desktop_hint`/`scan_hint`/`download`/`notice*`/`feedback.*`/`tutorial`）。
- 中英两文件键集合保持对称。

## 5. 测试与验收

- 单测：新增 `web/src/marketApps.test.ts` 覆盖 `groupDownloadFiles` / `fmtSize` / `installableOf`。
- 命令：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。
- 人工：左侧出现 🏪「应用市场」→ 三个区块正常渲染；公告可加载；客户端下载链接可点；入群后扩展列表出现技能且「安装」可用；小工具可打开；中英切换即时生效；深浅色主题正常。

## 6. 不做（范围外）

- 不改后端接口，不新增「应用市场」服务端清单。
- 不改 rail id / hash / `windowState` 存档格式。
- 不改 `mobileLanding`（超过阈值自动落到 `mobile` 栏位）的既有行为。
- 不重构 `MiniTools`、协作分发的既有逻辑。
