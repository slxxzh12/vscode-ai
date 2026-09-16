<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import { fmtNum, isOnline, machineLabel, mergeMachines } from './usagePeers';
import type { CollabApi } from './useCollab';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabUsage } from './types';

const props = defineProps<{ collab: CollabApi; peers: Record<string, CollabUsage> }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const rows = computed(() => mergeMachines(props.peers, snap.value.group?.members || []));

const num = (v?: number) => fmtNum(v);
</script>

<template>
  <el-table
    :data="rows"
    size="small"
    class="utable"
    :default-sort="{ prop: 'messages', order: 'descending' }"
    :empty-text="t('collab.member.empty')"
  >
    <el-table-column :label="$t('usage.machine')" sortable :sort-by="(r: any) => machineLabel(r)" min-width="130">
      <template #default="{ row }">
        <span class="dot" :class="{ on: isOnline(row.receivedAt) }" />
        <span class="mname">{{ machineLabel(row) }}</span>
        <span class="host">@{{ row.host || '-' }}:{{ row.port || '-' }}</span>
        <span v-if="!row.inGroup" class="tag">{{ $t('usage.not_in_group') }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="messages" :label="$t('usage.messages')" sortable width="80" align="right">
      <template #default="{ row }">{{ num(row.messages) }}</template>
    </el-table-column>
    <el-table-column prop="input" :label="$t('usage.input')" sortable width="80" align="right">
      <template #default="{ row }">{{ num(row.input) }}</template>
    </el-table-column>
    <el-table-column prop="output" :label="$t('usage.output')" sortable width="80" align="right">
      <template #default="{ row }">{{ num(row.output) }}</template>
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
