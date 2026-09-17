# 设计文档：Git 提交统计——过滤超大提交

日期：2026-09-16
分支：master
状态：已确认（用户逐条确认）

## 1. 问题与目标

Git 提交统计（`server/git-log.js` / `web/src/components/GitStat.vue`）会把「一次提交里塞进几千行」的提交（初始导入、压缩提交、生成物）算进统计，污染总代码量与按作者统计。

目标：**单次提交的新增行数超过阈值时，整条提交不计入统计**；阈值可配置，默认 2000，0 或留空 = 不过滤。

## 2. 已确认的决策

| # | 决策 | 来源 |
| --- | --- | --- |
| 1 | 判断口径只看**新增行**（`added`），不看删除 | 用户选 2 |
| 2 | 阈值**可配置**，默认 2000，0/空 = 不过滤 | 用户要求 |
| 3 | 命中即整条提交丢弃：提交数、文件汇总、按作者统计都排除 | 用户要求 |
| 4 | 判断发生在**路径过滤之后**（只统计通过 codeOnly/后缀/排除目录/排除测试文件筛剩的代码） | 本设计 |
| 5 | 丢弃先于 `MAX_COMMITS`(500) 截断，避免超大提交白占配额 | 本设计 |
| 6 | 界面显示被过滤掉的提交条数 | 本设计 |
| 7 | 中英文案同时补齐 | AGENTS.md |

## 3. 数据流

```
前端 GitStat.vue（数字输入，默认 2000，localStorage 记忆）
  └─ filter.hugeCommitLimit: number（0 = 不过滤）
        │ POST /api/git/changes
        ▼
server/git-log.js collectGitChanges
  1) git log --name-status / --numstat 解析
  2) 路径过滤（makeKeepPath）
  3) 每个提交：Σ added(剩余代码文件) > limit → 丢弃，hugeCommits++
  4) slice(MAX_COMMITS) → summarize → 统计
  5) 返回 { ..., hugeCommits }
        │
        ▼
界面：Σ hugeCommits > 0 时提示「已过滤 N 个超大提交（单次新增 > limit 行）」
```

## 4. 契约

### 4.1 共享（`shared/git-filter.js` + `.d.ts`）

```js
export const DEFAULT_HUGE_COMMIT_ADDED_LIMIT = 2000;
export function parseHugeCommitLimit(input): number;   // 非正整数 → 0（不过滤）
```

- `GitPathFilter` 增 `hugeCommitLimit?: number`。

### 4.2 服务端 `collectGitChanges`

- 入参 `filter.hugeCommitLimit`（可选，数字或数字串）。
- 过滤规则：对路径过滤后仍非空的提交，`Σ (f.added || 0) > limit` 时整条丢弃并计入 `hugeCommits`。
- 返回新增 `hugeCommits: number`（默认 0，始终返回）。
- 不改错误码与其他字段。

### 4.3 前端

- `GitFilter` 增 `hugeCommitLimit?: number`；`GitChangesResult` 增 `hugeCommits?: number`。
- `GitStat.vue` 过滤区新增数字输入「过滤超大提交：单次新增 >（行，0=不过滤）」，默认 `DEFAULT_HUGE_COMMIT_ADDED_LIMIT`，随 `exts`/`excludeDirs` 一样按 `nodeFp()` 分键存 localStorage。
- 结果区（总卡片下方）在 `Σ hugeCommits > 0` 时显示提示。

### 4.4 i18n（中英同时补齐）

- `gitstat.f.huge_limit_label`
- `gitstat.filtered_huge`（`{count}`、`{limit}` 插值）

## 5. 范围边界（不做的事）

- 不改路径过滤规则、不改日期区间、不改 `MAX_COMMITS`/`MAX_FILES`。
- 不做「只剔除该提交里的超大文件」这种部分保留。
- 不引入服务端全局配置（阈值随请求走，与既有 `exts`/`excludeDirs` 一致）。

## 6. 测试

- `server/test/git-log.test.js`：造一个「单次新增 2001 行代码」的提交 + 一个普通提交；默认口径（无 limit）两条都算；`hugeCommitLimit: 2000` 时超大提交被丢、`hugeCommits === 1`、`stats.commits === 1`；自定义阈值（如 10）能生效。
- `web/src/gitStat.test.ts`：`parseHugeCommitLimit` 的归一化（数、数字串、0、负数、非法、空）。

## 7. 风险与取舍

- 阈值默认 2000 生效后，历史统计数字会变小——这是本次的预期行为。
- 只看新增行，纯删除型大提交不会被过滤（按用户选择）。
