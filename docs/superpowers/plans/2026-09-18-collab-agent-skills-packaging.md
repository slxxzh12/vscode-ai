# 协作页签按 agent 选择 skills 目录并打包共享 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在协作页签的打包对话框里列出所有 agent 及其 skills 目录，用户选一个作为打包源/安装目标，共享流程不变。

**Architecture:** 新增 `server/collaboration/agent-skills.js` 承担 agent→目录映射；`store.tool` 由 `{kind}` 迁到 `{agentId, customRoot}`；`engine.skillRoot()` 改为按所选 agent 解析，`getToolInfo`/`setTool` 返回并接受 agent 选择；前端 `SkillDistributor.vue` 顶部加选择器。

**Tech Stack:** Node ESM + node:test（server）、Vue3 + TypeScript + vitest + @vue/test-utils（web）、i18n（`shared/i18n`）。

**参考 spec:** `docs/superpowers/specs/2026-09-18-collab-agent-skills-packaging-design.md`

> **提交纪律（AGENTS.md）**：本仓库要求「未经用户明确同意不提交」。执行本计划时，每个 commit 步骤前先征求用户同意，并按 `docs/learn/git仓库提交检查和提交事项.md` 自查（尤其敏感信息扫描）。若用户不同意，跳过 commit 继续下一步，最后统一处理。

---

## 文件结构

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `server/collaboration/agent-skills.js` | 新建 | agent → skills 目录映射、可选 agent 列表、根目录解析 |
| `server/test/agent-skills.test.js` | 新建 | 上述模块单测 |
| `server/devflow-config.js` | 修改 | `<agent>` 解析/序列化 `skillsDir` 属性 |
| `server/test/devflow-config.test.js` | 修改 | 增加 skillsDir 往返测试 |
| `server/collaboration/store.js` | 修改 | `tool` 结构迁移到 `agentId` |
| `server/test/collab-store.test.js` | 修改 | 增加 tool 迁移测试 |
| `server/collaboration/engine.js` | 修改 | `getAgents` 注入、`skillRoot`/`getToolInfo`/`setTool` |
| `server/test/collab-engine.test.js` | 修改 | 更新 `setTool` 调用签名 |
| `server/index.js` | 修改 | 传 `getAgents` 回调 |
| `server/collaboration/http-mount.js` | 修改 | `POST /api/collab/tool` 接受 `agentId` |
| `server/test/collab-http.test.js` | 修改 | `/tool` GET/POST 测试 |
| `web/src/collaboration/useCollab.ts` | 修改 | `getTool` 类型 + `setTool(agentId, customRoot?)` |
| `web/src/collaboration/SkillDistributor.vue` | 修改 | agent 选择器 UI |
| `web/src/collaboration/SkillDistributor.test.ts` | 新建 | 选择器组件测试 |
| `shared/i18n/zh-CN.js` | 修改 | 新词条 |
| `shared/i18n/en.js` | 修改 | 新词条 |

---

## Task 1: agent → skills 目录映射模块

**Files:**
- Create: `server/collaboration/agent-skills.js`
- Test: `server/test/agent-skills.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/agent-skills.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { agentSkillsDir, listAgentOptions, resolveSkillRoot } from '../collaboration/agent-skills.js';

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
  }
}

test('opencode 映射到 opencode 配置根下的 skills（尊重 DEVFLOW_OPENCODE_CONFIG）', () => {
  withEnv('DEVFLOW_COLLAB_SKILLS', undefined, () => {
    const cfg = path.join(os.tmpdir(), 'df-oc-cfg');
    withEnv('DEVFLOW_OPENCODE_CONFIG', cfg, () => {
      assert.equal(agentSkillsDir({ id: 'opencode', cmd: 'opencode' }), path.join(cfg, 'skills'));
    });
  });
});

test('DEVFLOW_COLLAB_SKILLS 覆盖 opencode skills 根', () => {
  const override = path.join(os.tmpdir(), 'df-collab-skills');
  withEnv('DEVFLOW_COLLAB_SKILLS', override, () => {
    assert.equal(agentSkillsDir({ id: 'opencode', cmd: 'opencode' }), override);
  });
});

test('claudecode 映射到 ~/.claude/skills', () => {
  assert.equal(agentSkillsDir({ id: 'claudecode', cmd: 'claudecode' }), path.join(os.homedir(), '.claude', 'skills'));
});

test('未知 agent：有 skillsDir 用配置，没有则 null', () => {
  const dir = path.join(os.tmpdir(), 'nga-skills');
  assert.equal(agentSkillsDir({ id: 'nga', cmd: 'nga.cmd', skillsDir: dir }), path.resolve(dir));
  assert.equal(agentSkillsDir({ id: 'nga', cmd: 'nga.cmd' }), null);
});

test('listAgentOptions 标记 selectable/exists/selected', () => {
  const dir = path.join(os.tmpdir(), 'df-oc-cfg2');
  withEnv('DEVFLOW_OPENCODE_CONFIG', dir, () => {
    withEnv('DEVFLOW_COLLAB_SKILLS', undefined, () => {
      const out = listAgentOptions({
        agents: [
          { id: 'opencode', name: 'OpenCode', cmd: 'opencode' },
          { id: 'nga', name: 'nga', cmd: 'nga.cmd' },
        ],
        selected: 'opencode',
      });
      assert.equal(out.length, 2);
      assert.equal(out[0].skillsDir, path.join(dir, 'skills'));
      assert.equal(out[0].selectable, true);
      assert.equal(out[0].exists, false, '目录尚未创建');
      assert.equal(out[0].selected, true);
      assert.equal(out[1].skillsDir, null);
      assert.equal(out[1].selectable, false);
    });
  });
});

test('resolveSkillRoot：agent / custom / 兜底', () => {
  const agents = [{ id: 'claudecode', name: 'ClaudeCode', cmd: 'claudecode' }];
  const fallback = path.join(os.tmpdir(), 'fallback-skills');
  assert.equal(resolveSkillRoot({ selected: 'claudecode', agents }), path.join(os.homedir(), '.claude', 'skills'));
  const custom = path.join(os.tmpdir(), 'my-skills');
  assert.equal(resolveSkillRoot({ selected: 'custom', customRoot: custom, agents }), path.resolve(custom));
  assert.equal(resolveSkillRoot({ selected: 'custom', customRoot: '', agents, defaultSkillsRoot: fallback }), fallback);
  assert.equal(resolveSkillRoot({ selected: 'nope', agents, defaultSkillsRoot: fallback }), fallback);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/agent-skills.test.js"`
Expected: FAIL — `Cannot find module '../collaboration/agent-skills.js'`

- [ ] **Step 3: 实现模块**

创建 `server/collaboration/agent-skills.js`：

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { opencodeConfigDir } from '../llm-config.js';

// agent 的 skills 目录：内置映射（opencode/claudecode）+ skillsDir 配置覆盖；无法确定返回 null（不可选）
export function agentSkillsDir(agent) {
  const id = String(agent?.id || '').toLowerCase();
  const cmd = path.basename(String(agent?.cmd || '')).toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/, '');
  if (id === 'opencode' || cmd === 'opencode') {
    return process.env.DEVFLOW_COLLAB_SKILLS || path.join(opencodeConfigDir(), 'skills');
  }
  if (id === 'claudecode' || cmd === 'claudecode') {
    return path.join(os.homedir(), '.claude', 'skills');
  }
  const custom = agent?.skillsDir && String(agent.skillsDir).trim();
  return custom ? path.resolve(custom) : null;
}

// 供 UI 展示的 agent 选项（含目录是否存在、是否可选）
export function listAgentOptions({ agents = [], selected = null } = {}) {
  return agents.map((a) => {
    const skillsDir = agentSkillsDir(a);
    return {
      id: a.id,
      name: a.name || a.id,
      cmd: a.cmd || '',
      skillsDir,
      exists: !!(skillsDir && fs.existsSync(skillsDir)),
      selectable: !!skillsDir,
      selected: a.id === selected,
    };
  });
}

// 由选择解析实际 skills 根：custom → 手填；agent → 映射；否则兜底默认根
export function resolveSkillRoot({ selected, customRoot, agents = [], defaultSkillsRoot = null } = {}) {
  if (selected === 'custom') {
    const r = customRoot && String(customRoot).trim();
    return r ? path.resolve(r) : defaultSkillsRoot;
  }
  const agent = agents.find((a) => a.id === selected);
  const dir = agent ? agentSkillsDir(agent) : null;
  return dir || defaultSkillsRoot;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/agent-skills.test.js"`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/agent-skills.js server/test/agent-skills.test.js
git commit -m "feat(collab): add agent skills directory resolver"
```

---

## Task 2: devflow.xml 支持 `<agent skillsDir>`

**Files:**
- Modify: `server/devflow-config.js:44-68`（parse）、`server/devflow-config.js:78-87`（serialize）
- Test: `server/test/devflow-config.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/devflow-config.test.js` 末尾追加：

```js
test('parse/serialize 支持 agent skillsDir 属性', () => {
  const xml = `<devflow>
  <agents default="nga">
    <agent id="nga" name="nga" cmd="nga.cmd" skillsDir="/opt/nga/skills" />
  </agents>
</devflow>`;
  const c = parseDevflowConfig(xml);
  assert.equal(c.agents.list[0].skillsDir, '/opt/nga/skills');
  const out = serializeDevflowConfig({ ...buildDefaultConfig(), agents: c.agents });
  assert.match(out, /skillsDir="\/opt\/nga\/skills"/);
  const back = parseDevflowConfig(out);
  assert.equal(back.agents.list[0].skillsDir, '/opt/nga/skills');
});

test('serialize 未配置 skillsDir 时不输出该属性', () => {
  const out = serializeDevflowConfig(buildDefaultConfig());
  assert.doesNotMatch(out, /skillsDir=/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/devflow-config.test.js"`
Expected: FAIL — `c.agents.list[0].skillsDir` 为 `undefined`

- [ ] **Step 3: 实现解析与序列化**

修改 `server/devflow-config.js`。在 `parseDevflowConfig` 的 agent 循环里（当前 55-62 行），加入 `skillsDir`：

```js
      if (id && cmd) {
        const agent = { id, name: decode(attr(m[1], 'name')) || id, cmd };
        const resumeCmd = decode(attr(m[1], 'resumeCmd'));
        const resumeDiscover = decode(attr(m[1], 'resumeDiscover'));
        const statsCmd = decode(attr(m[1], 'statsCmd'));
        const skillsDir = decode(attr(m[1], 'skillsDir'));
        if (resumeCmd) agent.resumeCmd = resumeCmd;
        if (resumeDiscover) agent.resumeDiscover = resumeDiscover;
        if (statsCmd) agent.statsCmd = statsCmd;
        if (skillsDir) agent.skillsDir = skillsDir;
        found.push(agent);
      }
```

修改 `serializeDevflowConfig` 的 agent 映射（当前 80-85 行）：

```js
      if (a.statsCmd) attrs.push(`statsCmd="${escXml(a.statsCmd)}"`);
      if (a.skillsDir) attrs.push(`skillsDir="${escXml(a.skillsDir)}"`);
      return `    <agent ${attrs.join(' ')} />`;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/devflow-config.test.js"`
Expected: PASS（含新增 2 个）

- [ ] **Step 5: Commit**

```bash
git add server/devflow-config.js server/test/devflow-config.test.js
git commit -m "feat(config): support per-agent skillsDir attribute"
```

---

## Task 3: store tool 结构迁移到 agentId

**Files:**
- Modify: `server/collaboration/store.js:15`（defaultData）、`server/collaboration/store.js:110-112`（getTool/setTool）
- Test: `server/test/collab-store.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-store.test.js` 末尾追加：

```js
test('tool 迁移：旧 kind → agentId，custom 保留 customRoot', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ tool: { kind: 'claudecode', customRoot: null } }));
  const s = new CollabStore({ file: f });
  assert.deepEqual(s.getTool(), { agentId: 'claudecode', customRoot: null });
  assert.equal(s.data.tool.kind, undefined);

  const f2 = tmpFile();
  fs.writeFileSync(f2, JSON.stringify({ tool: { kind: 'custom', customRoot: '/x/y' } }));
  const s2 = new CollabStore({ file: f2 });
  assert.deepEqual(s2.getTool(), { agentId: 'custom', customRoot: '/x/y' });
});

test('空文件 tool 默认为 null，setTool 落盘可回读', () => {
  const f = tmpFile();
  const s = new CollabStore({ file: f });
  assert.equal(s.getTool(), null);
  s.setTool({ agentId: 'opencode', customRoot: null });
  const s2 = new CollabStore({ file: f });
  assert.deepEqual(s2.getTool(), { agentId: 'opencode', customRoot: null });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-store.test.js"`
Expected: FAIL — `getTool()` 仍返回 `{kind:...}` / `data.tool` 为默认对象

- [ ] **Step 3: 实现迁移**

修改 `server/collaboration/store.js`。

第 15 行改为：

```js
    tool: null,          // 我的开发工具：{ agentId: '<agent id>' | 'custom', customRoot }
```

在 `_load()` 的 `return data;` 之前（第 45 行 `}` 循环之后）加入幂等迁移：

```js
        // 旧结构 tool.kind → tool.agentId（幂等）
        if (data.tool && typeof data.tool === 'object' && data.tool.agentId === undefined && data.tool.kind !== undefined) {
          data.tool = { agentId: data.tool.kind, customRoot: data.tool.customRoot || null };
        }
```

第 110-112 行改为：

```js
  // 我的开发工具（未选择返回 null，由 engine 兜底默认 agent）
  getTool() { return this.data.tool || null; }
  setTool(tool) { this.data.tool = { agentId: 'opencode', customRoot: null, ...tool }; this.save(); return this.data.tool; }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-store.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/store.js server/test/collab-store.test.js
git commit -m "refactor(collab): migrate tool store to agentId"
```

---

## Task 4: engine 按 agent 解析 skillRoot 并扩展 tool API

**Files:**
- Modify: `server/collaboration/engine.js`（constructor 50、imports 顶部、skillRoot/getToolInfo/setTool 73-87）
- Test: `server/test/collab-engine.test.js:104-105`

- [ ] **Step 1: 更新既有测试调用签名（会先失败）**

修改 `server/test/collab-engine.test.js` 第 104-105 行：

```js
    assert.equal(A.setTool({ agentId: 'custom', customRoot: customA }).root, customA);
    assert.equal(B.setTool({ agentId: 'custom', customRoot: customB }).root, customB);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-engine.test.js"`
Expected: FAIL — `setTool` 收到对象但旧实现按字符串处理，`.root` 不是 `customA`

- [ ] **Step 3: 实现 engine 改动**

修改 `server/collaboration/engine.js`。

顶部 import（第 22 行 `import { t } from '../i18n.js';` 之后）加入：

```js
import { agentSkillsDir, listAgentOptions, resolveSkillRoot } from './agent-skills.js';
```

constructor 签名（第 50 行）在 `mergeWorkflows = null` 后加入 `getAgents = null`：

```js
  constructor({ store, identity, events = null, peer = null, peers = null, seedStore = null, collabDb = null, taskStore = null, downloadStore = null, syncStore = null, skillsRoot = null, inboxDir = null, uploadDir = null, downloadDir = null, downloadsDir = null, runner = null, logger = console, getWorkflows = null, mergeWorkflows = null, getAgents = null }) {
```

在 constructor 内 `this.getWorkflows = ...` 附近加入：

```js
    this.getAgents = typeof getAgents === 'function' ? getAgents : null;   // 返回 { default, list }
```

将第 73-87 行（`skillRoot`/`getToolInfo`/`setTool`）整体替换为：

```js
  // 当前生效的工具选择（未选择时兜底 devflow 默认 agent）
  effectiveTool() {
    const tool = this.store.getTool() || {};
    const cfg = this.getAgents ? this.getAgents() : null;
    return { agentId: tool.agentId || cfg?.default || 'opencode', customRoot: tool.customRoot || null };
  }
  // 本机选定的 agent → 技能根目录（分发打包源 & 安装目标）
  skillRoot() {
    const cfg = this.getAgents ? this.getAgents() : null;
    const tool = this.effectiveTool();
    return resolveSkillRoot({
      selected: tool.agentId,
      customRoot: tool.customRoot,
      agents: cfg?.list || [],
      defaultSkillsRoot: this.skillDefaultRoot,
    });
  }
  getToolInfo() {
    const cfg = this.getAgents ? this.getAgents() : null;
    const tool = this.effectiveTool();
    return {
      tool,
      root: this.skillRoot(),
      selected: tool.agentId,
      agents: listAgentOptions({ agents: cfg?.list || [], selected: tool.agentId }),
    };
  }
  setTool({ agentId, customRoot } = {}) {
    const cfg = this.getAgents ? this.getAgents() : null;
    const list = cfg?.list || [];
    if (agentId === 'custom') {
      const root = customRoot && String(customRoot).trim();
      if (!root) return { code: 'need-custom-root' };
      this.store.setTool({ agentId: 'custom', customRoot: root });
      this._emit('synced', {});
      return { code: 'ok', ...this.getToolInfo() };
    }
    const agent = list.find((a) => a.id === agentId);
    if (!agent) return { code: 'unknown-agent' };
    if (!agentSkillsDir(agent)) return { code: 'agent-unavailable' };
    this.store.setTool({ agentId, customRoot: null });
    this._emit('synced', {});
    return { code: 'ok', ...this.getToolInfo() };
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-engine.test.js"`
Expected: PASS

- [ ] **Step 5: 跑全部 server 测试确认无回归**

Run: `npm.cmd test:server`
Expected: 全部 PASS（尤其 `collab-http`、`collab-dist-accept`、`collab-skills`）

- [ ] **Step 6: Commit**

```bash
git add server/collaboration/engine.js server/test/collab-engine.test.js
git commit -m "feat(collab): resolve skill root from selected agent"
```

---

## Task 5: index.js 注入 getAgents

**Files:**
- Modify: `server/index.js:294-315`

- [ ] **Step 1: 加入回调**

在 `server/index.js` 的 `new CollabEngine({ ... })` 配置里，`getWorkflows` 一行（当前 310 行）之后加入：

```js
    getAgents: () => loadDevflowConfig(configFile).agents,
```

- [ ] **Step 2: 跑 server 测试**

Run: `npm.cmd test:server`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(collab): wire agent list into collab engine"
```

---

## Task 6: HTTP /api/collab/tool 接受 agentId

**Files:**
- Modify: `server/collaboration/http-mount.js:145-151`
- Test: `server/test/collab-http.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-http.test.js` 末尾追加：

```js
test('/tool GET 返回 agents 列表；POST 切 agent / 未知 agent 400', async () => {
  const dir = tmp();
  const skillsRoot = path.join(dir, 'skills');
  fs.mkdirSync(skillsRoot, { recursive: true });
  const store = new CollabStore({ file: path.join(dir, 'collab.json') });
  const identity = loadIdentity({ file: path.join(dir, 'identity.json'), username: 'tool', host: '127.0.0.1', port: 0 });
  const engine = new CollabEngine({
    store, identity, skillsRoot,
    getAgents: () => ({
      default: 'opencode',
      list: [
        { id: 'opencode', name: 'OpenCode', cmd: 'opencode' },
        { id: 'claudecode', name: 'ClaudeCode', cmd: 'claudecode' },
      ],
    }),
  });
  const mount = createCollabMount({ engine, logger: console });
  const server = http.createServer((req, res) => mount(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const got = await fetch(`http://127.0.0.1:${port}/api/collab/tool`).then((r) => r.json());
    assert.equal(got.selected, 'opencode');
    assert.equal(got.agents.length, 2);
    assert.ok(got.agents[0].skillsDir);

    const ok = await post(`http://127.0.0.1:${port}/api/collab/tool`, { agentId: 'claudecode' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.selected, 'claudecode');

    const bad = await post(`http://127.0.0.1:${port}/api/collab/tool`, { agentId: 'nope' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.error, '返回本地化错误文案');

    const needRoot = await post(`http://127.0.0.1:${port}/api/collab/tool`, { agentId: 'custom', customRoot: '' });
    assert.equal(needRoot.status, 400);
  } finally { server.close(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-http.test.js"`
Expected: FAIL — `got.selected` 为 `undefined`（旧 `/tool` 返回 `{tool,root}`）

- [ ] **Step 3: 实现路由**

修改 `server/collaboration/http-mount.js` 第 145-151 行：

```js
      // 我的开发工具/agent（决定技能目录）
      if (seg[0] === 'tool' && m === 'GET') return ok(res, engine.getToolInfo());
      if (seg[0] === 'tool' && m === 'POST') {
        const r = engine.setTool({ agentId: body.agentId || body.kind, customRoot: body.customRoot });
        if (r.code !== 'ok') {
          const msg = r.code === 'need-custom-root' ? t('collab.err.need_custom_root')
            : r.code === 'agent-unavailable' ? t('collab.err.agent_unavailable')
              : r.code === 'unknown-agent' ? t('collab.err.unknown_agent')
                : r.code;
          return sendJson(res, 400, { error: msg });
        }
        return ok(res, r);
      }
```

注意：`error` 返回的是 `t(...)` 本地化文案，不是 code，因此测试断言 `assert.ok(bad.body.error)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-http.test.js"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/collaboration/http-mount.js server/test/collab-http.test.js
git commit -m "feat(collab): accept agentId on tool endpoint"
```

---

## Task 7: 前端 useCollab 类型与 setTool 签名

**Files:**
- Modify: `web/src/collaboration/useCollab.ts:117-118`

- [ ] **Step 1: 修改类型与签名**

将 `web/src/collaboration/useCollab.ts` 第 117-118 行替换为：

```ts
    getTool: () => http<{
      tool: { agentId: string; customRoot: string | null };
      root: string;
      selected: string;
      agents: { id: string; name: string; cmd: string; skillsDir: string | null; exists: boolean; selectable: boolean; selected: boolean }[];
    }>('/api/collab/tool'),
    setTool: (agentId: string, customRoot?: string | null) => post<{
      code: string;
      root: string;
      selected: string;
      tool: { agentId: string; customRoot: string | null };
      agents: { id: string; name: string; cmd: string; skillsDir: string | null; exists: boolean; selectable: boolean; selected: boolean }[];
    }>('/api/collab/tool', { agentId, customRoot: customRoot ?? null }),
```

- [ ] **Step 2: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过（`useCollab.test.ts` 的 `setTool('opencode')` 仍合法）

- [ ] **Step 3: Commit**

```bash
git add web/src/collaboration/useCollab.ts
git commit -m "feat(web): type collab tool endpoint with agent options"
```

---

## Task 8: SkillDistributor 选择器 UI

**Files:**
- Modify: `web/src/collaboration/SkillDistributor.vue`
- Test: `web/src/collaboration/SkillDistributor.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/collaboration/SkillDistributor.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import SkillDistributor from './SkillDistributor.vue';
import { EMPTY_SNAPSHOT } from './types';

const AGENTS = [
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode', skillsDir: '/home/u/.config/opencode/skills', exists: true, selectable: true, selected: true },
  { id: 'claudecode', name: 'ClaudeCode', cmd: 'claudecode', skillsDir: '/home/u/.claude/skills', exists: false, selectable: true, selected: false },
];

function mockCollab() {
  const setTool = vi.fn(async (agentId: string) => ({
    code: 'ok',
    root: AGENTS.find((a) => a.id === agentId)?.skillsDir || '',
    selected: agentId,
    agents: AGENTS.map((a) => ({ ...a, selected: a.id === agentId })),
    tool: { agentId, customRoot: null },
  }));
  const getAssets = vi.fn(async () => ({ skills: [{ name: 's1' }], command: [], agent: [], workflow: [] }));
  return {
    state: { value: { ...EMPTY_SNAPSHOT, groups: [] } },
    getTool: vi.fn(async () => ({ tool: { agentId: 'opencode', customRoot: null }, root: AGENTS[0].skillsDir, selected: 'opencode', agents: AGENTS })),
    setTool,
    getAssets,
    getWorkflowSeed: vi.fn(async () => ({ version: 1, workflows: [] })),
    buildPackage: vi.fn(),
    publishPackage: vi.fn(),
  };
}

function mount(collab: any) {
  return mountC(SkillDistributor, {
    props: { collab, groupId: 'g1', focus: 'skills', open: true },
    global: {
      plugins: [ElementPlus],
      stubs: { teleport: true, 'el-dialog': { template: '<div><slot /></div>' } },
    },
  });
}

afterEach(() => { localStorage.clear(); });

describe('SkillDistributor agent selector', () => {
  it('列出各 agent 及其 skills 目录', async () => {
    const w = mount(mockCollab());
    await flushPromises();
    const txt = w.text();
    expect(txt).toContain('OpenCode');
    expect(txt).toContain('/home/u/.config/opencode/skills');
    expect(txt).toContain('/home/u/.claude/skills');
  });

  it('切换 agent 调 setTool 并重新加载资产', async () => {
    const collab = mockCollab();
    const w = mount(collab);
    await flushPromises();
    expect(collab.getAssets).toHaveBeenCalledTimes(1);
    const radios = w.findAll('input[name="dist-agent"]');
    await radios[1].setValue();
    await flushPromises();
    expect(collab.setTool).toHaveBeenCalledWith('claudecode', null);
    expect(collab.getAssets).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/collaboration/SkillDistributor.test.ts`
Expected: FAIL — 页面未渲染 agent 名称/目录（当前只有只读 `toolRoot`）

- [ ] **Step 3: 修改组件脚本**

修改 `web/src/collaboration/SkillDistributor.vue`。

第 20 行 `const toolRoot = ref('');` 之后加入：

```ts
type AgentOption = { id: string; name: string; cmd: string; skillsDir: string | null; exists: boolean; selectable: boolean; selected: boolean };
type ToolInfo = { root: string; selected: string; tool: { agentId: string; customRoot: string | null }; agents: AgentOption[] };
const agents = ref<AgentOption[]>([]);
const selectedAgent = ref('');
const customRoot = ref('');
function applyToolInfo(info: ToolInfo) {
  toolRoot.value = info.root || '';
  selectedAgent.value = info.selected || info.tool?.agentId || '';
  customRoot.value = info.tool?.customRoot || '';
  agents.value = info.agents || [];
}
async function selectAgent(id: string) {
  msg.value = ''; msgErr.value = '';
  if (id === 'custom' && !customRoot.value.trim()) { selectedAgent.value = 'custom'; return; }
  try {
    const info = await props.collab.setTool(id, id === 'custom' ? customRoot.value : null);
    applyToolInfo(info);
    checked.value = {};
    await loadAssets();
  } catch (e: any) { msgErr.value = String(e?.message || e); }
}
function onCustomChange(e: Event) { customRoot.value = (e.target as HTMLInputElement).value; }
async function applyCustomRoot() {
  if (selectedAgent.value !== 'custom') return;
  await selectAgent('custom');
}
```

第 45 行 `props.collab.getTool().then((info) => { toolRoot.value = info.root; }).catch(() => {});` 改为：

```ts
  props.collab.getTool().then((info) => applyToolInfo(info)).catch(() => {});
```

第 50 行 `storeKey` 加入 agent 维度：

```ts
const storeKey = computed(() => `collab-dist-${props.groupId}-${focus.value}-${selectedAgent.value}`);
```

- [ ] **Step 4: 修改组件模板**

把 `web/src/collaboration/SkillDistributor.vue` 第 116 行：

```html
    <div v-if="toolRoot" class="root" :title="toolRoot">{{ $t('collab.dist.skill_root') }}<code>{{ toolRoot }}</code>{{ $t('collab.dist.skill_root_hint') }}</div>
```

替换为：

```html
    <div v-if="agents.length" class="agents">
      <div class="sec">{{ $t('collab.dist.agent_selector') }}</div>
      <label v-for="a in agents" :key="a.id" class="agent" :class="{ off: !a.selectable }">
        <input type="radio" name="dist-agent" :value="a.id" :checked="selectedAgent === a.id" :disabled="!a.selectable" @change="selectAgent(a.id)" />
        <span class="anm">{{ a.name }}</span>
        <code class="apath" :title="a.skillsDir || ''">{{ a.skillsDir || $t('collab.dist.agent_unavailable') }}</code>
        <span v-if="a.skillsDir && !a.exists" class="amiss">{{ $t('collab.dist.agent_missing') }}</span>
      </label>
      <label class="agent">
        <input type="radio" name="dist-agent" value="custom" :checked="selectedAgent === 'custom'" @change="selectAgent('custom')" />
        <span class="anm">{{ $t('collab.dist.agent_custom') }}</span>
        <input class="cinput" :value="customRoot" :placeholder="$t('collab.dist.custom_root_ph')" @change="onCustomChange" @blur="applyCustomRoot" />
      </label>
    </div>
    <div v-if="toolRoot" class="root" :title="toolRoot">{{ toolRoot }}</div>
```

- [ ] **Step 5: 补样式**

在 `web/src/collaboration/SkillDistributor.vue` 的 `<style scoped>` 末尾（`.err` 规则之后）加入：

```css
.agents { flex: none; padding: 0 12px 6px; border-top: 1px solid var(--bd2); }
.agent { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; cursor: pointer; }
.agent.off { opacity: .5; cursor: default; }
.anm { flex: none; color: var(--tx); font-weight: 600; min-width: 84px; }
.apath { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx3); }
.amiss { flex: none; color: var(--err); }
.cinput { flex: 1 1 auto; min-width: 0; background: var(--bg2); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 2px 6px; font-size: 12px; }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/collaboration/SkillDistributor.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 7: Commit**

```bash
git add web/src/collaboration/SkillDistributor.vue web/src/collaboration/SkillDistributor.test.ts
git commit -m "feat(web): agent selector in skill distributor"
```

---

## Task 9: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js:177-178`、`shared/i18n/zh-CN.js:456` 之后
- Modify: `shared/i18n/en.js:177-178`、`shared/i18n/en.js:456` 之后

- [ ] **Step 1: 替换旧词条（zh-CN）**

`shared/i18n/zh-CN.js` 第 177-178 行：

```js
  'collab.dist.skill_root': '技能根：',
  'collab.dist.skill_root_hint': '（command/agent 取同配置根；「任务」页可切工具）',
```

替换为：

```js
  'collab.dist.agent_selector': '打包源工具',
  'collab.dist.agent_custom': '自定义目录',
  'collab.dist.agent_missing': '目录不存在',
  'collab.dist.agent_unavailable': '未配置 skills 目录',
  'collab.dist.custom_root_ph': 'skills 目录绝对路径',
```

- [ ] **Step 2: 替换旧词条（en）**

`shared/i18n/en.js` 第 177-178 行：

```js
  'collab.dist.skill_root': 'Skill root:',
  'collab.dist.skill_root_hint': '(command/agent use the same config root; switch tool on the Tasks tab)',
```

替换为：

```js
  'collab.dist.agent_selector': 'Pack source tool',
  'collab.dist.agent_custom': 'Custom directory',
  'collab.dist.agent_missing': 'Directory missing',
  'collab.dist.agent_unavailable': 'No skills directory configured',
  'collab.dist.custom_root_ph': 'Absolute path to skills directory',
```

- [ ] **Step 3: 新增错误词条（zh）**

`shared/i18n/zh-CN.js` 第 456 行 `'collab.err.need_custom_root': '自定义路径必填',` 之后加入：

```js
  'collab.err.unknown_agent': '未知的开发工具',
  'collab.err.agent_unavailable': '该工具未配置 skills 目录',
```

- [ ] **Step 4: 新增错误词条（en）**

`shared/i18n/en.js` 第 456 行 `'collab.err.need_custom_root': 'Custom path is required',` 之后加入：

```js
  'collab.err.unknown_agent': 'Unknown agent',
  'collab.err.agent_unavailable': 'This agent has no skills directory configured',
```

- [ ] **Step 5: 校验 i18n**

Run: `npm.cmd run check:i18n`
Expected: PASS（中英键集合对称、无硬编码中文）

- [ ] **Step 6: 跑 web 测试**

Run: `npm.cmd test:web`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): agent skills selector strings"
```

---

## Task 10: 全量验证

**Files:** 无（只运行）

- [ ] **Step 1: 服务端测试**

Run: `npm.cmd test:server`
Expected: 全部 PASS

- [ ] **Step 2: 前端测试**

Run: `npm.cmd test:web`
Expected: 全部 PASS

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过

- [ ] **Step 4: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 通过

- [ ] **Step 5: 人工验收（按 spec §5）**

1. 起 `npm.cmd run dev`，打开协作 → 群聊 → 「🛠 分发技能」。
2. 对话框顶部列出 opencode / claudecode 及各自目录；目录不存在显示「目录不存在」。
3. 选 opencode → 技能列表来自 `~/.config/opencode/skills`；选 claudecode → 来自 `~/.claude/skills`。
4. 打包 → 发布 → 成员接受任务，技能落到成员所选 agent 目录。
5. 「自定义目录」填路径后可列出并打包；重启后端选择保留。

- [ ] **Step 6: 最终提交（用户同意后）**

```bash
git add -A
git commit -m "feat(collab): package skills from selected agent directory"
```

---

## 自检记录

- **Spec 覆盖**：决策 1→Task 8；2→Task 3/4/8；3→Task 1；4→Task 4（`skillRoot` 同时用于打包与 `installDownload`/`acceptTask`）；5→Task 1/2；6→Task 8；7→Task 1/4/8；§4.4→Task 4；§4.5→Task 6；§4.6→Task 7/8；§4.7→Task 9；§5→各 Task 测试 + Task 10。
- **占位符**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性**：`AgentOption` 字段（`id/name/cmd/skillsDir/exists/selectable/selected`）在 Task 1、7、8 一致；`setTool` 引擎侧对象签名与前端 `setTool(agentId, customRoot?)` 在 Task 4/7/8 一致；`ToolInfo` 与 `getToolInfo` 返回结构一致。
- **已知遗留**：claudecode 的 `command/agent` 子目录仍取 `dirname(skills)`（spec §6 明确不做）。
