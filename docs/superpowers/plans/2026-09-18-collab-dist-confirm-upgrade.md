# 群主标记 + 发给群生成升级 + slave 定时轮询与确认安装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 群成员表标出群主；群主发布按钮改为「发给群生成升级」并记录每个 skill 的更新时间/大小/hash；slave 定时轮询补任务并弹窗确认/拒绝，确认后把 skills 装到本地 agent、workflow 并入本地。

**Architecture:** 复用现有 dist/seed/sync/task 机制：`buildPackage` 补 per-skill 元数据入 seed（SQLite），`publishPackage` 追加 `publishUpdate` 生成升级 version；成员机加非阻塞定时器调 `pollDistTasks()`，`tasks` 事件经 WS 新常量 `COLLAB_TASKS` 推到全局组件 `DistTaskNotifier` 弹窗，确认走既有 `acceptTask`（含 workflow 合并）。

**Tech Stack:** Node ESM + node:test（server）、Vue3 + TS + vitest + @vue/test-utils（web）、i18n（`shared/i18n`）。

**参考 spec:** `docs/superpowers/specs/2026-09-18-collab-dist-confirm-upgrade-design.md`

> **提交纪律（AGENTS.md）**：未经用户明确同意不提交；按用户此前偏好，本计划全部实现并验证后**单次提交**。提交前执行 `docs/learn/git仓库提交检查和提交事项.md` 自查。

---

## 文件结构

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `shared/collab.js` | 修改 | 新增 `CollabS2C.COLLAB_TASKS` |
| `server/test/collab-const.test.js` | 修改 | 常量断言 |
| `shared/i18n/zh-CN.js` / `en.js` | 修改 | 新词条 |
| `web/src/collaboration/MemberUsageTable.vue` | 修改 | 群主徽标 + 跟随选中群 |
| `web/src/collaboration/GroupView.vue` | 修改 | 传 `group` |
| `web/src/collaboration/MemberUsageTable.test.ts` | 修改 | 群主徽标测试 |
| `server/collaboration/engine.js` | 修改 | seed 明细、publish 版本、`pollDistTasks` |
| `server/test/collab-pack-detail.test.js` | 新建 | seed 明细测试 |
| `server/test/collab-dist-poll.test.js` | 新建 | 轮询测试 |
| `server/index.js` | 修改 | 转发 tasks + 定时器 |
| `server/collaboration/http-mount.js` | 修改 | `POST /api/collab/tasks/poll` |
| `server/test/collab-tasks-http.test.js` | 修改 | poll 路由测试 |
| `web/src/collaboration/useCollab.ts` | 修改 | `pollTasks` + publish 返回类型 |
| `web/src/collaboration/useCollab.test.ts` | 修改 | pollTasks 路由测试 |
| `web/src/collaboration/SkillDistributor.vue` | 修改 | 发布后显示版本 |
| `web/src/collaboration/DistTaskNotifier.vue` | 新建 | 全局任务弹窗 |
| `web/src/collaboration/DistTaskNotifier.test.ts` | 新建 | 弹窗测试 |
| `web/src/App.vue` | 修改 | 挂载 notifier |

---

## Task 1: shared 新增 COLLAB_TASKS

**Files:**
- Modify: `shared/collab.js:2-8`
- Test: `server/test/collab-const.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-const.test.js` 的 `CollabS2C` 断言区（第 7-8 行附近）加入：

```js
  assert.equal(CollabS2C.COLLAB_TASKS, 'collab-tasks');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-const.test.js"`
Expected: FAIL — `undefined !== 'collab-tasks'`

- [ ] **Step 3: 实现**

`shared/collab.js` 的 `CollabS2C` 对象加入一行（放在 `COLLAB_HEARTBEAT` 之前）：

```js
  COLLAB_TASKS: 'collab-tasks',
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-const.test.js"`
Expected: PASS

---

## Task 2: i18n 词条

**Files:**
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: 改发布文案（zh）**

`shared/i18n/zh-CN.js:144-145`：

```js
  'collab.dist.publish': '发给群生成升级',
  'collab.dist.published': '已发送，升级版本 v{version}',
```

- [ ] **Step 2: 改发布文案（en）**

`shared/i18n/en.js:144-145`：

```js
  'collab.dist.publish': 'Send to group & create upgrade',
  'collab.dist.published': 'Sent, upgrade v{version}',
```

- [ ] **Step 3: 新增群主词条（zh）**

`shared/i18n/zh-CN.js` 第 80 行 `'collab.member.title': '成员（{count}）',` 之后加入：

```js
  'collab.member.master': '群主',
```

- [ ] **Step 4: 新增群主词条（en）**

`shared/i18n/en.js` 第 80 行 `'collab.member.title': 'Members ({count})',` 之后加入：

```js
  'collab.member.master': 'Master',
```

- [ ] **Step 5: 新增弹窗词条（zh）**

`shared/i18n/zh-CN.js` 第 864 行 `'collab.task.items': '{count} 项',` 之后加入：

```js
  'collab.dist.task_popup.title': '收到群主分发',
  'collab.dist.task_popup.hint': '确认后安装到本机所选 agent 的 skills 目录，并合并工作流',
  'collab.dist.task_popup.accept': '确认安装',
  'collab.dist.task_popup.reject': '拒绝',
  'collab.dist.task_popup.accepted': '已安装',
  'collab.dist.task_popup.rejected': '已拒绝',
  'collab.dist.task_popup.later': '稍后',
```

- [ ] **Step 6: 新增弹窗词条（en）**

`shared/i18n/en.js` 第 857 行 `'collab.task.items': '{count} items',` 之后加入：

```js
  'collab.dist.task_popup.title': 'Distribution from master',
  'collab.dist.task_popup.hint': 'Confirm to install into the selected agent skills directory and merge workflows',
  'collab.dist.task_popup.accept': 'Install',
  'collab.dist.task_popup.reject': 'Reject',
  'collab.dist.task_popup.accepted': 'Installed',
  'collab.dist.task_popup.rejected': 'Rejected',
  'collab.dist.task_popup.later': 'Later',
```

- [ ] **Step 7: 校验 i18n**

Run: `npm.cmd run check:i18n`
Expected: 通过（无硬编码中文）

---

## Task 3: 成员表群主徽标

**Files:**
- Modify: `web/src/collaboration/MemberUsageTable.vue`
- Modify: `web/src/collaboration/GroupView.vue:353`
- Test: `web/src/collaboration/MemberUsageTable.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/collaboration/MemberUsageTable.test.ts` 末尾加入（并把 `mount` 增加 `group` prop 支持）：

```ts
  it('群主行显示群主徽标', async () => {
    const now = Date.now();
    const w = mount(
      { m1: { agent: '*', days: 1, machineId: 'm1', username: 'alice', host: 'h', port: 1, messages: 1, receivedAt: now } },
      { id: 'g', name: 'G', hubId: 'm1', createdAt: 1, members: [{ machineId: 'm1' }, { machineId: 'm2' }] },
    );
    await flushPromises();
    expect(w.text()).toContain('群主');
  });
```

同时把 `mount` 的 `props` 改为传入 `group`：

```ts
function mount(peers: Record<string, CollabUsage>, group: unknown = null) {
  const collab = { state: ref({ ...EMPTY_SNAPSHOT, group: group as never }) } as unknown as CollabApi;
  return mountC(MemberUsageTable, { props: { collab, peers, group: group as never }, global: { plugins: [ElementPlus], stubs: { teleport: true } } });
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/collaboration/MemberUsageTable.test.ts`
Expected: FAIL — 文本无「群主」

- [ ] **Step 3: 实现组件**

`web/src/collaboration/MemberUsageTable.vue`：

第 7 行 import 改为：

```ts
import type { CollabUsage, CollabGroup } from './types';
```

第 9-11 行改为：

```ts
const props = defineProps<{ collab: CollabApi; peers: Record<string, CollabUsage>; group?: CollabGroup | null }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const activeGroup = computed(() => props.group ?? snap.value.group);
const rows = computed(() => mergeMachines(props.peers, activeGroup.value?.members || []));
const hubId = computed(() => activeGroup.value?.hubId || '');
```

模板机器列（第 30 行 `not_in_group` tag 之前）加入：

```html
          <span v-if="row.machineId === hubId" class="crown">👑 {{ $t('collab.member.master') }}</span>
```

样式末尾加入：

```css
.crown { flex: none; margin-left: 6px; color: var(--warn); font-size: 11px; white-space: nowrap; }
```

- [ ] **Step 4: GroupView 传 group**

`web/src/collaboration/GroupView.vue:353`：

```html
          <MemberUsageTable v-if="mtab === 'members'" class="mtable" :collab="collab" :peers="peers" :group="group" />
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/collaboration/MemberUsageTable.test.ts`
Expected: PASS

---

## Task 4: buildPackage 记录 per-skill size/hash

**Files:**
- Modify: `server/collaboration/engine.js:199-206`
- Test: `server/test/collab-pack-detail.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/collab-pack-detail.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollabEngine } from '../collaboration/engine.js';
import { CollabStore } from '../collaboration/store.js';
import { loadIdentity } from '../collaboration/identity.js';
import { createSeedStore } from '../seed-store.js';

function tmpDir(name) { return fs.mkdtempSync(path.join(os.tmpdir(), name)); }

test('buildPackage 在 seed 明细里记录每个 skill 的 updatedAt/size/hash', async () => {
  const dir = tmpDir('df-pack-detail-');
  const skillsRoot = path.join(dir, 'skills');
  const demo = path.join(skillsRoot, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(path.join(demo, 'SKILL.md'), '# demo', 'utf8');
  const engine = new CollabEngine({
    store: new CollabStore({ file: path.join(dir, 'collab.json') }),
    identity: loadIdentity({ file: path.join(dir, 'identity.json'), username: 'u', host: '127.0.0.1', port: 0 }),
    skillsRoot,
    uploadDir: path.join(dir, 'upload'),
    downloadDir: path.join(dir, 'download'),
    downloadsDir: path.join(dir, 'downloads'),
    seedStore: createSeedStore({ file: path.join(dir, 'void.db'), logger: { warn() {} } }),
  });
  const rec = await engine.buildPackage({ skills: ['demo'] });
  const seed = engine.seedStore.get(rec.id);
  assert.ok(seed, 'seed 已记录');
  const s = seed.detail.skills[0];
  assert.equal(s.name, 'demo');
  assert.ok(s.size > 0, 'size > 0');
  assert.equal(String(s.hash).length, 64, 'sha256 十六进制');
  assert.ok(s.updatedAt > 0, 'updatedAt > 0');
  engine.seedStore.close();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-pack-detail.test.js"`
Expected: FAIL — `s.size` 为 `undefined`

- [ ] **Step 3: 实现**

`server/collaboration/engine.js` 第 199-206 行 `const detail = { ... }` 整体替换为：

```js
    const skillDetails = [];
    for (const n of sSel) {
      let size = null; let hash = null;
      try { const p = await packSkill(path.join(this.skillRoot(), n)); size = p.zip.length; hash = p.hash; } catch { /* 目录异常时留空 */ }
      skillDetails.push({
        name: n,
        files: files.filter((f) => f.rel.startsWith(`skills/${n}/`)).length,
        updatedAt: skillStat(n) || null,
        size,
        hash,
      });
    }
    const detail = {
      skills: skillDetails,
      workflow: pickedWorkflows.map((w) => ({ id: w.id, label: w.label, stages: (w.stages || []).length })),
    };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-pack-detail.test.js"`
Expected: PASS

---

## Task 5: publishPackage 生成升级 version

**Files:**
- Modify: `server/collaboration/engine.js:720-752`
- Test: `server/test/collab-dist-notify.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-dist-notify.test.js` 末尾加入：

```js
test('publishPackage 生成升级 version 并写入广播 meta 与返回', async () => {
  const { h, A } = await setupMaster();
  try {
    A.getWorkflows = () => [];
    fakePackage(A, { skills: ['demo'], id: 'pkg-ver' });
    const r = A.publishPackage('pkg-ver');
    assert.equal(r.code, 'ok');
    assert.ok(r.version, '返回 version');
    assert.equal(A.readUpdate().version, r.version, 'sync 表记录同一 version');
    const msg = A.store.listChatMessages(A.store.getGroup().id).filter((m) => m.kind === 'dist').pop();
    assert.equal(msg.meta.version, r.version, 'dist meta 带 version');
  } finally { await h.stop(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-dist-notify.test.js"`
Expected: FAIL — `r.version` 为 `undefined`

- [ ] **Step 3: 实现**

`server/collaboration/engine.js` 的 `publishPackage`：在 `this.writeDownload(name, buf, 'skill');`（约第 730 行）之后加入：

```js
    const up = this.publishUpdate([name]);
    const version = up.code === 'ok' ? up.update.version : '';
```

把 `_broadcastDist` 的 info（约第 743-749 行）加入 `version`：

```js
    this._broadcastDist(g.id, {
      name, packageId: rec.id, hash: rec.hash || '', size: buf.length, count, version,
      skills: skillList, command: cmdList, agent: agentList,
      workflow: wfIds.map((id) => ({ id, label: ((wfAll.find((w) => w.id === id) || {}).label) || id })),
      skillsUpdatedAt: seedRec?.skillsUpdatedAt || 0,
      workflowUpdatedAt: seedRec?.workflowUpdatedAt || 0,
    });
```

返回值（约第 751 行）改为：

```js
    return { code: 'ok', name, size: buf.length, version };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-dist-notify.test.js"`
Expected: PASS

---

## Task 6: engine.pollDistTasks

**Files:**
- Modify: `server/collaboration/engine.js`（在 `backfillDistTasks` 之后，约 359 行后）
- Test: `server/test/collab-dist-poll.test.js`

- [ ] **Step 1: 写失败测试**

创建 `server/test/collab-dist-poll.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPairHarness } from '../collaboration/engine.js';
import { createTaskStore } from '../task-store.js';

function tmpFile(name) { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-poll-')), name); }

function fakePackage(A, { skills = [], id = 'pkg-1' } = {}) {
  const zip = Buffer.from('PK-fake-' + id);
  const name = `${id}.zip`;
  fs.mkdirSync(A.downloadDir, { recursive: true });
  fs.writeFileSync(path.join(A.downloadDir, name), zip);
  A.uploadDir = A.downloadDir;
  return A.store.addOutbox({
    id, kind: 'file', groupId: null, skillName: null, fileName: name, storedFile: name,
    size: zip.length, hash: `hash-${id}`, createdAt: Date.now(),
    package: { sent: false, skills, command: [], agent: [], workflow: [] },
  });
}

test('pollDistTasks：成员侧从 hub 补出 pending 任务并返回统计', async () => {
  const h = await createPairHarness({ skipSkills: true });
  try {
    const [A, B] = h.nodes;
    const file = tmpFile('void.db');
    for (const n of [A, B]) n.taskStore = createTaskStore({ file, logger: { warn() {} } });
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    fakePackage(A, { skills: ['demo'], id: 'pkg-1' });
    A.publishPackage('pkg-1');
    const r = await B.pollDistTasks();
    assert.equal(r.code, 'ok');
    assert.ok(r.tasks >= 1, '有 pending 任务');
    assert.equal(B.listTasks({ status: 'pending' }).length, 1);
  } finally { await h.stop(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-dist-poll.test.js"`
Expected: FAIL — `B.pollDistTasks is not a function`

- [ ] **Step 3: 实现**

`server/collaboration/engine.js` 在 `backfillDistTasks()` 方法之后（第 359 行 `}` 之后）加入：

```js
  // 定时轮询：补分发任务 + 取各 master 最新升级 version（失败忽略，不阻塞）
  async pollDistTasks() {
    const groups = this.store.listGroups()
      .filter((g) => g.hubId !== this.pub.machineId && g.members.find((m) => m.machineId === this.pub.machineId));
    try { await this.backfillDistTasks(); } catch (e) { this.log?.warn?.('poll backfill failed', (e && e.message) || e); }
    const updates = [];
    for (const g of groups) {
      try {
        const c = await this.checkUpdate(g.hubId);
        if (c.code === 'ok' && c.newer && c.update) updates.push({ groupId: g.id, masterId: c.masterId, version: c.update.version });
      } catch { /* 单个 master 失败忽略 */ }
    }
    return { code: 'ok', groups: groups.length, tasks: this.listTasks({ status: 'pending' }).length, updates };
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-dist-poll.test.js"`
Expected: PASS

---

## Task 7: index.js 转发 tasks + 定时器

**Files:**
- Modify: `server/index.js:358-364`（事件转发）、`server/index.js:419`（定时器）

- [ ] **Step 1: 转发 tasks 事件**

`server/index.js` 第 364 行 `eventBus.on('heartbeat', ...)` 之后加入：

```js
  eventBus.on('tasks', (payload) => broadcastCollab(CollabS2C.COLLAB_TASKS, payload));
```

- [ ] **Step 2: 加非阻塞定时器**

`server/index.js` 第 419 行 `backfillDistTasks` 启动补扫那行之后加入：

```js
  // 分发任务定时轮询：补 master 下发的任务（非阻塞，默认 60s，可 DEVFLOW_DIST_POLL_MS 覆盖）
  const distPollMs = Number(process.env.DEVFLOW_DIST_POLL_MS) || 60000;
  const distPollTimer = setInterval(() => { ws.engine.pollDistTasks?.().catch(() => { /* 单次失败忽略 */ }); }, distPollMs);
  distPollTimer.unref?.();
```

- [ ] **Step 3: 跑 server 测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS

---

## Task 8: HTTP POST /api/collab/tasks/poll

**Files:**
- Modify: `server/collaboration/http-mount.js:241-248`
- Test: `server/test/collab-tasks-http.test.js`

- [ ] **Step 1: 写失败测试**

在 `server/test/collab-tasks-http.test.js` 的 `fakeEngine()` 里（第 21 行 `ignoreTask` 之后）加入：

```js
    pollDistTasks: async () => ({ code: 'ok', groups: 0, tasks: taskStore.list({ status: 'pending' }).length, updates: [] }),
```

在文件末尾加入：

```js
test('POST /api/collab/tasks/poll 触发轮询并返回统计', async () => {
  const { engine } = fakeEngine();
  const mount = createCollabMount({ engine, logger: { warn() {}, error() {} } });
  const r = await call(mount, 'POST', '/api/collab/tasks/poll');
  assert.equal(r.status, 200);
  assert.equal(r.json.code, 'ok');
  assert.equal(r.json.tasks, 1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "server/test/collab-tasks-http.test.js"`
Expected: FAIL — 404 或 `code !== 'ok'`

- [ ] **Step 3: 实现路由**

`server/collaboration/http-mount.js` 第 241 行 `tasks` GET 之前加入：

```js
      if (seg[0] === 'tasks' && seg.length === 2 && seg[1] === 'poll' && m === 'POST') {
        return ok(res, await engine.pollDistTasks());
      }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "server/test/collab-tasks-http.test.js"`
Expected: PASS

---

## Task 9: useCollab pollTasks + publish 类型

**Files:**
- Modify: `web/src/collaboration/useCollab.ts:124`（publishPackage）、`:137` 附近（tasks）
- Test: `web/src/collaboration/useCollab.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/collaboration/useCollab.test.ts` 的 API 冒烟用例（第 137 行 `await c.removeOutTask('o1');` 之后）加入：

```ts
    await c.pollTasks();
```

并在 URL 断言区（第 144 行附近）加入：

```ts
    expect(urls).toContain('/api/collab/tasks/poll');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/collaboration/useCollab.test.ts`
Expected: FAIL — `c.pollTasks is not a function`

- [ ] **Step 3: 实现**

`web/src/collaboration/useCollab.ts`：

`publishPackage` 返回类型加 `version`：

```ts
    publishPackage: (id: string) => post<{ code: string; name?: string; version?: string }>(`/api/collab/packages/${id}/publish`),
```

`listTasks` 之前加入：

```ts
    pollTasks: () => post<{ code: string; tasks?: number; updates?: { groupId: string; masterId?: string; version: string }[] }>('/api/collab/tasks/poll'),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/collaboration/useCollab.test.ts`
Expected: PASS

---

## Task 10: SkillDistributor 发布后显示版本

**Files:**
- Modify: `web/src/collaboration/SkillDistributor.vue:42`（`sent` 附近）、`:82-92`（`doPublish`）、`:156`（按钮）

- [ ] **Step 1: 实现**

`SkillDistributor.vue` 第 42 行 `const sent = ref(false);` 之后加入：

```ts
const publishedVersion = ref('');
```

`doPublish`（第 82-92 行）替换为：

```ts
async function doPublish() {
  if (!pkg.value) return;
  msg.value = ''; msgErr.value = ''; working.value = true;
  try {
    const r = await props.collab.publishPackage(pkg.value.id);
    if (r.code !== 'ok') { msgErr.value = t('common.send_failed', { msg: r.code }); return; }
    sent.value = true;
    publishedVersion.value = r.version || '';
    msg.value = t('collab.dist.published', { version: r.version || '—' });
  } catch (e: any) { msgErr.value = String(e?.message || e); }
  finally { working.value = false; }
}
```

- [ ] **Step 2: 跑 web 测试**

Run: `npm.cmd --prefix web run test -- src/collaboration/SkillDistributor.test.ts`
Expected: PASS（既有测试不受影响）

---

## Task 11: DistTaskNotifier 全局弹窗 + App.vue 挂载

**Files:**
- Create: `web/src/collaboration/DistTaskNotifier.vue`
- Create: `web/src/collaboration/DistTaskNotifier.test.ts`
- Modify: `web/src/App.vue`（import + 根容器挂载）

- [ ] **Step 1: 写失败测试**

创建 `web/src/collaboration/DistTaskNotifier.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { mountC } from '../test-utils';
import DistTaskNotifier from './DistTaskNotifier.vue';

const TASK = { id: 't1', groupId: 'g1', kind: 'skills', hash: 'h1', name: 'skills/a.zip', status: 'pending', payload: { skills: ['a'] } };

function mockCollab() {
  return {
    state: { value: null },
    refresh: vi.fn(async () => ({})),
    listTasks: vi.fn(async () => ({ tasks: [TASK] })),
    acceptTask: vi.fn(async () => ({ code: 'ok' })),
    ignoreTask: vi.fn(async () => ({ code: 'ignored' })),
  };
}
function mockTerminal() { return { on: vi.fn(() => () => {}) }; }

afterEach(() => { vi.restoreAllMocks(); });

describe('DistTaskNotifier', () => {
  it('有 pending 任务时弹窗显示，确认调 acceptTask', async () => {
    const collab = mockCollab();
    const w = mountC(DistTaskNotifier, {
      props: { collab: collab as never, terminal: mockTerminal() as never },
      global: { plugins: [ElementPlus], stubs: { teleport: true } },
    });
    await flushPromises();
    expect(w.text()).toContain('skills/a.zip');
    const btns = w.findAll('button');
    const accept = btns.find((b) => b.text().includes('确认安装'));
    expect(accept).toBeTruthy();
    await accept!.trigger('click');
    await flushPromises();
    expect(collab.acceptTask).toHaveBeenCalledWith('t1');
  });

  it('拒绝调 ignoreTask', async () => {
    const collab = mockCollab();
    const w = mountC(DistTaskNotifier, {
      props: { collab: collab as never, terminal: mockTerminal() as never },
      global: { plugins: [ElementPlus], stubs: { teleport: true } },
    });
    await flushPromises();
    const reject = w.findAll('button').find((b) => b.text().includes('拒绝'));
    await reject!.trigger('click');
    await flushPromises();
    expect(collab.ignoreTask).toHaveBeenCalledWith('t1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test -- src/collaboration/DistTaskNotifier.test.ts`
Expected: FAIL — 找不到组件

- [ ] **Step 3: 实现组件**

创建 `web/src/collaboration/DistTaskNotifier.vue`：

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { CollabS2C } from '@devflow/shared/collab';
import { useCollab, type CollabApi } from './useCollab';
import type { useTerminal } from '../useTerminal';
import { kindKeyOf, taskItemCount, type DistTask } from './distTasks';
import { t } from '../i18n';

const props = defineProps<{ terminal: ReturnType<typeof useTerminal>; collab?: CollabApi }>();
const api = props.collab ?? useCollab();
const pending = ref<DistTask[]>([]);
const open = ref(false);
const busy = ref('');
const msg = ref('');
let unsubs: (() => void)[] = [];

async function loadPending() {
  try {
    const r = await api.listTasks('pending');
    pending.value = r.tasks || [];
    if (pending.value.length) open.value = true;
  } catch { /* 离线保持现状 */ }
}
async function accept(task: DistTask) {
  busy.value = task.id; msg.value = '';
  try {
    const r = await api.acceptTask(task.id);
    msg.value = r.code === 'ok' ? t('collab.dist.task_popup.accepted') : t('collab.task.accept_failed', { msg: r.code });
  } catch (e: any) { msg.value = t('collab.task.accept_failed', { msg: String(e?.message || e) }); }
  finally { busy.value = ''; await loadPending(); if (!pending.value.length) open.value = false; }
}
async function reject(task: DistTask) {
  busy.value = task.id; msg.value = '';
  try { await api.ignoreTask(task.id); } finally { busy.value = ''; await loadPending(); if (!pending.value.length) open.value = false; }
}
onMounted(async () => {
  try { await api.refresh(); } catch { /* ignore */ }
  await loadPending();
  unsubs = [props.terminal.on(CollabS2C.COLLAB_TASKS, () => { loadPending(); })];
});
onBeforeUnmount(() => { unsubs.forEach((u) => u()); });
const total = computed(() => pending.value.reduce((n, x) => n + taskItemCount(x), 0));
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="mask">
      <div class="box" role="dialog" aria-modal="true">
        <div class="title">{{ $t('collab.dist.task_popup.title') }}</div>
        <div class="meta">{{ $t('collab.dist.task_popup.hint') }}</div>
        <div class="list">
          <div v-for="task in pending" :key="task.id" class="row">
            <span class="ic">{{ task.kind === 'workflow' ? '🧩' : '🛠' }}</span>
            <div class="info">
              <span class="nm">{{ $t(kindKeyOf(task.kind)) }} · {{ task.name }}</span>
              <span class="sub">{{ $t('collab.task.items', { count: taskItemCount(task) }) }}</span>
            </div>
            <button class="btn" :disabled="busy === task.id" @click="reject(task)">{{ $t('collab.dist.task_popup.reject') }}</button>
            <button class="btn primary" :disabled="busy === task.id" @click="accept(task)">{{ $t('collab.dist.task_popup.accept') }}</button>
          </div>
        </div>
        <div v-if="msg" class="ok">{{ msg }}</div>
        <div class="foot">
          <span class="cnt">{{ $t('collab.task.items', { count: total }) }}</span>
          <button class="btn" @click="open = false">{{ $t('collab.dist.task_popup.later') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.box { width: 520px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 18px 20px 14px; }
.title { font-size: 15px; font-weight: 600; color: var(--tx1); }
.meta { color: var(--tx6); font-size: 12px; margin: 6px 0 10px; }
.list { max-height: 260px; overflow: auto; border: 1px solid var(--bd2); border-radius: 6px; }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--bd2); }
.row:last-child { border-bottom: none; }
.ic { flex: none; font-size: 18px; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.nm { color: var(--tx1); font-weight: 600; word-break: break-all; }
.sub { color: var(--tx6); font-size: 11px; }
.ok { color: var(--ok, #22c55e); font-size: 13px; margin-top: 10px; }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; }
.cnt { color: var(--tx6); font-size: 12px; }
.btn { padding: 5px 14px; border-radius: 4px; border: 1px solid var(--bd); background: var(--bg2); color: var(--tx2); cursor: pointer; font-size: 13px; font-family: inherit; }
.btn.primary { background: var(--ac); border-color: var(--ac); color: #fff; }
.btn:disabled { opacity: .55; cursor: default; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test -- src/collaboration/DistTaskNotifier.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: App.vue 挂载**

`web/src/App.vue`：在 `import CollaborationView from './collaboration/CollaborationView.vue';`（第 7 行）之后加入：

```ts
import DistTaskNotifier from './collaboration/DistTaskNotifier.vue';
```

在模板根容器 `.app` 的闭合 `</div>` 之前（`<style scoped>` 之前的最后一个 `</div>`，约第 658 行）加入：

```html
    <DistTaskNotifier :terminal="terminal" />
```

- [ ] **Step 6: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过

---

## Task 12: 全量验证

- [ ] **Step 1: server 测试**

Run: `npm.cmd run test:server`
Expected: 全部 PASS

- [ ] **Step 2: web 测试**

Run: `npm.cmd run test:web`
Expected: 全部 PASS

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过

- [ ] **Step 4: i18n 检查**

Run: `npm.cmd run check:i18n`
Expected: 通过

- [ ] **Step 5: 人工验收（spec §5）**

1. 群成员表群主那行显示 👑 群主。
2. 群主打包 → 「发给群生成升级」→ 显示升级版本；SQLite seed 有各 skill 的 size/hash。
3. slave 起服务 ≤60s 内本地任务表出现任务并弹窗；确认后 skills 进所选 agent 目录、workflow 并入本地；拒绝后 ignored。

- [ ] **Step 6: 单次提交（用户同意后）**

```bash
git add shared/collab.js shared/i18n/zh-CN.js shared/i18n/en.js server/collaboration/engine.js server/collaboration/http-mount.js server/index.js server/test/collab-const.test.js server/test/collab-pack-detail.test.js server/test/collab-dist-poll.test.js server/test/collab-tasks-http.test.js web/src/collaboration/MemberUsageTable.vue web/src/collaboration/GroupView.vue web/src/collaboration/MemberUsageTable.test.ts web/src/collaboration/useCollab.ts web/src/collaboration/useCollab.test.ts web/src/collaboration/SkillDistributor.vue web/src/collaboration/DistTaskNotifier.vue web/src/collaboration/DistTaskNotifier.test.ts web/src/App.vue
git commit -m "feat(collab): 群主标记 + 发给群生成升级 + slave 定时轮询确认安装"
```

---

## 自检记录

- **Spec 覆盖**：§4.1→Task 3；§4.2→Task 2/4/5/10；§4.3→Task 1/6/7/8/9/11；§4.4→沿用现有（Task 6 的 `acceptTask` 路径，已有 `collab-dist-accept.test.js` 覆盖 workflow 合并）；i18n→Task 2；shared 常量→Task 1。
- **占位符**：无 TBD/TODO；代码步骤均含完整代码。
- **类型一致性**：`CollabS2C.COLLAB_TASKS`（Task 1）在 Task 11 使用一致；`pollDistTasks` 返回 `{code,groups,tasks,updates}`（Task 6/8/9 一致）；`publishPackage` 返回 `version`（Task 5/9/10 一致）；`DistTaskNotifier` props `{terminal, collab?}`（Task 11 与测试一致）。
