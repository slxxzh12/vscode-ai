# 写代码（按工作流配置 + 方案目录）

本工作流由多个 Markdown 子文件组成，并读取同目录的 `config.json` 作为配置。

## 先读配置

1. 读取当前目录下的 `config.json`：
   - `codeDir`：默认代码仓目录
   - `commands.test` / `commands.build` / `commands.package`：流水线命令
   - `rules`：编码约束
2. 读取当前目录下的 `input.json`：
   - `solutionDir`：本次方案目录（必填）
   - `codeDir`：代码仓目录覆盖（可为空）

## 计算实际参数

- `实际 codeDir` = `input.codeDir` 非空 ? `input.codeDir` : `config.codeDir`
- `实际 solutionDir` = `input.solutionDir`
- `命令` = `config.commands`

若最终 `codeDir` 为空，**停止编码**，在 `output/report.md` 中说明：请在 `workflow/config.json` 里填写 `codeDir`，或在表单里填写「代码仓目录覆盖」。

## 按顺序执行

0. `00-branch.md` —— 在代码仓里切到 `branchPrefix + <git user.name>` 分支；不存在则从默认分支创建；工作区不干净则停止。
1. `01-read-solution.md` —— 读取方案目录下的文档，提炼需求与验收标准。
2. `02-implement.md` —— 在代码仓里按方案改代码（遵守 `config.rules`）。
3. `03-verify.md` —— 运行配置里的 test/build/package（非空才跑），并输出报告。

最终把结果写入 `output/report.md`。本插件通过「AI 小工具」站点执行，命令由站点用 `opencode run` 运行。
