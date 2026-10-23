<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useScheduler, type TaskView } from './useScheduler';
import SchedulerReportView from './SchedulerReportView.vue';
import { scheduleSummary, formatTime, runStatusLabel, recentJobsOf, typeLabel } from './format';
import { t } from '../i18n';
import CodeEditor from '../components/CodeEditor.vue';

const props = defineProps<{ terminal: any; onOpenSession?: (sessionId: string) => void }>();
const sched = useScheduler(props.terminal);
const { state } = sched;

const showEditor = ref(false);
const editingId = ref<string | null>(null);
const pickedPath = ref('');
const form = ref<any>(emptyForm());
const detailTask = ref<TaskView | null>(null);

function emptyForm() {
  return {
    name: '', enabled: true, cwd: '', filePath: '', type: 'shell', command: '',
    ai: { source: 'command', commandName: '', prompt: '' },
    workflow: { workflowId: '', agentId: '' },
    schedule: { mode: 'interval', interval: { every: 30, unit: 'minute' }, daily: { at: '09:30', weekdays: [] } },
    script: { path: '', exe: false },
    approvalRequired: false, onlyLocal: false, uniqueKey: '', weight: 0, maxRunMilliSecond: 0, groupName: 'default',
  };
}
const previewRunDir = computed(() => `<${t('sched.field.run_dir_placeholder')}>`);
const previewProgress = computed(() => `${previewRunDir.value}/result.json`);
const previewReportDir = computed(() => `${previewRunDir.value}/report`);
const exeCommand = computed(() => `"${form.value.script?.path || `<${t('sched.field.exe_path_placeholder')}>`}" "${previewProgress.value}" "${previewReportDir.value}"`);
const workflows = ref<{ id: string; label: string }[]>([]);
const agents = ref<{ id: string; name: string }[]>([]);
async function loadWorkflowOptions() {
  try {
    const w = await fetch('/api/workflows-xml').then((r) => r.json());
    workflows.value = (w.workflows || []).map((x: any) => ({ id: x.id, label: x.label || x.id }));
  } catch { workflows.value = []; }
  try {
    const a = await fetch('/api/agents').then((r) => r.json());
    agents.value = (a.agents || []).map((x: any) => ({ id: x.id, name: x.name || x.id }));
  } catch { agents.value = []; }
}
function wfLabel(id: string) { return workflows.value.find((w) => w.id === id)?.label || id; }
function agentName(id: string) { return agents.value.find((a) => a.id === id)?.name || id; }
function taskIcon(t: TaskView): string {
  if (t.type === 'workflow') return '🔀';
  if (t.type === 'script') return '📜';
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
  pickedPath.value = task.filePath || (task.type === 'script' ? (task.script?.path || '') : '');
  form.value = JSON.parse(JSON.stringify({
    name: task.name, enabled: task.enabled, cwd: task.cwd || '', filePath: task.filePath || '', type: task.type,
    command: task.command || '', ai: task.ai || { source: 'command', commandName: '', prompt: '' },
    script: task.script || { path: '', exe: false }, workflow: task.workflow || { workflowId: '', agentId: '' }, schedule: task.schedule,
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
        : { source: 'file', commandName: '', prompt: t('sched.ai.file_prompt') };
    } else if (['.py', '.bat', '.cmd', '.ps1', '.sh'].includes(ext)) {
      form.value.type = 'script';
      form.value.script = { path: r.path };
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
  if (body.type !== 'script') delete body.script;
  if (body.type !== 'workflow') delete body.workflow;
  if (body.uniqueKey === '') body.uniqueKey = null;
  if (!body.maxRunMilliSecond) body.maxRunMilliSecond = null;
  if (body.type === 'workflow' && (!body.workflow?.workflowId || !body.workflow?.agentId)) { state.error = t('sched.wf.need_select'); return; }
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
async function runNow(task: TaskView) {
  runPending.value[task.id] = true;
  try { await sched.runNow(task.id); await sched.refresh(); }
  catch (e: any) { state.error = String(e?.message || e); }
  finally { delete runPending.value[task.id]; }
}
const runPending = ref<Record<string, boolean>>({});
function isRunning(task: TaskView) { return !!runPending.value[task.id] || !!task.recentJobs?.some((j) => j.status === 3); }
async function stop(task: TaskView) { await sched.stopTask(task.id); await sched.refresh(); }
async function toggle(task: TaskView) { await sched.updateTask(task.id, { enabled: !task.enabled }); }
async function openWfRun(task: TaskView) {
  state.error = '';
  const list = await sched.loadJobs(task.id, 20);
  let sessionId = '';
  for (const job of list) {
    try { sessionId = JSON.parse(job.result || '{}').sessionId || ''; } catch { sessionId = ''; }
    if (sessionId) break;
  }
  if (!sessionId) { state.error = t('sched.wf.no_run'); return; }
  props.onOpenSession?.(sessionId);
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

onMounted(async () => { await sched.refresh(); sched.loadAiCommands(); void loadWorkflowOptions(); });
onBeforeUnmount(() => { sched.dispose(); });
</script>

<template>
  <div class="sched">
    <template v-if="!detailTask">
    <header class="bar">
      <span class="title">{{ $t('sched.title') }}</span>
      <span v-if="state.error" class="err">{{ state.error }}</span>
      <div class="spacer" />
      <button @click="sched.refresh()">{{ $t('sched.refresh') }}</button>
      <button class="primary" @click="openCreate">{{ $t('sched.create') }}</button>
      <button @click="showImport = true">{{ $t('sched.import') }}</button>
    </header>

    <div class="body">
      <div class="summary">
        <div class="sum-card sum-success"><span class="num">{{ sched.state.summary.success }}</span><span>{{ $t('sched.summary.success') }}</span></div>
        <div class="sum-card sum-failed"><span class="num">{{ sched.state.summary.failed }}</span><span>{{ $t('sched.summary.failed') }}</span></div>
        <div class="sum-card sum-running"><span class="num">{{ sched.state.summary.running }}</span><span>{{ $t('sched.summary.running') }}</span></div>
        <div class="sum-card sum-queued"><span class="num">{{ sched.state.summary.queued }}</span><span>{{ $t('jobs.summary.queued') }}</span></div>
        <div class="sum-card sum-pending"><span class="num">{{ sched.state.summary.pending }}</span><span>{{ $t('jobs.summary.pending') }}</span></div>
        <div class="sum-card sum-total"><span class="num">{{ sched.state.summary.total }}</span><span>{{ $t('sched.summary.total') }}</span></div>
      </div>
      <div class="list">
        <div v-if="state.tasks.length" class="listhead">
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
        <div v-for="t in state.tasks" :key="t.id" class="row" @click="openDetail(t)">
          <div class="rowmain">
            <div class="name">
              <span class="badge" :class="t.type"><span class="bi">{{ taskIcon(t) }}</span>{{ typeLabel(t.type) }}</span>
              {{ t.name }}
              <span v-if="t.type === 'workflow' && t.workflow" class="dim">{{ $t('sched.wf.task_meta', { wf: wfLabel(t.workflow.workflowId), agent: agentName(t.workflow.agentId) }) }}</span>
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
            <button v-if="t.type === 'workflow'" @click.stop="openWfRun(t)">{{ $t('sched.wf.open') }}</button>
            <button @click.stop="openDetail(t)">{{ $t('sched.history') }}</button>
            <button @click.stop="openEdit(t)">{{ $t('sched.edit') }}</button>
            <button @click.stop="remove(t)">{{ $t('sched.delete') }}</button>
          </div>
        </div>
      </div>
    </div>
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
            <option value="ai">AI {{ $t('sched.type.shell') }}</option>
            <option value="script">{{ $t('sched.type.script') }}</option>
            <option value="workflow">{{ $t('sched.type.workflow') }}</option>
          </select>
        </label>
        <template v-if="form.type === 'shell'">
          <label>{{ $t('sched.field.command') }} <CodeEditor v-model="form.command" class="sched-edit" language="cmd.sh" /></label>
        </template>
        <template v-else-if="form.type === 'ai'">
          <label>{{ $t('sched.field.source') }}
            <select v-model="form.ai.source">
              <option value="command">{{ $t('sched.source.command') }}</option>
              <option value="prompt">{{ $t('sched.source.prompt') }}</option>
              <option value="file">{{ $t('sched.source.file') }}</option>
            </select>
          </label>
          <label v-if="form.ai.source === 'command'">Command
            <select v-model="form.ai.commandName">
              <option value="">{{ $t('sched.field.choose') }}</option>
              <option v-for="c in state.aiCommands" :key="c.name" :value="c.name">{{ c.name }}</option>
            </select>
          </label>
          <label v-else-if="form.ai.source === 'prompt'">Prompt <CodeEditor v-model="form.ai.prompt" class="sched-edit" /></label>
          <div v-else class="dim">{{ $t('sched.source.file_hint') }}</div>
        </template>
        <template v-else-if="form.type === 'workflow'">
          <label>{{ $t('sched.wf.select') }}
            <select v-model="form.workflow.workflowId">
              <option value="">{{ $t('sched.field.choose') }}</option>
              <option v-for="w in workflows" :key="w.id" :value="w.id">{{ w.label }}</option>
            </select>
            <span v-if="!workflows.length" class="dim">{{ $t('sched.wf.none') }}</span>
          </label>
          <label>{{ $t('sched.agent.select') }}
            <select v-model="form.workflow.agentId">
              <option value="">{{ $t('sched.field.choose') }}</option>
              <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
        </template>
        <template v-else>
          <label>{{ $t('sched.field.script_path') }} <input v-model="form.script.path" /></label>
          <label class="inline">
            <input type="checkbox" class="exe-check" v-model="form.script.exe" /> {{ $t('sched.field.exe') }}
          </label>
          <template v-if="form.script.exe">
            <label>{{ $t('sched.field.progress_path') }}
              <input class="fileinp" :value="previewProgress" readonly />
            </label>
            <label>{{ $t('sched.field.report_dir') }}
              <input class="fileinp" :value="previewReportDir" readonly />
            </label>
            <label>{{ $t('sched.field.command_preview') }}
              <div class="cmdpreview">{{ exeCommand }}</div>
            </label>
          </template>
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
  </div>
</template>

<style scoped>
.sched { display: flex; flex-direction: column; height: 100%; background: var(--bg0, var(--bg1)); }
.bar { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-bottom: 1px solid var(--bd); }
.bar .title { font-weight: 700; color: var(--tx1); }
.bar .spacer { flex: 1; }
.bar .err { color: var(--warn, #e5534b); font-size: 12px; }
.bar button, .modalacts button { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.bar button.primary, .modalacts button.primary { background: var(--ac3, var(--ac2)); border-color: var(--ac3, var(--ac2)); color: #fff; }
.body { flex: 1; overflow: auto; padding: 8px 12px; }
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
.listhead .lh-hist { width: 148px; text-align: center; }
.listhead .lh-acts { width: 370px; text-align: right; }
.statuscol { display: flex; align-items: center; justify-content: center; gap: 4px; width: 72px; flex: none; }
.statuscol .st { font-size: 11px; color: var(--tx5); }
.statuscol .st.on { color: #3fb950; }
.statuscol .st.paused { color: #d29922; }
.st-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.st-dot.on { background: #3fb950; }
.st-dot.paused { background: #d29922; }
.histcol { display: flex; gap: 4px; align-items: center; justify-content: center; width: 148px; flex: none; }
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
</style>
