# 开发工作流「基础环境检查」阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 devflow「开发工作流」最前面新增一个「基础环境检查」（`env-check`）提示词阶段，指导 AI 对当前工作目录做幂等的 AGENTS.md / 文档仓检查与初始化。

**Architecture:** 纯配置与文案改动，不新增服务端逻辑。新增一个 `<stage>` 到 `config/devflow.xml`（seed）并同步写入活动配置；前端 `buildFallbackWf()` 兜底同步加该阶段；新增 i18n 中英词条。用一条回归测试锁定 seed 配置内容。

**Tech Stack:** XML 配置、Vue3 + TS（Vite/Vitest）、Node 24 ESM（`node --test`）、自定义 i18n 字典（`shared/i18n/*.js`）。

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `config/devflow.xml` | 工作流 seed 配置（唯一默认源模板） | Modify：dev 工作流首阶段加 `env-check` |
| `server/test/devflow-config-seed.test.js` | 回归测试：断言 seed 的 dev 工作流首阶段为 env-check | Create |
| `shared/i18n/zh-CN.js` | 中文词条 | Modify：加 `termwf.envcheck.*` |
| `shared/i18n/en.js` | 英文词条 | Modify：加 `termwf.envcheck.*` |
| `server/test/i18n.test.js` | i18n 测试 | Modify：加新词条存在性断言 |
| `web/src/components/TerminalView.vue` | 工作流定义前端兜底 | Modify：`buildFallbackWf()` dev 首阶段加 env-check |
| `<dataHome>/downloads/devflow.xml` | 活动配置（用户运行实例） | Modify（不入库）：同步 stage |

**参考约定（务必遵守）：**
- Windows + PowerShell 5.1，**无 bash**；`npm.ps1` 被拦截 → 一律 `npm.cmd`。
- 只 `git add` 本次改动涉及的文件，禁止 `git add -A`（工作区可能已有他人/未提交改动）。
- `config/devflow.xml` 属配置内容，提示词保持中文；`web/src`、`server` 用户可见文案必须走 i18n。

---

### Task 1: seed 配置新增「基础环境检查」阶段（含回归测试）

**Files:**
- Create: `server/test/devflow-config-seed.test.js`
- Modify: `config/devflow.xml:18-19`

- [ ] **Step 1: 写失败测试**

新建 `server/test/devflow-config-seed.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDevflowConfig } from '../devflow-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEED = path.join(ROOT, 'config', 'devflow.xml');

test('seed 配置：开发工作流首阶段为「基础环境检查」（env-check/需求）', () => {
  const cfg = parseDevflowConfig(fs.readFileSync(SEED, 'utf8'));
  const dev = cfg.workflows.find((w) => w.id === 'dev');
  assert.ok(dev, '缺少 dev 工作流');
  const first = dev.stages[0];
  assert.equal(first.id, 'env-check');
  assert.equal(first.label, '基础环境检查');
  assert.equal(first.group, '需求');
  assert.equal(first.prompts.length, 1);
  for (const token of ['基础环境检查', 'knowledge', 'memory', 'version', 'AGENTS.md']) {
    assert.ok(first.prompts[0].includes(token), `提示词缺少 ${token}`);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/devflow-config-seed.test.js"`
Expected: FAIL —— `first.id` 实际为 `design`（断言 `env-check` 失败）。

- [ ] **Step 3: 在 seed 配置中插入阶段**

修改 `config/devflow.xml`，把：

```xml
    <workflow id="dev" label="开发工作流">
      <stage id="design" label="需求设计" group="需求">
```

替换为：

```xml
    <workflow id="dev" label="开发工作流">
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
      <stage id="design" label="需求设计" group="需求">
```

> 提示词正文不含 `<`、`>`、`&`，无需 XML 转义。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/devflow-config-seed.test.js"`
Expected: PASS（1 test passed）。

- [ ] **Step 5: 提交**

```powershell
git add config/devflow.xml server/test/devflow-config-seed.test.js
git commit -m "feat(workflow): 开发工作流新增基础环境检查阶段"
```

---

### Task 2: 新增 i18n 词条（中英对称，含测试）

**Files:**
- Modify: `shared/i18n/zh-CN.js:420`
- Modify: `shared/i18n/en.js:420`
- Modify: `server/test/i18n.test.js`（文件末尾追加一个 test）

- [ ] **Step 1: 写失败测试**

在 `server/test/i18n.test.js` 末尾追加：

```js
test('工作流基础环境检查词条中英均存在', () => {
  for (const loc of ['zh-CN', 'en']) {
    assert.notEqual(translate(loc, 'termwf.envcheck.label'), 'termwf.envcheck.label');
    assert.notEqual(translate(loc, 'termwf.envcheck.prompt'), 'termwf.envcheck.prompt');
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "server/test/i18n.test.js"`
Expected: FAIL —— 两个 key 都回退成 key 本身。

- [ ] **Step 3: 追加中文词条**

在 `shared/i18n/zh-CN.js` 中，把：

```js
  'termwf.dev.title': '开发工作流',
  'termwf.design.label': '需求设计',
```

替换为：

```js
  'termwf.dev.title': '开发工作流',
  'termwf.envcheck.label': '基础环境检查',
  'termwf.envcheck.prompt': '【基础环境检查】请对当前工作目录做一次基础环境检查与初始化。除缺失内容外一律不覆盖，保持幂等。\n\n1) 确认工作目录：以当前目录为代码仓根目录；若处于 git 仓库内，取其仓库根目录。若判断目录不对，先停下来向我确认。\n2) 检查 AGENTS.md：\n   - 不存在：参考本仓库 AGENTS.md 的骨架，在当前目录新建，至少包含五节——环境、常用命令与服务启动规范、目录速览、注意事项（已验证教训）、文档仓。\n   - 已存在：逐节核对，只补齐缺失章节，不覆盖已有内容。\n3) 检查文档仓 docs/：应包含 knowledge、memory、version 三个目录。缺失则创建，并在每个目录放置 README.md（说明用途与命名规范）与 .gitkeep 占位。\n   - knowledge/：模块知识，按模块平铺，文件名「模块名.md」。\n   - memory/：经验教训，平铺，文件名「YYYY-MM-DD-主题.md」。\n   - version/：版本文档，按需求平铺文件夹，命名「US编号-名称/」（US 开头，一个需求一个文件夹）。\n4) 把第 3 步的文档仓结构写入 AGENTS.md 的「文档仓」章节。\n5) 把「注意事项（已验证教训）」章节补入 AGENTS.md：参考本仓库 AGENTS.md 的写法（如临时/生成文件禁止入库、提交前先看 git status、只 add 本次相关文件、提交/推送规范等），并结合当前代码仓实际补充。\n6) 输出检查报告：工作目录、AGENTS.md（新建/已存在/补了哪些章节）、文档仓（新建了哪些目录与文件）、以及需要我确认的问题。',
  'termwf.design.label': '需求设计',
```

- [ ] **Step 4: 追加英文词条**

在 `shared/i18n/en.js` 中，把：

```js
  'termwf.dev.title': 'Development workflow',
  'termwf.design.label': 'Requirement design',
```

替换为：

```js
  'termwf.dev.title': 'Development workflow',
  'termwf.envcheck.label': 'Environment check',
  'termwf.envcheck.prompt': '[Environment check] Run an idempotent basic environment check and initialization on the current working directory. Never overwrite existing content; only fill in what is missing.\n\n1) Confirm the working directory: treat the current directory as the code repo root; if inside a git repo, use its repository root. If the directory looks wrong, stop and confirm with me first.\n2) Check AGENTS.md:\n   - Missing: create it in the current directory based on the AGENTS.md skeleton of this repo, with at least five sections - Environment, Common commands and service startup conventions, Directory overview, Precautions (verified lessons), Docs repo.\n   - Present: check each section and only add missing sections; do not overwrite existing content.\n3) Check the docs repo docs/: it should contain knowledge, memory, version. If missing, create them and put a README.md (purpose and naming conventions) plus a .gitkeep placeholder in each.\n   - knowledge/: module knowledge, flat by module, filename "module.md".\n   - memory/: lessons learned, flat, filename "YYYY-MM-DD-topic.md".\n   - version/: version docs, flat folders by requirement, named "US<id>-<name>/" (prefixed with US; one folder per requirement).\n4) Write the docs-repo structure from step 3 into the "Docs repo" section of AGENTS.md.\n5) Add a "Precautions (verified lessons)" section to AGENTS.md: follow the AGENTS.md style used in this repo (for example, no temp/generated files in the repo, check git status before committing, add only files relevant to this change, commit/push conventions) and adapt to the current code repo.\n6) Output a check report: working directory, AGENTS.md status (created/existing/sections added), docs repo (directories and files created), and any questions needing my confirmation.',
  'termwf.design.label': 'Requirement design',
```

> 注意：`termwf.envcheck.prompt` 正文**不得**出现 `{...}`（会被 `translate()` 当成插值占位符）。

- [ ] **Step 5: 运行测试确认通过 + i18n 检查**

Run: `node --test "server/test/i18n.test.js"`
Expected: PASS。

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`（exit 0）。

- [ ] **Step 6: 提交**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js server/test/i18n.test.js
git commit -m "feat(i18n): 基础环境检查阶段中英词条"
```

---

### Task 3: 前端兜底加入该阶段

**Files:**
- Modify: `web/src/components/TerminalView.vue:316`

- [ ] **Step 1: 在 `buildFallbackWf()` 的 dev 工作流中插入阶段**

把：

```ts
        { id: 'design', label: t('termwf.design.label'), group: t('termwf.group.requirement'), prompts: [t('termwf.design.prompt1'), t('termwf.design.prompt2')] },
```

替换为：

```ts
        { id: 'env-check', label: t('termwf.envcheck.label'), group: t('termwf.group.requirement'), prompts: [t('termwf.envcheck.prompt')] },
        { id: 'design', label: t('termwf.design.label'), group: t('termwf.group.requirement'), prompts: [t('termwf.design.prompt1'), t('termwf.design.prompt2')] },
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无错误（exit 0）。

- [ ] **Step 3: 提交**

```powershell
git add web/src/components/TerminalView.vue
git commit -m "feat(web): 工作流兜底新增基础环境检查阶段"
```

---

### Task 4: 同步写入活动配置（不入库）

**Files:**
- Modify: `C:\Users\slxxzh11\.local\share\devflow\downloads\devflow.xml`

> 活动配置不由 seed 覆盖；必须就地写入，用户重启后端后才会出现该阶段。

- [ ] **Step 1: 把同一 stage 块插入活动配置**

用编辑工具对 `C:\Users\slxxzh11\.local\share\devflow\downloads\devflow.xml` 执行与 Task 1 Step 3 **完全相同**的替换（old/new 文本一致）。替换后 `<workflow id="dev" label="开发工作流">` 的首个子节点应为 `<stage id="env-check" ...>`。

- [ ] **Step 2: 校验活动配置可解析且首阶段正确**

Run（PowerShell，使用项目 Node）：

```powershell
node -e "const fs=require('fs');const {parseDevflowConfig}=require('./server/devflow-config.js');" 2>$null; node --input-type=module -e "import fs from 'node:fs'; import {parseDevflowConfig} from './server/devflow-config.js'; const f=process.env.USERPROFILE+'/.local/share/devflow/downloads/devflow.xml'; const c=parseDevflowConfig(fs.readFileSync(f,'utf8')); const dev=c.workflows.find(w=>w.id==='dev'); console.log(dev.stages[0].id, dev.stages[0].group);"
```

Expected: 输出 `env-check 需求`。

> 校验仅读文件，不提交、不入库。

---

### Task 5: 全量验收并提交计划文档

- [ ] **Step 1: 跑全量测试**

Run: `npm.cmd test`
Expected: server 与 web 测试全部通过。

- [ ] **Step 2: 类型检查 + i18n 检查**

Run: `npm.cmd run typecheck`
Expected: exit 0。

Run: `npm.cmd run check:i18n`
Expected: `check-i18n: 未发现中文命中`。

- [ ] **Step 3: 确认工作区只含预期改动**

Run: `git status --short`
Expected: 除本计划文件（已随 writing-plans 一并提交）外无其它未跟踪/未提交的本次改动；**注意不要**误 `git add` 已有的无关改动（如 `web/src/App.vue`）。

---

## 验收清单（对应 spec §6）

- [ ] `config/devflow.xml`：`dev` 工作流首阶段为 `env-check`（label 基础环境检查，group 需求，1 条 prompt）。
- [ ] `shared/i18n/zh-CN.js` 与 `en.js`：`termwf.envcheck.label` / `.prompt` 均存在且对称。
- [ ] `web/src/components/TerminalView.vue`：兜底 dev 工作流首阶段为 env-check。
- [ ] 活动配置 `<dataHome>/downloads/devflow.xml` 已同步（不入库）。
- [ ] `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run check:i18n` 全绿。
- [ ] 人工验收：重启后端 → http://localhost:5173 → 工作流「开发工作流」首阶段显示「基础环境检查」（需求组）→ 点击后输入框填入提示词。
