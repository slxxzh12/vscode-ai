# 第零步：切换到提交用户对应的分支

在代码仓目录（`input.codeDir` 或 `config.codeDir`）里执行：

## 1. 取当前 git 用户

```bash
git config user.name
```

- 为空 → 停止，在 `output/report.md` 里说明「代码仓未配置 git user.name」。
- 否则按 `git user.name` 生成分支名：
  - 把空白及 `~ ^ : ? * [ \` 和控制字符替换为 `-`，再去掉首尾 `-`；
  - 分支名 = `config.branchPrefix`（默认 `feature/`）+ 清洗后的用户名（如 `feature/张三`）。

## 2. 切换或创建分支

```bash
git fetch origin            # 失败不致命，记录后继续
git show-ref --verify --quiet refs/heads/<branch>
```

- 本地已有该分支 → `git checkout <branch>`。
- 否则本地没有：
  - 若远端存在 `origin/<branch>` → `git checkout -b <branch> --track origin/<branch>`；
  - 否则找默认分支：
    - `git symbolic-ref --short refs/remotes/origin/HEAD`，或
    - 依次检查 `origin/main`、`origin/master`，都没有则用当前分支；
    - `git checkout -b <branch> <base>` 创建。

## 3. 检查工作区

```bash
git status --porcelain
```

- 有未提交改动 → **停止编码**，在 `output/report.md` 里说明「工作区不干净，请先处理」。
- 干净 → 记录当前分支名，进入第一步。

不要执行 `git commit` / `git push`，只切分支。
