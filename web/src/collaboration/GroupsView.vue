<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import GroupChatView from './GroupChatView.vue';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const name = ref('');
const err = ref('');
const activeGroupId = ref<string | null>(null);
const memberPanelOpen = ref<string | null>(null);
const inviteMachineId = ref('');
const newPrefix = ref('');

onMounted(async () => {
  await props.collab.loadAllowlist().catch(() => {});
  await props.collab.loadPendingCmds().catch(() => {});
});
const myAllow = computed(() => props.collab.allowlistState.value);

async function create() {
  err.value = '';
  try { const r = await props.collab.createGroup(name.value.trim()); await props.collab.refresh(); name.value = '';
    if ((r as { group?: { id?: string } }).group?.id) activeGroupId.value = (r as { group: { id: string } }).group.id;
  } catch (e) { err.value = String((e as Error).message || e); }
}
function openChat(gid: string) { activeGroupId.value = activeGroupId.value === gid ? null : gid; }
function toggleManage(gid: string) { memberPanelOpen.value = memberPanelOpen.value === gid ? null : gid; }
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
async function removeGroup(gid: string) { if (confirm('解散群？')) { await props.collab.deleteGroup(gid); await props.collab.refresh(); if (activeGroupId.value === gid) activeGroupId.value = null; } }
function roleLabel(r: string) { return r === 'owner' ? '群主' : r === 'admin' ? '管理员' : '成员'; }
async function addPrefix() { if (newPrefix.value.trim()) { await props.collab.addAllow(newPrefix.value.trim()); newPrefix.value = ''; } }
async function delPrefix(p: string) { await props.collab.removeAllow(p); }
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
        <button class="gname" @click="openChat(g.id)">💬 {{ g.name }} <span class="cnt">({{ g.members.length }})</span></button>
        <button class="ghost" @click="toggleManage(g.id)">管理</button>
        <button v-if="g.ownerId === snap.identity?.machineId" class="ghost del" @click="removeGroup(g.id)">解散</button>
      </div>
      <div v-if="activeGroupId === g.id" class="chat-slot">
        <GroupChatView :collab="collab" :group-id="g.id" />
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
    </div>

    <div class="allow">
      <h4>本机免确认命令（白名单）</h4>
      <div class="inv-form">
        <input v-model="newPrefix" placeholder="如 deploy / git status" @keyup.enter="addPrefix" />
        <button @click="addPrefix">＋ 添加</button>
      </div>
      <div v-if="myAllow.length === 0" class="empty">无，收到的远程执行都会要求你确认</div>
      <div v-for="p in myAllow" :key="p" class="mrow">
        <span class="nm"><code>{{ p }}</code></span>
        <button class="ghost del" @click="delPrefix(p)">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gw { padding: 14px; }
.create { display: flex; gap: 6px; margin: 10px 0; }
input { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; }
button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; }
button.ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); }
button.del { color: var(--err); border-color: var(--bd); }
button.gname { background: none; color: var(--tx1); text-align: left; padding: 8px 6px; font-size: 13px; }
.cnt { color: var(--tx6); }
h4 { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 14px 0 6px; }
.invite, .group { border-bottom: 1px solid var(--bd2); padding: 6px 4px; }
.invite span { color: var(--tx); }
.ghead { display: flex; align-items: center; gap: 6px; }
.chat-slot { display: flex; min-height: 360px; border-top: 1px solid var(--bd2); margin-top: 6px; }
.gdetail { padding: 4px 8px 8px; background: var(--bg2); border-radius: 6px; margin-top: 6px; }
.inv-form { display: flex; gap: 6px; margin: 6px 0; }
.mrow { display: flex; align-items: center; gap: 8px; padding: 4px 2px; }
.nm { color: var(--tx1); }
.role { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
.role.owner { background: #7c3aed; color: #fff; }
.role.admin { background: #b45309; color: #fff; }
.role.member { background: var(--bg5); color: var(--tx); }
.adr { color: var(--tx6); font-family: monospace; font-size: 11px; margin-left: auto; }
.empty { color: var(--tx6); padding: 8px; }
.err { color: var(--err); }
.allow { margin-top: 8px; }
</style>
