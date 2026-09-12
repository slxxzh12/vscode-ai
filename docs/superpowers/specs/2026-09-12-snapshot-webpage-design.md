# 设计文档：网页截图（Snapshot）上传至 remote_coder 并入库

日期：2026-09-12
分支：master
状态：待评审（v2，替代 v1 的「本地下载 PNG」方案）

## 1. 概述

在 devflow 网页顶栏新增一个「相机」按钮，点击后：

1. 截取**当前 devflow 页面**（`.app` 根容器，一屏视口）；
2. 把 PNG **上传给本机服务端**；
3. 服务端写入**仓库内固定目录 `remote_coder/`**（时间戳命名，累加不覆盖）；
4. 服务端**自动** `git add` + `git commit` + `git push origin HEAD`。

已与用户确认的约束：

- 目标目录：仓库根下 `remote_coder/`。
- 命名：`devflow-YYYYMMDD-HHmmss.png`，同秒冲突追加 `-1`/`-2`。
- git：服务端自动 commit + push（不再本地下载）。
- 触发：顶栏相机按钮。

## 2. 架构与数据流

```
点击 📷
  └─ 前端 captureToPngDataUrl(.app)            （html-to-image 序列化为 dataURL）
       └─ POST /api/snapshot { dataUrl }
            └─ 服务端 saveSnapshotToRepo()
                 ├─ mkdir remote_coder/
                 ├─ 解码 dataURL → 写 devflow-<ts>.png
                 ├─ git add remote_coder/<file>
                 ├─ git commit -m "snapshot: <file>" -- remote_coder/<file>
                 └─ git push origin HEAD
            ← { ok, file, rel }
  └─ 顶栏短暂提示「已保存到 <file>」；失败 alert
```

## 3. 服务端新增模块 `server/snapshot-store.js`

纯逻辑 + 可注入 `git`，便于单测：

- `SNAPSHOT_DIR = 'remote_coder'`
- `snapshotName(date)`：`devflow-YYYYMMDD-HHmmss.png`（本地时间，补零）。
- `decodePng(dataUrl)`：仅接受 `data:image/png;base64,` 前缀且非空；否则抛 `bad-image`。
- `saveSnapshotToRepo({ repoRoot, dataUrl, date, git })`：
  1. `fs.mkdirSync(<repoRoot>/remote_coder, { recursive: true })`
  2. 计算唯一文件名（存在则 `-1`、`-2`…）
  3. `fs.writeFileSync` 写入解码后的 buffer
  4. 依次 `git add -- <rel>`、`git commit -m "snapshot: <file>" -- <rel>`、`git push origin HEAD`
  5. 返回 `{ file, rel }`
- 默认 `git(repo, args)` 用 `execFile('git', ['-C', repo, ...args], { env: { GIT_TERMINAL_PROMPT: '0' } })`；失败抛 `git-failed` / `git-unavailable`。

## 4. 服务端路由

`server/http-api.js`：

- `createHttpApi({ ..., repoRoot })` 新增依赖。
- `POST /api/snapshot`，body `{ dataUrl }`，body 上限 32MB；成功 `{ ok: true, file, rel }`。
- 错误映射：`bad-image` → 400；其余 → 500（带 message）。

`server/index.js`：`createHttpApi({ projects, saveProjects, logger: log, repoRoot: path.join(__dirname, '..') })`。

## 5. 前端改动

`web/src/snapshot.ts`：

- `captureToPngDataUrl(el, deps?)`：调用 `toPng`，返回 dataURL（`deps.toPng` 可注入）。
- `uploadSnapshot(dataUrl, deps?)`：`POST /api/snapshot`，成功返回 `{ file, rel }`，失败抛错（`deps.fetch` 可注入）。
- 保留 `snapshotBackground` / `snapshotFilter` / `snapshotOptions`。
- 移除 v1 的 `snapshotFileName` / `downloadDataUrl` / `captureToPng`。

`web/src/App.vue`：

- 根节点 `ref="appRef"`（不变）。
- 相机按钮 `📷`（不变），截图期间 `visibility:hidden` + disabled。
- `onSnapshot()`：`nextTick` + `requestAnimationFrame` → `captureToPngDataUrl` → `uploadSnapshot` → 顶栏短暂显示 `top.snapshot.saved`；异常 `alert(top.snapshot.failed)`。
- 新增 `.snap-msg` 样式；`onBeforeUnmount` 清理提示定时器。

## 6. i18n 词条

| key | zh-CN | en |
| --- | --- | --- |
| `top.snapshot` | 截图当前页面 | Capture current page |
| `top.snapshot.saved` | 已保存到 {file} | Saved to {file} |
| `top.snapshot.failed` | 截图失败，请重试。 | Failed to capture the page, please try again. |

## 7. 测试与验收

- `server/test/snapshot-store.test.js`：
  - `snapshotName` 固定日期格式；`decodePng` 接受合法、拒绝非 PNG/空（`bad-image`）。
  - `saveSnapshotToRepo`（临时目录 + 注入 git）：写盘字节正确、文件名时间戳、git 依次 `add`/`commit`/`push`、同秒第二次 `-1`。
- `web/src/snapshot.test.ts`：背景/filter/options 保留；`captureToPngDataUrl` 返回 dataURL 并传对 options；`uploadSnapshot` 正确 POST 与错误抛出。
- `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`、`npm.cmd run build:web` 全通过。
- 人工验收：重启后端（新路由生效）→ 点相机 → `remote_coder/` 出现 PNG → `git log` 出现 `snapshot:` 提交 → 远端已推送。

## 8. 边界与取舍

- **推送被拒**（远端有新提交）：回报失败，本地 commit 仍在，不做自动 rebase。
- **仓库体积**：每张截图都会入库并 push，仓库会增长（用户明确选择）。
- **提交范围**：`git commit -- <rel>` 仅提交该截图，不影响其它暂存改动。
- **失败可见**：写盘成功后若 commit/push 失败，前端提示失败；文件保留在本地。
- **远程访问**：`/api/snapshot` 受现有本机/远程门禁约束（远程需有效访问 Cookie）。
- **截图按钮不入镜**：截图前隐藏相机按钮（沿用 v1）。

## 9. 明确不做

- 不做本地下载 / 剪贴板 / 预览弹窗。
- 不做滚动拼接整页长图。
- 不做自动 `git pull --rebase` 重试推送。
- 不清理/轮转 `remote_coder/` 历史截图。

## 10. 决策记录

- 目标为仓库内 `remote_coder/`：用户明确。
- 时间戳累加命名：用户明确。
- 服务端自动 commit + push origin master（实现用 `push origin HEAD`）：用户明确。
- 上传-落盘-git 由服务端完成（而非浏览器直接操作）：浏览器无本地写盘/git 能力。
- 由 v1 的本地下载改为 v2：用户澄清真实意图。
