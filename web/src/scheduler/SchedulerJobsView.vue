<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { SchedulerJob } from '@devflow/shared/scheduler';
import type { TaskView } from './useScheduler';
import { formatTime, runStatusLabel, jobStatusClass } from './format';
import { renderRemoteMarkdown } from '../markdown';

const props = defineProps<{
  tasks: TaskView[];
  loadJobs: (limit?: number) => Promise<SchedulerJob[]>;
  loadLog: (jobId: string) => Promise<string>;
}>();

const jobs = ref<SchedulerJob[]>([]);
const activeId = ref('');
const tab = ref<'report' | 'process'>('report');
const logText = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const activeJob = computed(() => jobs.value.find((j) => j.jobId === activeId.value) || null);
const activeResult = computed(() => parseResult(activeJob.value));
const report = computed(() => String(activeResult.value.reportMarkdown || ''));
const reportHtml = computed(() => (report.value ? renderRemoteMarkdown(report.value) : ''));

function parseResult(job: SchedulerJob | null): any {
  if (!job?.result) return {};
  try { return JSON.parse(job.result); } catch { return {}; }
}
function taskName(job: SchedulerJob): string {
  return props.tasks.find((t) => t.id === job.taskId)?.name || job.taskId || '—';
}
function selectJob(job: SchedulerJob) {
  activeId.value = job.jobId;
  logText.value = '';
}
async function refreshJobs() {
  jobs.value = await props.loadJobs(200);
  if (!activeId.value && jobs.value.length) activeId.value = jobs.value[0].jobId;
}
async function setTab(next: 'report' | 'process') {
  tab.value = next;
  if (next === 'process' && activeId.value && !logText.value) logText.value = await props.loadLog(activeId.value);
}

onMounted(async () => {
  await refreshJobs();
  timer = setInterval(() => { void refreshJobs(); }, 2500);
});
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="jobs-view">
    <div class="jv-body">
      <div class="jv-list">
        <div class="jv-list-title">{{ $t('sched.tab.jobs') }}</div>
        <button
          v-for="j in jobs"
          :key="j.jobId"
          class="job-item"
          :class="{ on: j.jobId === activeId }"
          @click="selectJob(j)"
        >
          <span class="status-dot" :class="jobStatusClass(j.status)" />
          <span class="ji-main">
            <span class="ji-task">{{ taskName(j) }}</span>
            <span class="ji-time">{{ formatTime(j.createTime) }} · {{ runStatusLabel(j.status) }}</span>
          </span>
          <span class="ji-dur">{{ j.runtime == null ? '—' : `${j.runtime}ms` }}</span>
        </button>
        <div v-if="!jobs.length" class="jv-empty">{{ $t('sched.jobs.empty') }}</div>
      </div>
      <div class="jv-main">
        <header class="jv-head">
          <span v-if="activeJob" class="jv-title">{{ taskName(activeJob) }}</span>
          <span v-if="activeJob" class="dim">{{ runStatusLabel(activeJob.status) }} · {{ formatTime(activeJob.createTime) }}</span>
          <div class="spacer" />
          <div class="jv-tabs">
            <button :class="{ on: tab === 'report' }" @click="setTab('report')">{{ $t('sched.jobs.report') }}</button>
            <button :class="{ on: tab === 'process' }" @click="setTab('process')">{{ $t('sched.jobs.process') }}</button>
          </div>
        </header>
        <template v-if="activeJob">
          <div v-if="tab === 'report'">
            <div v-if="report" class="md-body" v-html="reportHtml" />
            <div v-else class="jv-empty">{{ $t('sched.report.empty') }}</div>
          </div>
          <pre v-else class="jv-log">{{ logText || $t('sched.chat.empty_process') }}</pre>
        </template>
        <div v-else class="jv-empty">{{ $t('sched.jobs.select') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jobs-view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.jv-body { flex: 1; min-height: 0; display: flex; }
.jv-list { width: 320px; flex: none; border-right: 1px solid var(--bd); overflow: auto; padding: 8px; }
.jv-list-title { color: var(--tx5); font-size: 11px; padding: 2px 6px 6px; }
.job-item { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; border-radius: 4px; color: var(--tx2); padding: 6px; cursor: pointer; text-align: left; }
.job-item:hover, .job-item.on { background: var(--bg5, var(--bg4)); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--tx5); }
.status-dot.ok { background: #3fb950; }
.status-dot.bad { background: #e5534b; }
.status-dot.run { background: var(--ac2); }
.status-dot.wait, .status-dot.queue { background: #d29922; }
.ji-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ji-task { color: var(--tx2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ji-time { color: var(--tx5); font-size: 11px; }
.ji-dur { color: var(--tx5); font-size: 11px; flex: none; }
.jv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.jv-head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--bd); }
.jv-head .spacer { flex: 1; }
.jv-title { color: var(--tx1); font-weight: 600; }
.jv-tabs { display: flex; gap: 4px; }
.jv-tabs button { background: var(--bg5, var(--bg4)); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.jv-tabs button.on { background: var(--ac2); color: #fff; }
.md-body { overflow: auto; padding: 14px 18px; color: var(--tx); }
.jv-log { flex: 1; margin: 0; overflow: auto; padding: 12px; background: var(--bg6, var(--bg1)); color: var(--tx2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; white-space: pre-wrap; }
.jv-empty { color: var(--tx5); padding: 24px; text-align: center; }
.dim { color: var(--tx5); font-size: 12px; }
</style>
