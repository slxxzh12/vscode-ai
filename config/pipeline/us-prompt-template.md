# 实现用户需求

你正在代码仓 `{{cwd}}` 中工作。

开始编码前，请先完成：

1. 切换到用户分支：`git checkout {{branch}}`（若已在该分支则跳过）。
2. 拉取目标分支 `{{base}}` 的最新代码并合入当前分支：先 `git fetch origin`，再 `git merge origin/{{base}}`（无冲突则继续；有冲突先解决）。

然后请阅读下面的 US 文档，按需求完成代码与必要的测试改动。

约束：

- 可以切换分支、执行 `git fetch`、`git merge`（用于拉取目标分支最新代码），但不要执行 `git commit`、`git push`，不要修改 git 配置。
- 把改动留在工作区，由流水线负责提交与推送。
- 可以运行测试验证，但不要删除或覆盖与本需求无关的文件。

项目声明的命令：

- test: `{{test}}`
- build: `{{build}}`
- package: `{{package}}`

## US 文档

{{docs}}
