请把当前版本的 release 包推送到 Gitee 和 GitHub。

要求：
1) 确定版本：读 dist-portable/ 产物根的 version.txt（形如 vYYYYMMDD），确认标准包 vscode-ai-windows-x64-<version>.zip 存在；不要上传 -opencode 包（超出 Gitee 单文件 100MB 限制）。
2) 识别远端：git remote -v，不写死地址；有多个 Gitee 远端时先确认。
3) 推 tag：已有同名 tag 则复用，否则新建；分别推送到 Gitee 与 GitHub 远端。
4) 用 env/ 中的凭据（如 env/gitee-release.ini、env/github.ini）调用远端 API：Gitee Releases API 创建/更新 Release 并上传 zip 附件；GitHub API 创建/更新 Release 并上传 asset。令牌只从 env/ 读取，禁止回显、写日志或提交。
5) Release 已存在则更新附件，避免重复创建；上传后校验附件大小与下载链接可访问。
6) 回显 Gitee 与 GitHub 两个 Release 页面链接、附件名与大小。
7) 失败时报告具体远端、HTTP 状态与错误信息，不要重试强推，不要泄露令牌。
