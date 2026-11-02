# Git 仓库提交检查与提交事项

> 本文件是提交/推送前**必读并执行**的检查清单。由 `AGENTS.md` 挂钩：**每次提交（commit）与推送（push）时自动触发**，未通过检查不得提交、不得推送。

## 0. 触发时机

- 任何 `git commit` 之前；
- 任何 `git push` 之前；
- 结果同步到其他仓库/远端之前。

## 1. 提交前检查清单（按顺序执行）

1. **看变更范围**
   - `git status`、`git diff`（只看本次要提交的内容）
2. **敏感信息扫描（强制，未通过禁止提交）**
   ```powershell
   git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat-|-----BEGIN [A-Z ]*PRIVATE KEY-----"
   ```
   再补充针对性搜索（令牌、口令、密钥、连接串等）：
   ```powershell
   git grep -n -I -i -E "passwd|password|passphrase|secret|api[_-]?key|token"
   ```
   - 命中真实凭据：**先移除或改成占位符**再提交。
   - 命中检测正则/示例文本（如本清单自身）：可放行，但需人工确认非真实值。
3. **确认 `env/` 未被跟踪**
   ```powershell
   git ls-files env
   ```
   输出必须为**空**。
4. **只暂存本次涉及的文件**
   - 用 `git add <具体文件>`，**禁止 `git add -A` / `git add .` 一把梭**。
   - 未跟踪的临时/生成文件不要入库。
5. **提交**（见第 3 节规范）
6. **推送**（见第 4 节）

## 2. 什么能进仓库、什么不能

- **敏感信息一律只放 `env/`**：令牌、口令/密码、密钥、私钥、任何带凭据的 URL 等。
  - 例：`env/gitee-release.ini`、`env/github.ini`、`env/git-credentials`。
  - `env/` 已在 `.gitignore`，**禁止 `git add`/提交**。
- **代码、脚本、配置模板、README、`docs/` 文档中禁止任何明文敏感信息**；
  需要引用时只用占位符，例如 `https://<user>:<token>@gitee.com/...`，真实值从 `env/` 读取。
- 运行时数据/密钥（如 `server/collaboration/*.json`、`.env*`、`*.log`）不入库。

## 3. 提交信息规范

- 采用 Conventional Commits：`type(scope): 简要描述`
- 常用 `type`：`feat` `fix` `docs` `chore` `refactor` `test` `style` `perf` `build` `ci`
- 描述用中文（与本仓库现状一致）；必要时用第二行补充原因/影响。
- 示例：
  - `feat(build): 服务版本号 vYYYYMMDDHHmmss（顶栏/关于页/产物命名/API）`
  - `chore(security): 移除文档中明文口令，AGENTS 明确敏感信息只放 env/`

## 4. 分支与推送

- 默认在 `master` 操作：`git push origin master`。
- 发版先推 tag 再建 Release（Release 附件只能走远端 API，git 不能上传附件）。
- 远端残余分支按需清理，例如：`git push origin --delete feat/web-terminal`。

## 5. 高危操作红线

- 禁止把 `env/` 内容提交或复制进代码/文档。
- 禁止在命令、脚本、文档里写死真实令牌/口令（用占位符）。
- 禁止未经确认的强推（`--force` / `--force-with-lease`）。
- 历史里若已泄露凭据：仅删当前文件不够，需重写历史（`git filter-repo`/BFG）+ **轮换该凭据**。

## 6. 一键自查（提交前粘贴执行）

```powershell
# 1) 只看跟踪文件是否有明文凭据
git grep -n -I -E "https?://[^/]+:[^/]+@|ghp_|github_pat_|glpat-|-----BEGIN [A-Z ]*PRIVATE KEY-----"
# 2) env/ 必须为空
git ls-files env
# 3) 本次将提交什么
git status --short
```
