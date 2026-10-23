<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { SchedulerJob } from '@devflow/shared/scheduler';
import type { TaskView } from './useScheduler';
import { formatTime, runStatusLabel, jobStatusClass } from './format';
import { renderRemoteMarkdown } from '../markdown';

const props = defineProps<{
  task: TaskView;
  loadJobs: (taskId: string, limit?: number) => Promise<SchedulerJob[]>;
  onBack: () => void;
  onOpenSession?: (sessionId: string) => void;
}>();

const jobs = ref<SchedulerJob[]>([]);
const activeId = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const activeJob = computed(() => jobs.value.find((j) => j.jobId === activeId.value) || null);
const activeResult = computed(() => parseResult(activeJob.value));
const report = computed(() => String(activeResult.value.reportMarkdown || ''));
const reportHtml = computed(() => (report.value ? renderRemoteMarkdown(report.value) : ''));
const hasRunning = computed(() => jobs.value.some((j) => j.status === 3));

function parseResult(job: SchedulerJob | null): any {
  if (!job?.result) return {};
  try { return JSON.parse(job.result); } catch { return {}; }
}
function selectJob(id: string) { activeId.value = id; }
async function refreshJobs() {
  jobs.value = await props.loadJobs(props.task.id);
  if (!activeId.value && jobs.value.length) activeId.value = jobs.value[0].jobId;
}
function openSession() {
  const sid = activeResult.value.sessionId;
  if (sid) props.onOpenSession?.(sid);
}

onMounted(async () => {
  await refreshJobs();
  timer = setInterval(() => { if (hasRunning.value) void refreshJobs(); }, 2000);
});
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="report-view">
    <header class="rv-head">
      <button class="rv-back" @click="onBack">← {{ $t('sched.detail.back') }}</button>
      <span class="rv-title">{{ task.name }}</span>
      <span v-if="activeJob" class="rv-meta">{{ runStatusLabel(activeJob.status) }} · {{ formatTime(activeJob.createTime) }}</span>
      <button v-if="activeResult.sessionId" class="rv-session" @click="openSession">{{ $t('sched.open_session') }}</button>
    </header>
    <div class="rv-body">
      <div class="rv-list">
        <div class="rv-list-title">{{ $t('sched.detail.runs') }}</div>
        <button
          v-for="j in jobs"
          :key="j.jobId"
          class="report-item"
          :class="{ on: j.jobId === activeId }"
          @click="selectJob(j.jobId)"
        >
          <span class="status-dot" :class="jobStatusClass(j.status)" />
          <span class="ri-time">{{ formatTime(j.createTime) }}</span>
          <span class="ri-status">{{ runStatusLabel(j.status) }}</span>
          <span class="ri-dur">{{ j.runtime == null ? '—' : `${j.runtime}ms` }}</span>
        </button>
        <div v-if="!jobs.length" class="rv-empty">{{ $t('sched.detail.empty') }}</div>
      </div>
      <div class="rv-main">
        <div v-if="activeJob?.workIP" class="rv-meta rv-worker">workIP: {{ activeJob.workIP }}</div>
        <div v-if="report" class="md-body" v-html="reportHtml" />
        <div v-else class="rv-empty">{{ $t('sched.report.empty') }}</div>
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
.rv-worker { padding: 6px 12px; border-bottom: 1px solid var(--bd); }
.rv-body { flex: 1; display: flex; min-height: 0; }
.rv-list { width: 300px; flex: none; border-right: 1px solid var(--bd); overflow: auto; padding: 8px; }
.rv-list-title { color: var(--tx5); font-size: 11px; padding: 2px 6px 6px; }
.report-item { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; border-radius: 4px; color: var(--tx2); padding: 6px; cursor: pointer; font-size: 12px; text-align: left; }
.report-item:hover, .report-item.on { background: var(--bg5, var(--bg4)); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--tx5); }
.status-dot.ok { background: #3fb950; }
.status-dot.bad { background: #e5534b; }
.status-dot.run { background: var(--ac2); }
.status-dot.wait { background: #d29922; }
.status-dot.queue { background: var(--tx5); }
.ri-time { flex: 1; }
.ri-status { color: var(--tx4); }
.ri-dur { color: var(--tx5); }
.rv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.md-body { flex: 1; overflow: auto; padding: 12px 16px; color: var(--tx); }
.rv-empty { color: var(--tx5); padding: 24px; text-align: center; }
</style>
