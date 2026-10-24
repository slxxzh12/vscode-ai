<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { t } from '../i18n';
import { useJobs, type Job } from './useJobs';
import { jobStatusLabel, jobStatusClass } from './format';
import { renderRemoteMarkdown } from '../markdown';

const jobs = useJobs();
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => { void jobs.refresh(); void loadWorkers(); void loadConfig(); timer = setInterval(() => { void jobs.refresh(); void loadWorkers(); }, 2000); });
onUnmounted(() => { if (timer) clearInterval(timer); });
const detail = ref<Job | null>(null);
const partitionInput = ref('');
const sortedJobs = computed(() => [...jobs.state.jobs].sort((a, b) =>
  (b.createTime || 0) - (a.createTime || 0) || String(b.jobId).localeCompare(String(a.jobId))));
const workers = ref<any[]>([]);
const isMaster = ref(false);
const configOpen = ref(false);
const config = ref({ backend: 'sqlite', host: '', port: 3306, user: '', database: '', hasPassword: false, password: '', partitionCount: 16 });

async function loadWorkers() {
  try { workers.value = (await jobs.loadWorkers()).workers || []; } catch { workers.value = []; }
}
async function loadConfig() {
  try { const d = await jobs.loadConfig(); config.value = { ...config.value, ...d, password: '' }; isMaster.value = d.role === 'master'; } catch { isMaster.value = false; }
}
async function saveConfig() {
  const body: any = { ...config.value };
  if (!body.password && body.hasPassword) delete body.password;
  await jobs.saveConfig(body);
  configOpen.value = false;
  alert(t('jobs.config.restart_required'));
}
async function cleanup() {
  await jobs.cleanup();
  await jobs.refresh();
}
function applyFilters() {
  const v = partitionInput.value.trim();
  const p = v === '' ? null : Number(v);
  jobs.state.partition = p !== null && Number.isFinite(p) ? p : null;
  void jobs.refresh();
}
async function savePartitions() {
  await jobs.setPartitions(config.value.partitionCount);
  configOpen.value = false;
  alert(t('jobs.config.restart_required'));
}
function taskNameOf(job: Job): string {
  try { return JSON.parse(job.paramStr || '{}').task?.name || '—'; } catch { return '—'; }
}
function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}
function reportOf(job: Job): string {
  try {
    const r = JSON.parse(job.result || '{}');
    for (const k of ['reportMarkdown', 'result', 'output', 'text']) {
      if (typeof r[k] === 'string' && r[k].trim()) return r[k];
    }
    return '';
  } catch { return ''; }
}
function ngaSessionOf(job: Job | null): string {
  if (!job) return '';
  try { return String(JSON.parse(job.result || '{}').ngaSessionId || ''); } catch { return ''; }
}
const detailReport = computed(() => (detail.value ? reportOf(detail.value) : ''));
const detailReportHtml = computed(() => (detailReport.value ? renderRemoteMarkdown(detailReport.value) : ''));
const detailNgaSession = computed(() => ngaSessionOf(detail.value));
const detailReportUrl = computed(() => {
  if (!detail.value) return '';
  try { return String(JSON.parse(detail.value.result || '{}').reportUrl || ''); } catch { return ''; }
});
</script>

<template>
  <div class="jobs-view">
    <header class="jobs-head">
      <span class="title">{{ $t('jobs.title') }}</span>
      <span class="dim">{{ jobs.state.topic }} · {{ jobs.state.partitionCount }} partitions</span>
      <button @click="jobs.refresh()">{{ $t('sched.refresh') }}</button>
      <select v-model="jobs.state.status" @change="applyFilters()">
        <option :value="null">{{ $t('jobs.filter.all') }}</option>
        <option :value="0">{{ $t('jobs.status.queued') }}</option>
        <option :value="3">{{ $t('jobs.status.running') }}</option>
        <option :value="4">{{ $t('jobs.status.pending') }}</option>
        <option :value="1">{{ $t('jobs.status.success') }}</option>
        <option :value="2">{{ $t('jobs.status.failed') }}</option>
      </select>
      <input v-model="jobs.state.taskId" :placeholder="$t('jobs.filter.task')" @keyup.enter="applyFilters()" />
      <input v-model="partitionInput" type="number" min="0" :placeholder="$t('jobs.filter.partition')" @keyup.enter="applyFilters()" />
      <button v-if="isMaster" @click="cleanup()">{{ $t('jobs.action.cleanup') }}</button>
      <button v-if="isMaster" @click="configOpen = true; loadConfig()">{{ $t('jobs.config.title') }}</button>
    </header>
    <div class="summary">
      <div class="sum-card sum-queued"><span class="num">{{ jobs.state.summary.queued }}</span><span>{{ $t('jobs.summary.queued') }}</span></div>
      <div class="sum-card sum-running"><span class="num">{{ jobs.state.summary.running }}</span><span>{{ $t('jobs.summary.running') }}</span></div>
      <div class="sum-card sum-pending"><span class="num">{{ jobs.state.summary.pending }}</span><span>{{ $t('jobs.summary.pending') }}</span></div>
      <div class="sum-card sum-success"><span class="num">{{ jobs.state.summary.success }}</span><span>{{ $t('jobs.summary.success') }}</span></div>
      <div class="sum-card sum-failed"><span class="num">{{ jobs.state.summary.failed }}</span><span>{{ $t('jobs.summary.failed') }}</span></div>
    </div>
    <section class="workers">
      <span v-for="w in workers" :key="w.id" class="worker" :class="{ off: !w.online }">
        {{ w.hostport }} · {{ w.role }} · {{ w.online ? $t('jobs.worker.online') : $t('jobs.worker.offline') }} · P{{ w.partitionIds }}
      </span>
    </section>
    <div class="job-list">
      <article v-for="job in sortedJobs" :key="job.jobId" class="job-row" @click="detail = job">
        <span class="st" :class="jobStatusClass(job.status)">{{ jobStatusLabel(job.status) }}</span>
        <span class="name">{{ taskNameOf(job) }}</span>
        <span class="tag">P{{ job.partitionId }}</span>
        <span class="ip">{{ job.workIP || job.createIP || '—' }}</span>
        <span class="time">{{ formatTime(job.createTime) }}</span>
        <span class="runtime">{{ job.runtime != null ? `${job.runtime} ms` : '—' }}</span>
        <span class="jid">{{ job.jobId }}</span>
      </article>
      <p v-if="!sortedJobs.length" class="empty">{{ $t('sched.jobs.empty') }}</p>
    </div>
    <aside v-if="detail" class="job-drawer">
      <button class="close" @click="detail = null">×</button>
      <h3>{{ $t('jobs.detail.title') }}</h3>
      <div>jobId: {{ detail.jobId }}</div>
      <div>parentJobId: {{ detail.parentJobId || '—' }}</div>
      <div>traceId: {{ detail.traceId || '—' }}</div>
      <div>partition: P{{ detail.partitionId }}</div>
      <div>status: {{ jobStatusLabel(detail.status) }}</div>
      <div>workIP: {{ detail.workIP || '—' }}</div>
      <div>runtime: {{ detail.runtime ?? '—' }} ms</div>
      <div v-if="detailNgaSession" class="dim">nga session: {{ detailNgaSession }}</div>
      <div v-if="detailReportUrl" class="dim report-url"><a :href="detailReportUrl" target="_blank" rel="noopener">{{ detailReportUrl }}</a></div>
      <div v-if="detailReport" class="report md-body" v-html="detailReportHtml" />
      <pre v-else class="report">{{ $t('sched.report.empty') }}</pre>
      <div class="acts">
        <button v-if="detail.status === 4" @click="jobs.approve(detail.jobId)">{{ $t('jobs.action.approve') }}</button>
        <button v-if="detail.status === 4" @click="jobs.reject(detail.jobId)">{{ $t('jobs.action.reject') }}</button>
        <button v-if="detail.status === 0 || detail.status === 3" @click="jobs.cancel(detail.jobId)">{{ $t('jobs.action.cancel') }}</button>
        <button v-if="detail.status === 2" @click="jobs.retry(detail.jobId)">{{ $t('jobs.action.retry') }}</button>
      </div>
    </aside>
    <div v-if="configOpen" class="modal">
      <h3>{{ $t('jobs.config.title') }}</h3>
      <label>{{ $t('jobs.config.backend') }}: <b>{{ config.backend }}</b></label>
      <label>{{ $t('jobs.config.host') }} <input v-model="config.host" /></label>
      <label>{{ $t('jobs.config.port') }} <input type="number" v-model.number="config.port" /></label>
      <label>{{ $t('jobs.config.user') }} <input v-model="config.user" /></label>
      <label>{{ $t('jobs.config.database') }} <input v-model="config.database" /></label>
      <label>{{ $t('jobs.config.password') }} <input type="password" v-model="config.password" :placeholder="config.hasPassword ? '******' : ''" /></label>
      <label>{{ $t('jobs.config.partition_count') }} <input type="number" v-model.number="config.partitionCount" /></label>
      <button @click="savePartitions()">{{ $t('jobs.config.partition_count') }}</button>
      <button @click="saveConfig()">{{ $t('sched.save') }}</button>
      <button @click="configOpen = false">{{ $t('sched.cancel') }}</button>
    </div>
  </div>
</template>

<style scoped>
.jobs-view { width: 100%; height: 100%; overflow: auto; padding: 12px; box-sizing: border-box; }
.jobs-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.jobs-head .title { font-weight: 600; }
.jobs-head .dim { opacity: .6; font-size: 12px; }
.jobs-head input { width: 180px; }
.summary { display: flex; gap: 8px; margin: 12px 0; }
.sum-card { display: flex; flex-direction: column; min-width: 72px; padding: 8px 10px; border: 1px solid var(--border-color, #333); border-radius: 6px; }
.sum-card .num { font-size: 20px; font-weight: 600; }
.workers { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; font-size: 12px; opacity: .8; }
.worker.off { opacity: .45; }
.job-list { display: flex; flex-direction: column; border: 1px solid var(--border-color, #333); border-radius: 6px; overflow: hidden; }
.job-row { display: grid; grid-template-columns: 64px minmax(120px, 1.4fr) 44px minmax(100px, 1fr) 170px 90px minmax(120px, 1.2fr); gap: 8px; align-items: center; padding: 6px 8px; font-size: 12px; cursor: pointer; border-bottom: 1px solid var(--border-color, #333); }
.job-row:last-child { border-bottom: none; }
.job-row:hover { background: var(--hover-bg, rgba(128,128,128,.12)); }
.job-row .st { font-size: 11px; font-weight: 600; }
.job-row .name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job-row .tag { opacity: .75; }
.job-row .ip, .job-row .time, .job-row .runtime { opacity: .7; }
.job-row .jid { opacity: .5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { padding: 12px; text-align: center; opacity: .6; font-size: 12px; margin: 0; }
.st.ok { color: #2ea043; } .st.bad { color: #f85149; } .st.run { color: #58a6ff; } .st.wait { color: #d29922; } .st.queue { opacity: .75; }
.job-drawer { position: fixed; right: 0; top: 0; bottom: 0; width: 360px; overflow: auto; padding: 14px; background: var(--panel-bg, #1e1e1e); border-left: 1px solid var(--border-color, #333); z-index: 20; }
.job-drawer .close { float: right; }
.job-drawer .report { white-space: pre-wrap; word-break: break-word; font-size: 12px; max-height: 50vh; overflow: auto; }
.job-drawer .acts { display: flex; gap: 6px; margin-top: 10px; }
.modal { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; gap: 8px; width: 320px; padding: 16px; background: var(--panel-bg, #1e1e1e); border: 1px solid var(--border-color, #333); border-radius: 8px; z-index: 30; }
.modal label { display: flex; justify-content: space-between; gap: 8px; }
</style>
