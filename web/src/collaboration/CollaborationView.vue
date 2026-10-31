<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed } from 'vue';
import { CollabS2C } from '@devflow/shared/collab';
import { useCollab } from './useCollab';
import { EMPTY_SNAPSHOT } from './types';
import type { useTerminal } from '../useTerminal';
import GroupView from './GroupView.vue';
import { t } from '../i18n';

type CollabTab = 'group';
const props = defineProps<{ terminal: ReturnType<typeof useTerminal>; tab?: CollabTab }>();
const emit = defineEmits<{ (e: 'update:tab', v: CollabTab): void }>();
const collab = useCollab();
const snap = computed(() => collab.state.value ?? EMPTY_SNAPSHOT);
const tab = computed(() => props.tab ?? 'group');
function setTab(v: CollabTab) { emit('update:tab', v); }
const tabs = computed(() => [
  { id: 'group' as const, label: t('collab.tabs.group') },
]);

// —— slave：master 同步种子更新弹窗 ——
let unsubs: (() => void)[] = [];
onMounted(() => {
  collab.refresh().catch(() => {});
  unsubs = [
    props.terminal.on(CollabS2C.COLLAB_SYNCED, () => { collab.refresh().catch(() => {}); }),
    props.terminal.on(CollabS2C.COLLAB_INBOX, () => collab.refresh().catch(() => {})),
    props.terminal.on(CollabS2C.COLLAB_CHAT, (payload: any) => collab.handleS2C(CollabS2C.COLLAB_CHAT, payload)),
    props.terminal.on(CollabS2C.COLLAB_CMD_PENDING, (payload: any) => collab.handleS2C(CollabS2C.COLLAB_CMD_PENDING, payload)),
    props.terminal.on(CollabS2C.COLLAB_HEARTBEAT, () => collab.refresh().catch(() => {})),
  ];
});
onBeforeUnmount(() => { unsubs.forEach((u) => u()); });
</script>

<template>
  <div class="cv">
    <header class="topbar">
      <span class="title">{{ $t('collab.title') }}</span>
      <nav class="tabs">
        <button v-for="t in tabs" :key="t.id" class="tab" :class="{ on: tab === t.id }" @click="setTab(t.id)">
          {{ t.label }}
        </button>
      </nav>
      <div class="idbar" v-if="snap.identity.machineId">
        {{ snap.identity.employeeId || snap.identity.username }} · {{ snap.identity.host }}:{{ snap.identity.port }}
        <span class="fp">{{ snap.identity.publicKey.slice(-8) }}</span>
      </div>
      <span v-if="collab.lastError" class="err">{{ collab.lastError }}</span>
    </header>
    <section class="body">
      <GroupView v-if="tab === 'group'" :collab="collab" />
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
.tb { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.tb:hover { border-color: var(--ac2); }
.idbar { margin-left: auto; color: var(--tx2); font-size: 12px; display: flex; align-items: center; gap: 6px; }
.fp { color: var(--tx6); font-family: monospace; font-size: 11px; }
.err { color: var(--err); font-size: 12px; }
.body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
</style>
