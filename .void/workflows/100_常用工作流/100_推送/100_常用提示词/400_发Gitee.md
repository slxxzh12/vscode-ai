发布 Gitee

请把当前版本的 release 包发布到 Gitee Releases（只发 Gitee）。

- 发布地址与凭据从 env/gitee-release.ini 读取，不要在提示词、代码或日志里写死仓库地址与令牌。
- 版本取 dist-portable/ 下最新的 version.txt，只上传标准包 vscode-ai-windows-x64-<version>.zip；-opencode 包超过 Gitee 单文件 100MB 限制，不上传。
- 先推 tag，再创建或更新 Release 并上传附件；tag 已存在则复用，Release 已存在则更新附件。
- Release 说明用**中文**描述本版本主要功能/修复；所有 Gitee 描述用中文，README.zh-CN.md 用中文。不要只写“标准包”。
- 凭据只从 env/ 读取，不要回显或提交。
- 回显 Release 链接、附件名、大小和简介摘要。
