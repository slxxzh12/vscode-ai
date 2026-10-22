<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { SchedulerRun } from '@devflow/shared/scheduler';
import type { TaskView } from './useScheduler';
import { formatTime, runStatusLabel } from './format';
import { renderRemoteMarkdown } from '../markdown';

const props = defineProps<{
  task: TaskView;
  loadRuns: (taskId: string) => Promise<SchedulerRun[]>;
  loadReport: (runId: string) => Promise<string>;
  loadLog: (runId: string) => Promise<string>;
  onBack: () => void;
  onOpenSession?: (sessionId: string) => void;
  openReportDir?: (runId: string) => Promise<void>;
}>();

const runs = ref<SchedulerRun[]>([]);
const activeId = ref('');
const report = ref('');
const logText = ref('');
const mode = ref<'report' | 'raw'>('report');
let timer: ReturnType<typeof setInterval> | null = null;

const activeRun = computed(() => runs.value.find((r) => r.id === activeId.value) || null);
const reportHtml = computed(() => (report.value ? renderRemoteMarkdown(report.value) : ''));
const hasRunning = computed(() => runs.value.some((r) => r.status === 'running' || r.status === 'paused'));
const multiFiles = computed(() => (activeRun.value?.reportCount || 0) > 1);

function statusClass(s: string) {
  if (s === 'success') return 'ok';
  if (s === 'failed' || s === 'timeout' || s === 'killed') return 'bad';
  return 'run';
}

async function selectRun(id: string) {
  activeId.value = id;
  report.value = await props.loadReport(id);
  logText.value = '';
  if (mode.value === 'raw') logText.value = await props.loadLog(id);
}

async function refreshRuns() {
  runs.value = await props.loadRuns(props.task.id);
  if (!activeId.value && runs.value.length) await selectRun(runs.value[0].id);
  else if (activeId.value) await selectRun(activeId.value);
}

async function setMode(m: 'report' | 'raw') {
  mode.value = m;
  if (m === 'raw' && activeId.value && !logText.value) logText.value = await props.loadLog(activeId.value);
}

function openDir() {
  if (activeId.value) void props.openReportDir?.(activeId.value);
}

onMounted(async () => {
  await refreshRuns();
  timer = setInterval(() => { if (hasRunning.value) void refreshRuns(); }, 2000);
});
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="report-view">
    <header class="rv-head">
      <button class="rv-back" @click="onBack">← {{ $t('sched.detail.back') }}</button>
      <span class="rv-title">{{ task.name }}</span>
      <span v-if="activeRun" class="rv-meta">{{ runStatusLabel(activeRun.status) }} · {{ formatTime(activeRun.startedAt) }}</span>
      <button v-if="activeRun" class="rv-session" @click="openDir">{{ $t('sched.detail.open_dir') }}</button>
      <button v-if="activeRun?.sessionId" class="rv-session" @click="onOpenSession?.(activeRun.sessionId || '')">{{ $t('sched.open_session') }}</button>
    </header>
    <div class="rv-body">
      <div class="rv-list">
        <div class="rv-list-title">{{ $t('sched.detail.runs') }}</div>
        <button
          v-for="r in runs"
          :key="r.id"
          class="report-item"
          :class="{ on: r.id === activeId }"
          @click="selectRun(r.id)"
        >
          <span class="status-dot" :class="statusClass(r.status)" />
          <span class="ri-time">{{ formatTime(r.startedAt) }}</span>
          <span class="ri-status">{{ runStatusLabel(r.status) }}</span>
          <span class="ri-dur">{{ r.durationMs == null ? '—' : `${r.durationMs}ms` }}</span>
        </button>
        <div v-if="!runs.length" class="rv-empty">{{ $t('sched.detail.empty') }}</div>
      </div>
      <div class="rv-main">
        <div class="rv-tabs">
          <button :class="{ on: mode === 'report' }" @click="setMode('report')">{{ $t('sched.detail.report') }}</button>
          <button class="raw-tab" :class="{ on: mode === 'raw' }" @click="setMode('raw')">{{ $t('sched.detail.raw_log') }}</button>
        </div>
        <div v-if="mode === 'report' && multiFiles" class="multi-hint">{{ $t('sched.detail.multi_files', { n: activeRun?.reportCount }) }}</div>
        <div v-if="mode === 'report'" class="md-body" :class="{ clickable: multiFiles }" v-html="reportHtml" @click="multiFiles && openDir()" />
        <pre v-else class="raw-log">{{ logText }}</pre>
        <div v-if="mode === 'report' && !report" class="rv-empty">{{ $t('sched.report.empty') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.report-view { display: flex; flex-direction: column; height: 100%; background: var(--bg0, var(--bg1)); }
.rv-head { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border-bottom: 1px solid var(--bd); }
.rv-back, .rv-session { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.rv-title { font-weight: 700; color: var(--tx1); }
.rv-meta { color: var(--tx5); font-size: 12px; }
.rv-body { flex: 1; display: flex; min-height: 0; }
.rv-list { width: 300px; flex: none; border-right: 1px solid var(--bd); overflow: auto; padding: 8px; }
.rv-list-title { color: var(--tx5); font-size: 11px; padding: 2px 6px 6px; }
.report-item { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; border-radius: 4px; color: var(--tx2); padding: 6px; cursor: pointer; font-size: 12px; text-align: left; }
.report-item:hover, .report-item.on { background: var(--bg5, var(--bg4)); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--tx5); }
.status-dot.ok { background: #3fb950; }
.status-dot.bad { background: #e5534b; }
.status-dot.run { background: var(--ac2); }
.ri-time { flex: 1; }
.ri-status { color: var(--tx4); }
.ri-dur { color: var(--tx5); }
.rv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.rv-tabs { display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--bd); }
.rv-tabs button { background: var(--bg5, var(--bg4)); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.rv-tabs button.on { background: var(--ac2); color: #fff; }
.md-body { flex: 1; overflow: auto; padding: 12px 16px; color: var(--tx); }
.md-body.clickable { cursor: pointer; }
.multi-hint { padding: 6px 12px; border-bottom: 1px solid var(--bd); color: var(--tx5); font-size: 12px; }
.raw-log { flex: 1; margin: 0; overflow: auto; padding: 12px; background: var(--bg6, var(--bg1)); color: var(--tx2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; white-space: pre-wrap; }
.rv-empty { color: var(--tx5); padding: 24px; text-align: center; }
</style>
