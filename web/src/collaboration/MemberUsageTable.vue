<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import { fmtNum, isOnline, machineLabel, mergeMachines } from './usagePeers';
import type { MachineRow } from './usagePeers';
import type { CollabApi } from './useCollab';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabUsage, CollabGroup } from './types';

const props = defineProps<{ collab: CollabApi; peers: Record<string, CollabUsage>; group?: CollabGroup | null }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const activeGroup = computed(() => props.group ?? snap.value.group);
const rows = computed(() => mergeMachines(props.peers, activeGroup.value?.members || []));
const hubId = computed(() => activeGroup.value?.hubId || '');
const me = computed(() => snap.value.identity.machineId);

function rowClassName({ row }: { row: MachineRow }): string {
  return row.machineId === hubId.value ? 'master-row' : '';
}

const num = (v?: number) => fmtNum(v);
</script>

<template>
  <el-table
    :data="rows"
    size="small"
    class="utable"
    :default-sort="{ prop: 'messages', order: 'descending' }"
    :row-class-name="rowClassName"
    :empty-text="t('collab.member.empty')"
  >
    <el-table-column :label="$t('usage.machine')" sortable :sort-by="(r: any) => machineLabel(r)" min-width="130">
      <template #default="{ row }">
        <div class="mcell">
          <span class="dot" :class="{ on: isOnline(row.receivedAt) }" />
          <span v-if="row.machineId === hubId" class="crown">👑 {{ $t('collab.member.master') }}</span>
          <span v-if="row.machineId === me" class="mebadge">{{ $t('collab.member.me') }}</span>
          <span class="mname" :title="machineLabel(row)">{{ machineLabel(row) }}</span>
          <span class="host">@{{ row.host || '-' }}:{{ row.port || '-' }}</span>
          <span v-if="!row.inGroup" class="tag">{{ $t('usage.not_in_group') }}</span>
        </div>
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
.mcell { display: flex; align-items: center; min-width: 0; }
.dot { flex: none; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--tx6); margin-right: 6px; }
.dot.on { background: #4caf50; }
.mname { color: var(--tx1); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host { flex: none; color: var(--tx6); margin-left: 6px; font-size: 11px; white-space: nowrap; }
.tag { flex: none; margin-left: 8px; padding: 0 6px; border: 1px solid var(--bd); border-radius: 4px; color: var(--tx6); font-size: 11px; white-space: nowrap; }
.crown { flex: none; margin-right: 6px; padding: 0 6px; border-radius: 4px; background: var(--warn); color: #fff; font-size: 11px; font-weight: 700; line-height: 18px; white-space: nowrap; }
.mebadge { flex: none; margin-right: 6px; padding: 0 6px; border-radius: 4px; background: var(--ac); color: var(--onac); font-size: 11px; font-weight: 700; line-height: 18px; white-space: nowrap; }
.utable { width: 100%; }
.utable :deep(.cell) { white-space: nowrap; word-break: normal; }
.utable :deep(tr.master-row) td.el-table__cell { background: color-mix(in srgb, var(--warn) 14%, transparent); }
.utable :deep(tr.master-row) td.el-table__cell:first-child { box-shadow: inset 3px 0 0 var(--warn); }
</style>
