# 设计文档：代码统计（页签化 + 实代码行统计）

日期：2026-09-16
分支：master
状态：已确认（用户确认：目录+过滤项共用一套提到页面顶部；实代码口径沿用 count:code；用 Element Plus 页签）

## 1. 问题与目标

现状：左侧 `📊`（`nav.stat`「提交统计」）只渲染 `GitStat.vue`，只有 Git 提交维度；仓库另有一个「实代码行」口径 `npm run count:code`（`scripts/count-code.js` 的 `countReal`），只能在命令行看。

目标：把 `📊` 页面升级为「代码统计」，用 **Element Plus `el-tabs`** 分两个页签：

1. **Git 提交统计**：现有能力（日期区间、提交/文件/增删改重命名、按作者、超大提交过滤）。
2. **实代码统计**：扫描目录，按 `countReal` 口径给出每文件实代码行/总行数、按顶层目录分组汇总、总计。

共用输入提到页签上方：目录列表、代码后缀、排除目录、排除测试文件。

## 2. 已确认的决策

| # | 决策 | 来源 |
| --- | --- | --- |
| 1 | 「实代码行」= `countReal`：去注释 + 空行 + 纯括号/标点行 + 无英文行 | 用户选 1 |
| 2 | 目录列表由两页签共用 | 用户选 1 |
| 3 | 目录 + 过滤项共用一套，提到页面顶部 | 用户选 2 |
| 4 | 页签用 Element Plus `el-tabs`（项目已全局注册，无新增依赖） | 用户要求 |
| 5 | 共用后缀默认值沿用 `DEFAULT_CODE_EXTS`（不含 `.css/.scss/.html/.htm`，含 `.sql/.xml`） | 用户选 1 + 追加 sql/xml |
| 6 | 中英文案同时补齐 | AGENTS.md |

## 3. 架构

```
CodeStats.vue（页面：标题 + 共用输入 + el-tabs）
  ├─ 共用输入：目录列表(增删/选择/最近) · 代码后缀 · 排除目录 · 排除测试文件
  │            localStorage 分键持久化（nodeFp）
  ├─ el-tab-pane「Git 提交统计」→ GitStat.vue（props: dirs/extsText/excludeDirsText/excludeTestFiles）
  │            自持：日期区间、仅统计代码、超大提交阈值、查询按钮、结果
  └─ el-tab-pane「实代码统计」→ RealCodeStat.vue（props 同上）
               自持：统计按钮、结果（总计卡片 + 按目录汇总 + 文件明细）
```

服务端新增 `server/code-count.js`（纯逻辑，复用 `scripts/count-code.js` 的 `countReal`）与 `POST /api/code/stats`（单目录，与 `/api/git/changes` 同构）。

## 4. 接口契约

### 4.1 `POST /api/code/stats`

请求：

```json
{ "dir": "D:/code/my-repo", "filter": { "codeOnly": true, "exts": [".js"], "excludeDirs": ["docs"], "excludeTestFiles": true } }
```

响应：

```json
{
  "dir": "D:/code/my-repo",
  "files": [{ "rel": "src/a.js", "real": 120, "total": 180 }],
  "groups": [{ "key": "src", "real": 120, "total": 180, "files": 1 }],
  "totals": { "files": 1, "real": 120, "total": 180 },
  "truncated": true
}
```

- `files` 按 `real` 降序、同值按 `rel` 升序；`groups` 按 `real` 降序，`key` 为顶层目录（根目录文件为 `(root)`）。
- 错误：`dir` 非法/为空 → `400 bad-dir`；路径不存在或非目录 → `404 not-found`；其余 → `500 internal`。

### 4.2 扫描规则（`collectCodeStats`）

| 项 | 规则 |
| --- | --- |
| 硬跳过目录 | 名称以 `.` 开头（含 `.git`）、`node_modules`、`dist`、`dist-portable`、`env`（与 `count-code.js` 一致） |
| 符号链接 | 跳过（不跟随，防环） |
| 用户过滤 | 相对路径（`/` 分隔）走 `makeKeepPath(filter)`：`exts` 白名单 + `excludeDirs` 段匹配 + `excludeTestFiles` |
| 大小上限 | 单文件 > 2 MiB 跳过 |
| 二进制 | 内容含 `NUL` 字节跳过 |
| 数量上限 | 保留前 `MAX_FILES = 5000` 个（按 `real` 降序截断），`truncated: true` |
| 口径 | `countReal(text)` → `{ real, total }` |

## 5. 范围边界（不做的事）

- 不改 Git 提交统计的既有口径与错误码（除把共用输入提到父组件）。
- 不做实代码的历史趋势、不做按提交的实代码归属。
- 不改 `npm run count:code` CLI 及其固定后缀集合。
- 两个页签各自查询按钮（Git 需日期，实代码不需）。

## 6. i18n

- `nav.stat`：`提交统计` → `代码统计`（en `Git Stats` → `Code Stats`）。
- 新增 `codestat.*`：`title`、`tab.git`、`tab.real`、`run`、`running`、`total_files`、`total_real`、`total_all`、`groups_title`、`files_title`、`col.dir`、`col.files`、`col.file`、`col.real`、`col.total`、`col.ratio`、`empty`、`truncated`、`need_dir`、`some_failed`、`slow_hint`。
- 共用过滤项词条由 `gitstat.f.exclude_test_files` / `gitstat.f.exclude_dirs_label` / `gitstat.f.exclude_dirs_placeholder` / `gitstat.f.exts_label` / `gitstat.f.exts_placeholder` 重命名为 `codestat.f.*`（中英同步删除旧键）；`gitstat.f.code_only`、`gitstat.f.huge_limit_label` 留在 Git 页签。
- 移除不再使用的 `gitstat.title`。

## 7. 测试

- `server/test/code-count.test.js`：口径（复用 `countReal`）、`excludeDirs`/`exts`/`excludeTestFiles` 过滤、硬跳过 `node_modules`、分组与总计、二进制与超大文件跳过、非目录 → `not-found`、`truncated`。
- `server/test/http-api.test.js`：`POST /api/code/stats` 正常 200 / 坏 dir 400 / 不存在 404。
- `web/src/codeStats.test.ts`：`sumCodeTotals` 求和、`ratio` 计算纯函数。
- `npm.cmd run typecheck` / `check:i18n` / `build:web`。

## 8. 风险与取舍

- 扫描大仓库可能耗时（异步读 + 并发上限 + 硬跳过 `node_modules` 缓解）；界面给「扫描中」提示。
- 共用后缀默认不含 `.css/.scss/.html/.htm`，UI 实代码数字与 CLI `count:code` 可能不同；用户可在后缀框里补。
- `POST /api/code/stats` 接受任意目录 → 与既有 `/api/git/changes` 同级的本地文件读取面，未引入新的远程攻击面（服务本身是本机/LAN 工具）。
