# 设计文档：开发工作流新增「基础环境检查」阶段

日期：2026-09-11
分支：master
状态：待评审

## 1. 概述

在「开发工作流」（`config/devflow.xml` 的 `<workflow id="dev">`）最前面新增一个提示词阶段 **基础环境检查**（`<stage id="env-check" label="基础环境检查" group="需求">`）。

点击该阶段会把一段提示词填入输入框，交给 AI 在当前工作目录执行一次**幂等的基础环境检查与初始化**：

1. 确认工作目录（代码仓根目录）。
2. 检查/生成 `AGENTS.md`。
3. 检查/初始化文档仓 `docs/`（`knowledge`、`memory`、`version` 三目录）。
4. 把文档仓结构写入 `AGENTS.md` 的「文档仓」章节。
5. 把「注意事项（已验证教训）」章节补入 `AGENTS.md`。
6. 输出检查报告。

本改动**不新增服务端逻辑**，只新增一个工作流阶段（配置 + 前端兜底 + i18n 词条），沿用现有「点击阶段 → 填入输入框 → AI 执行」机制。

### 已与用户确认的约束

- 形式：**devflow 工作流阶段**（提示词），放在「需求」分组，作为开发工作流第一个阶段。
- 文档仓形态：**代码仓内普通目录 `docs/`**（跟随代码仓 git 管理），与 `docs/superpowers/` 并存，**不是**独立 git 仓 / submodule。
- `AGENTS.md`：**参考本仓库 AGENTS.md 骨架生成**，含「注意事项」章节；已存在则只补缺、不覆盖。
- 文档仓文件：每目录放 `README.md`（用途与命名规范）+ `.gitkeep` 占位；具体条目后续填充。
- 落地范围：改 seed 配置 + 前端兜底 + i18n 中英词条，并**同步写入活动配置文件**。

## 2. 阶段定义

在 `config/devflow.xml` 的 `<workflow id="dev">` 内、`<stage id="design">` 之前插入：

```xml
<stage id="env-check" label="基础环境检查" group="需求">
  <prompt>【基础环境检查】请对当前工作目录做一次基础环境检查与初始化。除缺失内容外一律不覆盖，保持幂等。

1) 确认工作目录：以当前目录为代码仓根目录；若处于 git 仓库内，取其仓库根目录。若判断目录不对，先停下来向我确认。
2) 检查 AGENTS.md：
   - 不存在：参考本仓库 AGENTS.md 的骨架，在当前目录新建，至少包含五节——环境、常用命令与服务启动规范、目录速览、注意事项（已验证教训）、文档仓。
   - 已存在：逐节核对，只补齐缺失章节，不覆盖已有内容。
3) 检查文档仓 docs/：应包含 knowledge、memory、version 三个目录。缺失则创建，并在每个目录放置 README.md（说明用途与命名规范）与 .gitkeep 占位。
   - knowledge/：模块知识，按模块平铺，文件名「模块名.md」。
   - memory/：经验教训，平铺，文件名「YYYY-MM-DD-主题.md」。
   - version/：版本文档，按需求平铺文件夹，命名「US编号-名称/」（US 开头，一个需求一个文件夹）。
4) 把第 3 步的文档仓结构写入 AGENTS.md 的「文档仓」章节。
5) 把「注意事项（已验证教训）」章节补入 AGENTS.md：参考本仓库 AGENTS.md 的写法（如临时/生成文件禁止入库、提交前先看 git status、只 add 本次相关文件、提交/推送规范等），并结合当前代码仓实际补充。
6) 输出检查报告：工作目录、AGENTS.md（新建/已存在/补了哪些章节）、文档仓（新建了哪些目录与文件）、以及需要我确认的问题。</prompt>
</stage>
```

- 提示词为**单条**，文本内不含 `<` / `>`，避免手工写 XML 时的转义问题。
- `group="需求"`：与 `design`、`design-review` 同组，排在它们之前。

## 3. 前端兜底

`web/src/components/TerminalView.vue` 的 `buildFallbackWf()`（工作流定义拉取失败时的兜底）在 `dev` 工作流 `design` 阶段之前同步加入：

```ts
{ id: 'env-check', label: t('termwf.envcheck.label'), group: t('termwf.group.requirement'), prompts: [t('termwf.envcheck.prompt')] },
```

## 4. i18n 词条

`shared/i18n/zh-CN.js` 与 `shared/i18n/en.js` 各新增两条（键集合保持对称）：

| key | zh-CN | en |
| --- | --- | --- |
| `termwf.envcheck.label` | 基础环境检查 | Environment check |
| `termwf.envcheck.prompt` | 与第 2 节提示词正文一致（中文全文） | 下方英文全文 |

`en` 的 `termwf.envcheck.prompt` 正文（注意：不含 `{...}` 插值占位符）：

```
[Environment check] Run an idempotent basic environment check and initialization on the current working directory. Never overwrite existing content; only fill in what is missing.

1) Confirm the working directory: treat the current directory as the code repo root; if inside a git repo, use its repository root. If the directory looks wrong, stop and confirm with me first.
2) Check AGENTS.md:
   - Missing: create it in the current directory based on this repo's AGENTS.md skeleton, with at least five sections — Environment, Common commands & service startup conventions, Directory overview, Precautions (verified lessons), Docs repo.
   - Present: check each section and only add missing sections; do not overwrite existing content.
3) Check the docs repo docs/: it should contain knowledge, memory, version. If missing, create them and put a README.md (purpose and naming conventions) plus a .gitkeep placeholder in each.
   - knowledge/: module knowledge, flat by module, filename "module.md".
   - memory/: lessons learned, flat, filename "YYYY-MM-DD-topic.md".
   - version/: version docs, flat folders by requirement, named "US<id>-<name>/" (prefixed with US; one folder per requirement).
4) Write the docs-repo structure from step 3 into the "Docs repo" section of AGENTS.md.
5) Add a "Precautions (verified lessons)" section to AGENTS.md: follow this repo's AGENTS.md style (e.g., no temp/generated files in the repo, check git status before committing, add only files relevant to this change, commit/push conventions) and adapt to the current code repo.
6) Output a check report: working directory, AGENTS.md status (created/existing/sections added), docs repo (directories and files created), and any questions needing my confirmation.
```

说明：
- `config/devflow.xml` 的阶段提示词属**配置内容**，按 AGENTS.md 的 i18n 排除项，保持中文即可，不参与 `check:i18n`。
- 前端兜底文案属用户可见字符串，**必须**中英双语，故走 `termwf.envcheck.*`。
- 服务端精简兜底 `server/workflow-xml.js` 的 `fallbackWorkflows()`（仅 4 阶段：design/code/test/deploy）**不改**。

## 5. 活动配置同步

活动配置为 `<dataHome>/downloads/devflow.xml`（Windows：`C:\Users\<user>\.local\share\devflow\downloads\devflow.xml`），**已存在则 seed 不覆盖**。

因此除改 seed `config/devflow.xml` 外，需把同一 `<stage>` 写入活动配置文件（就地插入到 `<workflow id="dev">` 的 `design` 阶段之前），使用户重启后端后即可看到。已确认该文件当前存在。

生效方式：改活动 XML 后需**重启后端**（`dev:server` 的 `--watch` 不监听 xml）。

## 6. 测试与验收

- 单测：`server/test/workflow-xml.test.js`、`server/test/devflow-config.test.js` 现有断言基于**测试内联 XML 字符串**，不读真实 `config/devflow.xml`，预期不受影响；实现后跑一遍确认。
- i18n：`npm.cmd run check:i18n` 需通过（新增中英词条对称，且 `TerminalView.vue` 无硬编码中文）。
- 类型检查：`npm.cmd run typecheck` 需通过。
- 全量：`npm.cmd test` 需通过。
- 人工验收：重启后端 → 打开 http://localhost:5173 → 工作流「开发工作流」首阶段显示「基础环境检查」（需求分组）→ 点击后输入框填入提示词。

## 7. 明确不做

- 不新增服务端/前端程序化检查动作（不做按钮式自动建目录），检查与创建由 AI 按提示词完成。
- 不把文档仓做成独立 git 仓 / submodule。
- 不改服务端精简兜底 `fallbackWorkflows()`。
- 不引入配置热重载。

## 8. 决策记录

- 形式为工作流阶段：用户明确「做成一个提示词，放到需求分组里的基础环境检查」。
- 文档仓 = `docs/` 普通目录：用户确认；与现有 `docs/superpowers/` 并存。
- 单条提示词：用户要求「一个提示词」；幂等 + 报告写入提示词正文，无需拆多条。
- 同步活动配置：用户选择「完整落地 + 同步活动配置」，确保当前实例可用。
