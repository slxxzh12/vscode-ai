<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '../i18n';
import { fmtNum, fmtTime, isOnline, machineLabel, mergeMachines } from './usagePeers';
import type { MachineRow } from './usagePeers';
import type { CollabApi } from './useCollab';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabUsage, CollabGroup } from './types';
import { toCsv, downloadZip, zipStamp } from '../csv';

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

const exporting = ref(false);
async function exportCsv() {
  if (!rows.value.length) return;
  exporting.value = true;
  try {
    const header = [t('usage.machine'), t('usage.host'), t('usage.port'), t('usage.sessions'), t('usage.messages'), t('usage.input'), t('usage.output'), t('usage.cost'), t('usage.last_report')];
    const data = rows.value.map((r) => [
      machineLabel(r), r.host || '', r.port || '', r.sessions ?? '', r.messages ?? '', r.input ?? '', r.output ?? '', r.totalCost ?? '', fmtTime(r.receivedAt),
    ]);
    await downloadZip(`group-members-${zipStamp()}.zip`, [{ name: 'group-members.csv', content: toCsv(header, data) }]);
  } catch (e) {
    alert(t('collab.member.export_failed', { msg: (e as Error)?.message || String(e) }));
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="mwrap">
    <div class="mtool">
      <button class="mini" :disabled="exporting || !rows.length" @click="exportCsv">
        {{ $t('collab.member.export') }}
      </button>
    </div>
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
      <el-table-column prop="receivedAt" :label="$t('usage.last_report')" sortable min-width="140" align="right">
        <template #default="{ row }">{{ fmtTime(row.receivedAt) }}</template>
      </el-table-column>
    </el-table>
  </div>
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
.mwrap { display: flex; flex-direction: column; min-height: 0; }
.mtool { flex: none; display: flex; justify-content: flex-end; padding: 4px 8px; }
.mtool .mini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 11px; font-family: inherit; }
.mtool .mini:disabled { opacity: 0.5; cursor: default; }
.utable { width: 100%; flex: 1; min-height: 0; }
.utable :deep(.cell) { white-space: nowrap; word-break: normal; }
.utable :deep(tr.master-row) td.el-table__cell { background: color-mix(in srgb, var(--warn) 14%, transparent); }
.utable :deep(tr.master-row) td.el-table__cell:first-child { box-shadow: inset 3px 0 0 var(--warn); }
</style>
