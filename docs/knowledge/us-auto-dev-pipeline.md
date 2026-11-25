# US 自动开发流水线

## 开启

1. 在「代码统计 → 代码生成流水线」为知识库、方案仓、代码仓等选择目录。
2. 打开「自动开发」开关。开启时当前已有 US 记为基线，不补跑。
3. 方案仓新增 `US000001-2021-需求名称` 文件夹后，下一次文档更新自动处理。

## 每个 US 做什么

1. 切到 `feature/<文档提交人的工号或姓名>`（不存在则从 origin 默认分支创建）。文档提交人取方案目录该 US 最近一次 git 提交作者：优先用协作成员表把作者名/邮箱映射成工号，映射不到就用作者名；都没有时退回本机 `git user.name`。
2. 在「定时任务」里为该 US 新建一条 AI 任务（名称「代码生成 · US…」，只在本机运行），把 US 文档渲染成提示词交给 opencode 改代码；任务跑完保留一段时间供查看。
3. 依次执行 US 声明的 `test`、`build`、`package` 作为自验证。
4. 成功提交 `feat(...)`，失败提交 `wip(...) [failed]`，推送对应 `feature/<文档提交人>` 分支。

## 触发条件

- 新增 US 文件夹（相对基线）；
- 或已有 US 文档目录的**最近一次 git 提交**发生变化（每个 US 记录上次处理的提交 hash，变化才重跑，避免重复提交）。

## 构建命令来源

按字段优先级：`pipeline.json` → `01-需求分析.md` frontmatter → `05-构建发布.md`。

## 文档仓默认结构

点击「初始化文档仓与样例」会探测所选仓库根目录，把下面 6 个目录全部建好（未勾选也建），空路径回填默认路径、已有自定义路径不覆盖；随后在每个目录写入 README 骨架与示例（已存在文件跳过），并在文档仓根写/追加 `AGENTS.md`（说明文档仓与代码仓的区别、各目录定位与归档位置）：

- 知识库：`docs/knowledge`
- 方案仓：`docs/version`
- 工作流：`docs/learn`（或 `docs/workflows`、`.void/workflows`）
- 经验库：`docs/memory`
- skills：优先 `.opencode/skills`、`.opencode/skill`、`.claude/skills`、`.void/skills`，都没有时用 `skills`
- rules：优先 `.opencode/rules`、`.opencode/rule`、`.claude/rules`、`.void/rules`，都没有时用 `docs/rules`

「套用文档仓默认结构」按钮仍然只建目录、不做样例初始化。

## 查看进度

「定时任务 → 任务队列」里的 `auto_docs_update` 作业详情，包含每个 US 的状态、分支、提交号、日志与重试按钮。每个 US 的代码生成同时会以「代码生成 · US…」出现在「定时任务」列表里，可单独查看该 AI 任务的运行日志与报告。

## 定时拉取与检测

内置「自动更新文档」任务（`auto_docs_update`，默认每分钟）会对「代码统计 → 代码生成流水线」勾选的目录执行 `git pull --ff-only`，再扫描方案仓新增 US 文件夹与文档提交变化并触发生成；「开始监控方案变化」用于在本地目录变化时提前触发同一任务。方案目录支持直接放在 `docs/version/` 下，也支持放在一层特性文件夹（`F0001-特性名/`）内。

## 自动合并

开启「自动合并」后，US 构建成功并推送 `feature/<文档提交人>` 会继续：

1. 根据 `origin` 识别 Gitee / GitHub / GitLab。
2. GitHub 用 `gh`、GitLab 用 `glab` 的登录态创建 PR/MR；Gitee 用 `git credential fill` 取凭据调 Gitee API。
3. 以 Merge commit 方式自动合并到远端默认分支（通常是 `master`）。
4. 合并成功后把本地 `feature/<文档提交人>` 快进到最新默认分支，保留远端分支。
5. 合并失败时该 US 标记失败并保留 PR/MR 链接，后续 US 继续。

## 注意

- 失败 US 不自动重跑，需手动点「重试」。
- 失败会写 WIP 提交到用户分支，后续 US 继续在该分支执行。
- 不会 force push，不会覆盖未提交改动。
