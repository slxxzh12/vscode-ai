<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import GroupChatView from './GroupChatView.vue';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const groups = computed(() => snap.value.groups);
const me = computed(() => snap.value.identity?.machineId);
const name = ref('');
const err = ref('');
const activeGroupId = ref<string | null>(null);
const panel = ref<'manage' | null>(null);
const inviteMachineId = ref('');
const newPrefix = ref('');

onMounted(async () => {
  await props.collab.loadAllowlist().catch(() => {});
  await props.collab.loadPendingCmds().catch(() => {});
});
const myAllow = computed(() => props.collab.allowlistState.value);
const activeGroup = computed(() => groups.value.find((g) => g.id === activeGroupId.value) || null);

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
function select(gid: string) { activeGroupId.value = gid; panel.value = null; }
function toggleManage() { panel.value = panel.value === 'manage' ? null : 'manage'; }
async function acceptInvite(id: string) { await props.collab.acceptInvite(id); await props.collab.refresh(); }
async function rejectInvite(id: string) { await props.collab.rejectInvite(id); await props.collab.refresh(); }
async function invite() {
  const gid = activeGroupId.value;
  if (!gid || !inviteMachineId.value.trim()) return;
  await props.collab.inviteMember(gid, inviteMachineId.value.trim());
  inviteMachineId.value = '';
}
async function kick(mid: string) {
  const g = activeGroup.value;
  const who = g?.members.find((m) => m.machineId === mid);
  if (who && confirm(`把 ${who.username} 移出群？`)) { await props.collab.kickMember(g!.id, mid); await props.collab.refresh(); }
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
        <header class="gtop">
          <span class="tname">💬 {{ activeGroup.name }} <span class="tcnt">({{ activeGroup.members.length }})</span></span>
          <div class="tacts">
            <button class="tbtn" :class="{ on: panel === 'manage' }" @click="toggleManage">成员管理</button>
            <button v-if="activeGroup.ownerId === me" class="tbtn del" @click="dissolve">解散</button>
          </div>
        </header>
        <div v-if="panel === 'manage'" class="gmanage">
          <div class="inv-form">
            <input v-model="inviteMachineId" placeholder="成员 machineId" @keyup.enter="invite" />
            <button @click="invite">邀请</button>
          </div>
          <div v-for="m in activeGroup.members" :key="m.machineId" class="mrow">
            <span class="nm">{{ m.username }}</span>
            <span class="role" :class="m.role">{{ roleLabel(m.role) }}</span>
            <span class="adr">{{ m.host }}:{{ m.port }}</span>
            <button v-if="m.machineId !== me" class="ghost del" @click="kick(m.machineId)">踢出</button>
          </div>
        </div>
        <GroupChatView :collab="collab" :group-id="activeGroup.id" />
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
.gw-right { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg0); }

.gtop { flex: none; display: flex; align-items: center; gap: 10px; padding: 0 16px; height: 52px; border-bottom: 1px solid var(--bd); }
.tname { font-size: 16px; font-weight: 700; color: var(--tx1); }
.tcnt { color: var(--tx6); font-size: 13px; font-weight: 400; }
.tacts { margin-left: auto; display: flex; gap: 6px; }
.tbtn { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
.tbtn:hover { border-color: var(--ac); color: var(--ac); }
.tbtn.on { background: var(--ac); border-color: var(--ac); color: var(--onac); }
.tbtn.del { color: var(--err); border-color: var(--bd); }
.tbtn.del:hover { border-color: var(--err); color: var(--err); }

.gmanage { flex: 0 1 auto; max-height: 46%; overflow-y: auto; padding: 8px 16px; background: var(--bg1); border-bottom: 1px solid var(--bd); }

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
.mrow { display: flex; align-items: center; gap: 8px; padding: 4px 2px; }
.nm { color: var(--tx1); }
.nm code { color: var(--warn2); }
.role { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
.role.owner { background: #7c3aed; color: #fff; }
.role.admin { background: #b45309; color: #fff; }
.role.member { background: var(--bg5); color: var(--tx); }
.adr { color: var(--tx6); font-family: monospace; font-size: 11px; margin-left: auto; }
.placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--tx6); }
</style>
