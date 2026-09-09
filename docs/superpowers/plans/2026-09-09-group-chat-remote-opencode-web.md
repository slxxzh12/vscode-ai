# 群聊 + @ 远程 opencode（web）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `statistic` 分支的协作前端实现群聊界面：群详情内聊天消息流 + 输入框（支持 `@` 下拉、`/command` 远程执行发起、结果展示、待确认卡片、白名单管理）。

**Architecture:** 复用 `web/src/collaboration/*` 现有模式。`useCollab` 扩展聊天 API（state 里每群独立 `chat: { messages, pendingCmds, allowlist }`）；新增 `GroupChatView.vue`（消息流 + 输入 + 待确认 + 白名单）；`GroupsView.vue` 点群名进入聊天视图；`CollaborationView.vue` 订阅 `COLLAB_CHAT` / `COLLAB_CMD_PENDING` 推送刷新。隔离：新文件在 `web/src/collaboration/**`；只小改现有 `web/src/collaboration/*`（本身即隔离目录，非 master 文件）。

**Tech Stack:** Vue3 `<script setup>` + TS，vitest 纯逻辑测试（无 @vue/test-utils）。命令：`npm.cmd --prefix web run typecheck` / `npm.cmd --prefix web run test`。

**前置约束（照做，勿改）：**
- 不改 `web/src/components/*`、`web/src/useTerminal.ts`、`web/src/App.vue`（已接好通讯录整页）。只动 `web/src/collaboration/**`。
- `useCollab` 保持 `state` 为 Ref<CollabSnapshot|null>；聊天独立于 snapshot 存于 `chat` refs（见 Task 1 契约），避免 snapshot 每消息全量刷新。
- server 侧新 REST（本 plan 依赖）：
  - `GET /api/collab/groups/:gid/chat?afterSeq=` → `{ messages }`
  - `POST /api/collab/groups/:gid/chat` body `{ text, toId|null }`
  - `POST /api/collab/groups/:gid/cmd` body `{ text, toId }`
  - `POST /api/collab/groups/:gid/chat-pull` body `{ machineId }`（离线补拉）
  - `GET /api/collab/cmds` → `{ pending }`
  - `POST /api/collab/cmds/:reqId/approve` body `{ approve }`
  - `GET /api/collab/allowlist`、`POST /api/collab/allowlist` body `{ prefix }`、`DELETE /api/collab/allowlist/:prefix`

---

## Task 1: types + useCollab 扩展（纯逻辑 + 测试）

**Files:**
- Modify: `web/src/collaboration/types.ts`
- Modify: `web/src/collaboration/useCollab.ts`
- Modify: `web/src/collaboration/useCollab.test.ts`

- [ ] **Step 1: types.ts 增加 chat 相关类型**

Append to `web/src/collaboration/types.ts`:

```ts
export interface CollabChatMeta { reqId: string | null; exitCode: number | null; stderr: string | null; durationMs: number | null; }
export type CollabChatKind = 'text' | 'cmd-result' | 'system';
export interface CollabChatMessage {
  id: string; groupId: string; kind: CollabChatKind;
  fromId: string; text: string; toId: string | null;
  meta: CollabChatMeta | null; ts: number; seq: number;
}
export interface CollabPendingCmd { id: string; groupId: string; fromId: string; text: string; receivedAt: number; }
```

- [ ] **Step 2: 写失败的测试（追加到 `useCollab.test.ts`）**

```ts
import { useCollab } from './useCollab';
import { CollabS2C } from '@devflow/shared/collab';

describe('useCollab chat', () => {
  it('chat() 返回消息并写入 chatState', async () => {
    const msgs = [{ id: 'm1', groupId: 'g1', kind: 'text', fromId: 'a', text: 'hi', toId: null, meta: null, ts: 1, seq: 1 }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ messages: msgs }));
    const c = useCollab();
    await c.chat('g1');
    expect(c.chatState.value['g1'].messages.length).toBe(1);
  });

  it('sendChat POST 到 /groups/:gid/chat', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'ok' }));
    const c = useCollab();
    await c.sendChat('g1', 'hello', null);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/collab/groups/g1/chat');
    expect(JSON.parse(init?.body as string)).toEqual({ text: 'hello', toId: null });
  });

  it('sendCmd 触发到 /groups/:gid/cmd', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'sent', reqId: 'r1' }));
    const c = useCollab();
    await c.sendCmd('g1', '@bob go', 'b-id');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/groups/g1/cmd');
  });

  it('approveCmd 打到 /cmds/:reqId/approve', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'approved' }));
    const c = useCollab();
    await c.approveCmd('r1', true);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/cmds/r1/approve');
  });

  it('handleS2C(COLLAB_CHAT) 触发 chat 重新拉取', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ messages: [] }));
    const c = useCollab();
    await c.handleS2C(CollabS2C.COLLAB_CHAT, { groupId: 'g9' });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/collab/groups/g9/chat');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm.cmd --prefix web run test`
Expected: 新增用例失败（方法/字段不存在），旧用例通过

- [ ] **Step 4: useCollab.ts 增加 chat 能力**

在 `useCollab.ts` 顶部 import 追加：`import type { CollabChatMessage, CollabPendingCmd } from './types';`

在函数体 `const lastError = ref('');` 之后加：

```ts
  const chatState = ref<Record<string, { messages: CollabChatMessage[] }>>({});
  const pendingCmdState = ref<CollabPendingCmd[]>([]);
  const allowlistState = ref<string[]>([]);

  function ensureChat(groupId: string) {
    if (!chatState.value[groupId]) chatState.value[groupId] = { messages: [] };
    return chatState.value[groupId];
  }
  async function chat(groupId: string): Promise<CollabChatMessage[]> {
    const r = await http<{ messages: CollabChatMessage[] }>(`/api/collab/groups/${groupId}/chat`);
    ensureChat(groupId).messages = r.messages;
    return r.messages;
  }
  async function sendChat(groupId: string, text: string, toId: string | null) {
    const r = await post(`/api/collab/groups/${groupId}/chat`, { text, toId });
    await chat(groupId);
    return r;
  }
  async function sendCmd(groupId: string, text: string, toId: string) {
    return post(`/api/collab/groups/${groupId}/cmd`, { text, toId });
  }
  async function pullChat(groupId: string, machineId: string) {
    const r = await post<{ code: string; messages?: CollabChatMessage[] }>(`/api/collab/groups/${groupId}/chat-pull`, { machineId });
    if (r.code === 'ok' && r.messages) { const g = ensureChat(groupId); for (const m of r.messages) if (!g.messages.some((x) => x.id === m.id)) g.messages.push(m); g.messages.sort((a, b) => a.seq - b.seq); }
    return r;
  }
  async function loadPendingCmds() {
    const r = await http<{ pending: CollabPendingCmd[] }>('/api/collab/cmds');
    pendingCmdState.value = r.pending;
    return r.pending;
  }
  async function approveCmd(reqId: string, approve: boolean) { return post(`/api/collab/cmds/${reqId}/approve`, { approve }); }
  async function loadAllowlist() {
    const r = await http<{ allowlist: string[] }>('/api/collab/allowlist');
    allowlistState.value = r.allowlist;
    return r.allowlist;
  }
  async function addAllow(prefix: string) { await post('/api/collab/allowlist', { prefix }); return loadAllowlist(); }
  async function removeAllow(prefix: string) { await http(`/api/collab/allowlist/${encodeURIComponent(prefix)}`, { method: 'DELETE' }); return loadAllowlist(); }

  async function handleS2C(type: string, payload: Record<string, unknown>) {
    if (type === 'collab-chat') {
      const gid = payload.groupId as string | undefined;
      if (gid) await chat(gid).catch(() => {});
    } else if (type === 'collab-cmd-pending') {
      await loadPendingCmds().catch(() => {});
    }
  }
```

在 return 对象中加入：

```ts
    chatState, pendingCmdState, allowlistState,
    chat, sendChat, sendCmd, pullChat, loadPendingCmds, approveCmd, loadAllowlist, addAllow, removeAllow, handleS2C,
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm.cmd --prefix web run test`
Expected: 新增 5 个用例全过

- [ ] **Step 6: typecheck**

Run: `npm.cmd --prefix web run typecheck`
Expected: 通过

- [ ] **Step 7: Commit**

```bash
git add web/src/collaboration/types.ts web/src/collaboration/useCollab.ts web/src/collaboration/useCollab.test.ts
git commit -m "feat(collab): useCollab chat/remote-cmd/pending/allowlist APIs"
```

---

## Task 2: chat 解析纯函数 + 测试

**Files:**
- Create: `web/src/collaboration/chat-parser.ts`
- Create: `web/src/collaboration/chat-parser.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from 'vitest';
import { parseComposer, splitAtCommand, filterMentions, MessageSegment } from './chat-parser';

describe('chat-parser', () => {
  it('filterMentions 按关键词过滤群成员', () => {
    const members = [
      { machineId: 'a', username: 'alice' },
      { machineId: 'b', username: 'bob' },
    ];
    expect(filterMentions(members, 'a').map((m) => m.username)).toEqual(['alice']);
    expect(filterMentions(members, '').map((m) => m.username)).toEqual(['alice', 'bob']);
  });

  it('isCommand 判定 /command 前缀', () => {
    expect(parseComposer('/command 跑测试', 'bob').isCommand).toBe(true);
    expect(parseComposer('hello world', 'bob').isCommand).toBe(false);
  });

  it('isCommand 但缺 @ 目标时返回 missingTarget', () => {
    const r = parseComposer('/command 跑测试', null);
    expect(r.isCommand).toBe(true);
    expect(r.missingTarget).toBe(true);
  });

  it('splitAtCommand 把 @目标 与正文分开', () => {
    const seg = splitAtCommand('@bob 帮我看看', 'bob', 'b-id');
    expect(seg.toId).toBe('b-id');
    expect(seg.text).toBe('帮我看看');
  });

  it('消息渲染成 @别名 高亮段', () => {
    const segs: MessageSegment[] = highlightMentions('@bob 帮我看看', { b: 'bob' });
    expect(segs.some((s) => s.mention)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm.cmd --prefix web run test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `chat-parser.ts`**

```ts
export interface MentionMember { machineId: string; username: string; }

export function filterMentions(members: MentionMember[], keyword: string): MentionMember[] {
  const k = keyword.trim().toLowerCase();
  return members.filter((m) => !k || m.username.toLowerCase().includes(k));
}

export interface ComposerParse { isCommand: boolean; missingTarget: boolean; }
export function parseComposer(text: string, atMember: MentionMember | null): ComposerParse {
  const isCommand = /^\s*\/command(?:\s|$)/.test(text);
  if (!isCommand) return { isCommand: false, missingTarget: false };
  return { isCommand: true, missingTarget: !atMember };
}

export interface TargetSplit { toId: string | null; text: string; }
// 从 "@username 正文" 还原 toId 与正文；找不到 @ 开头则原样
export function splitAtCommand(raw: string, username: string, machineId: string): TargetSplit {
  const m = raw.match(/^\s*@([^\s]+)([\s\S]*)$/);
  if (!m) return { toId: null, text: raw.trim() };
  return { toId: machineId, text: (m[2] || '').trim() || username };
}

export interface MessageSegment { text: string; mention: boolean; }
export function highlightMentions(text: string, nameById: Record<string, string>): MessageSegment[] {
  const out: MessageSegment[] = [];
  const re = /@([\w-]+)/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), mention: false });
    const id = m[1];
    out.push({ text: `@${nameById[id] ?? id}`, mention: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  if (!out.length) out.push({ text, mention: false });
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm.cmd --prefix web run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/collaboration/chat-parser.ts web/src/collaboration/chat-parser.test.ts
git commit -m "feat(collab): chat composer & highlight parser pure functions"
```

---

## Task 3: GroupChatView.vue

**Files:**
- Create: `web/src/collaboration/GroupChatView.vue`

- [ ] **Step 1: 写 GroupChatView.vue**

`GroupChatView` 职责：渲染某群消息流 + 输入框 + 本机待确认卡片 + 白名单小管理（全部用 `props.collab` 与 `props.groupId`）。

```vue
<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import { filterMentions, parseComposer, splitAtCommand, highlightMentions } from './chat-parser';
import type { CollabChatMessage } from './types';

const props = defineProps<{ collab: CollabApi; groupId: string }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const group = computed(() => snap.value.groups.find((g) => g.id === props.groupId) || null);
const chat = computed(() => props.collab.chatState.value[props.groupId] || { messages: [] });
const me = computed(() => snap.value.identity.machineId);
const myPending = computed(() => props.collab.pendingCmdState.value.filter((p) => p.groupId === props.groupId));
const nameById = computed(() => {
  const map: Record<string, string> = {};
  for (const m of group.value?.members ?? []) map[m.machineId] = m.username;
  return map;
});

const composer = ref('');
const showMentions = ref(false);
const mentionKeyword = ref('');
const mentionMembers = computed(() => filterMentions(group.value?.members ?? [], mentionKeyword.value).filter((m) => m.machineId !== me.value));
const msgListEl = ref<HTMLElement | null>(null);

async function scrollBottom() { await nextTick(); msgListEl.value?.scrollTo({ top: msgListEl.value.scrollHeight }); }
function onComposerInput() {
  const atIdx = composer.value.lastIndexOf('@');
  mentionKeyword.value = atIdx >= 0 ? composer.value.slice(atIdx + 1) : '';
  showMentions.value = atIdx >= 0;
}
function pickMention(m: { machineId: string; username: string }) {
  const atIdx = composer.value.lastIndexOf('@');
  composer.value = composer.value.slice(0, atIdx) + `@${m.username} `;
  showMentions.value = false;
}
async function submit() {
  const raw = composer.value.trim();
  if (!raw) return;
  const atMatch = raw.match(/^\s*@([^\s]+)\s/);
  const atMember = group.value?.members.find((m) => m.username === (atMatch?.[1] ?? '')) ?? null;
  const parsed = parseComposer(raw, atMember);
  if (parsed.isCommand) {
    if (parsed.missingTarget) { alert('先 @ 一个群成员再发命令'); return; }
    const seg = splitAtCommand(raw, atMember!.username, atMember!.machineId);
    await props.collab.sendCmd(props.groupId, seg.text, seg.toId!);
  }
  await props.collab.sendChat(props.groupId, raw, atMember?.machineId ?? null);
  composer.value = '';
  await scrollBottom();
}

async function decide(p: { id: string }, approve: boolean) {
  await props.collab.approveCmd(p.id, approve);
  await props.collab.loadPendingCmds().catch(() => {});
}
function fmtTime(ts: number) { return new Date(ts).toLocaleTimeString(); }
function isMine(m: CollabChatMessage) { return m.fromId === me.value; }
function nameOf(machineId: string) { return nameById.value[machineId] || machineId.slice(0, 6); }

watch(() => chat.value.messages.length, () => scrollBottom());
onMounted(async () => {
  await props.collab.chat(props.groupId).catch(() => {});
  await props.collab.loadPendingCmds().catch(() => {});
  await scrollBottom();
});
</script>

<template>
  <div class="gcv">
    <!-- 本机待确认执行卡片（按当前群过滤） -->
    <div v-for="p in myPending" :key="p.id" class="pend">
      <div class="pend-txt">@{{ nameOf(p.fromId) }} 请求在你这执行：<code>{{ p.text }}</code></div>
      <button @click="decide(p, true)">允许</button>
      <button class="ghost" @click="decide(p, false)">拒绝</button>
    </div>

    <div class="msgs" ref="msgListEl">
      <div v-for="m in chat.messages" :key="m.id" class="msg" :class="{ mine: isMine(m) }">
        <div class="meta">
          <span class="who">{{ isMine(m) ? '我' : nameOf(m.fromId) }}</span>
          <span class="time">{{ fmtTime(m.ts) }}</span>
          <span v-if="m.kind === 'system'" class="tag sys">系统</span>
        </div>
        <template v-if="m.kind === 'cmd-result'">
          <div class="res-head">执行结果<template v-if="m.meta"> · 退出码 {{ m.meta.exitCode ?? '-' }}</template></div>
          <pre class="res-body">{{ m.text }}<template v-if="m.meta && m.meta.stderr">\n{{ m.meta.stderr }}</template></pre>
        </template>
        <div v-else class="bubble">
          <span v-for="(seg, i) in highlightMentions(m.text, nameById)" :key="i" :class="{ at: seg.mention }">{{ seg.text }}</span>
        </div>
      </div>
      <div v-if="chat.messages.length === 0" class="empty">还没有消息</div>
    </div>

    <div class="compose">
      <div v-if="showMentions" class="mentions">
        <button v-for="mm in mentionMembers" :key="mm.machineId" @click="pickMention(mm)">@{{ mm.username }}</button>
        <div v-if="mentionMembers.length === 0" class="empty">无匹配成员</div>
      </div>
      <div class="row">
        <input v-model="composer" placeholder="输入消息；@ 选择成员；/command 触发远程执行" @input="onComposerInput" @keyup.enter="submit" />
        <button @click="submit">发送</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gcv { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.pend { background: #1d3a5f; border: 1px solid #2f6feb; border-radius: 6px; margin: 8px; padding: 8px 10px; display: flex; gap: 8px; align-items: center; }
.pend-txt { flex: 1; color: #cfe0ff; }
.pend code { color: #ffd479; }
.msgs { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
.msg { max-width: 78%; display: flex; flex-direction: column; gap: 2px; }
.msg.mine { align-self: flex-end; align-items: flex-end; }
.meta { display: flex; gap: 6px; color: #6b7686; font-size: 11px; align-items: center; }
.who { color: #9aa4b2; font-weight: 600; }
.tag.sys { background: #334155; color: #cbd5e1; padding: 0 6px; border-radius: 8px; font-size: 10px; }
.bubble { background: #222932; border: 1px solid #2a323e; border-radius: 8px; padding: 6px 10px; color: #d5dae1; white-space: pre-wrap; word-break: break-word; }
.msg.mine .bubble { background: #14345e; border-color: #2f6feb; }
.at { color: #4c9aff; font-weight: 600; }
.res-head { color: #9aa4b2; font-size: 11px; }
.res-body { background: #10151b; color: #a5e8a0; border: 1px solid #1f3a24; border-radius: 6px; padding: 8px; font-family: Consolas, monospace; font-size: 12px; white-space: pre-wrap; max-height: 260px; overflow: auto; }
.compose { border-top: 1px solid #2a323e; padding: 8px; position: relative; }
.mentions { position: absolute; bottom: 100%; left: 8px; background: #1a2027; border: 1px solid #2a323e; border-radius: 6px; padding: 4px; display: flex; flex-direction: column; }
.mentions button { background: none; border: none; color: #cfe0ff; text-align: left; padding: 4px 8px; cursor: pointer; }
.mentions button:hover { background: #2f6feb; color: #fff; border-radius: 4px; }
.row { display: flex; gap: 6px; }
input { flex: 1; background: #222932; border: 1px solid #2a323e; color: #d5dae1; border-radius: 4px; padding: 7px 10px; }
button { background: #2f6feb; color: #fff; border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; }
button.ghost { background: none; border: 1px solid #2a323e; color: #9aa4b2; }
.empty { color: #6b7686; padding: 8px; }
</style>
```

- [ ] **Step 2: typecheck**

Run: `npm.cmd --prefix web run typecheck`
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add web/src/collaboration/GroupChatView.vue
git commit -m "feat(collab): group chat view (messages/composer/pending)"
```

---

## Task 4: GroupsView 接入聊天 + 白名单

**Files:**
- Modify: `web/src/collaboration/GroupsView.vue`

- [ ] **Step 1: 改 GroupsView.vue**

在 script 中 import `GroupChatView`，并把「点群名」行为从仅展开成员改为**选中聊天**。改动（保留建群/邀请/踢人/角色）：

script 增加：

```ts
import GroupChatView from './GroupChatView.vue';
import { onMounted, watch } from 'vue';
const activeGroupId = ref<string | null>(null);
const memberPanelOpen = ref<string | null>(null);
function openChat(gid: string) { activeGroupId.value = gid; }
watch(activeGroupId, (v) => { if (v && !props.collab.chatState.value[v]) props.collab.chat(v).catch(() => {}); });
onMounted(async () => { await props.collab.loadAllowlist().catch(() => {}); await props.collab.loadPendingCmds().catch(() => {}); });
const myAllow = computed(() => props.collab.allowlistState.value);
const newPrefix = ref('');
async function addPrefix() { if (newPrefix.value.trim()) { await props.collab.addAllow(newPrefix.value.trim()); newPrefix.value = ''; } }
async function delPrefix(p: string) { await props.collab.removeAllow(p); }
```

把列表项模板改为：群名按钮 → `openChat`；成员/邀请/踢人收起到「管理」小按钮（`memberPanelOpen`）。新模板：

```html
    <div v-for="g in snap.groups" :key="g.id" class="group">
      <div class="ghead">
        <button class="gname" @click="openChat(g.id)">💬 {{ g.name }} <span class="cnt">({{ g.members.length }})</span></button>
        <button class="ghost" @click="memberPanelOpen = memberPanelOpen === g.id ? null : g.id">管理</button>
        <button v-if="g.ownerId === snap.identity?.machineId" class="ghost del" @click="removeGroup(g.id)">解散</button>
      </div>
      <div v-if="memberPanelOpen === g.id" class="gdetail">
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
      <div v-if="activeGroupId === g.id" class="chat-slot">
        <GroupChatView :collab="collab" :group-id="g.id" />
      </div>
    </div>

    <div class="allow">
      <h4>本机免确认命令（白名单）</h4>
      <div class="inv-form">
        <input v-model="newPrefix" placeholder="如 deploy / git status" @keyup.enter="addPrefix" />
        <button @click="addPrefix">＋ 添加</button>
      </div>
      <div v-for="p in myAllow" :key="p" class="mrow">
        <span class="nm"><code>{{ p }}</code></span>
        <button class="ghost del" @click="delPrefix(p)">删除</button>
      </div>
    </div>
```

> 布局注意：`GroupChatView` 需要固定高度（flex 子项），若外层 `GroupsView` 是滚动容器会挤。实施时把 `.chat-slot` 高度设 `min-height: 320px` 且 `display:flex`，或把聊天做成独立 `activeGroupId` 时整体替换列表（列表收成左侧小栏）。以视觉可用为准；`.chat-slot { display:flex; min-height: 340px; border-top:1px solid #232b34; }` 为最小可行方案。

- [ ] **Step 2: typecheck**

Run: `npm.cmd --prefix web run typecheck`
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add web/src/collaboration/GroupsView.vue
git commit -m "feat(collab): open group chat from groups view + allowlist mgmt"
```

---

## Task 5: CollaborationView 订阅 chat 推送

**Files:**
- Modify: `web/src/collaboration/CollaborationView.vue`

- [ ] **Step 1: 增加 S2C 订阅**

在 `onMounted` 的 `unsubs` 数组追加两个订阅（并把 handler 改用 `collab.handleS2C`）：

```ts
    props.terminal.on(CollabS2C.COLLAB_CHAT, (payload: any) => collab.handleS2C(CollabS2C.COLLAB_CHAT, payload)),
    props.terminal.on(CollabS2C.COLLAB_CMD_PENDING, (payload: any) => collab.handleS2C(CollabS2C.COLLAB_CMD_PENDING, payload)),
```

- [ ] **Step 2: typecheck**

Run: `npm.cmd --prefix web run typecheck`
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add web/src/collaboration/CollaborationView.vue
git commit -m "feat(collab): subscribe chat & cmd-pending pushes in contacts view"
```

---

## Task 6: 收尾

- [ ] **Step 1: web vitest + typecheck**

Run: `npm.cmd --prefix web run test`；`npm.cmd --prefix web run typecheck`
Expected: 全绿

- [ ] **Step 2: 全量根测试**

Run: `npm.cmd test`
Expected: server + web 全绿

- [ ] **Step 3: 手动冒烟**

起后端 + vite（`Start-Process` 非阻塞），浏览器：通讯录 → 群组 → 点群名进聊天 → 发文本；两台机器验证 `@名 /command` → 对端白名单外弹「允许/拒绝」卡片、允许后结果回群。验证后 `Stop-Process` 清理。

- [ ] **Step 4: git status 确认隔离**

Run: `git status`
Expected: 改动仅限 `web/src/collaboration/**` 与 `shared/collab.*`/`server/**`（本功能全部）；master 共享文件未动。

- [ ] **Step 5: Commit（若有残留）**

```bash
git add -A
git commit -m "chore(collab): finalize group chat web UI"
```

---

## 完成标准

- 群详情可进聊天视图：消息流、`@` 下拉、纯文本发送、cmd-result 代码块展示。
- 白名单内/外远程执行：发起方可见结果；目标机未命中白名单时出现「允许/拒绝」卡片。
- `COLLAB_CHAT` / `COLLAB_CMD_PENDING` 推送触发前端自动刷新。
- 本机白名单管理 UI 可用。
- `npm.cmd test` 全绿；`npm.cmd run typecheck` 通过。
