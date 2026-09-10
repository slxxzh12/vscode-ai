<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabApi } from './useCollab';
import type { CollabFriend, CollabMember, CollabGroup } from './types';
import GroupChatView from './GroupChatView.vue';
import JoinInviteCard from './JoinInviteCard.vue';

const props = defineProps<{ collab: CollabApi }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const friends = computed(() => snap.value.friends);
const groups = computed(() => snap.value.groups);
const me = computed(() => snap.value.identity?.machineId);

// —— 群相关状态 ——
const groupName = ref('');
const activeGroupId = ref<string | null>(null);
const inviteMachineId = ref('');
const merr = ref('');
const newPrefix = ref('');
// —— 好友相关状态 ——
const addHost = ref('');
const addPort = ref<number | null>(null);
const activeFriendId = ref<string | null>(null);
const inviteToGroup = ref('');
const ferr = ref('');
const err = ref('');

onMounted(async () => {
  await props.collab.loadAllowlist().catch(() => {});
  await props.collab.loadPendingCmds().catch(() => {});
});
const myAllow = computed(() => props.collab.allowlistState.value);
const activeGroup = computed(() => groups.value.find((g) => g.id === activeGroupId.value) || null);
const activeFriend = computed(() => friends.value.find((f) => f.machineId === activeFriendId.value) || null);
const myRole = computed(() => activeGroup.value?.members.find((m) => m.machineId === me.value)?.role || null);
const canInvite = computed(() => myRole.value === 'owner' || myRole.value === 'admin');
const inviteUrl = ref('');
const inviteErr = ref('');
const pasteInvite = ref('');
const pasteToken = ref('');

watch(groups, (gs) => {
  if (activeFriendId.value) return;
  if (gs.length === 0) { activeGroupId.value = null; return; }
  if (!gs.some((g) => g.id === activeGroupId.value)) activeGroupId.value = gs[0].id;
}, { immediate: true, deep: true });
watch(activeFriend, (f) => { if (f && !inviteToGroup.value && groups.value.length) inviteToGroup.value = groups.value[0].id; });

// —— 群动作 ——
async function createGroup() {
  err.value = '';
  try {
    const r = await props.collab.createGroup(groupName.value.trim());
    await props.collab.refresh();
    groupName.value = '';
    const gid = (r as { group?: { id?: string } })?.group?.id;
    if (gid) { activeGroupId.value = gid; activeFriendId.value = null; }
  } catch (e) { err.value = String((e as Error).message || e); }
}
function selectGroup(gid: string) { activeGroupId.value = gid; activeFriendId.value = null; }
function selectFriend(mid: string) { activeFriendId.value = mid; activeGroupId.value = null; }
async function acceptGroupInvite(id: string) { await props.collab.acceptInvite(id); await props.collab.refresh(); }
async function rejectGroupInvite(id: string) { await props.collab.rejectInvite(id); await props.collab.refresh(); }
async function inviteMemberByMachineId() {
  const gid = activeGroupId.value;
  if (!gid || !inviteMachineId.value.trim()) return;
  merr.value = '';
  try { await props.collab.inviteMember(gid, inviteMachineId.value.trim()); inviteMachineId.value = ''; }
  catch (e) { merr.value = String((e as Error).message || e); }
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
async function dissolveGroup() {
  const g = activeGroup.value;
  if (!g) return;
  if (confirm(`解散群「${g.name}」？`)) { await props.collab.deleteGroup(g.id); await props.collab.refresh(); }
}
function roleLabel(r: string) { return r === 'owner' ? '群主' : r === 'admin' ? '管理员' : '成员'; }
async function genInviteLink() {
  const g = activeGroup.value; if (!g) return;
  inviteErr.value = '';
  try {
    const r = await props.collab.createInviteLink(g.id, window.location.origin);
    inviteUrl.value = (r as { url?: string }).url || '';
  } catch (e) { inviteErr.value = String((e as Error).message || e); }
}
async function resetInviteLink() {
  const g = activeGroup.value; if (!g) return;
  if (!confirm('重置邀请链接？旧链接将立即失效')) return;
  inviteErr.value = '';
  try { await props.collab.revokeInvites(g.id); await genInviteLink(); }
  catch (e) { inviteErr.value = String((e as Error).message || e); }
}
async function copyInvite() {
  if (!inviteUrl.value) return;
  try { await navigator.clipboard.writeText(inviteUrl.value); } catch { /* ignore */ }
}
function extractToken(s: string): string {
  const t = s.trim();
  const m = t.match(/[?&]invite=([^&\s]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  return t;
}
function openPaste() { const t = pasteInvite.value.trim(); if (t) pasteToken.value = extractToken(t); }
async function onPasteJoined(g: CollabGroup | undefined) {
  pasteToken.value = ''; pasteInvite.value = '';
  await props.collab.refresh();
  if (g) { activeGroupId.value = g.id; activeFriendId.value = null; }
}
async function addAllowPrefix() { if (newPrefix.value.trim()) { await props.collab.addAllow(newPrefix.value.trim()); newPrefix.value = ''; } }
async function delAllowPrefix(p: string) { await props.collab.removeAllow(p); }

// —— 好友动作 ——
async function addFriend() {
  ferr.value = '';
  try {
    await props.collab.requestFriend(addHost.value.trim(), Number(addPort.value));
    await props.collab.refresh();
    addHost.value = ''; addPort.value = null;
  } catch (e) { ferr.value = String((e as Error).message || e); }
}
async function acceptFriend(machineId: string) { await props.collab.acceptFriend(machineId); await props.collab.refresh(); }
async function removeFriend(machineId: string) { if (confirm('删除好友？')) { await props.collab.removeFriend(machineId); if (activeFriendId.value === machineId) activeFriendId.value = null; } }
async function inviteFriendToGroup(friendId: string) {
  if (!inviteToGroup.value) return;
  merr.value = '';
  try { await props.collab.inviteMember(inviteToGroup.value, friendId); }
  catch (e) { merr.value = String((e as Error).message || e); }
}
</script>

<template>
  <div class="cw">
    <aside class="cw-left">
      <div v-if="err" class="err">{{ err }}</div>

      <div class="sec" v-if="snap.pendingInvites.length || snap.pendingFriends.length">
        <h4>待处理</h4>
        <div v-for="iv in snap.pendingInvites" :key="iv.id" class="rowline">
          <span class="txt">「{{ iv.groupName }}」<span class="sub">@{{ iv.inviter.username }} 邀你入群</span></span>
          <button @click="acceptGroupInvite(iv.id)">接受</button>
          <button class="ghost" @click="rejectGroupInvite(iv.id)">拒绝</button>
        </div>
        <div v-for="p in snap.pendingFriends" :key="p.machineId" class="rowline">
          <span class="txt">{{ p.username }} <span class="sub">{{ p.host }}:{{ p.port }}</span></span>
          <button @click="acceptFriend(p.machineId)">接受</button>
        </div>
      </div>

      <div class="sec">
        <h4>添加</h4>
        <div class="addrow">
          <input v-model="groupName" placeholder="建群名称" @keyup.enter="createGroup" />
          <button title="建群" @click="createGroup">＋群</button>
        </div>
        <div class="addrow">
          <input v-model="addHost" placeholder="好友 IP" class="ip" @keyup.enter="addFriend" />
          <input v-model.number="addPort" type="number" placeholder="端口" class="pt" @keyup.enter="addFriend" />
          <button title="加好友" @click="addFriend">＋友</button>
        </div>
        <div class="addrow">
          <input v-model="pasteInvite" placeholder="粘贴邀请链接/邀请码" @keyup.enter="openPaste" />
          <button title="预览邀请" @click="openPaste">预览</button>
        </div>
        <div v-if="ferr" class="err">{{ ferr }}</div>
      </div>

      <div class="sec">
        <h4>我的好友（{{ friends.length }}）</h4>
        <div v-if="friends.length === 0" class="empty">暂无，输入对方 IP:端口 添加</div>
        <button v-for="f in friends" :key="f.machineId" class="item" :class="{ on: f.machineId === activeFriendId && !activeGroup }" @click="selectFriend(f.machineId)">
          <span class="av av-f">{{ f.username.charAt(0) || '?' }}</span>
          <span class="gtx">
            <span class="gn">{{ f.username }}</span>
            <span class="gsub">{{ f.host }}:{{ f.port }}</span>
          </span>
        </button>
      </div>

      <div class="sec">
        <h4>我的群（{{ groups.length }}）</h4>
        <div v-if="groups.length === 0" class="empty">还没有群，创建或等邀请吧</div>
        <button v-for="g in groups" :key="g.id" class="item" :class="{ on: g.id === activeGroupId }" @click="selectGroup(g.id)">
          <span class="av av-g">{{ g.name.trim().charAt(0) || '群' }}</span>
          <span class="gtx">
            <span class="gn">{{ g.name }}</span>
            <span class="gsub">{{ g.members.length }} 人</span>
          </span>
        </button>
      </div>

      <div class="sec allow">
        <h4>本机免确认命令（白名单）</h4>
        <div class="addrow">
          <input v-model="newPrefix" placeholder="如 deploy / git status" @keyup.enter="addAllowPrefix" />
          <button @click="addAllowPrefix">＋</button>
        </div>
        <div v-if="myAllow.length === 0" class="empty">无，收到的远程执行都会要求确认</div>
        <div v-for="p in myAllow" :key="p" class="rowline">
          <span class="txt"><code>{{ p }}</code></span>
          <button class="ghost del" @click="delAllowPrefix(p)">删除</button>
        </div>
      </div>
    </aside>

    <section class="cw-right">
      <template v-if="activeGroup">
        <div class="chat-col">
          <header class="gtop">
            <span class="tname">💬 {{ activeGroup.name }} <span class="tcnt">({{ activeGroup.members.length }})</span></span>
            <button v-if="activeGroup.ownerId === me" class="tbtn del" @click="dissolveGroup">解散群</button>
          </header>
          <GroupChatView :collab="collab" :group-id="activeGroup.id" />
        </div>
        <aside class="memcol">
          <div class="mem-head">成员 {{ activeGroup.members.length }}</div>
          <div class="invrow">
            <input v-model="inviteMachineId" placeholder="成员 machineId，回车邀请" @keyup.enter="inviteMemberByMachineId" />
            <button title="邀请入群" @click="inviteMemberByMachineId">＋</button>
          </div>
          <div v-if="merr" class="merr">{{ merr }}</div>
          <div v-if="canInvite" class="invlink">
            <button class="genbtn" @click="genInviteLink">生成邀请链接</button>
            <div v-if="inviteUrl" class="linkrow">
              <input :value="inviteUrl" readonly @focus="($event.target as HTMLInputElement).select()" />
              <button @click="copyInvite">复制</button>
            </div>
            <button v-if="inviteUrl" class="ghost resetlink" @click="resetInviteLink">重置链接</button>
            <div v-if="inviteErr" class="merr">{{ inviteErr }}</div>
          </div>
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
      <template v-else-if="activeFriend">
        <div class="fcard">
          <div class="fhead">
            <span class="fav">{{ activeFriend.username.charAt(0) || '?' }}</span>
            <div class="finfo">
              <span class="fname">{{ activeFriend.username }}</span>
              <span class="fsub">machineId {{ activeFriend.machineId.slice(0, 8) }}…</span>
            </div>
            <button class="tbtn del" @click="removeFriend(activeFriend.machineId)">删除好友</button>
          </div>
          <div class="frow"><span>地址</span><code>{{ activeFriend.host }}:{{ activeFriend.port }}</code></div>
          <div class="frow"><span>公钥指纹</span><code>{{ (activeFriend.publicKey || '').slice(-24) }}</code></div>
          <div class="invite-to">
            <span>拉入群</span>
            <select v-model="inviteToGroup">
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
            <button v-if="groups.length" @click="inviteFriendToGroup(activeFriend.machineId)">邀请</button>
            <div v-if="!groups.length" class="empty">还没有群可拉入</div>
          </div>
        </div>
      </template>
      <div v-else class="placeholder">
        <div class="ph">选择左侧好友或群组开始吧</div>
      </div>
    </section>

    <div v-if="pasteToken" class="joinmask" @click.self="pasteToken = ''">
      <JoinInviteCard :collab="collab" :token="pasteToken" @joined="onPasteJoined" @cancel="pasteToken = ''" />
    </div>
  </div>
</template>

<style scoped>
.cw { flex: 1; min-height: 0; display: flex; }
.cw-left { width: 300px; flex: none; overflow-y: auto; padding: 12px; border-right: 1px solid var(--bd); background: var(--bg1); box-sizing: border-box; }
.cw-right { flex: 1; min-width: 0; display: flex; background: var(--bg0); }

.chat-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.gtop { flex: none; display: flex; align-items: center; gap: 10px; padding: 0 16px; height: 52px; border-bottom: 1px solid var(--bd); }
.tname { font-size: 16px; font-weight: 700; color: var(--tx1); }
.tcnt { color: var(--tx6); font-size: 13px; font-weight: 400; }
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
.err { color: var(--err); font-size: 12px; margin: 4px 0; }
.empty { color: var(--tx6); padding: 6px 2px; font-size: 12px; }
.addrow { display: flex; gap: 6px; margin: 6px 0; }
.addrow input { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; box-sizing: border-box; flex: 1; min-width: 0; }
.addrow input.ip { flex: 2; }
.addrow input.pt { flex: 1; max-width: 70px; }
.rowline { display: flex; align-items: center; gap: 6px; padding: 4px 2px; border-bottom: 1px solid var(--bd2); font-size: 13px; color: var(--tx); }
.rowline .txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rowline .sub { color: var(--tx6); font-size: 11px; margin-left: 6px; font-family: Consolas, monospace; }
.item { display: flex; align-items: center; gap: 10px; width: 100%; background: none; border: none; text-align: left; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
.item:hover { background: var(--bg3); }
.item.on { background: color-mix(in srgb, var(--ac) 22%, transparent); }
.av { width: 34px; height: 34px; flex: none; border-radius: 50%; color: var(--onac); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
.av-g { background: var(--ac); }
.av-f { background: #3b82f6; }
.gtx { display: flex; flex-direction: column; min-width: 0; }
.gn { color: var(--tx1); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gsub { color: var(--tx6); font-size: 11px; font-family: Consolas, monospace; }
.allow { margin-top: 6px; border-top: 1px solid var(--bd2); padding-top: 4px; }
button { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; }
button.ghost { background: none; border: 1px solid var(--bd); color: var(--tx2); }
button.del { color: var(--err); border-color: var(--bd); }
input, select { background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 5px 8px; }
.placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--tx6); }

.fcard { flex: 1; padding: 24px; overflow-y: auto; }
.fhead { display: flex; align-items: center; gap: 14px; border-bottom: 1px solid var(--bd); padding-bottom: 16px; }
.fav { width: 64px; height: 64px; border-radius: 50%; background: #3b82f6; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; }
.finfo { display: flex; flex-direction: column; gap: 2px; }
.fname { font-size: 20px; font-weight: 700; color: var(--tx1); }
.fsub { color: var(--tx6); font-size: 12px; font-family: Consolas, monospace; }
.frow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--bd2); font-size: 13px; color: var(--tx2); }
.frow code { color: var(--tx1); font-family: Consolas, monospace; }
.invite-to { display: flex; align-items: center; gap: 10px; margin-top: 18px; font-size: 13px; color: var(--tx2); }
.invite-to select { flex: 1; }
.invlink { padding: 4px 14px 10px; display: flex; flex-direction: column; gap: 6px; }
.invlink .genbtn { background: var(--ac); color: var(--onac); border: none; border-radius: 4px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.linkrow { display: flex; gap: 6px; }
.linkrow input { flex: 1; min-width: 0; background: var(--bg4); border: 1px solid var(--bd); color: var(--tx); border-radius: 4px; padding: 4px 6px; font-size: 11px; box-sizing: border-box; }
.linkrow button { background: var(--bg5); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; }
.resetlink { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; }
.joinmask { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
</style>
