<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { t } from '../i18n';
import { fmtNum, isOnline, machineLabel, mergeMachines } from './usagePeers';
import type { CollabApi } from './useCollab';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabUsage } from './types';

const props = defineProps<{ collab: CollabApi }>();
const peers = ref<Record<string, CollabUsage>>({});
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const rows = computed(() => mergeMachines(peers.value, snap.value.group?.members || []));

const fmtTime = (ms?: number) => (ms ? new Date(ms).toLocaleString() : '—');
const num = (v?: number) => fmtNum(v);

async function loadPeers() {
  try { const r = await fetch('/api/usage/peers').then((x) => x.json()); peers.value = r.peers || {}; } catch { /* ignore */ }
}
onMounted(loadPeers);
watch(() => props.collab.state.value, loadPeers);
</script>

<template>
  <el-table
    :data="rows"
    size="small"
    class="utable"
    :default-sort="{ prop: 'messages', order: 'descending' }"
    :empty-text="t('collab.member.empty')"
  >
    <el-table-column :label="$t('usage.machine')" sortable :sort-by="(r: any) => machineLabel(r)" min-width="220">
      <template #default="{ row }">
        <span class="dot" :class="{ on: isOnline(row.receivedAt) }" />
        <span class="mname">{{ machineLabel(row) }}</span>
        <span class="host">@{{ row.host || '-' }}:{{ row.port || '-' }}</span>
        <span v-if="!row.inGroup" class="tag">{{ $t('usage.not_in_group') }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="sessions" :label="$t('usage.sessions')" sortable width="92" align="right">
      <template #default="{ row }">{{ num(row.sessions) }}</template>
    </el-table-column>
    <el-table-column prop="days" :label="$t('usage.days')" sortable width="84" align="right">
      <template #default="{ row }">{{ num(row.days) }}</template>
    </el-table-column>
    <el-table-column prop="messages" :label="$t('usage.messages')" sortable width="104" align="right">
      <template #default="{ row }">{{ num(row.messages) }}</template>
    </el-table-column>
    <el-table-column prop="input" :label="$t('usage.input')" sortable width="104" align="right">
      <template #default="{ row }">{{ num(row.input) }}</template>
    </el-table-column>
    <el-table-column prop="output" :label="$t('usage.output')" sortable width="104" align="right">
      <template #default="{ row }">{{ num(row.output) }}</template>
    </el-table-column>
    <el-table-column prop="totalCost" :label="$t('usage.cost')" sortable width="96" align="right">
      <template #default="{ row }">{{ row.totalCost == null ? '-' : row.totalCost }}</template>
    </el-table-column>
    <el-table-column prop="receivedAt" :label="$t('usage.last_report')" sortable min-width="168" align="right">
      <template #default="{ row }">{{ fmtTime(row.receivedAt) }}</template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--tx6); margin-right: 6px; vertical-align: middle; }
.dot.on { background: #4caf50; }
.mname { color: var(--tx1); }
.host { color: var(--tx6); margin-left: 6px; font-size: 11px; }
.tag { margin-left: 8px; padding: 0 6px; border: 1px solid var(--bd); border-radius: 4px; color: var(--tx6); font-size: 11px; }
.utable { width: 100%; }
</style>
