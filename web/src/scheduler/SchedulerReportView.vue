<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { SchedulerJob } from '@devflow/shared/scheduler';
import type { TaskView, TaskPrompt } from './useScheduler';
import { formatTime, runStatusLabel, jobStatusClass } from './format';
import { renderRemoteMarkdown } from '../markdown';

const props = defineProps<{
  task: TaskView;
  loadJobs: (taskId: string, limit?: number) => Promise<SchedulerJob[]>;
  loadPrompts?: (taskId: string, hash?: string) => Promise<{ prompts: TaskPrompt[]; activeId: number | null }>;
  onBack: () => void;
  onOpenSession?: (sessionId: string) => void;
  onEditPrompt?: (promptId: number | null) => void;
}>();

const jobs = ref<SchedulerJob[]>([]);
const activeId = ref('');
const prompts = ref<TaskPrompt[]>([]);
const activePromptId = ref<number | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

const activeJob = computed(() => jobs.value.find((j) => j.jobId === activeId.value) || null);
const activeResult = computed(() => parseResult(activeJob.value));
const activePrompt = computed(() => prompts.value.find((p) => p.id === activePromptId.value) || prompts.value[0] || null);
const report = computed(() => {
  const r = activeResult.value;
  for (const k of ['reportMarkdown', 'result', 'output', 'text']) {
    if (typeof r[k] === 'string' && r[k].trim()) return r[k];
  }
  return '';
});
const reportHtml = computed(() => (report.value ? renderRemoteMarkdown(report.value) : ''));
const fallbackPrompt = computed(() => {
  const ai = props.task.ai;
  if (props.task.type !== 'ai' || !ai) return '';
  if (ai.source === 'file') return props.task.filePath || '';
  if (ai.source === 'command') return ai.commandName || '';
  return ai.prompt || '';
});
const promptText = computed(() => activePrompt.value?.prompt || fallbackPrompt.value);
const promptMeta = computed(() => {
  const p = activePrompt.value;
  if (!p) return '';
  return [p.employeeId, p.createIP, formatTime(p.createdAt)].filter(Boolean).join(' · ');
});
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
async function refreshPrompts() {
  if (!props.loadPrompts || props.task.type !== 'ai') return;
  const r = await props.loadPrompts(props.task.id, props.task.promptHash || '');
  prompts.value = r.prompts;
  activePromptId.value = r.activeId;
}
function openSession() {
  const sid = activeResult.value.sessionId;
  if (sid) props.onOpenSession?.(sid);
}

onMounted(async () => {
  await Promise.all([refreshJobs(), refreshPrompts()]);
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
      <span v-if="activeResult.ngaSessionId" class="rv-meta" :title="String(activeResult.ngaSessionId)">Nga: {{ activeResult.ngaSessionId }}</span>
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
        <div v-if="promptText" class="prompt-box">
          <div class="prompt-head">
            <span class="prompt-title">{{ $t('sched.detail.prompt') }}</span>
            <select v-if="prompts.length > 1" v-model.number="activePromptId" class="prompt-ver">
              <option v-for="p in prompts" :key="p.id" :value="p.id">{{ formatTime(p.createdAt) }}</option>
            </select>
            <span v-if="promptMeta" class="prompt-meta">{{ promptMeta }}</span>
            <button v-if="onEditPrompt" class="prompt-edit" @click="onEditPrompt(activePrompt?.id ?? null)">{{ $t('sched.prompt.edit') }}</button>
          </div>
          <pre class="prompt-text">{{ promptText }}</pre>
          <div v-if="activePrompt?.hash" class="prompt-hash" :title="activePrompt.hash">#{{ activePrompt.id }} · sha256: {{ activePrompt.hash }}</div>
        </div>
        <div v-if="activeJob?.workIP" class="rv-meta rv-worker">workIP: {{ activeJob.workIP }}</div>
        <div v-if="activeResult.reportId" class="rv-meta rv-report-meta">{{ $t('sched.report.id') }}: {{ activeResult.reportId }}</div>
        <div v-if="activeResult.reportArchivePath" class="rv-meta rv-report-meta" :title="activeResult.reportArchivePath">{{ $t('sched.report.archive') }}: {{ activeResult.reportArchivePath }}</div>
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
.rv-report-meta { padding: 4px 12px; border-bottom: 1px solid var(--bd); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
.prompt-box { flex: none; max-height: 30vh; overflow: auto; padding: 8px 12px; border-bottom: 1px solid var(--bd); background: var(--bg1); }
.prompt-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.prompt-title { color: var(--tx5); font-size: 11px; }
.prompt-ver { font-size: 11px; max-width: 180px; }
.prompt-meta { color: var(--tx5); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prompt-edit { margin-left: auto; flex: none; background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 11px; }
.prompt-text { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; color: var(--tx2); font-family: inherit; }
.prompt-hash { margin-top: 4px; color: var(--tx5); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.md-body { flex: 1; overflow: auto; padding: 12px 16px; color: var(--tx); }
.rv-empty { color: var(--tx5); padding: 24px; text-align: center; }
</style>
