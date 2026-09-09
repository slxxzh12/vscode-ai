<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import type { CollabMember } from './types';
import GroupChatView from './GroupChatView.vue';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const groups = computed(() => snap.value.groups);
const me = computed(() => snap.value.identity?.machineId);
const name = ref('');
const err = ref('');
const activeGroupId = ref<string | null>(null);
const inviteMachineId = ref('');
const merr = ref('');
const newPrefix = ref('');

onMounted(async () => {
  await props.collab.loadAllowlist().catch(() => {});
  await props.collab.loadPendingCmds().catch(() => {});
});
const myAllow = computed(() => props.collab.allowlistState.value);
const activeGroup = computed(() => groups.value.find((g) => g.id === activeGroupId.value) || null);
const myRole = computed(() => activeGroup.value?.members.find((m) => m.machineId === me.value)?.role || null);

watch(groups, (gs) => {
  if (gs.length === 0) { activeGroupId.value = null; return; }
  if (!gs.some((g) => g.id === activeGroupId.value)) activeGroupId.value = gs[0].id;
}, { immediate: true, deep: true });

async function create() {
  err.value = '';
  try {
    const r = await props.collab.createGroup(name.value.trim());
    await props.collab.refresh();
    name.value = '';
    const gid = (r as { group?: { id?: string } })?.group?.id;
    if (gid) activeGroupId.value = gid;
  } catch (e) { err.value = String((e as Error).message || e); }
}
function select(gid: string) { activeGroupId.value = gid; }
async function acceptInvite(id: string) { await props.collab.acceptInvite(id); await props.collab.refresh(); }
async function rejectInvite(id: string) { await props.collab.rejectInvite(id); await props.collab.refresh(); }
async function invite() {
  const gid = activeGroupId.value;
  if (!gid || !inviteMachineId.value.trim()) return;
  merr.value = '';
  try {
    await props.collab.inviteMember(gid, inviteMachineId.value.trim());
    inviteMachineId.value = '';
  } catch (e) { merr.value = String((e as Error).message || e); }
}
function canKick(target: CollabMember): boolean {
  if (!me.value || me.value === target.machineId) return false;
  if (myRole.value === 'owner') return true;
  if (myRole.value === 'admin') return target.role === 'member';
  return false;
}
async function kick(m: CollabMember) {
  const g = activeGroup.value;
  if (!g) return;
  if (confirm(`把 ${m.username} 移出群？`)) { await props.collab.kickMember(g.id, m.machineId); await props.collab.refresh(); }
}
async function dissolve() {
  const g = activeGroup.value;
  if (!g) return;
  if (confirm(`解散群「${g.name}」？`)) { await props.collab.deleteGroup(g.id); await props.collab.refresh(); }
}
function roleLabel(r: string) { return r === 'owner' ? '群主' : r === 'admin' ? '管理员' : '成员'; }
async function addPrefix() { if (newPrefix.value.trim()) { await props.collab.addAllow(newPrefix.value.trim()); newPrefix.value = ''; } }
async function delPrefix(p: string) { await props.collab.removeAllow(p); }
</script>

<template>
  <div class="gw">
    <aside class="gw-left">
      <div v-if="err" class="err">{{ err }}</div>

      <div class="sec">
        <h4>待入群邀请</h4>
        <div v-if="snap.pendingInvites.length === 0" class="empty">暂无</div>
        <div v-for="iv in snap.pendingInvites" :key="iv.id" class="invite">
          <div class="inv-txt">
            <span class="ig">「{{ iv.groupName }}」</span>
            <span class="from">{{ iv.inviter.username }} 邀请你入群</span>
          </div>
          <div class="inv-acts">
            <button @click="acceptInvite(iv.id)">接受</button>
            <button class="ghost" @click="rejectInvite(iv.id)">拒绝</button>
          </div>
        </div>
      </div>

      <div class="create">
        <input v-model="name" placeholder="新群名称" @keyup.enter="create" />
        <button @click="create">＋ 建群</button>
      </div>

      <div class="sec">
        <h4>我的群</h4>
        <div v-if="groups.length === 0" class="empty">还没有群，创建一个吧</div>
        <button v-for="g in groups" :key="g.id" class="gitem" :class="{ on: g.id === activeGroupId }" @click="select(g.id)">
          <span class="av">{{ g.name.trim().charAt(0) || '群' }}</span>
          <span class="gtx">
            <span class="gn">{{ g.name }}</span>
            <span class="gsub">{{ g.members.length }} 人</span>
          </span>
        </button>
      </div>

      <div class="sec allow">
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
    </aside>

    <section class="gw-right">
      <template v-if="activeGroup">
        <div class="chat-col">
          <header class="gtop">
            <span class="tname">💬 {{ activeGroup.name }}</span>
            <button v-if="activeGroup.ownerId === me" class="tbtn del" @click="dissolve">解散群</button>
          </header>
          <GroupChatView :collab="collab" :group-id="activeGroup.id" />
        </div>
        <aside class="memcol">
          <div class="mem-head">成员 {{ activeGroup.members.length }}</div>
          <div class="invrow">
            <input v-model="inviteMachineId" placeholder="成员 machineId，回车邀请" @keyup.enter="invite" />
            <button title="邀请好友入群" @click="invite">＋</button>
          </div>
          <div v-if="merr" class="merr">{{ merr }}</div>
          <div class="mlist">
            <div v-for="m in activeGroup.members" :key="m.machineId" class="mrow" :class="{ me: m.machineId === me }">
              <span class="mav" :class="m.role">{{ m.username.charAt(0) || '?' }}</span>
              <span class="minfo">
                <span class="mname">{{ m.username }}{{ m.machineId === me ? '（我）' : '' }}</span>
                <span class="mrole" :class="m.role">{{ roleLabel(m.role) }}</span>
              </span>
              <button v-if="canKick(m)" class="kick" title="移出群" @click="kick(m)">踢出</button>
            </div>
          </div>
        </aside>
      </template>
      <div v-else class="placeholder">
        <div class="ph">还没有群组，先在左侧创建一个吧</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gw { flex: 1; min-height: 0; display: flex; }
.gw-left { width: 300px; flex: none; overflow-y: auto; padding: 12px; border-right: 1px solid var(--bd); background: var(--bg1); box-sizing: border-box; }
.gw-right { flex: 1; min-width: 0; display: flex; background: var(--bg0); }

.chat-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.gtop { flex: none; display: flex; align-items: center; gap: 10px; padding: 0 16px; height: 52px; border-bottom: 1px solid var(--bd); }
.tname { font-size: 16px; font-weight: 700; color: var(--tx1); }
.tbtn { margin-left: auto; background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
.tbtn.del:hover { border-color: var(--err); color: var(--err); }

.memcol { width: 220px; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--bd); background: var(--bg1); }
.mem-head { flex: none; padding: 14px 14px 8px; font-size: 13px; font-weight: 700; color: var(--tx1); }
.invrow { flex: none; display: flex; gap: 6px; padding: 0 14px 10px; }
.invrow input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; font-size: 12px; box-sizing: border-box; }
.invrow button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 3px 10px; cursor: pointer; font-weight: 700; }
.merr { flex: none; color: var(--err); font-size: 11px; padding: 0 14px 6px; }
.mlist { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px 12px; }
.mrow { display: flex; align-items: center; gap: 8px; padding: 6px 6px; border-radius: 6px; }
.mrow:hover { background: var(--bg3); }
.mav { width: 30px; height: 30px; flex: none; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #fff; }
.mav.owner { background: #7c3aed; }
.mav.admin { background: #b45309; }
.mav.member { background: var(--ac); }
.minfo { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.mname { color: var(--tx1); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrow.me .mname { color: var(--ac2); }
.mrole { font-size: 10px; color: var(--tx6); }
.kick { display: none; background: none; border: 1px solid var(--err); color: var(--err); border-radius: 4px; padding: 1px 7px; cursor: pointer; font-size: 11px; }
.mrow:hover .kick { display: inline-block; }
.kick:hover { background: var(--err); color: #fff; }

h4 { color: var(--tx2); text-transform: uppercase; font-size: 11px; margin: 14px 0 6px; }
.sec h4:first-child { margin-top: 0; }
.err { color: var(--err); font-size: 12px; margin-bottom: 6px; }
.empty { color: var(--tx6); padding: 6px 2px; font-size: 12px; }
.invite { border-bottom: 1px solid var(--bd2); padding: 6px 2px; }
.inv-txt { display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: var(--tx); }
.inv-txt .from { color: var(--tx6); font-size: 11px; }
.inv-acts { display: flex; gap: 6px; margin-top: 6px; }
.create { display: flex; gap: 6px; margin: 12px 0 4px; }
input { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; box-sizing: border-box; }
button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; }
button.ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); }
button.del { color: var(--err); border-color: var(--bd); }
.gitem { display: flex; align-items: center; gap: 10px; width: 100%; background: none; border: none; text-align: left; padding: 8px 8px; border-radius: 8px; cursor: pointer; }
.gitem:hover { background: var(--bg3); }
.gitem.on { background: color-mix(in srgb, var(--ac) 22%, transparent); }
.av { width: 36px; height: 36px; flex: none; border-radius: 50%; background: var(--ac); color: var(--onac); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; }
.gtx { display: flex; flex-direction: column; min-width: 0; }
.gn { color: var(--tx1); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gsub { color: var(--tx6); font-size: 11px; }
.allow { margin-top: 6px; border-top: 1px solid var(--bd2); padding-top: 4px; }
.inv-form { display: flex; gap: 6px; margin: 6px 0; }
.mrow code { color: var(--warn2); }
.adr { color: var(--tx6); font-family: monospace; font-size: 11px; margin-left: auto; }
.placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--tx6); }
</style>
