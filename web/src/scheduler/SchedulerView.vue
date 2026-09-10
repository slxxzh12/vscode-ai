<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useScheduler, type TaskView } from './useScheduler';
import { scheduleSummary, formatTime, runStatusLabel } from './format';
import type { SchedulerRun } from '@devflow/shared/scheduler';
import { t } from '../i18n';

const props = defineProps<{ terminal: any }>();
const sched = useScheduler(props.terminal);
const { state } = sched;

const projects = ref<{ id: string; name: string; root: string }[]>([]);
const showEditor = ref(false);
const editingId = ref<string | null>(null);
const form = ref<any>(emptyForm());
const runs = ref<SchedulerRun[]>([]);
const runsTaskId = ref<string | null>(null);
const logText = ref('');
const logRunId = ref<string | null>(null);
let logTimer: ReturnType<typeof setInterval> | null = null;

function emptyForm() {
  return {
    name: '', enabled: true, projectId: '', cwd: '', type: 'shell', command: '',
    ai: { source: 'command', commandName: '', prompt: '' }, script: { path: '' },
    schedule: { mode: 'interval', interval: { every: 30, unit: 'minute' }, daily: { at: '09:30', weekdays: [] } },
  };
}
async function loadProjects() {
  try { const d = await fetch('/api/projects').then((r) => r.json()); projects.value = d.projects || []; }
  catch { projects.value = []; }
}
function openCreate() { editingId.value = null; form.value = emptyForm(); showEditor.value = true; }
function openEdit(task: TaskView) {
  editingId.value = task.id;
  form.value = JSON.parse(JSON.stringify({
    name: task.name, enabled: task.enabled, projectId: task.projectId || '', cwd: task.cwd || '', type: task.type,
    command: task.command || '', ai: task.ai || { source: 'command', commandName: '', prompt: '' },
    script: task.script || { path: '' }, schedule: task.schedule,
  }));
  showEditor.value = true;
}
function extOf(p: string): string { const i = p.lastIndexOf('.'); return i >= 0 ? p.slice(i).toLowerCase() : ''; }
function dirOf(p: string): string { const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i > 0 ? p.slice(0, i) : p; }
async function pickCommandFile() {
  state.error = '';
  try {
    const r = await sched.pickFile();
    if (r.error) { state.error = t('sched.pick_unsupported'); return; }
    if (r.cancelled || !r.path) return;
    const ext = extOf(r.path);
    form.value.cwd = dirOf(r.path);
    if (ext === '.md') {
      form.value.type = 'ai';
      form.value.ai = { source: 'prompt', commandName: '', prompt: r.content || '' };
    } else if (['.py', '.bat', '.cmd', '.ps1', '.sh'].includes(ext)) {
      form.value.type = 'script';
      form.value.script = { path: r.path };
    } else {
      state.error = t('sched.unsupported_file', { ext: ext || '?' });
    }
  } catch (e: any) { state.error = String(e?.message || e); }
}
async function save() {
  const body = JSON.parse(JSON.stringify(form.value));
  if (!body.projectId) body.projectId = null;
  if (!body.cwd) body.cwd = null;
  if (body.type !== 'shell') delete body.command;
  if (body.type !== 'ai') delete body.ai;
  if (body.type !== 'script') delete body.script;
  try {
    if (editingId.value) await sched.updateTask(editingId.value, body);
    else await sched.createTask(body);
    showEditor.value = false;
  } catch (e: any) { state.error = String(e?.message || e); }
}
async function remove(task: TaskView) {
  if (!confirm(t('sched.remove_confirm', { name: task.name }))) return;
  await sched.removeTask(task.id);
}
async function runNow(task: TaskView) {
  try { await sched.runNow(task.id); await sched.refresh(); }
  catch (e: any) { state.error = String(e?.message || e); }
}
async function stop(task: TaskView) { await sched.stopTask(task.id); await sched.refresh(); }
async function toggle(task: TaskView) { await sched.updateTask(task.id, { enabled: !task.enabled }); }
async function openRuns(task: TaskView) {
  runsTaskId.value = task.id;
  runs.value = await sched.loadRuns(task.id);
  logText.value = '';
  logRunId.value = null;
  startLogTimer();
}
async function openLog(r: SchedulerRun) { logRunId.value = r.id; logText.value = await sched.loadLog(r.id); }
function startLogTimer() {
  stopLogTimer();
  logTimer = setInterval(async () => {
    if (!runsTaskId.value) return;
    runs.value = await sched.loadRuns(runsTaskId.value);
    if (logRunId.value) logText.value = await sched.loadLog(logRunId.value);
  }, 2000);
}
function stopLogTimer() { if (logTimer) { clearInterval(logTimer); logTimer = null; } }
function closeRuns() { runsTaskId.value = null; logRunId.value = null; logText.value = ''; stopLogTimer(); }
const WEEKDAYS = computed(() => [1, 2, 3, 4, 5, 6, 7].map((v) => ({ v, t: t('sched.wdshort.' + v) })));
function toggleWeekday(v: number) {
  const arr: number[] = form.value.schedule.daily.weekdays;
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1); else arr.push(v);
}

onMounted(async () => { await loadProjects(); await sched.refresh(); sched.loadAiCommands(); });
onBeforeUnmount(() => { stopLogTimer(); sched.dispose(); });
</script>

<template>
  <div class="sched">
    <header class="bar">
      <span class="title">{{ $t('sched.title') }}</span>
      <span v-if="state.error" class="err">{{ state.error }}</span>
      <div class="spacer" />
      <button @click="sched.refresh()">{{ $t('sched.refresh') }}</button>
      <button class="primary" @click="openCreate">{{ $t('sched.create') }}</button>
    </header>

    <div class="body">
      <div class="list">
        <div v-if="!state.tasks.length" class="empty">{{ $t('sched.empty') }}</div>
        <div v-for="t in state.tasks" :key="t.id" class="row">
          <div class="rowmain">
            <div class="name">
              <span class="badge" :class="t.type">{{ t.type === 'shell' ? $t('sched.type.shell') : t.type === 'ai' ? 'AI' : $t('sched.type.script') }}</span>
              {{ t.name }}
              <span class="dim">{{ scheduleSummary(t.schedule) }}</span>
            </div>
            <div class="meta">
              <span v-if="t.runningRunId" class="dot running" />{{ t.runningRunId ? $t('sched.running') : '' }}
              <span class="dim">{{ $t('sched.next', { time: formatTime(t.nextRunAt) }) }}</span>
            </div>
          </div>
          <div class="acts">
            <label class="sw"><input type="checkbox" :checked="t.enabled" @change="toggle(t)" /> {{ $t('sched.enabled') }}</label>
            <button v-if="!t.runningRunId" @click="runNow(t)">{{ $t('sched.run') }}</button>
            <button v-else @click="stop(t)">{{ $t('sched.stop') }}</button>
            <button @click="openRuns(t)">{{ $t('sched.history') }}</button>
            <button @click="openEdit(t)">{{ $t('sched.edit') }}</button>
            <button @click="remove(t)">{{ $t('sched.delete') }}</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showEditor" class="overlay" @click.self="showEditor = false">
      <div class="modal">
        <h3>{{ editingId ? $t('sched.edit_task') : $t('sched.new_task') }}</h3>
        <label>{{ $t('sched.field.name') }} <input v-model="form.name" /></label>
        <label>{{ $t('sched.field.project') }}
          <select v-model="form.projectId">
            <option value="">{{ $t('sched.field.no_project') }}</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
        <button class="pickfile" @click="pickCommandFile">{{ $t('sched.pick_file') }}</button>
        <label>{{ $t('sched.field.cwd') }} <input v-model="form.cwd" :placeholder="$t('sched.field.cwd_placeholder')" /></label>
        <label>{{ $t('sched.field.type') }}
          <select v-model="form.type">
            <option value="shell">{{ $t('sched.type.shell') }}</option>
            <option value="ai">AI {{ $t('sched.type.shell') }}</option>
            <option value="script">{{ $t('sched.type.script') }}</option>
          </select>
        </label>
        <template v-if="form.type === 'shell'">
          <label>{{ $t('sched.field.command') }} <textarea v-model="form.command" rows="3" /></label>
        </template>
        <template v-else-if="form.type === 'ai'">
          <label>{{ $t('sched.field.source') }}
            <select v-model="form.ai.source">
              <option value="command">{{ $t('sched.source.command') }}</option>
              <option value="prompt">{{ $t('sched.source.prompt') }}</option>
            </select>
          </label>
          <label v-if="form.ai.source === 'command'">Command
            <select v-model="form.ai.commandName">
              <option value="">{{ $t('sched.field.choose') }}</option>
              <option v-for="c in state.aiCommands" :key="c.name" :value="c.name">{{ c.name }}</option>
            </select>
          </label>
          <label v-else>Prompt <textarea v-model="form.ai.prompt" rows="4" /></label>
        </template>
        <template v-else>
          <label>{{ $t('sched.field.script_path') }} <input v-model="form.script.path" /></label>
        </template>

        <label>{{ $t('sched.field.mode') }}
          <select v-model="form.schedule.mode">
            <option value="interval">{{ $t('sched.mode.interval') }}</option>
            <option value="daily">{{ $t('sched.mode.daily') }}</option>
          </select>
        </label>
        <template v-if="form.schedule.mode === 'interval'">
          <label>{{ $t('sched.field.every') }} <input type="number" min="1" v-model.number="form.schedule.interval.every" style="width:80px" />
            <select v-model="form.schedule.interval.unit">
              <option value="second">{{ $t('sched.unit.second') }}</option>
              <option value="minute">{{ $t('sched.unit.minute') }}</option>
              <option value="hour">{{ $t('sched.unit.hour') }}</option>
              <option value="day">{{ $t('sched.unit.day') }}</option>
            </select>
          </label>
        </template>
        <template v-else>
          <label>{{ $t('sched.field.at') }} <input type="time" v-model="form.schedule.daily.at" /></label>
          <div class="wd">
            {{ $t('sched.field.weekdays') }}
            <label v-for="w in WEEKDAYS" :key="w.v" class="wditem">
              <input type="checkbox" :checked="form.schedule.daily.weekdays.includes(w.v)" @change="toggleWeekday(w.v)" />{{ w.t }}
            </label>
          </div>
        </template>

        <div class="modalacts">
          <button @click="showEditor = false">{{ $t('sched.cancel') }}</button>
          <button class="primary" @click="save">{{ $t('sched.save') }}</button>
        </div>
      </div>
    </div>

    <div v-if="runsTaskId" class="overlay" @click.self="closeRuns">
      <div class="modal wide">
        <h3>{{ $t('sched.runs.title') }}</h3>
        <div class="histwrap">
          <div class="histlist">
            <div v-for="r in runs" :key="r.id" class="histitem" :class="{ on: r.id === logRunId }" @click="openLog(r)">
              <span class="dot" :class="r.status" />{{ formatTime(r.startedAt) }}
              <span class="dim">{{ runStatusLabel(r.status) }} · {{ r.durationMs ?? '—' }}ms</span>
            </div>
            <div v-if="!runs.length" class="empty">{{ $t('sched.runs.empty') }}</div>
          </div>
          <pre class="logview">{{ logText || $t('sched.runs.select') }}</pre>
        </div>
        <div class="modalacts"><button @click="closeRuns">{{ $t('sched.close') }}</button></div>
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
.empty { color: var(--tx5); padding: 24px; text-align: center; }
.row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--bd); border-radius: 6px; margin-bottom: 6px; background: var(--bg1); }
.rowmain { flex: 1; min-width: 0; }
.name { color: var(--tx1); display: flex; align-items: center; gap: 8px; }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 3px; background: var(--bg5, var(--bg4)); color: var(--tx2); }
.badge.ai { background: var(--ac2); color: #fff; }
.badge.script { background: var(--warn, #b58900); color: #000; }
.meta { color: var(--tx4); font-size: 12px; margin-top: 2px; display: flex; gap: 12px; align-items: center; }
.dim { color: var(--tx5); font-size: 12px; }
.acts { display: flex; gap: 4px; align-items: center; flex: none; }
.acts button { background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
.sw { color: var(--tx4); font-size: 12px; display: flex; align-items: center; gap: 3px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--tx5); margin-right: 4px; }
.dot.running { background: var(--ac2); }
.dot.success { background: #3fb950; }
.dot.failed, .dot.timeout { background: #e5534b; }
.dot.killed { background: var(--tx5); }
.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 16px; width: 460px; max-height: 86vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.modal.wide { width: 720px; }
.modal h3 { margin: 0 0 6px; color: var(--tx1); }
.modal label { display: flex; flex-direction: column; gap: 3px; color: var(--tx3); font-size: 12px; }
.modal input, .modal select, .modal textarea { background: var(--bg4, var(--bg5)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 4px 6px; font-family: inherit; }
.wd { color: var(--tx3); font-size: 12px; }
.wditem { display: inline-flex; flex-direction: row; align-items: center; gap: 2px; margin-right: 6px; }
.pickfile { align-self: flex-start; background: var(--bg5, var(--bg4)); color: var(--tx); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.modalacts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.histwrap { display: flex; gap: 8px; min-height: 260px; }
.histlist { width: 220px; overflow: auto; border-right: 1px solid var(--bd); }
.histitem { padding: 5px 6px; cursor: pointer; border-radius: 4px; font-size: 12px; color: var(--tx2); }
.histitem.on { background: var(--bg5, var(--bg4)); }
.logview { flex: 1; margin: 0; overflow: auto; background: var(--bg6, var(--bg1)); color: var(--tx2); font-family: ui-monospace, Consolas, monospace; font-size: 12px; padding: 8px; white-space: pre-wrap; }
</style>
