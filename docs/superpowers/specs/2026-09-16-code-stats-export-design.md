# 设计文档：代码统计——首次提交人 + CSV/ZIP 导出

日期：2026-09-16
分支：master
状态：已确认

## 1. 目标

1. 实代码统计的每个文件行贴「首次提交人」= 该文件在 git 历史里第一次被提交（新增）时的作者。
2. 两个页签都能在界面导出结果：各 2 个 CSV，打包成 zip 下载（不含总计行）。

## 2. 已确认的决策

| # | 决策 | 来源 |
| --- | --- | --- |
| 1 | 首次提交人 = 该文件第一次被「新增」提交的作者；非 git 仓库/对不上则留空（不影响其它列） | 用户 + 本设计 |
| 2 | 首次作者用**一次** `git log` 建映射，不逐文件调用 | 本设计 |
| 3 | 两个页签各导 2 个 CSV 并打包 zip | 用户选 1 |
| 4 | CSV 只含明细，不含总计行 | 用户选 3 |
| 5 | Git 页签导出「文件汇总 + 提交明细」两张表 | 用户选 3 |
| 6 | 复用服务端 `buildZip()`，不引入前端压缩依赖 | 本设计 |

## 3. 首次提交人

`server/code-count.js` 在扫描完成后：

```
git -C <dir> rev-parse --show-toplevel          → 仓库根；失败/不在仓库内 → 无作者
git -C <dir> -c core.quotepath=false log --reverse --diff-filter=A --format=%x01%an --name-only
```

- 逐行解析：`\x01<作者>` 为提交头，其后行为该提交新增的文件（仓库根相对路径）。
- `--reverse` 保证最早的新增先出现，`Map` 只记第一次 → 首次作者。
- 扫描目录是仓库子目录时，按 `prefix = relative(toplevel, dir)` 裁掉前缀；`prefix` 含 `..` → 放弃。
- 超时 30s / 任何失败 → 返回空映射（列留空），不影响扫描结果。
- 贴到文件行（可选字段）：`files[i].firstAuthor`。

## 4. CSV 与 zip

### 4.1 新接口 `POST /api/export/zip`

```json
{ "zipName": "codestat-git-20260916-1530.zip",
  "files": [{ "name": "git-files.csv", "content": "\uFEFF目录,状态,...\r\n" }] }
```

- 复用 `server/collaboration/zip.js` 的 `buildZip()`（deflate）。
- 校验：`files` 非空数组；`safeZipName(name)` 通过；≤ 100 个文件；内容合计 ≤ 8 MiB。
- `zipName` 只保留 `[A-Za-z0-9._-]`，非法则回落 `export.zip`。
- 响应：`200 application/zip` + `Content-Disposition: attachment; filename="<zipName>"`。
- 错误：`400 bad-zip`（空/非法名）、`413 too-many-files` / `too-large`。

### 4.2 前端 `web/src/csv.ts`

- `toCsv(header, rows)`：UTF-8 BOM + CRLF + RFC4180 引号转义（含 `"`、`,`、换行时加引号并双写 `"`）。
- 防公式注入：单元格以 `=` `+` `-` `@` 或制表符/回车开头时前置单引号（`csvCell`）。表头一律用纯文字（如「新增行数 / 删除行数」），不用 `+行`/`−行` 这类符号，避免被表格当表达式。
- `zipStamp(date)`：`yyyyMMdd-HHmm`。
- `downloadZip(zipName, files)`：POST `/api/export/zip` → blob → `<a download>` 触发。

### 4.3 CSV 列（表头中文，与界面一致；数据顺序同表格）

| 文件 | 列 |
| --- | --- |
| `git-files.csv` | 目录, 状态, 文件, 修改人, 次数, 新增行数, 删除行数, 最后变动 |
| `git-commits.csv` | 目录, 短hash, 作者, 日期, 主题, 文件数, 新增行数, 删除行数, 新增文件数, 修改文件数, 删除文件数 |
| `real-dirs.csv` | 目录, 文件数, 实代码行, 总行数, 实代码占比 |
| `real-files.csv` | 目录, 文件, 实代码行, 总行数, 实代码占比, 首次提交人 |

- zip 名：`codestat-git-<stamp>.zip`、`codestat-real-<stamp>.zip`。
- 导出按钮在各页签工具条，无结果时禁用；失败用 `alert` 提示。

## 5. 界面

- 实代码文件明细表新增「首次提交人」列（空显示 `—`），CSV 同步。
- Git 页签「查询」旁加「导出 CSV」；实代码页签「统计」旁加「导出 CSV」。

## 6. 范围边界

- 不改 Git 提交统计的查询口径与既有字段（只新增导出）。
- 不导出总计/汇总卡片、不导出按作者统计表（本轮按用户选择只导两张明细表）。
- 不做服务端落盘导出、不做导出历史。

## 7. 测试

- `server/test/code-count.test.js`：`firstAuthor`（仓库内首提交作者；子目录扫描前缀裁剪；非仓库为空）。
- `server/test/http-api.test.js`：`/api/export/zip` 正常（返回 PZ 头 + 可 `readZip` 回读）、空 files 400、非法名 400、超量 413。
- `web/src/csv.test.ts`：`toCsv` BOM/CRLF/引号转义、`zipStamp` 格式。
- 全量：`npm.cmd test`、`typecheck`、`check:i18n`、`build:web`。

## 8. 风险与取舍

- `git log` 全历史在超大仓库可能慢 → 30s 超时后放弃（列留空），不阻塞扫描结果。
- 重命名过的文件在 `--diff-filter=A` 下可能没有新增记录 → 首次提交人留空（可接受）。
- 导出在客户端拼 CSV 再走本机服务端压 zip：多一次往返，但复用了已测试的 `buildZip`，不新增依赖。
