# 统一 XML 配置（config/devflow.xml）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 server(port/language) + agents + workflows 统一到单个 `config/devflow.xml`，服务端解析并通过 API 下发，设置可写回，前端/打包不再写死。

**Architecture:** 新增 `server/devflow-config.js` 作为唯一配置入口（解析/序列化/读取/缺失生成/就地改属性），复用 `workflow-xml.js` 的 `parseWorkflowXml`；`server/index.js` 用它替换 `settings.js`；前端 `TerminalView` 从 `/api/agents` 加载 Agent 列表。

**Tech Stack:** Node 24 ESM（`node:test`）、Vue3+TS+Vite、`node:crypto` 无新增依赖。

**参考 spec:** `docs/superpowers/specs/2026-09-10-unified-xml-config-design.md`

**环境提醒:** Windows + PowerShell 5.1，无 bash，一律 `npm.cmd`。配置 XML 改动后需重启后端（`--watch` 不监听 xml）。

---

## File Structure

- Create: `config/devflow.xml` — 统一配置（迁移 workflow.xml + server + agents）。
- Delete: `config/workflow.xml`（迁入后删除）；`config/server.json`（运行时文件，废弃）。
- Create: `server/devflow-config.js` — 配置解析/序列化/读写。
- Create: `server/test/devflow-config.test.js` — 单测。
- Modify: `server/workflow-xml.js` — `defaultWorkflowFile` 指向 devflow.xml。
- Modify: `server/index.js` — 接线（settings/agents/workflows 端点）。
- Delete: `server/settings.js`。
- Rewrite: `server/test/i18n-settings.test.js` → devflow-config 版。
- Modify: `server/workflow-xml.test.js` — 指向 devflow.xml。
- Modify: `server/collaboration/http-mount.js` — 邀请链接默认 origin 用配置端口。
- Modify: `web/src/components/TerminalView.vue` — Agent 从 API 加载。
- Modify: `web/vite.config.ts` — dev 代理端口读配置。
- Modify: `scripts/build.js` — 复制 config + start.bat 端口读配置 + 校验项。
- Modify: `AGENTS.md` — 配置说明。

---

## Task 1: 生成 `config/devflow.xml` 并迁移旧配置

**Files:**
- Create: `config/devflow.xml`
- Delete: `config/workflow.xml`, `config/server.json`

- [ ] **Step 1: 写 `config/devflow.xml`**

内容 = 头部 `server` + `agents` + 现有 `config/workflow.xml` 的 `<workflow>` 块（原样搬入 `<workflows>`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!--
  DevFlow 统一配置
  - server：监听端口与语言（设置面板可改，服务端就地改写本标签属性）
  - agents：默认 Agent 列表（default 为默认选中的 id）
  - workflows：工作流/阶段/提示语（点击填入输入框）
-->
<devflow>
  <server port="3001" language="zh-CN" />

  <agents default="opencode">
    <agent id="opencode" name="OpenCode" cmd="opencode" />
    <agent id="claudecode" name="ClaudeCode" cmd="claudecode" />
    <agent id="nga" name="nga" cmd="nga.cmd" />
  </agents>

  <workflows>
    <workflow id="dev" label="开发工作流">
      <stage id="design" label="需求设计" group="需求">
        <prompt>请使用 superpower brainstorm 来拆解下面需求：</prompt>
        <prompt>请澄清该需求的边界、非目标与验收标准，列出待确认问题。</prompt>
        <prompt>请输出一份简明的需求文档（背景/目标/功能点/验收标准）。</prompt>
      </stage>
      <stage id="design-review" label="需求 Review" group="需求">
        <prompt>请使用 gstack 的 autoplan skills 对刚才输入的文档进行 review</prompt>
        <prompt>请用 plan-ceo-review 从产品价值与范围角度评审该需求，给出取舍建议。</prompt>
        <prompt>请用 plan-eng-review 从架构/数据流/边界/测试角度评审该需求。</prompt>
      </stage>
      <stage id="code" label="代码实现" group="开发交付">
        <prompt>请按需求文档实现功能，遵循仓库 AGENTS 约定，改完先跑测试与类型检查。</prompt>
        <prompt>请先给出实现方案与改动清单，确认后再动手编码。</prompt>
        <prompt>请实现并补充必要注释与错误处理，保持改动最小化。</prompt>
      </stage>
      <stage id="optimize" label="代码优化" group="开发交付">
        <prompt>请在不改变行为的前提下重构优化（可读性/性能/去重/边界），每步跑测试确保不回归。</prompt>
        <prompt>请找出本改动的技术债与可简化点，按收益排序并逐项处理。</prompt>
      </stage>
      <stage id="test" label="开发自测" group="开发交付">
        <prompt>请补齐并运行单元/集成测试与类型检查，报告结果、覆盖与风险。</prompt>
        <prompt>请针对关键逻辑与边界条件补测试用例，并说明断言意图。</prompt>
        <prompt>请做一次手工验证清单（正常路径/异常路径/兼容性）。</prompt>
      </stage>
      <stage id="push-merge" label="Push&amp;Merge 代码" group="开发交付">
        <prompt>请把当前改动提交并 push 到当前分支，然后合并（Merge）到目标分支，写清提交信息并跑测试与类型检查。</prompt>
        <prompt>请整理提交历史，必要时拆分原子提交，push 后发起合并并处理冲突。</prompt>
      </stage>
      <stage id="deploy" label="环境部署" group="交付运维">
        <prompt>请给出构建/打包/发布步骤并执行，说明环境变量与回滚方案。</prompt>
        <prompt>请检查部署前后健康检查项与回滚触发条件。</prompt>
      </stage>
      <stage id="troubleshoot" label="问题定位" group="交付运维">
        <prompt>请基于现象做问题定位：收集日志与复现步骤，列出可能原因并按可能性排序，给出验证方法。</prompt>
        <prompt>请用二分/最小化复现定位根因，给出修复方案与回归验证点。</prompt>
      </stage>
    </workflow>

    <workflow id="test" label="测试工作流">
      <stage id="scope" label="测试范围">
        <prompt>请梳理本次改动的影响面，产出测试范围与优先级清单。</prompt>
        <prompt>请识别高风险模块与回归重点，说明依据。</prompt>
      </stage>
      <stage id="cases" label="用例设计">
        <prompt>请针对上述范围设计测试用例（正常/边界/异常/并发）。</prompt>
        <prompt>请补充可自动化的用例优先级与数据构造方式。</prompt>
      </stage>
      <stage id="run" label="执行验证">
        <prompt>请运行测试与类型检查，汇总通过/失败与可疑点。</prompt>
        <prompt>请复现失败用例并给出根因猜测与最小复现步骤。</prompt>
      </stage>
      <stage id="report" label="测试报告">
        <prompt>请输出测试报告：范围、用例、结果、遗留风险与建议。</prompt>
      </stage>
    </workflow>

    <workflow id="doc" label="文档工作流">
      <stage id="scan" label="盘点文档">
        <prompt>请梳理本次改动涉及哪些文档（README/AGENTS/CHANGELOG/API 等）需要更新。</prompt>
      </stage>
      <stage id="write" label="撰写更新">
        <prompt>请用简洁中文更新相关文档（说明、示例、注意事项），覆盖受影响部分。</prompt>
        <prompt>请补充最小可运行示例与常见问题。</prompt>
      </stage>
      <stage id="polish" label="校对润色">
        <prompt>请校对文档的一致性与准确性，修正过时描述与错误链接。</prompt>
      </stage>
    </workflow>
  </workflows>
</devflow>
```

- [ ] **Step 2: 删除旧配置**

```powershell
Remove-Item -LiteralPath config\workflow.xml, config\server.json -ErrorAction SilentlyContinue
```

- [ ] **Step 3: Commit**

```powershell
git add config/devflow.xml
git commit -m 'feat(config): 新增统一配置 config/devflow.xml，迁移 workflow.xml'
```

> 注：`config/server.json` 为未跟踪运行时文件，删除后不入库。

---

## Task 2: `server/devflow-config.js`

**Files:**
- Create: `server/devflow-config.js`
- Test: `server/test/devflow-config.test.js`

- [ ] **Step 1: 写失败测试 `server/test/devflow-config.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultConfigFile, parseDevflowConfig, serializeDevflowConfig,
  loadDevflowConfig, ensureConfigFile, updateServerAttrs, buildDefaultConfig,
} from '../devflow-config.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devcfg-')), 'devflow.xml'); }

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- keep me -->
<devflow>
  <server port="4123" language="en" />
  <agents default="nga">
    <agent id="opencode" name="OpenCode" cmd="opencode" />
    <agent id="nga" name="nga" cmd="nga.cmd" />
  </agents>
  <workflows>
    <workflow id="dev" label="Dev">
      <stage id="design" label="Design" group="G"><prompt>p1</prompt><prompt>p2</prompt></stage>
    </workflow>
  </workflows>
</devflow>`;

test('parseDevflowConfig 解析 server/agents/workflows', () => {
  const c = parseDevflowConfig(SAMPLE);
  assert.equal(c.server.port, 4123);
  assert.equal(c.server.language, 'en');
  assert.equal(c.agents.default, 'nga');
  assert.deepEqual(c.agents.list.map((a) => a.id), ['opencode', 'nga']);
  assert.equal(c.workflows.length, 1);
  assert.equal(c.workflows[0].id, 'dev');
  assert.deepEqual(c.workflows[0].stages[0].prompts, ['p1', 'p2']);
});

test('parseDevflowConfig 非法/缺失回落默认', () => {
  const c = parseDevflowConfig('<devflow><server port="abc" language="fr"/></devflow>');
  assert.equal(c.server.port, buildDefaultConfig().server.port);
  assert.equal(c.server.language, 'zh-CN');
  assert.equal(c.agents.default, 'opencode');
});

test('serialize → parse 往返一致', () => {
  const cfg = buildDefaultConfig();
  const xml = serializeDevflowConfig(cfg);
  const back = parseDevflowConfig(xml);
  assert.equal(back.server.port, cfg.server.port);
  assert.deepEqual(back.agents.list.map((a) => a.id), cfg.agents.list.map((a) => a.id));
  assert.equal(back.workflows[0].id, cfg.workflows[0].id);
});

test('ensureConfigFile 缺失时生成默认，二次不覆盖', () => {
  const f = tmpFile();
  assert.equal(ensureConfigFile(f), true);
  assert.equal(fs.existsSync(f), true);
  assert.equal(ensureConfigFile(f), false);
});

test('updateServerAttrs 就地改属性并保留注释', () => {
  const f = tmpFile();
  fs.writeFileSync(f, SAMPLE, 'utf8');
  const next = updateServerAttrs(f, { port: 5000, language: 'zh-CN' });
  assert.deepEqual(next, { port: 5000, language: 'zh-CN' });
  const xml = fs.readFileSync(f, 'utf8');
  assert.match(xml, /<server port="5000" language="zh-CN" \/>/);
  assert.ok(xml.includes('<!-- keep me -->'), '注释保留');
  assert.ok(xml.includes('nga.cmd'), '其余内容保留');
});

test('loadDevflowConfig 文件缺失返回默认', () => {
  const c = loadDevflowConfig(tmpFile());
  assert.equal(c.server.port, buildDefaultConfig().server.port);
  assert.ok(c.agents.list.length >= 1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/devflow-config.test.js"`
Expected: FAIL —— 无法解析 `../devflow-config.js`

- [ ] **Step 3: 实现 `server/devflow-config.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { normalizeLocale, DEFAULT_LOCALE } from '@devflow/shared/i18n';
import { parseWorkflowXml, fallbackWorkflows } from './workflow-xml.js';

export const DEFAULT_PORT = 3001;
export const DEFAULT_AGENT = 'opencode';
export const DEFAULT_AGENTS = [
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode' },
  { id: 'claudecode', name: 'ClaudeCode', cmd: 'claudecode' },
  { id: 'nga', name: 'nga', cmd: 'nga.cmd' },
];

export function defaultConfigFile(baseDir) {
  return path.join(baseDir, 'config', 'devflow.xml');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1].trim() : '';
}
function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function validPort(n) {
  const p = Number(n);
  return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : null;
}

export function buildDefaultConfig() {
  return {
    server: { port: DEFAULT_PORT, language: DEFAULT_LOCALE },
    agents: { default: DEFAULT_AGENT, list: DEFAULT_AGENTS.map((a) => ({ ...a })) },
    workflows: fallbackWorkflows(),
  };
}

export function parseDevflowConfig(xml) {
  const defaults = buildDefaultConfig();
  const text = String(xml || '');

  const serverTag = (text.match(/<server\b([^>]*?)\/?>/i) || [])[1] || '';
  const port = validPort(attr(serverTag, 'port')) || defaults.server.port;
  const language = normalizeLocale(decode(attr(serverTag, 'language')) || defaults.server.language);

  let list = defaults.agents.list;
  let defAgent = defaults.agents.default;
  const agentsTag = text.match(/<agents\b([^>]*)>([\s\S]*?)<\/agents>/i);
  if (agentsTag) {
    const found = [];
    const re = /<agent\b([^>]*?)\/?>/gi;
    let m;
    while ((m = re.exec(agentsTag[2]))) {
      const id = decode(attr(m[1], 'id'));
      const cmd = decode(attr(m[1], 'cmd'));
      if (id && cmd) found.push({ id, name: decode(attr(m[1], 'name')) || id, cmd });
    }
    if (found.length) list = found;
    const d = decode(attr(agentsTag[1], 'default'));
    defAgent = (d && list.some((a) => a.id === d)) ? d : list[0].id;
  }

  const workflows = parseWorkflowXml(text);
  return {
    server: { port, language },
    agents: { default: defAgent, list },
    workflows: workflows.length ? workflows : fallbackWorkflows(),
  };
}

function serializeWorkflow(w) {
  const stages = (w.stages || []).map((s) => {
    const group = s.group ? ` group="${escXml(s.group)}"` : '';
    const prompts = (s.prompts || []).map((p) => `      <prompt>${escXml(p)}</prompt>`).join('\n');
    return `    <stage id="${escXml(s.id)}" label="${escXml(s.label)}"${group}>\n${prompts}\n    </stage>`;
  }).join('\n');
  return `  <workflow id="${escXml(w.id)}" label="${escXml(w.label)}">\n${stages}\n  </workflow>`;
}

export function serializeDevflowConfig(cfg) {
  const agents = cfg.agents.list
    .map((a) => `    <agent id="${escXml(a.id)}" name="${escXml(a.name)}" cmd="${escXml(a.cmd)}" />`)
    .join('\n');
  const wfs = cfg.workflows.map(serializeWorkflow).join('\n\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DevFlow 统一配置：server（端口/语言）+ agents（默认 Agent 列表）+ workflows（工作流/提示语） -->
<devflow>
  <server port="${cfg.server.port}" language="${escXml(cfg.server.language)}" />

  <agents default="${escXml(cfg.agents.default)}">
${agents}
  </agents>

  <workflows>
${wfs}
  </workflows>
</devflow>
`;
}

export function ensureConfigFile(file) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeDevflowConfig(buildDefaultConfig()), 'utf8');
  return true;
}

export function loadDevflowConfig(file) {
  try {
    if (fs.existsSync(file)) return parseDevflowConfig(fs.readFileSync(file, 'utf8'));
  } catch { /* fallthrough */ }
  return buildDefaultConfig();
}

export function updateServerAttrs(file, patch = {}) {
  ensureConfigFile(file);
  let xml = fs.readFileSync(file, 'utf8');
  const m = xml.match(/<server\b([^>]*?)\s*\/?>/i);
  const cur = m ? m[1] : '';
  const port = patch.port != null ? (validPort(patch.port) || DEFAULT_PORT) : (validPort(attr(cur, 'port')) || DEFAULT_PORT);
  const language = patch.language != null
    ? normalizeLocale(patch.language)
    : normalizeLocale(decode(attr(cur, 'language')) || DEFAULT_LOCALE);
  const tag = `<server port="${port}" language="${language}" />`;
  if (m) xml = xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length);
  else xml = xml.replace(/<devflow(\s*)>/i, `<devflow$1>\n  ${tag}`);
  fs.writeFileSync(file, xml, 'utf8');
  return { port, language };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "server/test/devflow-config.test.js"`
Expected: PASS（6 个测试全过）

- [ ] **Step 5: Commit**

```powershell
git add server/devflow-config.js server/test/devflow-config.test.js
git commit -m 'feat(config): devflow-config 解析/序列化/就地改属性'
```

---

## Task 3: `workflow-xml.js` 指向 devflow.xml

**Files:**
- Modify: `server/workflow-xml.js:63`（`defaultWorkflowFile`）
- Modify: `server/test/workflow-xml.test.js`

- [ ] **Step 1: 改 `defaultWorkflowFile`**

把：

```js
export function defaultWorkflowFile(baseDir) {
  return path.join(baseDir, 'config', 'workflow.xml');
}
```

改为：

```js
export function defaultWorkflowFile(baseDir) {
  return path.join(baseDir, 'config', 'devflow.xml');
}
```

> `parseWorkflowXml` / `loadWorkflowXml` 无需改动：`loadWorkflowXml` 已能对任意 XML 文本提取 `<workflow>`，缺失时返回 `fallbackWorkflows()`。

- [ ] **Step 2: 更新 `server/test/workflow-xml.test.js`**

把「仓库 config/workflow.xml 可解析出 开发/测试/文档」测试改为读 devflow.xml（断言 id 仍含 dev/test/doc）：

```js
test('仓库 config/devflow.xml 可解析出 开发/测试/文档 三个工作流且阶段均有提示语', () => {
  const file = defaultWorkflowFile(path.join(__dirname, '..', '..'));
  const wfs = loadWorkflowXml(file);
  const ids = wfs.map((w) => w.id);
  assert.ok(ids.includes('dev') && ids.includes('test') && ids.includes('doc'), `ids=${ids.join(',')}`);
  for (const w of wfs) {
    for (const s of w.stages) assert.ok(Array.isArray(s.prompts));
  }
});
```

（其余测试不变。）

- [ ] **Step 3: 运行测试**

Run: `node --test "server/test/workflow-xml.test.js"`
Expected: PASS

- [ ] **Step 4: Commit**

```powershell
git add server/workflow-xml.js server/test/workflow-xml.test.js
git commit -m 'feat(config): workflow-xml 默认指向 config/devflow.xml'
```

---

## Task 4: `server/index.js` 接线 + 退役 settings.js

**Files:**
- Modify: `server/index.js:23-35`、`147-190`
- Delete: `server/settings.js`
- Rewrite: `server/test/i18n-settings.test.js`

- [ ] **Step 1: 改 import 与启动段**

把：

```js
import { loadWorkflowXml, defaultWorkflowFile } from './workflow-xml.js';
import { defaultSettingsFile, readSettings, writeSettings } from './settings.js';
```

改为：

```js
import { defaultConfigFile, loadDevflowConfig, ensureConfigFile, updateServerAttrs, DEFAULT_PORT } from './devflow-config.js';
```

把：

```js
const workflowXmlFile = defaultWorkflowFile(path.join(__dirname, '..'));
const settingsFile = defaultSettingsFile(path.join(__dirname, '..'));
setLocale(readSettings(settingsFile).language);
const HOST = process.env.DEVFLOW_HOST || '127.0.0.1';
const PORT = Number(process.env.DEVFLOW_PORT || readSettings(settingsFile).port || 3001);
```

改为：

```js
const configFile = defaultConfigFile(path.join(__dirname, '..'));
ensureConfigFile(configFile);
const HOST = process.env.DEVFLOW_HOST || '127.0.0.1';
const PORT = Number(process.env.DEVFLOW_PORT || loadDevflowConfig(configFile).server.port || DEFAULT_PORT);
setLocale(loadDevflowConfig(configFile).server.language);
```

- [ ] **Step 2: 替换 `/api/workflows-xml` 与 `/api/settings*`，新增 `/api/agents`**

把 `if (url.pathname === '/api/workflows-xml' ...)` 整块改为：

```js
  if (url.pathname === '/api/workflows-xml' && req.method === 'GET') {
    const workflows = loadDevflowConfig(configFile).workflows;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ workflows }));
    return;
  }
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const c = loadDevflowConfig(configFile);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ default: c.agents.default, agents: c.agents.list }));
    return;
  }
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    const s = loadDevflowConfig(configFile).server;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ settings: s, envPort: process.env.DEVFLOW_PORT || null, currentPort: PORT }));
    return;
  }
```

把 `/api/settings` POST 与 `/api/settings/language` POST 里的 `readSettings/writeSettings` 调用替换：

```js
      if (!port || port < 1 || port > 65535) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid port' })); return; }
      const next = updateServerAttrs(configFile, { port });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ settings: next, needRestart: true }));
```

```js
      updateServerAttrs(configFile, { language: body.language });
      setLocale(body.language);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ language: body.language }));
```

- [ ] **Step 3: 删除 `server/settings.js`**

```powershell
Remove-Item -LiteralPath server\settings.js
```

- [ ] **Step 4: 重写 `server/test/i18n-settings.test.js` 为 devflow-config 版**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDevflowConfig, updateServerAttrs } from '../devflow-config.js';
import { t, setLocale, getLocale } from '../i18n.js';

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devcfg-lang-')), 'devflow.xml'); }

test('devflow.xml 默认 language=zh-CN', () => {
  assert.equal(loadDevflowConfig(tmpFile()).server.language, 'zh-CN');
});

test('updateServerAttrs 持久化 language 并可按 port 合并', () => {
  const f = tmpFile();
  updateServerAttrs(f, { language: 'en' });
  assert.equal(loadDevflowConfig(f).server.language, 'en');
  updateServerAttrs(f, { port: 4100 });
  const s = loadDevflowConfig(f).server;
  assert.equal(s.port, 4100);
  assert.equal(s.language, 'en', '改 port 不丢 language');
});

test('server i18n：setLocale 切换并按语言翻译', () => {
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('nav.explorer'), 'Explorer');
  setLocale('zh-CN');
  assert.equal(t('nav.explorer'), '目录');
  setLocale('zh-TW');
  assert.equal(getLocale(), 'zh-CN');
});
```

- [ ] **Step 5: 运行 server 测试**

Run: `npm.cmd run test:server`
Expected: PASS（全绿）

- [ ] **Step 6: Commit**

```powershell
git add server/index.js server/test/i18n-settings.test.js
git rm --cached server/settings.js 2>$null; Remove-Item -LiteralPath server\settings.js -ErrorAction SilentlyContinue
git add -A server
git commit -m 'feat(config): index 接线 devflow-config，退役 settings.js'
```

> 若 `git rm --cached` 报错（文件已删），忽略即可；确保暂存删除记录。

---

## Task 5: 协作邀请链接默认 origin 用配置端口

**Files:**
- Modify: `server/collaboration/http-mount.js`（`groups/:id/invite-link` 路由）

- [ ] **Step 1: 改默认 origin**

把：

```js
        const origin = (typeof body.origin === 'string' && body.origin) ? body.origin.replace(/\/+$/, '') : 'http://127.0.0.1:3001';
```

改为：

```js
        const origin = (typeof body.origin === 'string' && body.origin) ? body.origin.replace(/\/+$/, '') : `http://127.0.0.1:${engine.pub.port || 3001}`;
```

- [ ] **Step 2: 运行协作测试**

Run: `node --test "server/test/collab-http.test.js"`
Expected: PASS

- [ ] **Step 3: Commit**

```powershell
git add server/collaboration/http-mount.js
git commit -m 'feat(config): 邀请链接默认 origin 用当前配置端口'
```

---

## Task 6: Web 从 `/api/agents` 加载 Agent 列表

**Files:**
- Modify: `web/src/components/TerminalView.vue`
- Modify: `web/vite.config.ts`

- [ ] **Step 1: TerminalView：最小兜底 + 默认引用 + loadAgents**

把：

```ts
const DEFAULT_AGENTS: AgentDef[] = [
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode' },
  { id: 'claudecode', name: 'ClaudeCode', cmd: 'claudecode' },
  { id: 'nga', name: 'nga', cmd: 'nga.cmd' },
];
const agentSid = ref<string | null>(null);
const agents = ref<AgentDef[]>(DEFAULT_AGENTS.map((a) => ({ ...a })));
const agentId = ref('opencode');
```

改为：

```ts
// 仅作接口不可达时的最小兜底；正式列表来自 config/devflow.xml（GET /api/agents）
const DEFAULT_AGENTS: AgentDef[] = [{ id: 'opencode', name: 'OpenCode', cmd: 'opencode' }];
const agentSid = ref<string | null>(null);
const defaultAgents = ref<AgentDef[]>(DEFAULT_AGENTS.map((a) => ({ ...a })));
const defaultAgentId = ref('opencode');
const agents = ref<AgentDef[]>(DEFAULT_AGENTS.map((a) => ({ ...a })));
const agentId = ref('opencode');
async function loadAgents() {
  try {
    const r = await fetch('/api/agents').then((x) => x.json());
    const list = Array.isArray(r?.agents)
      ? r.agents.filter((a: any) => a && typeof a.id === 'string' && typeof a.cmd === 'string')
      : [];
    if (!list.length) return;
    defaultAgents.value = list.map((a: any) => ({ id: a.id, name: a.name || a.id, cmd: a.cmd }));
    defaultAgentId.value = (typeof r.default === 'string' && defaultAgents.value.some((a) => a.id === r.default))
      ? r.default : defaultAgents.value[0].id;
    agents.value = defaultAgents.value.map((a) => ({ ...a }));
    agentId.value = defaultAgentId.value;
  } catch { /* 保留最小兜底 */ }
}
```

- [ ] **Step 2: `resetCfg` 用默认引用**

把：

```ts
function resetCfg() {
  agents.value = DEFAULT_AGENTS.map((a) => ({ ...a }));
  agentId.value = 'opencode';
  wfKind.value = 'dev';
  wfCmds.value = { dev: '/dev', test: '/test', doc: '/doc' };
}
```

改为：

```ts
function resetCfg() {
  agents.value = defaultAgents.value.map((a) => ({ ...a }));
  agentId.value = defaultAgentId.value;
  wfKind.value = 'dev';
  wfCmds.value = { dev: '/dev', test: '/test', doc: '/doc' };
}
```

- [ ] **Step 3: onMounted 先加载 agents 再 loadCfg**

把：

```ts
  loadCfg();
  cfgLoaded = true;
  loadWorkflows();
```

改为：

```ts
  await loadAgents();
  loadCfg();           // 本地已保存配置优先覆盖 API 默认
  cfgLoaded = true;
  loadWorkflows();
```

- [ ] **Step 4: `vite.config.ts` 代理端口读配置**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function configPort(): number {
  try {
    const xml = fs.readFileSync(path.join(__dirname, '..', 'config', 'devflow.xml'), 'utf8');
    const m = xml.match(/<server\b[^>]*\bport\s*=\s*"(\d+)"/i);
    if (m) return Number(m[1]);
  } catch { /* ignore */ }
  return 3001;
}
const PORT = Number(process.env.DEVFLOW_PORT || configPort());

export default defineConfig({
  plugins: [vue()],
  server: {
    watch: { ignored: ['**/*.tmp', '**/node_modules/**'] },
    proxy: {
      '/api': { target: `http://127.0.0.1:${PORT}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${PORT}`, ws: true },
    },
  },
  build: { outDir: 'dist' },
});
```

- [ ] **Step 5: 类型检查 + web 测试**

Run: `npm.cmd run typecheck`
Expected: PASS
Run: `npm.cmd run test:web`
Expected: PASS

- [ ] **Step 6: Commit**

```powershell
git add web/src/components/TerminalView.vue web/vite.config.ts
git commit -m 'feat(config): web 从 /api/agents 加载 Agent；dev 代理端口读配置'
```

---

## Task 7: 打包含 config，start.bat 端口读配置

**Files:**
- Modify: `scripts/build.js`

- [ ] **Step 1: 读配置端口常量**

在 `const noZip = ...` 之后加：

```js
const CFG_PORT = (() => {
  try {
    const xml = fs.readFileSync(path.join(ROOT, "config", "devflow.xml"), "utf8");
    const m = xml.match(/<server\b[^>]*\bport\s*=\s*"(\d+)"/i);
    return m ? m[1] : "3001";
  } catch { return "3001"; }
})();
```

- [ ] **Step 2: 复制 config 到产物**

在 `cpDir(path.join(ROOT, "web", "dist"), path.join(APP, "web", "dist"));` 之后加：

```js
cpDir(path.join(ROOT, "config"), path.join(APP, "config"));
```

- [ ] **Step 3: start.bat / 说明用 CFG_PORT**

把 bat 数组里的 `http://127.0.0.1:3001` 与 usage 里的对应 URL 改为 `` `http://127.0.0.1:${CFG_PORT}` ``（模板字符串）。例如：

```js
  "echo Devflow Terminal 启动中：http://127.0.0.1:" + CFG_PORT,
  ...
  'start "" "http://127.0.0.1:' + CFG_PORT + '"',
```

usage：

```js
  "启动：双击 start.bat（自动打开 http://127.0.0.1:" + CFG_PORT + "）",
```

并在 usage 末尾补一行：

```js
  "端口/Agent/工作流配置：编辑 config/devflow.xml 后重启",
```

- [ ] **Step 4: 产物校验加 config 项**

在 `entries` 数组加一行：

```js
  ["config", "config/devflow.xml"],
```

- [ ] **Step 5: 构建前端并打绿色包**

Run: `npm.cmd run build:web`
Run: `npm.cmd run build:portable`
Expected: 校验输出含 `ok config  (config/devflow.xml)`；产物目录存在 `config/devflow.xml`

- [ ] **Step 6: Commit**

```powershell
git add scripts/build.js
git commit -m 'feat(config): 绿色包携带 config/devflow.xml，start.bat 端口读配置'
```

---

## Task 8: AGENTS.md 说明 + 最终验证

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 在「目录速览」后加配置说明**

```markdown
## 配置（统一 XML）
- 唯一配置文件：`config/devflow.xml`（`<server port language/>` + `<agents default>` + `<workflows>`）。
- 端口/语言可在 UI 设置面板修改，服务端会**就地改写** `<server>` 属性；Agent 列表与工作流提示语直接编辑 XML。
- 改 `config/devflow.xml` 后需**重启后端**（dev:server 的 `--watch` 不监听 xml）。
- 环境变量 `DEVFLOW_PORT` 优先于 XML 的 `port`。
- `config/server.json`、`config/workflow.xml` 已废弃。
```

- [ ] **Step 2: 全量验证**

Run: `npm.cmd test`
Expected: 196+ server 与 50 web 测试全绿
Run: `npm.cmd run typecheck`
Expected: PASS
Run: `npm.cmd run check:i18n`
Expected: 未发现中文命中

- [ ] **Step 3: Commit**

```powershell
git add AGENTS.md
git commit -m 'docs(agents): 统一 XML 配置说明'
```

---

## Self-Review 记录

- **Spec 覆盖**：单 XML 格式→Task 1；解析/序列化/就地改属性/缺失生成→Task 2；workflow 解析入口→Task 3；index 接线+端点（settings/language/agents/workflows）→Task 4；邀请链接端口→Task 5；web 动态 Agent + dev 代理端口→Task 6；打包携带 config + start.bat 端口→Task 7；AGENTS 说明+验收→Task 8。
- **占位符扫描**：无 TBD/TODO，所有代码步骤给出完整代码。
- **一致性**：`defaultConfigFile/loadDevflowConfig/ensureConfigFile/updateServerAttrs/buildDefaultConfig/buildDefaultConfig.serializeDevflowConfig` 命名贯穿 Task 2/3/4；`/api/agents` 返回 `{ default, agents:[{id,name,cmd}] }` 与前端 `loadAgents` 一致；`updateServerAttrs` 返回 `{ port, language }` 与 GET `/api/settings` 的 `settings` 形状一致。
- **回归风险**：默认端口仍 3001、默认语言 zh-CN、默认 agents 含 opencode/claudecode/nga，行为与现状等价；`config/devflow.xml` 迁入原 workflow.xml 全部内容，工作流不变。
