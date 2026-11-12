# US 自动开发流水线

## 开启

1. 在「代码统计 → 代码生成流水线」为知识库、方案仓、代码仓等选择目录。
2. 打开「自动开发」开关。开启时当前已有 US 记为基线，不补跑。
3. 方案仓新增 `US000001-2021-需求名称` 文件夹后，下一次文档更新自动处理。

## 每个 US 做什么

1. 切到 `feature/<git user.name>`（不存在则从 origin 默认分支创建）。
2. 用 opencode 读取 US 文档并改代码。
3. 依次执行 US 声明的 `test`、`build`、`package`。
4. 成功提交 `feat(...)`，失败提交 `wip(...) [failed]`，推送 `feature/<user>`。

## 构建命令来源

按字段优先级：`pipeline.json` → `01-需求分析.md` frontmatter → `05-构建发布.md`。

## 文档仓默认结构

点击「套用文档仓默认结构」会探测所选仓库根目录，缺失的目录会自动创建并回填到各槽位（含工作流目录）：

- 知识库：`docs/knowledge`
- 方案仓：`docs/version`
- 工作流：`docs/learn`（或 `docs/workflows`、`.void/workflows`）
- 经验库：`docs/memory`
- skills：优先 `.opencode/skills`、`.opencode/skill`、`.claude/skills`、`.void/skills`，都没有时用 `skills`
- rules：优先 `.opencode/rules`、`.opencode/rule`、`.claude/rules`、`.void/rules`，都没有时用 `docs/rules`

## 查看进度

「定时任务 → 任务队列」里的 `auto_docs_update` 作业详情，包含每个 US 的状态、分支、提交号、日志与重试按钮。

## 自动合并

开启「自动合并」后，US 构建成功并推送 `feature/<user>` 会继续：

1. 根据 `origin` 识别 Gitee / GitHub / GitLab。
2. GitHub 用 `gh`、GitLab 用 `glab` 的登录态创建 PR/MR；Gitee 用 `git credential fill` 取凭据调 Gitee API。
3. 以 Merge commit 方式自动合并到远端默认分支（通常是 `master`）。
4. 合并成功后把本地 `feature/<user>` 快进到最新默认分支，保留远端分支。
5. 合并失败时该 US 标记失败并保留 PR/MR 链接，后续 US 继续。

## 注意

- 失败 US 不自动重跑，需手动点「重试」。
- 失败会写 WIP 提交到用户分支，后续 US 继续在该分支执行。
- 不会 force push，不会覆盖未提交改动。
