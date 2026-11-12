# Rules

存放团队必须遵守、且尽量可自动检查的规则。

## 写法

- 一个领域一个 Markdown 文件，例如 `代码提交规范.md`。
- 每条规则包含：适用范围、级别（必须/建议）、约束条目、例外、违规处理。
- 能自动检查的规则优先落到 lint / CI / 脚本，文档只保留说明与入口。

## 默认结构

- `docs/knowledge/`：知识库
- `docs/memory/`：经验库
- `docs/version/`：设计方案（按 `US000001-2021-需求名称` 组织）
- `docs/learn/`：工作流 / 流程规范
- `skills/`：skills
- `docs/rules/`：本目录，规则
