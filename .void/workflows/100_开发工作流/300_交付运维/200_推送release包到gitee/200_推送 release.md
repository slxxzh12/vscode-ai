请把对应的 release 包推送到 Gitee Releases。

要求：
1) 发布地址与凭据从 env/gitee-release.ini 读取，不要在提示词、代码或日志里写死仓库地址与令牌。
2) 只上传标准包 vscode-ai-windows-x64-<version>.zip；-opencode 包超过 Gitee 单文件 100MB 限制，不上传。
3) 先推 tag，再创建或更新 Release 并上传附件。
4) 回显 Release 页面链接与附件名、大小。
