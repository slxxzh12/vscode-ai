# 设计：Git 提交文件统计（按日期区间）

日期：2026-09-10

## 背景与目标

需要按「起始日期 ~ 结束日期」查询某个 git 仓库的提交记录，并据此得出区间内**新增的文件**与**修改的文件**分别是哪些。目标：

- 前端输入**本地仓库路径或远程 git 地址**，选择日期区间，发起查询；
  - 本地路径：直接分析；
  - 远程地址（`https://` / `git://` / `ssh://` / `file://` / `git@host:path`）：后端先 `git clone --bare` 到系统临时目录，分析完删除临时目录。
- 后端调用系统 `git` CLI 读取提交与文件变动（`--name-status`），解析后返回；
- 结果同时提供两种视图：**文件汇总**（去重、带状态）与**提交明细**（按 commit 分组）；
- 状态不仅区分新增/修改，还包含删除/重命名。

## 架构

```
GitStat.vue（路径 + 日期）
  → POST /api/git/changes { repoPath, since, until }
  → server/git-log.js  spawn git log --name-status，解析、聚合
  → 返回 { repo, range, stats, summary[], commits[] }
  → 前端渲染：统计卡片 + 文件汇总表 + 提交明细
```

- 后端：新增 `server/git-log.js`（纯逻辑、易测），`server/http-api.js` 增一条路由，新增 `server/test/git-log.test.js`。
- 前端：新增 `web/src/gitStat.ts`（解析/聚合纯函数，vitest 可测）、`web/src/components/GitStat.vue`、`App.vue` 左侧 rail 增 `📊` 入口。

## 后端

### A. `server/git-log.js`

导出 `collectGitChanges({ repo, since, until })`，异步返回结构化数据。`repo` 为本地路径或远程地址。

**来源判定与克隆**

1. 以 `repo`（本地路径或 URL）为准；若首字符为 `-` 直接拒绝（防参数注入）。
2. URL 判定：匹配 `^(https?|git|ssh|file)://` 或 scp 形式 `user@host:path`。
3. 远程地址：在系统临时目录建父目录，`git clone --quiet --bare <repo> <parent>/repo`（`--bare` 免工作区、更快；完整克隆以保证历史与日期区间准确），分析结束在 `finally` 删除父目录。克隆设 `GIT_TERMINAL_PROMPT=0`（私有库不挂起等待输入）与 120s 超时。
4. 本地路径：直接在其上执行，不复制。

**校验**

1. `repo` 存在且为目录（本地）或可克隆（远程），否则抛 `not-found` / `clone-failed`。
2. `git -C <target> rev-parse --git-dir` 成功即为仓库，否则抛 `not-a-repo`（400）。**注意用 `--git-dir` 而非 `--is-inside-work-tree`**：`--bare` 克隆下后者返回 `false`。
3. 系统无 git（spawn `ENOENT`）→ 抛 `git-unavailable`（500）。
4. `since`/`until` 需为 `YYYY-MM-DD`，否则抛 `bad-date`（400）；`since > until` 抛 `bad-range`（400）。

**命令**

```
git -C <target> -c core.quotepath=false log \
  --since=<since>T00:00:00 --until=<until>T23:59:59 \
  --no-merges -M --name-status \
  --pretty=format:"@@%x01%H%x01%an%x01%ae%x01%aI%x01%s"
```

`<target>` 为本地路径或克隆出的裸仓库目录。

- 起止均含当天：起始 `00:00:00`，结束 `23:59:59`。
- `--no-merges` 排除合并提交噪声。
- `-M` 开启重命名检测（`R**`）。
- `core.quotepath=false` 保证中文/非 ASCII 路径不被转义。
- 一律用 `spawn('git', args[])`（数组传参、不经过 shell），避免命令注入。
- 通过 `maxBuffer` 放宽输出上限；结果再做条数上限（见边界）。

**解析**

- 以行迭代：以 `@@` 开头为提交头，按 `\x01` 切成 `hash / author / email / isoDate / subject`。
- 其余非空行匹配 `^([AMDRTC])\d*\t`：第一个字段为状态码（取首字母），随后为路径；重命名 `R100\told\tnew` 取 `oldPath`/`path`。
- 状态映射：`A` 新增、`M` 修改、`D` 删除、`R` 重命名、`C` 复制（视作修改）、`T` 类型变更（视作修改）。

**聚合（`summary`）**

- 按文件路径归并全部变动；`touches` = 该文件在区间内被提交的次数。
- 状态判定（按提交时间**正序**取首次/末次状态）：
  - 末次为 `D` → 删除；
  - 否则首次为 `A` → 新增；
  - 否则含 `R` → 重命名（附 `oldPath`）；
  - 否则 → 修改。
- `lastDate` = 该文件最后一次变动所在提交的作者日期。

**统计（`stats`）**：`commits`（提交数）、`files`（汇总文件数）、`added`、`modified`、`deleted`、`renamed`。

### B. 路由 `POST /api/git/changes`

- body：`{ repo, since, until }`，复用现有 `readJsonBody`。`repo` 为本地路径或远程 git 地址。
- 成功：`200 { repo, range, stats, summary, commits }`，其中 `repo = { path, branch, cloned }`（`path` 为原始输入；`cloned` 标识是否来自远程克隆；`branch` 由 `git rev-parse --abbrev-ref HEAD` 得到，失败则 `null`）。
- 错误码沿用现有 `http-api.js` 的 catch 分支：`not-found`→404；`not-a-repo`/`bad-date`/`bad-range`/`bad-repo`/`clone-failed`/`clone-timeout`→400；`git-unavailable`→500（附 `message`）。

## 返回结构

```jsonc
{
  "repo": { "path": "D:/repo", "branch": "master", "cloned": false },
  "range": { "since": "2026-09-01", "until": "2026-09-10" },
  "stats": { "commits": 12, "files": 30, "added": 8, "modified": 19, "deleted": 2, "renamed": 1 },
  "summary": [
    { "path": "src/a.ts", "status": "added", "touches": 2, "lastDate": "2026-09-09T20:16:02+08:00" },
    { "path": "src/b.ts", "status": "renamed", "oldPath": "src/old-b.ts", "touches": 1, "lastDate": "..." }
  ],
  "commits": [
    { "hash": "...", "short": "e96a581", "author": "samuel", "email": "...", "date": "2026-09-10T11:51:18+08:00",
      "subject": "...", "files": [ { "status": "modified", "path": "web/src/App.vue" } ] }
  ]
}
```

## 前端

### A. `web/src/gitStat.ts`

纯函数：`fetchGitChanges(params)`（`fetch` 封装，抛出后端 `error`/`message`）；类型定义 `GitStatus`、`GitFile`、`GitCommit`、`GitSummaryRow`、`GitChangesResult`；辅助 `statusLabel(status)`、`statusClass(status)`。解析/聚合逻辑在后端，前端仅做展示映射与格式化。

### B. `web/src/components/GitStat.vue`

- **仓库**：文本框输入本地路径或远程 git 地址（浏览器无法获取本地目录绝对路径，故以手输为主）；「最近输入」下拉从 `localStorage`（复用现有按节点指纹隔离的 key 思路）读取与写入。输入为远程地址时后端会 clone 到临时目录，耗时会变长，`loading` 文案提示「克隆/查询中…」。
- **日期**：两个 `<input type="date">`，默认「近 7 天」（`until`=今天，`since`=今天-6）。
- **查询**：按钮触发；期间 loading；失败在表单下方红字显示。
- **结果**：
  - 统计卡片：提交数 / 文件数 / 新增 / 修改 / 删除 / 重命名。
  - 文件汇总表：状态色标、路径（重命名显示 `旧名 → 新名`）、改动次数、最后变动日期；顶部可按状态筛选（全部/新增/修改/删除/重命名）。
  - 提交明细：可折叠列表，每项显示 `short hash`、作者、日期、message，展开后列出该提交的文件清单。
- **空态**：区间内无提交 → 提示「该区间没有提交记录」。

### C. 入口 `App.vue`

- `rail` 联合类型增加 `'stat'`；activity rail 增 `📊` 按钮（title「提交统计」）。
- `rail === 'stat'` 时主区域渲染 `<GitStat />`（不显示文件树/终端侧栏，参照 `contacts` 分支的全宽处理）。

## 测试

- 后端 `server/test/git-log.test.js`：在临时目录 `git init`，用 `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` 环境变量制造跨日期的提交（新增 / 修改 / 删除 / 重命名），断言 `stats`、`summary` 状态与 `touches`、`commits` 内容；再断言非仓库路径抛 `not-a-repo`、坏日期抛 `bad-date`、空区间返回空数组；以及用 `file://` 地址验证远程 clone 路径（返回 `repo.cloned === true` 且临时目录被清理）。`npm.cmd test` 全绿。
- 前端 `web/src/gitStat.test.ts`：测 `statusLabel`/`statusClass`/日期默认值等纯函数。
- `npm.cmd run typecheck` 通过。

## 边界与性能

- 结果上限：提交数上限 500、文件条目上限 5000，超出则截断并在响应中带 `truncated: true`，前端提示「结果过多已截断，请缩小日期范围」。
- 超大仓库：命令 `maxBuffer` 设为足够大（如 64MB），截断保护避免前端卡死。
- 路径含特殊字符：`spawn` 数组传参 + `quotepath=false`；路径展示不强行接入 FilePreview（任意仓库未必是已登记项目）。
- `spawn` 失败 / 非零退出：返回 500 并带 stderr 摘要。
- 远程克隆：`--bare` 免工作区；`GIT_TERMINAL_PROMPT=0` 防认证挂起；120s 超时（`clone-timeout`）；`finally` 清理临时目录；`repo` 首字符为 `-` 直接拒绝以防参数注入。

## 涉及文件

- 新增：`server/git-log.js`、`server/test/git-log.test.js`、`web/src/gitStat.ts`、`web/src/gitStat.test.ts`、`web/src/components/GitStat.vue`、本设计文档。
- 修改：`server/http-api.js`（新增路由与错误码分支）、`web/src/App.vue`（rail 入口）。

## 范围外（YAGNI）

- 不做作者 / 分支 / 路径过滤（仅日期区间，后续需要再加）。
- 不区分首次提交之前的仓库历史、不做行数（`--numstat`）统计。
- 不做结果导出 / 图表。
- 不引入 git 兼容模式（仅系统 git CLI，方案 A）。
