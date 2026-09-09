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
    props.terminal.on(CollabS2C.COLLAB_CHAT, (payload: any) => collab.handleS2C(CollabS2C.COLLAB_CHAT, payload)),
    props.terminal.on(CollabS2C.COLLAB_CMD_PENDING, (payload: any) => collab.handleS2C(CollabS2C.COLLAB_CMD_PENDING, payload)),
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
          {{ t.label }}<span v-if="t.id === 'friends' && pendingCount" class="badge">{{ pendingCount }}</span>
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
.cv { display: flex; flex-direction: column; height: 100%; background: var(--bg0); }
.topbar { display: flex; align-items: center; gap: 14px; padding: 0 14px; height: 46px; border-bottom: 1px solid var(--bd); flex: none; }
.title { font-weight: 700; color: var(--ac3); }
.tabs { display: flex; gap: 4px; }
.tab { background: none; border: none; color: var(--tx2); padding: 6px 10px; cursor: pointer; border-radius: 4px; }
.tab.on { background: var(--ac); color: var(--onac); }
.badge { margin-left: 4px; background: var(--err); color: #fff; border-radius: 8px; padding: 0 5px; font-size: 10px; }
.idbar { margin-left: auto; color: var(--tx2); font-size: 12px; display: flex; align-items: center; gap: 6px; }
.fp { color: var(--tx6); font-family: monospace; font-size: 11px; }
.err { color: var(--err); font-size: 12px; }
.body { flex: 1; min-height: 0; overflow: auto; }
</style>
