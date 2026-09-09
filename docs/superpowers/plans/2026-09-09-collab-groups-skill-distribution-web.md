# 群组协作与 Skill 分发（web）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `statistic` 分支实现协作子系统前端：左侧 rail 新增「👥 通讯录」，点击切换中央整页为协作视图（好友/群组/技能分发/收件箱），复用现有 `/ws` 收推送、`fetch('/api/collab/*')` 操作。

**Architecture:** 复用现有 Vue3 SPA（无 router）。`App.vue` 左侧 rail（`explorer | sessions | contacts`）加 `contacts`；`contacts` 选中时中央渲染 `CollaborationView` 全页（替代终端）。协作页挂载时 `GET /api/collab/snapshot` 拉全量状态；收到 `CollabS2C` 推送或操作完成后调 `refresh()`。所有 HTTP 封装在 `useCollab.ts`。隔离：新文件全在 `web/src/collaboration/`；只改 `web/src/App.vue`。

**统一子组件契约（全 plan 一致，勿改）：**
- `useCollab()` 返回 `{ state: Ref<CollabSnapshot | null>, lastError: Ref<string>, refresh, updateIdentity, requestFriend, acceptFriend, removeFriend, createGroup, inviteMember, kickMember, deleteGroup, acceptInvite, rejectInvite, listSkills, distributeToGroup, installInbox, ignoreInbox, removeInbox }`，导出 `type CollabApi = ReturnType<typeof useCollab>`。
- `state` 是 `Ref`，容器持有；子视图通过 prop `collab: CollabApi` 接收后 `const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT)`，**模板里一律用 `snap.xxx`，绝不写 `.value`**；操作用 `props.collab.xxx()`。
- `EMPTY_SNAPSHOT` 由 `types.ts` 导出。

**前置约束（照做，勿改）：**
- 不改 `shared/index.js`、`server/**`、`web/src/useTerminal.ts`、`web/src/components/*`（现有终端组件不动）。
- 只允许改 `web/src/App.vue` + 新增 `web/src/collaboration/**`。
- 仓库 **没有** `@vue/test-utils`，组件不做 mount 测试；测试只写纯逻辑（`*.test.ts`，vitest，mock fetch）。Web 命令：`npm.cmd --prefix web run typecheck`、`npm.cmd --prefix web run test`。根目录 `npm.cmd test` 跑 server+web。
- 浏览器命令走 HTTP；实时推送订阅 `CollabS2C`（useTerminal default 分支已 emit 未知 type）。

---

## Task 1: types.ts + useCollab.ts（纯逻辑 + 测试）

**Files:**
- Create: `web/src/collaboration/types.ts`
- Create: `web/src/collaboration/useCollab.ts`
- Create: `web/src/collaboration/useCollab.test.ts`

- [ ] **Step 1: 写 types.ts**

Create: `web/src/collaboration/types.ts`

```ts
export interface CollabProfile { machineId: string; username: string; host: string; port: number; publicKey: string; }
export interface CollabFriend extends CollabProfile { addedAt?: number; }
export interface CollabMember extends CollabProfile { role: 'owner' | 'admin' | 'member'; }
export interface CollabGroup { id: string; name: string; ownerId: string | null; createdAt: number; members: CollabMember[]; }
export interface CollabInboxItem { id: string; fromId: string; groupId: string | null; skillName: string; hash: string; size: number; status: 'received' | 'installed' | 'ignored' | 'invalid'; receivedAt: number; }
export interface CollabGroupSkill { groupId: string; skillName: string; hash: string; distributedBy: string; installed: boolean; }
export interface CollabPendingFriend extends CollabProfile { requestedAt?: number; }
export interface CollabInvite { id: string; groupId: string; groupName: string; inviter: CollabProfile; receivedAt?: number; }
export interface CollabSnapshot {
  identity: CollabProfile;
  friends: CollabFriend[];
  pendingFriends: CollabPendingFriend[];
  groups: CollabGroup[];
  pendingInvites: CollabInvite[];
  skillsInbox: CollabInboxItem[];
  groupSkills: CollabGroupSkill[];
}

export const EMPTY_SNAPSHOT: CollabSnapshot = {
  identity: { machineId: '', username: '', host: '', port: 0, publicKey: '' },
  friends: [], pendingFriends: [], groups: [], pendingInvites: [], skillsInbox: [], groupSkills: [],
};
```

- [ ] **Step 2: 写 useCollab.test.ts（失败先行）**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useCollab } from './useCollab';

function jsonRes(obj: unknown, ok = true) {
  return { ok, json: async () => obj } as unknown as Response;
}
afterEach(() => vi.restoreAllMocks());

describe('useCollab', () => {
  it('refresh 拉取 snapshot 并写入 state', async () => {
    const snap = {
      identity: { machineId: 'm', username: 'u', host: 'h', port: 1, publicKey: 'k' },
      friends: [], pendingFriends: [], groups: [], pendingInvites: [], skillsInbox: [], groupSkills: [],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(snap));
    const c = useCollab();
    await c.refresh();
    expect(c.state.value?.identity.machineId).toBe('m');
  });

  it('requestFriend 带 host/port POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'requested' }));
    const c = useCollab();
    const r = await c.requestFriend('192.168.1.5', 3001);
    expect(r).toEqual({ code: 'requested' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/collab/friends');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ host: '192.168.1.5', port: 3001 });
  });

  it('installInbox 打到正确路由', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'installed' }));
    const c = useCollab();
    await c.installInbox('in-1');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/inbox/in-1/install');
  });

  it('kickMember 打到 members/kick 路由', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'kicked' }));
    const c = useCollab();
    await c.kickMember('g1', 'target');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/groups/g1/members/target/kick');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm.cmd --prefix web run test`
Expected: 仅新文件失败（useCollab 模块不存在），旧用例全过。

- [ ] **Step 4: 写 useCollab.ts**

Create: `web/src/collaboration/useCollab.ts`

```ts
import { ref, type Ref } from 'vue';
import type { CollabSnapshot } from './types';

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || j.message || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function useCollab() {
  const state: Ref<CollabSnapshot | null> = ref(null);
  const lastError = ref('');

  async function refresh(): Promise<CollabSnapshot> {
    try {
      const s = await http<CollabSnapshot>('/api/collab/snapshot');
      state.value = s; lastError.value = '';
      return s;
    } catch (e) { lastError.value = String((e as Error).message || e); throw e; }
  }
  async function post<T = Record<string, unknown>>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    return http<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  return {
    state, lastError, refresh,
    async updateIdentity(host: string, port: number) { await post('/api/collab/identity', { host, port }); return refresh(); },
    requestFriend: (host: string, port: number) => post('/api/collab/friends', { host, port }),
    async acceptFriend(machineId: string) { return post(`/api/collab/friends/${machineId}/accept`); },
    async removeFriend(machineId: string) { await http(`/api/collab/friends/${machineId}`, { method: 'DELETE' }); return refresh(); },
    createGroup: (name: string) => post('/api/collab/groups', { name }),
    inviteMember: (groupId: string, machineId: string) => post(`/api/collab/groups/${groupId}/invite`, { machineId }),
    kickMember: (groupId: string, machineId: string) => post(`/api/collab/groups/${groupId}/members/${machineId}/kick`),
    async deleteGroup(groupId: string) { await http(`/api/collab/groups/${groupId}`, { method: 'DELETE' }); return refresh(); },
    acceptInvite: (inviteId: string) => post(`/api/collab/invites/${inviteId}/accept`),
    rejectInvite: (inviteId: string) => post(`/api/collab/invites/${inviteId}/reject`),
    listSkills: () => http<{ skills: { name: string }[] }>('/api/collab/skills'),
    distributeToGroup: (groupId: string, skillNames: string[]) => post(`/api/collab/groups/${groupId}/distribute`, { skillNames }),
    installInbox: (id: string) => post(`/api/collab/inbox/${id}/install`),
    ignoreInbox: (id: string) => post(`/api/collab/inbox/${id}/ignore`),
    async removeInbox(id: string) { await http(`/api/collab/inbox/${id}`, { method: 'DELETE' }); return refresh(); },
  };
}

export type CollabApi = ReturnType<typeof useCollab>;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm.cmd --prefix web run test`
Expected: useCollab 4 个用例全过，旧用例不受影响

- [ ] **Step 6: typecheck**

Run: `npm.cmd --prefix web run typecheck`
Expected: 通过

- [ ] **Step 7: Commit**

```bash
git add web/src/collaboration/types.ts web/src/collaboration/useCollab.ts web/src/collaboration/useCollab.test.ts
git commit -m "feat(collab): web collab API client (useCollab)"
```

---

## Task 2: CollaborationView 容器

**Files:**
- Create: `web/src/collaboration/CollaborationView.vue`

- [ ] **Step 1: 写 CollaborationView.vue（容器：身份卡 + tab 切换 + 推送刷新）**

Create: `web/src/collaboration/CollaborationView.vue`

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { CollabS2C } from '@devflow/shared/collab';
import { useCollab } from './useCollab';
import { EMPTY_SNAPSHOT } from './types';
import type { useTerminal } from '../useTerminal';
import FriendsView from './FriendsView.vue';
import GroupsView from './GroupsView.vue';
import SkillDistributor from './SkillDistributor.vue';
import InboxView from './InboxView.vue';

const props = defineProps<{ terminal: ReturnType<typeof useTerminal> }>();
const collab = useCollab();
const snap = computed(() => collab.state.value ?? EMPTY_SNAPSHOT);
const tab = ref<'friends' | 'groups' | 'skills' | 'inbox'>('friends');
const tabs = [
  { id: 'friends' as const, label: '好友' },
  { id: 'groups' as const, label: '群组' },
  { id: 'skills' as const, label: '技能分发' },
  { id: 'inbox' as const, label: '收件箱' },
];
const pendingCount = computed(() => snap.value.pendingFriends.length + snap.value.pendingInvites.length + snap.value.skillsInbox.filter((i) => i.status === 'received').length);

let unsubs: (() => void)[] = [];
onMounted(() => {
  collab.refresh().catch(() => {});
  unsubs = [
    props.terminal.on(CollabS2C.COLLAB_SYNCED, () => collab.refresh().catch(() => {})),
    props.terminal.on(CollabS2C.COLLAB_FRIEND_REQ, () => collab.refresh().catch(() => {})),
    props.terminal.on(CollabS2C.COLLAB_GROUP_INVITE, () => collab.refresh().catch(() => {})),
    props.terminal.on(CollabS2C.COLLAB_INBOX, () => collab.refresh().catch(() => {})),
  ];
});
onBeforeUnmount(() => { unsubs.forEach((u) => u()); });
</script>

<template>
  <div class="cv">
    <header class="topbar">
      <span class="title">👥 通讯录</span>
      <nav class="tabs">
        <button v-for="t in tabs" :key="t.id" class="tab" :class="{ on: tab === t.id }" @click="tab = t.id">
          {{ t.label }}<span v-if="t.id !== 'skills' && t.id === 'friends' && pendingCount" class="badge">{{ pendingCount }}</span>
        </button>
      </nav>
      <div class="idbar" v-if="snap.identity.machineId">
        {{ snap.identity.username }} · {{ snap.identity.host }}:{{ snap.identity.port }}
        <span class="fp">{{ snap.identity.publicKey.slice(-8) }}</span>
      </div>
      <span v-if="collab.lastError" class="err">{{ collab.lastError }}</span>
    </header>
    <section class="body">
      <FriendsView v-if="tab === 'friends'" :collab="collab" />
      <GroupsView v-else-if="tab === 'groups'" :collab="collab" />
      <SkillDistributor v-else-if="tab === 'skills'" :collab="collab" />
      <InboxView v-else :collab="collab" />
    </section>
  </div>
</template>

<style scoped>
.cv { display: flex; flex-direction: column; height: 100%; background: #161b21; }
.topbar { display: flex; align-items: center; gap: 14px; padding: 0 14px; height: 46px; border-bottom: 1px solid #2a323e; flex: none; }
.title { font-weight: 700; color: #6aa2ff; }
.tabs { display: flex; gap: 4px; }
.tab { background: none; border: none; color: #9aa4b2; padding: 6px 10px; cursor: pointer; border-radius: 4px; }
.tab.on { background: #2f6feb; color: #fff; }
.badge { margin-left: 4px; background: #ef4444; color: #fff; border-radius: 8px; padding: 0 5px; font-size: 10px; }
.idbar { margin-left: auto; color: #9aa4b2; font-size: 12px; display: flex; align-items: center; gap: 6px; }
.fp { color: #6b7686; font-family: monospace; font-size: 11px; }
.err { color: #ff6b6b; font-size: 12px; }
.body { flex: 1; min-height: 0; overflow: auto; }
</style>
```

- [ ] **Step 2: typecheck**

Run: `npm.cmd --prefix web run typecheck`
Expected: 报错缺 FriendsView 等子组件（尚未创建）——这是预期；**先把四个子组件建好再统一 typecheck**（见 Task 5 的 typecheck 步骤）。若允许逐文件，可临时跳过未创建 import 的报错。

- [ ] **Step 3: Commit（子组件创建后一次提交更顺；若坚持独立提交，可仅当 typecheck 不因缺失组件报错时）**

建议：Task 2~4 全部实现后合并执行 Task 5 的 typecheck + 一次提交，降低中间态。若分开提交，则每个 Task 提交前需保证 `vue-tsc` 不因缺文件失败（可在该 Task 内先建 stub 子组件）。**实现约定：先完成 Task 3/4 子组件，最后 Task 5 统一 typecheck。** 本 Task 不单独 commit（其 commit 并入 Task 5 前的提交或 Task 5 的收尾提交）。

---

## Task 3: FriendsView + GroupsView

**Files:**
- Create: `web/src/collaboration/FriendsView.vue`
- Create: `web/src/collaboration/GroupsView.vue`

- [ ] **Step 1: 写 FriendsView.vue**

Create: `web/src/collaboration/FriendsView.vue`

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const host = ref('');
const port = ref<number | null>(null);
const err = ref('');

async function add() {
  err.value = '';
  try {
    await props.collab.requestFriend(host.value.trim(), Number(port.value));
    await props.collab.refresh();
    host.value = ''; port.value = null;
  } catch (e) { err.value = String((e as Error).message || e); }
}
async function accept(machineId: string) { await props.collab.acceptFriend(machineId); await props.collab.refresh(); }
async function remove(machineId: string) { if (confirm('删除好友？')) await props.collab.removeFriend(machineId); }
</script>

<template>
  <div class="fw">
    <div class="form">
      <input v-model="host" placeholder="IP 地址" />
      <input v-model.number="port" type="number" placeholder="端口" />
      <button @click="add">＋ 添加好友</button>
    </div>
    <div v-if="err" class="err">{{ err }}</div>
    <h4>待确认好友</h4>
    <div v-if="snap.pendingFriends.length === 0" class="empty">暂无</div>
    <div v-for="p in snap.pendingFriends" :key="p.machineId" class="row">
      <span>{{ p.username }} ({{ p.host }}:{{ p.port }})</span>
      <button @click="accept(p.machineId)">接受</button>
    </div>
    <h4>好友</h4>
    <div v-if="snap.friends.length === 0" class="empty">暂无好友，输入对方 IP:端口 添加</div>
    <div v-for="f in snap.friends" :key="f.machineId" class="row">
      <span class="nm">{{ f.username }}</span>
      <span class="adr">{{ f.host }}:{{ f.port }}</span>
      <button class="del" @click="remove(f.machineId)">×</button>
    </div>
  </div>
</template>

<style scoped>
.fw { padding: 14px; }
.form { display: flex; gap: 6px; margin-bottom: 8px; }
input { background: #222932; border: 1px solid #2a323e; color: #d5dae1; border-radius: 4px; padding: 5px 8px; }
button { background: #2f6feb; color: #fff; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; }
button.del { background: none; color: #ff6b6b; }
h4 { color: #9aa4b2; text-transform: uppercase; font-size: 11px; margin: 14px 0 6px; }
.row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid #232b34; }
.nm { color: #e2e8f0; }
.adr { color: #6b7686; font-family: monospace; font-size: 11px; margin-left: auto; }
.empty { color: #6b7686; padding: 8px; }
.err { color: #ff6b6b; }
</style>
```

- [ ] **Step 2: 写 GroupsView.vue**

Create: `web/src/collaboration/GroupsView.vue`

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const name = ref('');
const err = ref('');
const selectedGroup = ref<string | null>(null);
const inviteMachineId = ref('');

async function create() {
  err.value = '';
  try { await props.collab.createGroup(name.value.trim()); await props.collab.refresh(); name.value = ''; }
  catch (e) { err.value = String((e as Error).message || e); }
}
function select(gid: string) { selectedGroup.value = selectedGroup.value === gid ? null : gid; }
async function acceptInvite(id: string) { await props.collab.acceptInvite(id); await props.collab.refresh(); }
async function rejectInvite(id: string) { await props.collab.rejectInvite(id); await props.collab.refresh(); }
async function invite(gid: string) {
  if (!inviteMachineId.value.trim()) return;
  await props.collab.inviteMember(gid, inviteMachineId.value.trim());
  inviteMachineId.value = '';
}
async function kick(gid: string, mid: string) {
  const g = snap.value.groups.find((x) => x.id === gid);
  const who = g?.members.find((m) => m.machineId === mid);
  if (who && confirm(`把 ${who.username} 移出群？`)) { await props.collab.kickMember(gid, mid); await props.collab.refresh(); }
}
async function removeGroup(gid: string) { if (confirm('解散群？')) { await props.collab.deleteGroup(gid); await props.collab.refresh(); } }
function roleLabel(r: string) { return r === 'owner' ? '群主' : r === 'admin' ? '管理员' : '成员'; }
</script>

<template>
  <div class="gw">
    <div v-if="err" class="err">{{ err }}</div>
    <h4>待入群邀请</h4>
    <div v-if="snap.pendingInvites.length === 0" class="empty">暂无</div>
    <div v-for="iv in snap.pendingInvites" :key="iv.id" class="invite">
      <span>「{{ iv.groupName }}」邀请你入群（{{ iv.inviter.username }}）</span>
      <button @click="acceptInvite(iv.id)">接受</button>
      <button class="ghost" @click="rejectInvite(iv.id)">拒绝</button>
    </div>
    <div class="create">
      <input v-model="name" placeholder="群名称" @keyup.enter="create" />
      <button @click="create">＋ 建群</button>
    </div>
    <h4>我的群</h4>
    <div v-if="snap.groups.length === 0" class="empty">还没有群，创建一个吧</div>
    <div v-for="g in snap.groups" :key="g.id" class="group">
      <div class="ghead">
        <button class="gname" @click="select(g.id)">{{ g.name }} <span class="cnt">({{ g.members.length }})</span></button>
        <button v-if="g.ownerId === snap.identity?.machineId" class="ghost del" @click="removeGroup(g.id)">解散</button>
      </div>
      <div v-if="selectedGroup === g.id" class="gdetail">
        <div class="inv-form">
          <input v-model="inviteMachineId" placeholder="成员 machineId" />
          <button @click="invite(g.id)">邀请</button>
        </div>
        <div v-for="m in g.members" :key="m.machineId" class="mrow">
          <span class="nm">{{ m.username }}</span>
          <span class="role" :class="m.role">{{ roleLabel(m.role) }}</span>
          <span class="adr">{{ m.host }}:{{ m.port }}</span>
          <button v-if="m.machineId !== snap.identity?.machineId" class="ghost del" @click="kick(g.id, m.machineId)">踢出</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gw { padding: 14px; }
.create { display: flex; gap: 6px; margin: 10px 0; }
input { background: #222932; border: 1px solid #2a323e; color: #d5dae1; border-radius: 4px; padding: 5px 8px; }
button { background: #2f6feb; color: #fff; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; }
button.ghost { background: none; border: 1px solid #2a323e; color: #9aa4b2; }
button.del { color: #ff6b6b; border-color: #3a2530; }
button.gname { background: none; color: #e2e8f0; text-align: left; padding: 8px 6px; font-size: 13px; }
.cnt { color: #6b7686; }
h4 { color: #9aa4b2; text-transform: uppercase; font-size: 11px; margin: 14px 0 6px; }
.invite, .group { border-bottom: 1px solid #232b34; padding: 6px 4px; }
.invite span { color: #c8d0da; }
.ghead { display: flex; align-items: center; }
.gdetail { padding: 4px 8px 8px; background: #171c22; border-radius: 6px; }
.inv-form { display: flex; gap: 6px; margin: 6px 0; }
.mrow { display: flex; align-items: center; gap: 8px; padding: 4px 2px; }
.nm { color: #e2e8f0; }
.role { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
.role.owner { background: #7c3aed; color: #fff; }
.role.admin { background: #b45309; color: #fff; }
.role.member { background: #334155; color: #cbd5e1; }
.adr { color: #6b7686; font-family: monospace; font-size: 11px; margin-left: auto; }
.empty { color: #6b7686; padding: 8px; }
.err { color: #ff6b6b; }
</style>
```

- [ ] **Step 3: typecheck（与 Task 5 一起跑，见 Task 5 Step 3）**

---

## Task 4: SkillDistributor + InboxView

**Files:**
- Create: `web/src/collaboration/SkillDistributor.vue`
- Create: `web/src/collaboration/InboxView.vue`

- [ ] **Step 1: 写 SkillDistributor.vue**

Create: `web/src/collaboration/SkillDistributor.vue`

```vue
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const skills = ref<{ name: string }[]>([]);
const checked = ref<Record<string, boolean>>({});
const targetGroup = ref<string | null>(null);
const result = ref('');
const err = ref('');

onMounted(loadSkills);
watch(() => snap.value.groups, (groups) => {
  if (!targetGroup.value && groups.length) targetGroup.value = groups[0].id;
}, { deep: true });

async function loadSkills() {
  try { const r = await props.collab.listSkills(); skills.value = r.skills; }
  catch (e) { err.value = String((e as Error).message || e); }
}
async function distribute() {
  const names = Object.keys(checked.value).filter((n) => checked.value[n]);
  if (!names.length || !targetGroup.value) { result.value = '请先勾选技能并选择群'; return; }
  err.value = '';
  try {
    const r = await props.collab.distributeToGroup(targetGroup.value, names);
    result.value = `已推送到 ${r?.pushed ?? 0} 个成员${(r as { failures?: unknown[] } | undefined)?.failures?.length ? `，失败 ${(r as { failures: unknown[] }).failures.length} 个` : ''}`;
  } catch (e) { err.value = String((e as Error).message || e); }
}
</script>

<template>
  <div class="sd">
    <h4>本机 skills</h4>
    <div v-if="skills.length === 0" class="empty">没有可分发技能（~/.config/opencode/skills 下需含 SKILL.md）</div>
    <label v-for="s in skills" :key="s.name" class="skill">
      <input type="checkbox" :value="s.name" v-model="checked[s.name]" />
      {{ s.name }}
    </label>
    <h4>分发给群</h4>
    <select v-model="targetGroup">
      <option v-for="g in snap.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
    </select>
    <button @click="distribute">⚡ 发起分发</button>
    <div v-if="result" class="ok">{{ result }}</div>
    <div v-if="err" class="err">{{ err }}</div>
  </div>
</template>

<style scoped>
.sd { padding: 14px; }
h4 { color: #9aa4b2; text-transform: uppercase; font-size: 11px; margin: 12px 0 6px; }
.skill { display: block; padding: 4px 0; color: #c8d0da; }
select { background: #222932; color: #d5dae1; border: 1px solid #2a323e; border-radius: 4px; padding: 5px 8px; margin-right: 8px; }
button { background: #2f6feb; color: #fff; border: none; border-radius: 4px; padding: 5px 12px; cursor: pointer; }
.empty { color: #6b7686; padding: 8px; }
.ok { color: #22c55e; margin-top: 8px; }
.err { color: #ff6b6b; margin-top: 8px; }
</style>
```

- [ ] **Step 2: 写 InboxView.vue**

Create: `web/src/collaboration/InboxView.vue`

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);

async function install(id: string) {
  if (!confirm('skill 含未知脚本，将安装到本机 ~/.config/opencode/skills。确认？')) return;
  await props.collab.installInbox(id); await props.collab.refresh();
}
async function ignore(id: string) { await props.collab.ignoreInbox(id); await props.collab.refresh(); }
async function remove(id: string) { if (confirm('删除该包？')) await props.collab.removeInbox(id); }
function fmtSize(n: number) { return n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; }
</script>

<template>
  <div class="ib">
    <div class="warn">⚠️ 收到的 skill 为未知代码，安装前请确认来源可信。</div>
    <div v-if="snap.skillsInbox.length === 0" class="empty">暂无收到的技能包</div>
    <div v-for="it in snap.skillsInbox" :key="it.id" class="item">
      <div class="info">
        <span class="nm">{{ it.skillName }}</span>
        <span class="meta">来自 {{ it.fromId.slice(0, 6) }} · {{ fmtSize(it.size) }} · {{ it.hash.slice(0, 8) }}</span>
      </div>
      <div class="acts">
        <template v-if="it.status === 'received'">
          <button @click="install(it.id)">安装</button>
          <button class="ghost" @click="ignore(it.id)">忽略</button>
        </template>
        <span v-else-if="it.status === 'installed'" class="state ok">已安装</span>
        <span v-else-if="it.status === 'ignored'" class="state">已忽略</span>
        <span v-else-if="it.status === 'invalid'" class="state bad">无效包</span>
        <button class="ghost del" @click="remove(it.id)">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ib { padding: 14px; }
.warn { background: #3a2a12; color: #eab308; border: 1px solid #4a3a1a; border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; }
.item { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #232b34; padding: 8px 4px; }
.info { flex: 1; }
.nm { color: #e2e8f0; font-weight: 600; }
.meta { color: #6b7686; font-size: 11px; margin-left: 8px; font-family: monospace; }
.acts { display: flex; gap: 6px; align-items: center; }
button { background: #2f6feb; color: #fff; border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button.ghost { background: none; border: 1px solid #2a323e; color: #9aa4b2; }
button.del { color: #ff6b6b; }
.state { font-size: 11px; color: #9aa4b2; }
.state.ok { color: #22c55e; }
.state.bad { color: #ff6b6b; }
.empty { color: #6b7686; padding: 8px; }
</style>
```

- [ ] **Step 3: Commit（Task 2~4 组件合并提交）**

```bash
git add web/src/collaboration/CollaborationView.vue web/src/collaboration/FriendsView.vue web/src/collaboration/GroupsView.vue web/src/collaboration/SkillDistributor.vue web/src/collaboration/InboxView.vue
git commit -m "feat(collab): collaboration views (contacts/groups/distribute/inbox)"
```

---

## Task 5: App.vue rail 接线 + 统一 typecheck

**Files:**
- Modify: `web/src/App.vue`

- [ ] **Step 1: 读 App.vue 现状确认行号**

当前 `rail` 为 `'explorer' | 'sessions'`；activity 栏两按钮；`<aside class="side">` 与 `<section class="center">` 为 `.main` 的子节点。

- [ ] **Step 2: 改 App.vue（最小 diff）**

script 改动：

```ts
import CollaborationView from './collaboration/CollaborationView.vue';
const rail = ref<'explorer' | 'sessions' | 'contacts'>('explorer');
```

template 改动：activity 栏新增第三按钮：

```html
        <button class="a-btn" :class="{ on: rail === 'contacts' }" title="通讯录" @click="rail = 'contacts'">👥</button>
```

`.main` 内改为分支渲染（contacts 时隐藏侧栏、中央显示协作视图）：

```html
    <div class="main">
      <aside class="activity">
        <button class="a-btn" :class="{ on: rail === 'explorer' }" title="目录" @click="rail = 'explorer'">▤</button>
        <button class="a-btn" :class="{ on: rail === 'sessions' }" title="会话" @click="rail = 'sessions'">▦</button>
        <button class="a-btn" :class="{ on: rail === 'contacts' }" title="通讯录" @click="rail = 'contacts'">👥</button>
      </aside>
      <template v-if="rail === 'contacts'">
        <section class="center">
          <CollaborationView :terminal="terminal" />
        </section>
      </template>
      <template v-else>
        <aside class="side">
          <SessionList v-if="rail === 'sessions'" :terminal="terminal" :project-id="currentProject" />
          <FileTree v-else :project-id="currentProject" @open-file="openFile" />
        </aside>
        <section class="center">
          <TerminalView :terminal="terminal" :center="center" :project-id="currentProject" />
        </section>
      </template>
    </div>
```

- [ ] **Step 3: typecheck + vitest**

Run: `npm.cmd --prefix web run typecheck`；`npm.cmd --prefix web run test`
Expected: 全绿（此时 Task 1~4 文件已齐）

> 若 typecheck 报 `props.terminal` 类型问题：`CollaborationView` 的 props 类型应为 `ReturnType<typeof useTerminal>`，并 `import type { useTerminal } from '../useTerminal'`（纯类型导入，与 TerminalView.vue 的既有写法一致，无副作用）。

- [ ] **Step 4: Commit**

```bash
git add web/src/App.vue
git commit -m "feat(collab): wire contacts rail into App.vue"
```

---

## Task 6: 收尾 — 全量测试与手动冒烟

- [ ] **Step 1: 全量根测试**

Run: `npm.cmd test`
Expected: server + web 全绿

- [ ] **Step 2: typecheck**

Run: `npm.cmd run typecheck`
Expected: 通过

- [ ] **Step 3: 手动冒烟（可选）**

后端与前端分开起（`Start-Process` 非阻塞）：

```powershell
Start-Process -FilePath node -ArgumentList 'server/index.js' -WorkingDirectory <repo> -RedirectStandardOutput dev-s.log -RedirectStandardError dev-s-err.log
Start-Process -FilePath npm.cmd -ArgumentList '--prefix','web','run','dev' -WorkingDirectory <repo> -RedirectStandardOutput dev-w.log -RedirectStandardError dev-w-err.log
```

浏览器开 `http://localhost:5173`，点左侧「👥」应看到身份卡 + 四个 tab。加好友需对端也跑着服务（两台机器分别启动验证跨机握手）。验证后 `Stop-Process` 清理。

- [ ] **Step 4: git status 确认隔离**

Run: `git status`
Expected: 新增全在 `web/src/collaboration/**`；改动仅 `web/src/App.vue`；未碰 `server/**`、`shared/index.js`、`web/src/components/*`、`web/src/useTerminal.ts`。

- [ ] **Step 5: Commit（若冒烟有残留则收尾）**

```bash
git add -A
git commit -m "chore(collab): finalize web collab UI"
```

---

## 完成标准

- 左侧 rail 有「👥 通讯录」，点击切中央整页协作视图并可切回终端页。
- 协作页 4 个 tab 可用：好友（加/接受/删除）、群组（建/详情/邀请/踢人/待入群）、技能分发（勾选本机 skill → 选群分发）、收件箱（安装/忽略/删除）。
- `CollabS2C` 推送触发自动刷新；有红点计数（待确认好友+邀请+received 包）。
- `npm.cmd test` 全绿；`npm.cmd run typecheck` 通过。
- 改动文件：新增 `web/src/collaboration/**`，修改 `web/src/App.vue`；其余 master 文件未动。
