请把当前版本的 release 包推送到：

- Gitee：https://gitee.com/slxxzh12/vscode-ai/releases
- GitHub：https://github.com/slxxzh12/vscode-ai/releases

版本取 dist-portable/ 下最新的 version.txt，只上传标准包 vscode-ai-windows-x64-<version>.zip（不上传 -opencode 包）。

发布时必须在 Release 说明（body）里写清本版本的主要改动简介，不要只写“标准包”：
- 先根据最近的提交记录整理本次相比上一版本的主要功能、修复和注意事项。
- 把整理好的简介写入 Gitee / GitHub Release 的说明（body）。
- 新建 Release 和更新已有 Release 时都要同步更新简介。
- 回显时同时给出简介摘要。

tag 已存在则复用；Release 已存在则更新附件。凭据只从 env/ 读取，不要回显或提交。

完成后回显两个 Release 链接、附件名与大小。
