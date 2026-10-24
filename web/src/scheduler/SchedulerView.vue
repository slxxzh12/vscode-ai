<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useScheduler, type TaskView } from './useScheduler';
import SchedulerReportView from './SchedulerReportView.vue';
import JobsView from '../jobs/JobsView.vue';
import NgaProcessTerminal from './NgaProcessTerminal.vue';
import { formatNgaEvents } from './ngaProcess';
import { pendingSchedulerPrompt, clearSchedulerPrompt } from './schedulerIntent';
import { scheduleSummary, formatTime, runStatusLabel, recentJobsOf, typeLabel } from './format';
import { t } from '../i18n';
import CodeEditor from '../components/CodeEditor.vue';
import { renderRemoteMarkdown } from '../markdown';

const props = defineProps<{ terminal: any; onOpenSession?: (sessionId: string) => void; projectRoot?: string; projectId?: string | null }>();
const sched = useScheduler(props.terminal);
const { state } = sched;

const showEditor = ref(false);
const editingId = ref<string | null>(null);
const pickedPath = ref('');
const form = ref<any>(emptyForm());
const detailTask = ref<TaskView | null>(null);
const mainTab = ref<'tasks' | 'jobs'>('tasks');
const taskFilter = ref<'all' | 'once' | 'recurring'>('all');
const filteredTasks = computed(() => state.tasks.filter((t) => {
  if (taskFilter.value === 'once') return !!t.once;
  if (taskFilter.value === 'recurring') return !t.once;
  return true;
}));

function emptyForm() {
  return {
    name: '', enabled: true, once: false, cwd: '', filePath: '', type: 'ai', command: '',
    ai: { source: 'prompt', commandName: '', prompt: '' },
    schedule: { mode: 'interval', interval: { every: 30, unit: 'minute' }, daily: { at: '09:30', weekdays: [] } },
    approvalRequired: false, onlyLocal: false, uniqueKey: '', weight: 0, maxRunMilliSecond: 0, groupName: 'default',
  };
}
function taskIcon(t: TaskView): string {
  if (t.type === 'shell') return '⌨';
  if (t.type === 'ai') return t.ai?.source === 'file' ? '📄' : '🤖';
  return '•';
}
function openCreate() {
  editingId.value = null;
  pickedPath.value = '';
  form.value = emptyForm();
  showEditor.value = true;
}
function openEdit(task: TaskView) {
  editingId.value = task.id;
  pickedPath.value = task.filePath || '';
  form.value = JSON.parse(JSON.stringify({
    name: task.name, enabled: task.enabled, once: !!task.once, cwd: task.cwd || '', filePath: task.filePath || '', type: task.type,
    command: task.command || '', ai: task.ai || { source: 'command', commandName: '', prompt: '' }, schedule: task.schedule,
    approvalRequired: !!task.approvalRequired, onlyLocal: !!task.onlyLocal, uniqueKey: task.uniqueKey || '',
    weight: task.weight || 0, maxRunMilliSecond: task.maxRunMilliSecond || 0, groupName: task.groupName || 'default',
  }));
  showEditor.value = true;
}
function extOf(p: string): string { const i = p.lastIndexOf('.'); return i >= 0 ? p.slice(i).toLowerCase() : ''; }
function dirOf(p: string): string { const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i > 0 ? p.slice(0, i) : p; }
async function pickCommandFile() {
  state.error = '';
  try {
    const r = await sched.pickFile();
    if (r.error) { state.error = r.error === 'unsupported' ? t('sched.pick_unsupported') : t('sched.pick_failed', { msg: r.message || r.error }); return; }
    if (r.cancelled || !r.path) return;
    pickedPath.value = r.path;
    form.value.filePath = r.path;
    const ext = extOf(r.path);
    form.value.cwd = dirOf(r.path);
    if (ext === '.md') {
      const base = r.path.replace(/\\/g, '/').split('/').pop() || '';
      const isCommand = state.aiCommands.some((c) => c.name === base);
      form.value.type = 'ai';
      form.value.ai = isCommand
        ? { source: 'command', commandName: base, prompt: '' }
        : { source: 'prompt', commandName: '', prompt: (r.content || '').trim() || t('sched.ai.file_prompt') };
    } else {
      state.error = t('sched.unsupported_file', { ext: ext || '?' });
    }
  } catch (e: any) { state.error = String(e?.message || e); }
}
const showImport = ref(false);
const importDir = ref('');
const importMsg = ref('');
async function browseImportDir() {
  state.error = '';
  try {
    const r = await sched.pickFolder();
    if (r.error) { state.error = r.error === 'unsupported' ? t('sched.import.unsupported') : t('sched.import.pick_failed', { msg: r.message || r.error }); return; }
    if (r.cancelled || !r.path) return;
    importDir.value = r.path;
  } catch (e: any) { state.error = String(e?.message || e); }
}
async function doImport() {
  state.error = '';
  importMsg.value = '';
  const dir = importDir.value.trim();
  if (!dir) { state.error = t('sched.import.bad_dir'); return; }
  try {
    const r = await sched.importManifests(dir);
    importMsg.value = t('sched.import.result', { imported: r.imported || 0, overwritten: r.overwritten || 0, failed: (r.failed || []).length });
    showImport.value = false;
  } catch (e: any) { state.error = String(e?.message || e); }
}
async function save() {
  const body = JSON.parse(JSON.stringify(form.value));
  if (!body.cwd) body.cwd = null;
  if (!body.filePath) body.filePath = null;
  if (body.type !== 'shell') delete body.command;
  if (body.type !== 'ai') delete body.ai;
  if (body.uniqueKey === '') body.uniqueKey = null;
  if (!body.maxRunMilliSecond) body.maxRunMilliSecond = null;
  if (body.once) body.enabled = false;
  else body.once = false;
  try {
    if (editingId.value) await sched.updateTask(editingId.value, body);
    else await sched.createTask(body);
    showEditor.value = false;
  } catch (e: any) { state.error = String(e?.message || e); }
}
async function remove(task: TaskView) {
  if (!confirm(t('sched.remove_confirm', { name: task.name }))) return;
  await sched.removeTask(task.id);
  if (detailTask.value?.id === task.id) detailTask.value = null;
}
function exportTask(task: TaskView) {
  const data: any = {
    format: 'void_manifest',
    version: 1,
    name: task.name,
    type: task.type,
    enabled: task.enabled,
    once: !!task.once,
    schedule: task.schedule,
  };
  if (task.type === 'shell') data.command = task.command;
  if (task.type === 'ai') {
    data.ai = { ...(task.ai || {}) };
    if (task.filePath) data.filePath = task.filePath;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${task.name || task.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function downloadJson(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function exportAllTasks() {
  state.error = '';
  try {
    const res = await fetch('/api/scheduler/tasks/export');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    downloadJson(`scheduled-tasks-${new Date().toISOString().slice(0, 10)}.json`, text);
  } catch (e: any) { state.error = String(e?.message || e); }
}
const importAllInput = ref<HTMLInputElement | null>(null);
function pickImportAll() {
  importAllInput.value?.click();
}
async function onImportAllFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  state.error = '';
  let tasks: any[] = [];
  try {
    const data = JSON.parse(await file.text());
    tasks = Array.isArray(data) ? data : data?.tasks;
    if (!Array.isArray(tasks)) throw new Error('bad-file');
  } catch {
    state.error = t('sched.import_all.bad_file');
    return;
  }
  try {
    const res = await fetch('/api/scheduler/tasks/import-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.message || r.error || `HTTP ${res.status}`);
    await sched.refresh();
    alert(t('sched.import_all.result', { imported: r.imported || 0, updated: r.updated || 0, failed: (r.failed || []).length }));
  } catch (e: any) { state.error = String(e?.message || e); }
}
async function runNow(task: TaskView) {
  runPending.value[task.id] = true;
  try { await sched.runNow(task.id); await sched.refresh(); }
  catch (e: any) { state.error = String(e?.message || e); }
  finally { delete runPending.value[task.id]; }
}
const runPending = ref<Record<string, boolean>>({});
function isRunning(task: TaskView) { return !!runPending.value[task.id] || !!task.recentJobs?.some((j) => j.status === 3); }
async function stop(task: TaskView) { await sched.stopTask(task.id); await sched.refresh(); }
async function toggle(task: TaskView) {
  const enabled = !task.enabled;
  await sched.updateTask(task.id, { enabled, ...(enabled && task.once ? { once: false, deleteAfter: null } : {}) });
}
function openDetail(task: TaskView) { detailTask.value = task; }
const WEEKDAYS = computed(() => [1, 2, 3, 4, 5, 6, 7].map((v) => ({ v, t: t('sched.wdshort.' + v) })));
function toggleWeekday(v: number) {
  const arr: number[] = form.value.schedule.daily.weekdays;
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1); else arr.push(v);
}
// 近 N 次执行结果（左→右 时间递增）
const RECENT_N = 10;
function lastJobs(task: TaskView) { return recentJobsOf(task.recentJobs, RECENT_N); }
function barClass(status: number): string {
  if (status === 1) return 'success';
  if (status === 2) return 'failed';
  if (status === 3) return 'running';
  if (status === 4) return 'wait';
  return 'killed';
}

// —— 聊天式新建 AI 任务 ——
const chatOpen = ref(false);
const chatMessages = ref<{ role: 'user' | 'assistant'; text: string; status?: number }[]>([]);
const chatInput = ref('');
const chatBusy = ref(false);
const chatTaskId = ref<string | null>(null);
const chatPrompt = ref('');
const chatJobId = ref('');
const chatStatus = ref<number | null>(null);
const chatLog = ref('');
const chatReport = ref('');
const chatResultData = ref<any>({});
const chatTab = ref<'process' | 'result'>('process');
const chatBodyRef = ref<HTMLDivElement | null>(null);
const chatScheduleMode = ref<'once' | 'interval' | 'daily'>('once');
const chatEvery = ref(1);
const chatUnit = ref<'minute' | 'hour' | 'day'>('hour');
const chatAt = ref('09:30');
const chatFile = ref<{ path: string; name: string } | null>(null);
const chatLeftW = ref((() => {
  try {
    const n = Number(localStorage.getItem('devflow-sched-chat-left'));
    return n >= 28 && n <= 72 ? n : 44;
  } catch { return 44; }
})());
let chatResizing = ref(false);

function onChatResizeDown(e: MouseEvent) {
  e.preventDefault();
  chatResizing.value = true;
  const move = (ev: MouseEvent) => {
    const el = chatBodyRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((ev.clientX - rect.left) / rect.width) * 100;
    chatLeftW.value = Math.min(72, Math.max(28, pct));
  };
  const up = () => {
    chatResizing.value = false;
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    try { localStorage.setItem('devflow-sched-chat-left', String(Math.round(chatLeftW.value))); } catch { /* ignore */ }
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}
function resetChatWidth() {
  chatLeftW.value = 44;
  try { localStorage.setItem('devflow-sched-chat-left', '44'); } catch { /* ignore */ }
}
let chatTimer: ReturnType<typeof setInterval> | null = null;

const chatReportHtml = computed(() => (chatReport.value ? renderRemoteMarkdown(chatReport.value) : ''));
const chatStatusLabel = computed(() => (chatStatus.value == null ? '' : runStatusLabel(chatStatus.value)));
const chatProcess = computed(() => formatNgaEvents(chatLog.value));
const DEFAULT_SCHEDULE = { mode: 'interval' as const, interval: { every: 1, unit: 'day' as const }, daily: { at: '09:30', weekdays: [] as number[] } };

function chatScheduleBody() {
  if (chatScheduleMode.value === 'daily') {
    return {
      enabled: true,
      once: false,
      schedule: {
        mode: 'daily' as const,
        interval: { every: 1, unit: 'day' as const },
        daily: { at: chatAt.value || '09:30', weekdays: [] as number[] },
      },
    };
  }
  if (chatScheduleMode.value === 'interval') {
    return {
      enabled: true,
      once: false,
      schedule: {
        mode: 'interval' as const,
        interval: { every: Math.max(1, Number(chatEvery.value) || 1), unit: chatUnit.value },
        daily: { at: '09:30', weekdays: [] as number[] },
      },
    };
  }
  return { enabled: false, once: true, schedule: DEFAULT_SCHEDULE };
}

function resetChat() {
  stopChatTimer();
  chatMessages.value = [];
  chatInput.value = '';
  chatBusy.value = false;
  chatTaskId.value = null;
  chatPrompt.value = '';
  chatJobId.value = '';
  chatStatus.value = null;
  chatLog.value = '';
  chatReport.value = '';
  chatResultData.value = {};
  chatTab.value = 'process';
  chatScheduleMode.value = 'once';
  chatEvery.value = 1;
  chatUnit.value = 'hour';
  chatAt.value = '09:30';
  chatFile.value = null;
}
function openChatCreate() {
  resetChat();
  chatOpen.value = true;
}
async function pickChatFile() {
  state.error = '';
  try {
    const r = await sched.pickFile();
    if (r.error) { state.error = r.error === 'unsupported' ? t('sched.pick_unsupported') : t('sched.pick_failed', { msg: r.message || r.error }); return; }
    if (r.cancelled || !r.path) return;
    const name = r.path.replace(/\\/g, '/').split('/').pop() || r.path;
    chatFile.value = { path: r.path, name };
    const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const content = ext === '.md' && r.content ? String(r.content).trim() : '';
    chatInput.value = content || t('sched.chat.file_prompt', { path: r.path });
  } catch (e: any) { state.error = String(e?.message || e); }
}
function clearChatFile() {
  chatFile.value = null;
}
function closeChat() {
  chatOpen.value = false;
  stopChatTimer();
}
function onChatKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && chatOpen.value) closeChat();
}
function autoTaskName(text: string) {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return t('sched.chat.default_name', { time: formatTime(Date.now()) });
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}
function setLastAssistant(text: string, status?: number) {
  const last = chatMessages.value[chatMessages.value.length - 1];
  if (last && last.role === 'assistant') { last.text = text; last.status = status; }
}
async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || chatBusy.value) return;
  chatInput.value = '';
  chatMessages.value.push({ role: 'user', text });
  chatBusy.value = true;
  chatStatus.value = null;
  chatLog.value = '';
  chatReport.value = '';
  chatResultData.value = {};
  chatTab.value = 'process';
  try {
    let taskId = chatTaskId.value;
    if (!taskId) {
      const base = {
        name: autoTaskName(text),
        projectId: props.projectId || null,
        type: 'ai',
        ai: { source: 'prompt', prompt: text },
        ...(chatFile.value ? { filePath: chatFile.value.path } : {}),
        ...chatScheduleBody(),
      };
      let created;
      try {
        created = await sched.createTask({ ...base, cwd: props.projectId ? null : (props.projectRoot || null) });
      } catch (e: any) {
        if (!String(e?.message || e).includes('dir-taken')) throw e;
        created = await sched.createTask({ ...base, cwd: null });
      }
      taskId = created.id;
      chatTaskId.value = taskId;
      chatPrompt.value = text;
      chatMessages.value.push({ role: 'assistant', text: t('sched.chat.created'), status: 0 });
    } else {
      const task = state.tasks.find((x) => x.id === taskId);
      const base = task?.ai?.prompt || chatPrompt.value;
      const nextPrompt = `${base}\n\n---\n\n${text}`;
      await sched.updateTask(taskId, { ai: { ...(task?.ai || { source: 'prompt' }), prompt: nextPrompt }, ...(chatFile.value ? { filePath: chatFile.value.path } : {}), ...chatScheduleBody() });
      chatPrompt.value = nextPrompt;
      chatMessages.value.push({ role: 'assistant', text: t('sched.chat.appended'), status: 0 });
    }
    if (!taskId) throw new Error('task-create-failed');
    const r = await sched.runNow(taskId);
    chatJobId.value = r?.job?.jobId || '';
    startChatTimer();
  } catch (e: any) {
    chatBusy.value = false;
    chatMessages.value.push({ role: 'assistant', text: t('sched.chat.failed', { msg: String(e?.message || e) }), status: 2 });
  }
}
function startChatTimer() {
  stopChatTimer();
  void pollChat();
  chatTimer = setInterval(() => { void pollChat(); }, 1200);
}
function stopChatTimer() {
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
}
async function pollChat() {
  if (!chatTaskId.value || !chatJobId.value) return;
  try {
    const jobs = await sched.loadJobs(chatTaskId.value, 10);
    const job = jobs.find((j) => j.jobId === chatJobId.value) || jobs[0];
    if (!job) return;
    chatStatus.value = job.status;
    chatLog.value = await sched.loadJobLog(job.jobId);
    if (job.status !== 1 && job.status !== 2) return;
    let result: any = {};
    try { result = job.result ? JSON.parse(job.result) : {}; } catch { result = {}; }
    chatReport.value = String(result.reportMarkdown || '');
    chatResultData.value = result;
    chatBusy.value = false;
    stopChatTimer();
    if (job.status === 1) {
      setLastAssistant(t('sched.chat.done'), 1);
      chatTab.value = 'result';
    } else {
      setLastAssistant(t('sched.chat.failed', { msg: result.error || runStatusLabel(job.status) }), 2);
    }
  } catch { /* keep polling */ }
}

onMounted(async () => {
  window.addEventListener('keydown', onChatKey);
  const intent = pendingSchedulerPrompt.value;
  if (intent) {
    clearSchedulerPrompt();
    openChatCreate();
    chatInput.value = intent.prompt;
    if (intent.run) void sendChat();
  }
  await sched.refresh();
  sched.loadAiCommands();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onChatKey);
  stopChatTimer();
  sched.dispose();
});
</script>

<template>
  <div class="sched">
    <template v-if="!detailTask">
    <header class="bar">
      <span class="title">{{ $t('sched.title') }}</span>
      <span v-if="state.error" class="err">{{ state.error }}</span>
      <div class="spacer" />
      <select v-model="taskFilter" class="task-filter" :title="$t('sched.filter.label')">
        <option value="all">{{ $t('sched.filter.all') }}</option>
        <option value="once">{{ $t('sched.filter.once') }}</option>
        <option value="recurring">{{ $t('sched.filter.recurring') }}</option>
      </select>
      <button @click="sched.refresh()">{{ $t('sched.refresh') }}</button>
      <button class="primary" @click="openCreate">{{ $t('sched.create') }}</button>
      <button @click="showImport = true">{{ $t('sched.import') }}</button>
      <button @click="exportAllTasks">{{ $t('sched.export_all') }}</button>
      <button @click="pickImportAll">{{ $t('sched.import_all') }}</button>
      <input ref="importAllInput" class="hidden-file" type="file" accept="application/json,.json" @change="onImportAllFile" />
    </header>

    <div class="main-tabs">
      <button :class="{ on: mainTab === 'tasks' }" @click="mainTab = 'tasks'">{{ $t('sched.tab.tasks') }}</button>
      <button :class="{ on: mainTab === 'jobs' }" @click="mainTab = 'jobs'">{{ $t('sched.tab.jobs') }}</button>
    </div>

    <div v-if="mainTab === 'tasks'" class="body">
      <div class="summary">
        <div class="sum-card sum-success"><span class="num">{{ sched.state.summary.success }}</span><span>{{ $t('sched.summary.success') }}</span></div>
        <div class="sum-card sum-failed"><span class="num">{{ sched.state.summary.failed }}</span><span>{{ $t('sched.summary.failed') }}</span></div>
        <div class="sum-card sum-running"><span class="num">{{ sched.state.summary.running }}</span><span>{{ $t('sched.summary.running') }}</span></div>
        <div class="sum-card sum-queued"><span class="num">{{ sched.state.summary.queued }}</span><span>{{ $t('jobs.summary.queued') }}</span></div>
        <div class="sum-card sum-pending"><span class="num">{{ sched.state.summary.pending }}</span><span>{{ $t('jobs.summary.pending') }}</span></div>
        <div class="sum-card sum-total"><span class="num">{{ sched.state.summary.total }}</span><span>{{ $t('sched.summary.total') }}</span></div>
      </div>
      <div class="list">
        <button class="new-task-entry" @click="openChatCreate">
          <span class="plus">＋</span>
          <span class="nt-main">{{ $t('sched.chat.new') }}</span>
          <span class="nt-hint">{{ $t('sched.chat.hint') }}</span>
        </button>
        <div v-if="filteredTasks.length" class="listhead">
          <span class="lh-main">{{ $t('sched.col.name') }}</span>
          <span class="lh-status">{{ $t('sched.col.status') }}</span>
          <span class="lh-hist">{{ $t('sched.recent_n', { n: RECENT_N }) }}</span>
          <span class="lh-acts">{{ $t('sched.col.actions') }}</span>
        </div>
        <div v-if="!state.tasks.length" class="blank">
          <div class="blank-icon">📅</div>
          <div class="blank-title">{{ $t('sched.empty.title') }}</div>
          <div class="blank-hint">{{ $t('sched.empty.hint') }}</div>
          <button @click.stop="openCreate">{{ $t('sched.empty.create') }}</button>
        </div>
        <div v-else-if="!filteredTasks.length" class="empty">{{ $t('sched.filter.empty') }}</div>
        <div v-for="t in filteredTasks" :key="t.id" class="row" @click="openDetail(t)">
          <div class="rowmain">
            <div class="name">
              <span class="badge" :class="t.type"><span class="bi">{{ taskIcon(t) }}</span>{{ typeLabel(t.type) }}</span>
              <span v-if="t.once" class="badge once">{{ $t('sched.once_badge') }}</span>
              {{ t.name }}
              <span class="dim">{{ scheduleSummary(t.schedule) }}</span>
            </div>
            <div class="meta">
              <span class="nextline">⏱ {{ $t('sched.next', { time: formatTime(t.nextRunAt) }) }}</span>
              <span v-if="t.filePath" class="dim path" :title="t.filePath">📄 {{ t.filePath }}</span>
            </div>
          </div>
          <div class="statuscol">
            <span v-if="isRunning(t)" class="spinner" />
            <span class="st-dot" :class="t.enabled ? 'on' : 'paused'" />
            <span class="st" :class="t.enabled ? 'on' : 'paused'">{{ t.enabled ? $t('sched.status.running') : $t('sched.status.paused') }}</span>
          </div>
          <div class="histcol" :title="$t('sched.recent_runs')">
            <span v-for="j in lastJobs(t)" :key="j.jobId" class="vbar" :class="barClass(j.status)" :title="`${runStatusLabel(j.status)} · ${formatTime(j.createTime)}`" />
          </div>
          <div class="acts">
            <button v-if="t.enabled" @click.stop="toggle(t)">{{ $t('sched.pause') }}</button>
            <button v-else @click.stop="toggle(t)">{{ $t('sched.start') }}</button>
            <button v-if="!isRunning(t)" @click.stop="runNow(t)">{{ $t('sched.run') }}</button>
            <button v-else @click.stop="stop(t)">{{ $t('sched.stop') }}</button>
            <button @click.stop="openDetail(t)">{{ $t('sched.history') }}</button>
            <button @click.stop="openEdit(t)">{{ $t('sched.edit') }}</button>
            <button @click.stop="exportTask(t)">{{ $t('sched.export') }}</button>
            <button @click.stop="remove(t)">{{ $t('sched.delete') }}</button>
          </div>
        </div>
      </div>
    </div>
    <JobsView v-else />
    </template>

    <SchedulerReportView
      v-else-if="detailTask"
      :task="detailTask"
      :load-jobs="sched.loadJobs"
      :on-back="() => (detailTask = null)"
      :on-open-session="props.onOpenSession"
    />

    <div v-if="showEditor" class="overlay">
      <div class="modal">
        <h3>{{ editingId ? $t('sched.edit_task') : $t('sched.new_task') }}</h3>
        <label>{{ $t('sched.field.name') }} <input v-model="form.name" /></label>
        <button class="pickfile" @click="pickCommandFile">{{ $t('sched.pick_file') }}</button>
        <label v-if="pickedPath" class="inline">{{ $t('sched.field.file') }}
          <input class="fileinp" :value="pickedPath" readonly :title="pickedPath" />
        </label>
        <label>{{ $t('sched.field.cwd') }} <input v-model="form.cwd" :placeholder="$t('sched.field.cwd_placeholder')" /></label>
        <label>{{ $t('sched.field.type') }}
          <select v-model="form.type">
            <option value="shell">{{ $t('sched.type.shell') }}</option>
            <option value="ai">{{ $t('sched.type.ai') }}</option>
          </select>
        </label>
        <label class="inline"><input type="checkbox" v-model="form.once" /> {{ $t('sched.field.once') }}</label>
        <template v-if="form.type === 'shell'">
          <label>{{ $t('sched.field.command') }} <CodeEditor v-model="form.command" class="sched-edit" language="cmd.sh" /></label>
          <div class="dim shell-hint">{{ $t('sched.shell.ai_hint') }}</div>
        </template>
        <template v-else-if="form.type === 'ai'">
          <label>{{ $t('sched.field.source') }}
            <select v-model="form.ai.source">
              <option value="command">{{ $t('sched.source.command') }}</option>
              <option value="prompt">{{ $t('sched.source.prompt') }}</option>
              <option value="file">{{ $t('sched.source.file') }}</option>
            </select>
          </label>
          <label v-if="form.ai.source === 'command'">{{ $t('sched.field.ai_command') }}
            <input v-model="form.ai.commandName" list="sched-ai-commands" :placeholder="$t('sched.field.ai_command_ph')" />
            <datalist id="sched-ai-commands">
              <option v-for="c in state.aiCommands" :key="c.name" :value="c.name" />
            </datalist>
          </label>
          <label v-else-if="form.ai.source === 'prompt'">Prompt <CodeEditor v-model="form.ai.prompt" class="sched-edit" /></label>
          <div v-else class="dim">{{ $t('sched.source.file_hint') }}</div>
        </template>
        <label>{{ $t('sched.field.mode') }}
          <select v-model="form.schedule.mode">
            <option value="interval">{{ $t('sched.mode.interval') }}</option>
            <option value="daily">{{ $t('sched.mode.daily') }}</option>
          </select>
        </label>
        <template v-if="form.schedule.mode === 'interval'">
          <label class="inline">{{ $t('sched.field.every') }}
            <input type="number" min="1" v-model.number="form.schedule.interval.every" class="num" />
            <select v-model="form.schedule.interval.unit" class="unit">
              <option value="second">{{ $t('sched.unit.second') }}</option>
              <option value="minute">{{ $t('sched.unit.minute') }}</option>
              <option value="hour">{{ $t('sched.unit.hour') }}</option>
              <option value="day">{{ $t('sched.unit.day') }}</option>
            </select>
          </label>
        </template>
        <template v-else>
          <label class="inline">{{ $t('sched.field.at') }}
            <input type="time" v-model="form.schedule.daily.at" class="time" />
          </label>
          <div class="wd">
            {{ $t('sched.field.weekdays') }}
            <label v-for="w in WEEKDAYS" :key="w.v" class="wditem">
              <input type="checkbox" :checked="form.schedule.daily.weekdays.includes(w.v)" @change="toggleWeekday(w.v)" />{{ w.t }}
            </label>
          </div>
        </template>

        <label class="inline"><input type="checkbox" v-model="form.approvalRequired" /> {{ $t('sched.field.approval_required') }}</label>
        <label class="inline"><input type="checkbox" v-model="form.onlyLocal" /> {{ $t('sched.field.only_local') }}</label>
        <label class="inline">{{ $t('sched.field.unique_key') }} <input v-model="form.uniqueKey" /></label>
        <label class="inline">{{ $t('sched.field.weight') }} <input type="number" v-model.number="form.weight" class="num" /></label>
        <label class="inline">{{ $t('sched.field.max_run_ms') }} <input type="number" v-model.number="form.maxRunMilliSecond" class="num" /></label>

        <div class="modalacts">
          <button @click="showEditor = false">{{ $t('sched.cancel') }}</button>
          <button class="primary" @click="save">{{ $t('sched.save') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showImport" class="overlay" @click.self="showImport = false">
      <div class="modal">
        <h3>{{ $t('sched.import.title') }}</h3>
        <label>{{ $t('sched.import.dir') }}
          <input v-model="importDir" :placeholder="$t('sched.import.dir_placeholder')" />
        </label>
        <button class="pickfile" @click="browseImportDir">{{ $t('sched.import.browse') }}</button>
        <div v-if="importMsg" class="dim">{{ importMsg }}</div>
        <div class="modalacts">
          <button @click="showImport = false">{{ $t('sched.cancel') }}</button>
          <button class="primary" @click="doImport">{{ $t('sched.import.run') }}</button>
        </div>
      </div>
    </div>

    <div v-if="chatOpen" class="chat-overlay">
      <div class="chat-page">
        <header class="chat-head">
          <button class="chat-back" @click="closeChat">← {{ $t('sched.chat.back') }}</button>
          <span class="chat-title">{{ $t('sched.chat.title') }}</span>
          <span v-if="chatTaskId" class="dim">{{ $t('sched.chat.saved_hint') }}</span>
          <div class="spacer" />
          <span v-if="chatStatusLabel" class="chat-status" :class="'s' + chatStatus">{{ chatStatusLabel }}</span>
          <button @click="closeChat">{{ $t('sched.chat.close') }}</button>
        </header>
        <div ref="chatBodyRef" class="chat-body" :class="{ resizing: chatResizing }">
          <section class="chat-left" :style="{ width: chatLeftW + '%' }">
            <div class="chat-schedule">
              <span class="cs-label">{{ $t('sched.chat.schedule') }}</span>
              <select v-model="chatScheduleMode">
                <option value="once">{{ $t('sched.chat.once') }}</option>
                <option value="interval">{{ $t('sched.mode.interval') }}</option>
                <option value="daily">{{ $t('sched.mode.daily') }}</option>
              </select>
              <template v-if="chatScheduleMode === 'interval'">
                <span>{{ $t('sched.field.every') }}</span>
                <input v-model.number="chatEvery" class="cs-num" type="number" min="1" />
                <select v-model="chatUnit">
                  <option value="minute">{{ $t('sched.unit.minute') }}</option>
                  <option value="hour">{{ $t('sched.unit.hour') }}</option>
                  <option value="day">{{ $t('sched.unit.day') }}</option>
                </select>
              </template>
              <template v-else-if="chatScheduleMode === 'daily'">
                <span>{{ $t('sched.field.at') }}</span>
                <input v-model="chatAt" class="cs-time" type="time" />
              </template>
            </div>
            <div class="chat-messages">
              <div v-for="(m, i) in chatMessages" :key="i" class="chat-msg" :class="m.role">
                <div class="bubble">{{ m.text }}</div>
              </div>
              <div v-if="!chatMessages.length" class="chat-empty">{{ $t('sched.chat.empty_chat') }}</div>
            </div>
            <div class="chat-filebar">
              <button class="chat-pick" @click="pickChatFile">{{ $t('sched.pick_file') }}</button>
              <span v-if="chatFile" class="chat-filechip" :title="chatFile.path">
                {{ chatFile.name }}
                <button @click="clearChatFile">×</button>
              </span>
            </div>
            <div class="chat-input">
              <textarea v-model="chatInput" :placeholder="$t('sched.chat.input_ph')" @keydown.enter.exact.prevent="sendChat" />
              <button class="primary" :disabled="chatBusy || !chatInput.trim()" @click="sendChat">
                {{ chatBusy ? $t('sched.chat.running') : $t('sched.chat.send') }}
              </button>
            </div>
          </section>
          <div class="chat-divider" @mousedown.prevent="onChatResizeDown" @dblclick="resetChatWidth" />
          <section class="chat-right">
            <div class="chat-tabs">
              <button :class="{ on: chatTab === 'process' }" @click="chatTab = 'process'">{{ $t('sched.chat.process') }}</button>
              <button :class="{ on: chatTab === 'result' }" @click="chatTab = 'result'">{{ $t('sched.chat.result') }}</button>
            </div>
            <NgaProcessTerminal v-if="chatTab === 'process' && chatProcess" :text="chatProcess" />
            <div v-else-if="chatTab === 'process'" class="chat-empty">{{ $t('sched.chat.empty_process') }}</div>
            <template v-else>
              <div v-if="chatStatus != null" class="chat-result-state" :class="chatStatus === 1 ? 'ok' : chatStatus === 2 ? 'bad' : 'run'">
                {{ chatStatus === 1 ? $t('sched.chat.success') : chatStatus === 2 ? $t('sched.chat.failure') : chatStatusLabel }}
              </div>
              <div v-if="chatResultData.reportUrl" class="chat-report-link">
                <a :href="chatResultData.reportUrl" target="_blank" rel="noopener">{{ chatResultData.reportUrl }}</a>
              </div>
              <div v-if="chatReport" class="chat-report md-body" v-html="chatReportHtml" />
              <div v-else class="chat-empty">{{ $t('sched.chat.empty_result') }}</div>
            </template>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sched { display: flex; flex-direction: column; height: 100%; background: var(--bg0, var(--bg1)); }
.bar { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-bottom: 1px solid var(--bd); }
.bar .title { font-weight: 700; color: var(--tx1); }
.bar .spacer { flex: 1; }
.bar .err { color: var(--warn, #e5534b); font-size: 12px; }
.bar .task-filter { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 6px; font-size: 12px; }
.hidden-file { display: none; }
.bar button, .modalacts button { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.bar button.primary, .modalacts button.primary { background: var(--ac3, var(--ac2)); border-color: var(--ac3, var(--ac2)); color: #fff; }
.body { flex: 1; overflow: auto; padding: 8px 12px; }
.main-tabs { display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid var(--bd); }
.main-tabs button { background: var(--bg5, var(--bg4)); color: var(--tx2); border: 1px solid var(--bd); border-bottom: none; border-radius: 5px 5px 0 0; padding: 5px 14px; cursor: pointer; font-size: 12px; }
.main-tabs button.on { background: var(--bg1); color: var(--tx1); }
.summary { display: flex; gap: 8px; margin-bottom: 10px; }
.sum-card { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg1); color: var(--tx5); font-size: 12px; }
.sum-card .num { font-size: 22px; font-weight: 700; color: var(--tx1); }
.sum-success .num { color: #3fb950; }
.sum-failed .num { color: #e5534b; }
.sum-running .num { color: var(--ac2); }
.empty { color: var(--tx5); padding: 24px; text-align: center; }
.blank {
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px 16px;
  border: 1px dashed var(--bd);
  border-radius: 10px;
  background:
    radial-gradient(circle at 50% 0%, rgba(88, 166, 255, .10), transparent 60%),
    var(--bg1);
}
.blank-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--bg5, var(--bg4));
  font-size: 22px;
}
.blank-title { color: var(--tx1); font-weight: 600; }
.blank-hint { color: var(--tx5); font-size: 12px; max-width: 420px; text-align: center; line-height: 1.6; }
.blank button {
  margin-top: 4px;
  background: var(--ac2);
  border: 1px solid var(--ac2);
  color: #fff;
  border-radius: 4px;
  padding: 5px 14px;
  cursor: pointer;
}
.row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--bd); border-radius: 6px; margin-bottom: 6px; background: var(--bg1); cursor: pointer; }
.rowmain { flex: 1; min-width: 0; }
.name { color: var(--tx1); display: flex; align-items: center; gap: 8px; }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 3px; background: var(--bg5, var(--bg4)); color: var(--tx2); }
.badge.ai { background: var(--ac2); color: #fff; }
.badge.script { background: var(--warn, #b58900); color: #000; }
.badge.once { background: var(--ac2); color: #fff; }
.badge .bi { margin-right: 4px; }
.runsess { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.runsess button { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
.meta { color: var(--tx4); font-size: 12px; margin-top: 2px; display: flex; gap: 12px; align-items: center; }
.nextline { color: var(--tx3); font-size: 12px; }
.path { font-family: ui-monospace, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 420px; }
.dim { color: var(--tx5); font-size: 12px; }
.listhead { display: flex; align-items: center; gap: 8px; padding: 2px 10px 6px; color: var(--tx5); font-size: 11px; }
.listhead .lh-main { flex: 1; }
.listhead .lh-status { width: 72px; text-align: center; }
.listhead .lh-hist { width: 148px; text-align: left; }
.listhead .lh-acts { width: 370px; text-align: right; }
.statuscol { display: flex; align-items: center; justify-content: center; gap: 4px; width: 72px; flex: none; }
.statuscol .st { font-size: 11px; color: var(--tx5); }
.statuscol .st.on { color: #3fb950; }
.statuscol .st.paused { color: #d29922; }
.st-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.st-dot.on { background: #3fb950; }
.st-dot.paused { background: #d29922; }
.histcol { display: flex; gap: 4px; align-items: center; justify-content: flex-start; width: 148px; flex: none; }
.vbar { width: 9px; height: 24px; border-radius: 3px; background: var(--tx5); }
.vbar.success { background: #3fb950; }
.vbar.failed { background: #e5534b; }
.vbar.running { background: var(--ac2); }
.vbar.killed { background: var(--tx5); }
.acts { display: flex; gap: 4px; align-items: center; flex: none; width: 370px; justify-content: flex-end; }
.acts button { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
.sw { color: var(--tx4); font-size: 12px; display: flex; align-items: center; gap: 3px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--tx5); margin-right: 4px; }
.dot.running { background: var(--ac2); }
.dot.success { background: #3fb950; }
.dot.failed, .dot.timeout { background: #e5534b; }
.dot.killed { background: var(--tx5); }
.running { display: inline-flex; align-items: center; gap: 4px; color: var(--ac2); font-size: 12px; }
.spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--tx5); border-top-color: var(--ac2); border-radius: 50%; animation: sched-spin .8s linear infinite; }
@keyframes sched-spin { to { transform: rotate(360deg); } }
.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 16px; width: 460px; max-height: 86vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.modal.wide { width: 720px; }
.modal h3 { margin: 0 0 6px; color: var(--tx1); }
.modal label { display: flex; flex-direction: column; gap: 3px; color: var(--tx3); font-size: 12px; }
.modal label.inline { flex-direction: row; align-items: center; gap: 6px; }
.modal input.num { width: 64px; flex: none; }
.modal select.unit { width: auto; flex: none; padding: 4px 6px; }
.modal input.time { width: auto; flex: none; }
.modal input.fileinp { flex: 1; min-width: 0; }
.modal input, .modal select, .modal textarea { background: var(--bg4, var(--bg5)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 6px; font-family: inherit; }
.sched-edit { --cm-min: 72px; }
.cmdpreview { background: var(--bg6, var(--bg1)); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 6px 8px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.wd { color: var(--tx3); font-size: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.wditem { display: inline-flex; flex-direction: row; align-items: center; gap: 2px; }
.pickfile { align-self: flex-start; background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.picked { color: var(--tx5); font-size: 11px; font-family: ui-monospace, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modalacts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.histwrap { display: flex; gap: 8px; min-height: 260px; }
.histlist { width: 220px; overflow: auto; border-right: 1px solid var(--bd); }
.histitem { padding: 5px 6px; cursor: pointer; border-radius: 4px; font-size: 12px; color: var(--tx2); }
.histitem.on { background: var(--bg5, var(--bg4)); }
.logview { flex: 1; margin: 0; overflow: auto; background: var(--bg6, var(--bg1)); color: var(--tx2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; padding: 8px; white-space: pre-wrap; }
.new-task-entry { display: flex; align-items: center; gap: 8px; width: 100%; margin-bottom: 8px; padding: 9px 12px; background: var(--bg1); color: var(--tx2); border: 1px dashed var(--bd); border-radius: 6px; cursor: pointer; text-align: left; font-family: inherit; }
.new-task-entry:hover { border-color: var(--ac2); color: var(--tx1); }
.new-task-entry .plus { color: var(--ac2); font-size: 16px; font-weight: 700; }
.new-task-entry .nt-main { color: var(--tx1); font-weight: 600; }
.new-task-entry .nt-hint { color: var(--tx5); font-size: 12px; }
.chat-overlay { position: fixed; inset: 0; z-index: 80; background: var(--bg0, var(--bg1)); display: flex; }
.chat-page { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.chat-head { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 14px; border-bottom: 1px solid var(--bd); }
.chat-head .spacer { flex: 1; }
.chat-header button, .chat-head button { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 12px; cursor: pointer; }
.chat-title { font-weight: 700; color: var(--tx1); }
.chat-back { background: none; border: none; color: var(--tx2); cursor: pointer; padding: 3px 4px; font-family: inherit; }
.chat-back:hover { color: var(--ac2); }
.chat-status { font-size: 12px; color: var(--tx5); }
.chat-status.s1 { color: #3fb950; }
.chat-status.s2 { color: #e5534b; }
.chat-status.s3, .chat-status.s0, .chat-status.s4 { color: var(--ac2); }
.chat-body { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.chat-body.resizing { user-select: none; cursor: col-resize; }
.chat-left { flex: 0 0 auto; max-width: 72%; min-width: 240px; display: flex; flex-direction: column; border-right: 1px solid var(--bd); background: var(--bg1); overflow: hidden; }
.chat-divider { width: 6px; flex: 0 0 6px; cursor: col-resize; background: transparent; z-index: 2; }
.chat-divider:hover { background: var(--ac2); opacity: .45; }
.chat-messages { flex: 1; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.chat-schedule { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid var(--bd); color: var(--tx5); font-size: 12px; }
.chat-schedule select, .chat-schedule input { background: var(--bg4, var(--bg5)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 6px; font-size: 12px; }
.chat-schedule .cs-num { width: 58px; }
.chat-schedule .cs-time { width: auto; }
.chat-filebar { display: flex; align-items: center; gap: 8px; padding: 6px 12px 0; }
.chat-pick { background: var(--bg5, var(--bg4)); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px; font-family: inherit; }
.chat-filechip { display: inline-flex; align-items: center; gap: 4px; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx4); font-size: 12px; }
.chat-filechip button { background: none; border: none; color: var(--tx5); cursor: pointer; font-size: 13px; padding: 0 2px; }
.chat-msg { display: flex; }
.chat-msg.user { justify-content: flex-end; }
.chat-msg .bubble { max-width: 82%; padding: 8px 11px; border-radius: 8px; font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.chat-msg.user .bubble { background: var(--ac2); color: #fff; border-bottom-right-radius: 2px; }
.chat-msg.assistant .bubble { background: var(--bg5, var(--bg4)); color: var(--tx2); border-bottom-left-radius: 2px; }
.chat-empty { color: var(--tx5); font-size: 12px; text-align: center; padding: 28px 12px; }
.chat-input { display: flex; gap: 8px; align-items: flex-end; padding: 10px 12px; border-top: 1px solid var(--bd); }
.chat-input textarea { flex: 1; min-height: 52px; max-height: 140px; resize: vertical; background: var(--bg4, var(--bg5)); color: var(--tx); border: 1px solid var(--bd); border-radius: 6px; padding: 7px 9px; font-family: inherit; font-size: 13px; }
.chat-input button { background: var(--ac2); color: #fff; border: 1px solid var(--ac2); border-radius: 5px; padding: 7px 14px; cursor: pointer; }
.chat-input button:disabled { opacity: .5; cursor: default; }
.chat-right { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg0, var(--bg1)); overflow: hidden; }
.chat-tabs { display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--bd); }
.chat-tabs button { background: var(--bg5, var(--bg4)); color: var(--tx2); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 12px; cursor: pointer; font-size: 12px; }
.chat-tabs button.on { background: var(--ac2); color: #fff; }
.chat-log { flex: 1; margin: 0; overflow: auto; padding: 12px; background: var(--bg6, var(--bg1)); color: var(--tx2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; white-space: pre-wrap; }
.chat-report { flex: 1; overflow: auto; padding: 14px 18px; color: var(--tx); }
.chat-result-state { padding: 8px 14px; font-size: 12px; border-bottom: 1px solid var(--bd); }
.chat-result-state.ok { color: #3fb950; }
.chat-result-state.bad { color: #e5534b; }
.chat-result-state.run { color: var(--ac2); }
.chat-report-link { padding: 6px 14px; border-bottom: 1px solid var(--bd); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-report-link a { color: var(--ac2); }
</style>
