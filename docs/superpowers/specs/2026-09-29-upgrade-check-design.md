# 升级检测 — 设计

## 1. 背景与目标

应用以绿色包分发，版本格式 `vYYYYMMDD`（`server/version.js` 的 `VERSION`，经 `/api/version` 暴露）。用户希望知道自己用的是不是最新版。

目标：自动检测远端最新版本，有新版本时通过**顶栏徽标 + 关于页详情 + 每 10 天一次的弹窗**提醒，并可跳转下载页。

## 2. 范围

数据源：Gitee Releases API
`https://gitee.com/api/v5/repos/slxxzh12/vscode-ai/releases/latest` → `tag_name`（形如 `v20260929`）。
下载页：`https://gitee.com/slxxzh12/vscode-ai/releases`。

改动：

- 新增 `server/upgrade.js`（检测器）。
- 改 `server/index.js`：创建检测器、启动+每 10 天检查、`GET /api/upgrade`。
- 新增 `web/src/useUpgrade.ts`（模块级状态）。
- 新增 `web/src/components/UpgradeDialog.vue`（弹窗）。
- 改 `web/src/App.vue`：顶栏徽标 + 挂载加载 + 弹窗接入。
- 改 `web/src/components/TerminalView.vue`：关于页「升级检测」行 + 「检查更新」按钮。
- 新增 `server/test/upgrade.test.js`、`web/src/useUpgrade.test.ts`。
- i18n：`shared/i18n/{zh-CN,en}.js` 新增 `upgrade.*`。

不做：自动下载/替换、签名校验、增量更新。

## 3. 行为设计

### 3.1 服务端检测器 `server/upgrade.js`

```js
export function compareVersion(a, b) // 返回 -1/0/1
export function createUpgradeChecker({ apiUrl, currentVersion, timeoutMs = 5000, cacheMs = 10天, fetchImpl = fetch, now = Date.now })
```

- `check(force = false)`：
  - 非 force 且缓存未过期（`now < expiresAt`）→ 直接返回缓存结果。
  - 否则 `fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'devflow' } })`，`res.json()` 取 `tag_name`。
  - `latest` = 规范化 tag（去空白）；`hasUpdate = compareVersion(latest, current) > 0`。
  - 结果 `{ ok: true, current, latest, hasUpdate, url, checkedAt }` 并写缓存（`expiresAt = now + cacheMs`）。
  - 失败：若有缓存 → 返回缓存（`stale: true`）；否则 `{ ok: false, current, latest: '', hasUpdate: false, url, error, checkedAt }`（不抛错）。
- 比较规则：两边去掉前导 `v`；都匹配 `^\d{8}$` 时按数值比较；否则按字符串 `localeCompare`。`current` 为空（dev 未解析）时视为 `hasUpdate:false`。
- `url` 固定为下载页。

### 3.2 接口

`GET /api/upgrade` → `checker.check(false)`；`GET /api/upgrade?refresh=1` → `checker.check(true)`。
`GET /api/version` 保持不变。

### 3.3 启动与定时（`index.js`）

- 启动即 `checker.check()`（异步、不阻塞启动；失败静默）。
- `setInterval(() => checker.check(), 10 * 24 * 3600 * 1000).unref()`。

### 3.4 前端

- `web/src/useUpgrade.ts`（仿 `useVersion`）：`const upgrade = ref<UpgradeInfo|null>(null)`；`loadUpgrade()` 拉 `/api/upgrade`（缓存 pending）；`checkNow()` 拉 `/api/upgrade?refresh=1` 并更新。
- `App.vue`：`onMounted` 调 `loadUpgrade()`；顶栏 `appVersion` 旁，当 `upgrade?.hasUpdate` 显示可点徽标 `↑ $t('upgrade.new')`，点击 `window.open(upgrade.url)`。
- 关于页（`TerminalView.vue`）：新增 `setsec`「升级检测」——当前版本 `appVersion`、最新版本 `upgrade?.latest || '-'`、「检查更新」按钮（`checkNow()`，进行中禁用）。
- `UpgradeDialog.vue`：App 加载时判断是否弹窗：
  - 条件：`upgrade?.hasUpdate` 且 `latest !== localStorage['devflow-upgrade-skip']` 且 `now - Number(localStorage['devflow-upgrade-popup-at'] || 0) >= 10天`。
  - 内容：标题「发现新版本」、当前版本 / 最新版本；按钮：
    - 「去下载」→ 打开下载页，同时记 `popup-at = now`（视为已提示）。
    - 「关闭」→ 记 `popup-at = now`。
    - 「不再提示」→ 记 `skip = latest`（该版本不再自动弹）。
  - 每 10 天最多自动弹一次。

### 3.5 i18n（`upgrade.*`，中/英对称）

`upgrade.title`（发现新版本）、`upgrade.check`（升级检测）、`upgrade.check_now`（检查更新）、`upgrade.checking`（检查中…）、`upgrade.current`（当前版本）、`upgrade.latest`（最新版本）、`upgrade.new`（新版本）、`upgrade.up_to_date`（已是最新）、`upgrade.failed`（检测失败）、`upgrade.go`（去下载）、`upgrade.later`（关闭）、`upgrade.skip`（不再提示）。

## 4. 边界与错误

- 远端不可达/超时/非 2xx/JSON 解析失败：不抛错，返回上次缓存或 `ok:false`；前端徽标/弹窗不显示。
- `current` 无法解析（dev、`DEVFLOW_VERSION` 覆盖）：按字符串比较；`current` 空则 `hasUpdate:false`。
- 无 `latest`：不显示徽标、不弹窗。
- 手动「检查更新」失败：关于页显示 `upgrade.failed`。
- Gitee API 未认证可能有频率限制：10 天间隔 + 本地缓存足够低频。

## 5. 测试

- `server/test/upgrade.test.js`：
  - `compareVersion`：`v20260929 > v20260101`、相等、非法格式回退字符串比较。
  - `createUpgradeChecker`：注入 `fetchImpl` 返回 `{ tag_name }` → `hasUpdate` 正确、写缓存；缓存未过期不再 fetch；`refresh=1` 强制 fetch；fetch 抛错时有缓存回退 stale、无缓存 `ok:false`；超时用 `AbortSignal.timeout`。
- `web/src/useUpgrade.test.ts`：
  - `loadUpgrade` 拉 `/api/upgrade` 并填充；`checkNow` 拉 `?refresh=1`。
  - 弹窗判定纯函数（抽取 `shouldPopup({ hasUpdate, latest, skip, popupAt }, now)`）——跳过版本/10 天内不弹/满足条件弹。
- i18n：`npm.cmd run check:i18n`。

## 6. 验收

- 本地版本 < 远端 tag 时：顶栏出现可点「↑ 新版本」，点击打开下载页；关于页显示当前/最新版本。
- 首次加载且有新版 → 弹窗；点「关闭」后 10 天内不再弹；点「不再提示」后该版本不再弹。
- 远端不可达时静默，无报错。
- `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 通过。
