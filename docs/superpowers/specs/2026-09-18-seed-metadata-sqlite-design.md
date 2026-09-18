# 设计文档：协作元数据从文件迁到 SQLite

日期：2026-09-18
分支：master
状态：已实现

## 1. 需求

用户原文（连续三条）：

> 我认为打包之后，这些打包信息种子文件，应当放到 sqllite 里面
> 不应该放任何种子文件了
> 不要放到文件里面，文件里面只有打包到 workflow 或者 skills

即：协作/分发的**元数据**不再以 json 文件形式落盘，全部进 `<数据目录>/ports/<端口>/void.db`；
`downloads/` 目录只保留打包产物（skills/workflow 的 zip）。

## 2. 迁移清单

| # | 原文件 | 现存储（void.db 表） | 新模块 |
|---|--------|----------------------|--------|
| 1 | `downloads/manifest.json`（下载索引） | `download(name, kind, size, sha256, updated_at)` | `server/download-store.js` |
| 2 | `downloads/update.json`（同步种子） | `sync_update(id=1, version, updated_at, files)` | `server/sync-store.js` |
| 3 | `downloads/workflows.seed.json`（工作流 hash 目录） | `workflow_seed(id=1, version, updated_at, workflows)` | `server/workflow-seed.js`（重写为 `createWorkflowSeedStore`） |
| 4 | `sync/<masterId>.json`（各 master 同步记录） | `sync_record(master_id, version, action, checked_at, data)` | `server/sync-store.js` |
| 5 | `downloads/usage.json`（共享用量快照） | 删除文件写入；成员拉取时由 `_inPullDownloads` 的 `usage` 字段带回（数据本就在 `usage` 表） | — |

`server/collaboration/sync-seed.js` 只保留纯函数 `formatVersion` / `nextVersion`。

## 3. 关键改动

- `CollabEngine` 构造参数新增 `downloadStore` / `syncStore`（不传则用 `:memory:`，测试无感）；删除 `syncDir`。
  - `readManifest/_writeManifest/writeDownload` 走 `downloadStore`；文件仍写 `downloadsDir`。
  - `readUpdate/publishUpdate/checkUpdate/applyUpdate` 走 `syncStore`。
- `buildPackage` 落 `downloads/` 的那一份改为 `writeDownload(label, zip, 'skill')`：**打包产物即登记索引 → 应用市场「扩展」可见**（对应「Master 打包 skills/workflow 后分享要出现在应用市场」）。
- `server/index.js` 从 `void.db` 建 `downloadStore/syncStore/workflowSeedStore` 注入；`updateWorkflows(file, workflows, seedStore)` 增加可选 seedStore 参数；启动/配置保存时刷新工作流种子；删除 `usage.json` 文件写入与 `syncDir`。
- `server/devflow-config.js` 不再 import `workflow-seed`，由调用方注入 seedStore。

## 4. 保留的文件

- `downloads/**/*.zip`：打包产物（唯一仍落盘的协作数据）。
- `downloads/devflow.xml`：活动配置（本就存于此，不属本次范围）。
- `downloads/relay-plugins/`、`relay-tests/`：中转插件，非元数据。
- `upload/`、`download/`：收发 zip 落盘目录。

## 5. 兼容

- 旧安装残留的 `manifest.json`/`update.json`/`workflows.seed.json` 不再被读取；`listDownloadFiles` 仍跳过 `manifest.json`/`update.json`，避免老目录把它们当普通文件列出。
- 表在 `void.db` 内 `CREATE TABLE IF NOT EXISTS` 幂等创建，无需迁移脚本（旧 json 元数据不导入，重新发布即可）。

## 6. 测试

- 新增/重写：`workflow-seed.test.js`、`collab-sync-seed.test.js`、`devflow-config.test.js`（种子断言改用 store）。
- 全量：`npm.cmd test`（server 639 + web 392）、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 均通过。
