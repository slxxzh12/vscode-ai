请把当前分支代码推送到 Gitee 和 GitHub。

要求：
1) 先跑 git remote -v 识别 Gitee 与 GitHub 远端，不要写死地址；存在多个 Gitee 远端时先向我确认推哪个。
2) 工作区不干净时先按 docs/learn/git仓库提交检查和提交事项.md 提交：敏感信息扫描、git ls-files env 为空、只 add 本次相关文件，提交信息用 Conventional Commits。
3) 逐远端推送当前分支（git push <remote> <branch>），推完回显提交短哈希与结果。
4) 禁止 --force / --force-with-lease；禁止在命令、日志或输出中出现真实凭据，认证信息只从 env/ 读取。
5) 某个远端失败时报告具体远端与错误信息，不要跳过或伪造成功。
