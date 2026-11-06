<template>
  <div class="active-agents">
    <div class="active-head">
      <span>{{ $t('term.active_title') }} ({{ sessions.length }})</span>
      <el-button v-if="showCleanup" type="danger" size="small" :loading="clearing" :disabled="!sessions.length" @click="$emit('cleanup')">
        {{ clearing ? $t('term.active_clearing') : $t('term.active_clear_all') }}
      </el-button>
    </div>
    <el-table :data="sessions" row-key="id" size="small" border stripe :empty-text="$t('term.active_empty')" style="width: 100%">
      <el-table-column prop="name" :label="$t('term.active_name')" min-width="150" show-overflow-tooltip />
      <el-table-column :label="$t('term.active_agent')" width="100">
        <template #default="{ row }">
          <el-tag size="small" type="success">{{ activeAgentType(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('term.active_project')" width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ row.projectId || '-' }}</template>
      </el-table-column>
      <el-table-column prop="cwd" :label="$t('term.active_cwd')" min-width="170" show-overflow-tooltip />
      <el-table-column :label="$t('term.active_memory')" width="95" align="right">
        <template #default="{ row }">{{ memoryText(row.id) }}</template>
      </el-table-column>
      <el-table-column :label="$t('term.active_started')" width="150">
        <template #default="{ row }">{{ activeAgentStarted(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column :label="$t('term.active_actions')" width="72" align="right">
        <template #default="{ row }">
          <el-button link type="danger" size="small" @click="$emit('end', row)">{{ $t('term.active_end') }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="active-hint">{{ $t('term.active_hint') }}</div>
  </div>
</template>

<script setup lang="ts">
import type { SessionSummary } from '../useTerminal';

const props = withDefaults(defineProps<{
  sessions: SessionSummary[];
  memoryBySession?: Record<string, { bytes?: number; processes?: number }>;
  clearing?: boolean;
  showCleanup?: boolean;
}>(), {
  memoryBySession: () => ({}),
  clearing: false,
  showCleanup: true,
});

defineEmits<{ (e: 'end', s: SessionSummary): void; (e: 'cleanup'): void }>();

function activeAgentType(s: SessionSummary) { return s.agentId || 'agent'; }
function activeAgentStarted(ts?: number) { return ts ? new Date(ts).toLocaleString() : '-'; }
function memoryText(id: string) {
  const bytes = Number(props.memoryBySession[id]?.bytes) || 0;
  if (!bytes) return '-';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}
</script>

<style scoped>
.active-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: var(--tx2);
  margin-bottom: 8px;
}
.active-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--tx2);
}
</style>
