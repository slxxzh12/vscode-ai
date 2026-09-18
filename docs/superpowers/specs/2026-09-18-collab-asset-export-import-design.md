# 设计文档：协作资产本地导出 / 导入（Manifest.json）

日期：2026-09-18
分支：master
状态：待实现

## 1. 需求

用户原文：

> 协作功能，分享 skills 和 workflow 的时候，可以支持下载导出，导出之后，在协作这里增加一个导入能力，所以在压缩的 zip 包里需要有一个 Manifest.json，描述导出是 skills 还是 workflow

即：把勾选的 skills / workflow 导出成本地 zip（包内含 `Manifest.json` 说明导出内容与类型），在协作页支持选择该 zip 直接导入安装。这是一条独立于群分发的本地文件链路。

## 2. 已确认的决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 链路定位 | 独立本地导出/导入，不依赖群、不联网（群分发链路保持不变） |
| 2 | 覆盖资产 | 沿用现有 4 类：`skills` + `command` + `agent` + `workflow`，复用现有打包/解包逻辑 |
| 3 | Manifest 详细度 | 带明细：大类 + 每项清单 + 导出时间 + 来源机器 |
| 4 | 入口位置 | 协作页顶部栏加「导出 / 导入」两个按钮；导出复用资产勾选弹窗，导入弹文件选择框并先预览 Manifest 再确认 |
| 5 | 导出后端语义 | 复用现有 `buildPackage`（会落 outbox/种子/共享 downloads），导出即「打包后下载」 |
| 6 | 导入校验 | 强制要求 `Manifest.json`：缺 `format`/`version` 或 `format !== 'devflow-assets'` 一律拒绝 |
| 7 | 导出弹窗形态 | 让 `SkillDistributor.vue` 的 `groupId` 可选，无群时进入「本地导出」模式 |
| 8 | 导入是否留痕 | 直接安装，不建本机任务记录 |

## 3. 现状（改动前）

- 打包：`engine.buildPackage({skills,command,agent,workflow})`（`server/collaboration/engine.js:152`）→ 生成 zip 写 `uploadDir` + `downloadDir` + 共享 `downloads/`，落 outbox 与 seed 表。zip 顶层为 `skills/<名>/...`、`command/...`、`agent/...`、`workflow/workflows.xml`。
- 下载：`GET /api/collab/outfile/:id`（`server/collaboration/http-mount.js:137`）按 outbox 记录回传 zip。
- 解包安装：`installBundleZip`（`server/collaboration/bundle-installer.js:15`）按顶层目录判断类型，`writeAtomic` 落位 skills/command/agent，`workflow/workflows.xml` 交给 `mergeWorkflows`。
- 前端：`SkillDistributor.vue` 勾选资产 → `buildPackage` → 群主 `publishPackage` / 非群主 `uploadPackage`，打包后可 `downloadPkg` 下载。
- 无 Manifest 概念；`downloads/` 目录里的 `manifest.json` 是下载索引（已迁移到 SQLite），与本设计的 zip 内 `Manifest.json` 无关。

## 4. 设计

### 4.1 Manifest.json（zip 内根路径）

```json
{
  "format": "devflow-assets",
  "version": 1,
  "type": "skills" | "workflow" | "mixed",
  "exportedAt": 1726000000000,
  "source": { "machineId": "…", "host": "192.168.1.5", "port": 22222, "employeeId": "…" },
  "kinds": ["skills", "command", "agent", "workflow"],
  "skills":   [{ "name": "foo", "files": 12, "hash": "<skill zip sha256>" }],
  "command":  [{ "name": "x.md" }],
  "agent":    [{ "name": "y.md" }],
  "workflow": [{ "id": "w1", "label": "发布流程", "stages": 5 }]
}
```

- `type` 直接回答「是 skills 还是 workflow」：仅有 skills/command/agent → `skills`；仅 workflow → `workflow`；两者都有 → `mixed`。推导规则与 `distTypeOf`（`server/collaboration/dist-task.js:15`）一致。
- `kinds` 只列实际存在的大类；明细数组与 `kinds` 对应。
- 不含任何绝对路径。

### 4.2 模块边界（server）

- 新增 `server/collaboration/asset-manifest.js`（纯函数，便于单测）：
  - `buildManifest({ selection, meta })`：由 `selection`（`{skills,command,agent,workflow}`）与 `meta`（`source`、各类明细）生成对象。
  - `parseManifest(zipBuffer)`：用 `readZip` 找到 `Manifest.json`，解析并严格校验（缺文件 / 非 JSON / `format !== 'devflow-assets'` / `version` 非数字 → 抛错）；返回 manifest。
  - `manifestSummary(manifest)`：提取 UI 预览所需的 `type`/`kinds`/各类计数/来源/时间。
- `engine.buildPackage`：在现有 `files` 基础上追加 `{ rel: 'Manifest.json', data: JSON.stringify(manifest) }`，其余不变（群分发同时带上 Manifest，不破坏旧安装逻辑）。
- 新增 `server/collaboration/asset-import.js`：
  - `stageImport({ zip, dir, id })`：先把 zip 落到 `<dir>/import-<uuid>.zip`，再 `parseManifest`（失败则删文件并抛错）；返回 `{ id, file, manifest, summary }`。
  - `applyImport({ id, file, skillRoot, configRoot, installWorkflows })`：再次 `parseManifest` 严格校验后调 `installBundleZip`，返回 `{ counts }`。
  - `discardImport(file)`：删除暂存文件（不存在也视为成功）。
- `installBundleZip` 保持宽松、不改（旧群包/旧 zip 仍可装）；严格性只加在本地导入这条新链路。

### 4.3 引擎与 HTTP

**engine 新增方法**
- 暂存目录：`this.downloadDir` 存在则用之，否则回退 `os.tmpdir()/devflow-import-<machineId>`（与 `downloadsDir` 兜底风格一致）。
- `stageImport(zip)`：调 `stageImport({ zip, dir, ... })`，把 staging 记录存内存 `this.importStaging`（`Map<id, {file, manifest}>`）。
- `applyImport(id)`：`this.importStaging.get(id)` → `applyImport({...})` → 成功后从 Map 删除并删文件 → `_emit('synced')`。
- `discardImport(id)`：从 Map 删除 + 删文件。
- 启动清理：装配处调 `engine.cleanupStagedImports()`，删除暂存目录内 `import-*.zip` 残留（避免用户直接关弹窗留下垃圾）。

**http-mount 路由**
- `POST /api/collab/import`：raw zip body（沿用 `readRaw`，`MAX_UPLOAD` 上限）→ `engine.stageImport(buf)`。
  - 成功：`{ ok: true, data: { id, manifest, summary } }`。
  - 失败：`{ ok:false, error }`，错误码 `invalid-zip`、`manifest-missing`、`bad-format`、`bad-manifest`。
- `POST /api/collab/import/:id/apply` → `engine.applyImport(id)` → `{ ok:true, counts }`；错误 `not-found`、`bad-manifest`、`invalid`。
- `DELETE /api/collab/import/:id` → `engine.discardImport(id)` → `{ ok:true }`。
- 导出无新端点：复用 `POST /api/collab/packages` + `GET /api/collab/outfile/:id`。

### 4.4 前端

- `useCollab.ts` 新增：
  - `importAsset(file: File)`：`fetch('/api/collab/import', { method:'POST', body:file })` → `{ id, manifest, summary }`。
  - `applyImport(id)` / `discardImport(id)`。
- `SkillDistributor.vue`：`groupId` 改可选。
  - 无群（本地导出模式）：`isMaster=false`；标题用 `collab.export.title`；隐藏「发布给群 / 上传给群主」相关按钮与提示，主按钮文案改「打包并下载」，点击 = `buildPackage` + `downloadPkg`。
  - 群相关计算（`group`、`isMaster`）加空保护。
- 新增 `web/src/collaboration/AssetImportDialog.vue`：
  - 隐藏 `<input type="file" accept=".zip">`（对齐 `WorkflowEditor.vue:140` 的写法）。
  - 选文件 → `importAsset` → 展示预览：`type`/`kinds` 徽标、各类明细与数量、来源机器、导出时间。
  - 「确认导入」→ `applyImport(id)` → 显示各类落位数量与目标根；「取消 / 关闭」→ `discardImport(id)`。
  - 失败时保留暂存可重试，明确关闭才丢弃。
- `CollaborationView.vue`：顶部栏加「导出 / 导入」按钮；挂载 `SkillDistributor`（本地模式）与 `AssetImportDialog`。

### 4.5 错误处理与安全

- 解析/校验失败：弹窗内显示对应 i18n 错误，不安装、不落位。
- apply 失败：保留暂存可重试；确认关闭时 `discardImport`。
- 时序兜底：启动时清理 `import-*.zip` 残留。
- 路径安全：暂存文件名只用服务端生成的 `import-<uuid>.zip`；解包沿用 `safeZipName`（`server/collaboration/zip.js:23`）与 `assertSafeRel`（`server/collaboration/engine.js:35`）越界防护；安装目标沿用 `skillRoot()`/`configRoot()`。

### 4.6 i18n（中英对称）

- 新增词条（`shared/i18n/zh-CN.js` + `en.js`，键集合保持对称）：
  - `collab.export.title`、`collab.export.button`、`collab.export.local_mode`、`collab.export.pack_download`
  - `collab.import.button`、`collab.import.title`、`collab.import.pick`、`collab.import.preview`、`collab.import.type`、`collab.import.type.skills`、`collab.import.type.workflow`、`collab.import.type.mixed`、`collab.import.source`、`collab.import.exported_at`、`collab.import.items`、`collab.import.confirm`、`collab.import.cancel`、`collab.import.done`
  - 错误：`collab.import.err.invalid_zip`、`collab.import.err.manifest_missing`、`collab.import.err.bad_format`、`collab.import.err.bad_manifest`、`collab.import.err.too_large`
- 复用 `collab.dist.download`、`collab.dist.package` 等已有词条。

## 5. 测试与验收

- server：
  - 新增 `server/test/collab-asset-manifest.test.js`：`buildManifest` → zip → `parseManifest` 往返；缺 `Manifest.json` → `manifest-missing`；`format` 不对 → `bad-format`；`type` 推导（skills / workflow / mixed）。
  - 新增 `server/test/collab-import.test.js`：`stageImport` → `applyImport` 后 skills 落位且 workflow 被合并；`discardImport` 删除暂存；未知 id → `not-found`；无 manifest 的 zip 拒绝。
  - 现有 `collab-bundle-installer.test.js` / `collab-bundle-xml.test.js` 应继续通过（`installBundleZip` 未改语义）。
- web：
  - 新增 `web/src/collaboration/AssetImportDialog.test.ts`：选文件 → 预览渲染 → 确认调用 `applyImport`；关闭调用 `discardImport`。
  - `SkillDistributor` 本地模式：无 `groupId` 时主按钮走「打包并下载」。
- 命令：`npm.cmd run test:server`、`npm.cmd run test:web`、`npm.cmd run typecheck`、`npm.cmd run check:i18n`。

## 6. 不做（范围外）

- 不改群主→成员 `dist` 推送协议与任务语义。
- 不改 `installBundleZip` 的宽松行为（旧包兼容）。
- 不做导入历史 / 任务留痕 / 版本比对。
- 不做导出包加密、签名或分片传输（沿用现有单次 body 上限）。
- 不新增 SQLite 表或 `.db` 文件。
