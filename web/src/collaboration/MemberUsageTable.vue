<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '../i18n';
import { fmtNum, fmtTime, isOnline, machineLabel, machineFullLabel, mergeMachines } from './usagePeers';
import type { MachineRow } from './usagePeers';
import type { CollabApi } from './useCollab';
import { EMPTY_SNAPSHOT } from './types';
import type { CollabUsage, CollabGroup } from './types';
import { toCsv, downloadZip, zipStamp } from '../csv';
import UsageProbeDialog from './UsageProbeDialog.vue';

const props = defineProps<{ collab: CollabApi; peers: Record<string, CollabUsage>; group?: CollabGroup | null }>();
const snap = computed(() => props.collab.state.value ?? EMPTY_SNAPSHOT);
const activeGroup = computed(() => props.group ?? snap.value.group);
const rows = computed(() => mergeMachines(props.peers, activeGroup.value?.members || []));
const hubId = computed(() => activeGroup.value?.hubId || '');
const me = computed(() => snap.value.identity.machineId);
const emit = defineEmits<{ (e: 'removed'): void }>();
const isHub = computed(() => !!hubId.value && hubId.value === me.value);
const cleanMode = ref(false);
const selected = ref<string[]>([]);
const cleaning = ref(false);
function toggleClean() { cleanMode.value = !cleanMode.value; selected.value = []; }
function onSelectionChange(sel: MachineRow[]) { selected.value = sel.map((r) => r.machineId); }
function selectable(row: MachineRow) { return row.machineId !== me.value; }
async function confirmClean() {
  const g = activeGroup.value;
  const ids = selected.value.slice();
  if (!g || !ids.length) return;
  if (!confirm(t('collab.member.clean_confirm', { count: String(ids.length) }))) return;
  const memberIds = ids.filter((id) => (g.members || []).some((m) => m.machineId === id));
  cleaning.value = true;
  try {
    if (memberIds.length) await props.collab.removeMembers(g.id, memberIds);
    await props.collab.removeUsagePeers(g.id, ids);
    await props.collab.refresh();
    emit('removed');
    cleanMode.value = false;
    selected.value = [];
  } catch (e) {
    alert(t('collab.member.clean_failed', { msg: (e as Error)?.message || String(e) }));
  } finally {
    cleaning.value = false;
  }
}
defineExpose({ onSelectionChange, confirmClean });

function rowClassName({ row }: { row: MachineRow }): string {
  const cls = [];
  if (row.machineId === hubId.value) cls.push('master-row');
  if (row.machineId === me.value) cls.push('probe-row');
  return cls.join(' ');
}

// 只有自己那台能看采集原文（原文只存在本机）
const probeOpen = ref(false);
const probeLabel = ref('');
function onRowClick(row: MachineRow) {
  if (row.machineId !== me.value) return;
  probeLabel.value = machineFullLabel(row);
  probeOpen.value = true;
}

const num = (v?: number) => fmtNum(v);

const exporting = ref(false);
async function exportCsv() {
  if (!rows.value.length) return;
  exporting.value = true;
  try {
    const header = [t('usage.machine'), t('usage.host'), t('usage.port'), t('usage.sessions'), t('usage.messages'), t('usage.chat_messages'), t('usage.input'), t('usage.output'), t('usage.cost'), t('usage.last_report')];
    const data = rows.value.map((r) => [
      machineLabel(r), r.host || '', r.port || '', r.sessions ?? '', r.messages ?? '', r.chatMessages ?? '', r.input ?? '', r.output ?? '', r.totalCost ?? '', fmtTime(r.receivedAt),
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
      <span v-if="cleanMode" class="selhint">{{ $t('collab.member.clean_select') }}</span>
      <template v-if="cleanMode">
        <button class="mini" :disabled="cleaning || !selected.length" @click="confirmClean">
          {{ $t('collab.member.clean_delete') }} ({{ selected.length }})
        </button>
        <button class="mini" :disabled="cleaning" @click="toggleClean">{{ $t('common.cancel') }}</button>
      </template>
      <button v-else-if="isHub" class="mini" :disabled="!rows.length" @click="toggleClean">
        {{ $t('collab.member.clean') }}
      </button>
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
      @row-click="onRowClick"
      @selection-change="onSelectionChange"
    >
      <el-table-column v-if="cleanMode" type="selection" :selectable="selectable" width="40" />
      <el-table-column :label="$t('usage.machine')" sortable :sort-by="(r: any) => machineLabel(r)" min-width="190">
        <template #default="{ row }">
          <div class="mcell">
            <span class="dot" :class="{ on: isOnline(row.receivedAt) }" />
            <span v-if="row.machineId === hubId" class="crown">👑 {{ $t('collab.member.master') }}</span>
            <span v-if="row.machineId === me" class="mebadge">{{ $t('collab.member.me') }}</span>
            <span class="mname" :class="{ probe: row.machineId === me }" :title="row.machineId === me ? $t('usage.probe.hint') : machineFullLabel(row)">{{ machineLabel(row) }}</span>
            <span v-if="row.source === 'image'" class="imgsrc" :title="$t('usage.source.image')">🖼</span>
            <span v-if="!row.inGroup" class="tag">{{ $t('usage.not_in_group') }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="messages" :label="$t('usage.messages')" sortable width="80" align="right">
        <template #default="{ row }">{{ num(row.messages) }}</template>
      </el-table-column>
      <el-table-column prop="chatMessages" :label="$t('usage.chat_messages')" sortable width="96" align="right">
        <template #default="{ row }">{{ num(row.chatMessages) }}</template>
      </el-table-column>
      <el-table-column prop="input" :label="$t('usage.input')" sortable width="64" align="right">
        <template #default="{ row }">{{ num(row.input) }}</template>
      </el-table-column>
      <el-table-column prop="output" :label="$t('usage.output')" sortable width="64" align="right">
        <template #default="{ row }">{{ num(row.output) }}</template>
      </el-table-column>
      <el-table-column prop="receivedAt" :label="$t('usage.last_report')" sortable min-width="140" align="right">
        <template #default="{ row }">{{ fmtTime(row.receivedAt) }}</template>
      </el-table-column>
    </el-table>
    <UsageProbeDialog :open="probeOpen" :label="probeLabel" @close="probeOpen = false" />
  </div>
</template>

<style scoped>
.mcell { display: flex; align-items: center; min-width: 0; }
.dot { flex: none; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--tx6); margin-right: 6px; }
.dot.on { background: #4caf50; }
.mname { color: var(--tx1); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mname.probe { cursor: pointer; text-decoration: underline dotted; }
.imgsrc { flex: none; margin-left: 6px; font-size: 12px; line-height: 1; }
.utable :deep(tr.probe-row) { cursor: pointer; }
.tag { flex: none; margin-left: 8px; padding: 0 6px; border: 1px solid var(--bd); border-radius: 4px; color: var(--tx6); font-size: 11px; white-space: nowrap; }
.crown { flex: none; margin-right: 6px; padding: 0 6px; border-radius: 4px; background: var(--warn); color: #fff; font-size: 11px; font-weight: 700; line-height: 18px; white-space: nowrap; }
.mebadge { flex: none; margin-right: 6px; padding: 0 6px; border-radius: 4px; background: var(--ac); color: var(--onac); font-size: 11px; font-weight: 700; line-height: 18px; white-space: nowrap; }
.mwrap { display: flex; flex-direction: column; min-height: 0; }
.mtool { flex: none; display: flex; justify-content: flex-end; padding: 4px 8px; }
.mtool .mini { background: none; border: 1px solid var(--bd); color: var(--tx2); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 11px; font-family: inherit; }
.mtool .mini:disabled { opacity: 0.5; cursor: default; }
.selhint { color: var(--tx6); font-size: 11px; margin-right: auto; }
.utable { width: 100%; flex: 1; min-height: 0; }
.utable :deep(.cell) { white-space: nowrap; word-break: normal; }
.utable :deep(tr.master-row) td.el-table__cell { background: color-mix(in srgb, var(--warn) 14%, transparent); }
.utable :deep(tr.master-row) td.el-table__cell:first-child { box-shadow: inset 3px 0 0 var(--warn); }
</style>
