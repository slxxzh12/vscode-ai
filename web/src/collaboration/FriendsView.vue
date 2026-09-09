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
