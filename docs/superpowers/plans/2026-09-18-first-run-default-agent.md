# 首次启动选择默认 Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首次启动时自动打开设置弹窗让用户选择「默认 Agent」，选择写回服务端配置并全局生效，只引导一次。

**Architecture:** 「默认 Agent」以服务端活动配置 `<agents default="..." chosen="1">` 为唯一权威源。服务端提供 `GET /api/agents`（含 `chosen`）与 `POST /api/agents/default`（校验并改写 XML）；用量采集改为每次上报动态解析默认 agent。前端在启动时若检测到「未选过且 agent≥2」，先打开设置弹窗聚焦 Agent 列表，关闭后再处理「无项目」引导。

**Tech Stack:** Node ESM（node:test）、Vue3 + TS（vitest/vue-tsc）、XML 字符串改写（沿用 `updateServerAttrs` 写法）。

**Spec:** `docs/superpowers/specs/2026-09-18-first-run-default-agent-design.md`

---

## 文件结构

| 文件 | 职责 | 改动 |
| --- | --- | --- |
| `server/devflow-config.js` | 配置解析/序列化 + XML 改写 | 新增 `chosen` 字段、`updateAgentsDefault`、`setDefaultAgent` |
| `server/usage-report.js` | 用量上报器 | 新增 `resolveAgent` 动态解析 |
| `server/index.js` | HTTP 面 + 装配 | `/api/agents` 加 `chosen`；新增端点；`defaultAgent()` 实时化；传 `resolveAgent` |
| `server/test/devflow-config.test.js` | 配置单测 | 新增 chosen / updateAgentsDefault / setDefaultAgent 用例 |
| `server/test/usage-report.test.js` | 上报器单测 | 新增 resolveAgent 用例 |
| `web/src/App.vue` | 启动编排 | 先选 agent，后弹添加目录 |
| `web/src/components/TerminalView.vue` | 设置弹窗 | firstRun 提示/滚动；设为默认写服务端；关闭派发事件 |
| `shared/i18n/zh-CN.js` / `en.js` | 词条 | 新增 2 个词条 |

---

### Task 1: 配置层支持 `chosen` 与默认 agent 改写

**Files:**
- Modify: `server/devflow-config.js`
- Test: `server/test/devflow-config.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/devflow-config.test.js` 顶部 import 增加 `updateAgentsDefault, setDefaultAgent`：

```js
import {
  parseDevflowConfig, serializeDevflowConfig,
  loadDevflowConfig, ensureConfigFile, updateServerAttrs, buildDefaultConfig,
  validateWorkflows, updateWorkflows, resolveActiveConfigFile,
  updateAgentsDefault, setDefaultAgent,
} from '../devflow-config.js';
```

在文件末尾追加：

```js
test('parseDevflowConfig 解析 agents chosen（缺省 false / chosen="1" 为 true）', () => {
  assert.equal(parseDevflowConfig(SAMPLE).agents.chosen, false);
  const c = parseDevflowConfig('<devflow><agents default="opencode" chosen="1"><agent id="opencode" name="OpenCode" cmd="opencode" /></agents></devflow>');
  assert.equal(c.agents.chosen, true);
});

test('serializeDevflowConfig 仅 chosen=true 时输出 chosen 属性', () => {
  assert.doesNotMatch(serializeDevflowConfig(buildDefaultConfig()), /chosen=/);
  const cfg = buildDefaultConfig();
  const out = serializeDevflowConfig({ ...cfg, agents: { default: 'opencode', list: cfg.agents.list, chosen: true } });
  assert.match(out, /<agents default="opencode" chosen="1">/);
  assert.equal(parseDevflowConfig(out).agents.chosen, true);
});

test('updateAgentsDefault 改写 default/chosen 且保留其余内容', () => {
  const f = tmpFile();
  fs.writeFileSync(f, SAMPLE, 'utf8');
  const r = updateAgentsDefault(f, 'opencode');
  assert.deepEqual(r, { default: 'opencode', chosen: true });
  const xml = fs.readFileSync(f, 'utf8');
  assert.match(xml, /<agents default="opencode" chosen="1">/);
  assert.ok(xml.includes('<!-- keep me -->'), '注释保留');
  assert.ok(xml.includes('<workflow id="dev"'), '工作流保留');
  const c = parseDevflowConfig(xml);
  assert.equal(c.agents.default, 'opencode');
  assert.equal(c.agents.chosen, true);
  assert.deepEqual(c.agents.list.map((a) => a.id), ['opencode', 'nga'], 'agent 列表保留');
});

test('setDefaultAgent 校验未知 id 抛 bad-agent，合法则写盘', () => {
  const f = tmpFile();
  fs.writeFileSync(f, SAMPLE, 'utf8');
  assert.equal(setDefaultAgent(f, 'nga').default, 'nga');
  assert.equal(parseDevflowConfig(fs.readFileSync(f, 'utf8')).agents.chosen, true);
  assert.throws(() => setDefaultAgent(f, 'nope'), (e) => e.code === 'bad-agent');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/devflow-config.test.js`
Expected: FAIL，报 `updateAgentsDefault is not a function` / `setDefaultAgent is not a function` 或 `chosen` 断言失败。

- [ ] **Step 3: 实现**

`server/devflow-config.js` 的 `buildDefaultConfig`（第 28-34 行）改为：

```js
export function buildDefaultConfig() {
  return {
    server: { language: DEFAULT_LOCALE, host: '127.0.0.1' },
    agents: { default: DEFAULT_AGENT, list: DEFAULT_AGENTS.map((a) => ({ ...a })), chosen: false },
    workflows: fallbackWorkflows(),
  };
}
```

`parseDevflowConfig`（第 36-78 行）中：把 `let defAgent = defaults.agents.default;` 下面加 `let chosen = false;`；在 `if (agentsTag) { ... }` 块末尾（`defAgent = ...` 之后、`}` 之前）加：

```js
    chosen = attr(agentsTag[1], 'chosen') === '1';
```

并把 `return` 里的 `agents` 改为：

```js
    agents: { default: defAgent, list, chosen },
```

`serializeDevflowConfig`（第 97 行）的 `<agents ...>` 开标签改为：

```js
  <agents default="${escXml(cfg.agents.default)}"${cfg.agents.chosen ? ' chosen="1"' : ''}>
```

在 `updateServerAttrs`（第 134-150 行）之后新增两个导出函数：

```js
// 改写 <agents> 开标签的 default 与 chosen="1"，保留其余内容（含注释/工作流）
export function updateAgentsDefault(file, id) {
  ensureConfigFile(file);
  let xml = fs.readFileSync(file, 'utf8');
  const m = xml.match(/<agents\b([^>]*?)>/i);
  const cur = m ? m[1] : '';
  const rest = cur
    .replace(/\s*default\s*=\s*"[^"]*"/i, '')
    .replace(/\s*chosen\s*=\s*"[^"]*"/i, '')
    .trim();
  const tag = `<agents${rest ? ` ${rest}` : ''} default="${escXml(String(id))}" chosen="1">`;
  if (m) xml = xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length);
  fs.writeFileSync(file, xml, 'utf8');
  return { default: String(id), chosen: true };
}

// 校验 id 存在于当前 agent 列表后写盘；未知 id 抛 code='bad-agent'
export function setDefaultAgent(file, id) {
  const cfg = loadDevflowConfig(file);
  const target = String(id || '');
  if (!(cfg.agents.list || []).some((a) => a.id === target)) {
    const e = new Error('bad-agent');
    e.code = 'bad-agent';
    throw e;
  }
  return updateAgentsDefault(file, target);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/test/devflow-config.test.js`
Expected: PASS（含原有用例）。

- [ ] **Step 5: 提交**

```powershell
git add server/devflow-config.js server/test/devflow-config.test.js
git commit -m "feat(config): agents 支持 chosen 标记与设置默认 agent"
```

---

### Task 2: 用量上报器支持动态解析默认 agent

**Files:**
- Modify: `server/usage-report.js`
- Test: `server/test/usage-report.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/usage-report.test.js` 末尾追加：

```js
test('reportNow：resolveAgent 提供时每次上报动态取默认 agent', async () => {
  const file = tmpFile();
  const seen = [];
  let current = { cmd: 'opencode', statsCmd: 'opencode stats --days {days}' };
  const r = createUsageReporter({
    file, identity: () => ({ machineId: 'm1' }),
    resolveAgent: () => current,
    collect: async (args) => { seen.push(args); return { sessions: 1 }; },
  });
  await r.reportNow();
  current = { cmd: 'codeagent', statsCmd: 'codeagent stats --days {days}' };
  await r.reportNow();
  assert.equal(seen.length, 2);
  assert.equal(seen[0].cmd, 'opencode');
  assert.equal(seen[0].statsCmd, 'opencode stats --days {days}');
  assert.equal(seen[1].cmd, 'codeagent');
  assert.equal(seen[1].statsCmd, 'codeagent stats --days {days}');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test/usage-report.test.js`
Expected: FAIL，`seen[1].cmd` 为 `opencode`（resolveAgent 未生效）。

- [ ] **Step 3: 实现**

`server/usage-report.js` 的 `createUsageReporter` 参数（第 54-58 行）增加 `resolveAgent = null`：

```js
export function createUsageReporter({
  file, identity, peers = null, onLocal = null, cmd = 'opencode', statsCmd = '', resolveAgent = null, collect = collectAgentStats,
  fetchFn = fetch, logger = console, random = Math.random,
  now = () => Date.now(), scheduleFn = (fn, ms) => setTimeout(fn, ms),
} = {}) {
```

在 `const config = () => loadReportConfig(file);` 下方加：

```js
  const currentAgent = () => {
    const r = typeof resolveAgent === 'function' ? resolveAgent() : null;
    return {
      cmd: (r && r.cmd) || cmd,
      statsCmd: (r && r.statsCmd) || statsCmd,
    };
  };
```

把 `reportNow` 开头（第 66-70 行）改为：

```js
  async function reportNow() {
    const cfg = config();
    const a = currentAgent();
    let usage;
    try { usage = await collect({ cmd: a.cmd, statsCmd: a.statsCmd, days: cfg.days }); }
    catch (e) { usage = { agent: a.cmd, days: cfg.days, error: String((e && e.message) || e) }; }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/test/usage-report.test.js`
Expected: PASS（含原有 4 处 `cmd`/`statsCmd` 断言）。

- [ ] **Step 5: 提交**

```powershell
git add server/usage-report.js server/test/usage-report.test.js
git commit -m "feat(usage): 上报器支持动态解析默认 agent"
```

---

### Task 3: 服务端 HTTP 接入

**Files:**
- Modify: `server/index.js`

> 说明：`server/index.js` 是进程入口，现有测试不直接启动它；本任务以「纯函数已由 Task 1/2 覆盖 + 手工 curl 验证」为准。

- [ ] **Step 1: `defaultAgent()` 改为实时解析**

把 `server/index.js` 第 78-82 行改为：

```js
// 默认 agent 配置（终端启动命令 + 用量采集命令 statsCmd 共用同一份）；每次实时读配置，
// 设置默认 agent 后无需重启即生效
function defaultAgent() {
  const c = loadDevflowConfig(configFile);
  const a = (c.agents.list || []).find((x) => x.id === c.agents.default) || {};
  return { id: a.id || '', cmd: a.cmd || 'opencode', statsCmd: a.statsCmd || '' };
}
```

- [ ] **Step 2: 用量上报传入 `resolveAgent`**

把第 335-343 行的 `createUsageReporter({...})` 增加一行 `resolveAgent: () => defaultAgent(),`（放在 `statsCmd: agent.statsCmd,` 之后）：

```js
  const usageReporter = createUsageReporter({
    file: paths.usageReportFile,
    identity: () => ({ ...engine.pub }),
    peers: usagePeers,
    onLocal: syncUsageSnapshot,
    cmd: agent.cmd,
    statsCmd: agent.statsCmd,
    resolveAgent: () => defaultAgent(),
    logger: log,
  });
```

- [ ] **Step 3: `GET /api/agents` 返回 `chosen`**

把第 505-510 行改为：

```js
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const c = loadDevflowConfig(configFile);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ default: c.agents.default, agents: c.agents.list, chosen: !!c.agents.chosen }));
    return;
  }
```

- [ ] **Step 4: 新增 `POST /api/agents/default`**

在 `GET /api/agents` 块之后插入（沿用 `req.on('data')` 累积 body 的既有写法）：

```js
  if (url.pathname === '/api/agents/default' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      try {
        const r = setDefaultAgent(configFile, body.id);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, default: r.default }));
      } catch (e) {
        const code = (e && e.code === 'bad-agent') ? 400 : 500;
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: (e && e.code) || 'error', message: String((e && e.message) || e) }));
      }
    });
    return;
  }
```

把 `server/index.js` 第 46 行的 import 改为（在末尾加入 `setDefaultAgent`）：

```js
import { resolveActiveConfigFile, loadDevflowConfig, ensureConfigFile, updateServerAttrs, parseDevflowConfig, updateWorkflows, setDefaultAgent } from './devflow-config.js';
```

- [ ] **Step 5: 回归 + 手工验证**

Run: `node --test "server/test/*.test.js"`
Expected: 全绿。

启动 dev（后台），用 curl 验证（PowerShell）：

```powershell
# 1) 读 agents：应含 chosen 字段
curl.exe -s http://127.0.0.1:33333/api/agents
# 2) 设为默认（合法）→ {"ok":true,"default":"codeagent"}
curl.exe -s -X POST http://127.0.0.1:33333/api/agents/default -H "Content-Type: application/json" -d "{\"id\":\"codeagent\"}"
# 3) 非法 id → 400 {"error":"bad-agent"}
curl.exe -s -o NUL -w "%{http_code}" -X POST http://127.0.0.1:33333/api/agents/default -H "Content-Type: application/json" -d "{\"id\":\"nope\"}"
```

确认 `<数据目录>\ports\33333\downloads\devflow.xml` 的 `<agents ...>` 变为 `default="codeagent" chosen="1"`。

- [ ] **Step 6: 提交**

```powershell
git add server/index.js
git commit -m "feat(server): 新增设置默认 agent 接口并返回 chosen"
```

---

### Task 4: 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 中文词条**

在 `shared/i18n/zh-CN.js` 的 `'term.agent_hint'`（第 538 行）之后追加：

```js
  'term.agent_first_run_hint': '请选择默认 Agent（点下方「设为默认」）',
  'term.agent_set_default_failed': '设置默认 Agent 失败：{msg}',
```

- [ ] **Step 2: 英文词条**

在 `shared/i18n/en.js` 的 `'term.agent_hint'`（第 538 行）之后追加：

```js
  'term.agent_first_run_hint': 'Choose the default Agent (click "Set as default" below)',
  'term.agent_set_default_failed': 'Failed to set default Agent: {msg}',
```

- [ ] **Step 3: 校验对称**

Run: `npm.cmd run check:i18n`
Expected: 通过（无缺失/多余/硬编码中文）。

- [ ] **Step 4: 提交**

```powershell
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(i18n): 首次选择默认 agent 提示词条"
```

---

### Task 5: TerminalView —— firstRun 提示 + 设为默认写服务端 + 关闭事件

**Files:**
- Modify: `web/src/components/TerminalView.vue`

- [ ] **Step 1: 新增状态与方法**

在 `const settingsTab = ref<'general' | 'about'>('general');`（第 253 行）下方加：

```js
const firstRunHint = ref(false);
const agentSecRef = ref<HTMLElement | null>(null);
```

把 `onOpenSettings`（第 313 行）改为：

```js
function onOpenSettings(e: Event) {
  const firstRun = !!(e as CustomEvent).detail?.firstRun;
  settingsOpen.value = true;
  loadSettings();
  firstRunHint.value = firstRun;
  if (firstRun) nextTick(() => agentSecRef.value?.scrollIntoView({ block: 'start' }));
}
```

在 `watch([agentId, agents, wfKind], saveCfg, { deep: true });`（第 937 行）之后加：

```js
watch(settingsOpen, (open, was) => {
  if (was && !open) {
    firstRunHint.value = false;
    window.dispatchEvent(new Event('df-settings-closed'));
  }
});
async function setDefaultAgent(id: string) {
  agentId.value = id;                    // 本机当前项目即时生效
  try {
    const res = await fetch('/api/agents/default', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    firstRunHint.value = false;
  } catch (e: any) {
    alert(t('term.agent_set_default_failed', { msg: e?.message || e }));
  }
}
```

- [ ] **Step 2: 模板改动**

Agent 列表区块（第 1014-1023 行）改为：

```html
          <div ref="agentSecRef" class="setsec">
            <div class="settitle">{{ $t('term.agent_list') }} <button class="ghostcfg" @click="addAgent">{{ $t('term.add') }}</button></div>
            <div v-if="firstRunHint" class="cfghint warn">{{ $t('term.agent_first_run_hint') }}</div>
            <div v-for="a in agents" :key="a.id" class="agentrow">
              <input v-model="a.name" class="ainput aname" :placeholder="$t('term.name')" />
              <input v-model="a.cmd" class="ainput acmd" :placeholder="$t('term.agent_cmd_placeholder')" />
              <button class="ghostcfg setbtn" :class="{ on: a.id === agentId }" :disabled="a.id === agentId" @click="setDefaultAgent(a.id)">{{ a.id === agentId ? $t('term.is_default') : $t('term.set_default') }}</button>
              <button class="ghostcfg delbtn" :disabled="agents.length <= 1" @click="removeAgent(a.id)">{{ $t('term.delete') }}</button>
            </div>
            <div class="cfghint">{{ $t('term.agent_hint') }}</div>
          </div>
```

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过（`vue-tsc` 无错误）。

- [ ] **Step 4: 提交**

```powershell
git add web/src/components/TerminalView.vue
git commit -m "feat(web): 设置面板支持首次选择默认 agent 并写服务端"
```

---

### Task 6: App.vue —— 启动编排（先选 agent，后弹添加目录）

**Files:**
- Modify: `web/src/App.vue`

- [ ] **Step 1: `openAgentSettings` 支持 firstRun 细节 + 修正齿轮按钮调用**

把 `openAgentSettings`（第 524-528 行）改为：

```js
function openAgentSettings(firstRun = false) {
  // 设置弹窗在 TerminalView 内，仅在「目录/历史」视图挂载；其他页（通讯录/统计/定时任务）需先切回目录
  if (rail.value !== 'explorer') { rail.value = 'explorer'; }
  setTimeout(() => window.dispatchEvent(new CustomEvent('df-open-agent-settings', { detail: { firstRun } })), 120);
}
```

把齿轮按钮（第 604 行）的 `@click="openAgentSettings"` 改为 `@click="openAgentSettings()"`（避免把 MouseEvent 当作 firstRun 传入）。

- [ ] **Step 2: 首次引导判定 + 关闭后接续「无项目」**

在 `const noProjectPrompted = ref(false);`（第 482 行）下方加：

```js
const pendingAgentChoice = ref(false);
async function checkFirstRunAgentChoice() {
  try {
    const r = await fetch('/api/agents').then((x) => x.json());
    const list = Array.isArray(r?.agents) ? r.agents : [];
    if (!r?.chosen && list.length >= 2) pendingAgentChoice.value = true;
  } catch { /* 引导失败不阻塞 */ }
}
function onSettingsClosed() {
  if (pendingAgentChoice.value && !projects.value.length && !noProjectPrompted.value) {
    noProjectPrompted.value = true;
    openAddFolder();
  }
}
```

把 `loadProjects`（第 471 行）的无项目分支改为（仅多一个 `!pendingAgentChoice.value` 条件）：

```js
  } else if (!projects.value.length && !noProjectPrompted.value && !pendingAgentChoice.value) {
    noProjectPrompted.value = true;
    openAddFolder();
  }
```

- [ ] **Step 3: onMounted / onBeforeUnmount 编排**

把 onMounted（第 546-547 行）的两行：

```js
  const projectsReady = loadProjects();
  void restoreWindowState(projectsReady);      // 后台恢复：不阻塞终端连接
```

改为：

```js
  const projectsReady = (async () => { await checkFirstRunAgentChoice(); await loadProjects(); })();
  void restoreWindowState(projectsReady).finally(() => { if (pendingAgentChoice.value) openAgentSettings(true); });
```

在 onMounted 的事件注册区（第 553 行附近）加：

```js
  window.addEventListener('df-settings-closed', onSettingsClosed);
```

在 onBeforeUnmount（第 566 行附近）加：

```js
  window.removeEventListener('df-settings-closed', onSettingsClosed);
```

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过。

- [ ] **Step 5: 全量回归**

Run: `npm.cmd test`
Expected: server + web 全绿。

- [ ] **Step 6: 提交**

```powershell
git add web/src/App.vue
git commit -m "feat(web): 首次启动先引导选择默认 agent 再引导添加项目"
```

---

### Task 7: 端到端手工验收

- [ ] **Step 1: 全新档案**

停掉 dev 后端；备份并移走 `%USERPROFILE%\.local\share\void\ports\33333\downloads\devflow.xml`（或用新端口起）；`npm.cmd run dev`。

Expected: 页面加载后自动打开设置弹窗、「Agent 列表」有提示并滚到可见；选 `codeagent` 点「设为默认」。

- [ ] **Step 2: 关闭后续引导**

关闭设置弹窗。
Expected: 因无项目，弹出「添加目录」；添加后正常。

- [ ] **Step 3: 配置落盘 + 不再弹**

刷新页面。
Expected: 不再自动弹设置；活动配置 `<agents>` 为 `default="codeagent" chosen="1"`；`GET /api/agents` 的 `chosen: true`。

- [ ] **Step 4: 不选则再弹**

把配置里的 `chosen="1"` 删掉（模拟未选），刷新/重启后端。
Expected: 再次自动弹设置。

- [ ] **Step 5: 单 agent 不弹**

临时把配置改成只剩 1 个 agent 且无 `chosen`，刷新。
Expected: 不弹设置。

- [ ] **Step 6: 用量跟随**

点协作页「立即上报」，确认采集用的是新默认 agent 的 `statsCmd`（必要时看 `usage`/日志）。
