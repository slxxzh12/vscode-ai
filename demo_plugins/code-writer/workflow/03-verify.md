# 第三步：运行命令并输出报告

在代码仓目录下依次运行 `config.json` 中**非空**的命令：

1. `commands.test`
2. `commands.build`
3. `commands.package`

要求：

- 记录每条命令的退出码与关键输出；
- 失败时先尝试修复再重跑一次；仍失败则在报告中说明原因；
- 不要 `git commit` / `git push`。

最后把结果写入 `output/report.md`，包含：

```
# 方案实现报告

方案目录：<solutionDir>
代码仓目录：<codeDir>
分支：<branch>

## 需求摘要
...

## 改动文件
- path/to/a.ts — ...
- ...

## 命令结果
- test: <通过/失败/未配置>（退出码）
- build: ...
- package: ...

## 风险 / 待办
- ...
```
