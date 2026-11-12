# US 自动开发流水线设计

日期：2026-11-11
状态：设计已确认，待实现

## 1. 目标

在「代码统计 → 代码生成流水线」现有能力上，自动发现方案仓新增的 US 需求，按 US 自动改代码、编译打包、提交推送。

- 从开启自动开发那一刻起，只处理之后新增的 US；已有 US 记为基线，不补跑。
- 全自动：AI 改代码、跑测试/构建/打包、提交推送，人工只做最终验收。
- 每个 US 先切到该用户的 `feature/<user.name>` 分支再开发。
- 执行过程复用「定时任务 → 任务队列」的表格与详情，不新增独立任务页。

## 2. 非目标

- 不做每个 US 一条队列作业；一次 `auto_docs_update` 作业内按 US 顺序处理。
- 不自动合并 master，不创建 PR，不做代码评审。
- 不归档构建产物；产物留在代码仓默认输出目录。
- 不自动无限重试；失败后人工点重试。
- 不做沙箱；AI 与构建命令在代码仓内拥有该进程的全部权限。

## 3. 触发与基线

### 3.1 触发

复用现有内置任务 `auto_docs_update`（每 1 分钟，`onlyLocal`）：

1. 对勾选的文档目录执行 `git pull --ff-only`（现有行为）。
2. 若「自动开发」开启，且「设计方案」目录已勾选并存在，扫描该目录的一级子文件夹。
3. US 文件夹匹配规则：`/^US\d{6}-\d{4}-/i`，例如 `US000001-2021-增加一个用户管理系统`。
4. 按名称升序，依次处理所有新 US。
5. 作业最大运行时间从 5 分钟放宽到 6 小时；`auto_docs_update` 的 `uniqueKey` 保证同一时间只有一个作业。
6. 若作业在 6 小时到点被中断，当前 US 标记为 `failed`（`timeout`），尚未处理的 US 留给下一次作业继续。

### 3.2 基线

状态文件：`<数据目录>/pipeline/us-state.json`

```json
{
  "solutionDir": "D:\\work\\solutions",
  "baseline": ["US000001-2021-增加一个用户管理系统"],
  "items": {
    "US000002-2022-增加订单导出": {
      "status": "success",
      "attempts": 1,
      "lastJobId": "j_xxx",
      "branch": "feature/zhangsan",
      "commit": "abc1234",
      "error": null,
      "lastRunAt": 1760000000000
    }
  }
}
```

规则：

- 首次启用或 `solutionDir` 变化时，把当前 US 全部写入 `baseline`，不自动补跑。
- 新 US = 当前扫描结果 − baseline − items 中已存在的 US。
- `items` 状态：`pending` / `running` / `success` / `failed`。
- 进程重启后若发现 `running` 但没有对应活动作业，标记为 `failed`（`interrupted`），等待人工重试，不自动重跑。
- 状态文件损坏时，把当前 US 全部记为基线并写告警日志，避免误跑历史需求。

### 3.3 开关

配置文件：`<数据目录>/pipeline/config.json`

```json
{ "autoDev": false }
```

- 默认关闭。
- 页面开关从关到开时，重建基线。
- 关闭时只拉取文档，不扫描、不开发。

## 4. 单个 US 的执行流程

### 4.1 前置校验

- 「代码仓」必须已勾选、路径存在且是 git 仓库。
- `git config user.name` 必须存在；缺失则失败。
- 分支名：`feature/<user.name>`，把空白、控制字符与 git 非法字符（`~ ^ : ? * [ \`）替换为 `-`。

### 4.2 切分支

1. `git fetch origin`。
2. 本地存在 `feature/<user>`：`git checkout feature/<user>`。
3. 只有远端存在：`git checkout -b feature/<user> --track origin/feature/<user>`。
4. 都不存在：从 `origin` 默认分支创建（依次尝试 `origin/HEAD`、`origin/main`、`origin/master`）。
5. 工作区必须干净（`git status --porcelain` 为空）；不干净则该 US 失败，不 stash、不 reset。

### 4.3 AI 开发

- 收集 US 文件夹内普通文件：`.md`、`.json`、`.txt`，总量上限 200 KB；不跟随指向 US 文件夹外部的符号链接。
- 提示词包含：US 编号与名称、目标分支、完整 US 文档、在代码仓内实现该需求、允许自行运行测试、不要执行 git commit/push、不要修改 git 配置。
- 使用现有调度器 runner 以 `opencode` 执行，cwd 为代码仓，单 US 超时 30 分钟，输出写入 `ai.log`。

### 4.4 构建命令解析

命令来源优先级（**按字段逐个回退**）：

1. `pipeline.json`：`{ "test": "...", "build": "...", "package": "..." }`
2. `01-需求分析.md` 顶部 YAML frontmatter：`test:` / `build:` / `package:`
3. `05-构建发布.md`：在「测试」「构建」「打包」（或 `test` / `build` / `package`）标题下取第一个 fenced code block。

规则：

- 每个字段按上述顺序取第一个非空值。
- `build` 必需，缺失直接判失败并记录 `missing_build`。
- `test`、`package` 可选。
- 在代码仓依次执行 `test` → `build` → `package`；Windows 用 `cmd /c`，其他平台用 `/bin/sh -c`。
- 单条命令超时 10 分钟，输出分别写入 `test.log`、`build.log`、`package.log`。
- 产物保留在仓库默认输出目录，结果中只记录命令、退出码与日志路径。

### 4.5 提交与推送

- 全部成功：`git add -A`，提交信息 `feat(<US编号>): <US名称>`。
- 任一环节失败：仍 `git add -A`，提交 `wip(<US编号>): <US名称> [failed]`，保留现场。
- 无任何改动：跳过提交，记录 `commit: null`。
- 推送：`git push -u origin feature/<user>`。
- 推送被拒：执行一次 `git pull --rebase origin feature/<user>` 后重推；冲突则 `git rebase --abort` 并标记失败。
- 绝不 force push。

### 4.6 失败与重试

- 失败 US 标记 `failed`，继续处理下一个新 US（同一 `feature/<user>` 分支）。
- 失败不自动重跑。
- 作业详情中失败 US 提供「重试」：状态重置为 `pending`，并立即触发一次 `auto_docs_update`；重试按钮仅在「自动开发」开启时可用。
- 运行中的作业沿用现有「取消」。

## 5. 状态、日志与界面

### 5.1 日志

- 目录：`scheduler/tasks/auto_docs_update/<runId>/us/<US编号>/`
- 文件：`ai.log`、`test.log`、`build.log`、`package.log`
- 作业结果中记录每个 US 的状态、分支、提交号、各命令退出码、日志相对路径。

### 5.2 界面

- 「代码生成流水线」页签顶部增加「自动开发」开关。
- US 作业不单独建列表，直接出现在现有「定时任务 → 任务队列」。
- 在 `auto_docs_update` 作业详情新增「US 开发进度」段：
  - US 编号、状态、分支、提交号、开始/结束时间、各命令退出码。
  - 日志入口（下载/查看）。
  - 失败 US 的「重试」按钮。
- 所有新增文案中英同步。

### 5.3 接口

- `GET /api/pipeline/config` / `POST /api/pipeline/config`：读写 `{ autoDev }`。
- `POST /api/pipeline/retry`：body `{ us }`，重置状态并立即触发 `auto_docs_update`。
- 其余复用调度器现有接口。

## 6. 模块划分

新增 `server/pipeline/`：

- `us-detect.js`：扫描方案目录、识别 US、计算新增差集。
- `us-state.js`：读写 `us-state.json`，原子写。
- `us-config.js`：读写 `pipeline/config.json`。
- `us-commands.js`：三种来源的构建命令解析与字段级回退。
- `us-prompt.js`：收集 US 文档、拼装提示词、大小限制。
- `us-git.js`：分支名清洗、切分支、干净检查、提交、推送、rebase。
- `us-runner.js`：编排单个 US 的完整流程。
- `pipeline-mount.js`：两个 API 路由。

接线：

- `server/scheduler/queue/consumer.js` 的 `docs` 分支在 `updateGitDirs` 之后调用注入的 `runUsDev`。
- `server/index.js` 注入 `runUsDev`，并在启动时确保 `auto_docs_update` 的 `maxRunMilliSecond` 为 6 小时。
- `server/http-api.js` 挂载 `/api/pipeline/*`。

## 7. 安全边界

- 自动开发默认关闭，需人工开启并建立基线。
- 只在代码仓内工作，只写 `feature/<user>` 分支，绝不 force push。
- 工作区不干净直接失败，不覆盖用户未提交改动。
- US 中声明的命令等价于在代码仓执行任意脚本，AI 也不做文件级限制；方案仓必须可信，且仅本机运行。
- 读取 US 文档限制在 US 文件夹内、只读普通文件、总量 200 KB。
- 推送复用本机 git 凭据，缺失则失败；不在代码或日志中输出凭据。

## 8. 测试

单元测试：

- US 识别正则、排序、基线差集。
- 三种构建命令解析、字段级优先级、缺失 `build`。
- 分支名清洗、默认分支回退。
- 提示词拼装、200 KB 限制、符号链接不跟随。
- 状态机：pending → running → success/failed，`interrupted` 处理。

集成测试（临时 git 仓库 + 本地 bare 远端 + 假 AI runner）：

- 成功：切分支、改代码、跑命令、提交、推送。
- 失败：写 WIP 提交、继续下一个 US。
- 脏工作区拒绝。
- 推送被拒时 rebase；冲突不 force。
- 开关关闭时不扫描、不开发。
- 方案目录变化时重建基线。

回归：

- 现有 `auto_docs_update` 拉取行为不变。
- 现有调度器队列、日志、取消、重试测试保持通过。
- `typecheck`、`check:i18n`、server/web 测试全绿。

## 9. 验收标准

1. 开启自动开发后，已有 US 不跑；新增一个 US 后，下一次文档更新能自动完成开发、编译打包并推送到 `feature/<user.name>`。
2. 构建命令三种来源都能生效，且 `pipeline.json` 优先。
3. 成功提交为 `feat(...)`，失败提交为 `wip(...) [failed]`，失败后继续下一个 US。
4. 任务队列能看到 `auto_docs_update` 作业，详情里按 US 展示进度、日志和重试按钮。
5. 关闭开关后不再自动改代码，重新开启时重新记基线。
6. 全程没有 force push，没有覆盖未提交改动。
