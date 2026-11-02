请把当前版本的 release 包推送到：

- Gitee：https://gitee.com/slxxzh12/vscode-ai/releases
- GitHub：https://github.com/slxxzh12/vscode-ai/releases

版本取 dist-portable/ 下最新的 version.txt，只上传标准包 vscode-ai-windows-x64-<version>.zip（不上传 -opencode 包）。

tag 已存在则复用；Release 已存在则更新附件。凭据只从 env/ 读取，不要回显或提交。

完成后回显两个 Release 链接、附件名与大小。
