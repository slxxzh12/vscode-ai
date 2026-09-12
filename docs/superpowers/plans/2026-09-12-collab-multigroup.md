# 协作多群并存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 协作页支持同时加入多个 master 群；群列表展示，每群成员/token 消耗与简单聊天；自己的群也入列。

**Architecture:** 后端 `store.group` 单例改 `groups[]`（id=hub machineId，旧数据迁移）；engine 各函数改为群感知；snapshot 增 `groups`。前端左栏加群列表 + 加入输入，选中群驱动聊天/成员。

**Tech Stack:** Node ESM、`node:test`、Vue3+TS。

**Spec:** `docs/superpowers/specs/2026-09-12-relay-plugins-cache-design.md`（§22）

**约定:** 仓库根执行；`npm.cmd`；每 Task 一提交。

---

### Task 1: store 多群

**Files:**
- Modify: `server/collaboration/store.js`
- Test: `server/test/collab-store.test.js`

- [ ] **Step 1: 改测试**

`collab-store.test.js` 第 16 行 `assert.equal(s.data.group, null);` → `assert.deepEqual(s.data.groups, []);`。

「单例群组 ensure/get/addMember/persist」用例替换为：

```js
test('多群 ensure/get/addMember/persist', () => {
  const f = tmpFile();
  const s = new CollabStore({ file: f });
  const self = { machineId: 'me', username: 'u', host: 'h', port: 1, publicKey: 'k' };
  const g = s.ensureGroup({ name: 'shared', hubId: 'me', self });
  assert.equal(g.id, 'me');
  assert.equal(g.members.length, 1);
  assert.equal(s.getGroup().id, 'me');
  assert.equal(s.ownedGroup('me').id, 'me');
  s.addGroupMember('me', { machineId: 'peer', username: 'p', host: 'h2', port: 2, publicKey: 'k2' });
  assert.equal(s.getGroup().members.length, 2);
  s.addGroupMember('me', { machineId: 'peer', username: 'p', host: 'h2', port: 2, publicKey: 'k2' });
  assert.equal(s.getGroup().members.length, 2, '去重');
  s.upsertGroup({ id: 'other', name: 'g2', hubId: 'hub2', createdAt: 1, members: [] });
  assert.equal(s.listGroups().length, 2);
  assert.equal(s.findGroup('other').name, 'g2');
  s.save();
  const s2 = new CollabStore({ file: f });
  assert.equal(s2.getGroup().members.length, 2);
  assert.equal(s2.listGroups().length, 2);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/collab-store.test.js"`
Expected: FAIL

- [ ] **Step 3: 实现** — `server/collaboration/store.js`

`defaultData()` 中 `group: null,` 替换为 `groups: [],`。

`_load()` 替换为：

```js
  _load() {
    if (fs.existsSync(this.file)) {
      try {
        const data = { ...defaultData(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
        if (!Array.isArray(data.groups)) data.groups = [];
        if (!data.groups.length && data.group) {
          const g = data.group;
          if (g.id === 'shared' && g.hubId) g.id = g.hubId;
          data.groups = [g];
        }
        delete data.group;
        return data;
      } catch (e) { this.log?.warn?.('store corrupt, reset', e.message); }
    }
    return defaultData();
  }
```

把 `getGroup/findGroup/listGroups/ensureGroup/setGroup/saveGroup/upsertGroup/addGroupMember` 整段替换为：

```js
  // ---- 群组（多个并存）----
  listGroups() { return this.data.groups; }
  getGroup(id) { return id ? this.findGroup(id) : (this.data.groups[0] || null); }
  findGroup(id) { return this.data.groups.find((g) => g.id === id) || null; }
  ownedGroup(machineId) { return this.data.groups.find((g) => g.hubId === machineId) || null; }
  ensureGroup({ name, hubId, self }) {
    const existing = this.ownedGroup(hubId);
    if (existing) return existing;
    const g = { id: hubId, name, createdAt: Date.now(), hubId, members: [{ ...self }] };
    this.data.groups.push(g);
    this.save();
    return g;
  }
  upsertGroup(group) {
    const i = this.data.groups.findIndex((g) => g.id === group.id);
    if (i >= 0) this.data.groups[i] = group; else this.data.groups.push(group);
    this.save();
    return group;
  }
  setGroup(group) { return this.upsertGroup(group); }
  saveGroup(group) { return this.upsertGroup(group); }
  addGroupMember(groupId, profile) {
    const g = this.findGroup(groupId);
    if (!g) return null;
    if (!g.members.find((m) => m.machineId === profile.machineId)) g.members.push({ ...profile });
    this.save();
    return g;
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/collab-store.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/collaboration/store.js server/test/collab-store.test.js
git commit -m "feat(collab): store 支持多群并存"
```

---

### Task 2: engine 群感知

**Files:**
- Modify: `server/collaboration/engine.js`
- Test: `server/test/collab-engine.test.js`

- [ ] **Step 1: 改测试**

`collab-engine.test.js` 第一个用例改为（id 不再是 shared，而是本地 machineId）：

```js
test('multi-group: ensureGroup 幂等且成员去重', () => {
  return createPairHarness({ skipSkills: true }).then(async (h) => {
    try {
      const A = h.nodes[0];
      const g1 = A.ensureGroup();
      const g2 = A.ensureGroup();
      assert.equal(g1.id, A.pub.machineId);
      assert.equal(g2.id, A.pub.machineId);
      assert.equal(A.store.getGroup().members.length, 1);
      assert.equal(A.store.getGroup().hubId, A.pub.machineId);
      assert.equal(A.store.listGroups().length, 1);
    } finally { await h.stop(); }
  });
});
```

第二个用例追加多群断言：B 加入 A 后，B 同时保留自有群 + A 的群：

```js
    assert.equal(B.store.listGroups().length, 2, 'B 自有群 + 加入的群');
    assert.ok(B.store.ownedGroup(B.pub.machineId), 'B 自有群保留');
    assert.ok(B.store.findGroup(ok.group.id), 'B 含 A 的群');
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/collab-engine.test.js"`
Expected: FAIL

- [ ] **Step 3: 实现** — `server/collaboration/engine.js`

`profileByPublicKey` 体内 `getGroup()` 查找改为遍历：

```js
  profileByPublicKey(pem) {
    if (!pem) return null;
    for (const g of this.store.listGroups()) {
      const m = g.members.find((x) => x.publicKey === pem);
      if (m) return m;
    }
    return null;
  }
```

`_knownProfile` 改为：

```js
  _knownProfile(machineId) {
    if (!machineId) return null;
    for (const g of this.store.listGroups()) {
      const m = g.members.find((x) => x.machineId === machineId);
      if (m) return m;
    }
    return null;
  }
```

`joinByLink` 中 `this.store.setGroup(group);` → `this.store.upsertGroup(group);`。

`_inJoin` 替换为：

```js
  async _inJoin(env) {
    if (typeof this.verifyAccessToken !== 'function' || !this.verifyAccessToken(env.payload && env.payload.token)) {
      return { ok: false, error: 'bad-token' };
    }
    const g = this.store.ownedGroup(this.pub.machineId) || this.ensureGroup();
    g.hubId = this.pub.machineId;
    this.store.addGroupMember(g.id, env.from);
    await this._broadcastMemberSync(g);
    this._emit('synced', {});
    return { ok: true, data: { group: g } };
  }
```

`_inMemberSync` 替换为：

```js
  _inMemberSync(env) {
    const g = env.payload.group;
    if (!g || !Array.isArray(g.members)) return { ok: false, error: 'bad-payload' };
    const local = this.store.findGroup(g.id);
    if (!local) this.store.upsertGroup({ ...g });
    else {
      for (const m of g.members) if (!local.members.find((x) => x.machineId === m.machineId)) local.members.push(m);
      this.store.upsertGroup(local);
    }
    this._emit('synced', {});
    return { ok: true };
  }
```

`reportHeartbeat` 替换为：

```js
  reportHeartbeat(usage) {
    const groups = this.store.listGroups().filter((g) => g.members.find((m) => m.machineId === this.pub.machineId));
    if (!groups.length) return Promise.resolve({ code: 'no-group' });
    const tasks = [];
    for (const g of groups) {
      if (g.hubId === this.pub.machineId) {
        this.store.setHeartbeat(this.pub.machineId, { ...usage, receivedAt: Date.now() });
        this.writeUsageSnapshot();
      } else {
        const hub = g.members.find((m) => m.machineId === g.hubId);
        if (hub) tasks.push(this._post(hub.host, hub.port, this._sign(CollabPeer.HEARTBEAT, { groupId: g.id, usage })));
      }
    }
    this._emit('heartbeat', {});
    return Promise.all(tasks).then(() => ({ code: 'ok' }));
  }
```

`_inHeartbeat` 首行改为按 groupId 定位：

```js
    const g = this.store.findGroup(env.payload && env.payload.groupId) || this.store.getGroup();
```

`pullDownloads` 首行改为选一个远端群：

```js
    const g = this.store.listGroups().find((x) => x.hubId !== this.pub.machineId && x.members.find((m) => m.machineId === this.pub.machineId)) || this.store.getGroup();
```

并把其中 `if (data.group) this.store.setGroup(data.group);` → `if (data.group) this.store.upsertGroup(data.group);`。

`_inPullDownloads` 首行改为：

```js
    const g = this.store.ownedGroup(this.pub.machineId) || this.store.getGroup();
```

`publishPackage` 首行改为：

```js
    const g = this.store.ownedGroup(this.pub.machineId);
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/collab-engine.test.js" "server/test/collab-chat.test.js" "server/test/heartbeat.test.js"`
Expected: PASS（`collab-chat` 的 `saveGroup` 仍可用；heartbeat 用例见下）

> 若 `heartbeat.test.js` 断言依赖单群，按 Task 2 的语义调整：两群时 `reportHeartbeat` 对自有群写本地、对加入群 POST。

- [ ] **Step 5: 提交**

```
git add server/collaboration/engine.js server/test/collab-engine.test.js
git commit -m "feat(collab): engine 群感知（多群并存）"
```

---

### Task 3: snapshot 暴露 groups

**Files:**
- Modify: `server/collaboration/http-mount.js`
- Test: `server/test/collab-http.test.js`、`server/test/collab-index.test.js`

- [ ] **Step 1: 改测试**

`collab-index.test.js:52` `assert.equal(body.group, null);` → `assert.equal(body.group, null); assert.deepEqual(body.groups, []);`（保留 group 兼容）。

`collab-http.test.js`：
- `assert.equal(snap.group, null);` → 保留，另加 `assert.deepEqual(snap.groups, []);`。
- `assert.ok(A.engine.store.getGroup().members.find(...))` → `assert.ok(A.engine.store.getGroup().members.find(...))` 不变（getGroup 返回第一个=自有群）。
- `assert.equal(list.group, null);` → 保留，加 `assert.deepEqual(list.groups, []);`。
- 「群聊与远程执行 REST 冒烟」等已用多群不敏感逻辑。

- [ ] **Step 2: 运行确认失败**

Run: `node --test "server/test/collab-index.test.js" "server/test/collab-http.test.js"`
Expected: FAIL（`groups` 未定义）

- [ ] **Step 3: 实现** — `server/collaboration/http-mount.js`

两处 `getGroup()` 的返回对象增加 `groups`：

```js
          group: engine.store.getGroup(),
          groups: engine.store.listGroups(),
```

```js
        return ok(res, { manifest: engine.readManifest(), usage: { members: engine.store.listHeartbeats() }, group: engine.store.getGroup(), groups: engine.store.listGroups() });
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test "server/test/collab-index.test.js" "server/test/collab-http.test.js"`
Expected: PASS

- [ ] **Step 5: 提交**

```
git add server/collaboration/http-mount.js server/test/collab-index.test.js server/test/collab-http.test.js
git commit -m "feat(collab): snapshot 暴露多群 groups"
```

---

### Task 4: 前端群列表

**Files:**
- Modify: `web/src/collaboration/types.ts`
- Modify: `web/src/collaboration/GroupView.vue`
- Modify: `web/src/collaboration/GroupChatView.vue`
- Modify: `web/src/collaboration/SkillDistributor.vue`
- Modify: `web/src/collaboration/TasksView.vue`
- Modify: `shared/i18n/zh-CN.js`、`shared/i18n/en.js`

- [ ] **Step 1: `types.ts`**

`CollabSnapshot` 增加：

```ts
  groups: CollabGroup[];
```

`EMPTY_SNAPSHOT` 增加 `groups: [],`。

- [ ] **Step 2: 组件按群查找**

`GroupChatView.vue` 与 `SkillDistributor.vue` 中：

```ts
const group = computed(() => (snap.value.group && snap.value.group.id === props.groupId ? snap.value.group : null));
```

替换为：

```ts
const group = computed(() => (snap.value.groups || []).find((g) => g.id === props.groupId) || null);
```

`TasksView.vue` 的 `groupName`：

```ts
const groupName = (gid: string | null) => (snap.value.groups || []).find((g) => g.id === gid)?.name || '';
```

- [ ] **Step 3: `GroupView.vue` 群列表**

script：把 `const group = computed(() => snap.value.group);` 替换为：

```ts
const groups = computed(() => snap.value.groups || []);
const activeId = ref<string | null>(null);
const mine = computed(() => groups.value.find((g) => g.hubId === snap.value.identity.machineId) || null);
const group = computed(() => groups.value.find((g) => g.id === activeId.value) || mine.value || groups.value[0] || null);
watch(groups, (gs) => { if (!gs.find((g) => g.id === activeId.value)) activeId.value = (mine.value || gs[0] || {} as any).id ?? null; }, { immediate: true });
```

（`watch` 已在 Vue 中可用；`import { ref, computed, onMounted, watch } from 'vue'`。）

模板：在「开启 master 模式」区块之前插入「我的群组」区块：

```html
      <div class="sec">
        <h4>{{ $t('collab.groups.title') }}</h4>
        <div v-if="!groups.length" class="empty">{{ $t('collab.groups.empty') }}</div>
        <button v-for="g in groups" :key="g.id" class="gitem" :class="{ on: group?.id === g.id }" @click="activeId = g.id">
          {{ g.name }} <span class="sub">{{ g.hubId === snap.identity.machineId ? $t('collab.groups.mine') : '' }} · {{ g.members.length }}</span>
        </button>
      </div>
```

样式追加：

```css
.gitem { text-align: left; background: none; border: 1px solid var(--bd); border-radius: 4px; color: var(--tx2); padding: 5px 8px; font-size: 12px; cursor: pointer; font-family: inherit; margin-bottom: 4px; }
.gitem.on { background: var(--ac); color: var(--onac); border-color: var(--ac); }
.gitem .sub { color: var(--tx6); margin-left: 6px; }
```

- [ ] **Step 4: i18n**

`zh-CN.js` 增加：

```js
  'collab.groups.title': '我的群组',
  'collab.groups.empty': '暂无群组，粘贴下方邀请链接加入',
  'collab.groups.mine': '我的',
```

`en.js` 增加：

```js
  'collab.groups.title': 'My groups',
  'collab.groups.empty': 'No groups yet; paste an invite link below to join',
  'collab.groups.mine': 'mine',
```

- [ ] **Step 5: 类型 + i18n**

Run: `npm.cmd run typecheck`
Run: `npm.cmd run check:i18n`
Expected: 均通过。

- [ ] **Step 6: 提交**

```
git add web/src/collaboration/types.ts web/src/collaboration/GroupView.vue web/src/collaboration/GroupChatView.vue web/src/collaboration/SkillDistributor.vue web/src/collaboration/TasksView.vue shared/i18n/zh-CN.js shared/i18n/en.js
git commit -m "feat(web): 协作多群列表与切换"
```

---

### Task 5: 全量验证

- [ ] **Step 1:** `npm.cmd run test:server` → 全绿。
- [ ] **Step 2:** `npm.cmd run test:web` → 全绿。
- [ ] **Step 3:** `npm.cmd run typecheck`、`check:i18n`、`build:web` → 全绿。
- [ ] **Step 4: 人工验收**：A 开 master 生成邀请；B 粘贴加入后，B 群列表出现「自己的群 + A 的群」；切换群查看成员/token 消耗与聊天；A 端成员用量可见。

---

## 自查记录

- **Spec 覆盖**：§22.1 → Task 1；§22.2 → Task 2；§22.3 → Task 3/4；§22.4 → 各 Task + Task 5。
- **占位符扫描**：无 TBD。
- **一致性**：`groups` 字段在 store/engine/snapshot/types 全链路一致；`group` 保留为第一个群兼容旧断言。
- **范围**：下载/技能分发不按群隔离（沿用），符合用户限定的「列表 + 用量 + 简单聊天」。
