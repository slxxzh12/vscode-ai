# 开启 master 模式 + 工作流分发 + 种子文件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 协作页「远程访问」改名为「开启 master 模式」；分发器新增工作流；skills/commands/agents/workflows 勾选后统一打包成**一个共享文件**发布到 downloads 目录；工作流种子文件记录清单+版本号。

**Architecture:** 复用现有分发链路（`listAssets → buildPackage → publishPackage` 写 downloads / `sendPackage` 推送；接收方 `installBundleZip` 安装）。新增 `server/workflow-seed.js`，在 `updateWorkflows` 写盘后刷新种子。

**Tech Stack:** Node ESM、Vue 3 + TS、node:test / Vitest。

**Spec:** `docs/superpowers/specs/2026-09-12-master-mode-workflow-distribution-design.md`

**约定：** 命令在仓库根执行；npm 用 `npm.cmd`；只 `git add` 本任务文件；用户可见文案走 i18n。

---

## Task 1: i18n（改名 + 新词条）

**Files:**
- Modify: `shared/i18n/zh-CN.js`
- Modify: `shared/i18n/en.js`

- [ ] **Step 1: 中文**

在 `shared/i18n/zh-CN.js` 改 `'collab.remote.title'` 的值，并在 `'collab.dist.skills'` 附近新增：

```js
  'collab.remote.title': '开启 master 模式',
  'collab.dist.workflow': '工作流 workflow/（{count}）',
  'collab.sys.part.workflow': '工作流 {names}',
  'collab.seed.version': '工作流种子 v{version}',
```

- [ ] **Step 2: 英文（同键）**

在 `shared/i18n/en.js`：

```js
  'collab.remote.title': 'Master mode',
  'collab.dist.workflow': 'Workflows workflow/ ({count})',
  'collab.sys.part.workflow': 'workflows {names}',
  'collab.seed.version': 'Workflow seed v{version}',
```

- [ ] **Step 3: 校验**

Run: `npm.cmd run check:i18n`
Expected: exit 0。

- [ ] **Step 4: Commit**

```bash
git add shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "i18n: master 模式改名与工作流分发词条"
```

---

## Task 2: 工作流种子 `server/workflow-seed.js`

**Files:**
- Create: `server/workflow-seed.js`
- Test: `server/test/workflow-seed.test.js`

- [ ] **Step 1: 写失败测试**

新建 `server/test/workflow-seed.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSeed, updateSeed, seedFileFor } from '../workflow-seed.js';

function cfgFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfseed-')), 'devflow.xml'); }
const WF = (label = 'A') => ({ id: 'a', label, stages: [{ id: 's', label: 'S', prompts: ['p'] }] });

test('首次写入 version=1，清单含 hash', () => {
  const f = cfgFile();
  const s = updateSeed(f, [WF()]);
  assert.equal(s.version, 1);
  assert.equal(s.workflows.length, 1);
  assert.ok(s.workflows[0].hash);
  assert.ok(fs.existsSync(seedFileFor(f)));
});

test('内容不变不递增 version，变化才递增', () => {
  const f = cfgFile();
  updateSeed(f, [WF('A')]);
  const same = updateSeed(f, [WF('A')]);
  assert.equal(same.version, 1);
  const changed = updateSeed(f, [WF('B')]);
  assert.equal(changed.version, 2);
});

test('读写往返一致', () => {
  const f = cfgFile();
  const s = updateSeed(f, [WF()]);
  assert.deepEqual(readSeed(f), s);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/workflow-seed.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现**

新建 `server/workflow-seed.js`：

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function seedFileFor(configFile) {
  return path.join(path.dirname(configFile), 'workflows.seed.json');
}

export function hashWorkflow(w) {
  const norm = {
    id: w.id,
    label: w.label,
    stages: (w.stages || []).map((s) => ({ id: s.id, label: s.label, group: s.group || '', prompts: s.prompts || [] })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

export function readSeed(configFile) {
  try { return JSON.parse(fs.readFileSync(seedFileFor(configFile), 'utf8')); }
  catch { return { version: 0, updatedAt: 0, workflows: [] }; }
}

export function updateSeed(configFile, workflows, { now = Date.now() } = {}) {
  const prev = readSeed(configFile);
  const prevById = new Map((prev.workflows || []).map((w) => [w.id, w]));
  const catalog = (workflows || []).map((w) => {
    const hash = hashWorkflow(w);
    const old = prevById.get(w.id);
    return { id: w.id, label: w.label, hash, updatedAt: old && old.hash === hash ? (old.updatedAt || 0) : now };
  });
  const sig = (list) => JSON.stringify(list.map((w) => [w.id, w.hash]));
  const changed = sig(catalog) !== sig(prev.workflows || []);
  const seed = {
    version: (prev.version || 0) + (changed ? 1 : 0),
    updatedAt: changed ? now : (prev.updatedAt || 0),
    workflows: catalog,
  };
  try {
    fs.mkdirSync(path.dirname(seedFileFor(configFile)), { recursive: true });
    const tmp = seedFileFor(configFile) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(seed, null, 2), 'utf8');
    fs.renameSync(tmp, seedFileFor(configFile));
  } catch { /* best-effort：写种子失败不阻断 */ }
  return seed;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/test/workflow-seed.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/workflow-seed.js server/test/workflow-seed.test.js
git commit -m "feat(server): 工作流种子文件（清单+版本号）"
```

---

## Task 3: 挂接种子 + 暴露接口

**Files:**
- Modify: `server/devflow-config.js`
- Modify: `server/index.js`
- Test: `server/test/devflow-config.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/devflow-config.test.js` 末尾追加（文件已 import `updateWorkflows`；若未 import 则加）：

```js
import { updateSeed, readSeed } from '../workflow-seed.js';

test('updateWorkflows 后种子存在且内容变化递增 version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfcfg-'));
  const file = path.join(dir, 'devflow.xml');
  updateWorkflows(file, [{ id: 'w1', label: 'W1', stages: [{ id: 's', label: 'S', prompts: ['p'] }] }]);
  const s1 = readSeed(file);
  assert.equal(s1.version, 1);
  assert.ok(s1.workflows.some((w) => w.id === 'w1'));
  updateWorkflows(file, [{ id: 'w1', label: 'W1x', stages: [{ id: 's', label: 'S', prompts: ['p'] }] }]);
  assert.equal(readSeed(file).version, 2);
});
```

（`updateSeed` 未直接用到可覆盖为仅 import `readSeed`；保留 `updateSeed` 亦可，避免未用报错可删。）

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/devflow-config.test.js`
Expected: FAIL（种子未生成）。

- [ ] **Step 3: `devflow-config.js` 挂接**

在 `server/devflow-config.js` 顶部加：

```js
import { updateSeed } from './workflow-seed.js';
```

把 `updateWorkflows` 改为写盘后刷新种子：

```js
export function updateWorkflows(file, workflows) {
  const list = validateWorkflows(workflows);
  const cur = loadDevflowConfig(file);
  fs.writeFileSync(file, serializeDevflowConfig({ server: cur.server, agents: cur.agents, workflows: list }), 'utf8');
  updateSeed(file, list);
  return list;
}
```

- [ ] **Step 4: `index.js` 暴露种子接口 + 覆盖原始 XML 导入**

在 `server/index.js` import 区加：

```js
import { readSeed } from './workflow-seed.js';
```

在原始 XML 导入写盘处（`if (url.pathname === '/api/config/xml' && req.method === 'POST')` 分支内，`fs.writeFileSync(configFile, xml, 'utf8');` 之后）追加：

```js
        try { updateSeed(configFile, loadDevflowConfig(configFile).workflows); } catch { /* ignore */ }
```

并在导入区补充 `updateSeed`：

```js
import { readSeed, updateSeed } from './workflow-seed.js';
```

新增只读接口（放在 `/api/workflows` 路由附近）：

```js
  if (url.pathname === '/api/workflows-seed' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(readSeed(configFile)));
    return;
  }
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test server/test/devflow-config.test.js`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add server/devflow-config.js server/index.js server/test/devflow-config.test.js
git commit -m "feat(server): updateWorkflows 刷新种子并暴露 /api/workflows-seed"
```

---

## Task 4: 工作流进入分发打包/安装

**Files:**
- Modify: `server/collaboration/engine.js`
- Modify: `server/collaboration/bundle-installer.js`
- Modify: `server/index.js`
- Test: `server/test/collab-bundle-installer.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-bundle-installer.test.js` 追加：

```js
test('installBundleZip 合并 workflow/*.json（按 id 覆盖/追加）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  const zip = buildZip([
    { name: 'workflow/w1.json', data: JSON.stringify({ id: 'w1', label: 'W1', stages: [] }) },
    { name: 'workflow/w2.json', data: JSON.stringify({ id: 'w2', label: 'W2', stages: [] }) },
  ]);
  let merged = null;
  const r = installBundleZip({ zip, skillRoot: path.join(dir, 's'), configRoot: path.join(dir, 'c'), installWorkflows: (list) => { merged = list; } });
  assert.equal(r.counts.workflow, 2);
  assert.deepEqual(merged.map((w) => w.id).sort(), ['w1', 'w2']);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/test/collab-bundle-installer.test.js`
Expected: FAIL（未知 workflow，merged 为 null）。

- [ ] **Step 3: `bundle-installer.js` 支持 workflow**

整体替换为：

```js
import fs from 'node:fs';
import path from 'node:path';
import { readZip } from './zip.js';

function writeAtomic(dest, data) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
}

// 解包 assets 捆绑 zip：skills/<name>/... → skillRoot；command|agent/... → configRoot；
// workflow/<id>.json → installWorkflows([...])
export function installBundleZip({ zip, skillRoot, configRoot, installWorkflows = null }) {
  const entries = readZip(zip);
  const counts = { skills: 0, command: 0, agent: 0, workflow: 0 };
  const workflows = [];
  for (const e of entries) {
    const seg = e.name.split('/');
    const top = seg[0];
    if (top === 'skills') {
      if (seg.length < 3) continue;
      writeAtomic(path.join(skillRoot, ...seg.slice(1)), e.data);
      counts.skills++;
    } else if (top === 'command' || top === 'agent') {
      if (!configRoot || seg.length < 2) continue;
      writeAtomic(path.join(configRoot, top, ...seg.slice(1)), e.data);
      counts[top]++;
    } else if (top === 'workflow') {
      if (seg.length < 2 || !seg[1].endsWith('.json')) continue;
      try { workflows.push(JSON.parse(e.data.toString('utf8'))); counts.workflow++; } catch { /* skip bad json */ }
    }
  }
  if (workflows.length && typeof installWorkflows === 'function') installWorkflows(workflows);
  return { counts, files: counts.skills + counts.command + counts.agent + counts.workflow };
}
```

- [ ] **Step 4: `engine.js` 支持 workflow 资产与打包**

`constructor` 形参加 `getWorkflows = null, mergeWorkflows = null`，并在体内赋值：

```js
    this.getWorkflows = typeof getWorkflows === 'function' ? getWorkflows : null;
    this.mergeWorkflows = typeof mergeWorkflows === 'function' ? mergeWorkflows : null;
```

`listAssets()` 在 `return out;` 之前加：

```js
    out.workflow = (this.getWorkflows ? this.getWorkflows() : []).map((w) => ({ id: w.id, name: w.label }));
```

`buildPackage` 签名改为 `async buildPackage({ skills = [], command = [], agent = [], workflow = [] })`，并在 skills 循环之后、`if (!files.length)` 之前加：

```js
    const wSel = [...new Set(workflow || [])];
    for (const id of wSel) {
      assertSafeRel(id);
      const w = (this.getWorkflows ? this.getWorkflows() : []).find((x) => x.id === id);
      if (!w) continue;
      files.push({ rel: `workflow/${id}.json`, data: Buffer.from(JSON.stringify(w), 'utf8') });
    }
```

并把 `total`、`package` 记录扩展为包含 workflow：

```js
    const total = sSel.length + cSel.length + aSel.length + wSel.length;
    // ...
    package: { sent: false, skills: sSel, command: cSel, agent: aSel, workflow: wSel },
```

`sendPackage` 里 payload 与系统消息补 workflow：

```js
    const env = this._sign(CollabPeer.FILE_PUSH, {
      groupId, fileName: rec.fileName, hash: rec.hash, size: data.length,
      skills: pkg.skills || [], command: pkg.command || [], agent: pkg.agent || [], workflow: pkg.workflow || [],
      b64: data.toString('base64'),
    });
    // ...
    if ((pkg.workflow || []).length) {
      const labels = (pkg.workflow || []).map((id) => (this.getWorkflows ? (this.getWorkflows().find((w) => w.id === id) || {}).label : '') || id);
      parts.push(t('collab.sys.part.workflow', { names: labels.join('、') }));
    }
```

`installDownload` 传入 workflow 合并器：

```js
      const r = installBundleZip({ zip: fs.readFileSync(abs), skillRoot: this.skillRoot(), configRoot: this.configRoot(), installWorkflows: (list) => (this.mergeWorkflows ? this.mergeWorkflows(list) : null) });
```

（master 发布 `publishPackage` 不改：它本就把整包写成一个共享文件到 downloads 目录，符合“统一打包成一个共享文件放 downloads”。）

- [ ] **Step 5: `index.js` 注入 getWorkflows/mergeWorkflows**

在 `buildWorkspace` 里 `const engine = new CollabEngine({ ... })` 的实参中加：

```js
    getWorkflows: () => loadDevflowConfig(configFile).workflows,
    mergeWorkflows: (incoming) => {
      const cur = loadDevflowConfig(configFile).workflows;
      const byId = new Map(cur.map((w) => [w.id, w]));
      for (const w of incoming) if (w && w.id) byId.set(w.id, w);
      return updateWorkflows(configFile, [...byId.values()]);
    },
```

- [ ] **Step 6: 运行确认通过**

Run: `node --test server/test/collab-bundle-installer.test.js`
Expected: PASS。

Run: `node --test "server/test/*.test.js"`
Expected: 全部 PASS（无回归）。

- [ ] **Step 7: Commit**

```bash
git add server/collaboration/engine.js server/collaboration/bundle-installer.js server/index.js server/test/collab-bundle-installer.test.js
git commit -m "feat(server): 工作流进入分发打包/安装与合并"
```

---

## Task 5: 前端分发器支持工作流

**Files:**
- Modify: `web/src/collaboration/useCollab.ts`
- Modify: `web/src/collaboration/SkillDistributor.vue`

- [ ] **Step 1: `useCollab.ts` 类型**

把 `getAssets` 与 `buildPackage` 改为：

```ts
    getAssets: () => http<{ skills: { name: string }[]; command: { name: string }[]; agent: { name: string }[]; workflow: { id: string; name: string }[] }>('/api/collab/assets'),
    buildPackage: (sel: { skills?: string[]; command?: string[]; agent?: string[]; workflow?: string[] }) =>
      post<{ package: { id: string; fileName: string; size: number } }>('/api/collab/packages', { skills: sel.skills || [], command: sel.command || [], agent: sel.agent || [], workflow: sel.workflow || [] }),
```

并在对象里新增种子版本读取：

```ts
    getWorkflowSeed: () => http<{ version: number; workflows: { id: string; label: string; hash: string }[] }>('/api/workflows-seed'),
```

- [ ] **Step 2: `SkillDistributor.vue` 支持 workflow**

把类型与 assets/selected/toggleAll 扩展为含 `workflow`：

```ts
const assets = ref<{ skills: { name: string }[]; command: { name: string }[]; agent: { name: string }[]; workflow: { id: string; name: string }[] }>({ skills: [], command: [], agent: [], workflow: [] });
type Kind = 'skills' | 'command' | 'agent' | 'workflow';
const seedVersion = ref(0);
```

`selected` 改为：

```ts
const selected = computed(() => {
  const s: { skills: string[]; command: string[]; agent: string[]; workflow: string[] } = { skills: [], command: [], agent: [], workflow: [] };
  for (const k of ['skills', 'command', 'agent'] as Kind[]) {
    for (const it of assets.value[k]) if (checked.value[keyOf(k, it.name)]) s[k].push(it.name);
  }
  for (const w of assets.value.workflow) if (checked.value[keyOf('workflow', w.id)]) s.workflow.push(w.id);
  return s;
});
const selectedCount = computed(() => selected.value.skills.length + selected.value.command.length + selected.value.agent.length + selected.value.workflow.length);
const totalCount = computed(() => assets.value.skills.length + assets.value.command.length + assets.value.agent.length + assets.value.workflow.length);
```

`onMounted` 增加拉取种子版本：

```ts
onMounted(async () => {
  props.collab.getTool().then((info) => { toolRoot.value = info.root; }).catch(() => {});
  props.collab.getWorkflowSeed().then((s) => { seedVersion.value = s.version || 0; }).catch(() => {});
  loadAssets();
});
```

`toggleAll` 扩展：

```ts
function toggleAll(on: boolean) {
  const map: Record<string, boolean> = {};
  if (on) {
    for (const k of ['skills', 'command', 'agent'] as Kind[]) for (const it of assets.value[k]) map[keyOf(k, it.name)] = true;
    for (const w of assets.value.workflow) map[keyOf('workflow', w.id)] = true;
  }
  checked.value = map;
}
```

模板在 `assets.agent` 分组之后加：

```html
      <template v-if="assets.workflow.length">
        <div class="sec">{{ $t('collab.dist.workflow', { count: assets.workflow.length }) }}</div>
        <label v-for="w in assets.workflow" :key="'workflow:' + w.id" class="skill">
          <input type="checkbox" v-model="checked[keyOf('workflow', w.id)]" />
          <span class="snm">🧩 {{ w.name }}</span>
        </label>
      </template>
```

在 `root` 提示行之后加种子版本：

```html
    <div class="root">{{ $t('collab.seed.version', { version: seedVersion }) }}</div>
```

（新增一行，`seedVersion` 为 0 时也显示 v0，表示尚无种子。）

- [ ] **Step 3: 类型检查与测试**

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd --prefix web run test`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add web/src/collaboration/useCollab.ts web/src/collaboration/SkillDistributor.vue
git commit -m "feat(web): 分发器支持工作流与种子版本"
```

---

## Task 6: 全量验证

**Files:** 无

- [ ] **Step 1: 全部检查**

Run: `npm.cmd test`
Expected: server + web 全绿。

Run: `npm.cmd run typecheck`
Expected: PASS。

Run: `npm.cmd run check:i18n`
Expected: exit 0。

Run: `npm.cmd run build:web`
Expected: 成功。

- [ ] **Step 2: 人工验收（可选）**

1. 协作页左栏标题显示「开启 master 模式」。
2. 群聊里 🛠 分发 → 勾选 skills + commands + agents + 工作流 → 「① 打包」→ 一个 zip；master 点「发布到 downloads」→ downloads 目录出现该共享文件。
3. slave 同步 downloads → 安装 → 本机 devflow.xml 新增该工作流，skills/command/agent 落到各自目录。
4. 改动任一工作流（设置里保存）→ 「工作流种子 v{n}」+1。

- [ ] **Step 3: Commit（如验收微调）**

```bash
git add <按实际改动文件>
git commit -m "fix: master 模式/工作流分发验收修正"
```

---

## Self-Review 记录

- **Spec 覆盖：** 改名（Task 1/5）、种子（Task 2/3）、工作流分发（Task 4/5）、统一打包到 downloads（Task 4 的 publishPackage 既有行为 + 勾选含 workflow）、i18n（Task 1）、验收（Task 6）。
- **占位符：** 无 TBD；代码/命令完整。
- **类型一致性：** `getAssets`/`buildPackage` 增加 `workflow`（Task 4/5 一致）；`installBundleZip({..., installWorkflows})`（Task 4）；`updateSeed/readSeed`（Task 2/3）；`getWorkflows/mergeWorkflows` 注入（Task 4）。
- **注意：** `import { updateSeed }` 在 devflow-config.test 中若未用到需删掉以免未用告警（node:test 不报未用，无妨）；种子写入 best-effort，失败不阻断。
- **用户追加需求：** 「勾选 skills/commands/agents → 统一打包成一个共享文件放 downloads」由既有 `publishPackage` 完成（整包单文件写入 downloads），本次只把 workflow 纳入同一包。
